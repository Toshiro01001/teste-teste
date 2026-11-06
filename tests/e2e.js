// Percorre os fluxos no Chromium em três tamanhos de tela, nos dois modos (JSON estático e API Java).
// Uso: NODE_PATH=$(npm root -g) SAIDA=pasta node tests/e2e.js (depois de tests/testar-java.sh, que compila o servidor).
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const RAIZ = path.resolve(__dirname, '..');
const SAIDA = process.env.SAIDA || path.join(__dirname, 'capturas');
const PORTA_SITE = 18123;
const PORTA_API = 18124;
const FAIXA = 'Sistema de demonstração. Todas as pessoas e dados são fictícios.';
const DADOS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'dados/registros.json'), 'utf8'));
const TELAS = {
  computador: { viewport: { width: 1366, height: 800 }, deviceScaleFactor: 2 },
  iphone13: { ...devices['iPhone 13'], deviceScaleFactor: 2 },
  'tela320': { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

let passou = 0;
const falhas = [];
let contexto = '';
function ok(nome, cond, detalhe) {
  if (cond) passou++;
  else falhas.push(`[${contexto}] ${nome}${detalhe !== undefined ? ' => ' + JSON.stringify(detalhe) : ''}`);
}

function esperarPorta(porta) {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    (function tentar() {
      http.get({ host: '127.0.0.1', port: porta, path: '/' }, (r) => { r.resume(); resolve(); }).on('error', () => {
        if (Date.now() - inicio > 15000) reject(new Error('porta ' + porta + ' não abriu'));
        else setTimeout(tentar, 150);
      });
    })();
  });
}
async function ligarApi() {
  const p = spawn('java', ['-cp', 'tests/out', 'fichario.Servidor', '--porta', String(PORTA_API), '--dados', 'dados/registros.json'], { cwd: RAIZ, stdio: 'ignore' });
  await esperarPorta(PORTA_API);
  return p;
}
function desligar(p) {
  return new Promise((resolve) => { p.on('exit', resolve); p.kill(); });
}

const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const LINHAS = '#linhas tr';

async function semRolagemLateral(page, nome) {
  const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  ok('sem rolagem lateral: ' + nome, r.s <= r.c, r);
}
async function faixaOk(page, nome) {
  const f = page.locator('.faixa');
  ok('faixa com o texto exato: ' + nome, (await f.textContent()) === FAIXA && await f.isVisible());
}
async function esperaContagem(page, texto) {
  await page.waitForFunction((t) => document.getElementById('contagem').textContent.startsWith(t), texto, { timeout: 8000 })
    .catch(() => ok('contagem começa com ' + texto, false));
}
async function abrirFiltros(page) {
  const d = page.locator('#mais-filtros');
  if (!(await d.evaluate((n) => n.open))) await page.locator('#mais-filtros summary').click();
}
async function ids(page) {
  return page.locator(LINHAS + ' small').allTextContents();
}
// Capturas do modo estático em todas as telas; do modo API, só no computador.
async function foto(page, nome, tela) {
  const emApi = contexto.endsWith('/api');
  if (emApi && tela !== 'computador') return;
  await page.screenshot({ path: path.join(SAIDA, `${tela}${emApi ? '-api' : ''}-${nome}.png`), fullPage: false });
}

async function contraste(page) {
  return page.evaluate(() => {
    const lum = (c) => {
      const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const cor = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m[3] === undefined ? 1 : m[3] }; };
    const fundo = (el) => { for (let n = el; n; n = n.parentElement) { const c = cor(getComputedStyle(n).backgroundColor); if (c.a === 1) return c.rgb; } return [255, 255, 255]; };
    const ruins = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed' && getComputedStyle(el).position !== 'sticky') return;
      if (el.closest('.invisivel') || !Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) return;
      const st = getComputedStyle(el);
      const a = lum(cor(st.color).rgb), b = lum(fundo(el));
      const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (r < 4.5) ruins.push([el.tagName, el.textContent.slice(0, 30), r.toFixed(2)]);
    });
    return ruins;
  });
}

async function percorrer(browser, tela, modo) {
  contexto = `${tela}/${modo}`;
  const api = modo === 'api' ? await ligarApi() : null;
  const base = `http://127.0.0.1:${PORTA_SITE}/index.html` + (api ? `?api=http://127.0.0.1:${PORTA_API}` : '');
  const ctx = await browser.newContext({ ...TELAS[tela], acceptDownloads: true, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const erros = [];
  const envios = [];
  page.on('console', (m) => {
    // Único caso aceito: o 404 que o próprio teste provoca ao pedir uma ficha inexistente à API. O navegador sempre o registra.
    if (m.location().url.endsWith('/api/registros/REG-9999')) return;
    if (m.type() === 'error' || m.type() === 'warning') erros.push(m.text());
  });
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('request', (r) => { if (r.method() !== 'GET') envios.push(r.method() + ' ' + r.url()); });

  await page.goto(base);
  await esperaContagem(page, '64 registros');
  await faixaOk(page, 'consulta');
  await semRolagemLateral(page, 'consulta');
  ok('modo aparece no rodapé', (await page.locator('#modo-rodape').textContent()).includes(api ? 'API Java' : 'arquivo estático'));
  ok('10 linhas', (await page.locator(LINHAS).count()) === 10);
  ok('aviso de polícia visível', await page.locator('.aviso-real').isVisible() && (await page.locator('.aviso-real').textContent()).includes('procure a polícia'));
  const rod = page.locator('.rodape a[href="https://mileumalinhas.com.br"]');
  ok('rodapé com link', (await page.locator('.rodape p').first().textContent()) === 'Demonstração feita por Mil e Uma Linhas!' && await rod.count() === 1);
  ok('nenhuma imagem de bitmap', (await page.locator('img').count()) === 0);
  ok('avatares SVG', (await page.locator('#linhas svg.avatar').count()) === 10);
  ok('todo campo tem rótulo', await page.evaluate(() => Array.from(document.querySelectorAll('input,select,textarea')).every((c) => c.labels && c.labels.length)));
  ok('ids únicos', await page.evaluate(() => { const i = Array.from(document.querySelectorAll('[id]')).map((n) => n.id); return new Set(i).size === i.length; }));
  const arvore = await page.locator('#tabela').ariaSnapshot();
  ok('leitor de tela vê tabela, linhas e células', /- table/.test(arvore) && /- row/.test(arvore) && /- cell/.test(arvore), arvore.slice(0, 200));
  const baixo = await contraste(page);
  ok('contraste AA na consulta', baixo.length === 0, baixo);
  await foto(page, 'consulta', tela);
  await page.locator('#abas').scrollIntoViewIfNeeded();
  await page.evaluate(() => { const y = document.getElementById('abas').getBoundingClientRect().top + scrollY - 60; window.scrollTo(0, y); });
  await foto(page, 'resultados', tela);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (tela !== 'computador') {
    const pequenos = await page.evaluate(() => Array.from(document.querySelectorAll('.aba, .botao, select, summary, .paginas a, .topo li a')).filter((n) => n.offsetParent && n.getBoundingClientRect().height < 44).map((n) => n.textContent.trim().slice(0, 20)));
    ok('alvos de toque com 44 px', pequenos.length === 0, pequenos);
  }
  await page.evaluate(() => window.scrollTo(0, 500));
  const topoFaixa = await page.locator('.faixa').evaluate((n) => n.getBoundingClientRect().top);
  ok('faixa fica fixa ao rolar', topoFaixa === 0, topoFaixa);
  await page.evaluate(() => window.scrollTo(0, 0));

  // Busca sem acento encontra nome com acento
  await page.fill('#busca', 'ficcao');
  const totalBusca = DADOS.filter((r) => norm(`${r.id} ${r.nome} ${r.cidade} ${r.descricao}`).includes('ficcao')).length;
  await esperaContagem(page, `${totalBusca} registro`);
  ok('busca entra no endereço', page.url().includes('busca=ficcao'));
  await page.fill('#busca', '');
  await esperaContagem(page, '64 registros');

  // Filtros combinados, conferidos com a verdade calculada aqui no teste
  await abrirFiltros(page);
  await page.selectOption('#cidade', 'Lagoa Imaginária');
  await page.fill('#idadeMin', '30');
  await page.fill('#idadeMax', '70');
  await page.fill('#dataDe', '2024-06-01');
  await page.fill('#dataAte', '2026-06-30');
  await page.locator('#dataAte').blur();
  const f1 = DADOS.filter((r) => r.cidade === 'Lagoa Imaginária' && r.idade >= 30 && r.idade <= 70 && r.data >= '2024-06-01' && r.data <= '2026-06-30');
  await esperaContagem(page, `${f1.length} registro`);
  ok('filtros combinados mostram os certos', (await ids(page)).every((i) => f1.some((r) => r.id === i)) && f1.length > 0);
  ok('contagem por cidade acompanha', (await page.locator('#por-cidade li').count()) === 1);
  await semRolagemLateral(page, 'filtros abertos');
  await foto(page, 'filtros', tela);

  // Filtro inválido: mostra o erro e não muda a lista
  await page.fill('#idadeMin', '80');
  await page.fill('#idadeMax', '20');
  await page.locator('#idadeMax').blur();
  await page.waitForSelector('#erro-filtros:not([hidden])');
  ok('idade invertida é recusada', (await page.locator('#erro-filtros').textContent()).includes('idade') && (await page.locator('#idadeMax').getAttribute('aria-invalid')) === 'true');
  ok('lista mantida no erro', (await page.locator('#contagem').textContent()).startsWith(`${f1.length} registro`));
  await page.locator('#limpar').click();
  await esperaContagem(page, '64 registros');
  ok('limpar remove o erro', await page.locator('#erro-filtros').isHidden());

  // Abas de situação com contagens certas
  const nAberto = DADOS.filter((r) => r.situacao === 'em_aberto').length;
  const aba = page.locator('.aba[data-situacao="em_aberto"]');
  ok('aba mostra contagem', (await aba.locator('b').textContent()) === String(nAberto));
  await aba.click();
  await esperaContagem(page, `${nAberto} registros`);
  ok('aba marcada com aria-pressed', (await aba.getAttribute('aria-pressed')) === 'true');
  ok('foco fica na aba', await aba.evaluate((n) => document.activeElement === n) || tela !== 'computador');
  ok('situação na URL', page.url().includes('situacao=em_aberto'));

  // Ordenação
  await page.selectOption('#ordenar', 'idade');
  const esperado = DADOS.filter((r) => r.situacao === 'em_aberto').sort((a, b) => a.idade - b.idade || cmp(a.id, b.id)).slice(0, 10).map((r) => r.id);
  await page.waitForFunction((id) => document.querySelector('#linhas small').textContent === id, esperado[0]);
  ok('ordena por idade', JSON.stringify(await ids(page)) === JSON.stringify(esperado), await ids(page));

  // Paginação com foco nos resultados
  await page.locator('#paginas a', { hasText: 'Próxima' }).click();
  await page.waitForFunction(() => /Página 2 de/.test(document.getElementById('contagem').textContent));
  ok('foco vai aos resultados', await page.evaluate(() => document.activeElement.id === 'titulo-resultados'));
  ok('página atual marcada', (await page.locator('#paginas a[aria-current=page]').textContent()) === '2');
  await semRolagemLateral(page, 'página 2');

  // Link direto: recarregar preserva filtros, ordem e página
  const ids2 = await ids(page);
  await page.reload();
  await page.waitForFunction(() => /Página 2 de/.test(document.getElementById('contagem').textContent));
  ok('recarregar mantém a tela', JSON.stringify(await ids(page)) === JSON.stringify(ids2));
  ok('ordem restaurada no controle', (await page.locator('#ordenar').inputValue()) === 'idade');

  // CSV
  const [baixa] = await Promise.all([page.waitForEvent('download'), page.locator('#exportar').click()]);
  const csv = fs.readFileSync(await baixa.path(), 'utf8');
  const linhasCsv = csv.trim().split('\r\n');
  ok('CSV com BOM e acentos', csv.charCodeAt(0) === 0xFEFF && csv.includes('Situação'));
  ok('CSV com todas as linhas filtradas', linhasCsv.length === nAberto + 1, linhasCsv.length);
  ok('CSV com separador ;', linhasCsv[1].split('";"').length === 7);
  ok('nome do CSV', baixa.suggestedFilename() === 'registros-ficticios-demonstracao.csv');

  // Vazio
  await page.fill('#busca', 'zzzzzz');
  await esperaContagem(page, 'Nenhum registro');
  ok('estado vazio visível', await page.locator('#vazio').isVisible() && await page.locator('#tabela').isHidden());
  ok('exportar desativado no vazio', await page.locator('#exportar').isDisabled());
  await foto(page, 'vazio', tela);
  await page.locator('#limpar-vazio').click();
  await esperaContagem(page, '64 registros');

  // Detalhe e formulário
  const idPrimeiro = (await ids(page))[0];
  await page.locator(LINHAS + ' a').first().click();
  await page.waitForFunction(() => !document.getElementById('v-detalhe').hidden);
  ok('rota de hash do detalhe', page.url().endsWith('#/registro/' + idPrimeiro));
  ok('foco no nome', await page.evaluate(() => document.activeElement.id === 'ficha-nome'));
  ok('título da aba muda', (await page.title()).includes('Fichário'));
  await faixaOk(page, 'detalhe');
  await semRolagemLateral(page, 'detalhe');
  ok('tela avisa sobre o envio', (await page.locator('#nota-informacao').textContent()).startsWith(api ? 'Nada vai para ninguém' : 'Nada é enviado de verdade'));
  const b2 = await contraste(page);
  ok('contraste AA no detalhe', b2.length === 0, b2);
  await foto(page, 'detalhe', tela);

  await page.locator('#f-info button[type=submit]').click();
  await page.waitForSelector('#f-info-erros:not([hidden])');
  ok('quatro erros no envio vazio', (await page.locator('#f-info-erros li').count()) === 4, await page.locator('#f-info-erros li').count());
  ok('foco no resumo de erros', await page.evaluate(() => document.activeElement.id === 'f-info-erros'));
  ok('campo marcado inválido', (await page.locator('#i-local').getAttribute('aria-invalid')) === 'true');
  await page.locator('#f-info-erros a').first().click();
  ok('link do erro leva ao campo', await page.evaluate(() => document.activeElement.id === 'i-local'));
  await semRolagemLateral(page, 'erros do formulário');
  await page.locator('#f-info').scrollIntoViewIfNeeded();
  await foto(page, 'formulario-erros', tela);

  await page.fill('#i-local', 'Praça Fictícia');
  await page.fill('#i-data', '2099-01-01');
  await page.fill('#i-relato', 'curto');
  await page.fill('#i-contato', 'sem-arroba');
  await page.check('#i-ciente');
  await page.locator('#f-info button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('i-data-erro').textContent.includes('futuro'));
  ok('data futura recusada', true);
  ok('relato curto recusado', !(await page.locator('#i-relato-erro').isHidden()));
  ok('e-mail ruim recusado', !(await page.locator('#i-contato-erro').isHidden()));
  const antes = envios.length;
  await page.fill('#i-data', '2025-03-03');
  await page.fill('#i-relato', 'Relato inventado para testar o formulário.');
  await page.fill('#i-contato', '');
  await page.locator('#f-info button[type=submit]').click();
  await page.waitForSelector('#f-info-ok:not([hidden])');
  ok('confirmação com foco', await page.evaluate(() => document.activeElement.id === 'f-info-ok'));
  const conf = await page.locator('#f-info-ok-texto').textContent();
  if (api) ok('API recebeu a informação', envios.length === antes + 1 && envios[antes].includes('/informacoes'), envios);
  else {
    ok('modo estático não envia nada', envios.length === 0, envios);
    ok('tela diz que nada foi enviado', conf.includes('Nada foi enviado'));
  }
  await foto(page, 'formulario-confirmacao', tela);

  // Voltar mantém a busca anterior
  await page.locator('#voltar').click();
  await page.waitForFunction(() => !document.getElementById('v-lista').hidden);
  await esperaContagem(page, '64 registros');
  ok('foco no título ao voltar', await page.evaluate(() => document.activeElement.tagName === 'H1'));

  // Cadastro, inclusive tentativa de injetar marcação
  await page.locator('nav a[href="#/novo"]').click();
  await page.waitForFunction(() => !document.getElementById('v-novo').hidden);
  await faixaOk(page, 'novo');
  await semRolagemLateral(page, 'novo');
  ok('tela do cadastro avisa', (await page.locator('#nota-novo').textContent()).length > 20);
  await page.locator('#f-novo button[type=submit]').click();
  await page.waitForSelector('#f-novo-erros:not([hidden])');
  ok('seis erros no cadastro vazio', (await page.locator('#f-novo-erros li').count()) === 6);
  await foto(page, 'novo-erros', tela);
  const perigoso = '<img src=x onerror=window.__xss=1>';
  await page.fill('#n-nome', perigoso);
  await page.fill('#n-idade', '17');
  await page.selectOption('#n-situacao', 'em_aberto');
  await page.fill('#n-cidade', 'Cidade Inventada');
  await page.fill('#n-data', '2025-04-04');
  await page.fill('#n-descricao', 'Personagem fictício para o teste de cadastro.');
  await page.locator('#f-novo button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('n-idade-erro').textContent.includes('18'));
  ok('menor de 18 recusado', true);
  await page.fill('#n-idade', '40');
  await page.locator('#f-novo button[type=submit]').click();
  await page.waitForSelector('#f-novo-ok:not([hidden])');
  ok('cadastro cria a ficha seguinte', (await page.locator('#f-novo-ok-texto').textContent()).includes('REG-0065'));
  await page.locator('#f-novo-link').click();
  await page.waitForFunction(() => !document.getElementById('v-detalhe').hidden);
  ok('marcação aparece como texto', (await page.locator('#ficha-nome').textContent()) === perigoso);
  ok('marcação não vira elemento', (await page.locator('img').count()) === 0 && !(await page.evaluate(() => window.__xss)));
  await page.locator('nav a[href="#/"]').click();
  await esperaContagem(page, '65 registros');
  await abrirFiltros(page);
  ok('cidade nova entra no filtro', (await page.locator('#cidade option').allTextContents()).includes('Cidade Inventada'));

  // Como isto funciona
  await page.locator('nav a[href="#/como-funciona"]').click();
  await page.waitForFunction(() => !document.getElementById('v-como').hidden);
  const como = await page.locator('#v-como').textContent();
  ok('como funciona cita o que adaptar', ['Estoque', 'Clientes', 'Processos', 'Qualquer outro cadastro'].every((p) => como.includes(p)));
  await faixaOk(page, 'como funciona');
  await semRolagemLateral(page, 'como funciona');
  await foto(page, 'como-funciona', tela);

  // Endereços inexistentes
  await page.evaluate(() => { location.hash = '#/nada'; });
  await page.waitForFunction(() => !document.getElementById('v-nao').hidden);
  await faixaOk(page, 'não encontrada');
  await page.evaluate(() => { location.hash = '#/registro/REG-9999'; });
  await page.waitForFunction(() => document.getElementById('nao-texto').textContent.includes('REG-9999'));
  await semRolagemLateral(page, 'registro inexistente');
  await page.evaluate(() => { location.hash = '#/?situacao=hack&pagina=-3&idadeMin=abc&ordenar=senha&dataDe=ontem'; });
  await esperaContagem(page, '65 registros');
  ok('endereço com lixo não quebra', true);
  await page.evaluate(() => { location.hash = '#/?pagina=99'; });
  await page.waitForFunction(() => /Página 7 de 7/.test(document.getElementById('contagem').textContent));
  ok('página além do fim volta para a última', true);

  ok('sem erros no console', erros.length === 0, erros);
  await ctx.close();
  if (api) await desligar(api);
}

// O GitHub Pages serve o site numa subpasta (/teste-teste/). Os caminhos relativos precisam funcionar lá.
async function subpasta(browser) {
  contexto = 'subpasta do Pages';
  const nome = path.basename(RAIZ);
  const porta = PORTA_SITE + 2;
  const srv = spawn('python3', ['-m', 'http.server', String(porta), '--bind', '127.0.0.1'], { cwd: path.dirname(RAIZ), stdio: 'ignore' });
  await esperarPorta(porta);
  const ctx = await browser.newContext(TELAS.computador);
  const page = await ctx.newPage();
  const erros = [];
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push(String(e)));
  await page.goto(`http://127.0.0.1:${porta}/${nome}/`);
  await esperaContagem(page, '64 registros');
  await page.locator(LINHAS + ' a').first().click();
  await page.waitForFunction(() => !document.getElementById('v-detalhe').hidden);
  ok('abre e navega numa subpasta', true);
  ok('sem erros na subpasta', erros.length === 0, erros);
  await ctx.close();
  srv.kill();
}

async function teclado(browser) {
  contexto = 'teclado';
  const ctx = await browser.newContext(TELAS.computador);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORTA_SITE}/index.html`);
  await esperaContagem(page, '64 registros');
  await page.keyboard.press('Tab');
  ok('primeiro Tab é o pular', await page.evaluate(() => document.activeElement.id === 'pular'));
  const contorno = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  ok('foco visível', contorno === 'solid', contorno);
  await page.keyboard.press('Enter');
  ok('pular leva ao conteúdo', await page.evaluate(() => document.activeElement.id === 'conteudo'));
  const vistos = [];
  for (let i = 0; i < 40 && !vistos.includes('aba:em_aberto'); i++) {
    await page.keyboard.press('Tab');
    vistos.push(await page.evaluate(() => { const a = document.activeElement; return a.classList.contains('aba') ? 'aba:' + a.dataset.situacao : a.id || a.tagName; }));
  }
  ok('Tab alcança filtros e abas', ['busca', 'cidade', 'idadeMin', 'dataAte', 'limpar', 'aba:em_aberto'].every((v) => vistos.includes(v)), vistos);
  await page.keyboard.press('Space');
  await esperaContagem(page, `${DADOS.filter((r) => r.situacao === 'em_aberto').length} registros`);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => !!document.activeElement.closest('#linhas'))) break;
  }
  ok('Tab chega à primeira ficha', await page.evaluate(() => !!document.activeElement.closest('#linhas')));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.getElementById('v-detalhe').hidden);
  ok('Enter abre a ficha', await page.evaluate(() => document.activeElement.id === 'ficha-nome'));
  await page.keyboard.press('Tab');
  ok('continua na tela certa', await page.evaluate(() => !!document.activeElement.closest('#v-detalhe')));
  await ctx.close();
}

async function paridade(browser) {
  contexto = 'paridade';
  const api = await ligarApi();
  const ctx = await browser.newContext(TELAS.computador);
  const buscas = ['', '?situacao=localizada', '?cidade=Serra+Modelo&ordenar=nome', '?idadeMin=30&idadeMax=45&ordenar=-idade', '?dataDe=2025-01-01&dataAte=2025-12-31&ordenar=data&pagina=2', '?busca=miragem&ordenar=-cidade', '?busca=ficticio&situacao=em_aberto&pagina=2'];
  async function ler(url) {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForFunction(() => /registro/i.test(document.getElementById('contagem').textContent) && !/Carregando/.test(document.getElementById('contagem').textContent));
    const r = {
      contagem: await page.locator('#contagem').textContent(),
      ids: await ids(page),
      abas: await page.locator('.aba b').allTextContents(),
      cidades: await page.locator('#por-cidade').textContent(),
      idades: await page.locator('#por-idade').textContent(),
    };
    await page.close();
    return r;
  }
  for (const b of buscas) {
    const estatico = await ler(`http://127.0.0.1:${PORTA_SITE}/index.html#/${b}`);
    const comApi = await ler(`http://127.0.0.1:${PORTA_SITE}/index.html?api=http://127.0.0.1:${PORTA_API}#/${b}`);
    ok('mesmos resultados nos dois modos: ' + (b || 'sem filtro'), JSON.stringify(estatico) === JSON.stringify(comApi), { estatico, comApi });
  }

  // Resiliência: API desligada e endereço de fora
  await desligar(api);
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${PORTA_SITE}/index.html?api=http://127.0.0.1:${PORTA_API}`);
  await p.waitForSelector('#erro-geral:not([hidden])');
  ok('API desligada mostra erro claro', (await p.locator('#erro-geral').textContent()).includes('Confira se o servidor Java está ligado'));
  await faixaOk(p, 'API desligada');
  await p.goto(`http://127.0.0.1:${PORTA_SITE}/index.html?api=https://externo.invalid`);
  await esperaContagem(p, '64 registros');
  ok('api= de fora é ignorado', (await p.locator('#modo-rodape').textContent()).includes('arquivo estático'));

  // Página antiga
  const q = await ctx.newPage();
  const erros = [];
  q.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  await q.goto(`http://127.0.0.1:${PORTA_SITE}/PoliciaIndex/lista.html`, { waitUntil: 'commit' });
  await q.waitForURL('**/index.html');
  await esperaContagem(q, '64 registros');
  ok('endereço antigo redireciona', true);
  ok('sem erro no redirecionamento', erros.length === 0, erros);
  await ctx.close();
}

function auditoria() {
  contexto = 'auditoria dos arquivos';
  const proibidos = [
    ['telefone do teste original', /\(6\x35\)|9974/],
    ['nome de órgão real', /seplag|pol[ií]cia (civil|militar|federal)|governo d|prefeitura|minist[eé]rio|secretaria d/i],
    ['travessão', new RegExp('[\\u2013\\u2014]')],
    ['recurso externo', /<script[^>]+src=["']https?:|<link[^>]+href=["']https?:|@import|url\(["']?https?:/i],
    ['innerHTML', /innerHTML|insertAdjacentHTML|document\.write|eval\(/],
  ];
  const arquivos = [];
  (function andar(d) {
    for (const n of fs.readdirSync(d)) {
      if (['.git', 'out', 'capturas'].includes(n)) continue;
      const c = path.join(d, n);
      if (fs.statSync(c).isDirectory()) andar(c);
      else arquivos.push(c);
    }
  })(RAIZ);
  ok('sem PNG, JPG ou GIF no projeto', !arquivos.filter((a) => a !== path.join('docs', 'tela.webp') && !a.includes('capturas')).some((a) => /\.(png|jpe?g|gif|webp)$/i.test(a)));
  for (const a of arquivos) {
    const t = fs.readFileSync(a, 'utf8');
    const rel = path.relative(RAIZ, a);
    for (const [nome, re] of proibidos) {
      if (rel === path.join('tests', 'e2e.js') && nome !== 'travessão') continue;
      ok(`${nome} fora de ${rel}`, !re.test(t));
    }
  }
  ok('README termina com a linha exata', fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8').trimEnd().endsWith('Desenvolvi este projeto e usei o Claude, da Anthropic, como ferramenta durante o desenvolvimento.'));
  const nomes = new Set(DADOS.map((r) => r.nome));
  ok('nomes únicos e obviamente fictícios', nomes.size === DADOS.length && DADOS.every((r) => /^(Fulan|Beltran|Sicran|Mengan|Zutan)/.test(r.nome)));
  ok('só adultos fictícios', DADOS.every((r) => r.idade >= 18));
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const site = spawn('python3', ['-m', 'http.server', String(PORTA_SITE), '--bind', '127.0.0.1'], { cwd: RAIZ, stdio: 'ignore' });
  let browser;
  try {
    await esperarPorta(PORTA_SITE);
    browser = await chromium.launch();
    auditoria();
    await paridade(browser);
    await subpasta(browser);
    await teclado(browser);
    for (const tela of Object.keys(TELAS)) {
      for (const modo of ['estatico', 'api']) await percorrer(browser, tela, modo);
    }
  } catch (e) {
    falhas.push(`[${contexto}] EXCEÇÃO: ${e.message.split('\n').slice(0, 4).join(' ')}`);
  } finally {
    if (browser) await browser.close();
    site.kill();
  }
  console.log(`Navegador: ${passou} verificações passaram, ${falhas.length} falharam.`);
  falhas.forEach((f) => console.log('FALHA ' + f.slice(0, 700)));
  process.exit(falhas.length ? 1 : 0);
})();
