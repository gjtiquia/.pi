// Keep the transport's per-post budget without discarding activity. Fenced blocks
// are closed and reopened across posts so oversized commands remain readable.
export const MAX_ACTIVITY_POST_CHARS = 14_000;

export function splitActivityText(text: string, maxChars = MAX_ACTIVITY_POST_CHARS): string[] {
	if (text.length <= maxChars) return [text];
	// Pathological fences can themselves fill a post. Preserve their literal
	// text instead of failing the entire activity run to balance Markdown.
	if (text.split("\n").some((line) => /^`{3,}[^`]*$/.test(line) && line.length * 2 + 3 >= maxChars)) {
		const parts: string[] = [];
		let remaining = text;
		while (remaining) {
			let length = Math.min(maxChars, remaining.length);
			if (length < remaining.length && /[\uD800-\uDBFF]/.test(remaining[length - 1])) length--;
			if (length <= 0) throw new Error("Activity post size budget is too small");
			parts.push(remaining.slice(0, length));
			remaining = remaining.slice(length);
		}
		return parts;
	}
	const chunks: string[] = [];
	let chunk = "";
	let fence: { close: string; open: string } | undefined;
	const flush = () => {
		chunks.push(chunk + (fence ? `\n${fence.close}` : ""));
		chunk = fence ? `${fence.open}\n` : "";
	};
	for (const line of text.split(/(?<=\n)/)) {
		const match = /^(`{3,})([^`\n]*)\n?$/.exec(line);
		const closing = fence && line.trimEnd() === fence.close;
		if (closing) {
			if (chunk.length + line.length > maxChars) flush();
			chunk += line;
			fence = undefined;
			continue;
		}
		if (!fence && match) {
			const nextFence = { close: match[1], open: line.trimEnd() };
			if (chunk.length + line.length + nextFence.close.length + 1 > maxChars) flush();
			chunk += line;
			fence = nextFence;
			continue;
		}
		let remaining = line;
		while (remaining) {
			const reserve = fence ? fence.close.length + 1 : 0;
			let room = maxChars - chunk.length - reserve;
			if (remaining.length > room && chunk && !(fence && chunk.endsWith(`${fence.open}\n`))) {
				flush();
				room = maxChars - chunk.length - reserve;
			}
			let length = Math.min(room, remaining.length);
			// Do not split a Unicode surrogate pair between posts.
			if (length < remaining.length && /[\uD800-\uDBFF]/.test(remaining[length - 1])) length--;
			if (length <= 0) throw new Error("Activity post size budget is too small");
			chunk += remaining.slice(0, length);
			remaining = remaining.slice(length);
			if (remaining) flush();
		}
	}
	if (chunk) chunks.push(chunk);
	return chunks;
}

export interface ActivityPostUpdate {
	message: string;
	newPost: boolean;
}

export class ActivityPostBuffer {
	private message = "";
	private lastUpdate: string | undefined;

	constructor(private readonly maxChars = MAX_ACTIVITY_POST_CHARS) {}

	append(text: string): ActivityPostUpdate[] {
		if (text === this.lastUpdate) return [];
		this.lastUpdate = text;
		const updates: ActivityPostUpdate[] = [];
		for (const part of splitActivityText(text, this.maxChars)) {
			const combined = this.message ? `${this.message}\n${part}` : part;
			const newPost = !this.message || combined.length > this.maxChars;
			this.message = newPost ? part : combined;
			updates.push({ message: this.message, newPost });
		}
		return updates;
	}
}
