// Runs in a bounded child process; receives document bytes only, never credentials.
import { unzipSync, strFromU8 } from "fflate";
// Keep parser diagnostic output out of the JSON protocol and customer documents out of logs.
console.log = () => {};
console.warn = () => {};
console.error = () => {};
const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
try {
  const { kind, data } = JSON.parse(Buffer.concat(chunks).toString());
  const buffer = Buffer.from(data, "base64");
  let text = "";
  if (kind === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
    });
    try {
      const info = await parser.getInfo();
      if (info.total > 100) throw new Error("Maximal 100 PDF-Seiten.");
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else {
    const entries = unzipSync(new Uint8Array(buffer), {
      filter: (entry) =>
        entry.name === "word/document.xml" && entry.originalSize <= 2000000,
    });
    if (!entries["word/document.xml"])
      throw new Error("DOCX-Text fehlt oder ist zu groß.");
    const xml = strFromU8(entries["word/document.xml"]);
    const decode = (s) =>
      s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi, (_, entity) => {
        const named = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
        if (named[entity]) return named[entity];
        const number = entity.startsWith("#x")
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
        return number > 0 && number <= 0x10ffff
          ? String.fromCodePoint(number)
          : "";
      });
    text = [
      ...xml.matchAll(
        /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/w:p>|<w:tab\s*\/>/g,
      ),
    ]
      .map((m) =>
        m[1] !== undefined ? decode(m[1]) : m[0] === "</w:p>" ? "\n" : "\t",
      )
      .join("");
  }
  if (Buffer.byteLength(text) > 500000)
    throw new Error("Zu viel extrahierter Text (maximal 500 KB).");
  process.stdout.write(JSON.stringify({ text }));
} catch {
  process.stdout.write(
    JSON.stringify({
      error:
        "Dokument konnte nicht gelesen werden. Maximal 100 PDF-Seiten und 500 KB Text; gescannte PDFs benötigen OCR.",
    }),
  );
  process.exitCode = 1;
}
