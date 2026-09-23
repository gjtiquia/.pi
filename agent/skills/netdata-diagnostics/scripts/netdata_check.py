#!/usr/bin/env python3
"""Read-only host and systemd capacity report from a Netdata agent."""

from __future__ import annotations

import argparse
import concurrent.futures
import ipaddress
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable
from typing import Any

DEFAULT_URL = "http://127.0.0.1:19999"
EPHEMERAL_FILESYSTEMS = {
    "tmpfs",
    "devtmpfs",
    "proc",
    "sysfs",
    "cgroup",
    "cgroup2",
    "debugfs",
    "tracefs",
    "securityfs",
    "pstore",
    "configfs",
    "efivarfs",
    "mqueue",
    "hugetlbfs",
    "fusectl",
}


def normalize_target(target: str | None) -> str:
    if not target:
        return DEFAULT_URL
    target = target.strip().rstrip("/")
    is_full_url = "://" in target
    if not is_full_url:
        try:
            address = ipaddress.ip_address(target)
            host = f"[{address}]" if address.version == 6 else str(address)
            return f"http://{host}:19999"
        except ValueError:
            target = f"http://{target}"
    parsed = urllib.parse.urlsplit(target)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("target URL must use http or https")
    if not parsed.hostname:
        raise ValueError(f"invalid target: {target!r}")
    if parsed.username or parsed.password:
        raise ValueError("credentials must not be embedded in the target URL")
    if parsed.query or parsed.fragment:
        raise ValueError("target URL must not contain a query string or fragment")
    if not is_full_url and parsed.port is None:
        target = urllib.parse.urlunsplit(
            (parsed.scheme, f"{parsed.hostname}:19999", parsed.path.rstrip("/"), "", "")
        )
    return target


def parse_duration(value: str) -> int:
    value = value.strip().lower()
    if len(value) < 2 or not value[:-1].isdigit() or value[-1] not in "mhd":
        raise argparse.ArgumentTypeError("use a duration such as 15m, 6h, 24h, or 7d")
    amount = int(value[:-1])
    if amount <= 0:
        raise argparse.ArgumentTypeError("duration must be greater than zero")
    multiplier = {"m": 60, "h": 3600, "d": 86400}[value[-1]]
    seconds = amount * multiplier
    if seconds > 90 * 86400:
        raise argparse.ArgumentTypeError("duration must not exceed 90 days")
    return seconds


def finite(values: Iterable[Any]) -> list[float]:
    result: list[float] = []
    for value in values:
        if isinstance(value, (int, float)) and math.isfinite(value):
            result.append(float(value))
    return result


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def rounded(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def summarize(values: Iterable[Any]) -> dict[str, float | None]:
    clean = finite(values)
    if not clean:
        return {"current": None, "average": None, "p95": None, "max": None, "min": None}
    return {
        "current": rounded(clean[0]),
        "average": rounded(sum(clean) / len(clean)),
        "p95": rounded(percentile(clean, 0.95)),
        "max": rounded(max(clean)),
        "min": rounded(min(clean)),
    }


class NetdataClient:
    def __init__(self, base_url: str, timeout: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "User-Agent": "pi-netdata-diagnostics/1"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read(500).decode("utf-8", "replace").strip()
            raise RuntimeError(f"HTTP {error.code} from {url}: {detail}") from error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            raise RuntimeError(f"cannot query {url}: {error}") from error

    def chart_data(self, chart: str, seconds: int, points: int = 720) -> dict[str, Any]:
        return self.get_json(
            "/api/v1/data",
            {
                "chart": chart,
                "after": -seconds,
                "points": points,
                "group": "average",
                "format": "json",
            },
        )


def series(data: dict[str, Any], combine: Callable[[dict[str, float]], float]) -> list[float]:
    labels = data.get("labels", [])
    rows = data.get("data", [])
    result: list[float] = []
    for row in rows:
        mapped = {
            str(label): float(value)
            for label, value in zip(labels[1:], row[1:])
            if isinstance(value, (int, float)) and math.isfinite(value)
        }
        if mapped:
            result.append(combine(mapped))
    return result


def dimension(data: dict[str, Any], name: str) -> list[float]:
    return series(data, lambda row: row.get(name, math.nan))


def sum_dimensions(data: dict[str, Any], excluded: set[str] | None = None) -> list[float]:
    excluded = excluded or set()
    return series(data, lambda row: sum(value for key, value in row.items() if key not in excluded))


def safe_chart(client: NetdataClient, chart: str, seconds: int) -> tuple[dict[str, Any] | None, str | None]:
    try:
        return client.chart_data(chart, seconds), None
    except RuntimeError as error:
        return None, str(error)


def pressure_summary(client: NetdataClient, charts: dict[str, Any], chart: str, seconds: int) -> dict[str, Any] | None:
    if chart not in charts:
        return None
    data, _ = safe_chart(client, chart, seconds)
    if not data:
        return None
    labels = [str(label) for label in data.get("labels", [])[1:]]
    preferred = next((label for label in labels if label.endswith(" 10")), labels[0] if labels else None)
    if not preferred:
        return None
    result = summarize(dimension(data, preferred))
    result["dimension"] = preferred
    return result


def host_report(client: NetdataClient, charts: dict[str, Any], seconds: int) -> dict[str, Any]:
    report: dict[str, Any] = {}

    if "system.cpu" in charts:
        data, error = safe_chart(client, "system.cpu", seconds)
        if data:
            # guest time is already represented in user/nice on Linux.
            report["cpu_utilization_percent"] = summarize(
                sum_dimensions(data, {"guest", "guest_nice"})
            )
        elif error:
            report["cpu_error"] = error

    cpu_pressure = pressure_summary(client, charts, "system.cpu_some_pressure", seconds)
    if cpu_pressure:
        report["cpu_some_pressure_percent"] = cpu_pressure

    if "mem.available" in charts:
        data, error = safe_chart(client, "mem.available", seconds)
        if data:
            available = dimension(data, "avail")
            summary = summarize(available)
            ram_chart, _ = safe_chart(client, "system.ram", min(seconds, 3600)) if "system.ram" in charts else (None, None)
            total_mib = None
            if ram_chart:
                totals = sum_dimensions(ram_chart)
                total_mib = totals[0] if totals else None
            summary["total_mib"] = rounded(total_mib)
            if total_mib:
                summary["current_percent"] = rounded((available[0] / total_mib) * 100) if available else None
                summary["minimum_percent"] = rounded((min(available) / total_mib) * 100) if available else None
            report["memory_available_mib"] = summary
        elif error:
            report["memory_error"] = error

    for key, chart in (
        ("memory_some_pressure_percent", "system.memory_some_pressure"),
        ("memory_full_pressure_percent", "system.memory_full_pressure"),
        ("io_some_pressure_percent", "system.io_some_pressure"),
        ("io_full_pressure_percent", "system.io_full_pressure"),
    ):
        pressure = pressure_summary(client, charts, chart, seconds)
        if pressure:
            report[key] = pressure

    swap_chart = next((name for name in ("system.swap", "mem.swap") if name in charts), None)
    if swap_chart:
        data, _ = safe_chart(client, swap_chart, seconds)
        if data:
            used = dimension(data, "used")
            free = dimension(data, "free")
            report["swap"] = {
                "used_mib": summarize(used),
                "free_mib": summarize(free),
                "latest_total_mib": rounded((used[0] if used else 0) + (free[0] if free else 0)),
            }
    else:
        report["swap"] = {"status": "chart unavailable; commonly means no swap is configured"}
    if "mem.swapio" in charts:
        data, _ = safe_chart(client, "mem.swapio", seconds)
        if data:
            report["swap_io_kib_per_second"] = {
                "in": summarize(dimension(data, "in")),
                "out": summarize(dimension(data, "out")),
            }

    if "mem.oom_kill" in charts:
        data, _ = safe_chart(client, "mem.oom_kill", seconds)
        if data:
            values = dimension(data, "kills")
            report["oom_kill_rate"] = summarize(values)
            report["oom_activity_observed"] = any(value > 0 for value in values)

    filesystems: list[dict[str, Any]] = []
    disk_charts = [
        (name, metadata)
        for name, metadata in charts.items()
        if name.startswith("disk_space.")
        and metadata.get("chart_labels", {}).get("filesystem") not in EPHEMERAL_FILESYSTEMS
    ]
    for name, metadata in disk_charts:
        data, error = safe_chart(client, name, seconds)
        if not data:
            filesystems.append({"chart": name, "error": error})
            continue
        avail = dimension(data, "avail")
        used = dimension(data, "used")
        reserved = dimension(data, "reserved for root")
        current_total = sum(values[0] for values in (avail, used, reserved) if values)
        current_used = used[0] if used else None
        filesystems.append(
            {
                "mount_point": metadata.get("chart_labels", {}).get("mount_point", name.removeprefix("disk_space.")),
                "filesystem": metadata.get("chart_labels", {}).get("filesystem"),
                "used_percent": rounded((current_used / current_total) * 100) if current_used is not None and current_total else None,
                "free_gib": summarize(avail),
                "total_gib": rounded(current_total),
            }
        )
    report["filesystems"] = sorted(filesystems, key=lambda item: str(item.get("mount_point")))
    return report


def live_services(client: NetdataClient) -> dict[str, dict[str, Any]]:
    try:
        payload = client.get_json("/api/v1/function", {"function": "systemd-services"})
    except RuntimeError:
        return {}
    columns = payload.get("columns", {})
    indices = {name: value.get("index") for name, value in columns.items() if isinstance(value, dict)}
    result: dict[str, dict[str, Any]] = {}
    for row in payload.get("data", []):
        if not isinstance(row, list) or indices.get("Name") is None:
            continue
        name = row[indices["Name"]]
        result[str(name)] = {
            key.lower(): row[index]
            for key, index in indices.items()
            if isinstance(index, int) and index < len(row)
        }
    return result


def service_report(
    client: NetdataClient,
    charts: dict[str, Any],
    seconds: int,
    top: int,
    service_filter: str | None,
) -> dict[str, Any]:
    by_service: dict[str, dict[str, str]] = {}
    for chart, metadata in charts.items():
        labels = metadata.get("chart_labels", {})
        if labels.get("_collect_module") != "systemd":
            continue
        service = labels.get("service_name")
        if not service:
            continue
        # Several cgroup charts share the cpu or mem family. Select only
        # the aggregate utilization and memory charts, not pgfault/writeback.
        metric = "cpu" if chart.endswith(".cpu") else "mem" if chart.endswith(".mem") else None
        if metric:
            by_service.setdefault(str(service), {})[metric] = chart

    requested = service_filter.removesuffix(".service") if service_filter else None
    if requested:
        if requested in by_service:
            selected = {requested: by_service[requested]}
        else:
            selected = {
                name: value
                for name, value in by_service.items()
                if requested.lower() in name.lower()
            }
    else:
        selected = by_service

    live = live_services(client)

    def collect(item: tuple[str, dict[str, str]]) -> dict[str, Any]:
        name, service_charts = item
        entry: dict[str, Any] = {"service": name, "live": live.get(name)}
        for family, chart in service_charts.items():
            data, error = safe_chart(client, chart, seconds)
            if data and family == "cpu":
                entry["cpu_percent_of_one_core"] = summarize(sum_dimensions(data))
            elif data and family == "mem":
                labels = set(str(label) for label in data.get("labels", [])[1:])
                anon_name = "anon" if "anon" in labels else "rss" if "rss" in labels else None
                # THP/huge dimensions are subsets of anon/rss in cgroup memory.stat.
                # Excluding them avoids obvious double counting; this remains an
                # accounted-components estimate rather than RSS or memory.current.
                overlapping = {name for name in labels if "thp" in name or "huge" in name}
                entry["memory_accounted_components_mib"] = summarize(sum_dimensions(data, overlapping))
                if anon_name:
                    entry["memory_anon_mib"] = summarize(dimension(data, anon_name))
            elif error:
                entry[f"{family}_error"] = error
        return entry

    workers = min(8, max(1, len(selected)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        entries = list(executor.map(collect, selected.items()))

    if requested:
        return {"matched": sorted(entries, key=lambda item: item["service"]), "available_count": len(by_service)}

    def metric(entry: dict[str, Any], key: str, stat: str) -> float:
        value = entry.get(key, {}).get(stat)
        return float(value) if isinstance(value, (int, float)) else -1.0

    top_cpu = sorted(entries, key=lambda item: metric(item, "cpu_percent_of_one_core", "p95"), reverse=True)[:top]
    top_memory = sorted(entries, key=lambda item: metric(item, "memory_anon_mib", "max"), reverse=True)[:top]
    return {
        "discovered_count": len(by_service),
        "top_cpu_by_p95": top_cpu,
        "top_memory_by_anon_max": top_memory,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", nargs="?", help="Tailscale hostname/IP or full Netdata URL")
    parser.add_argument("--since", default="24h", type=parse_duration, metavar="DURATION")
    parser.add_argument("--service", help="focus on one systemd service (the .service suffix is optional)")
    parser.add_argument("--top", type=int, default=5, help="number of services in each ranking (default: 5)")
    parser.add_argument("--timeout", type=float, default=10.0, help="per-request timeout in seconds")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.top < 1 or args.top > 50:
        parser.error("--top must be between 1 and 50")
    if args.timeout <= 0 or args.timeout > 120:
        parser.error("--timeout must be greater than 0 and no more than 120")

    try:
        target = normalize_target(args.target)
        client = NetdataClient(target, args.timeout)
        started = time.monotonic()
        info = client.get_json("/api/v1/info")
        charts_payload = client.get_json("/api/v1/charts")
        charts = charts_payload.get("charts", {})
        if not isinstance(charts, dict):
            raise RuntimeError("Netdata chart catalog has an unexpected shape")
        identity = {
            key: info.get(key)
            for key in (
                "hostname",
                "version",
                "os_name",
                "os_version",
                "kernel_name",
                "kernel_version",
                "architecture",
            )
            if info.get(key) is not None
        }
        if not identity.get("hostname") and charts_payload.get("hostname"):
            identity["hostname"] = charts_payload["hostname"]
        result = {
            "target": target,
            "identity": identity,
            "window_seconds": args.since,
            "sample_limit": 720,
            "host": host_report(client, charts, args.since),
            "systemd_services": service_report(client, charts, args.since, args.top, args.service),
        }
        result["query_duration_seconds"] = rounded(time.monotonic() - started)
        json.dump(result, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return 0
    except (ValueError, RuntimeError) as error:
        print(f"netdata-check: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
