import assert from "node:assert/strict";
import { test } from "node:test";
import register from "./index.ts";

function fixture({ child = false, inherited = false, entries = [] as any[] } = {}) {
 const oldDepth = process.env.PI_SUBAGENT_DEPTH;
 const oldMode = process.env.PI_DISCUSS_MODE;
 if (child) process.env.PI_SUBAGENT_DEPTH = "1";
 else delete process.env.PI_SUBAGENT_DEPTH;
 process.env.PI_DISCUSS_MODE = inherited ? "1" : "0";
 const handlers = new Map<string, any>();
 const messages: any[] = [];
 let command: any;
 let statusTool: any;
 try {
  register({
   on(name: string, handler: any) { handlers.set(name, handler); },
   appendEntry(customType: string, data: any) { entries.push({ type: "custom", customType, data }); },
   sendMessage(message: any) { messages.push(message); },
   registerCommand(_name: string, definition: any) { command = definition; },
   registerTool(tool: any) { statusTool = tool; }, events: { on() {} },
  } as any);
 } finally {
  if (oldDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
  else process.env.PI_SUBAGENT_DEPTH = oldDepth;
  if (oldMode === undefined) delete process.env.PI_DISCUSS_MODE;
  else process.env.PI_DISCUSS_MODE = oldMode;
 }
 const ctx = {
  sessionManager: { getSessionId: () => "current", getBranch: () => entries },
  ui: { setStatus() {}, notify() {} },
 };
 const event = { systemPromptOptions: { sections: { existing: "keep" } as Record<string, string> } };
 const start = () => handlers.get("before_agent_start")(event, ctx);
 const status = () => statusTool.execute("status", {}, undefined, undefined, ctx);
 return { handlers, messages, command, ctx, event, start, entries, status };
}

const state = (enabled: boolean, sessionId = "current") => ({
 type: "custom", customType: "discuss-mode-state", data: { sessionId, enabled },
});

test("inherited child gets a status notice without a system prompt section", async () => {
 const f = fixture({ child: true, inherited: true });
 f.handlers.get("session_start")({ reason: "startup" }, f.ctx);
 f.start();
 assert.equal((await f.status()).content[0].text, "Discuss mode: on");
 assert.equal(f.messages.length, 1);
 assert.match(f.messages[0].content, /Call discuss_mode_status before continuing/);
 assert.equal(f.event.systemPromptOptions.sections.discuss_mode, undefined);
 assert.equal(f.handlers.get("tool_call")({ toolName: "edit" }, f.ctx).block, true);
 assert.equal(f.handlers.get("tool_call")({ toolName: "read" }, f.ctx), undefined);
 assert.equal(f.event.systemPromptOptions.sections.existing, "keep");
});

test("branch navigation sends a notice when the restored mode changes", async () => {
 const f = fixture({ entries: [state(true)] });
 f.handlers.get("session_start")({ reason: "resume" }, f.ctx);
 assert.equal((await f.status()).content[0].text, "Discuss mode: on");
 assert.equal(f.messages.length, 1);

 f.entries.push(state(false));
 f.handlers.get("session_tree")({}, f.ctx);
 f.start();
 assert.equal((await f.status()).content[0].text, "Discuss mode: off");
 assert.equal(f.event.systemPromptOptions.sections.discuss_mode, undefined);
 assert.equal(f.event.systemPromptOptions.sections.existing, "keep");
 assert.equal(f.handlers.get("tool_call")({ toolName: "write" }, f.ctx), undefined);
 assert.equal(f.messages.length, 2);
 assert.deepEqual(f.messages[1], f.messages[0]);
});

test("normal startup is silent and both toggles send the same instructions", async () => {
 const f = fixture({ inherited: true }); // Parent sessions do not inherit child environment state.
 f.handlers.get("session_start")({ reason: "startup" }, f.ctx);
 f.start();
 assert.equal(f.messages.length, 0);
 assert.deepEqual(f.event.systemPromptOptions.sections, { existing: "keep" });
 assert.equal((await f.status()).content[0].text, "Discuss mode: off");

 await f.command.handler("", f.ctx);
 f.start();
 assert.equal((await f.status()).content[0].text, "Discuss mode: on");
 assert.equal(f.event.systemPromptOptions.sections.discuss_mode, undefined);

 await f.command.handler("", f.ctx);
 f.start();
 assert.equal((await f.status()).content[0].text, "Discuss mode: off");
 assert.equal(f.event.systemPromptOptions.sections.discuss_mode, undefined);
 assert.equal(f.messages.length, 2);
 assert.equal(f.messages[0].display, true);
 assert.match(f.messages[0].content, /Call discuss_mode_status before continuing/);
 assert.match(f.messages[0].content, /If on:.*Read-only tool use is allowed\. Do not use any tool to make changes/);
 assert.match(f.messages[0].content, /If off: Follow normal session instructions/);
 assert.deepEqual(f.messages[1], f.messages[0]);
});

test("fork inherits active branch state without requiring a new toggle", async () => {
 const f = fixture({ entries: [state(true, "parent")] });
 f.handlers.get("session_start")({ reason: "fork" }, f.ctx);
 assert.equal((await f.status()).content[0].text, "Discuss mode: on");
 assert.equal(f.entries.at(-1).data.sessionId, "current");
 assert.equal(f.messages.length, 1);
});

test("older discuss-mode prompt sections are cleared without adding a notice", () => {
 const f = fixture();
 f.event.systemPromptOptions.sections.discuss_mode = "old instructions";
 f.start();
 assert.deepEqual(f.event.systemPromptOptions.sections, { existing: "keep" });
 assert.equal(f.messages.length, 0);
});
