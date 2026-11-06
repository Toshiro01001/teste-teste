package fichario;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Liga o servidor. Por padrão só aceita conexões da própria máquina (127.0.0.1). */
public final class Servidor {
    private final HttpServer http;
    private final ExecutorService fila;

    public Servidor(String host, int porta, Repositorio repo, Set<String> origens) throws IOException {
        http = HttpServer.create(new InetSocketAddress(host, porta), 0);
        http.createContext("/", new Api(repo, origens));
        fila = Executors.newFixedThreadPool(8);
        http.setExecutor(fila);
    }

    public void ligar() { http.start(); }

    public int porta() { return http.getAddress().getPort(); }

    public void desligar() {
        http.stop(0);
        fila.shutdownNow();
    }

    /** Lê o JSON inicial e valida cada ficha. Ficha inválida impede o servidor de ligar. */
    public static Repositorio carregar(Path arquivo) throws IOException {
        Repositorio repo = new Repositorio();
        Object dados = Json.ler(Files.readString(arquivo));
        if (!(dados instanceof List<?> lista)) throw new IllegalArgumentException("O arquivo de dados precisa ser uma lista.");
        for (Object item : lista) {
            Object id = item instanceof Map<?, ?> m ? m.get("id") : null;
            if (!(id instanceof String s) || !s.matches("REG-\\d{4,8}")) throw new IllegalArgumentException("Ficha sem id válido.");
            repo.carregar(Validacao.registro(s, item));
        }
        return repo;
    }

    public static void main(String[] args) throws IOException {
        String host = "127.0.0.1";
        int porta = 8080;
        Path dados = Path.of("../dados/registros.json");
        Set<String> origens = new HashSet<>();
        for (int i = 0; i + 1 < args.length; i += 2) {
            switch (args[i]) {
                case "--host" -> host = args[i + 1];
                case "--porta" -> porta = Integer.parseInt(args[i + 1]);
                case "--dados" -> dados = Path.of(args[i + 1]);
                case "--origem" -> origens.add(args[i + 1]);
                default -> throw new IllegalArgumentException("Opção desconhecida: " + args[i]);
            }
        }
        Servidor s = new Servidor(host, porta, carregar(dados), origens);
        Runtime.getRuntime().addShutdownHook(new Thread(s::desligar));
        s.ligar();
        System.out.println("API de demonstração em http://" + host + ":" + s.porta() + "/api/registros");
    }
}
