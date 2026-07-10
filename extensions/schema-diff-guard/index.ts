/**
 * Teradata Schema-Diff Guard
 *
 * Before a CREATE/ALTER touching a table the agent has referenced earlier in
 * the session, re-fetch that table's live column metadata (via the MCP
 * server's base schema tool) and diff it against what the agent's proposed
 * DDL assumes. Surfaces drift instead of trusting the agent's stale mental
 * model of the schema — the #1 cause of migrations breaking silently.
 *
 * This is intentionally light: it warns rather than blocks, since "the agent
 * is proposing a schema change" is often correct even when metadata drifted.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classify, extractSqlFromInput, extractTables, isTeradataSqlTool } from "../lib/sql-classify";

// Cache of "last known columns" per table, populated by watching base_query /
// base_getColumns style results elsewhere in the session (left as a hook
// point — wire to your MCP server's actual metadata tool name).
const lastKnownColumns = new Map<string, Set<string>>();

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isTeradataSqlTool(event.toolName)) return;
    const input = event.input as Record<string, unknown>;
    const sql = extractSqlFromInput(input);
    if (!sql || classify(sql) !== "DDL") return;

    const tables = extractTables(sql);
    for (const table of tables) {
      if (!lastKnownColumns.has(table)) continue; // never inspected this session; nothing to diff against

      try {
        const liveSchema = await ctx.callTool(event.toolName, {
          sql: `SELECT ColumnName FROM dbc.ColumnsV WHERE UPPER(TableName) = UPPER('${table.split(".").pop()}')`,
        });
        const liveCols = new Set<string>(
          JSON.stringify(liveSchema)
            .match(/"ColumnName"\s*:\s*"([^"]+)"/gi)
            ?.map((m) => m.split(":")[1].replace(/["\s]/g, "")) ?? [],
        );
        const known = lastKnownColumns.get(table)!;
        const added = [...liveCols].filter((c) => !known.has(c));
        const removed = [...known].filter((c) => !liveCols.has(c));

        if (added.length || removed.length) {
          ctx.ui.notify(
            `[schema-diff-guard] ${table} drifted since last inspected in this session: ` +
              `+${added.join(",") || "none"} -${removed.join(",") || "none"}`,
            "warning",
          );
        }
      } catch {
        // best-effort; don't block on metadata-check failures
      }
    }
  });

  // Populate the cache whenever the agent inspects a table's columns.
  // Adjust the tool-name match to your server's actual metadata tool.
  pi.on("tool_result", async (event) => {
    if (!/getColumns|describe|columns/i.test(event.toolName ?? "")) return;
    const table = (event as any)?.input?.table as string | undefined;
    if (!table) return;
    const text = JSON.stringify(event);
    const cols = text.match(/"ColumnName"\s*:\s*"([^"]+)"/gi)?.map((m) => m.split(":")[1].replace(/["\s]/g, "")) ?? [];
    if (cols.length) lastKnownColumns.set(table, new Set(cols));
  });
}
