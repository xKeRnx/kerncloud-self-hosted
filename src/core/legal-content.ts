export type LegalFormat = "text" | "html";

export function escapeLegalText(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export function textToLegalHtml(value: string) {
  return value.trim()
    ? value
        .replace(/\r\n?/g, "\n")
        .split(/\n{2,}/)
        .map(
          (paragraph) =>
            `<p>${escapeLegalText(paragraph).replace(/\n/g, "<br>")}</p>`,
        )
        .join("")
    : "<p></p>";
}
