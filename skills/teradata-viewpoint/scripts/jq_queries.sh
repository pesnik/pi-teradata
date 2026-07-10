#!/usr/bin/env bash
# jq_queries.sh — Pre-built jq one-liners for Teradata Viewpoint sessions JSON
# Usage: source this file or call functions directly.
#        Pass the sessions JSON file as $1 to each function.
#
# All functions: jq_<name> <sessions.json>

set -euo pipefail

SESSION_FILE="${1:-/tmp/td_sessions.json}"

# ─── Helper ───────────────────────────────────────────────────────────────────
_jq() { jq -r "$1" "$SESSION_FILE"; }

# ─── Top 10 CPU consumers ─────────────────────────────────────────────────────
top_cpu() {
  jq -r '
    sort_by(-.delta_cpu) | .[:10] |
    .[] | "\(.user_name // "?")\t\(.session_id)\t\(.delta_cpu // 0)\t\(.sql_text // "" | .[0:80])"
  ' "$SESSION_FILE" | column -t -s $'\t'
}

# ─── Top 10 IO consumers ──────────────────────────────────────────────────────
top_io() {
  jq -r '
    sort_by(-.delta_io) | .[:10] |
    .[] | "\(.user_name // "?")\t\(.session_id)\t\(.delta_io // 0)\t\(.sql_text // "" | .[0:80])"
  ' "$SESSION_FILE" | column -t -s $'\t'
}

# ─── Blocked sessions ─────────────────────────────────────────────────────────
blocked() {
  jq -r '
    map(select(.blocked_by != null and .blocked_by != "")) |
    .[] | "Session \(.session_id) user=\(.user_name) blocked_by=\(.blocked_by) type=\(.blocker_type) duration=\(.blocked_time)s"
  ' "$SESSION_FILE"
}

# ─── All users currently running queries ──────────────────────────────────────
active_users() {
  jq -r '[.[].user_name // "?"] | unique | .[]' "$SESSION_FILE"
}

# ─── Sessions per workload ────────────────────────────────────────────────────
by_workload() {
  jq -r '
    group_by(.workload_name) |
    map({workload: .[0].workload_name, count: length}) |
    sort_by(-.count) | .[] | "\(.workload // "unknown")\t\(.count)"
  ' "$SESSION_FILE" | column -t -s $'\t'
}

# ─── Long-running queries (>300s by default) ──────────────────────────────────
long_running() {
  local threshold="${2:-300}"
  jq -r --argjson t "$threshold" '
    map(select((.elapsed_time // 0) >= $t)) |
    sort_by(-.elapsed_time) | .[] |
    "\(.elapsed_time)s\t\(.user_name // "?")\t\(.session_id)\t\(.sql_text // "" | .[0:80])"
  ' "$SESSION_FILE" | column -t -s $'\t'
}

# ─── High skew sessions ───────────────────────────────────────────────────────
high_skew() {
  local threshold="${2:-80}"
  jq -r --argjson t "$threshold" '
    map(select((.cpu_skew // 0) >= $t or (.disk_skew // 0) >= $t)) |
    .[] | "sid=\(.session_id) user=\(.user_name) cpu_skew=\(.cpu_skew)% disk_skew=\(.disk_skew)%"
  ' "$SESSION_FILE"
}

# ─── Extract SQL for a specific session ID ────────────────────────────────────
get_sql() {
  local sid="${2:?Usage: get_sql <sessions.json> <session_id>}"
  jq -r --argjson sid "$sid" '
    map(select(.session_id == $sid)) | .[0].sql_text // "NOT FOUND"
  ' "$SESSION_FILE"
}

# ─── Sessions by a specific user ──────────────────────────────────────────────
user_sessions() {
  local user="${2:?Usage: user_sessions <sessions.json> <username>}"
  jq -r --arg u "$user" '
    map(select(.user_name == $u)) |
    .[] | "sid=\(.session_id) elapsed=\(.elapsed_time)s cpu=\(.delta_cpu) io=\(.delta_io) sql=\(.sql_text // "" | .[0:100])"
  ' "$SESSION_FILE"
}

# ─── Spool space hogs ─────────────────────────────────────────────────────────
top_spool() {
  jq -r '
    sort_by(-.req_amp_spool) | .[:10] |
    .[] | "\(.user_name // "?")\t\(.session_id)\t\(.req_amp_spool // 0)\t\(.workload_name // "?")"
  ' "$SESSION_FILE" | column -t -s $'\t'
}

# ─── Sessions with product join indicator ────────────────────────────────────
product_joins() {
  jq -r '
    map(select(.product_join_indicator == true or .product_join_indicator == "Y")) |
    .[] | "sid=\(.session_id) user=\(.user_name) sql=\(.sql_text // "" | .[0:100])"
  ' "$SESSION_FILE"
}

# ─── Impact CPU ──────────────────────────────────────────────────────────────
top_impact_cpu() {
  jq -r '
    sort_by(-.impact_cpu) | .[:10] |
    .[] | "\(.user_name // "?")\t\(.session_id)\t\(.impact_cpu // 0)\t\(.workload_name // "?")"
  ' "$SESSION_FILE" | column -t -s $'\t'
}

# ─── Full session detail for one session ──────────────────────────────────────
session_detail() {
  local sid="${2:?Usage: session_detail <sessions.json> <session_id>}"
  jq -r --argjson sid "$sid" 'map(select(.session_id == $sid)) | .[0]' "$SESSION_FILE"
}

# If called directly (not sourced), run the requested function
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  CMD="${2:-help}"
  case "$CMD" in
    top-cpu)       top_cpu ;;
    top-io)        top_io ;;
    blocked)       blocked ;;
    active-users)  active_users ;;
    by-workload)   by_workload ;;
    long-running)  long_running "$SESSION_FILE" "${3:-300}" ;;
    high-skew)     high_skew "$SESSION_FILE" "${3:-80}" ;;
    get-sql)       get_sql "$SESSION_FILE" "${3:?Need session_id}" ;;
    user-sessions) user_sessions "$SESSION_FILE" "${3:?Need username}" ;;
    top-spool)     top_spool ;;
    product-joins) product_joins ;;
    top-impact)    top_impact_cpu ;;
    session-detail) session_detail "$SESSION_FILE" "${3:?Need session_id}" ;;
    *)
      echo "Usage: $0 <sessions.json> <command> [arg]"
      echo "Commands: top-cpu top-io blocked active-users by-workload long-running"
      echo "          high-skew get-sql user-sessions top-spool product-joins top-impact session-detail"
      ;;
  esac
fi
