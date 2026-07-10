#!/usr/bin/env bash
# =============================================================================
# explain_sql.sh
# Run EXPLAIN on a SELECT statement via BTEQ and extract COLLECT STATISTICS
# suggestions from the execution plan.
#
# Priority: Docker (teradata/tpt) > Local BTEQ
#
# Usage:
#   bash scripts/explain_sql.sh --sql "SELECT ..." [options]
#   bash scripts/explain_sql.sh --sql-file /tmp/query.sql [options]
#   bash scripts/explain_sql.sh --session-id 12345 --sessions-file /tmp/td_sessions.json [options]
#
# Options:
#   --sql            "SELECT ..."         Inline SQL (SELECT part only)
#   --sql-file       /path/to/query.sql   File containing the SELECT statement
#   --session-id     12345                Pull sql_text from a sessions JSON file
#   --sessions-file  /tmp/td.json         Sessions JSON (required with --session-id)
#   --host           <td-host>            Teradata host
#   --username       <td-user>            TD username
#   --password       secret               TD password
#   --output-dir     /tmp                 Where to write explain output (default: /tmp)
#   --collect-only                        Only print COLLECT STATISTICS lines (default: false)
#   --raw                                 Print the full raw EXPLAIN output
#   --use-docker     teradata/tpt:17.20.42.00  Force Docker mode (default: auto-detect)
#   --no-docker                           Force local BTEQ mode
# =============================================================================

set -euo pipefail

# ---------- load .env from project root ----------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../" && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# ---------- defaults ----------------------------------------------------------
TD_HOST="${TD_HOST:-}"
TD_USER="${TD_USER:-}"
TD_PASS="${TD_PASS:-}"
OUTPUT_DIR="/tmp"
SQL_TEXT=""
SQL_FILE=""
SESSION_ID=""
SESSIONS_FILE=""
COLLECT_ONLY=false
SHOW_RAW=false
FORCE_DOCKER=""
FORCE_NO_DOCKER=false
DOCKER_IMAGE="teradata/tpt:17.20.42.00"

# ---------- arg parsing -------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sql)           SQL_TEXT="$2";       shift 2 ;;
    --sql-file)      SQL_FILE="$2";       shift 2 ;;
    --session-id)    SESSION_ID="$2";     shift 2 ;;
    --sessions-file) SESSIONS_FILE="$2"; shift 2 ;;
    --host)          TD_HOST="$2";        shift 2 ;;
    --username)      TD_USER="$2";        shift 2 ;;
    --password)      TD_PASS="$2";        shift 2 ;;
    --output-dir)    OUTPUT_DIR="$2";     shift 2 ;;
    --collect-only)  COLLECT_ONLY=true;   shift ;;
    --raw)           SHOW_RAW=true;       shift ;;
    --use-docker)    FORCE_DOCKER="$2";   shift 2 ;;
    --no-docker)     FORCE_NO_DOCKER=true; shift ;;
    *) echo "[ERROR] Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ---------- credential checks -------------------------------------------------
if [[ -z "$TD_USER" || -z "$TD_PASS" ]]; then
  echo "[ERROR] Teradata credentials required. Set TD_USER / TD_PASS env vars or use --username / --password." >&2
  exit 1
fi

# ---------- resolve SQL -------------------------------------------------------
if [[ -n "$SESSION_ID" ]]; then
  if [[ -z "$SESSIONS_FILE" ]]; then
    echo "[ERROR] --sessions-file is required when using --session-id" >&2
    exit 1
  fi
  # Extract sql_text for the given session_id from the sessions JSON
  SQL_TEXT=$(python3 - <<PYEOF
import json, sys
with open("${SESSIONS_FILE}") as f:
    data = json.load(f)

sessions = data if isinstance(data, list) else data.get("content", [])
sid = int("${SESSION_ID}")

for s in sessions:
    if s.get("session_id") == sid:
        sql = s.get("sql_text", "").strip()
        if not sql:
            print("[WARN] sql_text is empty for session ${SESSION_ID}", file=sys.stderr)
        print(sql)
        sys.exit(0)

print(f"[ERROR] Session ID ${SESSION_ID} not found in ${SESSIONS_FILE}", file=sys.stderr)
sys.exit(1)
PYEOF
  )
elif [[ -n "$SQL_FILE" ]]; then
  SQL_TEXT=$(cat "$SQL_FILE")
fi

if [[ -z "$SQL_TEXT" ]]; then
  echo "[ERROR] No SQL provided. Use --sql, --sql-file, or --session-id + --sessions-file." >&2
  exit 1
fi

# Strip trailing semicolons so we can safely wrap it
SQL_TEXT=$(echo "$SQL_TEXT" | sed 's/[[:space:]]*;[[:space:]]*$//')

# ---------- Safety: Only allow SELECT queries ---------------------------------
# Check BEFORE extracting SELECT from INSERT...SELECT
SAFE_CHECK=$(echo "$SQL_TEXT" | python3 -c "
import sys
import re
sql = sys.stdin.read().strip()
# Must start with SELECT, sel, SEL, or WITH (CTE)
if not re.match(r'^(SELECT|sel|SEL|WITH|with)\b', sql, re.IGNORECASE):
    print('INVALID_START')
    sys.exit(1)
# Block INSERT, UPDATE, DELETE, MERGE, UPSERT
sql_upper = sql.upper()
dangerous = ['INSERT ', 'UPDATE ', 'DELETE ', 'MERGE ', 'UPSERT ']
for kw in dangerous:
    if kw in sql_upper:
        print('BLOCKED')
        sys.exit(1)
print('OK')
")

if [[ "$SAFE_CHECK" == "BLOCKED" ]]; then
  echo "[ERROR] Blocked non-SELECT query. This script only runs EXPLAIN on SELECT statements." >&2
  echo "[ERROR] Detected: INSERT, UPDATE, DELETE, MERGE, or UPSERT keyword." >&2
  exit 1
elif [[ "$SAFE_CHECK" == "INVALID_START" ]]; then
  echo "[ERROR] Query must start with SELECT, sel, SEL, or WITH." >&2
  exit 1
fi

# Extract only the SELECT portion if the SQL contains INSERT INTO ... SELECT ...
# This handles cases like: INSERT INTO foo (col1, col2) SELECT col1, col2 FROM bar;
SELECT_PART=$(echo "$SQL_TEXT" | python3 -c "
import sys, re
sql = sys.stdin.read().strip()
# Match SELECT ... including multi-line
m = re.search(r'(SELECT\b.*)', sql, re.IGNORECASE | re.DOTALL)
if m:
    print(m.group(1).strip())
else:
    print(sql)
")

# ---------- Docker/BTEQ availability check ------------------------------------
USE_DOCKER=false

check_docker() {
  if command -v docker &>/dev/null; then
    if docker info &>/dev/null; then
      return 0
    else
      echo "[WARN] Docker command exists but daemon is not running." >&2
      return 1
    fi
  fi
  return 1
}

check_bteq() {
  if command -v bteq &>/dev/null; then
    return 0
  fi
  return 1
}

show_bteq_install_instructions() {
  echo ""
  echo "============================================================"
  echo "  BTEQ NOT FOUND — Installation Instructions"
  echo "============================================================"
  echo ""
  echo "  BTEQ is part of the Teradata Tools and Utilities (TTU) package."
  echo ""
  echo "  Option 1 — Download from Teradata Downloads:"
  echo "    https://downloads.teradata.com/download/tools/teradata-tools-and-utilities-linux"
  echo "    → Select: 'Teradata Tools and Utilities' for your Linux distro"
  echo "    → Install the .rpm or .deb package that includes 'bteq'"
  echo ""
  echo "  Option 2 — RPM-based (RHEL/CentOS):"
  echo "    sudo rpm -ivh TeradataToolsAndUtilitiesBase*.x86_64.rpm"
  echo ""
  echo "  Option 3 — Debian/Ubuntu:"
  echo "    sudo dpkg -i TeradataToolsAndUtilitiesBase*.deb"
  echo ""
  echo "  After install, verify with: which bteq && bteq -v"
  echo "============================================================"
}

# Determine execution method: Docker > Local BTEQ
if [[ "$FORCE_NO_DOCKER" == "true" ]]; then
  echo "[INFO] Docker disabled via --no-docker flag."
  if ! check_bteq; then
    echo "[ERROR] Local BTEQ not found and Docker is disabled." >&2
    show_bteq_install_instructions
    exit 2
  fi
  echo "[INFO] Using local BTEQ."
  EXEC_METHOD="bteq"
elif [[ -n "$FORCE_DOCKER" ]]; then
  echo "[INFO] Using Docker with image: $FORCE_DOCKER"
  DOCKER_IMAGE="$FORCE_DOCKER"
  EXEC_METHOD="docker"
else
  # Auto-detect: prefer Docker
  if check_docker; then
    echo "[INFO] Docker detected. Using teradata/tpt image: $DOCKER_IMAGE"
    EXEC_METHOD="docker"
  elif check_bteq; then
    echo "[INFO] Docker not available. Using local BTEQ."
    EXEC_METHOD="bteq"
  else
    echo "[ERROR] Neither Docker nor local BTEQ is available." >&2
    show_bteq_install_instructions
    echo ""
    echo "Alternatively, install Docker from: https://docker.com/get-started"
    exit 2
  fi
fi

# ---------- prepare output files ---------------------------------------------
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
EXPLAIN_OUT="${OUTPUT_DIR}/td_explain_${TIMESTAMP}.txt"
COLLECT_STATS_OUT="${OUTPUT_DIR}/td_collect_stats_${TIMESTAMP}.txt"
BTEQ_SCRIPT="${OUTPUT_DIR}/td_explain_${TIMESTAMP}.bteq"

# ---------- build BTEQ script ------------------------------------------------
cat > "$BTEQ_SCRIPT" <<BTEQ
.LOGON ${TD_HOST}/${TD_USER},${TD_PASS}

.SET SEPARATOR '|'
.SET WIDTH 10000
.SET TITLEDASHES OFF
.SET ECHOREQ OFF

EXPLAIN
${SELECT_PART};

.LOGOFF
.EXIT
BTEQ

# ---------- execute via Docker or local BTEQ ---------------------------------
if [[ "$EXEC_METHOD" == "docker" ]]; then
  echo "[INFO] Running EXPLAIN via Docker (${DOCKER_IMAGE})..."
  echo "[INFO] Output file: ${EXPLAIN_OUT}"
  
  # Run BTEQ inside Docker container
  # Mount output dir for writing results
  docker run --rm -i \
    --platform linux/amd64 \
    -v "${OUTPUT_DIR}:${OUTPUT_DIR}" \
    -e TD_HOST="${TD_HOST}" \
    -e TD_USER="${TD_USER}" \
    -e TD_PASS="${TD_PASS}" \
    -e "accept_license=Y" \
    --user "$(id -u):$(id -g)" \
    --network=host \
    --entrypoint bteq \
    "${DOCKER_IMAGE}" \
    < "$BTEQ_SCRIPT" > "$EXPLAIN_OUT" 2>&1 || true
  
  DOCKER_EXIT_CODE=$?
  
  # Clean up BTEQ script (has password in it)
  rm -f "$BTEQ_SCRIPT"
  
  if [[ $DOCKER_EXIT_CODE -ne 0 ]]; then
    echo "[WARN] Docker container exited with code ${DOCKER_EXIT_CODE}. Check ${EXPLAIN_OUT} for details."
  fi
else
  echo "[INFO] Running EXPLAIN via local BTEQ..."
  echo "[INFO] Output file: ${EXPLAIN_OUT}"
  
  # Run local BTEQ
  bteq < "$BTEQ_SCRIPT" > "$EXPLAIN_OUT" 2>&1 || true
  
  # Clean up BTEQ script (has password in it)
  rm -f "$BTEQ_SCRIPT"
fi

# Check for obvious failure
if grep -qi "Logon failed\|CLI error\|Error in\|Failure " "$EXPLAIN_OUT"; then
  echo "[WARN] Possible connection error detected. Check ${EXPLAIN_OUT} for details."
fi

echo "[INFO] EXPLAIN output saved to: ${EXPLAIN_OUT}"
echo "[INFO] Lines in explain output: $(wc -l < "$EXPLAIN_OUT")"

# ---------- extract COLLECT STATISTICS lines ---------------------------------
echo ""
echo "============================================================"
echo "  Extracting COLLECT STATISTICS recommendations..."
echo "============================================================"

grep -i "COLLECT STATISTICS" "$EXPLAIN_OUT" > "$COLLECT_STATS_OUT" || true

COUNT=$(wc -l < "$COLLECT_STATS_OUT")

if [[ "$COUNT" -eq 0 ]]; then
  echo "[OK] No COLLECT STATISTICS recommendations found in execution plan."
  echo "     (Either stats are up to date, or the optimizer has no suggestions.)"
else
  echo "[!] Found ${COUNT} COLLECT STATISTICS recommendation(s):"
  echo ""
  cat "$COLLECT_STATS_OUT"
  echo ""
  echo "[INFO] COLLECT STATISTICS lines saved to: ${COLLECT_STATS_OUT}"
fi

echo ""

# ---------- optional: show raw output ----------------------------------------
if [[ "$SHOW_RAW" == "true" ]]; then
  echo "============================================================"
  echo "  Full EXPLAIN Output"
  echo "============================================================"
  cat "$EXPLAIN_OUT"
fi

# ---------- return paths for downstream use ----------------------------------
echo "EXPLAIN_FILE=${EXPLAIN_OUT}"
echo "COLLECT_STATS_FILE=${COLLECT_STATS_OUT}"
echo "COLLECT_STATS_COUNT=${COUNT}"
