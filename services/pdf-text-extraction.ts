import "server-only";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Extraction limits match the existing 10 MiB document upload cap. */
export const PDF_MAX_SIZE_BYTES = 10 * 1024 * 1024;
export const PDF_MAX_PAGES = 100;
export const PDF_MAX_TEXT_CHARACTERS = 100_000;
/** Non-whitespace character threshold used as a heuristic, not a readability guarantee. */
export const PDF_MIN_READABLE_CHARACTERS = 30;

export type PdfTextReadability = "readable" | "insufficient_text" | "no_text";

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

/** Text remains page-scoped; unreadable or absent text is successful extraction with OCR required. */
export type PdfTextExtractionResult =
  | {
      ok: true;
      pageCount: number;
      pages: PdfPageText[];
      totalCharacters: number;
      readability: PdfTextReadability;
      ocrRequired: boolean;
    }
  | {
      ok: false;
      error: {
        code: "INVALID_PDF" | "FILE_TOO_LARGE" | "TOO_MANY_PAGES" | "TEXT_LIMIT_EXCEEDED" | "PARSER_ERROR";
        message: string;
      };
    };

function hasPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

function getPageText(items: unknown[]): string {
  return items
    .filter((item): item is { str: string; hasEOL?: boolean } => (
      typeof item === "object"
      && item !== null
      && "str" in item
      && typeof item.str === "string"
    ))
    .map((item) => `${item.str}${item.hasEOL ? "\n" : " "}`)
    .join("")
    .trim();
}

function parserError(): PdfTextExtractionResult {
  return { ok: false, error: { code: "PARSER_ERROR", message: "Le PDF n’a pas pu être analysé." } };
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextExtractionResult> {
  if (bytes.byteLength > PDF_MAX_SIZE_BYTES) {
    return { ok: false, error: { code: "FILE_TOO_LARGE", message: "Le PDF dépasse la taille maximale autorisée." } };
  }
  if (!hasPdfSignature(bytes)) {
    return { ok: false, error: { code: "INVALID_PDF", message: "Le fichier fourni n’est pas un PDF valide." } };
  }

  let loadingTask: ReturnType<typeof getDocument> | undefined;
  let document: Awaited<ReturnType<typeof getDocument>["promise"]> | undefined;
  let result: PdfTextExtractionResult = parserError();
  try {
    loadingTask = getDocument({
      data: Uint8Array.from(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    document = await loadingTask.promise;
    const pageCount = document.numPages;
    if (pageCount > PDF_MAX_PAGES) {
      result = {
        ok: false,
        error: { code: "TOO_MANY_PAGES", message: "Le PDF dépasse le nombre maximal de pages autorisé." },
      };
    } else {
      const pages: PdfPageText[] = [];
      let totalCharacters = 0;
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = getPageText(content.items);
        totalCharacters += text.length;
        if (totalCharacters > PDF_MAX_TEXT_CHARACTERS) {
          result = {
            ok: false,
            error: { code: "TEXT_LIMIT_EXCEEDED", message: "Le texte du PDF dépasse la limite de traitement autorisée." },
          };
          break;
        }
        pages.push({ pageNumber, text });
        page.cleanup();
      }

      if (totalCharacters <= PDF_MAX_TEXT_CHARACTERS) {
        const searchableCharacters = pages.reduce(
          (count, page) => count + page.text.replace(/\s/g, "").length,
          0,
        );
        const readability: PdfTextReadability = searchableCharacters === 0
          ? "no_text"
          : searchableCharacters < PDF_MIN_READABLE_CHARACTERS
            ? "insufficient_text"
            : "readable";

        result = {
          ok: true,
          pageCount,
          pages,
          totalCharacters,
          readability,
          ocrRequired: readability !== "readable",
        };
      }
    }
  } catch {
    result = parserError();
  }

  try {
    if (document) await document.destroy();
    else if (loadingTask) await loadingTask.destroy();
  } catch {
    result = parserError();
  }

  return result;
}
