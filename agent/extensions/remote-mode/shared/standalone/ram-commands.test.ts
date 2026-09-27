import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRamUsage, ramStatus } from "./ram-commands.js";

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

test("RAM status can read this host", () => {
 assert.match(ramStatus(), /^RAM: \d+\.\d GiB \/ \d+\.\d GiB/);
});
