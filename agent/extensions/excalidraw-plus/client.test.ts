import assert from "node:assert/strict";
import test from "node:test";
import {
	ExcalidrawPlusClient,
	extractSceneText,
	parseSseRpcResponse,
	sceneIdCandidates,
	validateInlineImage,
} from "./client.ts";

test("extractSceneText ignores deleted elements and sorts visually", () => {
	const text = extractSceneText({
		elements: [
			{ id: "second", type: "text", text: "Second", x: 5, y: 20 },
			{ id: "deleted", type: "text", text: "Deleted", x: 0, y: 0, isDeleted: true },
			{ id: "first", type: "text", text: "First", x: 10, y: 10 },
			{ id: "frame", type: "frame", name: "Overview", x: 0, y: 5 },
			{ id: "shape", type: "rectangle", x: 0, y: 0 },
		],
	});
	assert.equal(text, "[frame frame @ 0,5] Overview\n[text first @ 10,10] First\n[text second @ 5,20] Second\n");
});

test("sceneIdCandidates reads IDs from URLs and plain references", () => {
	assert.deepEqual(sceneIdCandidates("plain-id"), ["plain-id"]);
	assert.deepEqual(sceneIdCandidates("https://plus.excalidraw.com/scenes/abc123"), ["abc123"]);
	assert.equal(sceneIdCandidates("https://example.com/view/nope?sceneId=query-id")[0], "query-id");
});

test("parseSseRpcResponse returns the matching multiline JSON-RPC event", () => {
	const response = parseSseRpcResponse(
		"event: message\ndata: {\"jsonrpc\":\"2.0\",\ndata: \"id\":1,\"result\":{\"ok\":true}}\n\n",
		1,
	);
	assert.deepEqual(response.result, { ok: true });
});

test("parseSseRpcResponse rejects a different response ID", () => {
	assert.throws(
		() => parseSseRpcResponse("data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}\n\n", 1),
		/no matching JSON-RPC result/,
	);
});

test("validateInlineImage rejects malformed and mislabeled image data", () => {
	assert.equal(validateInlineImage("not base64!?", "image/png"), undefined);
	assert.equal(validateInlineImage(Buffer.from("plain text").toString("base64"), "image/png"), undefined);
	const pngHeader = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
	assert.deepEqual(validateInlineImage(pngHeader, "image/png"), { data: pngHeader, mimeType: "image/png" });
});

test("listScenes follows pagination and omits deleted scenes", async () => {
	let call = 0;
	const fetchMock = (async () => {
		call += 1;
		if (call === 1) {
			return Response.json({
				data: [
					{ metadata: { id: "scene-1", name: "One" } },
					{ metadata: { id: "deleted", name: "Deleted", isDeleted: true } },
				],
				offset: 0,
				limit: 2,
				hasNextPage: true,
			});
		}
		return Response.json({
			data: [{ metadata: { id: "scene-2", name: "Two" } }],
			offset: 2,
			limit: 2,
			hasNextPage: false,
		});
	}) as typeof fetch;
	const scenes = await new ExcalidrawPlusClient("secret", fetchMock).listScenes();
	assert.deepEqual(
		scenes.map((scene) => scene.metadata.id),
		["scene-1", "scene-2"],
	);
});

test("resolveScene maps a read-only link ID back to its scene", async () => {
	let call = 0;
	const fetchMock = (async () => {
		call += 1;
		if (call === 1) return Response.json({ message: "not found" }, { status: 404 });
		return Response.json({
			data: [
				{
					metadata: { id: "scene-1", name: "Architecture" },
					readOnlyLinks: [{ id: "share-123", previewPath: "/readonly/share-123" }],
				},
			],
			offset: 0,
			limit: 50,
			hasNextPage: false,
		});
	}) as typeof fetch;
	const scene = await new ExcalidrawPlusClient("secret", fetchMock).resolveScene(
		"https://link.excalidraw.com/readonly/share-123",
	);
	assert.equal(scene.metadata.id, "scene-1");
});

test("takeScreenshot carries the MCP session and requests a supported dark option", async () => {
	const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
	let call = 0;
	const fetchMock = (async (_input: string | URL | Request, init?: RequestInit) => {
		call += 1;
		const headers = new Headers(init?.headers);
		const request = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: Record<string, unknown> };
		if (call === 1) {
			assert.equal(request.method, "initialize");
			assert.equal(headers.get("mcp-session-id"), null);
			return Response.json(
				{ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26" } },
				{ headers: { "Mcp-Session-Id": "session-1" } },
			);
		}
		assert.equal(headers.get("mcp-session-id"), "session-1");
		if (call === 2) return new Response(null, { status: 202 });
		if (call === 3) {
			return Response.json({
				jsonrpc: "2.0",
				id: 2,
				result: {
					tools: [
						{
							name: "take_screenshot",
							inputSchema: { properties: { darkMode: { type: "boolean" } } },
						},
					],
				},
			});
		}
		const args = (request.params as { arguments: Record<string, unknown> }).arguments;
		assert.equal(args.darkMode, true);
		return Response.json({
			jsonrpc: "2.0",
			id: 3,
			result: { content: [{ type: "image", data: png, mimeType: "image/png" }] },
		});
	}) as typeof fetch;

	const result = await new ExcalidrawPlusClient("secret", fetchMock).takeScreenshot("scene-1");
	assert.equal(call, 4);
	assert.equal(result.darkModeRequested, true);
	assert.equal(result.data, png);
});
