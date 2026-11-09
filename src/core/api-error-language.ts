import { uiMessage } from "./ui-messages";
import type { Locale } from "./languages";
export function apiErrorMessage(
  locale: Locale,
  message: string,
  status: number,
) {
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
