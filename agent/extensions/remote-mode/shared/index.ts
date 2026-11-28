import { catalogHelp, dispatchRemoteCommand, matchCommand, type CommandResult, type CommandDefinition } from "./core/command-router.js";
import { stopAgent, sendAgentPrompt, STOP_USAGE, QUEUE_USAGE, STEER_USAGE } from "./hosted/agent-commands.js";
import { runSkill, SKILL_USAGE } from "./hosted/skill-commands.js";
import { handleModelCommand } from "./hosted/model-commands.js";
import { tokenStatus } from "./hosted/token-commands.js";
import { runGit, GIT_USAGE } from "./standalone/git-commands.js";
import { runShell, SHELL_USAGE } from "./standalone/shell-commands.js";
import { diffReplies } from "./standalone/diff-replies.js";
import { ramStatus } from "./standalone/ram-commands.js";
import type { CommandHost } from "./host.js";

export type { CommandHost, ModelHost, ModelRef, Effort, TokenEntry, TokenUsage, TokenSnapshot } from "./host.js";
export type { CommandDefinition } from "./core/command-router.js";
export {
 ActivityTracker,
 formatCommandActivity,
 formatDuration,
 markdownCodeBlock,
 renderActivityStatus,
} from "./activity/status-tracker.js";
export type {
 ActiveToolStatus,
 ActivityOutcome,
 ActivitySnapshot,
 FormattedActivityUpdate,
 LastRunStatus,
 StatusRenderOptions,
} from "./activity/status-tracker.js";
export type { CommandResult } from "./core/command-router.js";

/** Classify from the same catalog used to dispatch, so hosts need no command-name list. */
export function classifySharedCommand(input: string): "standalone" | "session" | undefined {
 const definition = matchCommand(input, registerSharedCommands({} as CommandHost))?.definition;
 return definition ? definition.sessionRequired ? "session" : "standalone" : undefined;
}

/** Compose the shared catalog with host-local commands. No registration side effects. */
export function registerSharedCommands(host: CommandHost, local: CommandDefinition[] = []): CommandDefinition[] {
 const model = (input: string) => handleModelCommand(input, host.model);
 const tokens = () => tokenStatus(host.tokens());
 const definitions: CommandDefinition[] = [
  { name: "help", aliases: ["list", "ls"], usage: ["!help / !list / !ls — list all commands"], payload: () => catalogHelp(definitions) },
  { name: "status", sessionRequired: true, usage: ["!status — show live session activity diagnostics"],
   actions: { "": { args: "none", run: () => host.status?.() ?? "Session status unavailable." } } },
  { name: "stop", aliases: ["abort"], sessionRequired: true, usage: STOP_USAGE, actions: { "": { args: "none", run: () => stopAgent(host) } } },
  { name: "queue", sessionRequired: true, usage: QUEUE_USAGE, payload: args => sendAgentPrompt("queue", args, host) },
  { name: "steer", sessionRequired: true, usage: STEER_USAGE, payload: args => sendAgentPrompt("steer", args, host) },
  { name: "compact", aliases: ["compress"], sessionRequired: true,
   usage: ["!compact / !compress — usage", "!compact this / !compress this — compact this Pi session"],
   actions: { this: { args: "none", run: async () => {
    if (!host.isIdle() || host.hasPendingMessages()) return "Pi is busy; wait for it to finish before compacting.";
    try {
     await host.compact();
     return "Compaction complete.";
    } catch (error) {
     return `Compaction failed: ${error instanceof Error ? error.message : String(error)}`;
    }
   } } },
  },
  { name: "diff", usage: ["!diff / !diff help — usage"], actions: { all: { args: "none", description: "post changes file by file", run: () => diffReplies(host.cwd) } } },
  { name: "git", usage: GIT_USAGE, payload: args => runGit(args, host.cwd) },
  { name: "shell", aliases: ["$"], usage: SHELL_USAGE, payload: args => runShell(args, host.cwd, host.projectTrusted) },
  { name: "ram", usage: ["!ram — RAM usage on this host"], actions: { "": { args: "none", run: ramStatus } } },
  { name: "skill", sessionRequired: true, usage: SKILL_USAGE, payload: args => runSkill(args, host.getSkills(), prompt => host.sendUserMessage(prompt, {
    ...(host.isIdle() ? {} : { deliverAs: "followUp" as const }), expandPromptTemplates: true,
   })) },
  { name: "discuss", sessionRequired: true, usage: ["!discuss — help + status", "!discuss status", "!discuss on", "!discuss off"],
   status: () => host.discuss?.status() ?? "Discuss mode unavailable.", actions: {
    status: { args: "none", run: () => host.discuss?.status() ?? "Discuss mode unavailable." },
    on: { args: "none", run: () => host.discuss?.set(true) ?? "Discuss mode unavailable." },
    off: { args: "none", run: () => host.discuss?.set(false) ?? "Discuss mode unavailable." },
   } },
  { name: "token", aliases: ["tokens"], sessionRequired: true, usage: ["!token / !tokens — help + stats", "!token status / !tokens status — stats"], status: tokens, actions: { status: { args: "none", run: tokens } } },
  { name: "model", sessionRequired: true, usage: ["!model — help + status", "!model status", "!model list — all providers", "!model set model <model> — current provider", "!model set model <provider> <model>", "!model set effort <off|minimal|low|medium|high|xhigh|max>"], status: () => model("status"), actions: {
   status: { args: "none", run: () => model("status") },
   list: { args: "none", run: () => model("list") },
   "set model": { args: "required", run: (args) => model(`set model ${args}`) },
   "set effort": { args: "required", run: (args) => model(`set effort ${args}`) },
  } },
  ...local,
 ];
 return definitions;
}

/** One host adapter per bound session; the caller owns transport and unknown fallback. */
export function createCommandDispatcher(host: CommandHost, local: CommandDefinition[] = []): (input: string) => Promise<CommandResult> {
 const definitions = registerSharedCommands(host, local);
 return input => dispatchRemoteCommand(input, definitions);
}
