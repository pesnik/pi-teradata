# Architecture

```
┌─────────────────────────────────────────────┐
│  Pi coding agent (TUI/orchestration)         │
│  agents/*.md, agents/teams.yaml,             │
│  agents/agent-chain.yaml                     │
├─────────────────────────────────────────────┤
│  Guard extensions (deterministic, no LLM)    │
│   readonly-guard      → blocks non-SELECT    │
│   queryband-tagger    → stamps QUERY_BAND    │
│   explain-cost-gate   → EXPLAIN-based warn   │
│   ddl-approval-gate   → propose/approve/apply│
│   schema-diff-guard   → metadata drift warn  │
│   pii-guard           → classified-column gate│
├─────────────────────────────────────────────┤
│  Teradata MCP server (tool modules)          │
│   base / qlty / dba / sec / rag / feature    │
├─────────────────────────────────────────────┤
│  Teradata Vantage — dev / qa / prod profiles │
└─────────────────────────────────────────────┘
```

## Why extensions, not prompting

Every guard here is implemented as a `tool_call` hook, not as an instruction
in an agent's system prompt. The LLM can be told "never write to prod" and
still do it under the right adversarial framing, a long context, or a
misunderstanding. A hook that inspects the actual SQL string before it
reaches the MCP server can't be talked out of its job. Treat prompts (in
`agents/*.md`) as guidance for good behavior, and extensions as the actual
safety boundary.

## Environments are capability, not intent

`PI_TD_PROFILE` (read by the guard extensions) and the Teradata MCP server's
own `--profile` flag should always agree, and both should default to the
most restrictive setting (`prod` / read-only) if unset. Never rely on the
agent "choosing" to be careful in prod — point it at a server that literally
doesn't expose write tools there.

## Extension execution order

Pi extensions are all discovered and typically run in registration/alpha
order within a directory. If you need a strict order (e.g. queryband-tagger
must run before explain-cost-gate reads the SQL, so the EXPLAIN also carries
the band), prefix directory names to control discovery order, or combine
tightly-coupled guards into a single extension file rather than relying on
implicit ordering.

## Extending this package

- New guard: copy `extensions/readonly-guard` as a template — the
  `sql-classify.ts` helper in `extensions/lib` covers most of what a new
  guard needs (statement classification, table extraction, tool-name
  matching).
- New agent role: add `agents/<name>.md` with frontmatter (`name`,
  `description`, `tools`), then reference it in `agents/teams.yaml` and/or
  `agents/agent-chain.yaml`.
- New workflow: add a chain to `agents/agent-chain.yaml`, or a prompt
  template to `prompts/` for a single-shot version of it.
