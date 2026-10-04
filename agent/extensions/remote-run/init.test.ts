import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProjectHooks } from "./init";

const temporaryDirectories: string[] = [];
async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "remote-run-init-"));
  temporaryDirectories.push(path);
  return path;
}
async function repository() {
  const root = await temporaryDirectory();
  execFileSync("git", ["init", "--quiet", root]);
  return root;
}
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

test("creates explicit project hooks at the checkout root from a nested cwd", async () => {
  const root = await repository();
  const nested = join(root, "src", "nested");
  await mkdir(nested, { recursive: true });
  const result = await initProjectHooks(nested, { BeforeJobCommand: "echo ready" });
  expect(result).toEqual({ path: join(root, ".remote-runner.json"), changedFields: ["BeforeJobCommand"] });
  expect(JSON.parse(await readFile(result.path, "utf8"))).toEqual({ BeforeJobCommand: "echo ready" });
});

test("refuses a cwd outside a Git checkout without creating configuration", async () => {
  const cwd = await temporaryDirectory();
  await expect(initProjectHooks(cwd, { BeforeJobCommand: "echo ready" })).rejects.toThrow();
  await expect(readFile(join(cwd, ".remote-runner.json"), "utf8")).rejects.toThrow();
});

test("updates the actual linked worktree instead of the primary checkout", async () => {
  const root = await repository();
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "test"], { cwd: root });
  const worktree = join(await temporaryDirectory(), "checkout");
  execFileSync("git", ["worktree", "add", "--quiet", "--detach", worktree], { cwd: root });
  const result = await initProjectHooks(worktree, { AfterCreateWorktreeCommand: "" });
  expect(result).toEqual({ path: join(worktree, ".remote-runner.json"), changedFields: ["AfterCreateWorktreeCommand"] });
  expect(JSON.parse(await readFile(result.path, "utf8"))).toEqual({ AfterCreateWorktreeCommand: "" });
  await expect(readFile(join(root, ".remote-runner.json"), "utf8")).rejects.toThrow();
});

test("concurrent updates to different hooks preserve both changes and unrelated fields", async () => {
  const root = await repository();
  const nested = join(root, "nested");
  await mkdir(nested);
  const path = join(root, ".remote-runner.json");
  await writeFile(path, JSON.stringify({ custom: { keep: true } }));
  for (let iteration = 0; iteration < 10; iteration++) {
    const after = `after-${iteration}`;
    const before = `before-${iteration}`;
    const results = await Promise.all([
      initProjectHooks(root, { AfterCreateWorktreeCommand: after }),
      initProjectHooks(nested, { BeforeJobCommand: before }),
    ]);
    expect(results.map(result => result.changedFields)).toEqual([["AfterCreateWorktreeCommand"], ["BeforeJobCommand"]]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ custom: { keep: true }, AfterCreateWorktreeCommand: after, BeforeJobCommand: before });
  }
});

test("leaves an already matching config byte-for-byte and timestamp unchanged", async () => {
  const root = await repository();
  const path = join(root, ".remote-runner.json");
  const contents = '{ "BeforeJobCommand": "", "custom": true }';
  await writeFile(path, contents);
  await utimes(path, 1000, 1000);
  const before = await stat(path);
  expect(await initProjectHooks(root, { BeforeJobCommand: "" })).toEqual({ path, changedFields: [] });
  expect(await readFile(path, "utf8")).toBe(contents);
  expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
});

test.each([{}, { BeforeJobCommand: undefined }])("requires at least one explicit hook: %j", async hooks => {
  const root = await repository();
  await expect(initProjectHooks(root, hooks)).rejects.toThrow(/explicit hook/i);
  await expect(readFile(join(root, ".remote-runner.json"), "utf8")).rejects.toThrow();
});

test.each(["{broken", "[]", "null", '"text"', "42", "false"])("refuses invalid configuration %s without overwriting it", async contents => {
  const root = await repository();
  const path = join(root, ".remote-runner.json");
  await writeFile(path, contents);
  await expect(initProjectHooks(root, { BeforeJobCommand: "echo ready" })).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe(contents);
});

test("preserves unrelated fields and omitted hooks while an empty string clears a hook", async () => {
  const root = await repository();
  const path = join(root, ".remote-runner.json");
  await writeFile(path, JSON.stringify({ custom: { keep: true }, AfterCreateWorktreeCommand: "existing", BeforeJobCommand: "old" }));
  const result = await initProjectHooks(root, { BeforeJobCommand: "" });
  expect(result.changedFields).toEqual(["BeforeJobCommand"]);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ custom: { keep: true }, AfterCreateWorktreeCommand: "existing", BeforeJobCommand: "" });
});
