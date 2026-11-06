'use strict';
(function () {
  const POR_PAGINA = 10;
  const SITUACOES = { em_aberto: 'Em aberto', localizada: 'Localizada', encerrado: 'Encerrado' };
  const ABAS = [['', 'Todos'], ['em_aberto', 'Em aberto'], ['localizada', 'Localizadas'], ['encerrado', 'Encerrados']];
  const ORDENS = ['-data', 'data', 'nome', '-nome', 'idade', '-idade', 'cidade', '-cidade'];
  const $ = (id) => document.getElementById(id);

  // Todo dado variável entra como texto (textContent), nunca como HTML.
  function el(tag, attrs, ...filhos) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    filhos.forEach((f) => n.append(f));
    return n;
  }

  function avatar(id) {
    const ns = 'http://www.w3.org/2000/svg';
    const numero = parseInt(String(id).replace(/\D/g, ''), 10) || 0;
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('class', 'avatar t' + (numero % 4));
    svg.setAttribute('aria-hidden', 'true');
    const fundo = document.createElementNS(ns, 'circle');
    fundo.setAttribute('class', 'fundo');
    fundo.setAttribute('cx', '24'); fundo.setAttribute('cy', '24'); fundo.setAttribute('r', '24');
    const cabeca = document.createElementNS(ns, 'circle');
    cabeca.setAttribute('class', 'figura');
    cabeca.setAttribute('cx', '24'); cabeca.setAttribute('cy', '18'); cabeca.setAttribute('r', '8');
    const corpo = document.createElementNS(ns, 'path');
    corpo.setAttribute('class', 'figura');
    corpo.setAttribute('d', 'M9 43c0-10 6-15 15-15s15 5 15 15a24 24 0 0 1-30 0z');
    svg.append(fundo, cabeca, corpo);
    return svg;
  }

  const normalizar = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const tamanho = (s) => Array.from(s).length;
  const hoje = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const dataBr = (iso) => iso.split('-').reverse().join('/');
  const dataReal = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };
  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

  // Duas fontes de dados com a mesma forma. O resto do código não sabe de qual está lendo.
  function urlDaApi() {
    const param = new URLSearchParams(location.search).get('api');
    if (param) {
      try {
        const u = new URL(param);
        if (/^https?:$/.test(u.protocol) && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin;
      } catch (e) { /* endereço inválido: segue com o que está configurado */ }
    }
    return String(window.FICHARIO_API || '').replace(/\/+$/, '');
  }

  function fonteApi(base) {
    async function pedir(caminho, opcoes) {
      let r;
      try {
        r = await fetch(base + caminho, opcoes);
      } catch (e) {
        throw new Error('Não foi possível falar com a API em ' + base + '. Confira se o servidor Java está ligado.');
      }
      if (r.status === 204) return null;
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) {
        const erro = new Error(corpo.erro || 'A API respondeu com erro ' + r.status + '.');
        erro.status = r.status;
        erro.campos = corpo.campos;
        throw erro;
      }
      return corpo;
    }
    const json = (dados) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
    const query = (c) => {
      const q = new URLSearchParams();
      Object.entries(c).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) q.set(k, v); });
      return q.toString();
    };
    return {
      nome: 'API Java em ' + base,
      emApi: true,
      listar: (c) => pedir('/api/registros?' + query(c)),
      resumo: (c) => pedir('/api/resumo?' + query(c)),
      obter: (id) => pedir('/api/registros/' + encodeURIComponent(id)),
      criar: (dados) => pedir('/api/registros', json(dados)),
      informar: (id, dados) => pedir('/api/registros/' + encodeURIComponent(id) + '/informacoes', json(dados)),
    };
  }

  function fonteEstatica() {
    let registros = null;
    async function carregar() {
      if (registros) return registros;
      let r;
      try {
        r = await fetch('dados/registros.json');
        if (!r.ok) throw new Error();
        registros = await r.json();
      } catch (e) {
        throw new Error('Não foi possível ler dados/registros.json. Abra esta página por um servidor local, como explica o README.');
      }
      return registros;
    }
    function filtrar(lista, c) {
      const busca = c.busca ? normalizar(c.busca) : null;
      const cidade = c.cidade ? normalizar(c.cidade) : null;
      return lista.filter((r) => {
        if (busca && !normalizar(r.id + ' ' + r.nome + ' ' + r.cidade + ' ' + r.descricao).includes(busca)) return false;
        if (cidade && normalizar(r.cidade) !== cidade) return false;
        if (c.situacao && r.situacao !== c.situacao) return false;
        if (c.idadeMin !== '' && c.idadeMin !== undefined && r.idade < Number(c.idadeMin)) return false;
        if (c.idadeMax !== '' && c.idadeMax !== undefined && r.idade > Number(c.idadeMax)) return false;
        if (c.dataDe && r.data < c.dataDe) return false;
        if (c.dataAte && r.data > c.dataAte) return false;
        return true;
      });
    }
    const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    return {
      nome: 'arquivo estático dados/registros.json',
      emApi: false,
      async listar(c) {
        const achados = filtrar(await carregar(), c);
        const inverter = String(c.ordenar || '-data').startsWith('-');
        const campo = String(c.ordenar || '-data').replace('-', '');
        const chave = (r) => (campo === 'idade' ? r.idade : campo === 'data' ? r.data : normalizar(r[campo]));
        achados.sort((a, b) => (inverter ? -1 : 1) * comparar(chave(a), chave(b)) || comparar(a.id, b.id));
        const tam = Number(c.tamanho) || POR_PAGINA;
        const pagina = Number(c.pagina) || 1;
        return {
          itens: achados.slice((pagina - 1) * tam, pagina * tam),
          pagina, tamanho: tam, total: achados.length,
          totalPaginas: Math.ceil(achados.length / tam),
        };
      },
      async resumo(c) {
        const achados = filtrar(await carregar(), c);
        const r = {
          total: achados.length,
          porSituacao: { em_aberto: 0, localizada: 0, encerrado: 0 },
          porCidade: {},
          porFaixaDeIdade: { '18 a 29': 0, '30 a 44': 0, '45 a 59': 0, '60 ou mais': 0 },
        };
        const cidades = {};
        achados.forEach((x) => {
          r.porSituacao[x.situacao]++;
          cidades[x.cidade] = (cidades[x.cidade] || 0) + 1;
          r.porFaixaDeIdade[x.idade < 30 ? '18 a 29' : x.idade < 45 ? '30 a 44' : x.idade < 60 ? '45 a 59' : '60 ou mais']++;
        });
        Object.keys(cidades).sort((a, b) => comparar(normalizar(a), normalizar(b))).forEach((k) => { r.porCidade[k] = cidades[k]; });
        return r;
      },
      async obter(id) {
        const r = (await carregar()).find((x) => x.id === id);
        if (!r) { const e = new Error('Registro não encontrado.'); e.status = 404; throw e; }
        return r;
      },
      async criar(dados) {
        const lista = await carregar();
        const maior = lista.reduce((m, r) => Math.max(m, Number(r.id.slice(4))), 0);
        const novo = Object.assign({ id: 'REG-' + String(maior + 1).padStart(4, '0') }, dados);
        lista.push(novo);
        return novo;
      },
      async informar() { return null; },
    };
  }

  const baseApi = urlDaApi();
  const fonte = baseApi ? fonteApi(baseApi) : fonteEstatica();

  // Estado dos filtros: mora no endereço da página para que cada busca tenha link próprio.
  const FILTROS = ['busca', 'cidade', 'situacao', 'idadeMin', 'idadeMax', 'dataDe', 'dataAte', 'ordenar', 'pagina'];
  function lerConsulta(textoQuery) {
    const q = new URLSearchParams(textoQuery);
    const c = {};
    FILTROS.forEach((k) => { c[k] = (q.get(k) || '').slice(0, 80); });
    if (!SITUACOES[c.situacao]) c.situacao = '';
    if (!ORDENS.includes(c.ordenar)) c.ordenar = '-data';
    ['idadeMin', 'idadeMax'].forEach((k) => { if (!/^\d{1,3}$/.test(c[k]) || Number(c[k]) > 150) c[k] = ''; });
    ['dataDe', 'dataAte'].forEach((k) => { if (!dataReal(c[k])) c[k] = ''; });
    c.pagina = /^[1-9]\d{0,5}$/.test(c.pagina) ? Number(c.pagina) : 1;
    return c;
  }
  function hashDaConsulta(c) {
    const q = new URLSearchParams();
    FILTROS.forEach((k) => {
      if (!c[k]) return;
      if (k === 'ordenar' && c[k] === '-data') return;
      if (k === 'pagina' && c[k] === 1) return;
      q.set(k, c[k]);
    });
    const s = q.toString();
    return '#/' + (s ? '?' + s : '');
  }

  let consulta = lerConsulta('');
  let ultimaLista = '#/';
  let vez = 0;
  let cidadesCarregadas = false;

  function anunciar(texto) { $('anuncio').textContent = texto; }
  function mostrarErroGeral(texto) {
    $('erro-geral').textContent = texto;
    $('erro-geral').hidden = !texto;
  }

  function trocarTela(id, titulo, rota, focar) {
    ['v-lista', 'v-detalhe', 'v-novo', 'v-como', 'v-nao'].forEach((v) => { $(v).hidden = v !== id; });
    document.title = titulo + ', Fichário, sistema de demonstração';
    document.querySelectorAll('[data-rota]').forEach((a) => {
      if (a.dataset.rota === rota) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (focar) {
      window.scrollTo(0, 0);
      const h1 = $(id).querySelector('h1');
      if (h1) h1.focus({ preventScroll: true });
    }
  }

  // Consulta
  function criarAbas() {
    ABAS.forEach(([valor, rotulo]) => {
      const b = el('button', { type: 'button', class: 'aba' + (valor ? ' s-' + valor : ''), 'data-situacao': valor, 'aria-pressed': 'false' },
        el('b', {}, '0'), el('span', {}, rotulo));
      b.addEventListener('click', () => {
        consulta.situacao = valor;
        consulta.pagina = 1;
        aplicar(true);
      });
      $('abas').append(b);
    });
  }

  function preencherFormulario() {
    ['busca', 'idadeMin', 'idadeMax', 'dataDe', 'dataAte', 'cidade'].forEach((k) => { $(k).value = consulta[k]; });
    $('ordenar').value = consulta.ordenar;
    $('erro-filtros').hidden = true;
    ['idadeMin', 'idadeMax', 'dataDe', 'dataAte'].forEach((k) => $(k).removeAttribute('aria-invalid'));
    contarFiltros();
  }

  // Só conta: reescrever os campos aqui apagaria o que a pessoa digitou enquanto a resposta chegava.
  function contarFiltros() {
    const extras = ['cidade', 'idadeMin', 'idadeMax', 'dataDe', 'dataAte'].filter((k) => consulta[k]).length;
    $('qtd-filtros').textContent = extras ? '(' + plural(extras, 'ativo', 'ativos') + ')' : '';
  }

  function erroDosFiltros() {
    const min = $('idadeMin').value, max = $('idadeMax').value;
    const ruim = (n) => n !== '' && (!/^\d{1,3}$/.test(n) || Number(n) > 150);
    if (ruim(min) || ruim(max) || !$('idadeMin').validity.valid || !$('idadeMax').validity.valid) return 'Informe idades inteiras de 0 a 150.';
    if (min !== '' && max !== '' && Number(min) > Number(max)) return 'A idade final não pode ser menor que a inicial.';
    const de = $('dataDe').value, ate = $('dataAte').value;
    if (de && ate && de > ate) return 'A data final não pode vir antes da inicial.';
    return '';
  }

  function lerFiltrosDaTela() {
    const erro = erroDosFiltros();
    $('erro-filtros').textContent = erro;
    $('erro-filtros').hidden = !erro;
    ['idadeMin', 'idadeMax', 'dataDe', 'dataAte'].forEach((k) => {
      if (erro) $(k).setAttribute('aria-invalid', 'true');
      else $(k).removeAttribute('aria-invalid');
    });
    if (erro) return false;
    ['busca', 'cidade', 'idadeMin', 'idadeMax', 'dataDe', 'dataAte'].forEach((k) => { consulta[k] = $(k).value.trim(); });
    consulta.ordenar = $('ordenar').value;
    consulta.pagina = 1;
    return true;
  }

  function aplicar() {
    const h = hashDaConsulta(consulta);
    history.replaceState(null, '', location.pathname + location.search + h);
    ultimaLista = h;
    renderizarLista(false);
  }

  function linha(r) {
    const nome = el('a', { href: '#/registro/' + encodeURIComponent(r.id) }, r.nome);
    const pessoa = el('td', { role: 'cell', class: 'pessoa' },
      el('div', { class: 'pessoa-dentro' }, avatar(r.id), el('span', {}, nome, el('small', {}, r.id))));
    const situ = el('span', { class: 'situacao s-' + (SITUACOES[r.situacao] ? r.situacao : 'x') }, SITUACOES[r.situacao] || r.situacao);
    const celula = (rotulo, conteudo) => el('td', { role: 'cell', 'data-rotulo': rotulo }, conteudo);
    return el('tr', { role: 'row', class: 's-' + (SITUACOES[r.situacao] ? r.situacao : 'x') },
      pessoa,
      celula('Cidade', r.cidade),
      celula('Idade', r.idade + ' anos'),
      celula('Último registro', dataBr(r.data)),
      celula('Situação', situ));
  }

  function paginacao(pagina, totalPaginas) {
    const nav = $('paginas');
    nav.replaceChildren();
    nav.hidden = totalPaginas <= 1;
    if (totalPaginas <= 1) return;
    const ul = el('ul');
    const hrefDe = (p) => hashDaConsulta(Object.assign({}, consulta, { pagina: p }));
    const item = (conteudo) => ul.append(el('li', {}, conteudo));
    if (pagina > 1) item(el('a', { href: hrefDe(pagina - 1), 'data-paginar': '1' }, 'Anterior'));
    const visiveis = new Set([1, totalPaginas, pagina - 1, pagina, pagina + 1]);
    let anterior = 0;
    for (let p = 1; p <= totalPaginas; p++) {
      if (!visiveis.has(p)) continue;
      if (p - anterior > 1) item(el('span', { 'aria-hidden': 'true' }, '...'));
      const a = el('a', { href: hrefDe(p), 'data-paginar': '1', 'aria-label': 'Página ' + p }, String(p));
      if (p === pagina) a.setAttribute('aria-current', 'page');
      item(a);
      anterior = p;
    }
    if (pagina < totalPaginas) item(el('a', { href: hrefDe(pagina + 1), 'data-paginar': '1' }, 'Próxima'));
    nav.append(ul);
  }

  function medidas(ul, dados) {
    const maior = Math.max(1, ...Object.values(dados));
    ul.replaceChildren();
    Object.entries(dados).forEach(([nome, n]) => {
      const barra = el('span', {});
      barra.style.width = (n / maior) * 100 + '%';
      ul.append(el('li', {}, el('span', {}, nome), el('b', {}, String(n)), el('i', { 'aria-hidden': 'true' }, barra)));
    });
    if (!Object.keys(dados).length) ul.append(el('li', {}, 'Nenhum registro.'));
  }

  async function carregarCidades() {
    const r = await fonte.resumo({});
    const sel = $('cidade');
    const atual = consulta.cidade;
    while (sel.options.length > 1) sel.remove(1);
    Object.keys(r.porCidade).forEach((c) => sel.append(el('option', { value: c }, c)));
    if (atual && !Object.prototype.hasOwnProperty.call(r.porCidade, atual)) sel.append(el('option', { value: atual }, atual));
    sel.value = atual;
    cidadesCarregadas = true;
  }

  const paraApi = (c) => {
    const { pagina, ...resto } = c;
    return Object.assign(resto, { pagina, tamanho: POR_PAGINA });
  };
  const semOrdem = (c) => {
    const f = Object.assign({}, c);
    delete f.ordenar; delete f.pagina;
    return f;
  };

  async function renderizarLista(moverFoco) {
    const minhaVez = ++vez;
    mostrarErroGeral('');
    $('contagem').textContent = 'Carregando registros.';
    try {
      if (!cidadesCarregadas) await carregarCidades();
      const [pag, geral, semSituacao] = await Promise.all([
        fonte.listar(paraApi(consulta)),
        fonte.resumo(semOrdem(consulta)),
        fonte.resumo(semOrdem(Object.assign({}, consulta, { situacao: '' }))),
      ]);
      if (minhaVez !== vez) return;
      if (pag.total > 0 && consulta.pagina > pag.totalPaginas) {
        consulta.pagina = pag.totalPaginas;
        aplicar();
        return;
      }
      contarFiltros();
      $('linhas').replaceChildren(...pag.itens.map(linha));
      $('tabela').hidden = pag.total === 0;
      $('vazio').hidden = pag.total !== 0;
      $('exportar').disabled = pag.total === 0;
      paginacao(pag.pagina, pag.totalPaginas);
      $('contagem').textContent = pag.total
        ? plural(pag.total, 'registro encontrado', 'registros encontrados') + '. Página ' + pag.pagina + ' de ' + pag.totalPaginas + '.'
        : 'Nenhum registro encontrado.';

      document.querySelectorAll('.aba').forEach((b) => {
        const v = b.dataset.situacao;
        b.setAttribute('aria-pressed', String(consulta.situacao === v));
        const n = v ? semSituacao.porSituacao[v] : semSituacao.total;
        b.querySelector('b').textContent = String(n);
      });
      const prop = $('proporcao');
      prop.replaceChildren();
      Object.keys(SITUACOES).forEach((s) => {
        const parte = el('span', { class: 's-' + s });
        parte.style.flexGrow = String(semSituacao.porSituacao[s]);
        prop.append(parte);
      });
      medidas($('por-cidade'), geral.porCidade);
      medidas($('por-idade'), geral.porFaixaDeIdade);
      if (moverFoco) {
        $('titulo-resultados').focus({ preventScroll: true });
        $('titulo-resultados').scrollIntoView({ block: 'start' });
      }
    } catch (e) {
      if (minhaVez !== vez) return;
      $('contagem').textContent = '';
      mostrarErroGeral(e.message);
    }
  }

  function textoCsv(valor) {
    let s = String(valor);
    // Impede que a planilha interprete o texto como fórmula.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  async function exportar() {
    const botao = $('exportar');
    botao.disabled = true;
    try {
      const itens = [];
      let pagina = 1, totalPaginas = 1;
      do {
        const p = await fonte.listar(Object.assign({}, consulta, { pagina, tamanho: 100 }));
        itens.push(...p.itens);
        totalPaginas = p.totalPaginas;
        pagina++;
      } while (pagina <= totalPaginas);
      const colunas = ['id', 'nome', 'idade', 'cidade', 'situacao', 'data', 'descricao'];
      const titulos = ['Registro', 'Nome (fictício)', 'Idade', 'Cidade', 'Situação', 'Último registro', 'Descrição'];
      const linhas = [titulos.map(textoCsv).join(';')];
      itens.forEach((r) => linhas.push(colunas.map((c) => textoCsv(c === 'situacao' ? SITUACOES[r[c]] || r[c] : c === 'data' ? dataBr(r[c]) : r[c])).join(';')));
      // O BOM faz o Excel reconhecer os acentos; o ponto e vírgula é o separador do Excel em português.
      const blob = new Blob(['﻿' + linhas.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'registros-ficticios-demonstracao.csv' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      anunciar('Arquivo CSV gerado com ' + plural(itens.length, 'registro', 'registros') + '.');
    } catch (e) {
      mostrarErroGeral(e.message);
    } finally {
      botao.disabled = false;
    }
  }

  // Formulários: mesmas regras do servidor, para o erro aparecer antes de qualquer envio.
  const REGRA_TEXTO = (min, max) => (v) => {
    const n = tamanho(v.trim());
    return n >= min && n <= max ? '' : 'Use de ' + min + ' a ' + max + ' caracteres.';
  };
  const REGRA_DATA = (v) => {
    if (!dataReal(v)) return 'Informe uma data real.';
    return v > hoje() ? 'A data não pode estar no futuro.' : '';
  };
  const REGRAS_INFO = {
    local: { rotulo: 'Onde foi', teste: REGRA_TEXTO(2, 80) },
    data: { rotulo: 'Quando foi', teste: REGRA_DATA },
    relato: { rotulo: 'O que foi visto', teste: REGRA_TEXTO(10, 600) },
    contato: { rotulo: 'E-mail', teste: (v) => (!v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Informe um e-mail válido ou deixe em branco.') },
    ciente: { rotulo: 'Confirmação', teste: (v, c) => (c.checked ? '' : 'Marque para confirmar que entendeu.') },
  };
  const REGRAS_NOVO = {
    nome: { rotulo: 'Nome', teste: REGRA_TEXTO(3, 80) },
    idade: { rotulo: 'Idade', teste: (v) => (/^\d{1,3}$/.test(v) && Number(v) >= 18 && Number(v) <= 110 ? '' : 'Informe de 18 a 110. Esta demonstração só usa adultos fictícios.') },
    situacao: { rotulo: 'Situação', teste: (v) => (SITUACOES[v] ? '' : 'Escolha uma situação.') },
    cidade: { rotulo: 'Cidade', teste: REGRA_TEXTO(2, 60) },
    data: { rotulo: 'Data', teste: REGRA_DATA },
    descricao: { rotulo: 'Descrição', teste: REGRA_TEXTO(10, 600) },
  };

  function limparErros(form) {
    Array.from(form.elements).forEach((c) => {
      c.removeAttribute('aria-invalid');
      const p = c.id && $(c.id + '-erro');
      if (p) { p.textContent = ''; p.hidden = true; }
    });
    const resumo = $(form.id + '-erros');
    resumo.replaceChildren();
    resumo.hidden = true;
  }

  function mostrarErros(form, regras, erros) {
    const resumo = $(form.id + '-erros');
    const lista = el('ul');
    Object.entries(erros).forEach(([campo, msg]) => {
      const c = form.elements[campo];
      if (c) {
        c.setAttribute('aria-invalid', 'true');
        const p = $(c.id + '-erro');
        p.textContent = msg;
        p.hidden = false;
      }
      const rotulo = regras[campo] ? regras[campo].rotulo : campo;
      const item = el('a', { href: '#', 'data-campo': c ? c.id : '' }, rotulo + ': ' + msg);
      lista.append(el('li', {}, item));
    });
    resumo.replaceChildren(el('strong', {}, 'Corrija antes de continuar:'), lista);
    resumo.hidden = false;
    resumo.focus();
  }

  function validar(form, regras) {
    const erros = {};
    Object.entries(regras).forEach(([campo, regra]) => {
      const c = form.elements[campo];
      const msg = regra.teste(c.value, c);
      if (msg) erros[campo] = msg;
    });
    return erros;
  }

  function dadosDe(form, regras) {
    const d = {};
    Object.keys(regras).forEach((k) => { if (k !== 'ciente') d[k] = form.elements[k].value.trim(); });
    return d;
  }

  function ligarFormulario(form, regras, enviar) {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      limparErros(form);
      const erros = validar(form, regras);
      if (Object.keys(erros).length) { mostrarErros(form, regras, erros); return; }
      const botao = form.querySelector('[type=submit]');
      botao.disabled = true;
      try {
        await enviar(dadosDe(form, regras));
      } catch (e) {
        mostrarErros(form, regras, e.campos || { servidor: e.message });
      } finally {
        botao.disabled = false;
      }
    });
    $(form.id + '-erros').addEventListener('click', (ev) => {
      const a = ev.target.closest('a');
      if (!a) return;
      ev.preventDefault();
      const c = a.dataset.campo && $(a.dataset.campo);
      if (c) c.focus();
    });
  }

  function mostrarConfirmacao(form, ok) {
    form.hidden = true;
    ok.hidden = false;
    ok.focus();
  }
  function reabrirFormulario(form, ok) {
    form.reset();
    limparErros(form);
    ok.hidden = true;
    form.hidden = false;
    form.elements[0].focus();
  }

  // Detalhe
  let idAtual = null;
  async function renderizarDetalhe(id) {
    const minhaVez = ++vez;
    mostrarErroGeral('');
    try {
      const r = await fonte.obter(id);
      if (minhaVez !== vez) return;
      idAtual = r.id;
      const classe = SITUACOES[r.situacao] ? 's-' + r.situacao : 's-x';
      $('ficha').className = 'ficha ' + classe;
      $('ficha-avatar').replaceChildren(avatar(r.id));
      $('ficha-nome').textContent = r.nome;
      $('ficha-situacao').className = 'situacao ' + classe;
      $('ficha-situacao').textContent = SITUACOES[r.situacao] || r.situacao;
      const dl = $('ficha-dados');
      dl.replaceChildren();
      [['Registro', r.id], ['Idade', r.idade + ' anos'], ['Cidade', r.cidade], ['Último registro', dataBr(r.data)]].forEach(([k, v]) => {
        dl.append(el('div', {}, el('dt', {}, k), el('dd', {}, v)));
      });
      $('ficha-descricao').textContent = r.descricao;
      $('voltar').setAttribute('href', ultimaLista);
      $('f-info').hidden = false;
      $('f-info-ok').hidden = true;
      $('f-info').reset();
      limparErros($('f-info'));
      trocarTela('v-detalhe', r.nome, 'lista', true);
    } catch (e) {
      if (minhaVez !== vez) return;
      if (e.status === 404) {
        $('nao-texto').textContent = 'Não existe registro com o número ' + id + '.';
        trocarTela('v-nao', 'Registro não encontrado', '', true);
      } else {
        trocarTela('v-nao', 'Erro', '', true);
        $('nao-texto').textContent = '';
        mostrarErroGeral(e.message);
      }
    }
  }

  // Rotas por hash
  function rotear(inicial) {
    const h = location.hash || '#/';
    const [caminho, query] = h.slice(1).split('?');
    mostrarErroGeral('');
    let m;
    if (caminho === '/' || caminho === '') {
      consulta = lerConsulta(query || '');
      ultimaLista = hashDaConsulta(consulta);
      preencherFormulario();
      const veioDaPaginacao = rotear.paginando;
      rotear.paginando = false;
      const jaNaLista = !$('v-lista').hidden;
      trocarTela('v-lista', 'Consulta de registros', 'lista', !inicial && !jaNaLista);
      renderizarLista(veioDaPaginacao);
    } else if ((m = caminho.match(/^\/registro\/([A-Za-z0-9-]{1,20})$/))) {
      renderizarDetalhe(decodeURIComponent(m[1]));
    } else if (caminho === '/novo') {
      vez++;
      trocarTela('v-novo', 'Novo registro', 'novo', !inicial);
    } else if (caminho === '/como-funciona') {
      vez++;
      trocarTela('v-como', 'Como isto funciona', 'como', !inicial);
    } else {
      vez++;
      $('nao-texto').textContent = 'Este endereço não leva a nenhuma tela do sistema.';
      trocarTela('v-nao', 'Página não encontrada', '', !inicial);
    }
  }

  function iniciar() {
    criarAbas();
    $('pular').addEventListener('click', (ev) => {
      ev.preventDefault();
      $('conteudo').focus();
      $('conteudo').scrollIntoView();
    });
    const nomeModo = fonte.nome;
    $('modo-rodape').textContent = nomeModo;
    $('modo-como').textContent = nomeModo;
    $('nota-informacao').textContent = fonte.emApi
      ? 'Nada vai para ninguém. O teste de envio chega só ao servidor local desta demonstração e fica na memória dele até ser desligado.'
      : 'Nada é enviado de verdade. O formulário só confere o preenchimento, e o que você digitar não sai deste navegador.';
    $('nota-novo').textContent = fonte.emApi
      ? 'O registro vai para o servidor local desta demonstração e fica na memória dele até ser desligado.'
      : 'Nada é enviado de verdade. O registro fica só nesta aba e desaparece quando você recarregar a página.';
    ['i-data', 'n-data', 'dataDe', 'dataAte'].forEach((id) => $(id).setAttribute('max', hoje()));

    const larga = window.matchMedia('(min-width: 60rem)');
    const ajustarFiltros = () => { $('mais-filtros').open = larga.matches; };
    ajustarFiltros();
    larga.addEventListener('change', ajustarFiltros);

    let espera = null;
    $('busca').addEventListener('input', () => {
      clearTimeout(espera);
      espera = setTimeout(() => { if (lerFiltrosDaTela()) aplicar(); }, 250);
    });
    ['cidade', 'idadeMin', 'idadeMax', 'dataDe', 'dataAte', 'ordenar'].forEach((k) => {
      $(k).addEventListener('change', () => { if (lerFiltrosDaTela()) aplicar(); });
    });
    $('f-filtros').addEventListener('submit', (ev) => {
      ev.preventDefault();
      clearTimeout(espera);
      if (lerFiltrosDaTela()) aplicar();
    });
    const limpar = () => {
      clearTimeout(espera);
      ['busca', 'cidade', 'idadeMin', 'idadeMax', 'dataDe', 'dataAte'].forEach((k) => { $(k).value = ''; });
      lerFiltrosDaTela();
      consulta.situacao = '';
      aplicar();
      anunciar('Filtros limpos.');
    };
    $('limpar').addEventListener('click', limpar);
    $('limpar-vazio').addEventListener('click', () => { limpar(); $('busca').focus(); });
    $('exportar').addEventListener('click', exportar);
    $('paginas').addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-paginar]');
      if (a && a.getAttribute('href') !== location.hash) rotear.paginando = true;
    });

    ligarFormulario($('f-info'), REGRAS_INFO, async (dados) => {
      await fonte.informar(idAtual, dados);
      $('f-info-ok-texto').textContent = fonte.emApi
        ? 'Teste concluído. A informação chegou ao servidor local desta demonstração e fica só na memória dele. Ninguém a recebe.'
        : 'Teste concluído. Nada foi enviado: a informação não saiu deste navegador e ninguém a recebeu.';
      mostrarConfirmacao($('f-info'), $('f-info-ok'));
    });
    $('f-info-nova').addEventListener('click', () => reabrirFormulario($('f-info'), $('f-info-ok')));

    ligarFormulario($('f-novo'), REGRAS_NOVO, async (dados) => {
      const novo = await fonte.criar(Object.assign(dados, { idade: Number(dados.idade) }));
      cidadesCarregadas = false;
      $('f-novo-ok-texto').textContent = 'Registro ' + novo.id + ' cadastrado. ' + (fonte.emApi
        ? 'Ele fica na memória do servidor local até ser desligado.'
        : 'Ele fica só nesta aba e desaparece quando você recarregar a página.');
      $('f-novo-link').setAttribute('href', '#/registro/' + encodeURIComponent(novo.id));
      mostrarConfirmacao($('f-novo'), $('f-novo-ok'));
    });
    $('f-novo-nova').addEventListener('click', () => reabrirFormulario($('f-novo'), $('f-novo-ok')));

    window.addEventListener('hashchange', () => rotear(false));
    rotear(true);
  }

  iniciar();
})();
