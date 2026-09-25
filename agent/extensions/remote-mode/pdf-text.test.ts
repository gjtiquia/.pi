import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPdfText } from "./pdf-text.ts";

// Build a minimal valid PDF in memory; no fixture file or disk writes.
function makePdf(lines: string[]): Uint8Array {
	const objects: string[] = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${lines.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${lines.length} >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	for (let index = 0; index < lines.length; index++) {
		const pageNumber = 4 + index * 2;
		const content = `BT /F1 12 Tf 72 720 Td (${lines[index]}) Tj ET`;
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNumber + 1} 0 R >>`);
		objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
	}
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(pdf);
	pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new Uint8Array(Buffer.from(pdf));
}

test("extracts text from in-memory PDF without detaching caller bytes", async () => {
	const bytes = makePdf(["Hello PDF", "Second page"]);
	const originalSize = bytes.byteLength;
	assert.deepEqual(await extractPdfText(bytes), {
		text: "Hello PDF\n\nSecond page", pagesRead: 2, totalPages: 2, truncated: false,
	});
	assert.equal(bytes.byteLength, originalSize);
});

test("bounds pages and text", async () => {
	const bytes = makePdf(["First page", "Second page"]);
	assert.deepEqual(await extractPdfText(bytes, { maxPages: 1 }), {
		text: "First page", pagesRead: 1, totalPages: 2, truncated: true,
	});
	const short = await extractPdfText(bytes, { maxChars: 5 });
	assert.equal(short.text, "First");
	assert.equal(short.pagesRead, 1);
	assert.equal(short.truncated, true);
	await assert.rejects(extractPdfText(bytes, { maxChars: 0 }), RangeError);
	await assert.rejects(extractPdfText(bytes, { maxPages: 101 }), RangeError);
});

test("rejects pre-aborted and in-progress requests", async () => {
	const bytes = makePdf(["Hello PDF"]);
	const already = new AbortController();
	already.abort();
	await assert.rejects(extractPdfText(bytes, { signal: already.signal }), { name: "AbortError" });
	const during = new AbortController();
	const result = extractPdfText(bytes, { signal: during.signal });
	during.abort();
	await assert.rejects(result, { name: "AbortError" });
});
