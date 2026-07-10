---
name: teradata-viewpoint
description: >
  Monitor and analyze live Teradata database sessions using the Viewpoint API.
  Use this skill whenever the user asks about: running Teradata queries, active sessions,
  blocked queries, long-running jobs, CPU/IO hogs, workload analysis, skew detection,
  spool usage, or any real-time Teradata performance question. Triggers on phrases like
  "what's running on Teradata", "show active sessions", "who is blocking", "top CPU queries",
  "slow queries", "check Teradata load", "Viewpoint monitoring", or any request to inspect,
  diagnose, or act on live Teradata workload data.
---

# Teradata Viewpoint Monitoring Skill

This skill equips the agent to fetch, parse, and reason over live Teradata session data
from the Viewpoint REST API — without doing any of the heavy lifting manually.

> **Related Skill**: After identifying slow/blocked queries, use the **teradata-explain-stats**
> skill to run EXPLAIN and get COLLECT STATISTICS recommendations for query optimization.

---

## Output Format

This skill produces a JSON file with session data:
- **File**: `/tmp/td_sessions.json`
- **Format**: Array of session objects with fields: `session_id`, `user_name`, `sql_text`, `elapsed_time`, `cpu_skew`, `blocked_by`, etc.
- **Consumed by**: `teradata-explain-stats` skill (via `--sessions-file`)

## Agent Guidance

After running this skill, the agent SHOULD proactively suggest:

1. **If sessions found** → "Would you like me to check these queries for missing statistics using EXPLAIN?"
2. **If blocked sessions found** → "There are X blocked sessions. Would you like me to analyze the blocking chains?"
3. **If high CPU skew** → "Found queries with >80% CPU skew. Run EXPLAIN to get optimization recommendations."

---

## Quick Start

### Step 1 — Fetch active sessions

```bash
varlock run --path ~/.config/secrets/teradata/ -- python scripts/fetch_sessions.py --output /tmp/td_sessions.json
```

This writes a JSON array of active session objects to `/tmp/td_sessions.json`.

Credentials are loaded from `~/.config/secrets/teradata/.env` via varlock.

**Additional fetch options:**
```
--filter-user  <name>    Only return sessions for a specific user
--blocked-only           Only return blocked sessions
--state        ACTIVE    Session state filter (default: ACTIVE)
--show-sql               Include SQL text (enabled by default)
```

### Step 2 — Analyze / reason

Use the Python analyzer for structured analysis:

```bash
# Full report (all dimensions):
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode all

# Specific modes:
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode summary
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode top-cpu
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode top-io
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode blocked
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode long-running --long-threshold 120
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode skew --skew-threshold 70
```

Use the bash/jq toolkit for ad-hoc queries:

```bash
bash scripts/jq_queries.sh /tmp/td_sessions.json top-cpu
bash scripts/jq_queries.sh /tmp/td_sessions.json blocked
bash scripts/jq_queries.sh /tmp/td_sessions.json by-workload
bash scripts/jq_queries.sh /tmp/td_sessions.json long-running /tmp/td_sessions.json 180
bash scripts/jq_queries.sh /tmp/td_sessions.json user-sessions /tmp/td_sessions.json john.doe
bash scripts/jq_queries.sh /tmp/td_sessions.json get-sql /tmp/td_sessions.json 12345
bash scripts/jq_queries.sh /tmp/td_sessions.json session-detail /tmp/td_sessions.json 12345
```

---

## Parallel Analysis Pattern

When the user asks for a comprehensive assessment, run multiple analyses **in parallel**:

```bash
# Fetch once, analyze in parallel
varlock run --path ~/.config/secrets/teradata/ -- python scripts/fetch_sessions.py --output /tmp/td_sessions.json && \
  python scripts/analyze_sessions.py /tmp/td_sessions.json --mode top-cpu &
  python scripts/analyze_sessions.py /tmp/td_sessions.json --mode blocked &
  python scripts/analyze_sessions.py /tmp/td_sessions.json --mode long-running &
  python scripts/analyze_sessions.py /tmp/td_sessions.json --mode skew &
  wait
```

Or use `--mode all` as a single-command equivalent.

---

## Reasoning Guide

After fetching and analyzing, reason systematically:

### 1. Blocked sessions → highest priority
If `blocked_by` is set on any session, surface this immediately:
- Who is blocking whom (`blocked_by` → `session_id` cross-reference)
- Lock type (`blocker_type`): ROW, TABLE, ACCESS — helps estimate impact
- `blocked_time`: How long the wait has been
- `blocker_impact`: HIGH/MEDIUM/LOW

### 2. Resource hogs (CPU & IO)
- Sort by `delta_cpu` and `delta_io` (current interval activity, more meaningful than cumulative)
- Also check `request_amp_cpu` for total request cost
- Check `impact_cpu` for workload manager's view of impact

### 3. Skew detection
- `cpu_skew > 80%` or `disk_skew > 80%` → AMP imbalance; query likely has data distribution or PI issue
- `req_cpu_skew` and `req_io_skew` give request-level skew
- Cross-reference with `sql_text` to identify the problematic table/join

### 4. Spool risk
- `req_amp_spool` large values → risk of spool-out
- `request_spool_skew` indicates uneven spool distribution
- `unnecessary_io` > 0 → query re-reading spool; sub-optimal plan

### 5. Product joins
- `product_join_indicator == true` → Cartesian/product join; often runaway queries
- Always extract and show `sql_text` for these

### 6. Long-running queries
- `elapsed_time` in milliseconds; convert: `elapsed_time / 1000` = seconds
- Use `request_start_time` to report wall-clock start time

### 7. WLM context
- `workload_name` and `classification_mode` show where WLM placed the query
- `cpu_decay_level` / `io_decay_level` > 0 means WLM is throttling the query
- `virtual_partition_name` and `partition_name` give routing context

---

## API Reference

**Endpoint:**
```
GET <VIEWPOINT_URL>/api/public/systems/1/sessions
```

**Required headers:**
```
Accept: application/vnd.com.teradata.viewpoint-v1.0+json
Authorization: Basic <base64 of VIEWPOINT_USER:VIEWPOINT_PASS>
```

**Query parameters:**
```
state=ACTIVE      Filter to active sessions only
showSql=true      Include SQL text in response
```

**Response shape:**
```json
{
  "content": [ <session_object>, ... ]
}
```

The session list is at `response.content[]`.

---

## Field Reference

For full descriptions of all 43 session fields, read:
→ `references/session_fields.md`

Key fields at a glance:

| Signal | Field(s) |
|--------|----------|
| Blocking | `blocked_by`, `blocker_type`, `blocker_count`, `blocked_time`, `blocker_impact` |
| CPU load | `delta_cpu`, `request_amp_cpu`, `impact_cpu`, `cpu_use` |
| IO load | `delta_io`, `request_amp_io`, `unnecessary_io` |
| Skew | `cpu_skew`, `disk_skew`, `req_cpu_skew`, `req_io_skew` |
| Spool | `req_amp_spool`, `request_spool_skew`, `request_hot_amp_spool` |
| Query | `sql_text`, `session_explain`, `product_join_indicator` |
| Identity | `user_name`, `session_id`, `logon_source`, `query_band` |
| WLM | `workload_name`, `cpu_decay_level`, `io_decay_level`, `classification_mode` |

---

## Available Scripts

| Script | Purpose |
|--------|---------|
| `scripts/fetch_sessions.py` | Fetch + filter sessions from Viewpoint API |
| `scripts/analyze_sessions.py` | Structured analysis (summary, top-cpu, blocked, skew, etc.) |
| `scripts/jq_queries.sh` | Ad-hoc jq one-liners for quick drilldowns |

---

## Common Agent Workflows

### "What's running on Teradata right now?"
```bash
varlock run --path ~/.config/secrets/teradata/ -- python scripts/fetch_sessions.py --output /tmp/td_sessions.json
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode all
```

### "Who is causing the most load?"
```bash
varlock run --path ~/.config/secrets/teradata/ -- python scripts/fetch_sessions.py --output /tmp/td_sessions.json
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode top-cpu
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode top-io
```

### "Are there any blocked sessions?"
```bash
varlock run --path ~/.config/secrets/teradata/ -- python scripts/fetch_sessions.py --output /tmp/td_sessions.json
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode blocked
```

### "Show me what user X is running"
```bash
varlock run --path ~/.config/secrets/teradata/ -- python scripts/fetch_sessions.py --filter-user "john.doe" --output /tmp/td_sessions.json
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode summary
bash scripts/jq_queries.sh /tmp/td_sessions.json user-sessions /tmp/td_sessions.json john.doe
```

### "Any skewed or runaway queries?"
```bash
varlock run --path ~/.config/secrets/teradata/ -- python scripts/fetch_sessions.py --output /tmp/td_sessions.json
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode skew
bash scripts/jq_queries.sh /tmp/td_sessions.json product-joins
```

---

## Chained Workflow: Viewpoint + Explain Stats

Combine both skills for complete performance tuning:

### "Find slow queries and get optimization recommendations"

```bash
# Step 1: Viewpoint - fetch and analyze sessions
varlock run --path ~/.config/secrets/teradata/ -- python scripts/fetch_sessions.py --output /tmp/td_sessions.json
python scripts/analyze_sessions.py /tmp/td_sessions.json --mode all

# Step 2: Explain Stats - run EXPLAIN on specific session
# (Use the session ID from Step 1 analysis)
cd ../teradata-explain-stats
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh \
  --session-id 12345 \
  --sessions-file /tmp/td_sessions.json \
  --collect-only
```

### "Check all active queries for missing statistics"
```bash
# Step 1: Viewpoint - get sessions with SQL
varlock run --path ~/.config/secrets/teradata/ -- python scripts/fetch_sessions.py --output /tmp/td_sessions.json

# Step 2: Explain Stats - explain all sessions
cd ../teradata-explain-stats
varlock run --path ~/.config/secrets/teradata/ -- python scripts/extract_and_explain.py \
  --sessions-file /tmp/td_sessions.json \
  --all-sessions \
  --collect-only
```
