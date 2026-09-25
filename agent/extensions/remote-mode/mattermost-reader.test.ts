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
