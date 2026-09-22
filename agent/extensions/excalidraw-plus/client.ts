import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const API_BASE_URL = "https://api.excalidraw.com/api/v1";
export const MCP_URL = `${API_BASE_URL}/mcp`;
const PAGE_SIZE = 50;
const MCP_PROTOCOL_VERSION = "2025-03-26";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface SceneMetadata {
	id: string;
	name?: string;
	updated?: string;
	previewUrl?: string;
	previewBackground?: string;
	isDeleted?: boolean;
	isPrivate?: boolean;
	collection?: string;
	[key: string]: unknown;
}

export interface SceneListItem {
	metadata: SceneMetadata;
	readOnlyLinks?: unknown[];
	sharedSlidesLinks?: unknown[];
}

export interface SceneContent {
	type?: string;
	version?: number;
	source?: string;
	appState?: Record<string, unknown>;
	elements?: Array<Record<string, unknown> | null>;
	sceneVersion?: string;
	files?: Record<string, unknown>;
	[key: string]: unknown;
}

interface PaginatedScenes {
	data: SceneListItem[];
	offset: number;
	limit: number;
	hasNextPage: boolean;
}

interface RpcError {
	code: number;
	message: string;
	data?: unknown;
}

interface RpcResponse {
	jsonrpc: "2.0";
	id?: string | number | null;
	result?: unknown;
	error?: RpcError;
}

export interface ScreenshotResult {
	data: string;
	mimeType: string;
	darkModeRequested: boolean;
	warning?: string;
}

export interface SavedSceneFiles {
	directory: string;
	rawPath: string;
	textPath: string;
	imagePath?: string;
}

class HttpError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function responseError(response: Response): Promise<HttpError> {
	const body = (await response.text()).trim();
	let detail = body;
	try {
		const parsed = JSON.parse(body) as { message?: string; error?: string };
		detail = parsed.message ?? parsed.error ?? body;
	} catch {
		// Keep the response text.
	}
	return new HttpError(response.status, `Excalidraw+ ${response.status}${detail ? `: ${detail}` : ""}`);
}

function boundedSignal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class ExcalidrawPlusClient {
	private readonly apiKey: string;
	private readonly fetchImpl: typeof fetch;
	private mcpSessionId: string | undefined;

	constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
		this.apiKey = apiKey;
		this.fetchImpl = fetchImpl;
	}

	private async api<T>(path: string, signal?: AbortSignal): Promise<T> {
		const response = await this.fetchImpl(`${API_BASE_URL}${path}`, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
			signal: boundedSignal(signal),
		});
		if (!response.ok) throw await responseError(response);
		return (await response.json()) as T;
	}

	async listScenes(signal?: AbortSignal): Promise<SceneListItem[]> {
		const scenes: SceneListItem[] = [];
		let offset = 0;
		for (;;) {
			const page = await this.api<PaginatedScenes>(`/scenes?offset=${offset}&limit=${PAGE_SIZE}`, signal);
			scenes.push(...page.data.filter((scene) => !scene.metadata.isDeleted));
			if (!page.hasNextPage || page.data.length === 0) return scenes;
			offset += page.limit || page.data.length;
		}
	}

	async getSceneMetadata(sceneId: string, signal?: AbortSignal): Promise<SceneListItem> {
		return this.api<SceneListItem>(`/scenes/${encodeURIComponent(sceneId)}`, signal);
	}

	async getSceneContent(sceneId: string, signal?: AbortSignal): Promise<SceneContent> {
		return this.api<SceneContent>(`/scenes/${encodeURIComponent(sceneId)}/content`, signal);
	}

	async resolveScene(reference: string, signal?: AbortSignal): Promise<SceneListItem> {
		const value = reference.trim();
		if (!value) throw new Error("Scene reference cannot be empty");

		for (const candidate of sceneIdCandidates(value)) {
			try {
				const scene = await this.getSceneMetadata(candidate, signal);
				if (!scene.metadata.isDeleted) return scene;
			} catch (error) {
				if (!(error instanceof HttpError) || (error.status !== 400 && error.status !== 404)) throw error;
			}
		}

		const scenes = await this.listScenes(signal);
		const linked = scenes.filter((scene) => sceneMatchesLink(scene, value, sceneIdCandidates(value)));
		if (linked.length === 1) return linked[0]!;
		if (linked.length > 1) throw ambiguousSceneError(value, linked);

		const normalized = value.toLocaleLowerCase();
		const exact = scenes.filter((scene) => scene.metadata.name?.toLocaleLowerCase() === normalized);
		if (exact.length === 1) return exact[0]!;
		if (exact.length > 1) throw ambiguousSceneError(value, exact);

		const partial = scenes.filter((scene) => scene.metadata.name?.toLocaleLowerCase().includes(normalized));
		if (partial.length === 1) return partial[0]!;
		if (partial.length > 1) throw ambiguousSceneError(value, partial);
		throw new Error(`No Excalidraw+ scene matched “${value}”`);
	}

	private async postMcp(
		message: unknown,
		signal?: AbortSignal,
		protocolVersion?: string,
		expectedId?: number,
	): Promise<RpcResponse | undefined> {
		const response = await this.fetchImpl(MCP_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				...(protocolVersion ? { "MCP-Protocol-Version": protocolVersion } : {}),
				...(this.mcpSessionId ? { "Mcp-Session-Id": this.mcpSessionId } : {}),
			},
			body: JSON.stringify(message),
			signal: boundedSignal(signal),
		});
		const sessionId = response.headers.get("mcp-session-id");
		if (sessionId) this.mcpSessionId = sessionId;
		if (response.status === 202 || response.status === 204) return;
		if (!response.ok) throw await responseError(response);
		const body = await response.text();
		const contentType = response.headers.get("content-type") ?? "";
		const rpc = contentType.includes("application/json")
			? (JSON.parse(body) as RpcResponse)
			: contentType.includes("text/event-stream")
				? parseSseRpcResponse(body, expectedId)
				: undefined;
		if (!rpc) throw new Error(`Excalidraw+ MCP returned unsupported content type: ${contentType || "unknown"}`);
		if (expectedId !== undefined && rpc.id !== expectedId) {
			throw new Error(`Excalidraw+ MCP returned response ID ${String(rpc.id)}; expected ${expectedId}`);
		}
		return rpc;
	}

	private async mcpRequest(
		id: number,
		method: string,
		params: unknown,
		signal?: AbortSignal,
		protocolVersion?: string,
	): Promise<unknown> {
		const response = await this.postMcp({ jsonrpc: "2.0", id, method, params }, signal, protocolVersion, id);
		if (!response) throw new Error(`Excalidraw+ MCP returned no response for ${method}`);
		if (response.error) throw new Error(`Excalidraw+ MCP: ${response.error.message}`);
		return response.result;
	}

	async takeScreenshot(sceneId: string, signal?: AbortSignal): Promise<ScreenshotResult> {
		this.mcpSessionId = undefined;
		const initializeResult = await this.mcpRequest(
			1,
			"initialize",
			{
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "pi-excalidraw-plus", version: "1.0.0" },
			},
			signal,
		);
		const protocolVersion =
			isRecord(initializeResult) && typeof initializeResult.protocolVersion === "string"
				? initializeResult.protocolVersion
				: MCP_PROTOCOL_VERSION;
		await this.postMcp(
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			signal,
			protocolVersion,
		);

		const toolsResult = await this.mcpRequest(2, "tools/list", {}, signal, protocolVersion);
		const screenshotTool = findTool(toolsResult, "take_screenshot");
		if (!screenshotTool) {
			throw new Error("The API key does not expose the Excalidraw+ take_screenshot tool; check its read permissions");
		}

		const properties = inputSchemaProperties(screenshotTool);
		const arguments_: Record<string, unknown> = { sceneId, maxWidth: 1600, padding: 20 };
		let darkModeRequested = false;
		for (const key of ["darkMode", "exportWithDarkMode"] as const) {
			if (isBooleanSchema(properties[key])) {
				arguments_[key] = true;
				darkModeRequested = true;
			}
		}
		if (schemaAllowsDark(properties.theme)) {
			arguments_.theme = "dark";
			darkModeRequested = true;
		}

		const callResult = await this.mcpRequest(
			3,
			"tools/call",
			{ name: "take_screenshot", arguments: arguments_ },
			signal,
			protocolVersion,
		);
		if (isRecord(callResult) && callResult.isError === true) {
			throw new Error(`Excalidraw+ screenshot failed: ${textFromMcpResult(callResult) || "unknown error"}`);
		}
		const image = findMcpImage(callResult);
		if (!image) throw new Error("Excalidraw+ take_screenshot returned no supported inline PNG, JPEG, or WebP image");
		return {
			...image,
			darkModeRequested,
			...(darkModeRequested
				? {}
				: { warning: "Excalidraw+ currently exposes no screenshot-time dark-mode option; the hosted renderer chose the theme." }),
		};
	}
}

export function sceneIdCandidates(reference: string): string[] {
	const candidates: string[] = [];
	try {
		const url = new URL(reference);
		for (const key of ["sceneId", "scene", "id"]) {
			const value = url.searchParams.get(key);
			if (value) candidates.push(value);
		}
		const ignored = new Set(["scene", "scenes", "view", "readonly", "plus"]);
		const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
		for (let index = segments.length - 1; index >= 0; index -= 1) {
			const segment = segments[index]!;
			if (!ignored.has(segment.toLocaleLowerCase())) candidates.push(segment);
		}
	} catch {
		candidates.push(reference);
	}
	return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
}

function sceneMatchesLink(scene: SceneListItem, reference: string, candidates: string[]): boolean {
	const needles = new Set([reference, ...candidates].map((value) => value.toLocaleLowerCase()));
	for (const links of [scene.readOnlyLinks, scene.sharedSlidesLinks]) {
		for (const link of links ?? []) {
			if (!isRecord(link)) continue;
			for (const key of ["id", "preview", "previewPath"]) {
				const value = link[key];
				if (typeof value !== "string") continue;
				const normalized = value.toLocaleLowerCase();
				if (needles.has(normalized)) return true;
				try {
					const url = new URL(value);
					if (needles.has(url.href.toLocaleLowerCase())) return true;
					if (url.pathname.split("/").filter(Boolean).some((segment) => needles.has(decodeURIComponent(segment).toLocaleLowerCase()))) {
						return true;
					}
				} catch {
					// The value is an ID or relative preview path, not an absolute URL.
				}
			}
		}
	}
	return false;
}

function ambiguousSceneError(reference: string, scenes: SceneListItem[]): Error {
	const choices = scenes
		.slice(0, 10)
		.map((scene) => `${scene.metadata.name ?? "Untitled"} (${scene.metadata.id})`)
		.join(", ");
	return new Error(`Multiple Excalidraw+ scenes matched “${reference}”: ${choices}. Use a scene ID or URL.`);
}

export function extractSceneText(content: SceneContent): string {
	const entries = (content.elements ?? [])
		.filter((element): element is Record<string, unknown> => Boolean(element) && element!.isDeleted !== true)
		.flatMap((element) => {
			if (element.type === "text") {
				const text = typeof element.originalText === "string" ? element.originalText : element.text;
				return typeof text === "string" ? [{ element, text, kind: "text" }] : [];
			}
			if ((element.type === "frame" || element.type === "magicframe") && typeof element.name === "string" && element.name.trim()) {
				return [{ element, text: element.name, kind: "frame" }];
			}
			return [];
		})
		.sort(
			(left, right) =>
				numberValue(left.element.y) - numberValue(right.element.y) ||
				numberValue(left.element.x) - numberValue(right.element.x),
		);

	if (entries.length === 0) return "(No text elements or frame names)\n";
	return `${entries
		.map(({ element, text, kind }) => {
			const id = typeof element.id === "string" ? element.id : "unknown";
			const x = numberValue(element.x);
			const y = numberValue(element.y);
			return `[${kind} ${id} @ ${x},${y}] ${text}`;
		})
		.join("\n")}\n`;
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function saveSceneList(scenes: SceneListItem[]): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-excalidraw-plus-"));
	const listPath = join(directory, "scenes.json");
	await writeFile(listPath, `${JSON.stringify(scenes, null, 2)}\n`, { flag: "wx", mode: 0o600 });
	return listPath;
}

export async function saveSceneFiles(
	sceneId: string,
	content: SceneContent,
	text: string,
	screenshot?: { data: string; mimeType: string },
): Promise<SavedSceneFiles> {
	const safeId = sceneId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "scene";
	const directory = await mkdtemp(join(tmpdir(), "pi-excalidraw-plus-"));
	const rawPath = join(directory, `${safeId}.excalidraw`);
	const textPath = join(directory, `${safeId}.txt`);
	await Promise.all([
		writeFile(rawPath, `${JSON.stringify(content, null, 2)}\n`, { flag: "wx", mode: 0o600 }),
		writeFile(textPath, text, { flag: "wx", mode: 0o600 }),
	]);
	let imagePath: string | undefined;
	if (screenshot) {
		const extension = screenshot.mimeType === "image/jpeg" ? "jpg" : screenshot.mimeType === "image/webp" ? "webp" : "png";
		imagePath = join(directory, `${safeId}.${extension}`);
		await writeFile(imagePath, Buffer.from(screenshot.data, "base64"), { flag: "wx", mode: 0o600 });
	}
	return { directory, rawPath, textPath, ...(imagePath ? { imagePath } : {}) };
}

export function parseSseRpcResponse(body: string, expectedId?: number): RpcResponse {
	const responses = body
		.split(/\r?\n\r?\n/)
		.map((event) =>
			event
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n"),
		)
		.filter((data) => data && data !== "[DONE]")
		.map((data) => JSON.parse(data) as RpcResponse);
	const response = responses.find(
		(candidate) =>
			(candidate.result !== undefined || candidate.error !== undefined) &&
			(expectedId === undefined || candidate.id === expectedId),
	);
	if (!response) throw new Error("Excalidraw+ MCP SSE response contained no matching JSON-RPC result");
	return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findTool(result: unknown, name: string): Record<string, unknown> | undefined {
	if (!isRecord(result) || !Array.isArray(result.tools)) return;
	return result.tools.find((tool): tool is Record<string, unknown> => isRecord(tool) && tool.name === name);
}

function inputSchemaProperties(tool: Record<string, unknown>): Record<string, unknown> {
	if (!isRecord(tool.inputSchema) || !isRecord(tool.inputSchema.properties)) return {};
	return tool.inputSchema.properties;
}

function isBooleanSchema(value: unknown): boolean {
	return isRecord(value) && value.type === "boolean";
}

function schemaAllowsDark(value: unknown): boolean {
	return isRecord(value) && value.type === "string" && (!Array.isArray(value.enum) || value.enum.includes("dark"));
}

function textFromMcpResult(result: Record<string, unknown>): string {
	if (!Array.isArray(result.content)) return "";
	return result.content
		.filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "text")
		.map((block) => (typeof block.text === "string" ? block.text : ""))
		.filter(Boolean)
		.join("\n");
}

function findMcpImage(value: unknown): { data: string; mimeType: string } | undefined {
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findMcpImage(item);
			if (found) return found;
		}
		return;
	}
	if (!isRecord(value)) return;
	const mimeType = typeof value.mimeType === "string" ? value.mimeType : typeof value.mime_type === "string" ? value.mime_type : undefined;
	if (value.type === "image" && typeof value.data === "string" && mimeType && SUPPORTED_IMAGE_TYPES.has(mimeType)) {
		return validateInlineImage(value.data, mimeType);
	}
	for (const nested of Object.values(value)) {
		const found = findMcpImage(nested);
		if (found) return found;
	}
}

export function validateInlineImage(data: string, mimeType: string): { data: string; mimeType: string } | undefined {
	const normalized = data.replace(/\s+/g, "");
	if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return;
	const bytes = Buffer.from(normalized, "base64");
	if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return;
	const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
	const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	const isWebp =
		bytes.length >= 12 &&
		bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
		bytes.subarray(8, 12).toString("ascii") === "WEBP";
	if (
		(mimeType === "image/png" && !isPng) ||
		(mimeType === "image/jpeg" && !isJpeg) ||
		(mimeType === "image/webp" && !isWebp)
	) {
		return;
	}
	return { data: normalized, mimeType };
}
