import * as fs from "node:fs";
import * as path from "node:path";

/** SDK hosts have their own argv[1]; never relaunch that host as a Pi child. */
export function getPiInvocation(
	args: string[],
	packageDir: string,
	execPath = process.execPath,
	currentScript = process.argv[1],
): { command: string; args: string[] } {
	// A compiled Pi binary has no CLI file on the real filesystem.
	if (currentScript?.startsWith("/$bunfs/root/")) {
		return { command: execPath, args };
	}

	const metadata = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
	const cli = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.pi;
	if (typeof cli === "string") {
		const cliPath = path.resolve(packageDir, cli);
		if (fs.existsSync(cliPath)) return { command: execPath, args: [cliPath, ...args] };
	}
	// Source checkouts or other installation layouts may expose Pi only on PATH.
	return { command: "pi", args };
}
