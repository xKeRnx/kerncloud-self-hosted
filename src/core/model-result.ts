import type { Message } from "./types.ts";

export { defaultOutputTokens } from "./model-limits.ts";
export class ModelResponseError extends Error {}
export function modelResultProblem(
  message: Message | undefined,
  finishReason?: string | null,
): string | null {
  if (finishReason === "length")
    return "KI-Ausgabelimit erreicht. Die Antwort ist unvollständig. Erhöhe das Ausgabe-Tokenlimit unter KI & Modelle oder verkleinere den Auftrag und starte einen neuen Versuch. Bereits gespeicherte Dateien bleiben erhalten.";
  if (finishReason === "content_filter")
    return "Der KI-Anbieter hat die Antwort gefiltert. Bitte den Auftrag prüfen und gegebenenfalls anpassen.";
  if (finishReason === "error")
    return "Der KI-Anbieter hat die Verarbeitung mit einem Fehler beendet. Es wurde kein erfolgreicher Abschluss bestätigt.";
  if (!message || message.role !== "assistant")
    return "Der Anbieter hat keine gültige Assistant-Antwort geliefert.";
  if (message.tool_calls?.length) {
    if (
      message.tool_calls.some(
        (c) =>
          !c.id ||
          c.type !== "function" ||
          !c.function?.name ||
          typeof c.function.arguments !== "string",
      )
    )
      return "Der Anbieter hat einen unvollständigen Werkzeugaufruf geliefert. Es wurde kein Werkzeug ausgeführt.";
    return null;
  }
  if (typeof message.content !== "string" || !message.content.trim())
    return "Der KI-Anbieter hat eine leere Antwort ohne Werkzeugaufruf geliefert. Bitte Modell und Ausgabe-Tokenlimit unter KI & Modelle prüfen. Der Auftrag wurde nicht erfolgreich abgeschlossen.";
  return null;
}
