---
description: Estimate query cost from EXPLAIN output
---

Run this exact command — do not explore files or read scripts first:

```bash
varlock run --path ~/.config/secrets/teradata/ -- bash $(find ~/.pi/agent/git -path "*/pi-teradata/skills/teradata-explain-stats/scripts/explain_sql.sh" | head -1) --sql "{{args}}" --output-dir /tmp --collect-only
```

Summarize: join strategy, redistribution cost, spool risk, statistics confidence, COLLECT STATISTICS needed, and a one-line verdict (cheap/moderate/expensive).
