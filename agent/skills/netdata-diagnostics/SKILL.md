---
name: netdata-diagnostics
description: Inspect capacity, resource pressure, and per-systemd-service CPU and memory on local or remote Debian hosts through a read-only Netdata endpoint. Use when checking whether a machine is healthy, overloaded, appropriately sized, or has room for more work, and when comparing systemd service resource use over a time range.
compatibility: Requires Python 3 and network access to the target Netdata agent. Designed for direct access over a trusted Tailscale network.
---

# Netdata diagnostics

Use the bundled script to collect a bounded report, then interpret the evidence for the user.

## Safety invariant

This skill is **Netdata-only and read-only**.

- Never SSH into a target as part of this skill.
- Never execute a remote shell command.
- Never call configuration, management, or action functions.
- Never start, stop, restart, or modify a service.
- Only query Netdata information, chart data, and the read-only `systemd-services` function.
- Do not attempt to bypass Netdata access controls. Direct process, journal, and detailed unit-list functions may require Netdata Cloud SSO and are outside this skill.

## Targets

Pass no target for local Netdata. A bare hostname or IP uses HTTP port 19999. A full URL is used unchanged.

```bash
python3 scripts/netdata_check.py
python3 scripts/netdata_check.py debian13-rs1000-vie
python3 scripts/netdata_check.py 100.85.51.23 --since 6h
python3 scripts/netdata_check.py https://netdata.example.com --since 7d
```

Prefer a Tailscale DNS name or Tailscale IP for remote agents. Do not expose or recommend exposing port 19999 publicly without authentication.

## Time ranges

`--since` accepts an integer followed by `m`, `h`, or `d`. It defaults to `24h`.

```bash
python3 scripts/netdata_check.py TARGET --since 15m
python3 scripts/netdata_check.py TARGET --since 24h
python3 scripts/netdata_check.py TARGET --since 7d
```

The report contains bounded, downsampled history. Fields named `current` are the newest time bucket, not an instantaneous probe, and `max` is the maximum bucket average. Treat short peaks as approximate and state the selected time range.

## Service focus

The default report includes top systemd services by historical CPU and memory. To inspect one service:

```bash
python3 scripts/netdata_check.py TARGET --since 24h --service nginx
```

Service metrics come from systemd cgroups. A service may be absent if it did not run during retained history or its cgroup was not collected. Netdata's `systemd-services` function supplies a live snapshot, but some RAM or I/O fields may be null depending on kernel/cgroup accounting. Use `memory_anon_mib` as the less-reclaimable signal. `memory_accounted_components_mib` includes charged file cache and kernel components and is only an estimate; do not describe it as RSS or exact `memory.current`.

## Interpreting a report

Answer the user's actual capacity question rather than dumping JSON. Summarize:

1. **CPU headroom:** typical and p95 utilization, peaks, CPU PSI, and sustained versus bursty load.
2. **Memory headroom:** available RAM percentage and minimum, memory PSI, swap if present, and OOM evidence.
3. **Storage headroom:** used percentage and minimum free space for persistent filesystems, plus I/O PSI.
4. **Workload attribution:** systemd services dominating CPU or memory.
5. **Conclusion:** `AMPLE`, `MODERATE`, `LOW`, `SATURATED`, or `UNKNOWN` headroom, with the limiting resource and confidence.

Be conservative:

- Prefer p95 and pressure indicators over a single current value.
- A high instantaneous peak without pressure does not prove saturation.
- Low available RAM is more concerning when accompanied by memory PSI, swap activity, or OOM kills.
- Full filesystems and sustained I/O pressure are separate failure modes.
- Never claim an exact number of additional workloads without knowing their resource profile.
- Say `UNKNOWN` when history or required charts are unavailable.

## Output control

The script writes JSON to stdout and diagnostics to stderr. Use `--top N` to bound service lists and `--timeout SECONDS` for slow targets. Do not fetch `/api/v1/allmetrics` or print complete chart catalogs; those responses are unnecessarily large.
