import { markdownCodeBlock } from "../activity/status-tracker.js";
import { diffFiles } from "./diff-files.js";

export const DIFF_POST_LIMIT = 14_000;

export async function* diffReplies(cwd: string) {
	let changed = false;
	for await (const file of diffFiles(cwd)) {
		changed = true;
		yield* fileReplies(file);
	}
	if (!changed) yield "No changes.";
}

export function fileReplies(file: { path: string; statusLine: string; blocks: { command: string; output: string }[] }, limit = DIFF_POST_LIMIT): string[] {
	const heading = JSON.stringify(file.path);
	const blockFor = (command: string, part: string) => markdownCodeBlock(`$ # ${file.statusLine}\n$ ${command}\n${part.replace(/\n$/, "")}`);
	if (file.blocks.reduce((size, b) => size + b.command.length + b.output.length, 0) <= limit) {
		const whole = file.blocks.map(b => blockFor(b.command, b.output)).join("\n\n");
		if (whole.length <= limit) return [whole];
	}
	const pages: string[] = [];
	for (const { command, output } of file.blocks) {
		const block = (part: string) => blockFor(command, part);
		// Reserve the filename and enough digits for both part numbers before splitting.
		const budget = limit - heading.length - 26;
		let offset = 0;
		do {
			let low = 0, high = Math.min(output.length - offset, budget);
			while (low < high) {
				const mid = Math.ceil((low + high) / 2);
				if (block(output.slice(offset, offset + mid)).length <= budget) low = mid;
				else high = mid - 1;
			}
			if (low === 0 && (offset < output.length || block("").length > budget)) throw new Error("Diff command is too long for a post");
			let end = offset + low;
			if (end < output.length) {
				const newline = output.slice(offset, end).lastIndexOf("\n");
				if (newline >= 0) end = offset + newline + 1;
				else if (/[\uDC00-\uDFFF]/.test(output[end])) end--;
			}
			if (end === offset && offset < output.length) throw new Error("Diff line cannot fit in a post");
			pages.push(block(output.slice(offset, end)));
			offset = end;
		} while (offset < output.length);
	}
	return pages.map((body, i) => pages.length === 1 ? body : `${heading} (${i + 1}/${pages.length})\n${body}`);
}
