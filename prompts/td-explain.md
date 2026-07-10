---
description: Run EXPLAIN on a statement and summarize skew/cost risk in plain language
---

Run `EXPLAIN {{args}}` via the Teradata MCP query tool and summarize the plan
for a data engineer who doesn't want to parse raw Teradata explain text:

- Overall strategy (full scan vs. index access vs. join order)
- Any product joins or missing-statistics warnings
- Roughly how many rows/AMPs are touched
- One-line verdict: cheap / moderate / expensive, and why
