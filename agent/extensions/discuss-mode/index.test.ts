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
 try {
  register({
   on(name: string, handler: any) { handlers.set(name, handler); },
   appendEntry(customType: string, data: any) { entries.push({ type: "custom", customType, data }); },
   sendMessage(message: any) { messages.push(message); },
   registerCommand(_name: string, definition: any) { command = definition; },
   registerTool() {}, events: { on() {} },
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
 return { handlers, messages, command, ctx, event, start, entries };
}

const state = (enabled: boolean, sessionId = "current") => ({
 type: "custom", customType: "discuss-mode-state", data: { sessionId, enabled },
});

test("inherited child receives inspect-only prompt without a toggle message", () => {
 const f = fixture({ child: true, inherited: true });
 f.handlers.get("session_start")({ reason: "startup" }, f.ctx);
 f.start();
 assert.match(f.event.systemPromptOptions.sections.discuss_mode, /Do not use any available tool to make changes/);
 assert.equal(f.messages.length, 0);
 assert.equal(f.handlers.get("tool_call")({ toolName: "edit" }, f.ctx).block, true);
 assert.equal(f.handlers.get("tool_call")({ toolName: "read" }, f.ctx), undefined);
 assert.equal(f.event.systemPromptOptions.sections.existing, "keep");
});

test("restored state and branch navigation refresh only the discuss prompt section", () => {
 const f = fixture({ entries: [state(true)] });
 f.start();
 assert.ok(f.event.systemPromptOptions.sections.discuss_mode);
 f.entries.push(state(false));
 f.handlers.get("session_tree")({}, f.ctx);
 f.start();
 assert.equal(f.event.systemPromptOptions.sections.discuss_mode, undefined);
 assert.equal(f.event.systemPromptOptions.sections.existing, "keep");
 assert.equal(f.handlers.get("tool_call")({ toolName: "write" }, f.ctx), undefined);
});

test("normal sessions remain unchanged and toggles retain their visible messages", async () => {
 const f = fixture({ inherited: true }); // Parent sessions do not inherit child environment state.
 f.start();
 assert.deepEqual(f.event.systemPromptOptions.sections, { existing: "keep" });
 await f.command.handler("", f.ctx);
 f.start();
 assert.match(f.messages[0].content, /DISCUSS MODE ACTIVE/);
 assert.ok(f.event.systemPromptOptions.sections.discuss_mode);
 await f.command.handler("", f.ctx);
 f.start();
 assert.match(f.messages[1].content, /DISCUSS MODE DISABLED/);
 assert.equal(f.event.systemPromptOptions.sections.discuss_mode, undefined);
});

test("fork inherits active branch state without requiring a new toggle", () => {
 const f = fixture({ entries: [state(true, "parent")] });
 f.handlers.get("session_start")({ reason: "fork" }, f.ctx);
 f.start();
 assert.ok(f.event.systemPromptOptions.sections.discuss_mode);
 assert.equal(f.entries.at(-1).data.sessionId, "current");
});
