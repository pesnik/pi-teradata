---
description: Estimate query cost from EXPLAIN output — highlights expensive operations
---

Run EXPLAIN on this SQL and produce a cost summary for a data engineer:

```bash
varlock run --path ~/.config/secrets/teradata/ -- bash scripts/explain_sql.sh \
  --sql "{{args}}" \
  --output-dir /tmp \
  --collect-only
```

Interpret the EXPLAIN plan and report:
1. **Estimated rows** — total rows scanned/moved
2. **Join strategy** — merge vs product vs hash; flag product joins as high risk
3. **Redistribution cost** — how much data moves between AMPs
4. **Spool estimate** — memory pressure risk
5. **Statistics confidence** — "high confidence" vs "no confidence" estimates
6. **COLLECT STATISTICS needed** — exact commands if the optimizer recommends them
7. **One-line verdict** — cheap / moderate / expensive, with the single biggest cost driver

If the SQL is an INSERT...SELECT, explain the SELECT portion only.
