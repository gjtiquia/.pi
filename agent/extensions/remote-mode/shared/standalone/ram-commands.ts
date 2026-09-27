import { readFileSync } from "node:fs";

const gib = (kib: number) => `${(kib / 1024 / 1024).toFixed(1)} GiB`;

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

export function ramStatus(): string {
 try { return formatRamUsage(readFileSync("/proc/meminfo", "utf8")); }
 catch { return "RAM status unavailable (requires Linux /proc/meminfo)."; }
}
