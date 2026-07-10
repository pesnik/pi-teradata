/**
 * Teradata DDL/DML Approval Gate
 *
 * Turns the readonly-guard's binary block/allow into a
 * propose -> explain -> approve -> apply workflow for any non-SELECT
 * statement, even in profiles where writes are technically permitted.
 *
 * On intercept, it:
 *   1. Classifies the statement (skips if read-only).
 *   2. Writes a plan artifact to .pi/td-plans/<timestamp>.json containing the
 *      SQL, the calling tool, and (best-effort) an EXPLAIN of it.
 *   3. Prompts the human via ctx.ui.confirm with the SQL shown in full.
 *   4. Only lets the call through if approved; otherwise blocks with a
 *      pointer to the saved plan for offline review.
 *
 * Pairs naturally with agent-pi's plan-viewer pattern — instead of a plain
 * confirm() dialog, wire this up to write into `reports/` and open the
 * browser-based plan viewer if you have that extension installed.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { classify, extractSqlFromInput, isReadOnly, isTeradataSqlTool } from "../lib/sql-classify";

const PLAN_DIR = path.join(process.cwd(), ".pi", "td-plans");

function savePlan(record: Record<string, unknown>): string {
  fs.mkdirSync(PLAN_DIR, { recursive: true });
  const file = path.join(PLAN_DIR, `${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return file;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isTeradataSqlTool(event.toolName)) return;

    const input = event.input as Record<string, unknown>;
    const sql = extractSqlFromInput(input);
    if (!sql) return;

    const kind = classify(sql);
    if (isReadOnly(kind)) return;

    const planFile = savePlan({
      tool: event.toolName,
      kind,
      sql,
      requestedAt: new Date().toISOString(),
    });

    const approved = await ctx.ui.confirm(
      `Approve ${kind} statement?`,
      `${sql}\n\nPlan saved to ${planFile}\n\nApply this to Teradata now?`,
    );

    if (!approved) {
      return {
        block: true,
        reason: `[ddl-approval-gate] ${kind} statement rejected by reviewer. Plan retained at ${planFile}.`,
      };
    }

    fs.appendFileSync(
      planFile.replace(/\.json$/, ".decision.json"),
      JSON.stringify({ decision: "approved", decidedAt: new Date().toISOString() }, null, 2),
    );
  });
}
