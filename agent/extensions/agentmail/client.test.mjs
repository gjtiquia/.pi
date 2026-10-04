import test from "node:test";
import assert from "node:assert/strict";
import { readMessages } from "./client.mjs";

const config = { apiKey: "test-secret", inboxId: "private@agentmail.to", publicEmail: "public@example.com" };

test("listing is GET-only and bound to configured inbox, with pagination and date filter", async () => {
	const result = await readMessages(config, { inboxId: "other@agentmail.to", limit: 3, pageToken: "next", after: "2026-09-01T00:00:00Z" }, undefined, async (url, options) => {
		assert.equal(url.origin, "https://api.agentmail.to");
		assert.equal(decodeURIComponent(url.pathname), "/v0/inboxes/private@agentmail.to/messages");
		assert.equal(url.searchParams.get("limit"), "3");
		assert.equal(url.searchParams.get("page_token"), "next");
		assert.equal(url.searchParams.get("after"), "2026-09-01T00:00:00Z");
		assert.equal(options.method, "GET");
		assert.equal(options.redirect, "error");
		return Response.json({ messages: [] });
	});
	assert.equal(JSON.parse(result.content[0].text).publicEmail, config.publicEmail);
	assert.ok(!JSON.stringify(result).includes(config.apiKey));
});

test("message IDs cannot escape the configured inbox URL", async () => {
	await readMessages(config, { messageId: "../../other?x=#" }, undefined, async (url) => {
		assert.equal(url.pathname, "/v0/inboxes/private%40agentmail.to/messages/..%2F..%2Fother%3Fx%3D%23");
		assert.equal(url.search, "");
		return Response.json({ text: "An OTP" });
	});
});

test("errors do not echo server bodies, credentials, or network error details", async () => {
	await assert.rejects(readMessages(config, {}, undefined, async () => new Response(config.apiKey, { status: 403 })), /HTTP 403/);
	await assert.rejects(readMessages(config, {}, undefined, async () => { throw new Error(config.apiKey); }), /network error or timeout/);
	await assert.rejects(readMessages(config, { limit: 51 }), /Limit/);
	await assert.rejects(readMessages(config, { after: "not-a-date" }), /datetime/);
	await assert.rejects(readMessages(config, { messageId: "" }), /message ID/);
});

test("listing truncation identifies omitted messages and fields separately", async () => {
	const result = await readMessages(config, { limit: 50 }, undefined, async () => Response.json({
		messages: [{ id: "message", subject: "x".repeat(50000) }],
		next_page_token: "next",
	}));
	assert.equal(result.details.truncated, true);
	assert.equal(result.details.outputLimit, 30000);
	assert.match(result.content[0].text, /Listing output truncated: only the first 30000 serialized characters/);
	assert.match(result.content[0].text, /not all messages or fields are shown/);
	assert.doesNotMatch(result.content[0].text, /Message output truncated/);
});

test("message truncation identifies the unavailable body remainder", async () => {
	const result = await readMessages(config, { messageId: "message" }, undefined, async () => Response.json({ text: "x".repeat(50000) }));
	assert.equal(result.details.truncated, true);
	assert.equal(result.details.outputLimit, 30000);
	assert.ok(result.content[0].text.length > 30000);
	assert.match(result.content[0].text, /Message output truncated: only the first 30000 serialized characters/);
	assert.match(result.content[0].text, /remaining body is not available in this result/);
	assert.doesNotMatch(result.content[0].text, /Listing output truncated/);
});
