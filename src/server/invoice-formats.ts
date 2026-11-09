import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { XMLParser } from "fast-xml-parser";
import { invoiceXml, type InvoiceDocument } from "../core/einvoice.ts";
import { invoicePdf } from "./invoice-pdf.ts";
const exec = promisify(execFile);
export const INVOICE_VALIDATORS = {
  mustang: "2.26.0",
  kosit: "1.6.3",
  xrechnung: "3.0.2",
  configuration: "2026-08-31",
};
export class InvoiceValidationError extends Error {
  constructor(public reports: Record<string, string>) {
    super(
      "Formatprüfung fehlgeschlagen. Der Prüfbericht ist im Adminbereich verfügbar.",
    );
  }
}
export async function buildInvoiceFormats(doc: InvoiceDocument) {
  const directory = await mkdtemp(join(tmpdir(), "kerncloud-einvoice-"));
  const vendor = join(process.cwd(), "vendor/einvoice"),
    reports: Record<string, string> = {};
  const java = async (args: string[]) => {
    try {
      return await exec(
        "java",
        ["-Xmx256m", "-Djava.awt.headless=true", ...args],
        {
          cwd: directory,
          timeout: 120000,
          maxBuffer: 8000000,
          windowsHide: true,
        },
      );
    } catch (e: any) {
      return { stdout: String(e.stdout ?? ""), stderr: "", failed: true };
    }
  };
  try {
    const xrechnung = invoiceXml(doc, "xrechnung"),
      facturx = invoiceXml(doc, "facturx");
    await writeFile(join(directory, "xrechnung.xml"), xrechnung, {
      mode: 0o600,
    });
    await writeFile(join(directory, "factur-x.xml"), facturx, { mode: 0o600 });
    const kosit = await java([
      "-jar",
      join(vendor, "kosit-validator-1.6.3.jar"),
      "-s",
      join(vendor, "xrechnung/scenarios.xml"),
      "-r",
      join(vendor, "xrechnung"),
      "-o",
      directory,
      join(directory, "xrechnung.xml"),
    ]);
    try {
      reports.xrechnung = await readFile(
        join(directory, "xrechnung-report.xml"),
        "utf8",
      );
    } catch {
      reports.xrechnung = kosit.stdout;
    }
    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      processEntities: false,
    });
    let checked: any;
    try {
      checked = parser.parse(reports.xrechnung)?.report;
    } catch {}
    if (
      !checked ||
      String(checked["@_valid"]) !== "true" ||
      !Object.hasOwn(checked.assessment ?? {}, "accept")
    )
      throw new InvoiceValidationError(reports);
    let base: Buffer;
    try {
      base = await invoicePdf(doc);
    } catch (error) {
      reports.render =
        error instanceof Error
          ? error.message
          : "PDF-Darstellung fehlgeschlagen.";
      throw new InvoiceValidationError(reports);
    }
    await writeFile(join(directory, "visual.pdf"), base, { mode: 0o600 });
    const jar = join(vendor, "mustang-cli-2.26.0.jar");
    const combined = await java([
      "-jar",
      jar,
      "--disable-file-logging",
      "--action",
      "combine",
      "--source",
      join(directory, "visual.pdf"),
      "--source-xml",
      join(directory, "factur-x.xml"),
      "--out",
      join(directory, "zugferd.pdf"),
      "--format",
      "fx",
      "--version",
      "2",
      "--profile",
      "E",
      "--no-additional-attachments",
    ]);
    let pdf: Buffer;
    try {
      pdf = await readFile(join(directory, "zugferd.pdf"));
    } catch {
      reports.combine = combined.stdout;
      throw new InvoiceValidationError(reports);
    }
    const validated = await java([
      "-jar",
      jar,
      "--disable-file-logging",
      "--action",
      "validate",
      "--source",
      join(directory, "zugferd.pdf"),
    ]);
    const start = validated.stdout.indexOf("<?xml");
    reports.zugferd =
      start >= 0 ? validated.stdout.slice(start) : validated.stdout;
    let validation: any;
    try {
      validation = parser.parse(reports.zugferd)?.validation;
    } catch {}
    if (validation?.summary?.["@_status"] !== "valid")
      throw new InvoiceValidationError(reports);
    return {
      xrechnung: Buffer.from(xrechnung),
      facturx: Buffer.from(facturx),
      zugferd: pdf,
      reports,
      validators: INVOICE_VALIDATORS,
    };
  } finally {
    const absolute = resolve(directory),
      prefix = resolve(tmpdir()) + sep + "kerncloud-einvoice-";
    if (!absolute.startsWith(prefix))
      throw new Error("Unerwarteter temporärer Rechnungspfad.");
    await rm(absolute, { recursive: true, force: true });
  }
}
