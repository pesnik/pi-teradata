---
description: Fetch and analyze live Teradata sessions from Viewpoint
---

Use the teradata-viewpoint skill to fetch active sessions and produce a summary:

```bash
SKILL_DIR=$(find ~/.pi/agent/git -path "*/pi-teradata/skills/teradata-viewpoint" -type d 2>/dev/null | head -1)
varlock run --path ~/.config/secrets/teradata/ -- python "$SKILL_DIR/scripts/fetch_sessions.py" --output /tmp/td_sessions.json
python "$SKILL_DIR/scripts/analyze_sessions.py" /tmp/td_sessions.json --mode all
```

Filter options: {{args}}

Examples:
- `/td-sessions` — all active sessions
- `/td-sessions --filter-user john.doe` — sessions for a specific user
- `/td-sessions --blocked-only` — only blocked sessions

After fetching, surface:
1. Blocked sessions and blocking chains
2. Top CPU/IO consumers
3. High-skew queries (>80%)
4. Long-running queries (default >120s)
5. Product joins (Cartesian — highest risk)
