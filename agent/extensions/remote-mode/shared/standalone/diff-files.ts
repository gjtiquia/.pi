import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const GIT_OPTIONS = ["--no-pager", "--literal-pathspecs", "-c", "core.fsmonitor=false"];
const STATUS_ARGS = ["status", "--porcelain=v1", "-z", "-uall"];
const CONFLICTS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

type DiffFile = {
	path: string;
	statusLine: string;
	blocks: { command: string; output: string }[];
};

export async function* diffFiles(cwd: string): AsyncGenerator<DiffFile> {
	const root = (await git(cwd, [...GIT_OPTIONS, "rev-parse", "--show-toplevel"])).replace(/\n$/, "");
	const directoryArgs = await realpath(cwd) === root ? [] : ["-C", root];
	// Keep raw paths for execution; let Git format the display paths, quoting and renames.
	const [statusOutput, displayOutput] = await Promise.all([
		git(root, [...GIT_OPTIONS, ...STATUS_ARGS]),
		git(cwd, [...GIT_OPTIONS, "-c", "color.status=false", "status", "-suall", "--no-branch", "--no-show-stash", "--no-column"]),
	]);
	const entries = [...statusEntries(statusOutput)];
	const lines = displayOutput ? displayOutput.replace(/\n$/, "").split("\n") : [];
	if (entries.length !== lines.length) throw new Error("Git status changed while collecting diffs; retry !diff all.");

	for (const [i, { status, path, source }] of entries.entries()) {
		const blocks: DiffFile["blocks"] = [];
		if (status === "??") {
			// Even with -uall, Git lists an untracked embedded repository as a directory.
			// Do not send its directory to --no-index, which can traverse it.
			if (path.endsWith("/")) {
				blocks.push(await runBlock(["status", "-suall"], [path]));
			} else {
				// The ./ prefix keeps a literal file named '-' from being interpreted as stdin.
				blocks.push(await diff(["--no-index"], ["/dev/null", path === "-" ? "./-" : path]));
			}
		} else if (CONFLICTS.has(status)) {
			// An unmerged index has no single staged version to diff against.
			blocks.push(await diff(["--cc"], [path]));
		} else {
			const [index, worktree] = status;
			if (index !== " ") blocks.push(await trackedDiff(index, ["--cached"]));
			if (worktree !== " ") blocks.push(await trackedDiff(worktree, []));
		}
		yield { path, statusLine: lines[i], blocks };

		function trackedDiff(change: string, options: string[]) {
			if (source !== undefined && change === "R") return diff([...options, "-M"], [source, path]);
			if (source !== undefined && change === "C") return diff([...options, "-C"], [source, path]);
			return diff(options, [path]);
		}
	}

	function diff(options: string[], paths: string[]) {
		return runBlock(["diff", ...options], paths);
	}

	async function runBlock(args: string[], paths: string[]) {
		const literal = !args.includes("--no-index") && paths.some(p => /^:|[*?\[\\]/.test(p));
		const argv = [...directoryArgs, "--no-pager", ...(literal ? ["--literal-pathspecs"] : []), ...args, "--", ...paths];
		const output = await git(cwd, argv, args.includes("--no-index"));
		return { command: ["git", ...argv.map(quote)].join(" "), output };
	}
}

function* statusEntries(output: string) {
	const fields = output ? output.slice(0, -1).split("\0") : [];
	for (let i = 0; i < fields.length;) {
		const entry = fields[i++];
		const status = entry.slice(0, 2);
		const path = entry.slice(3);
		// Unlike the human-readable format, porcelain -z places the destination first.
		const source = /[RC]/.test(status) ? fields[i++] : undefined;
		yield { status, path, source };
	}
}

function quote(arg: string): string {
	if (/^[a-zA-Z0-9_./-]+$/.test(arg)) return arg;
	return `'${arg.replace(/'/g, "'\\''")}'`;
}

async function git(cwd: string, args: string[], allowDifferences = false): Promise<string> {
	try {
		const { stdout } = await exec("git", args, {
			cwd,
			encoding: "utf8",
			maxBuffer: MAX_OUTPUT_BYTES,
			timeout: TIMEOUT_MS,
		});
		return stdout;
	} catch (error) {
		// git diff --no-index returns 1 when the two inputs differ.
		const failure = error as { code?: number; stdout?: string; stderr?: string };
		if (allowDifferences && failure.code === 1 && !failure.stderr) return failure.stdout ?? "";
		throw error;
	}
}
