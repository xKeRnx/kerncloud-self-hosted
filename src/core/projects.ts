import { z } from "zod";
export const branchName = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_\/-]{0,99}$/)
  .refine((v) => !v.includes("..") && !v.endsWith("/") && !v.includes("//"));
export function githubRepository(url: string) {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "github.com" ||
    u.port ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(u.pathname)
  )
    throw new Error("Use an HTTPS github.com repository URL");
  return u.pathname
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
}
export const shellQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function projectCommand(
  p: { id: string; repo_url: string; branch: string },
  action: string,
  input: unknown = {},
) {
  const dir = "projects/" + z.string().uuid().parse(p.id),
    q = shellQuote;
  githubRepository(p.repo_url);
  branchName.parse(p.branch);
  if (action === "clone")
    return {
      cwd: ".",
      command: `mkdir -p projects && test ! -e ${q(dir)} && GIT_TERMINAL_PROMPT=0 git -c core.hooksPath=/dev/null clone --depth 1 -- ${q(p.repo_url)} ${q(dir)} && git -C ${q(dir)} checkout -b ${q(p.branch)}`,
    };
  if (action === "status")
    return { cwd: dir, command: "git status --short && git log -3 --oneline" };
  if (action === "diff")
    return {
      cwd: dir,
      command:
        "git --no-pager diff --stat && git --no-pager diff --no-ext-diff -- .",
    };
  if (action === "test") {
    const b = z
      .object({ command: z.string().min(1).max(2000) })
      .strict()
      .parse(input);
    return { cwd: dir, command: b.command };
  }
  if (action === "commit") {
    const b = z
      .object({ message: z.string().min(1).max(300) })
      .strict()
      .parse(input);
    return {
      cwd: dir,
      command: `git -c core.hooksPath=/dev/null add -- . && git -c core.hooksPath=/dev/null -c user.name=KeRnCloud -c user.email=agent@kerncloud.local commit -m ${q(b.message)}`,
    };
  }
  throw new Error("Unknown project action");
}
export const publishInput = z
  .object({
    repository: z
      .string()
      .max(210)
      .regex(/^[\w.-]+\/[\w.-]+$/),
    base: branchName,
    branch: branchName,
    title: z.string().min(1).max(200),
    body: z.string().max(2000).default(""),
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .min(1)
              .max(200)
              .refine(
                (p) =>
                  !p.startsWith("/") &&
                  !p.includes("\\") &&
                  !p.split("/").some((x) => ["..", ".git", "."].includes(x)) &&
                  !/[\u0000-\u001f]/.test(p),
              ),
            content: z.string().max(20000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine(
    (b) =>
      b.branch !== b.base &&
      JSON.stringify(b).length <= 20000 &&
      new Set(b.files.map((f) => f.path)).size === b.files.length,
  );
