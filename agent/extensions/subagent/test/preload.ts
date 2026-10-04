import { mock } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPiRuntimeResolver, managedPiPackageDir } from "./runtime-paths.ts";

// Test-only equivalent of Pi's host-module aliases. Production uses Pi's loader.
const installRoot = process.env.PI_MANAGED_INSTALL_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../install");
let resolveHost: (specifier: string) => string;
try {
  resolveHost = createPiRuntimeResolver(process.env.PI_TEST_PACKAGE_DIR ?? managedPiPackageDir(installRoot), (specifier, directory) => Bun.resolveSync(specifier, directory));
} catch (error) {
  throw new Error("Cannot locate the installed Pi runtime for subagent tests. Set PI_TEST_PACKAGE_DIR to its @earendil-works/pi-coding-agent package directory.", { cause: error });
}

export { resolveHost };

// Bun's module registry aliases these names to the real host exports, not stubs.
// Register before index.ts is imported; only the existing fake CLI is mocked.
for (const specifier of ["@earendil-works/pi-ai", "@earendil-works/pi-tui", "typebox", "@earendil-works/pi-coding-agent"]) {
  const exports = await import(resolveHost(specifier));
  mock.module(specifier, () => exports);
}
