---
name: teradata-explain-stats
description: >
  Run EXPLAIN on Teradata SELECT statements via BTEQ and extract COLLECT STATISTICS
  recommendations from the execution plan. Use this skill whenever the user asks to
  explain a query, check for missing statistics, find optimizer hints, diagnose bad
  query plans, or get COLLECT STATISTICS commands for any active or provided SQL.
  Triggers on phrases like "explain this query", "missing stats", "collect statistics",
  "why is this query slow", "optimizer hints", "check the plan", "explain the INSERT",
  or any request to inspect the Teradata execution plan for a given SQL statement.
  Works standalone or chained after the teradata-viewpoint skill (which provides the
  sessions JSON containing sql_text).
---

# Teradata EXPLAIN & COLLECT STATISTICS Skill

This skill runs `EXPLAIN` on a Teradata SELECT statement via BTEQ (using Docker or local installation), saves the full execution plan to a file, and greps out only the `COLLECT STATISTICS` recommendations to keep agent context minimal.

> **Related Skill**: First use the **teradata-viewpoint** skill to fetch current sessions
> and identify queries that need optimization (slow, blocked, high CPU, etc.).

---

## Input Format

This skill accepts:
- **Inline SQL**: `--sql "SELECT ..."`
- **Session from Viewpoint**: `--session-id 12345 --sessions-file /tmp/td_sessions.json`
- **SQL File**: `--sql-file /path/to/query.sql`

## Output Format

- **EXPLAIN file**: `/tmp/td_explain_<timestamp>.txt` (full plan)
- **Stats recommendations**: `/tmp/td_collect_stats_<timestamp>.txt` (COLLECT STATISTICS commands only)

## Agent Guidance

After running this skill, the agent SHOULD:

1. **If COLLECT STATISTICS found** → Present the exact commands, grouped by table
2. **If product join detected** → Flag as high priority - query needs rewrite
3. **If no recommendations** → "Statistics appear up to date. If query is still slow, consider checking join order or indexing."
4. **Offer to execute** → "Would you like me to run these COLLECT STATISTICS commands?"

---

## Execution Priority

The script automatically selects the execution method:

1. **Docker (teradata/tpt)** — Preferred if Docker is available on the machine
2. **Local BTEQ** — Fallback if Docker is not available

---

## Prerequisites

### Option 1 — Docker (Recommended)

```bash
# Verify Docker is available
which docker && docker --version

# Pull the Teradata TPT image (one-time setup)
docker pull teradata/tpt:17.20.42.00
```

The script will automatically detect Docker and use the `teradata/tpt` image. No additional configuration needed.

### Option 2 — Local BTEQ (Fallback)

If Docker is not available, install BTEQ locally:

```bash
which bteq && bteq -v
```

**If not found**, install it:

```
BTEQ is part of Teradata Tools and Utilities (TTU).

Download: https://downloads.teradata.com/download/tools/teradata-tools-and-utilities-linux
  → Select TTU for your Linux distro
  → Install the package that includes 'bteq'

RPM-based (RHEL / CentOS):
  sudo rpm -ivh TeradataToolsAndUtilitiesBase*.x86_64.rpm

Debian / Ubuntu:
  sudo dpkg -i TeradataToolsAndUtilitiesBase*.deb

Verify:
  which bteq && bteq -v
```

---

## Force Execution Method

Override automatic detection:

```bash
# Force Docker mode
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh --use-docker teradata/tpt:17.20.42.00 --sql "SELECT ..."

# Force local BTEQ (skip Docker)
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh --no-docker --sql "SELECT ..."
```

---

## Available Scripts

| Script | Purpose |
|--------|---------|
| `scripts/explain_sql.sh` | Run EXPLAIN via BTEQ; save full plan; grep COLLECT STATISTICS |
| `scripts/extract_and_explain.py` | Orchestrate EXPLAIN for one or all sessions from a sessions JSON |

---

## Usage

### Case 1 — Inline SELECT

```bash
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh \
  --sql "SELECT DATE_KEY, GEOGRAPHY_KEY FROM DP_STG.S_GA_NETWORK_KPI_LD" \
  --output-dir /tmp
```

### Case 2 — SQL from a file

```bash
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh \
  --sql-file /tmp/my_query.sql \
  --output-dir /tmp
```

### Case 3 — INSERT...SELECT (agent extracts the SELECT automatically)

When sql_text contains `INSERT INTO ... SELECT ...`, the script automatically
strips the INSERT header and runs EXPLAIN on the SELECT part only. Just pass
the full SQL as-is:

```bash
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh \
  --sql "INSERT INTO DP_ETL_VEW.GEOGRAPHY_ACTIVITY_FCT(DATE_KEY, GEOGRAPHY_KEY, GEOGRAPHY_ACTIVITY_KEY, GEOGRAPHY_ACTIVITY_VALUE, ETL_DATE_KEY) SELECT DATE_KEY, GEOGRAPHY_KEY, GEOGRAPHY_ACTIVITY_KEY, GEOGRAPHY_ACTIVITY_VALUE, ETL_DATE_KEY FROM DP_STG.S_GA_NETWORK_KPI_LD" \
  --output-dir /tmp
```

EXPLAIN will run on the extracted SELECT:
```sql
EXPLAIN
SELECT DATE_KEY, GEOGRAPHY_KEY, GEOGRAPHY_ACTIVITY_KEY,
       GEOGRAPHY_ACTIVITY_VALUE, ETL_DATE_KEY
FROM DP_STG.S_GA_NETWORK_KPI_LD;
```

### Case 4 — From a session ID (chained with teradata-viewpoint)

First fetch sessions using the `teradata-viewpoint` skill, then pass the JSON here:

```bash
# Step 1 — fetch (teradata-viewpoint skill)
varlock run --path ~/.config/secrets/teradata/ -- python ../teradata-viewpoint/scripts/fetch_sessions.py --output /tmp/td_sessions.json

# Step 2 — explain a specific session (this skill)
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh \
  --session-id 12345 \
  --sessions-file /tmp/td_sessions.json \
  --output-dir /tmp
```

### Case 5 — EXPLAIN all active sessions with SQL

```bash
varlock run --path ~/.config/secrets/teradata/ -- python scripts/extract_and_explain.py \
  --sessions-file /tmp/td_sessions.json \
  --all-sessions \
  --output-dir /tmp \
  --collect-only
```

---

## How Output Is Handled (Context Minimization)

EXPLAIN output from Teradata can be **thousands of lines**. To keep agent context lean:

1. **Full plan saved to file** — never printed to stdout by default:
   ```
   /tmp/td_explain_<timestamp>.txt
   ```

2. **COLLECT STATISTICS lines only** are extracted via grep and shown:
   ```
   /tmp/td_collect_stats_<timestamp>.txt
   ```

3. The agent reads and responds with **only the COLLECT STATISTICS recommendations**.

4. To inspect the full plan when needed:
   ```bash
   cat /tmp/td_explain_<timestamp>.txt
   # or pass --raw to explain_sql.sh
   ```

5. To search the plan for other patterns:
   ```bash
   grep -i "product join\|no confidence\|all-rows scan\|redistrib" /tmp/td_explain_*.txt
   ```

---

## Credentials

Credentials are loaded from `~/.config/secrets/teradata/.env` via varlock. Always invoke scripts with:

```bash
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh ...
varlock run --path ~/.config/secrets/teradata/ -- python scripts/extract_and_explain.py ...
```

You can also override via CLI args: `--username` / `--password`.

---

## Safety Checks

The script enforces **read-only** EXPLAIN operations:

- Query must start with: `SELECT`, `sel`, `SEL`, or `WITH` (for CTEs)
- Blocked keywords: `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `UPSERT`
- Case-insensitive matching

This prevents accidental execution of write operations.

---

## All Script Options — explain_sql.sh

```
--sql            "SELECT ..."         Inline SQL (full INSERT..SELECT or plain SELECT)
--sql-file       /path/to/file.sql    File containing the SQL
--session-id     12345                Pull sql_text from a sessions JSON (requires --sessions-file)
--sessions-file  /tmp/td.json         Sessions JSON produced by teradata-viewpoint fetch
--host           <td-host>            Teradata host
--username       <td-user>            Teradata username
--password       secret               Teradata password
--output-dir     /tmp                 Where to write output files (default: /tmp)
--collect-only                       Only print COLLECT STATISTICS lines (suppress other output)
--raw                                 Also print the full raw EXPLAIN output
--use-docker     [image]              Force Docker mode (default: teradata/tpt:17.20.42.00)
--no-docker                           Force local BTEQ mode (skip Docker)
```

---

## All Script Options — extract_and_explain.py

```
--sessions-file  /tmp/td.json    Sessions JSON (required)
--session-id     12345           EXPLAIN a single session
--all-sessions                   EXPLAIN all sessions that have sql_text
--list-sql                       Dry-run: just show sql_text per session, don't run EXPLAIN
--host           <td-host>
--username       <td-user>
--password       secret
--output-dir     /tmp
--collect-only                   Only show COLLECT STATISTICS lines
```

---

## Reasoning Over COLLECT STATISTICS Output

When the EXPLAIN plan returns COLLECT STATISTICS suggestions:

1. **Present each recommendation verbatim** — these are optimizer-generated commands ready to execute.

2. **Group by table** — multiple suggestions on the same table should be highlighted together for batching.

3. **Explain the impact** — missing stats cause the optimizer to use default row estimates, leading to:
   - Bad join order (wrong table accessed first)
   - Wrong spool estimates (memory allocation issues)
   - Unnecessary AMP redistributions (expensive data movement)
   - Full table scans instead of index usage

4. **Priority guidance**:
   - **High**: Column stats on frequently joined columns (foreign keys)
   - **High**: Index statistics for primary/secondary indexes
   - **Medium**: Multi-column stats for composite WHERE clauses
   - **Low**: Full table stats (usually auto-collected)

5. **Offer to run them** — if the user confirms, execute via BTEQ:
    ```bash
    bteq <<EOF
    .LOGON ${TD_HOST}/${TD_USER},${TD_PASS}
    COLLECT STATISTICS ON DP_STG.S_GA_NETWORK_KPI_LD COLUMN DATE_KEY;
    COLLECT STATISTICS ON DP_STG.S_GA_NETWORK_KPI_LD COLUMN (DATE_KEY, GEOGRAPHY_KEY);
    .LOGOFF
    .EXIT
    EOF
    ```

---

## Other Optimizer Signals to Grep

Beyond COLLECT STATISTICS, these patterns in the explain file indicate deeper problems:

```bash
# Optimizer has no confidence in row estimates
grep -i "no confidence" /tmp/td_explain_*.txt

# Cartesian / product joins — potential runaway queries
grep -i "product join" /tmp/td_explain_*.txt

# Full table scans — no index or stats being used
grep -i "all-rows scan\|all rows scan" /tmp/td_explain_*.txt

# Data redistribution between AMPs — expensive movement
grep -i "redistrib" /tmp/td_explain_*.txt

# Spool usage estimates
grep -i "spool" /tmp/td_explain_*.txt
```

---

## Common Workflows

### "Explain this query and check for missing stats"
```bash
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh \
  --sql "SELECT ..." \
  --output-dir /tmp
```

### "Check stats for what session 12345 is running"
```bash
# Assumes sessions already fetched via teradata-viewpoint
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh \
  --session-id 12345 \
  --sessions-file /tmp/td_sessions.json \
  --output-dir /tmp
```

### "Sweep all active sessions for missing stats"
```bash
varlock run --path ~/.config/secrets/teradata/ -- python scripts/extract_and_explain.py \
  --sessions-file /tmp/td_sessions.json \
  --all-sessions \
  --output-dir /tmp --collect-only
```

### "Show me the full plan for that query"
```bash
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh --raw --sql "SELECT ..." --output-dir /tmp
# or after the fact:
cat /tmp/td_explain_<timestamp>.txt
```

---

## Teradata Statistics Best Practices

### When to Collect Statistics
- After table population/refresh (ETL loads)
- After large DELETE/INSERT operations
- When query performance degrades
- As recommended by EXPLAIN plan

### What to Collect
1. **Primary Index (PI)** — Always collect stats on the primary index
2. **Foreign Keys** — Columns used for joins between tables
3. **WHERE clauses** — Columns frequently filtered in queries
4. **Partition columns** — If using partitioned primary index (PPI)
5. **High-cardinality columns** — Columns with many unique values

### Performance Considerations
- Collect during off-peak hours for large tables
- Use `SAMPLE` option for very large tables
- Multi-column stats are more expensive but more accurate

### Common Misconceptions
- ❌ "Collecting stats always improves performance" — Not always, can add overhead
- ❌ "More stats = better" — Unnecessary stats waste storage and maintenance time
- ✅ "Stats on right columns matter" — Focus on join/filter columns
- ✅ "Keep stats fresh" — Stale stats are worse than no stats
