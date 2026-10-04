import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPiRuntimeResolver, managedPiPackageDir } from "./runtime-paths.ts";

function fixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "pi-runtime-paths-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("managed runtime uses the current version rather than a pinned release", () => fixture((root) => {
  writeFileSync(join(root, "current-version"), "0.99.1\n");
  assert.equal(managedPiPackageDir(root), join(root, "releases/0.99.1/node_modules/@earendil-works/pi-coding-agent"));
  writeFileSync(join(root, "current-version"), "1.0.0\n");
  assert.equal(managedPiPackageDir(root), join(root, "releases/1.0.0/node_modules/@earendil-works/pi-coding-agent"));
}));

test("missing or unsafe managed versions fail instead of choosing another installation", () => fixture((root) => {
  assert.throws(() => managedPiPackageDir(root), /ENOENT/);
  for (const version of ["", ".", "..", "../other", "/other", "two versions"]) {
    writeFileSync(join(root, "current-version"), version);
    assert.throws(() => managedPiPackageDir(root), /Invalid managed Pi version/);
  }
}));

test("host imports resolve from the selected package and pi-ai uses the compat entry", () => fixture((root) => {
  const pi = join(root, "node_modules/@earendil-works/pi-coding-agent");
  const ai = join(root, "node_modules/@earendil-works/pi-ai");
  mkdirSync(pi, { recursive: true }); mkdirSync(ai, { recursive: true });
  writeFileSync(join(pi, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", exports: "./index.js" }));
  writeFileSync(join(pi, "index.js"), "");
  writeFileSync(join(ai, "package.json"), JSON.stringify({ name: "@earendil-works/pi-ai", exports: { ".": "./index.js", "./compat": "./compat.js" } }));
  writeFileSync(join(ai, "index.js"), ""); writeFileSync(join(ai, "compat.js"), "");
  const resolveHost = createPiRuntimeResolver(pi, (specifier, directory) => createRequire(join(directory, "package.json")).resolve(specifier));
  assert.equal(resolveHost("@earendil-works/pi-coding-agent"), join(pi, "index.js"));
  assert.equal(resolveHost("@earendil-works/pi-ai"), join(ai, "compat.js"));
  assert.throws(() => resolveHost("@earendil-works/pi-tui"), /Cannot find module/);
}));

test("an unrelated package cannot be used as the Pi runtime", () => fixture((root) => {
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "other" }));
  assert.throws(() => createPiRuntimeResolver(root, () => { throw new Error("must not resolve"); }), /Expected an installed/);
}));
