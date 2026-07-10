---
name: bteq-tpt-scripting
description: Use when the task involves generating BTEQ scripts or Teradata Parallel Transporter (TPT) jobs for batch loads/exports, rather than interactive MCP queries.
---

# BTEQ / TPT scripting patterns

Use this when producing a *file* the user will run outside of the agent
session (e.g. a nightly batch job), as opposed to statements the agent runs
live through the MCP tools.

## BTEQ error handling skeleton

```
.LOGON host/user,password;
.SET ERRORLEVEL 3807 SEVERITY 0   /* "table does not exist" -> non-fatal for a DROP */
.SET ERRORLEVEL 5612 SEVERITY 0   /* "already exists" -> non-fatal for a CREATE */

DROP TABLE staging.tmp_load;
CREATE TABLE staging.tmp_load AS prod.source_table WITH NO DATA;

.IF ERRORCODE <> 0 THEN .QUIT ERRORCODE;

.LOGOFF;
```

## TPT job outline (load pattern)

A TPT script generally needs:

1. A `DEFINE SCHEMA` matching the source file layout.
2. A `DEFINE OPERATOR` for the producer (e.g. `DataConnector` reading a flat
   file) and the consumer (`LOAD` or `UPDATE` operator writing to Teradata).
3. An `APPLY ... TO OPERATOR` step wiring them together.

When generating one, always:
- Match column order/types exactly between the schema and the target table.
- Use the `LOAD` operator only for empty/truncate-and-reload targets; use
  `UPDATE` (MultiLoad-style) operator for incremental upsert patterns.
- Include an error-table check step — TPT silently writes bad rows to
  `_ET`/`_UV` error tables rather than failing the job outright.

## When to prefer BTEQ/TPT generation over live MCP execution

- Anything meant to run unattended/scheduled (cron, a scheduler, an
  orchestration tool) — write the file, don't try to have the agent "be"
  the scheduled job.
- Bulk loads from flat files — the MCP query tool is for SQL against the
  database, not for streaming external files.
- Anything the approval-gate extension would otherwise force into an
  interactive confirm() loop that doesn't make sense for a batch artifact —
  generate the script, let a human review the file itself.
