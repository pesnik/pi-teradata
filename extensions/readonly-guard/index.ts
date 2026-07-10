/**
 * Teradata Read-Only Guard Extension
 *
 * Intercepts Teradata MCP tool calls and blocks any non-SELECT statement
 * (INSERT, DELETE, UPDATE, CALL, DROP, CREATE, ALTER, TRUNCATE, MERGE, GRANT/REVOKE, ...)
 * unless PI_TD_PROFILE is explicitly set to an environment that allows writes.
 *
 * This is the deterministic backstop for the agent — it does not rely on the
 * LLM to "decide" not to write to prod. It runs regardless of what the model
 * was told in its system prompt.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  classify,
  extractSqlFromInput,
  isReadOnly,
  isTeradataSqlTool,
  splitStatements,
} from "../lib/sql-classify";

const WRITE_ALLOWED_PROFILES = new Set(["dev", "sandbox"]);

function currentProfile(): string {
  return process.env.PI_TD_PROFILE ?? "prod"; // fail closed: default to the strictest profile
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isTeradataSqlTool(event.toolName)) return;

    const sql = extractSqlFromInput(event.input as Record<string, unknown>);
    if (!sql) return; // not a SQL-bearing call (e.g. list_tables) — nothing to guard

    const profile = currentProfile();
    const writesAllowed = WRITE_ALLOWED_PROFILES.has(profile);

    for (const stmt of splitStatements(sql)) {
      const kind = classify(stmt);
      if (isReadOnly(kind)) continue;

      if (writesAllowed) {
        ctx.ui.notify(
          `[td-guard] Allowing ${kind} in profile "${profile}": ${stmt.slice(0, 80)}...`,
          "info",
        );
        continue;
      }

      return {
        block: true,
        reason:
          `[td-guard] Blocked ${kind} statement — active profile "${profile}" is read-only.\n` +
          `Statement: ${stmt.slice(0, 200)}\n` +
          `To allow writes, run Pi with PI_TD_PROFILE=dev (or sandbox) against a non-prod system, ` +
          `or route this through the ddl-approval-gate extension for a reviewed apply.`,
      };
    }
  });
}
