import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Resolve host imports from one installed Pi package, without installing copies. */
export function createPiRuntimeResolver(packageDir: string, resolveImport: (specifier: string, directory: string) => string): (specifier: string) => string {
  const directory = realpathSync(packageDir);
  const manifest = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8"));
  if (manifest.name !== "@earendil-works/pi-coding-agent") {
    throw new Error(`Expected an installed @earendil-works/pi-coding-agent package at ${directory}`);
  }
  return (specifier) => resolveImport(specifier === "@earendil-works/pi-ai" ? "@earendil-works/pi-ai/compat" : specifier, directory);
}

export function managedPiPackageDir(installRoot: string): string {
  const version = readFileSync(resolve(installRoot, "current-version"), "utf8").trim();
  if (!/^[\w.+-]+$/.test(version) || version === "." || version === "..") {
    throw new Error(`Invalid managed Pi version in ${resolve(installRoot, "current-version")}`);
  }
  return resolve(installRoot, "releases", version, "node_modules/@earendil-works/pi-coding-agent");
}
