package fichario;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.function.Function;

/**
 * Guarda os dados em memória. O esquema em sql/esquema.sql mostra como os mesmos dados ficariam
 * num banco; trocar esta classe por uma versão com JDBC não muda o resto do servidor.
 * Os métodos são synchronized porque o servidor atende vários pedidos ao mesmo tempo.
 */
public final class Repositorio {
    public static final int LIMITE_REGISTROS = 5000;
    public static final int LIMITE_INFORMACOES = 5000;

    public static final class LimiteAtingido extends RuntimeException { }

    public record Pagina(List<Registro> itens, int pagina, int tamanho, int total) {
        public int totalPaginas() { return total == 0 ? 0 : (total + tamanho - 1) / tamanho; }
    }

    private final Map<String, Registro> registros = new LinkedHashMap<>();
    private final List<Informacao> informacoes = new ArrayList<>();
    private int ultimoId = 0;

    public synchronized void carregar(Registro r) {
        registros.put(r.id(), r);
        ultimoId = Math.max(ultimoId, numeroDoId(r.id()));
    }

    public synchronized Pagina listar(Consulta c) {
        List<Registro> achados = filtrar(c);
        achados.sort(comparador(c.ordenar()));
        int inicio = (int) Math.min((long) (c.pagina() - 1) * c.tamanho(), achados.size());
        int fim = Math.min(inicio + c.tamanho(), achados.size());
        return new Pagina(new ArrayList<>(achados.subList(inicio, fim)), c.pagina(), c.tamanho(), achados.size());
    }

    public synchronized Map<String, Object> resumo(Consulta c) {
        List<Registro> achados = filtrar(c);
        Map<String, Integer> situacoes = new LinkedHashMap<>();
        for (String s : Validacao.SITUACOES) situacoes.put(s, 0);
        Map<String, Integer> cidades = new TreeMap<>(Comparator.comparing(Repositorio::normalizar));
        Map<String, Integer> faixas = new LinkedHashMap<>();
        for (String f : List.of("18 a 29", "30 a 44", "45 a 59", "60 ou mais")) faixas.put(f, 0);
        for (Registro r : achados) {
            situacoes.merge(r.situacao(), 1, Integer::sum);
            cidades.merge(r.cidade(), 1, Integer::sum);
            faixas.merge(faixa(r.idade()), 1, Integer::sum);
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("total", achados.size());
        m.put("porSituacao", situacoes);
        m.put("porCidade", cidades);
        m.put("porFaixaDeIdade", faixas);
        return m;
    }

    public synchronized Optional<Registro> obter(String id) {
        return Optional.ofNullable(registros.get(id));
    }

    public synchronized Registro criar(Registro r) {
        if (registros.size() >= LIMITE_REGISTROS) throw new LimiteAtingido();
        ultimoId++;
        Registro novo = r.comId(String.format("REG-%04d", ultimoId));
        registros.put(novo.id(), novo);
        return novo;
    }

    public synchronized boolean atualizar(Registro r) {
        if (!registros.containsKey(r.id())) return false;
        registros.put(r.id(), r);
        return true;
    }

    public synchronized boolean remover(String id) {
        return registros.remove(id) != null;
    }

    public synchronized int guardarInformacao(Informacao i) {
        if (informacoes.size() >= LIMITE_INFORMACOES) throw new LimiteAtingido();
        informacoes.add(i);
        return informacoes.size();
    }

    private List<Registro> filtrar(Consulta c) {
        String busca = c.busca() == null ? null : normalizar(c.busca());
        String cidade = c.cidade() == null ? null : normalizar(c.cidade());
        List<Registro> achados = new ArrayList<>();
        for (Registro r : registros.values()) {
            if (busca != null && !normalizar(r.id() + " " + r.nome() + " " + r.cidade() + " " + r.descricao()).contains(busca)) continue;
            if (cidade != null && !normalizar(r.cidade()).equals(cidade)) continue;
            if (c.situacao() != null && !c.situacao().equals(r.situacao())) continue;
            if (c.idadeMin() != null && r.idade() < c.idadeMin()) continue;
            if (c.idadeMax() != null && r.idade() > c.idadeMax()) continue;
            if (c.dataDe() != null && r.data().isBefore(c.dataDe())) continue;
            if (c.dataAte() != null && r.data().isAfter(c.dataAte())) continue;
            achados.add(r);
        }
        return achados;
    }

    private static Comparator<Registro> comparador(String ordem) {
        boolean inverter = ordem.startsWith("-");
        Function<Registro, Comparable<?>> chave = switch (ordem.replace("-", "")) {
            case "nome" -> r -> normalizar(r.nome());
            case "idade" -> Registro::idade;
            case "cidade" -> r -> normalizar(r.cidade());
            default -> Registro::data;
        };
        @SuppressWarnings({"unchecked", "rawtypes"})
        Comparator<Registro> base = (a, b) -> ((Comparable) chave.apply(a)).compareTo(chave.apply(b));
        return (inverter ? base.reversed() : base).thenComparing(Registro::id);
    }

    private static String faixa(int idade) {
        if (idade < 30) return "18 a 29";
        if (idade < 45) return "30 a 44";
        if (idade < 60) return "45 a 59";
        return "60 ou mais";
    }

    private static int numeroDoId(String id) {
        return Integer.parseInt(id.substring(id.indexOf('-') + 1));
    }

    /** Minúsculas e sem acentos, para "ficcao" encontrar "Ficção". */
    static String normalizar(String s) {
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
    }
}
