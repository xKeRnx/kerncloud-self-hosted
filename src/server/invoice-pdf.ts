import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  money,
  SMALL_BUSINESS_NOTE,
  type InvoiceDocument,
} from "../core/einvoice.ts";

export async function invoicePdf(d: InvoiceDocument): Promise<Buffer> {
  const font = (weight: number) =>
    readFileSync(
      join(
        process.cwd(),
        `node_modules/@fontsource/noto-sans/files/noto-sans-latin-${weight}-normal.woff`,
      ),
    );
  const regular = font(400),
    bold = font(700);
  const pdf = new PDFDocument({
    size: "A4",
    margin: 45,
    pdfVersion: "1.7",
    subset: "PDF/A-3b",
    font: join(
      process.cwd(),
      "node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff",
    ),
    bufferPages: true,
    info: {
      Title: `${d.type === "credit_note" ? "Rechnungskorrektur" : "Rechnung"} ${d.number}`,
      Author: d.seller.name,
      Creator: "KeRnCloud",
      CreationDate: new Date(d.issueDate + "T12:00:00Z"),
      ModDate: new Date(d.issueDate + "T12:00:00Z"),
    },
  });
  pdf.registerFont("Body", regular).registerFont("Strong", bold);
  // Never issue a PDF that silently drops characters which are still present in its XML.
  pdf.font("Body");
  const face = (pdf as any)._font.font;
  const content = [
    ...Object.values(d.seller),
    ...Object.values(d.buyer),
    ...d.lines.map((l) => l.description),
    d.paymentText,
    d.number,
    d.original?.number ?? "",
  ].join("\n");
  const missing = [
    ...new Set(
      [...content]
        .map((c) => c.codePointAt(0)!)
        .filter((cp) => cp > 32 && !face.hasGlyphForCodePoint(cp)),
    ),
  ];
  if (missing.length)
    throw new Error(
      "Rechnungsschrift kann diese Zeichen nicht vollständig darstellen: " +
        missing.map((cp) => "U+" + cp.toString(16).toUpperCase()).join(", "),
    );
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (b) => chunks.push(b));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  const width = 505,
    ink = "#182b3a",
    muted = "#596c7a",
    brand = "#166875";
  const text = (
    value: string,
    x: number,
    y: number,
    w = width,
    size = 10,
    strong = false,
  ) =>
    pdf
      .font(strong ? "Strong" : "Body")
      .fontSize(size)
      .fillColor(ink)
      .text(value, x, y, { width: w, lineGap: 3 });
  const header = () => {
    text(
      d.seller.name.length > 70
        ? d.seller.name.slice(0, 67) + "..."
        : d.seller.name,
      45,
      38,
      505,
      11,
      true,
    );
    pdf.strokeColor(brand).lineWidth(2).moveTo(45, 67).lineTo(550, 67).stroke();
  };
  const more = (y: number, need: number) => {
    if (y + need <= 735) return y;
    pdf.addPage();
    header();
    return 90;
  };
  header();
  let y = 92;
  text(
    d.number.startsWith("MUSTER")
      ? "Muster - keine Rechnung"
      : d.type === "credit_note"
        ? "Rechnungskorrektur / Storno"
        : "Rechnung",
    45,
    y,
    505,
    25,
    true,
  );
  y += 42;
  const seller = [
    d.seller.name,
    d.seller.street,
    `${d.seller.postalCode} ${d.seller.city}`,
    "Deutschland",
    d.seller.email,
    d.seller.phone,
  ].join("\n");
  const buyer = [
    d.buyer.name,
    d.buyer.street,
    `${d.buyer.postalCode} ${d.buyer.city}`,
    "Deutschland",
    d.buyer.email,
  ].join("\n");
  text("RECHNUNG AN", 45, y, 245, 8, true);
  text("RECHNUNGSSTELLER", 315, y, 235, 8, true);
  y += 19;
  text(buyer, 45, y, 245);
  text(seller, 315, y, 235);
  const boxHeight = Math.max(
    pdf
      .font("Body")
      .fontSize(10)
      .heightOfString(buyer, { width: 245, lineGap: 3 }),
    pdf.heightOfString(seller, { width: 235, lineGap: 3 }),
  );
  y += boxHeight + 25;
  y = more(y, 95);
  const leftMeta = `Rechnungsnummer: ${d.number}\nAusgestellt am: ${d.issueDate}\nLeistungszeitraum: ${d.serviceStart} bis ${d.serviceEnd}`,
    rightMeta = `Fällig am: ${d.dueDate}\nKäuferreferenz: ${d.buyer.reference}\nWährung: EUR`;
  text(leftMeta, 45, y, 300);
  text(rightMeta, 350, y, 200);
  y +=
    Math.max(
      pdf
        .font("Body")
        .fontSize(10)
        .heightOfString(leftMeta, { width: 300, lineGap: 3 }),
      pdf.heightOfString(rightMeta, { width: 200, lineGap: 3 }),
    ) + 25;
  if (d.original) {
    text(
      `Bezug: Rechnung ${d.original.number} vom ${d.original.issueDate}`,
      45,
      y,
    );
    y += 30;
  }
  const tableHead = () => {
    pdf.rect(45, y, 505, 26).fill("#edf4f5");
    text("Leistung", 53, y + 7, 260, 9, true);
    text("Menge", 320, y + 7, 60, 9, true);
    text("Einzel netto", 382, y + 7, 80, 9, true);
    text("Netto EUR", 470, y + 7, 75, 9, true);
    y += 34;
  };
  y = more(y, 65);
  tableHead();
  d.lines.forEach((line, i) => {
    const height = Math.max(
      28,
      pdf
        .font("Body")
        .fontSize(9)
        .heightOfString(line.description, { width: 250, lineGap: 3 }) + 16,
    );
    const next = more(y, height + 20);
    if (next !== y) {
      y = next;
      tableHead();
    }
    text(line.description, 53, y, 250, 9);
    text(
      (line.quantityMilli / 1000).toLocaleString("de-DE", {
        maximumFractionDigits: 3,
      }),
      320,
      y,
      60,
      9,
    );
    text(money(line.unitNetCents), 382, y, 80, 9);
    text(money(d.lineNetCents[i]), 470, y, 75, 9);
    y += height;
    pdf
      .strokeColor("#e0e7eb")
      .lineWidth(0.5)
      .moveTo(45, y - 7)
      .lineTo(550, y - 7)
      .stroke();
  });
  y = more(y + 14, 160);
  const total = (label: string, value: number, strong = false) => {
    text(label, 300, y, 170, 10, strong);
    text(`${money(value)} EUR`, 465, y, 85, 10, strong);
    y += 25;
  };
  total("Nettobetrag", d.netCents);
  total(
    d.taxTreatment === "small_business"
      ? "Umsatzsteuer (steuerbefreit)"
      : `Umsatzsteuer ${d.vatRate} %`,
    d.vatCents,
  );
  total(
    d.type === "credit_note" ? "Korrekturbetrag gesamt" : "Rechnungsbetrag",
    d.grossCents,
    true,
  );
  if (d.paidCents) total("Bereits bezahlt", d.paidCents);
  if (d.type === "invoice") total("Noch zu zahlen", d.dueCents, true);
  const details = [
    d.taxTreatment === "small_business" ? SMALL_BUSINESS_NOTE : "",
    d.paymentText,
    d.seller.taxNumber ? `Steuernummer: ${d.seller.taxNumber}` : "",
    d.seller.vatId ? `USt-IdNr.: ${d.seller.vatId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  y = more(
    y + 12,
    pdf
      .font("Body")
      .fontSize(9)
      .heightOfString(details, { width: 505, lineGap: 3 }) + 20,
  );
  text(details, 45, y, 505, 9);
  const range = pdf.bufferedPageRange();
  for (let n = 0; n < range.count; n++) {
    pdf.switchToPage(range.start + n);
    pdf
      .font("Body")
      .fontSize(8)
      .fillColor(muted)
      .text(`${d.number}  |  ${n + 1} / ${range.count}`, 45, 785, {
        width: 505,
        align: "right",
        lineBreak: false,
      });
  }
  pdf.end();
  return result;
}
