package fichario;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Recebe cada pedido HTTP, decide a rota e devolve JSON. Regras de dados ficam em Validacao e Repositorio. */
public final class Api implements HttpHandler {
    public static final int LIMITE_CORPO = 64 * 1024;
    private static final Pattern FICHA = Pattern.compile("^/api/registros/(REG-\\d{4,8})$");
    private static final Pattern INFORMACOES = Pattern.compile("^/api/registros/(REG-\\d{4,8})/informacoes$");
    private static final Pattern ORIGEM_LOCAL = Pattern.compile("^https?://(localhost|127\\.0\\.0\\.1)(:\\d{1,5})?$");

    private static final class Resposta extends RuntimeException {
        final int status;
        final Map<String, Object> corpo = new LinkedHashMap<>();

        Resposta(int status, String erro) {
            super(erro, null, false, false);
            this.status = status;
            corpo.put("erro", erro);
        }
    }

    private final Repositorio repo;
    private final Set<String> origensExtras;

    public Api(Repositorio repo, Set<String> origensExtras) {
        this.repo = repo;
        this.origensExtras = origensExtras;
    }

    @Override
    public void handle(HttpExchange t) throws IOException {
        try (t) {
            t.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
            t.getResponseHeaders().set("Cache-Control", "no-store");
            try {
                String origem = t.getRequestHeaders().getFirst("Origin");
                boolean permitida = origem != null && origemPermitida(origem);
                if (permitida) {
                    t.getResponseHeaders().set("Access-Control-Allow-Origin", origem);
                    t.getResponseHeaders().set("Vary", "Origin");
                }
                String metodo = t.getRequestMethod();
                if (metodo.equals("OPTIONS")) {
                    preflight(t, permitida);
                    return;
                }
                if (origem != null && !permitida && !metodo.equals("GET")) {
                    throw new Resposta(403, "Esta origem não tem permissão para alterar dados.");
                }
                rotear(t, metodo, t.getRequestURI().getRawPath());
            } catch (Resposta r) {
                enviar(t, r.status, r.corpo);
            } catch (Validacao.ErroValidacao e) {
                Map<String, Object> corpo = new LinkedHashMap<>();
                corpo.put("erro", "Há campos inválidos.");
                corpo.put("campos", e.campos);
                enviar(t, 400, corpo);
            } catch (Repositorio.LimiteAtingido e) {
                enviar(t, 507, Map.of("erro", "O limite de dados desta demonstração foi atingido. Reinicie o servidor."));
            } catch (RuntimeException e) {
                System.err.println("Erro interno: " + e.getClass().getSimpleName());
                enviar(t, 500, Map.of("erro", "Erro interno no servidor."));
            }
        }
    }

    private void rotear(HttpExchange t, String metodo, String caminho) throws IOException {
        if (caminho.equals("/api/saude")) {
            exigirMetodo(t, metodo, "GET");
            enviar(t, 200, Map.of("status", "ok"));
            return;
        }
        if (caminho.equals("/api/resumo")) {
            exigirMetodo(t, metodo, "GET");
            enviar(t, 200, repo.resumo(Validacao.consulta(lerQuery(t))));
            return;
        }
        if (caminho.equals("/api/registros")) {
            exigirMetodo(t, metodo, "GET", "POST");
            if (metodo.equals("GET")) listar(t);
            else criar(t);
            return;
        }
        Matcher m = FICHA.matcher(caminho);
        if (m.matches()) {
            exigirMetodo(t, metodo, "GET", "PUT", "DELETE");
            ficha(t, metodo, m.group(1));
            return;
        }
        m = INFORMACOES.matcher(caminho);
        if (m.matches()) {
            exigirMetodo(t, metodo, "POST");
            informar(t, m.group(1));
            return;
        }
        throw new Resposta(404, "Rota não encontrada.");
    }

    private void listar(HttpExchange t) throws IOException {
        Repositorio.Pagina p = repo.listar(Validacao.consulta(lerQuery(t)));
        List<Object> itens = new ArrayList<>();
        for (Registro r : p.itens()) itens.add(r.paraMapa());
        Map<String, Object> corpo = new LinkedHashMap<>();
        corpo.put("itens", itens);
        corpo.put("pagina", p.pagina());
        corpo.put("tamanho", p.tamanho());
        corpo.put("total", p.total());
        corpo.put("totalPaginas", p.totalPaginas());
        enviar(t, 200, corpo);
    }

    private void criar(HttpExchange t) throws IOException {
        Registro novo = repo.criar(Validacao.registro("REG-0000", lerCorpo(t)));
        t.getResponseHeaders().set("Location", "/api/registros/" + novo.id());
        enviar(t, 201, novo.paraMapa());
    }

    private void ficha(HttpExchange t, String metodo, String id) throws IOException {
        switch (metodo) {
            case "GET" -> enviar(t, 200, repo.obter(id).orElseThrow(Api::naoEncontrada).paraMapa());
            case "PUT" -> {
                Registro r = Validacao.registro(id, lerCorpo(t));
                if (!repo.atualizar(r)) throw naoEncontrada();
                enviar(t, 200, r.paraMapa());
            }
            default -> {
                if (!repo.remover(id)) throw naoEncontrada();
                t.sendResponseHeaders(204, -1);
            }
        }
    }

    private void informar(HttpExchange t, String id) throws IOException {
        if (repo.obter(id).isEmpty()) throw naoEncontrada();
        int quantidade = repo.guardarInformacao(Validacao.informacao(id, lerCorpo(t)));
        Map<String, Object> corpo = new LinkedHashMap<>();
        corpo.put("registroId", id);
        corpo.put("guardadasNaMemoria", quantidade);
        corpo.put("aviso", "Guardada só na memória deste servidor de demonstração. Ninguém recebe esta informação.");
        enviar(t, 201, corpo);
    }

    private static Resposta naoEncontrada() {
        return new Resposta(404, "Registro não encontrado.");
    }

    private static void exigirMetodo(HttpExchange t, String metodo, String... aceitos) {
        for (String a : aceitos) if (a.equals(metodo)) return;
        t.getResponseHeaders().set("Allow", String.join(", ", aceitos));
        throw new Resposta(405, "Método não permitido nesta rota.");
    }

    private void preflight(HttpExchange t, boolean permitida) throws IOException {
        if (!permitida) {
            t.sendResponseHeaders(403, -1);
            return;
        }
        t.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        t.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
        t.getResponseHeaders().set("Access-Control-Max-Age", "600");
        if ("true".equals(t.getRequestHeaders().getFirst("Access-Control-Request-Private-Network"))) {
            t.getResponseHeaders().set("Access-Control-Allow-Private-Network", "true");
        }
        t.sendResponseHeaders(204, -1);
    }

    private boolean origemPermitida(String origem) {
        return ORIGEM_LOCAL.matcher(origem).matches() || origensExtras.contains(origem);
    }

    private static Object lerCorpo(HttpExchange t) throws IOException {
        String tipo = t.getRequestHeaders().getFirst("Content-Type");
        if (tipo == null || !tipo.toLowerCase().startsWith("application/json")) {
            throw new Resposta(415, "Envie o corpo como application/json.");
        }
        byte[] bytes;
        try (InputStream in = t.getRequestBody()) {
            bytes = in.readNBytes(LIMITE_CORPO + 1);
        }
        if (bytes.length > LIMITE_CORPO) throw new Resposta(413, "O corpo passa do limite de 64 KB.");
        try {
            String texto = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
            return Json.ler(texto);
        } catch (CharacterCodingException e) {
            throw new Resposta(400, "O corpo não está em UTF-8 válido.");
        } catch (Json.ErroJson e) {
            throw new Resposta(400, "JSON inválido: " + e.getMessage());
        }
    }

    private static Map<String, String> lerQuery(HttpExchange t) {
        Map<String, String> q = new HashMap<>();
        String bruta = t.getRequestURI().getRawQuery();
        if (bruta == null || bruta.isEmpty()) return q;
        for (String par : bruta.split("&")) {
            int i = par.indexOf('=');
            String chave = i < 0 ? par : par.substring(0, i);
            String valor = i < 0 ? "" : par.substring(i + 1);
            try {
                q.put(URLDecoder.decode(chave, StandardCharsets.UTF_8), URLDecoder.decode(valor, StandardCharsets.UTF_8));
            } catch (IllegalArgumentException e) {
                throw new Resposta(400, "Há caracteres malformados no endereço.");
            }
        }
        return q;
    }

    private static void enviar(HttpExchange t, int status, Object corpo) throws IOException {
        byte[] bytes = Json.escrever(corpo).getBytes(StandardCharsets.UTF_8);
        t.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        t.sendResponseHeaders(status, bytes.length);
        t.getResponseBody().write(bytes);
    }
}
