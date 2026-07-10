#!/usr/bin/env python3
"""
fetch_sessions.py — Fetch active sessions from Teradata Viewpoint API.

Usage:
    python fetch_sessions.py [--username USERNAME] [--password PASSWORD]
    python fetch_sessions.py --output raw.json
    python fetch_sessions.py --filter-user john.doe
    python fetch_sessions.py --state ACTIVE --show-sql

Environment:
    TD_HOST, TD_USER, TD_PASS can be set in .env file at project root

Output:
    Prints JSON array of session objects to stdout (or file if --output given).
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
import urllib.error
import ssl

# Load .env from project root if exists
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Go up: scripts -> teradata-viewpoint -> skills -> project root
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "../../.."))
ENV_FILE = os.path.join(PROJECT_ROOT, ".env")

if os.path.exists(ENV_FILE):
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key, value)

VIEWPOINT_BASE_URL = os.environ.get("VIEWPOINT_URL")
if not VIEWPOINT_BASE_URL:
    print("[ERROR] VIEWPOINT_URL environment variable is required.", file=sys.stderr)
    sys.exit(1)
ACCEPT_HEADER = "application/vnd.com.teradata.viewpoint-v1.0+json"


def build_url(state="ACTIVE", show_sql=True, extra_params=None):
    params = f"?state={state}&showSql={'true' if show_sql else 'false'}"
    if extra_params:
        for k, v in extra_params.items():
            params += f"&{k}={v}"
    return VIEWPOINT_BASE_URL + params


def fetch_sessions(username=None, password=None, state="ACTIVE", show_sql=True):
    """Fetch sessions from Viewpoint API. Returns parsed JSON list of sessions."""
    url = build_url(state=state, show_sql=show_sql)

    # Build auth header - use args, then env vars, then fail
    if username and password:
        creds = base64.b64encode(f"{username}:{password}".encode()).decode()
        auth_header = f"Basic {creds}"
    elif os.environ.get("VIEWPOINT_USER") and os.environ.get("VIEWPOINT_PASS"):
        creds = base64.b64encode(
            f"{os.environ['VIEWPOINT_USER']}:{os.environ['VIEWPOINT_PASS']}".encode()
        ).decode()
        auth_header = f"Basic {creds}"
    else:
        print(
            "[ERROR] No credentials provided. Set VIEWPOINT_USER/VIEWPOINT_PASS in .env or use --username/--password",
            file=sys.stderr,
        )
        sys.exit(1)

    req = urllib.request.Request(url)
    req.add_header("Accept", ACCEPT_HEADER)
    req.add_header("Authorization", auth_header)

    # Bypass SSL verification for internal/self-signed certs
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            if not raw.strip():
                return []
            data = json.loads(raw)
            # Navigate to sessions list
            sessions = data.get("content", data) if isinstance(data, dict) else data
            return sessions
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[ERROR] HTTP {e.code}: {e.reason}", file=sys.stderr)
        print(f"[ERROR] Response: {body[:500]}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"[ERROR] Connection failed: {e.reason}", file=sys.stderr)
        sys.exit(1)


def filter_sessions(sessions, username_filter=None, workload=None, blocked_only=False):
    """Filter session list by various criteria."""
    result = sessions
    if username_filter:
        result = [
            s
            for s in result
            if username_filter.lower() in str(s.get("user_name", "")).lower()
        ]
    if workload:
        result = [
            s
            for s in result
            if workload.lower() in str(s.get("workload_name", "")).lower()
        ]
    if blocked_only:
        result = [
            s for s in result if s.get("blocked_by") or s.get("blocker_count", 0) > 0
        ]
    return result


def main():
    parser = argparse.ArgumentParser(
        description="Fetch Teradata Viewpoint active sessions"
    )
    parser.add_argument("--username", help="Viewpoint username (overrides default)")
    parser.add_argument("--password", help="Viewpoint password (overrides default)")
    parser.add_argument(
        "--state", default="ACTIVE", help="Session state filter (default: ACTIVE)"
    )
    parser.add_argument(
        "--show-sql", action="store_true", default=True, help="Include SQL text"
    )
    parser.add_argument("--output", help="Write output to file instead of stdout")
    parser.add_argument("--filter-user", help="Filter by username substring")
    parser.add_argument("--filter-workload", help="Filter by workload name substring")
    parser.add_argument(
        "--blocked-only", action="store_true", help="Show only blocked sessions"
    )
    parser.add_argument(
        "--pretty", action="store_true", default=True, help="Pretty-print JSON"
    )
    args = parser.parse_args()

    sessions = fetch_sessions(
        username=args.username,
        password=args.password,
        state=args.state,
        show_sql=args.show_sql,
    )

    sessions = filter_sessions(
        sessions,
        username_filter=args.filter_user,
        workload=args.filter_workload,
        blocked_only=args.blocked_only,
    )

    output = json.dumps(sessions, indent=2 if args.pretty else None)

    if args.output:
        with open(args.output, "w") as f:
            f.write(output)
        print(f"[OK] Wrote {len(sessions)} sessions to {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
