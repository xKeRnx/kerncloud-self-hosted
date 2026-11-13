import { uiMessage } from "./ui-messages";
import type { Locale } from "./languages";
// Exact application-owned messages only; never return arbitrary provider errors.
const studioErrors: Record<string, string> = {
  "A dispatched reply cannot be changed or repeated":
    "Eine versendete Antwort kann nicht geändert oder wiederholt werden.",
  "A reply already exists; review its current status before continuing":
    "A reply already exists; review its current status before continuing",
  "A social fetch is already running": "A social fetch is already running",
  "Choose an Ayrshare connection": "Choose an Ayrshare connection",
  "Confirm a ceiling valid for at most 31 days":
    "Bitte eine Preisobergrenze mit höchstens 31 Tagen Gültigkeit bestätigen.",
  "Confirm a current social read/reply price ceiling first":
    "Bitte zuerst eine aktuelle Preisobergrenze für Social-Abrufe bzw. Antworten bestätigen.",
  "Connection, price or budget changed since preview. Reload and review again":
    "Verbindung, Preis oder Budget wurden seit der Vorschau geändert. Bitte neu laden und erneut prüfen.",
  "Enable publishing on the assigned Ayrshare connection first":
    "Bitte zuerst Veröffentlichungen für die zugeordnete Ayrshare-Verbindung erlauben.",
  "Maximum 100 social sources per project":
    "Maximum 100 social sources per project",
  "No continuation is available; refresh the first page":
    "No continuation is available; refresh the first page",
  "Operation already started": "Dieser Vorgang wurde bereits gestartet.",
  "Reply approval is stale; review the current item and exact reply again":
    "Die Antwortfreigabe ist veraltet. Bitte den aktuellen Eintrag und den genauen Antworttext erneut prüfen.",
  "Reply changed; reload the exact preview":
    "Die Antwort wurde geändert. Bitte die aktuelle Vorschau laden.",
  "Review and explicitly confirm this exact reply first":
    "Review and explicitly confirm this exact reply first",
  "Set a sufficient fixed external budget first":
    "Bitte zuerst ein ausreichendes festes externes Projektbudget und Anfragelimit festlegen.",
  "Social fetch outcome uncertain; explicitly confirm a new paid read attempt":
    "Der Ausgang des Abrufs ist unklar. Bitte einen neuen, zusätzlich reservierten Leseversuch ausdrücklich bestätigen.",
  "Social item unavailable in this project":
    "Social item unavailable in this project",
  "Social source unavailable": "Social source unavailable",
  "The conversation changed; review the newest incoming message":
    "Die Unterhaltung wurde geändert. Bitte die neueste eingegangene Nachricht prüfen.",
  "The incoming item changed; reload before drafting":
    "The incoming item changed; reload before drafting",
  "This item cannot receive a reply": "This item cannot receive a reply",
  "This social fetch already started; inspect its receipt":
    "This social fetch already started; inspect its receipt",
  "Workspace administration required": "Workspace-Administration erforderlich.",
  "Connection is not granted to this project/agent":
    "Diese Verbindung ist für dieses Projekt bzw. diesen Agenten nicht freigegeben.",
  "A current confirmed per-request price ceiling is required":
    "Bitte unter den festen Projektlimits zuerst eine aktuelle Preisobergrenze pro Anfrage bestätigen. Kein Anbieteraufruf gestartet.",
  "Approved budget or price changed; review again":
    "Budget oder Preis wurden geändert. Bitte erneut prüfen und freigeben.",
  "Fixed project external budget or request limit reached; no provider call started":
    "Das feste Projektbudget oder Anfragelimit ist erreicht. Kein Anbieteraufruf gestartet.",
  "Project/workspace execution is paused":
    "Projekt oder Workspace sind pausiert.",
  "New limits cannot be lower than committed reservations":
    "Neue Limits dürfen nicht unter bereits reservierten Kosten oder Anfragen liegen.",
  "Post changed; reload its exact preview":
    "Der Beitrag wurde geändert. Bitte die aktuelle Vorschau neu laden.",
  "A dispatched post cannot be changed or automatically repeated":
    "Ein versendeter Beitrag kann nicht geändert oder automatisch wiederholt werden.",
  "Review and explicitly approve this exact post first":
    "Bitte zuerst genau diesen Beitrag prüfen und ausdrücklich freigeben.",
  "The price ceiling must cover the scheduled publication":
    "Die Preisbestätigung muss bis nach dem geplanten Veröffentlichungszeitpunkt gültig sein.",
  "An Ayrshare connection is required":
    "Eine Ayrshare-Verbindung ist erforderlich.",
  "Post changed; reload before editing":
    "Der Beitrag wurde geändert. Bitte vor der Bearbeitung neu laden.",
  "Clone a dispatched post instead of changing its audit record":
    "Bitte einen neuen Entwurf anlegen. Der Beleg eines versendeten Beitrags bleibt erhalten.",
  "Choose a research provider": "Bitte einen Recherche-Anbieter auswählen.",
  "Research job unavailable":
    "Diese Recherche ist in diesem Projekt nicht verfügbar.",
  "Report version unavailable": "Diese Berichtsversion ist nicht verfügbar.",
  "Report changed; read its current revision first":
    "Der Bericht wurde geändert. Bitte zuerst den aktuellen Stand laden.",
  "Unsupported search provider": "Dieser Suchanbieter wird nicht unterstützt.",
  "This query already started. Inspect its receipt; it will not be repeated automatically":
    "Diese Suche wurde bereits gestartet. Bitte den Beleg prüfen; sie wird nicht automatisch wiederholt.",
  "Fixed research job budget or request limit reached; no call started":
    "Das feste Recherchebudget oder Anfragelimit ist erreicht. Kein Anbieteraufruf gestartet.",
  "Search outcome/usage uncertain. The maximum cost remains committed; this query is not automatically retried":
    "Suchergebnis oder Verbrauch sind unklar. Die Kostenobergrenze bleibt reserviert; diese Suche wird nicht automatisch wiederholt.",
  "Approval is stale; review again":
    "Die Freigabe ist veraltet. Bitte erneut prüfen.",
  "Research job required": "Eine Recherche ist erforderlich.",
  "Publishing connection required":
    "Eine Veröffentlichungsverbindung ist erforderlich.",
  "Set sufficient fixed project/notebook budgets before starting AI research, or summarize existing sources only":
    "Bitte vor der KI-Recherche ausreichende feste Projekt- und Recherchelimits festlegen oder nur vorhandene Quellen zusammenfassen.",
};
export function apiErrorMessage(
  locale: Locale,
  message: string,
  status: number,
) {
  if (Object.hasOwn(studioErrors, message))
    return locale === "de" ? studioErrors[message] : message;
  const translated = uiMessage(locale, message);
  if (locale === "de" || translated !== message) return translated;
  return (
    (
      {
        400: "Please check your input.",
        401: "Please sign in again or check your credentials.",
        402: "Your plan or available balance does not allow this action.",
        403: "You do not have permission for this action.",
        404: "The requested item was not found in this workspace.",
        409: "This action cannot be completed in the current state. Refresh the page and check the settings or current task.",
        413: "The request is too large.",
        429: "Too many requests. Please try again shortly.",
        503: "This service is temporarily unavailable.",
      } as Record<number, string>
    )[status] ??
    "Unable to complete this action. Please check the configuration or contact the operator."
  );
}
