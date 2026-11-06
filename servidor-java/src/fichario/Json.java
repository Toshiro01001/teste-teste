package fichario;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Leitor e escritor de JSON escritos à mão, para não depender de bibliotecas externas. */
public final class Json {
    private static final int PROFUNDIDADE_MAXIMA = 32;

    public static final class ErroJson extends RuntimeException {
        public ErroJson(String mensagem) { super(mensagem); }
    }

    private final String texto;
    private int pos;

    private Json(String texto) { this.texto = texto; }

    /** Devolve Map, List, String, Long, Double, Boolean ou null. Lança ErroJson se o texto for inválido. */
    public static Object ler(String texto) {
        Json leitor = new Json(texto);
        leitor.pularEspacos();
        Object valor = leitor.valor(0);
        leitor.pularEspacos();
        if (leitor.pos != texto.length()) throw new ErroJson("Há texto sobrando depois do JSON.");
        return valor;
    }

    private Object valor(int nivel) {
        if (nivel > PROFUNDIDADE_MAXIMA) throw new ErroJson("JSON aninhado demais.");
        if (pos >= texto.length()) throw new ErroJson("JSON terminou antes da hora.");
        char c = texto.charAt(pos);
        switch (c) {
            case '{': return objeto(nivel);
            case '[': return lista(nivel);
            case '"': return string();
            case 't': return literal("true", Boolean.TRUE);
            case 'f': return literal("false", Boolean.FALSE);
            case 'n': return literal("null", null);
            default: return numero();
        }
    }

    private Object literal(String palavra, Object valor) {
        if (!texto.startsWith(palavra, pos)) throw new ErroJson("Valor inválido na posição " + pos + ".");
        pos += palavra.length();
        return valor;
    }

    private Map<String, Object> objeto(int nivel) {
        Map<String, Object> mapa = new LinkedHashMap<>();
        pos++;
        pularEspacos();
        if (proximoE('}')) return mapa;
        while (true) {
            pularEspacos();
            if (pos >= texto.length() || texto.charAt(pos) != '"') throw new ErroJson("Esperava o nome de um campo na posição " + pos + ".");
            String chave = string();
            pularEspacos();
            if (!proximoE(':')) throw new ErroJson("Esperava dois-pontos na posição " + pos + ".");
            pularEspacos();
            mapa.put(chave, valor(nivel + 1));
            pularEspacos();
            if (proximoE('}')) return mapa;
            if (!proximoE(',')) throw new ErroJson("Esperava vírgula na posição " + pos + ".");
        }
    }

    private List<Object> lista(int nivel) {
        List<Object> itens = new ArrayList<>();
        pos++;
        pularEspacos();
        if (proximoE(']')) return itens;
        while (true) {
            pularEspacos();
            itens.add(valor(nivel + 1));
            pularEspacos();
            if (proximoE(']')) return itens;
            if (!proximoE(',')) throw new ErroJson("Esperava vírgula na posição " + pos + ".");
        }
    }

    private String string() {
        StringBuilder sb = new StringBuilder();
        pos++;
        while (pos < texto.length()) {
            char c = texto.charAt(pos++);
            if (c == '"') return sb.toString();
            if (c < 0x20) throw new ErroJson("Caractere de controle dentro de texto.");
            if (c != '\\') { sb.append(c); continue; }
            if (pos >= texto.length()) break;
            char e = texto.charAt(pos++);
            switch (e) {
                case '"': case '\\': case '/': sb.append(e); break;
                case 'b': sb.append('\b'); break;
                case 'f': sb.append('\f'); break;
                case 'n': sb.append('\n'); break;
                case 'r': sb.append('\r'); break;
                case 't': sb.append('\t'); break;
                case 'u':
                    if (pos + 4 > texto.length()) throw new ErroJson("Escape unicode incompleto.");
                    try {
                        sb.append((char) Integer.parseInt(texto.substring(pos, pos + 4), 16));
                    } catch (NumberFormatException ex) {
                        throw new ErroJson("Escape unicode inválido.");
                    }
                    pos += 4;
                    break;
                default: throw new ErroJson("Escape inválido dentro de texto.");
            }
        }
        throw new ErroJson("Texto sem aspas de fechamento.");
    }

    private Object numero() {
        int inicio = pos;
        while (pos < texto.length() && "+-0123456789.eE".indexOf(texto.charAt(pos)) >= 0) pos++;
        String n = texto.substring(inicio, pos);
        if (!n.matches("-?(0|[1-9]\\d*)(\\.\\d+)?([eE][+-]?\\d+)?")) throw new ErroJson("Valor inválido na posição " + inicio + ".");
        if (n.matches("-?\\d{1,18}")) return Long.valueOf(n);
        return Double.valueOf(n);
    }

    private void pularEspacos() {
        while (pos < texto.length() && " \t\r\n".indexOf(texto.charAt(pos)) >= 0) pos++;
    }

    private boolean proximoE(char c) {
        if (pos < texto.length() && texto.charAt(pos) == c) { pos++; return true; }
        return false;
    }

    /** Converte Map, Iterable, String, número, booleano ou null em texto JSON. */
    public static String escrever(Object valor) {
        StringBuilder sb = new StringBuilder();
        escrever(valor, sb);
        return sb.toString();
    }

    private static void escrever(Object v, StringBuilder sb) {
        if (v == null) {
            sb.append("null");
        } else if (v instanceof String s) {
            aspas(s, sb);
        } else if (v instanceof Number || v instanceof Boolean) {
            sb.append(v);
        } else if (v instanceof Map<?, ?> m) {
            sb.append('{');
            boolean primeiro = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!primeiro) sb.append(',');
                primeiro = false;
                aspas(String.valueOf(e.getKey()), sb);
                sb.append(':');
                escrever(e.getValue(), sb);
            }
            sb.append('}');
        } else if (v instanceof Iterable<?> l) {
            sb.append('[');
            boolean primeiro = true;
            for (Object item : l) {
                if (!primeiro) sb.append(',');
                primeiro = false;
                escrever(item, sb);
            }
            sb.append(']');
        } else {
            aspas(v.toString(), sb);
        }
    }

    private static void aspas(String s, StringBuilder sb) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
    }
}
