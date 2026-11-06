-- Esquema do Fichário, para quando os dados saírem da memória e forem para um banco.
-- O servidor desta demonstração NÃO usa este arquivo: Java puro não traz driver de banco
-- e o projeto não baixa dependências. Quem quiser ligar um banco troca a classe
-- Repositorio.java por uma versão com JDBC e usa as consultas do fim deste arquivo.
-- SQL padrão: executado de verdade em SQLite pelo teste tests/testar-sql.py.

-- Uma ficha do cadastro. Os CHECK repetem as regras de Validacao.java, para que o banco
-- recuse dado ruim mesmo se ele chegar por outro caminho que não a API.
CREATE TABLE registro (
    id          VARCHAR(13)  PRIMARY KEY,                -- exemplo: REG-0001
    nome        VARCHAR(80)  NOT NULL,
    idade       INTEGER      NOT NULL CHECK (idade BETWEEN 18 AND 110),
    cidade      VARCHAR(60)  NOT NULL,
    situacao    VARCHAR(12)  NOT NULL CHECK (situacao IN ('em_aberto', 'localizada', 'encerrado')),
    data        DATE         NOT NULL,                   -- data do último registro
    descricao   VARCHAR(600) NOT NULL
);

-- Índices para os filtros mais usados na tela de consulta.
CREATE INDEX idx_registro_cidade   ON registro (cidade);
CREATE INDEX idx_registro_situacao ON registro (situacao);
CREATE INDEX idx_registro_data     ON registro (data);
CREATE INDEX idx_registro_idade    ON registro (idade);

-- Uma informação enviada sobre uma ficha. Uma ficha pode ter várias.
-- Ao apagar a ficha, as informações dela são apagadas junto (ON DELETE CASCADE).
CREATE TABLE informacao (
    id           INTEGER      PRIMARY KEY,
    registro_id  VARCHAR(13)  NOT NULL REFERENCES registro (id) ON DELETE CASCADE,
    local        VARCHAR(80)  NOT NULL,
    data         DATE         NOT NULL,
    relato       VARCHAR(600) NOT NULL,
    contato      VARCHAR(120)                            -- opcional
);

CREATE INDEX idx_informacao_registro ON informacao (registro_id);

-- Consultas equivalentes às rotas da API. Os ? são parâmetros: o valor vai separado do
-- comando, o que impede injeção de SQL. Nunca monte SQL juntando texto vindo do usuário.

-- GET /api/registros?cidade=&situacao=&idadeMin=&idadeMax=&dataDe=&dataAte=&ordenar=-data&pagina=&tamanho=
-- SELECT id, nome, idade, cidade, situacao, data, descricao
--   FROM registro
--  WHERE (? IS NULL OR cidade = ?)
--    AND (? IS NULL OR situacao = ?)
--    AND (? IS NULL OR idade >= ?)
--    AND (? IS NULL OR idade <= ?)
--    AND (? IS NULL OR data >= ?)
--    AND (? IS NULL OR data <= ?)
--  ORDER BY data DESC, id ASC
--  LIMIT ? OFFSET ?;   -- LIMIT = tamanho, OFFSET = (pagina - 1) * tamanho

-- GET /api/resumo (contagem por situação)
-- SELECT situacao, COUNT(*) FROM registro GROUP BY situacao;
