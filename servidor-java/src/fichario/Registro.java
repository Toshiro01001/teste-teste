package fichario;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;

/** Uma ficha do cadastro. Só existe depois de passar pela Validacao. */
public record Registro(String id, String nome, int idade, String cidade, String situacao, LocalDate data, String descricao) {

    public Map<String, Object> paraMapa() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("nome", nome);
        m.put("idade", idade);
        m.put("cidade", cidade);
        m.put("situacao", situacao);
        m.put("data", data.toString());
        m.put("descricao", descricao);
        return m;
    }

    public Registro comId(String novoId) {
        return new Registro(novoId, nome, idade, cidade, situacao, data, descricao);
    }
}
