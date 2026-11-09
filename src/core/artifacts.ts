export type ArtifactFile = { name: string; content: string };
export function artifactPath(name: string): string {
  const path = name.replaceAll("\\", "/").normalize("NFC");
  if (
    !path ||
    path.length > 180 ||
    /[\x00-\x1f\x7f<>:"|?*]/.test(path) ||
    path.startsWith("/") ||
    path
      .split("/")
      .some(
        (p) =>
          !p || p === "." || p === ".." || p.endsWith(".") || p.endsWith(" "),
      )
  )
    throw new Error(
      "Dateiname muss ein relativer Projektpfad ohne .. oder Sonderzeichen sein.",
    );
  return path;
}
export function downloadPath(name: string): string {
  try {
    return artifactPath(name);
  } catch {
    return (
      name
        .replaceAll("\\", "/")
        .split("/")
        .at(-1)
        ?.replace(/[^\p{L}\p{N}_.-]/gu, "_")
        .slice(0, 120) || "result.txt"
    );
  }
}
export function resultFiles(text: string): ArtifactFile[] {
  const files: ArtifactFile[] = [];
  const names: Record<string, string> = {
    html: "index.html",
    htm: "index.html",
    css: "styles.css",
    js: "script.js",
    javascript: "script.js",
    ts: "main.ts",
    typescript: "main.ts",
    tsx: "App.tsx",
    jsx: "App.jsx",
    python: "main.py",
    py: "main.py",
    json: "data.json",
    svg: "image.svg",
    csv: "data.csv",
    md: "report.md",
    markdown: "report.md",
    sql: "query.sql",
    text: "result.txt",
    txt: "result.txt",
  };
  for (const match of text.matchAll(
    /^```([^\r\n]*)\r?\n([\s\S]*?)^```[ \t]*$/gm,
  )) {
    const info = match[1].trim(),
      content = match[2];
    if (!content.trim() || content.length > 200000 || files.length >= 12)
      continue;
    const parts = info.split(/\s+/),
      lang = parts[0].toLowerCase();
    const explicit =
      parts
        .find((p) => /^(?:filename|file)=/.test(p))
        ?.split("=")
        .slice(1)
        .join("=") ??
      (parts.length === 1 && /\.[a-z0-9]+$/i.test(info) ? info : undefined);
    let name = explicit ?? names[lang];
    if (!name) continue;
    try {
      name = artifactPath(name);
    } catch {
      continue;
    }
    if (files.some((f) => f.name === name))
      name = `file-${files.length + 1}-${name}`;
    files.push({ name, content });
  }
  if (
    !files.length &&
    /^\s*(?:<!doctype html[^>]*>\s*)?<html[\s>]/i.test(text) &&
    /<\/html>\s*$/i.test(text) &&
    text.length <= 200000
  )
    files.push({ name: "index.html", content: text });
  return files;
}
export function previewKind(name: string): "html" | "svg" | "text" {
  return /\.html?$/i.test(name)
    ? "html"
    : /\.svg$/i.test(name)
      ? "svg"
      : "text";
}
