# Remote run (global Pi extension)

Registers `remote_run` and `remote_run_init` in every Pi session. Reload Pi after
installation (`/reload` in terminal Pi, `!reload` with remote mode). No dependencies
or CLI binaries are installed by this extension. `remote-run` must already be on
Pi's PATH, with the local coordinator running (the CLI's default port is 2461).

## Run heavy checks

```json
{"args":["bun","run","test:e2e"],"timeoutSeconds":1800}
```

Optional `cwd` defaults to Pi's current directory and accepts absolute paths or
paths relative to that directory. The CLI infers checkout/remote/branch, verifies
clean pushed source, and schedules the job. There are no source/runner overrides
in this MVP. Arguments execute directly, not through a shell. The CLI rejects
standalone shell operators; use a committed project script for compound logic.
The command display adds human-readable quotes but never reparses the arguments.

The tool waits for completion, with a live terminal call/result showing the
command, actual CLI phase, job ID, runner and elapsed/phase time. Known phases:
Git preflight, submission, queued, running, retrieving completed output, final
outcome. It cannot show individual test/hook progress; no live payload streaming.
Remote mode consumes the same Pi execution events and appends **one-line**
activity transitions to its existing post, not clock updates or multiline cards.
`!status` adds active remote-job diagnostics.

Full command output is streamed to a private directory beneath
`~/.remote-runners/pi-output/run-*/output.log`; CLI diagnostics go to
`diagnostics.log`. `result.json` records the final metadata. The model receives
only job/outcome/exit metadata and paths, never a payload excerpt. Use `read` on
the files when needed, particularly after failures. Output is not deliberately
capped; model-facing reads still have their normal bounds. Files survive reloads
and session exit; cleanup is manual. No automatic local fallback, retries,
commits, pushes or dependency installation.

The default 1,800-second timeout covers remote preparation/hooks/execution, not
queue wait. Pi abort or orderly session shutdown sends SIGTERM to the CLI,
letting its independent cancellation/collection flow run. After 35 seconds the
local CLI may be force-stopped; that is **not proof the remote job stopped**.
Only an observed `cancelled` job state confirms cancellation. Otherwise the
result explicitly reports `cancellation_unconfirmed` and retains the ID/files.
Abrupt Pi/host termination is not an orderly cancellation guarantee. Inspect
`remote-run-utils jobs/job/output` before resubmitting any ambiguous acceptance.

Ordinary heavy E2E/build checks need no per-job confirmation. Destructive commands
still need explicit user approval. Dirty/unpushed source is an error: the agent
must not auto-publish it or automatically retry locally.

## Configure explicit project hooks

```json
{"AfterCreateWorktreeCommand":"bun install","BeforeJobCommand":""}
```

`remote_run_init` resolves the Git checkout root (including linked worktrees and
nested cwd), then creates/updates `.remote-runner.json`. At least one explicit
hook is required. Omitted fields stay unchanged; an empty string disables that
hook. Unrelated JSON fields survive, invalid/nonobject configuration is refused,
and read/modify/write operations are queued. Unchanged configuration isn't
rewritten. No commands are inferred or executed. Commit/push the config yourself
before remote jobs can use it.

## Validation

Focused tests use fake CLI subprocesses and real temporary Git/filesystem roots;
no real remote jobs or remote credentials are used. Registration/rendering and
shutdown tests cover the tool factory; real Pi loader smoke checks cover loading
both this extension and remote mode. Remote activity formatter/status/post-buffer
tests cover readable command lines and clock deduplication.

Bun resolves bare SDK imports from a test fixture beneath an existing Pi package
installation; tests may be copied there temporarily (without installing anything).
Pure subprocess/display/activity tests can run directly from this global folder.
