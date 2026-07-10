---
name: teradata-performance-tuning
description: Use when diagnosing a slow Teradata query, reading an EXPLAIN plan, or deciding whether a query needs review before running against a large table.
---

# Teradata performance tuning

## Reading EXPLAIN output

Key phrases and what they mean:

- **"with no residual conditions"** on an all-AMPs retrieve step — full table
  scan; fine for small tables, a red flag on large fact tables without a
  partition-eliminating predicate.
- **"Product Join"** — near-always unintentional; check for a missing/typo'd
  join condition or a genuinely cross-join use case.
- **"with high/low/no confidence to be N rows"** — confidence reflects
  whether statistics exist and are current. "No confidence" or "low
  confidence" on a large estimate means: collect stats before trusting the
  plan.
- **"redistributed by hash code"** — data is being shuffled across AMPs for
  the join; expected for a join on a non-PI column, but expensive at scale.
- **Duplication of a small table across all AMPs** — normal and cheap
  optimizer behavior for small dimension tables; not a red flag by itself.

## Triage order for a slow query

1. Run `EXPLAIN` before touching anything else.
2. Check for product joins and no-confidence estimates first — usually the
   two highest-impact fixes.
3. Check the PI of the largest table involved — is the query's WHERE/JOIN
   on the PI, or forcing a redistribution?
4. Check for partition elimination if the table is PPI'd — is the date
   predicate written in a form the optimizer can use (avoid wrapping the
   partitioning column in a function).
5. Only after the above, consider secondary/join indexes.

## Workload-management awareness

Every session should carry a `QUERY_BAND` (see the queryband-tagger
extension) — this is what makes a query attributable and controllable under
Teradata's workload management (TASM/WD) rules, and it's what you'll search
by in `dbc.QryLogV` when investigating after the fact.
