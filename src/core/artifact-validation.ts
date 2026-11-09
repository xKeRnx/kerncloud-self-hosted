import { createHash } from "node:crypto";
import { z } from "zod";

export const browserCheck = z
  .object({
    action: z.enum([
      "click",
      "fill",
      "press",
      "assert_text",
      "assert_attribute",
      "assert_visible",
      "assert_value",
      "assert_count",
    ]),
    selector: z.string().min(1).max(500),
    value: z
      .union([
        z.string().max(1000),
        z.boolean(),
        z.number().finite().min(-1000000).max(1000000),
      ])
      .transform(String)
      .optional(),
    attribute: z.string().max(80).optional(),
  })
  .strict();
export const validationInput = z
  .object({
    artifact_id: z.string().uuid(),
    checks: z.array(browserCheck).min(1).max(20),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.checks.some((c) => c.action.startsWith("assert_")))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mindestens eine echte Ergebniserwartung (assert_*) angeben.",
      });
    for (const [i, c] of v.checks.entries()) {
      if (
        [
          "fill",
          "press",
          "assert_text",
          "assert_attribute",
          "assert_value",
          "assert_count",
        ].includes(c.action) &&
        c.value === undefined
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checks", i, "value"],
          message: "Erwarteter Wert fehlt.",
        });
      if (c.action === "assert_attribute" && !c.attribute)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checks", i, "attribute"],
          message: "Attribut fehlt.",
        });
    }
  });
export function artifactFingerprint(
  files: { id: string; name: string; content: string }[],
) {
  return createHash("sha256")
    .update(JSON.stringify([...files].sort((a, b) => a.id.localeCompare(b.id))))
    .digest("hex");
}
export const validationTool = {
  type: "function",
  function: {
    name: "validate_artifact",
    description:
      "Prüfe eine gespeicherte HTML-Datei mit echtem isoliertem Chromium: Desktop/Mobil, JS-Fehler, Überlauf und deine Interaktionen/Erwartungen. Keine gebuchte Umgebung nötig, kein Netzwerk. Wiederhole nach jedem Patch. checks nacheinander auf beiden Bildschirmgrößen; CSS-Selektoren aus aktuellem HTML. assert_visible value='false' prüft verborgen. Fehler selbst klein patchen; Abschluss erfordert erfolgreiche Prüfung der aktuellen Dateien.",
    parameters: {
      type: "object",
      properties: {
        artifact_id: { type: "string" },
        checks: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: [
                  "click",
                  "fill",
                  "press",
                  "assert_text",
                  "assert_attribute",
                  "assert_visible",
                  "assert_value",
                  "assert_count",
                ],
              },
              selector: { type: "string" },
              value: { type: ["string", "boolean", "number"] },
              attribute: { type: "string" },
            },
            required: ["action", "selector"],
            additionalProperties: false,
          },
        },
      },
      required: ["artifact_id", "checks"],
      additionalProperties: false,
    },
  },
};
