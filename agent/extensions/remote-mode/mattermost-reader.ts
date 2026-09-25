import { extractPdfText } from "./pdf-text.js";

const POST_ID = /^[a-z0-9]{26}$/i;
const MAX_POSTS = 500;
const MAX_THREAD_CHARS = 150_000;
const MAX_TEXT_CHARS = 100_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export interface ReaderConfig { url: string; token: string }
interface Post {
 id: string; root_id: string; channel_id: string; user_id: string; message: string;
 create_at: number; file_ids?: string[]; delete_at?: number;
}
interface FileInfo { id: string; name: string; mime_type: string; size: number }
interface PostList { order: string[]; posts: Record<string, Post>; has_next?: boolean }
export interface ReaderResult { content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: ImageMime }>; details: Record<string, unknown> }

export function postIdFromLink(link: string, serverUrl: string): string {
 let parsed: URL;
 try { parsed = new URL(link); } catch { throw new Error("Provide a full Mattermost post permalink URL"); }
 const server = new URL(serverUrl);
 if (parsed.origin !== server.origin || !parsed.pathname.startsWith(`${server.pathname.replace(/\/$/, "")}/`)) {
  throw new Error("Mattermost link must belong to the configured server");
 }
 const parts = parsed.pathname.split("/").filter(Boolean);
 const plIndex = parts.lastIndexOf("pl");
 const id = plIndex >= 0 && plIndex === parts.length - 2 ? parts.at(-1) : parsed.searchParams.get("post");
 if (!id || !POST_ID.test(id)) throw new Error("Expected a Mattermost post permalink (.../pl/<post-id>)");
 return id;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
 const timeout = AbortSignal.timeout(20_000);
 return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function request(config: ReaderConfig, path: string, signal?: AbortSignal): Promise<Response> {
 const response = await fetch(`${config.url}/api/v4${path}`, {
  headers: { Authorization: `Bearer ${config.token}` }, signal: requestSignal(signal),
  redirect: "manual", // Never forward the bot token to a redirected host.
 });
 if (!response.ok) {
  const error = (await response.text()).slice(0, 500);
  throw new Error(`Mattermost ${response.status}${error ? `: ${error}` : ""}`);
 }
 return response;
}
async function json<T>(config: ReaderConfig, path: string, signal?: AbortSignal): Promise<T> {
 return (await (await request(config, path, signal)).json()) as T;
}

function fileLine(info: FileInfo): string {
 return `  attachment: ${info.name} (file_id: ${info.id}, ${info.mime_type || "unknown type"}, ${info.size} bytes)`;
}

export async function readMattermostLink(config: ReaderConfig, link: string, signal?: AbortSignal): Promise<ReaderResult> {
 const id = postIdFromLink(link, config.url);
 const target = await json<Post>(config, `/posts/${id}`, signal);
 const root = target.root_id || target.id;
 // Mattermost's unpaginated thread response contains the root and all replies.
 const thread = await json<PostList>(config, `/posts/${root}/thread`, signal);
 const posts = Object.values(thread.posts ?? {}).filter((post) => !post.delete_at);
 if (!posts.some((post) => post.id === target.id)) posts.push(target);
 posts.sort((a, b) => a.create_at - b.create_at || a.id.localeCompare(b.id));
 const selected = posts.slice(0, MAX_POSTS);
 const ids = [...new Set(selected.map((post) => post.user_id))];
 const users = new Map<string, string>();
 // Author lookup is best effort; the user id remains available if a profile is inaccessible.
 await Promise.all(ids.slice(0, 50).map(async (userId) => {
  try {
   const user = await json<{ username?: string }>(config, `/users/${userId}`, signal);
   if (user.username) users.set(userId, user.username);
  } catch { /* Keep user id. */ }
 }));
 let text = `Mattermost thread (${posts.length} posts; linked post: ${id}; root: ${root})\n`;
 const attachmentIds: string[] = [];
 let truncated = posts.length > selected.length || thread.has_next === true;
 for (const post of selected) {
  const postLink = `${config.url}/_redirect/pl/${post.id}`;
  const header = `\n[${new Date(post.create_at).toISOString()}] @${users.get(post.user_id) ?? post.user_id}${post.id === id ? " [linked post]" : ""} (post_id: ${post.id}; link: ${postLink})\n`;
  let block = header + post.message + "\n";
  if (post.file_ids?.length) {
   const infos = await json<FileInfo[]>(config, `/posts/${post.id}/files/info`, signal);
   block += infos.map((info) => { attachmentIds.push(info.id); return fileLine(info); }).join("\n") + "\n";
  }
  if (text.length + block.length > MAX_THREAD_CHARS) {
   text += block.slice(0, Math.max(0, MAX_THREAD_CHARS - text.length));
   truncated = true;
   break;
  }
  text += block;
 }
 if (truncated) text += "\n[Thread output truncated; not all posts or text shown.]";
 return { content: [{ type: "text", text }], details: { linkedPostId: id, rootPostId: root, postCount: posts.length, attachmentIds, truncated } };
}

async function boundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
 const declared = Number(response.headers.get("content-length"));
 if (declared > maxBytes) throw new Error(`Attachment exceeds ${maxBytes} byte limit`);
 const reader = response.body?.getReader();
 if (!reader) throw new Error("Empty attachment response");
 const chunks: Uint8Array[] = [];
 let total = 0;
 try {
  while (true) {
   const { done, value } = await reader.read();
   if (done) break;
   total += value.byteLength;
   if (total > maxBytes) throw new Error(`Attachment exceeds ${maxBytes} byte limit`);
   chunks.push(value);
  }
 } finally { await reader.cancel().catch(() => {}); }
 const data = new Uint8Array(total);
 let offset = 0;
 for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
 return data;
}

function imageMime(data: Uint8Array): ImageMime | undefined {
 const s = (start: number, end: number) => String.fromCharCode(...data.slice(start, end));
 if (s(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
 if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
 if (s(0, 6) === "GIF87a" || s(0, 6) === "GIF89a") return "image/gif";
 if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "image/webp";
}
function textFile(info: FileInfo): boolean {
 return /^text\//i.test(info.mime_type) || /^(application\/(json|xml|javascript|x-yaml|toml))$/i.test(info.mime_type)
  || /\.(txt|md|csv|json|ya?ml|xml|log|ts|tsx|js|jsx|py|go|rs|sh|html|css|sql)$/i.test(info.name);
}

export async function readMattermostAttachment(config: ReaderConfig, link: string, fileId: string, signal?: AbortSignal): Promise<ReaderResult> {
 const postId = postIdFromLink(link, config.url);
 if (!POST_ID.test(fileId)) throw new Error("Invalid Mattermost file ID");
 // Explicitly bind the requested file to the linked post (and the bot's read permission).
 await json<Post>(config, `/posts/${postId}`, signal);
 const infos = await json<FileInfo[]>(config, `/posts/${postId}/files/info`, signal);
 const info = infos.find((file) => file.id === fileId);
 if (!info) throw new Error("Attachment is not on the linked post (or the bot cannot read it)");
 if (info.size > MAX_FILE_BYTES) throw new Error(`Attachment exceeds ${MAX_FILE_BYTES} byte limit`);
 const response = await request(config, `/files/${fileId}`, signal);
 const data = await boundedBytes(response, MAX_FILE_BYTES);
 const details = { postId, fileId, name: info.name, mimeType: info.mime_type, size: data.byteLength };
 const detectedImage = imageMime(data);
 if (detectedImage) {
  if (data.byteLength > MAX_IMAGE_BYTES) throw new Error(`Image exceeds ${MAX_IMAGE_BYTES} byte limit`);
  return { content: [{ type: "text", text: `Mattermost image attachment: ${info.name} (${fileId})` },
   { type: "image", data: Buffer.from(data).toString("base64"), mimeType: detectedImage }], details };
 }
 if (data.slice(0, 5).every((byte, i) => byte === [37, 80, 68, 70, 45][i])) {
  const pdf = await extractPdfText(data, { signal });
  return { content: [{ type: "text", text: `Mattermost PDF attachment: ${info.name} (${fileId})\n${pdf.text}${pdf.truncated ? "\n[PDF text truncated]" : ""}` }], details: { ...details, pagesRead: pdf.pagesRead, totalPages: pdf.totalPages, truncated: pdf.truncated } };
 }
 if (!textFile(info)) throw new Error(`Unsupported attachment type: ${info.mime_type || info.name} (supports text, PDF, PNG, JPEG, GIF, WebP)`);
 let text: string;
 try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
 catch { throw new Error("Attachment is not valid UTF-8 text"); }
 if (text.includes("\0")) throw new Error("Attachment contains binary data, not text");
 const truncated = text.length > MAX_TEXT_CHARS;
 return { content: [{ type: "text", text: `Mattermost text attachment: ${info.name} (${fileId})\n${text.slice(0, MAX_TEXT_CHARS)}${truncated ? "\n[Text truncated]" : ""}` }], details: { ...details, truncated } };
}
