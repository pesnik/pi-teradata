---
description: Fetch and analyze live Teradata sessions from Viewpoint
---

Run this exact command — do not explore files or read scripts first:

```bash
varlock run --path ~/.config/secrets/teradata/ -- python3 $(find ~/.pi/agent/git -path "*/pi-teradata/skills/teradata-viewpoint/scripts/fetch_sessions.py" | head -1) --output /tmp/td_sessions.json {{args}}
```

Then run:

```bash
python3 $(find ~/.pi/agent/git -path "*/pi-teradata/skills/teradata-viewpoint/scripts/analyze_sessions.py" | head -1) /tmp/td_sessions.json --mode all
```

Summarize the output: blocked sessions, top CPU/IO, high skew (>80%), long-running (>120s), product joins.
