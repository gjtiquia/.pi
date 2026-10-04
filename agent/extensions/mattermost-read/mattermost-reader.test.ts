import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { postIdFromLink, readMattermostLink, readMattermostAttachment } from "./mattermost-reader.js";

const root = "a".repeat(26);
const reply = "b".repeat(26);
const file = "c".repeat(26);
const user = "d".repeat(26);
const config = { url: "https://chat.example.org", token: "secret" };
const link = `https://chat.example.org/team/pl/${reply}`;
const oldFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oldFetch; });

function mock(routes: Record<string, unknown>) {
 globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://chat.example.org");
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer secret");
  assert.equal(init?.redirect, "manual");
  const value = routes[url.pathname];
  if (value === undefined) return new Response("missing", { status: 404 });
  return value instanceof Response ? value : Response.json(value);
 }) as typeof fetch;
}

const post = (id: string, root_id: string, create_at: number, file_ids: string[] = []) => ({
 id, root_id, create_at, file_ids, user_id: user, channel_id: "e".repeat(26), message: `message ${id}`,
});

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

test("only accepts post permalinks on configured Mattermost server", () => {
 assert.equal(postIdFromLink(link, config.url), reply);
 assert.equal(postIdFromLink(`https://chat.example.org/_redirect/pl/${root}`, config.url), root);
 assert.throws(() => postIdFromLink(`https://evil.example/team/pl/${root}`, config.url), /configured server/);
 assert.throws(() => postIdFromLink("https://chat.example.org/team/pl/invalid", config.url), /permalink/);
});

test("reads linked reply in root thread, ordered, with attachment IDs", async () => {
 mock({
  [`/api/v4/posts/${reply}`]: post(reply, root, 20, [file]),
  [`/api/v4/posts/${root}/thread`]: { order: [reply, root], posts: { [reply]: post(reply, root, 20, [file]), [root]: post(root, "", 10) } },
  [`/api/v4/users/${user}`]: { username: "alice" },
  [`/api/v4/posts/${reply}/files/info`]: [{ id: file, name: "notes.txt", mime_type: "text/plain", size: 4 }],
 });
 const result = await readMattermostLink(config, link);
 const text = result.content[0];
 assert.equal(text.type, "text");
 assert.ok(text.text.indexOf(`message ${root}`) < text.text.indexOf(`message ${reply}`));
 assert.match(text.text, /@alice/);
 assert.match(text.text, new RegExp(`file_id: ${file}`));
 assert.deepEqual(result.details.attachmentIds, [file]);
});

test("reports incomplete thread coverage when Mattermost indicates more posts", async () => {
 mock({
  [`/api/v4/posts/${root}`]: post(root, "", 10),
  [`/api/v4/posts/${root}/thread`]: { order: [root], posts: { [root]: post(root, "", 10) }, has_next: true },
 });
 const result = await readMattermostLink(config, `https://chat.example.org/team/pl/${root}`);
 const coverage = result.details.coverage as Record<string, unknown>;
 assert.equal(result.details.truncated, true);
 assert.equal(coverage.complete, false);
 assert.equal(coverage.hasMorePosts, true);
 const threadText = result.content[0];
 assert.equal(threadText.type, "text");
 if (threadText.type === "text") assert.match(threadText.text, /Thread coverage incomplete:.*Mattermost reported more posts/);
});

test("reports incomplete coverage when the thread character limit cuts a post", async () => {
 const oversizedPost = { ...post(root, "", 10), message: "x".repeat(150_001) };
 mock({
  [`/api/v4/posts/${root}`]: oversizedPost,
  [`/api/v4/posts/${root}/thread`]: { order: [root], posts: { [root]: oversizedPost } },
 });
 const result = await readMattermostLink(config, `https://chat.example.org/team/pl/${root}`);
 const coverage = result.details.coverage as Record<string, unknown>;
 assert.equal(coverage.complete, false);
 assert.equal(coverage.outputLimitReached, true);
 assert.equal(coverage.postsIncluded, 0);
 const threadText = result.content[0];
 assert.equal(threadText.type, "text");
 if (threadText.type === "text") assert.match(threadText.text, /Thread coverage incomplete: 150000-character output limit/);
});

test("reports PDF page coverage when extraction reaches its limit", async () => {
 const pdfBytes = makePdf(Array.from({ length: 11 }, (_, index) => `Page ${index + 1}`));
 mock({
  [`/api/v4/posts/${reply}`]: post(reply, root, 20, [file]),
  [`/api/v4/posts/${reply}/files/info`]: [{ id: file, name: "report.pdf", mime_type: "application/pdf", size: pdfBytes.length }],
  [`/api/v4/files/${file}`]: new Response(pdfBytes),
 });
 const result = await readMattermostAttachment(config, link, file);
 const coverage = result.details.coverage as Record<string, unknown>;
 assert.equal(coverage.complete, false);
 assert.equal(coverage.pagesRead, 10);
 assert.equal(coverage.totalPages, 11);
 assert.equal(coverage.maxPages, 10);
 assert.equal(coverage.maxCharacters, 50_000);
 const pdfText = result.content[0];
 assert.equal(pdfText.type, "text");
 if (pdfText.type === "text") assert.match(pdfText.text, /PDF text coverage incomplete: read 10 of 11 pages/);
});

test("reads text attachment only if it belongs to linked post", async () => {
 mock({
  [`/api/v4/posts/${reply}`]: post(reply, root, 20, [file]),
  [`/api/v4/posts/${reply}/files/info`]: [{ id: file, name: "notes.txt", mime_type: "text/plain", size: 5 }],
  [`/api/v4/files/${file}`]: new Response("hello"),
 });
 const result = await readMattermostAttachment(config, link, file);
 assert.match((result.content[0] as { text: string }).text, /hello/);
 await assert.rejects(readMattermostAttachment(config, link, root), /not on the linked post/);
});

test("sends detected image bytes as an image result and rejects oversized metadata", async () => {
 const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0);
 mock({
  [`/api/v4/posts/${reply}`]: post(reply, root, 20, [file]),
  [`/api/v4/posts/${reply}/files/info`]: [{ id: file, name: "pic.png", mime_type: "image/png", size: png.length }],
  [`/api/v4/files/${file}`]: new Response(png),
 });
 const result = await readMattermostAttachment(config, link, file);
 assert.equal(result.content[1].type, "image");
 if (result.content[1].type === "image") assert.equal(result.content[1].mimeType, "image/png");
 mock({
  [`/api/v4/posts/${reply}`]: post(reply, root, 20, [file]),
  [`/api/v4/posts/${reply}/files/info`]: [{ id: file, name: "huge.txt", mime_type: "text/plain", size: 30_000_000 }],
 });
 await assert.rejects(readMattermostAttachment(config, link, file), /exceeds/);
});
