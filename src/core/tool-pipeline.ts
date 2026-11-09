import { z } from "zod";
export const pipelineTools = [
  "list_environments",
  "read_artifact",
  "patch_artifact",
  "save_artifact",
  "validate_artifact",
  "read_attachment",
  "search_memory",
  "read_memory",
  "environment_read_file",
  "environment_write_file",
  "environment_command",
  "environment_browser",
] as const;
export const pipelineInput = z
  .object({
    steps: z
      .array(
        z
          .object({
            tool: z.enum(pipelineTools),
            args: z.record(z.unknown()),
            select: z
              .array(z.string().regex(/^[a-zA-Z0-9_.]{1,100}$/))
              .max(12)
              .optional(),
          })
          .strict()
          .refine(
            (s) =>
              s.tool !== "environment_command" || s.args.background !== true,
            "Long background commands must use environment_command directly; the worker waits without AI polling.",
          ),
      )
      .min(1)
      .max(12),
  })
  .strict();
export function resolveStepArgs(value: unknown, results: unknown[]): unknown {
  if (Array.isArray(value))
    return value.map((v) => resolveStepArgs(v, results));
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("$step" in v) {
      const ref = z
        .object({
          $step: z.number().int().min(0),
          path: z
            .array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/))
            .max(8)
            .default([]),
        })
        .strict()
        .parse(v);
      if (ref.$step >= results.length)
        throw new Error("Only completed earlier steps can be referenced");
      let result: any = results[ref.$step];
      for (const p of ref.path) {
        if (!result || !Object.hasOwn(result, p))
          throw new Error("Referenced result field missing");
        result = result[p];
      }
      return result;
    }
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, resolveStepArgs(x, results)]),
    );
  }
  return value;
}
export function selectStepResult(value: any, fields?: string[]) {
  if (!fields || value?.ok === false) return value;
  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    let v = value;
    for (const key of field.split("."))
      v = v && Object.hasOwn(v, key) ? v[key] : undefined;
    selected[field] = v;
  }
  return selected;
}
