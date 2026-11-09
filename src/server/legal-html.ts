import sanitizeHtml from "sanitize-html";
import { textToLegalHtml, type LegalFormat } from "../core/legal-content.ts";

export function sanitizeLegalHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags: [
      "p",
      "h2",
      "h3",
      "h4",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "strike",
      "ul",
      "ol",
      "li",
      "blockquote",
      "br",
      "hr",
      "a",
      "code",
      "pre",
    ],
    allowedAttributes: { a: ["href", "title", "target", "rel"], ol: ["start"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    nonTextTags: [
      "script",
      "style",
      "textarea",
      "option",
      "iframe",
      "object",
      "embed",
      "svg",
      "math",
      "template",
      "noscript",
    ],
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...attributes,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      }),
    },
  });
}

export function renderLegalHtml(value: string, format: LegalFormat = "text") {
  return sanitizeLegalHtml(format === "html" ? value : textToLegalHtml(value));
}

export function legalPlainText(value: string, format: LegalFormat) {
  const html = renderLegalHtml(value, format);
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&#(?:\d+|x[\da-f]+);|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
