# teradata-de-agent

**A Pi package that turns the [Pi Coding Agent](https://github.com/badlogic/pi-mono) into a governed Teradata data-engineering platform.**

Inspired by [ruizrica/agent-pi](https://github.com/ruizrica/agent-pi)'s
approach of extending Pi through pure configuration — extensions, agent
definitions, and YAML, no forks — applied specifically to idiomatic,
safety-conscious Teradata data engineering on top of the
[Teradata MCP server](https://github.com/Teradata/teradata-mcp-server).

## What this is

- **6 guard extensions** that sit between the agent and the Teradata MCP
  server and enforce policy deterministically — the agent can't reason its
  way past them.
- **4 DE-specific agent roles** (planner, etl-builder, dba-reviewer,
  qa-profiler) with a team and two chain workflows wiring them into a
  propose → implement → review → verify pipeline.
- **3 skills** encoding idiomatic Teradata SQL, EXPLAIN-plan literacy, and
  BTEQ/TPT scripting — so the agent's SQL looks like a Teradata DBA wrote it,
  not generic ANSI SQL.
- **Environment profiles** (`profiles/dev.profiles.yml`,
  `profiles/prod.profiles.yml`) so the same agent behaves very differently
  against a sandbox vs. production, based on capability, not prompting.

## Install

```bash
git clone <this-repo> teradata-de-agent && cd teradata-de-agent && ./install.sh
```

or, if you already have Pi:

```bash
pi install git:<this-repo>
```

Then configure a Teradata MCP server connection (see `install.sh` output for
a starting config) and set:

```bash
export PI_TD_PROFILE=prod   # or "dev"/"sandbox" to allow writes — see docs/ARCHITECTURE.md
```

## Package layout

```
extensions/            6 guard extensions + shared sql-classify.ts helper
agents/                Role definitions (.md), teams.yaml, agent-chain.yaml
prompts/               /td-explain, /td-profile, /td-migrate slash commands
skills/                Teradata SQL idioms, performance tuning, BTEQ/TPT
profiles/              dev / prod tool-exposure profiles for the MCP server
policies/               approval thresholds, PII column list, (extend as needed)
docs/ARCHITECTURE.md   Why it's built this way
```

## Guard extensions

| Extension | What it does |
|---|---|
| `readonly-guard` | Blocks any non-SELECT statement unless `PI_TD_PROFILE` allows writes |
| `queryband-tagger` | Stamps every statement with a `QUERY_BAND` for audit/cost attribution |
| `explain-cost-gate` | Runs `EXPLAIN` on heavy statements, warns on product joins / no-confidence stats / high row estimates |
| `ddl-approval-gate` | Saves a plan artifact and requires interactive approval before any write applies |
| `schema-diff-guard` | Warns when a table's live schema drifted since the agent last inspected it |
| `pii-guard` | Blocks queries touching classified columns outside an approved profile |

## Agent workflows

```
/td-migrate <describe the change>
```

runs the `etl-change` chain: **planner** (read-only plan) → **etl-builder**
(implements, hits the guards) → **dba-reviewer** (performance/safety review).

Switch to the full team with `/agents-team` → `de-team` for freeform
multi-agent work, or use `/chain` → `migration-verify` to apply-then-profile
a change end to end.

## Status

This is a scaffold, not a published/tested Pi package — verify extension
call signatures (`tool_call` mutation semantics, exact MCP tool names from
your installed `teradata-mcp-server` version) against
`docs/extensions.md` in your Pi install before relying on it for real writes.
Start everything against `profiles/dev.profiles.yml` on a sandbox system.

## License

MIT
