import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfTextOptions {
	/** Maximum number of pages to inspect, starting with page 1 (default 10, hard limit 100). */
	maxPages?: number;
	/** Maximum number of UTF-16 code units returned (default 50,000, hard limit 200,000). */
	maxChars?: number;
	signal?: AbortSignal;
}

export interface PdfTextResult {
	text: string;
	pagesRead: number;
	totalPages: number;
	/** True if a page or text limit stopped extraction. */
	truncated: boolean;
}

const MAX_PDF_BYTES = 25 * 1024 * 1024;

function limit(value: number | undefined, fallback: number, ceiling: number, name: string): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > ceiling) {
		throw new RangeError(`${name} must be an integer between 1 and ${ceiling}`);
	}
	return result;
}

function abortError(): DOMException {
	return new DOMException("PDF extraction aborted", "AbortError");
}

/**
 * Extract plain text from PDF bytes in memory. Input is copied because PDF.js
 * transfers/detaches its data buffer; callers can safely retain their bytes.
 * No file is created, and PDF.js reads no URL supplied by the caller.
 */
export async function extractPdfText(data: Uint8Array, options: PdfTextOptions = {}): Promise<PdfTextResult> {
	const maxPages = limit(options.maxPages, 10, 100, "maxPages");
	const maxChars = limit(options.maxChars, 50_000, 200_000, "maxChars");
	if (data.byteLength > MAX_PDF_BYTES) throw new RangeError(`PDF exceeds ${MAX_PDF_BYTES} bytes`);
	if (options.signal?.aborted) throw abortError();

	const task = getDocument({
		data: new Uint8Array(data),
		stopAtErrors: true,
		useSystemFonts: false,
		standardFontDataUrl: new URL("./node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname,
	});
	let rejectAbort: ((reason: Error) => void) | undefined;
	const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
	const onAbort = () => rejectAbort?.(abortError());
	options.signal?.addEventListener("abort", onAbort, { once: true });
	// Handles an abort between the initial check and listener registration.
	if (options.signal?.aborted) onAbort();
	const wait = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, aborted]);
	const parts: string[] = [];
	let length = 0;
	let pagesRead = 0;
	try {
		const pdf = await wait(task.promise);
		const pages = Math.min(pdf.numPages, maxPages);
		for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
			const page = await wait(pdf.getPage(pageNumber));
			const content = await wait(page.getTextContent());
			pagesRead++;
			let hasText = false;
			for (const item of content.items) {
				if (!("str" in item)) continue;
				const piece = `${hasText ? " " : ""}${item.str}${item.hasEOL ? "\n" : ""}`;
				if (item.str) hasText = true;
				const remaining = maxChars - length;
				parts.push(piece.slice(0, remaining));
				length += Math.min(piece.length, remaining);
				if (length === maxChars) break;
			}
			if (length === maxChars) break;
			if (pageNumber < pages && length < maxChars) {
				parts.push("\n\n".slice(0, maxChars - length));
				length += Math.min(2, maxChars - length);
			}
		}
		return { text: parts.join(""), pagesRead, totalPages: pdf.numPages,
			truncated: pagesRead < pdf.numPages || length === maxChars };
	} finally {
		options.signal?.removeEventListener("abort", onAbort);
		await task.destroy();
	}
}
