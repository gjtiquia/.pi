import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

export type ProjectHooks = {
  AfterCreateWorktreeCommand?: string;
  BeforeJobCommand?: string;
};
export type HookField = keyof ProjectHooks;
export type InitProjectHooksResult = { path: string; changedFields: HookField[] };

const execFileAsync = promisify(execFile);
const hookFields: HookField[] = ["AfterCreateWorktreeCommand", "BeforeJobCommand"];

export async function initProjectHooks(cwd: string, hooks: ProjectHooks): Promise<InitProjectHooksResult> {
  const explicitFields = hookFields.filter(field => Object.hasOwn(hooks, field) && hooks[field] !== undefined);
  if (explicitFields.length === 0) throw new Error("At least one explicit hook is required");
  for (const field of explicitFields) {
    if (typeof hooks[field] !== "string") throw new Error(`${field} must be a string`);
  }
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
  const path = join(stdout.trim(), ".remote-runner.json");
  return withFileMutationQueue(path, async () => {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`${path} must contain a JSON object`);
    }
    const changedFields: HookField[] = [];
    for (const field of explicitFields) {
      if (config[field] !== hooks[field]) {
        config[field] = hooks[field];
        changedFields.push(field);
      }
    }
    if (changedFields.length > 0) {
      await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
    }
    return { path, changedFields };
  });
}
