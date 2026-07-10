# Addition to teradata-viewpoint/SKILL.md
# Add this block to the "Available Scripts" table and "Common Agent Workflows" section

## Related Skills

| Skill | When to chain it |
|-------|-----------------|
| `teradata-explain-stats` | After identifying a session of interest — pass the sessions JSON + session ID to run EXPLAIN and surface COLLECT STATISTICS recommendations |

### Workflow: "Explain what session 12345 is running"
```bash
# Step 1 — this skill: fetch sessions
python scripts/fetch_sessions.py --output /tmp/td_sessions.json

# Step 2 — hand off to teradata-explain-stats skill
bash ../teradata-explain-stats/scripts/explain_sql.sh \
  --session-id 12345 \
  --sessions-file /tmp/td_sessions.json \
  --username <td_user> --password "<td_pass>" --output-dir /tmp
```
