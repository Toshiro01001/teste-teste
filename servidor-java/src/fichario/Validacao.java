package fichario;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Todas as regras de entrada ficam aqui. Nenhum dado entra na memória sem passar por esta classe. */
public final class Validacao {
    public static final List<String> SITUACOES = List.of("em_aberto", "localizada", "encerrado");
    public static final List<String> ORDENS = List.of("data", "-data", "nome", "-nome", "idade", "-idade", "cidade", "-cidade");
    public static final int TAMANHO_MAXIMO = 100;
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");

    private Validacao() { }

    public static final class ErroValidacao extends RuntimeException {
        public final Map<String, String> campos;

        public ErroValidacao(Map<String, String> campos) {
            super("Há campos inválidos.");
            this.campos = campos;
        }
    }

    public static Registro registro(String id, Object corpo) {
        Map<String, Object> m = objeto(corpo);
        Map<String, String> erros = new LinkedHashMap<>();
        String nome = texto(m, "nome", 3, 80, false, erros);
        String cidade = texto(m, "cidade", 2, 60, false, erros);
        String descricao = texto(m, "descricao", 10, 600, true, erros);
        LocalDate data = dataPassada(m, "data", erros);

        int idade = 0;
        Object bruto = m.get("idade");
        if (bruto instanceof Long n && n >= 18 && n <= 110) idade = n.intValue();
        else erros.put("idade", "Informe um número inteiro de 18 a 110. Esta demonstração só usa adultos fictícios.");

        Object situacao = m.get("situacao");
        if (!(situacao instanceof String) || !SITUACOES.contains(situacao)) {
            erros.put("situacao", "Use um destes valores: " + String.join(", ", SITUACOES) + ".");
        }
        if (!erros.isEmpty()) throw new ErroValidacao(erros);
        return new Registro(id, nome, idade, cidade, (String) situacao, data, descricao);
    }

    public static Informacao informacao(String registroId, Object corpo) {
        Map<String, Object> m = objeto(corpo);
        Map<String, String> erros = new LinkedHashMap<>();
        String local = texto(m, "local", 2, 80, false, erros);
        String relato = texto(m, "relato", 10, 600, true, erros);
        LocalDate data = dataPassada(m, "data", erros);
        String contato = null;
        Object c = m.get("contato");
        if (c instanceof String s && !s.isBlank()) {
            contato = s.trim();
            if (contato.length() > 120 || !EMAIL.matcher(contato).matches()) erros.put("contato", "Informe um e-mail válido ou deixe em branco.");
        } else if (c != null && !(c instanceof String)) {
            erros.put("contato", "Informe um e-mail válido ou deixe em branco.");
        }
        if (!erros.isEmpty()) throw new ErroValidacao(erros);
        return new Informacao(registroId, local, data, relato, contato);
    }

    public static Consulta consulta(Map<String, String> q) {
        Map<String, String> erros = new LinkedHashMap<>();
        String busca = limpo(q.get("busca"));
        if (busca != null && busca.length() > 80) erros.put("busca", "Use no máximo 80 caracteres.");
        String cidade = limpo(q.get("cidade"));
        if (cidade != null && cidade.length() > 60) erros.put("cidade", "Use no máximo 60 caracteres.");
        String situacao = limpo(q.get("situacao"));
        if (situacao != null && !SITUACOES.contains(situacao)) erros.put("situacao", "Use um destes valores: " + String.join(", ", SITUACOES) + ".");
        Integer idadeMin = inteiro(q, "idadeMin", 0, 150, erros);
        Integer idadeMax = inteiro(q, "idadeMax", 0, 150, erros);
        if (idadeMin != null && idadeMax != null && idadeMin > idadeMax) erros.put("idadeMax", "A idade máxima não pode ser menor que a mínima.");
        LocalDate dataDe = dataOpcional(q, "dataDe", erros);
        LocalDate dataAte = dataOpcional(q, "dataAte", erros);
        if (dataDe != null && dataAte != null && dataDe.isAfter(dataAte)) erros.put("dataAte", "A data final não pode vir antes da inicial.");
        String ordenar = limpo(q.get("ordenar"));
        if (ordenar == null) ordenar = "-data";
        else if (!ORDENS.contains(ordenar)) erros.put("ordenar", "Use um destes valores: " + String.join(", ", ORDENS) + ".");
        Integer pagina = inteiro(q, "pagina", 1, 1_000_000, erros);
        Integer tamanho = inteiro(q, "tamanho", 1, TAMANHO_MAXIMO, erros);
        if (!erros.isEmpty()) throw new ErroValidacao(erros);
        return new Consulta(busca, cidade, situacao, idadeMin, idadeMax, dataDe, dataAte, ordenar,
                pagina == null ? 1 : pagina, tamanho == null ? 10 : tamanho);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> objeto(Object corpo) {
        if (corpo instanceof Map<?, ?> m) return (Map<String, Object>) m;
        throw new ErroValidacao(Map.of("corpo", "Envie um objeto JSON."));
    }

    private static String texto(Map<String, Object> m, String campo, int min, int max, boolean aceitaQuebra, Map<String, String> erros) {
        String aviso = "Use de " + min + " a " + max + " caracteres.";
        if (!(m.get(campo) instanceof String s)) {
            erros.put(campo, aviso);
            return null;
        }
        String t = s.trim();
        int tamanho = t.codePointCount(0, t.length());
        if (tamanho < min || tamanho > max) {
            erros.put(campo, aviso);
            return null;
        }
        for (int i = 0; i < t.length(); i++) {
            char c = t.charAt(i);
            if (Character.isISOControl(c) && !(aceitaQuebra && c == '\n')) {
                erros.put(campo, "Remova caracteres de controle.");
                return null;
            }
        }
        return t;
    }

    private static LocalDate dataPassada(Map<String, Object> m, String campo, Map<String, String> erros) {
        if (m.get(campo) instanceof String s) {
            try {
                LocalDate d = LocalDate.parse(s);
                if (!d.isAfter(LocalDate.now())) return d;
                erros.put(campo, "A data não pode estar no futuro.");
                return null;
            } catch (DateTimeParseException ignorada) {
                // cai na mensagem abaixo
            }
        }
        erros.put(campo, "Informe uma data real no formato AAAA-MM-DD.");
        return null;
    }

    private static LocalDate dataOpcional(Map<String, String> q, String campo, Map<String, String> erros) {
        String s = limpo(q.get(campo));
        if (s == null) return null;
        try {
            return LocalDate.parse(s);
        } catch (DateTimeParseException e) {
            erros.put(campo, "Informe uma data real no formato AAAA-MM-DD.");
            return null;
        }
    }

    private static Integer inteiro(Map<String, String> q, String campo, int min, int max, Map<String, String> erros) {
        String s = limpo(q.get(campo));
        if (s == null) return null;
        try {
            int n = Integer.parseInt(s);
            if (n >= min && n <= max) return n;
        } catch (NumberFormatException ignorada) {
            // cai na mensagem abaixo
        }
        erros.put(campo, "Informe um número inteiro de " + min + " a " + max + ".");
        return null;
    }

    private static String limpo(String s) {
        if (s == null || s.isBlank()) return null;
        return s.trim();
    }
}
