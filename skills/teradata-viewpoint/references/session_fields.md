# Teradata Viewpoint Session Fields Reference

This reference describes every key returned in the sessions JSON from
`GET /api/public/systems/1/sessions?state=ACTIVE&showSql=true`.

## Identity Fields

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | int | Unique Teradata session identifier |
| `user_name` | string | Teradata username running the session |
| `user_account` | string | Account string associated with the user |
| `host_id` | int | PE (Parsing Engine) host ID |
| `logon_source` | string | Client application / logon source string |
| `proxy_user` | string | Proxy user if using trusted sessions |
| `query_band` | string | Query band string set by the application |

## State & Timing

| Field | Type | Description |
|-------|------|-------------|
| `computed_state` | string | Derived state: ACTIVE, BLOCKED, IDLE, etc. |
| `time_in_state` | int (ms) | Duration in the current computed_state |
| `elapsed_time` | int (ms) | Total elapsed time since request start |
| `request_start_time` | string (ISO8601) | Timestamp when current request began |
| `request_count` | int | Number of requests in this session |

## CPU Metrics

| Field | Type | Description |
|-------|------|-------------|
| `request_amp_cpu` | float | Cumulative AMP CPU seconds for current request |
| `cpu_use` | float | Current CPU utilization percentage |
| `impact_cpu` | float | Estimated workload manager CPU impact |
| `delta_cpu` | float | CPU delta since last sampling interval |
| `cpu_skew` | float | CPU skew % across AMPs (0–100; >80 = problematic) |
| `req_cpu_skew` | float | Request-level CPU skew % |
| `cpu_decay_level` | int | CPU throttle decay level (WLM) |

## IO Metrics

| Field | Type | Description |
|-------|------|-------------|
| `request_amp_io` | float | Cumulative AMP IO for current request |
| `delta_io` | float | IO delta since last sampling interval |
| `disk_skew` | float | Disk IO skew % across AMPs |
| `req_io_skew` | float | Request-level IO skew % |
| `unnecessary_io` | float | Unnecessary IO indicator (spool re-reads) |
| `io_decay_level` | int | IO throttle decay level (WLM) |

## Spool / Memory

| Field | Type | Description |
|-------|------|-------------|
| `temp_space` | float | Temp space used (bytes) |
| `req_amp_spool` | float | Spool space used by current request (bytes) |
| `request_redrive_spool_space` | float | Spool used for redrive |
| `request_hot_amp_spool` | float | Hot AMP spool indicator |
| `request_spool_skew` | float | Spool skew % across AMPs |

## Workload Management

| Field | Type | Description |
|-------|------|-------------|
| `workload_name` | string | Active Workload (TASM/TDWM) name |
| `workload_method` | string | Classification method used |
| `classification_mode` | string | Auto / manual classification |
| `virtual_partition_name` | string | Virtual partition name |
| `partition_name` | string | Physical partition name |

## Blocking

| Field | Type | Description |
|-------|------|-------------|
| `blocked_by` | int / null | Session ID of the blocking session (null = not blocked) |
| `blocker_type` | string | Type of lock causing the block (ROW, TABLE, etc.) |
| `blocker_count` | int | Number of sessions this session is blocking |
| `blocked_time` | int (s) | Seconds this session has been blocked |
| `blocker_impact` | string | Impact level of the blocking (HIGH/MEDIUM/LOW) |

## Query Info

| Field | Type | Description |
|-------|------|-------------|
| `sql_text` | string | SQL text of the current request (requires showSql=true) |
| `session_explain` | string | Explain text if available |
| `product_join_indicator` | bool | True if query uses a product join (performance risk) |

---

## Key Derived Signals for Agent Reasoning

### 🔴 Critical Flags
- `blocked_by != null` → Session is blocked; look at `blocker_type` and `blocked_time`
- `blocker_count > 0` → This session IS blocking others; high priority to investigate
- `cpu_skew > 80` or `disk_skew > 80` → AMP imbalance; query may be poorly structured
- `product_join_indicator == true` → Cartesian-like join; potential runaway query

### 🟡 Warning Signals
- `elapsed_time > 300000` (5 min) → Unusually long query
- `delta_cpu` high over multiple polls → Active CPU consumer
- `req_amp_spool` very large → Risk of spool-out
- `unnecessary_io > 0` → Re-reading spool; sub-optimal plan

### 🟢 Context Clues
- `logon_source` → Identify client tool (JDBC, ODBC, BTEQ, etc.)
- `query_band` → Application tags for chargeback / root-cause
- `workload_name` → Which WLM bucket is handling this; helps understand priority
- `user_account` → Account-level attribution

---

## Common jq Patterns

```bash
# Top 5 CPU consumers
jq 'sort_by(-.delta_cpu)[:5] | .[] | "\(.user_name) cpu=\(.delta_cpu)"' sessions.json

# All blocked sessions
jq 'map(select(.blocked_by != null)) | .[] | .session_id' sessions.json

# Sessions with product join
jq 'map(select(.product_join_indicator == true)) | length' sessions.json

# Unique workloads active
jq '[.[].workload_name] | unique' sessions.json

# Sessions longer than 10 minutes
jq 'map(select(.elapsed_time > 600000)) | length' sessions.json
```
