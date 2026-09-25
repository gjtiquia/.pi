import { dispatchRemoteCommand, type CommandDefinition } from "./core/command-router.js";
import { handleAgentCommand, STOP_USAGE, QUEUE_USAGE, STEER_USAGE } from "./hosted/agent-commands.js";
import { handleSkillCommand, SKILL_USAGE } from "./hosted/skill-commands.js";
import { handleModelCommand } from "./hosted/model-commands.js";
import { tokenStatus } from "./hosted/token-commands.js";
import { handleGitCommand, GIT_USAGE } from "./standalone/git-commands.js";
import { handleShellCommand, SHELL_USAGE } from "./standalone/shell-commands.js";
import type { CommandHost } from "./host.js";

export type { CommandHost, ModelHost, ModelRef, Effort, TokenEntry, TokenUsage, TokenSnapshot } from "./host.js";
export type { CommandDefinition } from "./core/command-router.js";
export interface CommandResult { handled: boolean; response?: string }

/** Classify from the same catalog used to dispatch, so hosts need no command-name list. */
export function classifySharedCommand(input: string): "standalone" | "session" | undefined {
 const name = /^!(\S+)/.exec(input.trimStart())?.[1];
 if (!name) return;
 // Catalog construction only captures the host; it never invokes a capability.
 const definition = registerSharedCommands({} as CommandHost).find(item => item.name === name || item.aliases?.includes(name));
 return definition ? definition.sessionRequired ? "session" : "standalone" : undefined;
}

/** Compose the shared catalog with host-local commands. No registration side effects. */
export function registerSharedCommands(host: CommandHost, local: CommandDefinition[] = []): CommandDefinition[] {
 const model = (input: string) => handleModelCommand(input, host.model);
 const tokens = () => tokenStatus(host.tokens());
 return [
  { name: "help", aliases: ["list", "ls"], usage: ["!help / !list / !ls — list all commands"], actions: {} },
  { name: "stop", aliases: ["abort"], sessionRequired: true, usage: STOP_USAGE, actions: {} },
  { name: "queue", sessionRequired: true, usage: QUEUE_USAGE, actions: {} },
  { name: "steer", sessionRequired: true, usage: STEER_USAGE, actions: {} },
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
  { name: "git", usage: GIT_USAGE, actions: {} },
  { name: "shell", aliases: ["$"], usage: SHELL_USAGE, actions: {} },
  { name: "skill", sessionRequired: true, usage: SKILL_USAGE, actions: {} },
  { name: "token", aliases: ["tokens"], sessionRequired: true, usage: ["!token / !tokens — help + stats", "!token status / !tokens status — stats"], status: tokens, actions: { status: { args: "none", run: tokens } } },
  { name: "model", sessionRequired: true, usage: ["!model — help + status", "!model status", "!model list — all providers", "!model set model <model> — current provider", "!model set model <provider> <model>", "!model set effort <off|minimal|low|medium|high|xhigh|max>"], status: () => model("status"), actions: {
   status: { args: "none", run: () => model("status") },
   list: { args: "none", run: () => model("list") },
   "set model": { args: "required", run: (args) => model(`set model ${args}`) },
   "set effort": { args: "required", run: (args) => model(`set effort ${args}`) },
  } },
  ...local,
 ];
}

/** One host adapter per bound session; the caller owns transport and unknown fallback. */
export function createCommandDispatcher(host: CommandHost, local: CommandDefinition[] = []): (input: string) => Promise<CommandResult> {
 const definitions = registerSharedCommands(host, local);
 return async (input) => {
  const agent = handleAgentCommand(input, host);
  if (agent.handled) return agent;
  if (/^!skill(?=\s|$)/.test(input.trimStart())) return handleSkillCommand(input, host.getSkills(), (prompt) => host.sendUserMessage(prompt, {
   ...(host.isIdle() ? {} : { deliverAs: "followUp" as const }), expandPromptTemplates: true,
  }));
  if (/^!git(?=\s|$)/.test(input.trimStart())) return { handled: true, response: await handleGitCommand(input, host.cwd) };
  if (/^!(?:\$|shell)(?=\s|$)/.test(input.trimStart())) return { handled: true, response: await handleShellCommand(input, host.cwd, host.projectTrusted) };
  return dispatchRemoteCommand(input, definitions);
 };
}
