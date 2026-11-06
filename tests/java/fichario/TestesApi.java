package fichario;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Testes sem biblioteca externa: sobe o servidor de verdade numa porta livre e faz pedidos HTTP. */
public final class TestesApi {
    private static int passou = 0;
    private static int falhou = 0;
    private static String base;
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    private static void checar(String nome, boolean ok) {
        if (ok) passou++;
        else falhou++;
        if (!ok) System.out.println("FALHA " + nome);
    }

    private static HttpResponse<String> pedir(String metodo, String caminho, String corpo, String tipo) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + caminho));
        if (tipo != null) b.header("Content-Type", tipo);
        b.method(metodo, corpo == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(corpo));
        return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    private static HttpResponse<String> get(String caminho) throws Exception { return pedir("GET", caminho, null, null); }

    private static HttpResponse<String> post(String caminho, String corpo) throws Exception {
        return pedir("POST", caminho, corpo, "application/json");
    }

    /** O HttpClient do Java não deixa definir Origin; aqui o pedido vai por socket, como um navegador faria. */
    private static String comOrigem(String metodo, String caminho, String origem) throws Exception {
        URI u = URI.create(base);
        try (java.net.Socket s = new java.net.Socket(u.getHost(), u.getPort())) {
            String pedido = metodo + " " + caminho + " HTTP/1.1\r\nHost: localhost\r\nOrigin: " + origem
                    + "\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}";
            s.getOutputStream().write(pedido.getBytes(StandardCharsets.UTF_8));
            s.getOutputStream().flush();
            return new String(s.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapa(HttpResponse<String> r) { return (Map<String, Object>) Json.ler(r.body()); }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> itens(HttpResponse<String> r) { return (List<Map<String, Object>>) mapa(r).get("itens"); }

    private static long numero(Map<String, Object> m, String c) { return (Long) m.get(c); }

    private static String ficha(String nome, Object idade, String situacao, String data) {
        return Json.escrever(new java.util.LinkedHashMap<>(Map.of("nome", nome, "idade", idade, "cidade", "Vila Exemplo",
                "situacao", situacao, "data", data, "descricao", "Personagem fictício de teste.")));
    }

    public static void main(String[] args) throws Exception {
        testarJson();
        Path dados = Path.of(args.length > 0 ? args[0] : "dados/registros.json");
        Servidor s = new Servidor("127.0.0.1", 0, Servidor.carregar(dados), Set.of("https://exemplo.invalid"));
        s.ligar();
        base = "http://127.0.0.1:" + s.porta();
        try {
            testarConsulta();
            testarConsultaInvalida();
            testarCadastro();
            testarCadastroInvalido();
            testarInformacao();
            testarProtocolo();
            testarConcorrencia();
        } finally {
            s.desligar();
        }
        System.out.println("Java: " + passou + " verificações passaram, " + falhou + " falharam.");
        if (falhou > 0) System.exit(1);
    }

    private static void testarJson() {
        Object v = Json.ler(" {\"a\": [1, 2.5, true, null, \"x\\n\\u00e7\"], \"b\": {}} ");
        checar("json lê estrutura", v instanceof Map<?, ?> m && m.get("a") instanceof List<?> l && l.size() == 5 && "x\nç".equals(l.get(4)));
        checar("json ida e volta", Json.ler(Json.escrever(v)).equals(v));
        checar("json escapa aspas e barra", Json.escrever("a\"b\\c").equals("\"a\\\"b\\\\c\""));
        for (String ruim : List.of("", "{", "[1,", "{\"a\":}", "{a:1}", "01", "1 2", "tru", "\"sem fim", "\"\\x\"", "\"\\u12\"", "[1,]", "{\"a\":1,}", "NaN", "--1", "\"a\nb\"")) {
            boolean recusou = false;
            try { Json.ler(ruim); } catch (Json.ErroJson e) { recusou = true; }
            checar("json recusa: " + ruim, recusou);
        }
        boolean recusou = false;
        try { Json.ler("[".repeat(100) + "]".repeat(100)); } catch (Json.ErroJson e) { recusou = true; }
        checar("json recusa aninhamento excessivo", recusou);
    }

    private static void testarConsulta() throws Exception {
        HttpResponse<String> r = get("/api/registros");
        checar("lista responde 200", r.statusCode() == 200);
        checar("lista é JSON em UTF-8", r.headers().firstValue("Content-Type").orElse("").equals("application/json; charset=utf-8"));
        checar("lista traz nosniff", r.headers().firstValue("X-Content-Type-Options").orElse("").equals("nosniff"));
        Map<String, Object> m = mapa(r);
        long total = numero(m, "total");
        checar("total inicial é 64", total == 64);
        checar("tamanho padrão é 10", itens(r).size() == 10 && numero(m, "tamanho") == 10);
        checar("7 páginas", numero(m, "totalPaginas") == 7);

        Set<Object> ids = new HashSet<>();
        for (int p = 1; p <= 7; p++) for (Map<String, Object> i : itens(get("/api/registros?pagina=" + p))) ids.add(i.get("id"));
        checar("páginas somam tudo sem repetir", ids.size() == total);
        checar("página além do fim vem vazia", itens(get("/api/registros?pagina=99")).isEmpty());
        checar("tamanho 100 aceito", itens(get("/api/registros?tamanho=100")).size() == 64);

        List<Map<String, Object>> f = itens(get("/api/registros?tamanho=100&cidade=Vila%20Exemplo&situacao=em_aberto&idadeMin=30&idadeMax=60&dataDe=2025-01-01&dataAte=2026-12-31"));
        boolean bate = !f.isEmpty();
        for (Map<String, Object> i : f) {
            long idade = numero(i, "idade");
            String data = (String) i.get("data");
            bate &= "Vila Exemplo".equals(i.get("cidade")) && "em_aberto".equals(i.get("situacao")) && idade >= 30 && idade <= 60 && data.compareTo("2025-01-01") >= 0;
        }
        checar("filtros combinados funcionam", bate);
        checar("busca ignora acentos e caixa", numero(mapa(get("/api/registros?busca=FICCAO")), "total") > 0);
        checar("cidade ignora acentos", numero(mapa(get("/api/registros?cidade=porto%20ficticio")), "total") > 0);
        checar("sem resultado devolve zero", numero(mapa(get("/api/registros?busca=naoexiste123")), "total") == 0);

        List<Map<String, Object>> o = itens(get("/api/registros?tamanho=100&ordenar=idade"));
        boolean crescente = true;
        for (int i = 1; i < o.size(); i++) crescente &= numero(o.get(i - 1), "idade") <= numero(o.get(i), "idade");
        checar("ordena por idade", crescente);
        o = itens(get("/api/registros?tamanho=100"));
        boolean decrescente = true;
        for (int i = 1; i < o.size(); i++) decrescente &= ((String) o.get(i - 1).get("data")).compareTo((String) o.get(i).get("data")) >= 0;
        checar("padrão é data mais recente primeiro", decrescente);

        Map<String, Object> resumo = mapa(get("/api/resumo"));
        long soma = 0;
        for (Object n : ((Map<?, ?>) resumo.get("porSituacao")).values()) soma += (Long) n;
        checar("resumo por situação soma o total", soma == numero(resumo, "total"));
        soma = 0;
        for (Object n : ((Map<?, ?>) resumo.get("porCidade")).values()) soma += (Long) n;
        checar("resumo por cidade soma o total", soma == numero(resumo, "total"));
        soma = 0;
        for (Object n : ((Map<?, ?>) resumo.get("porFaixaDeIdade")).values()) soma += (Long) n;
        checar("resumo por idade soma o total", soma == numero(resumo, "total"));
        checar("resumo respeita filtro", numero(mapa(get("/api/resumo?situacao=encerrado")), "total") == ((Long) ((Map<?, ?>) resumo.get("porSituacao")).get("encerrado")));
        checar("detalhe responde", get("/api/registros/REG-0001").statusCode() == 200);
        checar("detalhe inexistente é 404", get("/api/registros/REG-9999").statusCode() == 404);
        checar("saúde responde", get("/api/saude").statusCode() == 200);
    }

    private static void testarConsultaInvalida() throws Exception {
        Map<String, String> casos = Map.ofEntries(
                Map.entry("pagina=0", "pagina"), Map.entry("pagina=abc", "pagina"), Map.entry("pagina=-1", "pagina"),
                Map.entry("tamanho=0", "tamanho"), Map.entry("tamanho=101", "tamanho"),
                Map.entry("situacao=xpto", "situacao"), Map.entry("ordenar=senha", "ordenar"),
                Map.entry("idadeMin=abc", "idadeMin"), Map.entry("idadeMin=60&idadeMax=30", "idadeMax"),
                Map.entry("dataDe=2026-02-30", "dataDe"), Map.entry("dataDe=ontem", "dataDe"),
                Map.entry("dataDe=2026-01-02&dataAte=2026-01-01", "dataAte"),
                Map.entry("pagina=99999999999", "pagina"), Map.entry("busca=" + "x".repeat(81), "busca"));
        for (Map.Entry<String, String> c : casos.entrySet()) {
            HttpResponse<String> r = get("/api/registros?" + c.getKey());
            checar("consulta inválida dá 400: " + c.getKey(), r.statusCode() == 400 && ((Map<?, ?>) mapa(r).get("campos")).containsKey(c.getValue()));
        }
        checar("percentual malformado dá 400", comOrigem("GET", "/api/registros?busca=%zz", "http://localhost").startsWith("HTTP/1.1 400"));
        checar("resumo também valida", get("/api/resumo?situacao=xpto").statusCode() == 400);
        checar("injeção de SQL é só texto", numero(mapa(get("/api/registros?busca=%27%20OR%201%3D1%20--")), "total") == 0);
    }

    private static void testarCadastro() throws Exception {
        HttpResponse<String> r = post("/api/registros", ficha("Fulano Teste Acentuação", 40L, "em_aberto", "2025-05-05"));
        checar("cria com 201", r.statusCode() == 201);
        String id = (String) mapa(r).get("id");
        checar("id novo segue a sequência", "REG-0065".equals(id));
        checar("devolve Location", r.headers().firstValue("Location").orElse("").equals("/api/registros/" + id));
        checar("acentos sobrevivem", "Fulano Teste Acentuação".equals(mapa(get("/api/registros/" + id)).get("nome")));
        checar("total sobe", numero(mapa(get("/api/registros")), "total") == 65);

        String xss = "<script>alert(1)</script>";
        r = post("/api/registros", ficha(xss, 30L, "localizada", "2025-01-01"));
        checar("marcação fica como texto", r.statusCode() == 201 && xss.equals(mapa(r).get("nome")));
        String xssId = (String) mapa(r).get("id");

        r = pedir("PUT", "/api/registros/" + id, ficha("Fulano Teste Editado", 41L, "localizada", "2025-05-06"), "application/json");
        checar("atualiza", r.statusCode() == 200 && "Fulano Teste Editado".equals(mapa(get("/api/registros/" + id)).get("nome")));
        checar("PUT inexistente é 404", pedir("PUT", "/api/registros/REG-9999", ficha("Fulano", 41L, "localizada", "2025-05-06"), "application/json").statusCode() == 404);
        checar("apaga com 204", pedir("DELETE", "/api/registros/" + id, null, null).statusCode() == 204);
        checar("apagado some", get("/api/registros/" + id).statusCode() == 404);
        checar("apagar de novo é 404", pedir("DELETE", "/api/registros/" + id, null, null).statusCode() == 404);
        pedir("DELETE", "/api/registros/" + xssId, null, null);
    }

    private static void testarCadastroInvalido() throws Exception {
        String amanha = LocalDate.now().plusDays(1).toString();
        Map<String, String> casos = Map.ofEntries(
                Map.entry("nome", ficha("Jo", 30L, "em_aberto", "2025-01-01")),
                Map.entry("idade", ficha("Fulano", 17L, "em_aberto", "2025-01-01")),
                Map.entry("situacao", ficha("Fulano", 30L, "sumido", "2025-01-01")),
                Map.entry("data", ficha("Fulano", 30L, "em_aberto", amanha)));
        for (Map.Entry<String, String> c : casos.entrySet()) {
            HttpResponse<String> r = post("/api/registros", c.getValue());
            checar("cadastro inválido: " + c.getKey(), r.statusCode() == 400 && ((Map<?, ?>) mapa(r).get("campos")).containsKey(c.getKey()));
        }
        HttpResponse<String> r = post("/api/registros", ficha("Fulano", "trinta", "em_aberto", "2025-13-40"));
        Map<?, ?> campos = (Map<?, ?>) mapa(r).get("campos");
        checar("informa todos os erros juntos", r.statusCode() == 400 && campos.containsKey("idade") && campos.containsKey("data"));
        checar("idade decimal recusada", post("/api/registros", ficha("Fulano", 30.5, "em_aberto", "2025-01-01")).statusCode() == 400);
        checar("objeto vazio recusado", ((Map<?, ?>) mapa(post("/api/registros", "{}")).get("campos")).size() == 6);
        checar("lista no lugar de objeto", post("/api/registros", "[]").statusCode() == 400);
        checar("texto no lugar de objeto", post("/api/registros", "\"oi\"").statusCode() == 400);
        checar("JSON quebrado", post("/api/registros", "{\"nome\":").statusCode() == 400);
        checar("corpo vazio", post("/api/registros", "").statusCode() == 400);
        checar("nome com controle recusado", post("/api/registros", ficha("Ful\u0007ano", 30L, "em_aberto", "2025-01-01")).statusCode() == 400);
        checar("corpo gigante é 413", post("/api/registros", "{\"nome\":\"" + "x".repeat(70_000) + "\"}").statusCode() == 413);
        checar("sem Content-Type é 415", pedir("POST", "/api/registros", "{}", null).statusCode() == 415);
        checar("tipo errado é 415", pedir("POST", "/api/registros", "{}", "text/plain").statusCode() == 415);
        checar("erros não mudaram o total", numero(mapa(get("/api/registros")), "total") == 64);
    }

    private static void testarInformacao() throws Exception {
        String boa = "{\"local\":\"Praça Fictícia\",\"data\":\"2025-02-02\",\"relato\":\"Relato inventado para o teste.\",\"contato\":\"pessoa@exemplo.invalid\"}";
        HttpResponse<String> r = post("/api/registros/REG-0001/informacoes", boa);
        checar("informação aceita com 201", r.statusCode() == 201);
        checar("resposta avisa que fica na memória", String.valueOf(mapa(r).get("aviso")).contains("memória"));
        checar("informação sem ficha é 404", post("/api/registros/REG-9999/informacoes", boa).statusCode() == 404);
        checar("sem contato é aceito", post("/api/registros/REG-0001/informacoes", "{\"local\":\"Praça\",\"data\":\"2025-02-02\",\"relato\":\"Relato inventado para o teste.\"}").statusCode() == 201);
        r = post("/api/registros/REG-0001/informacoes", "{\"local\":\"P\",\"data\":\"x\",\"relato\":\"curto\",\"contato\":\"sem-arroba\"}");
        checar("informação inválida lista 4 campos", r.statusCode() == 400 && ((Map<?, ?>) mapa(r).get("campos")).size() == 4);
    }

    private static void testarProtocolo() throws Exception {
        checar("rota desconhecida é 404", get("/nada").statusCode() == 404);
        checar("travessia de pasta é 404", get("/api/../../etc/passwd").statusCode() == 404);
        checar("id malformado é 404", get("/api/registros/abc").statusCode() == 404);
        HttpResponse<String> r = pedir("PATCH", "/api/registros", "{}", "application/json");
        checar("método errado é 405 com Allow", r.statusCode() == 405 && r.headers().firstValue("Allow").isPresent());
        checar("DELETE na lista é 405", pedir("DELETE", "/api/registros", null, null).statusCode() == 405);

        String local = comOrigem("OPTIONS", "/api/registros", "http://localhost:5173");
        checar("preflight local liberado", local.startsWith("HTTP/1.1 204") && local.contains("http://localhost:5173"));
        String extra = comOrigem("OPTIONS", "/api/registros", "https://exemplo.invalid");
        checar("preflight de origem configurada", extra.startsWith("HTTP/1.1 204"));
        String estranha = comOrigem("OPTIONS", "/api/registros", "https://site-qualquer.invalid");
        checar("preflight de outra origem é 403", estranha.startsWith("HTTP/1.1 403") && !estranha.contains("Access-Control-Allow-Origin"));
        String post = comOrigem("POST", "/api/registros", "https://site-qualquer.invalid");
        checar("POST de outra origem é 403", post.startsWith("HTTP/1.1 403"));
        String imita = comOrigem("GET", "/api/saude", "http://localhost.site-qualquer.invalid");
        checar("origem parecida com localhost não recebe CORS", !imita.contains("Access-Control-Allow-Origin"));
    }

    private static void testarConcorrencia() throws Exception {
        ExecutorService fila = Executors.newFixedThreadPool(16);
        Set<String> ids = ConcurrentHashMap.newKeySet();
        List<Future<Integer>> futuros = new ArrayList<>();
        for (int i = 0; i < 80; i++) {
            futuros.add(fila.submit(() -> {
                HttpResponse<String> r = post("/api/registros", ficha("Fulano Paralelo", 30L, "em_aberto", "2025-01-01"));
                ids.add((String) mapa(r).get("id"));
                get("/api/registros");
                return r.statusCode();
            }));
        }
        boolean todos = true;
        for (Future<Integer> f : futuros) todos &= f.get() == 201;
        fila.shutdown();
        checar("80 cadastros simultâneos sem perda", todos && ids.size() == 80);
    }
}
