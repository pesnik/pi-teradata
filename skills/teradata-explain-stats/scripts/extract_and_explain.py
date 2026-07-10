#!/usr/bin/env python3
"""
extract_and_explain.py
----------------------
Extract sql_text from active sessions JSON, convert INSERT...SELECT to
plain SELECT, and orchestrate explain_sql.sh for each session.

Usage:
    python scripts/extract_and_explain.py \
        --sessions-file /tmp/td_sessions.json \
        [--session-id 12345] \
        [--all-sessions] \
        [--username td_user] \
        [--password td_pass] \
        [--host <td-host>] \
        [--output-dir /tmp] \
        [--collect-only]
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def load_sessions(sessions_file: str) -> list:
    with open(sessions_file) as f:
        data = json.load(f)
    return data if isinstance(data, list) else data.get("content", [])


def extract_select(sql_text: str) -> str | None:
    """
    Extract the SELECT portion from any SQL.
    Handles:
      - Plain SELECT ...
      - INSERT INTO table (...) SELECT ...
      - INSERT INTO table SELECT ...
    Returns None if no SELECT found.
    """
    sql = sql_text.strip().rstrip(";").strip()
    # Find the first SELECT keyword
    m = re.search(r"(SELECT\b.*)", sql, re.IGNORECASE | re.DOTALL)
    if m:
        return m.group(1).strip()
    return None


def run_explain(
    select_sql: str,
    session_id: int,
    host: str,
    username: str,
    password: str,
    output_dir: str,
    collect_only: bool = False,
) -> dict:
    """
    Write SELECT to a temp file and call explain_sql.sh.
    Returns dict with result metadata.
    """
    sql_file = Path(output_dir) / f"td_explain_input_{session_id}.sql"
    sql_file.write_text(select_sql)

    script_dir = Path(__file__).parent
    explain_script = script_dir / "explain_sql.sh"

    cmd = [
        "bash", str(explain_script),
        "--sql-file", str(sql_file),
        "--host", host,
        "--username", username,
        "--password", password,
        "--output-dir", output_dir,
    ]
    if collect_only:
        cmd.append("--collect-only")

    print(f"\n{'='*60}")
    print(f"  Session {session_id} — Running EXPLAIN")
    print(f"{'='*60}")
    print(f"  SQL (SELECT part):\n  {select_sql[:200]}{'...' if len(select_sql) > 200 else ''}")
    print()

    result = subprocess.run(cmd, capture_output=False, text=True)

    # Clean up temp input file
    sql_file.unlink(missing_ok=True)

    return {
        "session_id": session_id,
        "returncode": result.returncode,
    }


def main():
    parser = argparse.ArgumentParser(description="Extract SQL from sessions and run EXPLAIN")
    parser.add_argument("--sessions-file", required=True, help="Path to sessions JSON file")
    parser.add_argument("--session-id", type=int, help="Specific session ID to explain")
    parser.add_argument("--all-sessions", action="store_true", help="Run EXPLAIN for all sessions with sql_text")
    parser.add_argument("--host", default=os.environ.get("TD_HOST", ""))
    parser.add_argument("--username", default=os.environ.get("TD_USER", ""))
    parser.add_argument("--password", default=os.environ.get("TD_PASS", ""))
    parser.add_argument("--output-dir", default="/tmp")
    parser.add_argument("--collect-only", action="store_true", help="Only show COLLECT STATISTICS lines")
    parser.add_argument("--list-sql", action="store_true", help="Just list sql_text for all sessions, don't run EXPLAIN")
    args = parser.parse_args()

    if not args.username or not args.password:
        print("[ERROR] TD credentials required. Use --username / --password or set TD_USER / TD_PASS env vars.", file=sys.stderr)
        sys.exit(1)

    sessions = load_sessions(args.sessions_file)
    print(f"[INFO] Loaded {len(sessions)} session(s) from {args.sessions_file}")

    # --list-sql mode: just dump sql_text for inspection
    if args.list_sql:
        for s in sessions:
            sid = s.get("session_id")
            user = s.get("user_name", "?")
            sql = s.get("sql_text", "").strip()
            if sql:
                select = extract_select(sql)
                print(f"\n--- Session {sid} ({user}) ---")
                print(f"  Raw SQL (first 300): {sql[:300]}")
                print(f"  SELECT part:         {(select or '[No SELECT found]')[:300]}")
        return

    # Determine which sessions to process
    target_sessions = []

    if args.session_id:
        match = [s for s in sessions if s.get("session_id") == args.session_id]
        if not match:
            print(f"[ERROR] Session ID {args.session_id} not found.", file=sys.stderr)
            sys.exit(1)
        target_sessions = match

    elif args.all_sessions:
        target_sessions = [s for s in sessions if s.get("sql_text", "").strip()]
        if not target_sessions:
            print("[WARN] No sessions with sql_text found.")
            return

    else:
        print("[ERROR] Specify --session-id <id> or --all-sessions", file=sys.stderr)
        sys.exit(1)

    results = []
    for s in target_sessions:
        sid = s.get("session_id")
        user = s.get("user_name", "unknown")
        sql_raw = s.get("sql_text", "").strip()

        if not sql_raw:
            print(f"[SKIP] Session {sid} ({user}): no sql_text")
            continue

        select_sql = extract_select(sql_raw)
        if not select_sql:
            print(f"[SKIP] Session {sid} ({user}): no SELECT found in sql_text")
            print(f"       SQL preview: {sql_raw[:200]}")
            continue

        r = run_explain(
            select_sql=select_sql,
            session_id=sid,
            host=args.host,
            username=args.username,
            password=args.password,
            output_dir=args.output_dir,
            collect_only=args.collect_only,
        )
        results.append(r)

    print(f"\n[DONE] Processed {len(results)} session(s).")


if __name__ == "__main__":
    main()
