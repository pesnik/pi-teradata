---
name: teradata-sql-idioms
description: Use when writing or reviewing Teradata SQL — covers idempotent DDL/DML patterns, Primary Index selection, PPI, and Teradata-specific syntax that differs from generic ANSI SQL.
---

# Teradata SQL idioms

## Idempotent DDL

Teradata has no `CREATE TABLE IF NOT EXISTS`. Use a metadata check instead:

```sql
SELECT COUNT(*) FROM dbc.TablesV
WHERE UPPER(DatabaseName) = UPPER('mydb') AND UPPER(TableName) = UPPER('mytable');
-- if 0, then run the CREATE TABLE
```

Or wrap in BTEQ with `.IF ERRORCODE <> 0 THEN .QUIT` after attempting the
CREATE and treating "already exists" (5612) as non-fatal.

## Idempotent DML

Prefer `MERGE` over `INSERT` when a rerun is possible:

```sql
MERGE INTO target t
USING source s ON t.id = s.id
WHEN MATCHED THEN UPDATE SET col = s.col
WHEN NOT MATCHED THEN INSERT (id, col) VALUES (s.id, s.col);
```

## Primary Index selection

- Choose a PI with high cardinality and even distribution — a low-cardinality
  or skewed PI concentrates rows on a few AMPs and slows every query touching
  that table.
- Avoid choosing a PI purely because it's the natural join key if it's known
  to skew (e.g. a status column with 3 values).
- `NO PRIMARY INDEX` (NoPI) tables exist for staging/load scenarios where
  distribution doesn't matter yet.

## Partitioning (PPI)

For large fact tables filtered by date in most queries, a
`PARTITION BY RANGE_N(date_col BETWEEN ... EACH INTERVAL '1' MONTH)` clause
lets the optimizer prune partitions instead of scanning the whole table.

## Statistics

`COLLECT STATISTICS` on join columns and PI columns after any bulk load —
stale or missing stats are the single most common cause of a bad plan
(product joins, wrong join order).

## Common gotchas vs. generic SQL

- No `LIMIT` — use `SELECT TOP n` or `QUALIFY ROW_NUMBER() OVER (...) <= n`.
- Date arithmetic: `date_col + INTERVAL '1' DAY`, not `date_col + 1` in all
  contexts — check column type first.
- `CASE_N` / `RANGE_N` are Teradata-specific and often faster than nested
  `CASE WHEN` for partitioning-style logic.
