package fichario;

import java.time.LocalDate;

/** Filtros, ordenação e página de uma consulta, já validados. Campo nulo significa "sem esse filtro". */
public record Consulta(String busca, String cidade, String situacao, Integer idadeMin, Integer idadeMax,
                       LocalDate dataDe, LocalDate dataAte, String ordenar, int pagina, int tamanho) {
}
