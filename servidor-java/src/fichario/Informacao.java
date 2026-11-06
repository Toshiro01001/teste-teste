package fichario;

import java.time.LocalDate;

/** Informação enviada sobre uma ficha. Fica só na memória do servidor e some quando ele desliga. */
public record Informacao(String registroId, String local, LocalDate data, String relato, String contato) {
}
