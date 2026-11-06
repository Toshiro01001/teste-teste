# Fichário

Sistema de consulta e cadastro de registros, feito como demonstração técnica.

**Todas as pessoas e dados são fictícios.** Não é um serviço oficial, não tem ligação com nenhum órgão público e não recebe nem encaminha informações. Em caso real, procure a polícia.

## O que é

Uma tela de consulta com busca, filtros, ordenação, paginação, ficha individual, formulários com validação, exportação em CSV e contagens, ligada a uma API REST em Java puro. O tema é só um exemplo: a mesma estrutura serve para estoque, clientes, processos ou qualquer outro cadastro.

## Como funciona

O sistema tem dois modos, com a mesma tela:

| Modo | De onde vêm os dados | O que acontece no cadastro |
| --- | --- | --- |
| Estático (GitHub Pages) | `dados/registros.json` | Fica só na aba aberta. Nada sai do navegador. |
| API | Servidor Java em `servidor-java/` | Fica na memória do servidor até ele ser desligado. |

- `index.html` e `assets/` são a tela, sem etapa de build e sem nada carregado de terceiros.
- `assets/app.js` tem as duas fontes de dados com as mesmas funções, então o resto do código não sabe de qual está lendo.
- `servidor-java/src/fichario/` tem a API, com `Json` (leitor e escritor próprios), `Validacao` (regras de entrada), `Repositorio` (dados em memória) e `Api` (rotas HTTP).
- `servidor-java/sql/esquema.sql` documenta as tabelas para guardar tudo em banco. **O servidor desta demonstração não usa banco**, porque Java puro não traz driver e o projeto não baixa dependências. Para ligar um banco, troca-se o `Repositorio` por uma versão com JDBC.
- Os mesmos dados iniciais servem aos dois modos, e um teste confere que os resultados são iguais.

## Como rodar

### Só a tela (modo estático)

Precisa de um servidor local, porque o navegador bloqueia a leitura do JSON quando a página é aberta direto do disco:

```sh
python3 -m http.server 8000
```

Depois abra `http://localhost:8000/`.

### Com a API Java

Precisa do JDK 17 ou mais novo. Se faltar, no Ubuntu: `apt-get install -y default-jdk-headless`.

```sh
cd servidor-java
javac -encoding UTF-8 -d out src/fichario/*.java
java -cp out fichario.Servidor --porta 8080
```

Em outro terminal, na raiz do projeto, sirva a tela como acima e abra:

```
http://localhost:8000/?api=http://localhost:8080
```

O rodapé da tela mostra de onde os dados estão vindo.

### Apontar a tela para uma API publicada

O parâmetro `?api=` só aceita `localhost` e `127.0.0.1`, de propósito. Para um endereço definitivo:

1. Coloque o endereço em `assets/config.js`, no valor de `window.FICHARIO_API`.
2. Acrescente o mesmo endereço ao `connect-src` do `Content-Security-Policy`, no `index.html`.
3. Ligue o servidor autorizando a origem da tela, sem barra no fim: `java -cp out fichario.Servidor --host 0.0.0.0 --origem https://usuario.github.io`.

Numa publicação real, coloque a API atrás de HTTPS e acrescente login: esta demonstração não tem autenticação nenhuma.

## API

| Método e rota | O que faz |
| --- | --- |
| `GET /api/saude` | Confere se o servidor está de pé |
| `GET /api/registros` | Lista, com `busca`, `cidade`, `situacao`, `idadeMin`, `idadeMax`, `dataDe`, `dataAte`, `ordenar`, `pagina`, `tamanho` (até 100) |
| `GET /api/registros/{id}` | Uma ficha |
| `POST /api/registros` | Cria |
| `PUT /api/registros/{id}` | Atualiza |
| `DELETE /api/registros/{id}` | Apaga |
| `POST /api/registros/{id}/informacoes` | Guarda uma informação na memória |
| `GET /api/resumo` | Contagens por situação, cidade e faixa de idade, com os mesmos filtros da lista |

Exemplo:

```sh
curl 'http://localhost:8080/api/registros?cidade=Serra%20Modelo&ordenar=nome&pagina=1&tamanho=5'
```

Erros de entrada voltam com status 400 e o motivo por campo:

```json
{"erro":"Há campos inválidos.","campos":{"idade":"Informe um número inteiro de 18 a 110. Esta demonstração só usa adultos fictícios."}}
```

Outros status usados: 404 (não existe), 405 (método errado), 413 (corpo acima de 64 KB), 415 (corpo que não é JSON), 403 (origem não autorizada), 507 (limite de dados da demonstração).

## Testes

```sh
sh tests/rodar-tudo.sh
```

- `tests/java/`: testes da API sem biblioteca externa, com o servidor real numa porta livre, incluindo entradas inválidas.
- `tests/testar-sql.py`: executa o esquema em SQLite e confere restrições e consultas.
- `tests/e2e.js`: percorre os fluxos no Chromium com Playwright, em 1366x800, iPhone 13 e 320 px, nos dois modos.

## Tecnologias

HTML, CSS e JavaScript sem bibliotecas; Java 17 com `com.sun.net.httpserver`; SQL; Playwright e Python só nos testes.

---

Desenvolvido por Rodrigo Terroso Junior. O Claude, da Anthropic, foi usado como ferramenta durante o desenvolvimento.
