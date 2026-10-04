import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const envPath = new URL("../../agentmail/.env", import.meta.url);
const OUTPUT_CHAR_LIMIT = 30_000;

export function readConfig() {
	let env;
	try {
		env = parseEnv(readFileSync(envPath, "utf8"));
	} catch {
		throw new Error("Could not read agent/agentmail/.env. Copy .env.example and configure it.");
	}
	const required = (name) => {
		const value = env[name]?.trim();
		if (!value) throw new Error(`Set ${name} in agent/agentmail/.env`);
		return value;
	};
	return {
		apiKey: required("AGENTMAIL_API_KEY"),
		inboxId: required("AGENTMAIL_INBOX_ID"),
		publicEmail: required("AGENTMAIL_PUBLIC_EMAIL"),
	};
}

// No arbitrary URL, inbox selector, or mutation operation is exposed.
export async function readMessages(config, params, signal, fetchImpl = fetch) {
	const { messageId, limit = 10, pageToken, after } = params;
	if (messageId !== undefined && (typeof messageId !== "string" || !messageId.trim() || messageId === "." || messageId === "..")) {
		throw new Error("A non-empty message ID is required.");
	}
	if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Limit must be 1–50.");
	if (after !== undefined && !Number.isFinite(Date.parse(after))) throw new Error("Invalid after datetime.");
	const url = new URL(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(config.inboxId)}/messages${messageId === undefined ? "" : `/${encodeURIComponent(messageId)}`}`);
	if (messageId === undefined) {
		url.searchParams.set("limit", String(limit));
		if (pageToken) url.searchParams.set("page_token", pageToken);
		if (after) url.searchParams.set("after", after);
	}
	const timeout = AbortSignal.timeout(20000);
	let response;
	try {
		response = await fetchImpl(url, {
			method: "GET",
			headers: { Authorization: `Bearer ${config.apiKey}` },
			redirect: "error",
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
	} catch {
		if (signal?.aborted) throw new Error("AgentMail read cancelled.");
		throw new Error("AgentMail read failed: network error or timeout.");
	}
	if (!response.ok) throw new Error(`AgentMail read failed: HTTP ${response.status}. Check the inbox ID and read-only key permissions.`);
	let data;
	try {
		data = await response.json();
	} catch {
		throw new Error("AgentMail returned an invalid JSON response.");
	}
	const result = { publicEmail: config.publicEmail, inboxId: config.inboxId, data };
	const text = JSON.stringify(result, null, 2);
	const truncated = text.length > OUTPUT_CHAR_LIMIT;
	const isMessage = messageId !== undefined;
	const notice = isMessage
		? `[Message output truncated: only the first ${OUTPUT_CHAR_LIMIT} serialized characters are included; the remaining body is not available in this result.]`
		: `[Listing output truncated: only the first ${OUTPUT_CHAR_LIMIT} serialized characters are included; not all messages or fields are shown. Reduce the limit, use after/pageToken filters, or read individual messages.]`;
	return {
		content: [{ type: "text", text: truncated ? `${text.slice(0, OUTPUT_CHAR_LIMIT)}\n${notice}` : text }],
		details: { publicEmail: config.publicEmail, inboxId: config.inboxId, truncated, outputLimit: OUTPUT_CHAR_LIMIT },
	};
}
