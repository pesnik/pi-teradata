#!/usr/bin/env python3
"""
analyze_sessions.py — Analyze Teradata Viewpoint sessions JSON and produce insights.

Usage:
    python analyze_sessions.py sessions.json
    python analyze_sessions.py sessions.json --mode top-cpu
    python analyze_sessions.py sessions.json --mode blocked
    python analyze_sessions.py sessions.json --mode summary
    python analyze_sessions.py sessions.json --mode long-running
    python analyze_sessions.py sessions.json --mode all
    cat sessions.json | python analyze_sessions.py -

Modes:
    summary       - Overview: counts, top users, workloads (default)
    top-cpu       - Top queries by CPU usage / delta_cpu
    top-io        - Top queries by IO / delta_io
    blocked       - Blocked sessions and their blockers
    long-running  - Sessions with high elapsed_time
    skew          - Sessions with high CPU or IO skew
    all           - Run all analyses and print combined report
"""

import argparse
import json
import sys
from collections import defaultdict, Counter


def load_sessions(path):
    if path == "-":
        return json.load(sys.stdin)
    with open(path) as f:
        return json.load(f)


def safe_float(val, default=0.0):
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def safe_int(val, default=0):
    try:
        return int(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def fmt_seconds(s):
    s = safe_int(s)
    if s < 60:
        return f"{s}s"
    elif s < 3600:
        return f"{s // 60}m {s % 60}s"
    else:
        h = s // 3600
        m = (s % 3600) // 60
        return f"{h}h {m}m"


def summary(sessions):
    lines = ["=" * 60, "SUMMARY", "=" * 60]
    lines.append(f"Total active sessions : {len(sessions)}")

    users = Counter(s.get("user_name", "?") for s in sessions)
    lines.append(f"Unique users          : {len(users)}")
    lines.append(f"Top users by session count:")
    for user, cnt in users.most_common(10):
        lines.append(f"  {user:<30} {cnt} sessions")

    workloads = Counter(s.get("workload_name", "?") or "?" for s in sessions)
    lines.append(f"\nWorkload distribution:")
    for wl, cnt in workloads.most_common():
        lines.append(f"  {wl:<30} {cnt}")

    states = Counter(s.get("computed_state", "?") for s in sessions)
    lines.append(f"\nComputed states:")
    for st, cnt in states.most_common():
        lines.append(f"  {st:<20} {cnt}")

    blocked = [
        s
        for s in sessions
        if safe_int(s.get("blocker_count")) > 0 or s.get("blocked_by")
    ]
    if blocked:
        lines.append(f"\n⚠  Blocked sessions     : {len(blocked)}")

    total_cpu = sum(safe_float(s.get("request_amp_cpu")) for s in sessions)
    total_io = sum(safe_float(s.get("request_amp_io")) for s in sessions)
    lines.append(f"\nTotal request CPU     : {total_cpu:,.1f}")
    lines.append(f"Total request IO      : {total_io:,.1f}")
    return "\n".join(lines)


def top_cpu(sessions, n=10):
    ranked = sorted(
        sessions, key=lambda s: safe_float(s.get("delta_cpu")), reverse=True
    )[:n]
    lines = ["=" * 60, f"TOP {n} SESSIONS BY DELTA CPU", "=" * 60]
    lines.append(
        f"{'User':<25} {'Session':>10} {'DeltaCPU':>12} {'ReqCPU':>12} {'Elapsed':>10}  SQL Snippet"
    )
    lines.append("-" * 100)
    for s in ranked:
        sql = str(s.get("sql_text") or "").replace("\n", " ")[:60]
        lines.append(
            f"{str(s.get('user_name', '')):<25} "
            f"{str(s.get('session_id', ''))!s:>10} "
            f"{safe_float(s.get('delta_cpu')):>12,.1f} "
            f"{safe_float(s.get('request_amp_cpu')):>12,.1f} "
            f"{fmt_seconds(s.get('elapsed_time')):>10}  "
            f"{sql}"
        )
    return "\n".join(lines)


def top_io(sessions, n=10):
    ranked = sorted(
        sessions, key=lambda s: safe_float(s.get("delta_io")), reverse=True
    )[:n]
    lines = ["=" * 60, f"TOP {n} SESSIONS BY DELTA IO", "=" * 60]
    lines.append(
        f"{'User':<25} {'Session':>10} {'DeltaIO':>12} {'ReqIO':>12} {'Elapsed':>10}  SQL Snippet"
    )
    lines.append("-" * 100)
    for s in ranked:
        sql = str(s.get("sql_text") or "").replace("\n", " ")[:60]
        lines.append(
            f"{str(s.get('user_name', '')):<25} "
            f"{str(s.get('session_id', ''))!s:>10} "
            f"{safe_float(s.get('delta_io')):>12,.1f} "
            f"{safe_float(s.get('request_amp_io')):>12,.1f} "
            f"{fmt_seconds(s.get('elapsed_time')):>10}  "
            f"{sql}"
        )
    return "\n".join(lines)


def blocked_sessions(sessions):
    blocked = [
        s
        for s in sessions
        if safe_int(s.get("blocker_count")) > 0 or s.get("blocked_by")
    ]
    lines = ["=" * 60, "BLOCKED SESSIONS", "=" * 60]
    if not blocked:
        lines.append("✓ No blocked sessions detected.")
        return "\n".join(lines)
    lines.append(f"Found {len(blocked)} blocked session(s):\n")
    for s in blocked:
        lines.append(f"  Session     : {s.get('session_id')}")
        lines.append(f"  User        : {s.get('user_name')}")
        lines.append(f"  Blocked by  : {s.get('blocked_by')}")
        lines.append(f"  Block type  : {s.get('blocker_type')}")
        lines.append(f"  Block count : {s.get('blocker_count')}")
        lines.append(f"  Blocked for : {fmt_seconds(s.get('blocked_time'))}")
        lines.append(f"  Impact      : {s.get('blocker_impact')}")
        sql = str(s.get("sql_text") or "").replace("\n", " ")[:120]
        if sql:
            lines.append(f"  SQL         : {sql}")
        lines.append("")
    return "\n".join(lines)


def long_running(sessions, threshold_seconds=300, n=20):
    ranked = sorted(
        sessions, key=lambda s: safe_int(s.get("elapsed_time")), reverse=True
    )[:n]
    lines = [
        "=" * 60,
        f"LONG-RUNNING SESSIONS (>{fmt_seconds(threshold_seconds)})",
        "=" * 60,
    ]
    long = [s for s in ranked if safe_int(s.get("elapsed_time")) >= threshold_seconds]
    if not long:
        lines.append(
            f"✓ No sessions running longer than {fmt_seconds(threshold_seconds)}."
        )
        return "\n".join(lines)
    for s in long:
        sql = str(s.get("sql_text") or "").replace("\n", " ")[:80]
        lines.append(
            f"  {fmt_seconds(s.get('elapsed_time')):>10}  "
            f"{str(s.get('user_name', '')):<25}  "
            f"sid={s.get('session_id')}  {sql}"
        )
    return "\n".join(lines)


def skew_analysis(sessions, skew_threshold=80, n=15):
    high_cpu_skew = sorted(
        [s for s in sessions if safe_float(s.get("cpu_skew")) >= skew_threshold],
        key=lambda s: safe_float(s.get("cpu_skew")),
        reverse=True,
    )[:n]
    high_io_skew = sorted(
        [s for s in sessions if safe_float(s.get("disk_skew")) >= skew_threshold],
        key=lambda s: safe_float(s.get("disk_skew")),
        reverse=True,
    )[:n]

    lines = ["=" * 60, f"SKEW ANALYSIS (threshold: {skew_threshold}%)", "=" * 60]
    lines.append(f"\n--- High CPU Skew ({len(high_cpu_skew)} sessions) ---")
    for s in high_cpu_skew:
        lines.append(
            f"  cpu_skew={safe_float(s.get('cpu_skew')):.1f}%  req_cpu_skew={safe_float(s.get('req_cpu_skew')):.1f}%  user={s.get('user_name')}  sid={s.get('session_id')}"
        )
    if not high_cpu_skew:
        lines.append("  ✓ None detected.")

    lines.append(f"\n--- High IO (Disk) Skew ({len(high_io_skew)} sessions) ---")
    for s in high_io_skew:
        lines.append(
            f"  disk_skew={safe_float(s.get('disk_skew')):.1f}%  req_io_skew={safe_float(s.get('req_io_skew')):.1f}%  user={s.get('user_name')}  sid={s.get('session_id')}"
        )
    if not high_io_skew:
        lines.append("  ✓ None detected.")

    return "\n".join(lines)


def all_analyses(sessions):
    parts = [
        summary(sessions),
        "",
        top_cpu(sessions),
        "",
        top_io(sessions),
        "",
        blocked_sessions(sessions),
        "",
        long_running(sessions),
        "",
        skew_analysis(sessions),
    ]
    return "\n".join(parts)


def main():
    parser = argparse.ArgumentParser(description="Analyze Teradata Viewpoint sessions")
    parser.add_argument(
        "input", nargs="?", default="-", help="Path to sessions JSON (or - for stdin)"
    )
    parser.add_argument(
        "--mode",
        default="summary",
        choices=[
            "summary",
            "top-cpu",
            "top-io",
            "blocked",
            "long-running",
            "skew",
            "all",
        ],
        help="Analysis mode (default: summary)",
    )
    parser.add_argument(
        "--top-n", type=int, default=10, help="Number of results for top-* modes"
    )
    parser.add_argument(
        "--long-threshold",
        type=int,
        default=300,
        help="Long-running threshold in seconds",
    )
    parser.add_argument(
        "--skew-threshold", type=float, default=80.0, help="Skew %% threshold"
    )
    args = parser.parse_args()

    sessions = load_sessions(args.input)
    if isinstance(sessions, dict):
        sessions = sessions.get("content", [])

    mode_map = {
        "summary": lambda: summary(sessions),
        "top-cpu": lambda: top_cpu(sessions, n=args.top_n),
        "top-io": lambda: top_io(sessions, n=args.top_n),
        "blocked": lambda: blocked_sessions(sessions),
        "long-running": lambda: long_running(
            sessions, threshold_seconds=args.long_threshold
        ),
        "skew": lambda: skew_analysis(sessions, skew_threshold=args.skew_threshold),
        "all": lambda: all_analyses(sessions),
    }
    print(mode_map[args.mode]())


if __name__ == "__main__":
    main()
