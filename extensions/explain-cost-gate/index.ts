/**
 * Teradata EXPLAIN Cost/Skew Gate
 *
 * Before letting a heavy statement (non-trivial SELECT, or any write) run
 * against the real MCP tool, this extension asks the agent's own Teradata
 * MCP connection to EXPLAIN it, parses the plan text for classic Teradata
 * footguns, and either warns, requires confirmation, or blocks — configurable
 * via policies/approval-thresholds.yml.
 *
 * Red flags this looks for in the EXPLAIN text:
 *  - "with no residual conditions" on an all-AMPs step (full table scan)
 *  - "Product Join" (cartesian / missing join condition)
 *  - "confidence" absent or "no confidence" (stale/missing statistics)
 *  - estimated row counts above threshold
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classify, extractSqlFromInput, isReadOnly, isTeradataSqlTool } from "../lib/sql-classify";

const RED_FLAG_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /with no residual conditions/i, message: "Full-table scan (no residual conditions)" },
  { pattern: /product join/i, message: "Product join detected — likely missing/incorrect join condition" },
  { pattern: /no confidence/i, message: "Optimizer has no confidence in estimate — stats likely missing/stale" },
  { pattern: /confidence.{0,20}low/i, message: "Low-confidence estimate" },
];

const HEAVY_ROW_THRESHOLD = 10_000_000; // configurable; see policies/approval-thresholds.yml

function extractEstimatedRows(explainText: string): number | null {
  const m = explainText.match(/with\s+(?:high|low|no)?\s*confidence\s+to\s+be\s+([\d,]+)\s+rows/i);
  if (!m) return null;
  return parseInt(m[1].replace(/,/g, ""), 10);
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isTeradataSqlTool(event.toolName)) return;

    const input = event.input as Record<string, unknown>;
    const sql = extractSqlFromInput(input);
    if (!sql) return;

    const kind = classify(sql);
    // Cheap SELECTs aren't worth an extra round trip; gate the expensive cases.
    if (isReadOnly(kind) && !/join|group\s+by|order\s+by/i.test(sql)) return;

    // Ask the same MCP server to EXPLAIN the statement via its query tool.
    // Adjust `event.toolName` -> explain-capable tool name mapping to match
    // your actual teradata-mcp-server tool registry (e.g. base_query with
    // an EXPLAIN-prefixed statement).
    let explainText = "";
    try {
      const result = await ctx.callTool(event.toolName, {
        ...input,
        sql: `EXPLAIN ${sql}`,
      });
      explainText = JSON.stringify(result);
    } catch {
      // If EXPLAIN itself fails (e.g. tool doesn't support arbitrary rewrite),
      // don't block on a best-effort safety net — just skip the gate.
      return;
    }

    const flags = RED_FLAG_PATTERNS.filter((f) => f.pattern.test(explainText)).map((f) => f.message);
    const estRows = extractEstimatedRows(explainText);
    if (estRows && estRows > HEAVY_ROW_THRESHOLD) {
      flags.push(`Estimated ${estRows.toLocaleString()} rows touched (> ${HEAVY_ROW_THRESHOLD.toLocaleString()})`);
    }

    if (flags.length === 0) return;

    const proceed = await ctx.ui.confirm(
      "Teradata cost/skew warning",
      `EXPLAIN flagged this statement:\n- ${flags.join("\n- ")}\n\nProceed anyway?`,
    );
    if (!proceed) {
      return { block: true, reason: `[explain-cost-gate] Blocked by user after warnings: ${flags.join("; ")}` };
    }
  });
}
