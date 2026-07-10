/**
 * Teradata QueryBand Tagger Extension
 *
 * Stamps every outgoing SQL statement with a QUERY_BAND identifying the Pi
 * session, task, and actor, so every statement the agent issues is
 * attributable in DBQL / workload management views (dbc.QryLogV, etc.)
 * without the agent having to think about it.
 *
 * NOTE: whether `tool_call` handlers can rewrite `event.input` in place
 * depends on your installed Pi version's extension semantics — verify
 * against docs/extensions.md. If in-place mutation of `event.input` is not
 * honored, fall back to wrapping this logic inside the MCP server itself
 * (a thin proxy tool) rather than in the client-side extension.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { extractSqlFromInput, isTeradataSqlTool } from "../lib/sql-classify";

function buildQueryBand(ctx: { sessionId?: string }, toolName: string): string {
  const runId = ctx.sessionId ?? "unknown-session";
  const task = process.env.PI_CURRENT_TASK ?? "adhoc";
  return (
    `SET QUERY_BAND = ` +
    `'Agent=pi;AgentRun=${runId};Task=${task};Tool=${toolName};' ` +
    `FOR SESSION;\n`
  );
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isTeradataSqlTool(event.toolName)) return;

    const input = event.input as Record<string, unknown>;
    const sql = extractSqlFromInput(input);
    if (!sql) return;
    if (sql.trimStart().toUpperCase().startsWith("SET QUERY_BAND")) return; // already tagged

    const band = buildQueryBand({ sessionId: (ctx as any).sessionId }, event.toolName);

    for (const key of ["sql", "query", "statement"]) {
      if (typeof input[key] === "string") {
        input[key] = band + (input[key] as string);
        break;
      }
    }
    // No block/modify return needed if mutation-in-place is honored by your
    // Pi version; otherwise return { input } here if that's the supported
    // contract for your installed version.
  });
}
