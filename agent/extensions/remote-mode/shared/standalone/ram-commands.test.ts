import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRamUsage, formatTmuxUsage, ramStatus } from "./ram-commands.js";

const meminfo = `MemTotal:        8388608 kB
MemFree:         1048576 kB
MemAvailable:    2097152 kB
Buffers:          131072 kB
Cached:          1048576 kB
SReclaimable:     131072 kB
Shmem:            524288 kB
SwapTotal:             0 kB
SwapFree:              0 kB
`;

test("RAM status reports Linux used accounting, available headroom, and disabled swap", () => {
 assert.equal(formatRamUsage(meminfo), "RAM: 6.3 GiB / 8.0 GiB (78.1% used); 2.0 GiB available. Swap: disabled.");
});

test("RAM status reports active swap and rejects missing counters", () => {
 assert.match(formatRamUsage(meminfo.replace("SwapTotal:             0", "SwapTotal:       1048576").replace("SwapFree:              0", "SwapFree:         524288")), /Swap: 0.5 GiB \/ 1.0 GiB used/);
 assert.throws(() => formatRamUsage(meminfo.replace("MemAvailable", "NotAvailable")), /Missing or invalid MemAvailable/);
});

test("tmux aggregates pane descendants, subagents, windows, sessions and the shared server", () => {
 const result = formatTmuxUsage([
  { session: "work", window: "1:pi", pid: 10 },
  { session: "work", window: "2:tests", pid: 20 },
  { session: "ops", window: "1:gateway", pid: 30 },
 ], [
  { pid: 10, ppid: 1, pss: 1048576 }, { pid: 11, ppid: 10, pss: 524288 },
  { pid: 12, ppid: 11, pss: 524288 }, { pid: 20, ppid: 1, pss: 1048576 },
  { pid: 30, ppid: 1, pss: 1048576 }, { pid: 40, ppid: 1, pss: 131072 },
  { pid: 50, ppid: 1, pss: 1048576 },
 ], 40);
 assert.match(result, /Tmux-associated: 4.1 GiB PSS/);
 assert.match(result, /session work: 3.0 GiB\n    window 1:pi: 2.0 GiB\n    window 2:tests: 1.0 GiB/);
 assert.match(result, /session ops: 1.0 GiB/);
 assert.doesNotMatch(result, /5.1 GiB/); // unrelated PID 50 is excluded
});

test("RAM status can read this host", async () => {
 assert.match(await ramStatus(), /^RAM: \d+\.\d GiB \/ \d+\.\d GiB[\s\S]*Tmux/);
});
