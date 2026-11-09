import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { XMLValidator } from "fast-xml-parser";
import { z } from "zod";
const text = z.string().max(10000),
  cell = z.union([z.string().max(4000), z.number().finite(), z.boolean()]);
export const officeInput = z
  .object({
    name: z.string().regex(/^[\w .-]{1,100}\.(docx|xlsx|pptx)$/i),
    title: text,
    paragraphs: z.array(text).max(200).default([]),
    sheets: z
      .array(
        z.object({
          name: z
            .string()
            .min(1)
            .max(31)
            .regex(/^[^\[\]:*?\/\\]+$/),
          rows: z.array(z.array(cell).max(50)).max(500),
        }),
      )
      .max(10)
      .default([]),
    slides: z
      .array(z.object({ title: text, bullets: z.array(text).max(12) }))
      .max(40)
      .default([]),
  })
  .strict();
export const xml = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const relNS = "http://schemas.openxmlformats.org/package/2006/relationships",
  oNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (rs: { id: string; type: string; target: string }[]) =>
  header +
  `<Relationships xmlns="${relNS}">${rs.map((r) => `<Relationship Id="${r.id}" Type="${oNS}/${r.type}" Target="${xml(r.target)}"/>`).join("")}</Relationships>`;
export function createOffice(input: unknown) {
  const b = officeInput.parse(input),
    ext = b.name.split(".").at(-1)!.toLowerCase(),
    files: Record<string, Uint8Array> = {},
    overrides: { path: string; type: string }[] = [];
  const add = (p: string, value: string, type?: string) => {
    if (XMLValidator.validate(value) !== true)
      throw new Error("Invalid generated OOXML");
    files[p] = strToU8(value);
    if (type) overrides.push({ path: p, type });
  };
  let main = "",
    preview = "";
  if (ext === "docx") {
    main = "word/document.xml";
    const ps = [b.title, ...b.paragraphs];
    if (!ps.some(Boolean)) throw new Error("Document is empty");
    add(
      main,
      header +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${ps.map((p, i) => `<w:p><w:pPr>${i === 0 ? '<w:spacing w:after="320"/>' : ""}</w:pPr><w:r>${i === 0 ? '<w:rPr><w:b/><w:sz w:val="36"/></w:rPr>' : ""}<w:t xml:space="preserve">${xml(p)}</w:t></w:r></w:p>`).join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    );
    preview = ps
      .map((p, i) => `<${i ? "p" : "h1"}>${xml(p)}</${i ? "p" : "h1"}>`)
      .join("");
  } else if (ext === "xlsx") {
    if (
      !b.sheets.length ||
      new Set(b.sheets.map((s) => s.name.toLowerCase())).size !==
        b.sheets.length
    )
      throw new Error("Sheets need unique names");
    main = "xl/workbook.xml";
    add(
      main,
      header +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${oNS}"><sheets>${b.sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    );
    add(
      "xl/_rels/workbook.xml.rels",
      rels(
        b.sheets.map((_, i) => ({
          id: "rId" + (i + 1),
          type: "worksheet",
          target: `worksheets/sheet${i + 1}.xml`,
        })),
      ),
    );
    const column = (n: number): string =>
      n < 26
        ? String.fromCharCode(65 + n)
        : column(Math.floor(n / 26) - 1) + column(n % 26);
    b.sheets.forEach((s, i) => {
      add(
        `xl/worksheets/sheet${i + 1}.xml`,
        header +
          `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${s.rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${column(c)}${r + 1}" t="${typeof v === "number" ? "n" : typeof v === "boolean" ? "b" : "inlineStr"}">${typeof v === "string" ? `<is><t xml:space="preserve">${xml(v)}</t></is>` : `<v>${typeof v === "boolean" ? Number(v) : v}</v>`}</c>`).join("")}</row>`).join("")}</sheetData></worksheet>`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
      );
      preview += `<h2>${xml(s.name)}</h2><table>${s.rows.map((r) => "<tr>" + r.map((c) => "<td>" + xml(String(c)) + "</td>").join("") + "</tr>").join("")}</table>`;
    });
  } else {
    if (!b.slides.length) throw new Error("Slides are empty");
    main = "ppt/presentation.xml";
    add(
      main,
      header +
        `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${oNS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${b.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    );
    add(
      "ppt/_rels/presentation.xml.rels",
      rels(
        b.slides.map((_, i) => ({
          id: "rId" + (i + 1),
          type: "slide",
          target: `slides/slide${i + 1}.xml`,
        })),
      ),
    );
    b.slides.forEach((s, i) => {
      add(
        `ppt/slides/slide${i + 1}.xml`,
        header +
          `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${oNS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="700000" y="500000"/><a:ext cx="10800000" cy="5800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${[s.title, ...s.bullets].map((p, j) => `<a:p><a:r><a:rPr lang="de-DE" sz="${j ? 2200 : 3600}" b="${j ? 0 : 1}"/><a:t>${xml(p)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
        "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
      );
      preview += `<section><h2>${xml(s.title)}</h2>${s.bullets.map((p) => "<p>" + xml(p) + "</p>").join("")}</section>`;
    });
  }
  add(
    "_rels/.rels",
    rels([{ id: "rId1", type: "officeDocument", target: main }]),
  );
  add(
    "[Content_Types].xml",
    header +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map((o) => `<Override PartName="/${o.path}" ContentType="${o.type}"/>`).join("")}</Types>`,
  );
  const data = zipSync(files, { level: 6 });
  if (data.length > 500000) throw new Error("Office export exceeds 500 KB");
  // Round-trip every generated XML part before publishing the binary.
  for (const f of Object.values(unzipSync(data)))
    if (XMLValidator.validate(strFromU8(f)) !== true)
      throw new Error("Office package validation failed");
  return {
    name: b.name,
    data,
    preview: `<!doctype html><meta charset="utf-8"><style>body{font:16px/1.65 system-ui;margin:32px;color:#17212b;background:white;overflow-wrap:anywhere}table{border-collapse:collapse;max-width:100%}td{border:1px solid #aab;padding:8px}section{border:1px solid #ccd;margin:24px 0;padding:32px;min-height:250px}</style>${preview}`,
    validation:
      "OOXML XML structure and ZIP round-trip; content preview, not an Office rendering",
  };
}
