---
description: Profile a table using the qlty_* MCP tools and report data quality findings
---

Profile the table `{{args}}`: row count, null rates per column, key
uniqueness, and value distribution sanity checks. Use the `qlty_*` MCP tools
if available; fall back to hand-written aggregate SELECTs otherwise. Report
findings, don't just dump raw numbers.
