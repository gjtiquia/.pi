import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { ExcalidrawPlusClient, extractSceneText, saveSceneFiles, saveSceneList } from "./client.ts";

const OUTPUT_RESERVED_BYTES = 4 * 1024;
const OUTPUT_RESERVED_LINES = 20;
const CONTENT_MAX_BYTES = DEFAULT_MAX_BYTES - OUTPUT_RESERVED_BYTES;
const CONTENT_MAX_LINES = DEFAULT_MAX_LINES - OUTPUT_RESERVED_LINES;
const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), ".env");

function readApiKey(): string {
	let values: Record<string, string>;
	try {
		values = parseEnv(readFileSync(ENV_PATH, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error("Excalidraw+ is not configured. Copy .env.example to .env and add EXCALIDRAW_API_KEY");
		}
		throw new Error(`Could not load excalidraw-plus/.env: ${error instanceof Error ? error.message : String(error)}`);
	}
	const apiKey = values.EXCALIDRAW_API_KEY?.trim();
	if (!apiKey) throw new Error("Excalidraw+ is not configured. Add EXCALIDRAW_API_KEY to excalidraw-plus/.env");
	return apiKey;
}

export default function excalidrawPlusExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "list_excalidraw_scenes",
		label: "List Excalidraw+ Scenes",
		description:
			"List read-accessible Excalidraw+ scenes, optionally filtered by title, ID, or collection. Returns titles, IDs, updated dates, and private/shared status. Output is limited to 50KB/2000 lines with the complete list saved when truncated.",
		promptSnippet: "List and find available Excalidraw+ scenes",
		promptGuidelines: [
			"Use list_excalidraw_scenes when the user wants to browse or find Excalidraw+ scenes without knowing a title or ID.",
		],
		parameters: Type.Object({
			query: Type.Optional(
				Type.String({
					description: "Optional case-insensitive title, scene ID, or collection filter",
					maxLength: 500,
				}),
			),
		}),

		async execute(_toolCallId, params, signal) {
			const client = new ExcalidrawPlusClient(readApiKey());
			const allScenes = await client.listScenes(signal);
			const query = params.query?.trim().toLocaleLowerCase();
			const scenes = allScenes
				.filter((scene) => {
					if (!query) return true;
					const metadata = scene.metadata;
					return [metadata.name, metadata.id, metadata.collection].some(
						(value) => typeof value === "string" && value.toLocaleLowerCase().includes(query),
					);
				})
				.sort((left, right) => String(right.metadata.updated ?? "").localeCompare(String(left.metadata.updated ?? "")));
			const list =
				scenes.length === 0
					? "(No matching scenes)\n"
					: `${scenes
							.map(({ metadata }) => {
								const title = (metadata.name?.replace(/\s+/g, " ").trim() || "Untitled").slice(0, 200);
								const visibility = metadata.isPrivate ? "private" : "shared";
								const updated = metadata.updated ? ` | updated: ${metadata.updated}` : "";
								const collection = metadata.collection ? ` | collection: ${metadata.collection}` : "";
								return `- ${title} | id: ${metadata.id} | ${visibility}${updated}${collection}`;
							})
							.join("\n")}\n`;
			const truncation = truncateHead(list, { maxBytes: CONTENT_MAX_BYTES, maxLines: CONTENT_MAX_LINES });
			let listPath: string | undefined;
			if (truncation.truncated) listPath = await saveSceneList(scenes);
			const displayedQuery = params.query?.trim().replace(/\s+/g, " ").slice(0, 200);
			const heading = [
				`Excalidraw+ scenes: ${scenes.length}${query ? ` matching “${displayedQuery}”` : ""} (${allScenes.length} accessible total)`,
				...(listPath ? [`Complete scene metadata: ${listPath}`] : []),
			];
			if (truncation.truncated) {
				heading.push(
					`List below is truncated to ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`,
				);
			}
			return {
				content: [{ type: "text" as const, text: `${heading.join("\n")}\n\n${truncation.content}` }],
				details: {
					total: allScenes.length,
					matched: scenes.length,
					query: params.query?.trim() || null,
					listPath: listPath ?? null,
				},
			};
		},
	});

	pi.registerTool({
		name: "read_excalidraw",
		label: "Read Excalidraw+",
		description:
			"Read an Excalidraw+ scene by ID, URL, or title. Returns the rendered screenshot and scene text, and saves the complete raw .excalidraw JSON locally. Read-only; text output is limited to 50KB/2000 lines with full text saved to a file.",
		promptSnippet: "Read Excalidraw+ scenes as rendered images, text, and raw scene JSON",
		promptGuidelines: [
			"Use read_excalidraw when the user asks to inspect, explain, summarize, or reference an Excalidraw+ scene.",
		],
		parameters: Type.Object({
			scene: Type.String({ description: "Scene ID, Excalidraw+ URL, or exact/partial scene title" }),
		}),

		async execute(_toolCallId, params, signal) {
			const client = new ExcalidrawPlusClient(readApiKey());
			const scene = await client.resolveScene(params.scene, signal);
			const sceneId = scene.metadata.id;
			const content = await client.getSceneContent(sceneId, signal);
			const text = extractSceneText(content);

			let screenshot: Awaited<ReturnType<ExcalidrawPlusClient["takeScreenshot"]>> | undefined;
			let screenshotError: string | undefined;
			try {
				screenshot = await client.takeScreenshot(sceneId, signal);
			} catch (error) {
				if ((error as Error).name === "AbortError") throw error;
				screenshotError = error instanceof Error ? error.message : String(error);
			}

			const files = await saveSceneFiles(sceneId, content, text, screenshot);
			const truncation = truncateHead(text, { maxBytes: CONTENT_MAX_BYTES, maxLines: CONTENT_MAX_LINES });
			const title = scene.metadata.name?.trim() || "Untitled";
			const elementCount = (content.elements ?? []).filter((element) => element && element.isDeleted !== true).length;
			const notes = [
				`Excalidraw+ scene: ${title}`,
				`Scene ID: ${sceneId}`,
				`Elements: ${elementCount}`,
				`Raw scene: ${files.rawPath}`,
				`Full extracted text: ${files.textPath}`,
				...(files.imagePath ? [`Rendered image: ${files.imagePath}`] : []),
				...(screenshot?.darkModeRequested ? ["Screenshot theme: dark requested from the hosted renderer"] : []),
				...(screenshot?.warning ? [`Screenshot warning: ${screenshot.warning}`] : []),
				...(screenshotError ? [`Screenshot unavailable: ${screenshotError}`] : []),
			];
			if (truncation.truncated) {
				notes.push(
					`Text below is truncated to ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}); use ${files.textPath} for the remainder.`,
				);
			}

			return {
				content: [
					{ type: "text" as const, text: `${notes.join("\n")}\n\nScene text (top-to-bottom):\n${truncation.content}` },
					...(screenshot
						? [{ type: "image" as const, data: screenshot.data, mimeType: screenshot.mimeType }]
						: []),
				],
				details: {
					sceneId,
					title,
					elementCount,
					rawPath: files.rawPath,
					textPath: files.textPath,
					imagePath: files.imagePath ?? null,
					darkModeRequested: screenshot?.darkModeRequested ?? false,
					screenshotError: screenshotError ?? null,
				},
			};
		},
	});
}
