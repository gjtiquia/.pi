import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPiInvocation } from "./invocation.ts";

for (const runtime of ["/usr/bin/node", "/usr/bin/bun"]) {
	for (const host of ["/workspace/src/main.ts", "/package/dist/bundle/cli.js"]) {
		test(`${runtime} host ${host} launches the package CLI`, () => {
			const root = mkdtempSync(join(tmpdir(), "pi-invocation-"));
			try {
				mkdirSync(join(root, "dist", "bundle"), { recursive: true });
				writeFileSync(join(root, "package.json"), JSON.stringify({ bin: { pi: "dist/bundle/cli.js" } }));
				const cli = join(root, "dist", "bundle", "cli.js");
				writeFileSync(cli, "");
				const args = ["--mode", "json", "-p", "sleep 5"];
				assert.deepEqual(getPiInvocation(args, root, runtime, host), { command: runtime, args: [cli, ...args] });
				assert.deepEqual(args, ["--mode", "json", "-p", "sleep 5"]);
			} finally { rmSync(root, { recursive: true, force: true }); }
		});
	}
}

test("compiled Pi launches itself without its virtual script", () => {
	assert.deepEqual(getPiInvocation(["--mode", "json"], "/virtual", "/bin/pi", "/$bunfs/root/pi"), {
		command: "/bin/pi", args: ["--mode", "json"],
	});
});

test("missing CLI falls back to Pi on PATH, not the SDK host", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-invocation-"));
	try {
		writeFileSync(join(root, "package.json"), JSON.stringify({ bin: "missing.js" }));
		assert.deepEqual(getPiInvocation(["-p"], root, "/usr/bin/bun", "/workspace/src/main.ts"), { command: "pi", args: ["-p"] });
	} finally { rmSync(root, { recursive: true, force: true }); }
});
