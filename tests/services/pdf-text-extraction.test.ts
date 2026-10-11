import { describe, expect, it } from "vitest";
import {
  extractPdfText,
  PDF_MAX_PAGES,
  PDF_MAX_SIZE_BYTES,
} from "@/services/pdf-text-extraction";

function createPdf(pageTexts: string[]): Uint8Array {
  const fontId = 3 + pageTexts.length * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageTexts.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`,
  ];
  for (let index = 0; index < pageTexts.length; index += 1) {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const lines = pageTexts[index].match(/.{1,70}/g) ?? [""];
    const textCommands = lines.map((line) => {
      const escapedText = line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
      return `(${escapedText}) Tj T*`;
    }).join(" ");
    const stream = `BT /F1 12 Tf 12 TL 72 720 Td ${textCommands} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("extractPdfText", () => {
  it("extracts text and returns page-numbered readable content", async () => {
    const result = await extractPdfText(createPdf(["Invoice reference number 2026-001"]));

    expect(result).toMatchObject({
      ok: true,
      pageCount: 1,
      pages: [{ pageNumber: 1, text: expect.stringContaining("Invoice reference number 2026-001") }],
      readability: "readable",
      ocrRequired: false,
    });
  });

  it("extracts text separately for every page", async () => {
    const result = await extractPdfText(createPdf([
      "Page one contains searchable text for testing",
      "Page two contains other searchable text",
    ]));

    expect(result).toMatchObject({
      ok: true,
      pageCount: 2,
      pages: [
        { pageNumber: 1, text: expect.stringContaining("Page one") },
        { pageNumber: 2, text: expect.stringContaining("Page two") },
      ],
      ocrRequired: false,
    });
  });

  it("reports a valid PDF without text as requiring OCR", async () => {
    const result = await extractPdfText(createPdf([""]));

    expect(result).toMatchObject({
      ok: true,
      pageCount: 1,
      pages: [{ pageNumber: 1, text: "" }],
      readability: "no_text",
      ocrRequired: true,
    });
  });

  it("reports a small amount of text as insufficient and requiring OCR", async () => {
    const result = await extractPdfText(createPdf(["short"]));

    expect(result).toMatchObject({ ok: true, readability: "insufficient_text", ocrRequired: true });
  });

  it("rejects invalid and corrupted PDFs without exposing parser details", async () => {
    const invalid = await extractPdfText(new TextEncoder().encode("not a PDF"));
    const corrupted = await extractPdfText(new TextEncoder().encode("%PDF-1.4\nnot a valid document"));

    expect(invalid).toMatchObject({ ok: false, error: { code: "INVALID_PDF" } });
    expect(corrupted).toMatchObject({
      ok: false,
      error: { code: "PARSER_ERROR", message: "Le PDF n’a pas pu être analysé." },
    });
    expect(JSON.stringify(corrupted)).not.toMatch(/%PDF|valid document|Error:| at /);
  });

  it("rejects PDFs larger than the upload size limit", async () => {
    const oversized = new Uint8Array(PDF_MAX_SIZE_BYTES + 1);
    oversized.set(new TextEncoder().encode("%PDF-"));

    await expect(extractPdfText(oversized)).resolves.toMatchObject({
      ok: false,
      error: { code: "FILE_TOO_LARGE" },
    });
  });

  it("rejects PDFs exceeding the page limit", async () => {
    const result = await extractPdfText(createPdf(Array.from({ length: PDF_MAX_PAGES + 1 }, () => "")));

    expect(result).toMatchObject({ ok: false, error: { code: "TOO_MANY_PAGES" } });
  });

  it("rejects extracted text exceeding the processing limit", async () => {
    const result = await extractPdfText(createPdf(Array.from({ length: 30 }, () => "x".repeat(5_000))));

    expect(result).toMatchObject({ ok: false, error: { code: "TEXT_LIMIT_EXCEEDED" } });
  });
});
