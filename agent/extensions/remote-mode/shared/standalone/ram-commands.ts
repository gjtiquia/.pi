import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const gib = (kib: number) => `${(kib / 1024 / 1024).toFixed(1)} GiB`;
const size = (kib: number) => kib < 102400 ? `${Math.round(kib / 1024)} MiB` : gib(kib);

/** Linux MemAvailable is the useful headroom; 'free' alone excludes reclaimable cache. */
export function formatRamUsage(meminfo: string): string {
 const values = new Map<string, number>();
 for (const match of meminfo.matchAll(/^(\w+):\s+(\d+) kB$/gm)) values.set(match[1], Number(match[2]));
 const required = (name: string) => {
  const value = values.get(name);
  if (value === undefined || !Number.isSafeInteger(value)) throw new Error(`Missing or invalid ${name} in /proc/meminfo`);
  return value;
 };
 const total = required("MemTotal");
 const free = required("MemFree");
 const available = required("MemAvailable");
 const buffers = required("Buffers");
 const cached = required("Cached");
 const reclaimable = required("SReclaimable");
 const shared = required("Shmem");
 const swapTotal = required("SwapTotal");
 const swapFree = required("SwapFree");
 if (!total || available > total || swapFree > swapTotal) throw new Error("Invalid memory totals in /proc/meminfo");
 // Match Linux free(1)'s 'used': total - free - (buffers + cache + reclaimable - shared).
 const used = total - free - buffers - cached - reclaimable + shared;
 if (used < 0 || used > total) throw new Error("Invalid used memory in /proc/meminfo");
 return `RAM: ${gib(used)} / ${gib(total)} (${(used / total * 100).toFixed(1)}% used); ${gib(available)} available. Swap: ${swapTotal ? `${gib(swapTotal - swapFree)} / ${gib(swapTotal)} used` : "disabled"}.`;
}

type Pane = { session: string; window: string; pid: number };
type Process = { pid: number; ppid: number; pss: number | undefined };

/** A pane owns its descendant tree. Subagents spawned by Pi remain descendants unless reparented. */
export function formatTmuxUsage(panes: Pane[], processes: Process[], serverPid?: number): string {
 const byParent = new Map<number, number[]>();
 const byPid = new Map(processes.map(process => [process.pid, process]));
 for (const process of processes) {
  const children = byParent.get(process.ppid) ?? [];
  children.push(process.pid);
  byParent.set(process.ppid, children);
 }
 const owners = new Map<number, string>();
 const labels = new Map<string, { session: string; window: string }>();
 for (const pane of panes) {
  const key = `${pane.session}\0${pane.window}`;
  labels.set(key, { session: pane.session, window: pane.window });
  const stack = [pane.pid];
  while (stack.length) {
   const pid = stack.pop()!;
   if (owners.has(pid)) continue;
   owners.set(pid, key);
   stack.push(...(byParent.get(pid) ?? []));
  }
 }
 const windows = new Map<string, number>();
 let unknown = 0;
 for (const [pid, key] of owners) {
  const pss = byPid.get(pid)?.pss;
  if (pss === undefined) { unknown++; continue; }
  windows.set(key, (windows.get(key) ?? 0) + pss);
 }
 const serverPss = serverPid === undefined ? undefined : byPid.get(serverPid)?.pss;
 const total = [...windows.values()].reduce((sum, value) => sum + value, 0) + (serverPss ?? 0);
 const sessions = new Map<string, { total: number; windows: { name: string; pss: number }[] }>();
 for (const [key, label] of labels) {
  const entry = sessions.get(label.session) ?? { total: 0, windows: [] };
  const pss = windows.get(key) ?? 0;
  entry.total += pss;
  entry.windows.push({ name: label.window, pss });
  sessions.set(label.session, entry);
 }
 const safe = (name: string) => name.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 80);
 const lines = [`Tmux-associated: ${gib(total)} PSS (pane descendants + server; best effort)`];
 for (const [name, entry] of [...sessions].sort((a, b) => b[1].total - a[1].total)) {
  lines.push(`  session ${safe(name)}: ${size(entry.total)}`);
  for (const window of entry.windows.sort((a, b) => b.pss - a.pss)) lines.push(`    window ${safe(window.name)}: ${size(window.pss)}`);
 }
 lines.push(`  tmux server: ${serverPss === undefined ? "PSS unavailable" : size(serverPss)}`);
 lines.push(`Approximate: shared pages apportioned by PSS; reparented processes excluded${unknown ? `; ${unknown} process(es) unreadable` : ""}.`);
 return lines.join("\n");
}

const parentPid = (stat: string): number | undefined => {
 const closing = stat.lastIndexOf(") ");
 if (closing < 0) return;
 const ppid = Number(stat.slice(closing + 2).split(/\s+/)[1]);
 return Number.isSafeInteger(ppid) ? ppid : undefined;
};

async function tmuxUsage(): Promise<string> {
 let stdout: string;
 let serverOutput: string;
 try {
  // No shell; bound tmux calls so a hung server cannot stall the command indefinitely.
  [{ stdout }, { stdout: serverOutput }] = await Promise.all([
   exec("tmux", ["list-panes", "-a", "-F", "#{session_name}|#{window_index}:#{window_name}|#{pane_pid}"], { timeout: 3000, maxBuffer: 256 * 1024 }),
   exec("tmux", ["display-message", "-p", "#{pid}"], { timeout: 3000, maxBuffer: 1024 }),
  ]) as [{ stdout: string }, { stdout: string }];
 } catch { return "Tmux: no accessible server (or query timed out)."; }
 const panes: Pane[] = [];
 for (const line of stdout.trim().split("\n")) {
  const first = line.indexOf("|");
  const last = line.lastIndexOf("|");
  if (first < 0 || last <= first) continue;
  const pid = Number(line.slice(last + 1));
  if (Number.isSafeInteger(pid) && pid > 0) panes.push({ session: line.slice(0, first), window: line.slice(first + 1, last), pid });
 }
 if (!panes.length) return "Tmux: no panes found.";
 const server = Number(serverOutput.trim());
 const entries = await readdir("/proc");
 const processes = (await Promise.all(entries.filter(entry => /^\d+$/.test(entry)).map(async entry => {
  const pid = Number(entry);
  try {
   const stat = await readFile(`/proc/${pid}/stat`, "utf8");
   const ppid = parentPid(stat);
   if (ppid === undefined) return;
   return { pid, ppid, pss: undefined } as Process;
  } catch { return; }
 }))).filter((process): process is Process => !!process);
 // Only read expensive smaps_rollup for pane descendants and the server.
 const children = new Map<number, number[]>();
 for (const process of processes) children.set(process.ppid, [...(children.get(process.ppid) ?? []), process.pid]);
 const relevant = new Set<number>([...panes.map(pane => pane.pid), ...(Number.isSafeInteger(server) && server > 0 ? [server] : [])]);
 const stack = panes.map(pane => pane.pid);
 while (stack.length) {
  const pid = stack.pop()!;
  for (const child of children.get(pid) ?? []) if (!relevant.has(child)) { relevant.add(child); stack.push(child); }
 }
 await Promise.all(processes.filter(process => relevant.has(process.pid)).map(async process => {
  try {
   const smaps = await readFile(`/proc/${process.pid}/smaps_rollup`, "utf8");
   const match = /^Pss:\s+(\d+) kB$/m.exec(smaps);
   if (match) process.pss = Number(match[1]);
  } catch { /* exited or inaccessible: keep it explicitly unknown */ }
 }));
 return formatTmuxUsage(panes, processes, Number.isSafeInteger(server) && server > 0 ? server : undefined);
}

export async function ramStatus(): Promise<string> {
 try {
  const ram = formatRamUsage(await readFile("/proc/meminfo", "utf8"));
  try { return `${ram}\n${await tmuxUsage()}`; }
  catch { return `${ram}\nTmux: breakdown unavailable.`; }
 } catch { return "RAM status unavailable (requires Linux /proc/meminfo)."; }
}
