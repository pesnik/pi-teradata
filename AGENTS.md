# teradata-de-agent — project instructions

This project is a Pi package that governs agentic Teradata data engineering.
When working in this repo (developing the package itself), or when this
package is active in another project (governing an actual Teradata
workflow), the following apply:

- Treat `extensions/` as security-critical code: changes there should be
  conservative, well-commented, and fail closed (default to blocking/
  read-only on any ambiguity or error), never fail open.
- `PI_TD_PROFILE` defaults to `prod` (read-only) when unset. Never change
  that default as a "convenience" fix.
- Do not weaken `extensions/readonly-guard` or `extensions/pii-guard` to
  make a task easier — if a legitimate task needs a write, the answer is
  running with `PI_TD_PROFILE=dev` against a non-prod system, or going
  through `ddl-approval-gate`, not loosening the guard.
- SQL-related work should consult the `teradata-sql-idioms` and
  `teradata-performance-tuning` skills before writing or reviewing SQL.
