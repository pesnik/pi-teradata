/**
 * Teradata PII Guard
 *
 * Cross-references columns referenced in a SELECT/EXPLAIN against a
 * hand-maintained classification list (policies/pii-columns.yml) and either
 * blocks or requires confirmation when unmasked PII columns are selected
 * outside of an approved profile — independent of what the agent "believes"
 * about the sensitivity of the data.
 *
 * This is deliberately a denylist over a fixed, curated column list rather
 * than an LLM judgment call — classification should live in your data
 * governance/glossary layer (e.g. the MCP server's semantic-layer/glossary
 * resource), not be re-derived by the agent per query.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { classify, extractSqlFromInput, isTeradataSqlTool } from "../lib/sql-classify";

interface PiiPolicy {
  columns: string[]; // e.g. "sales.customer.ssn", or bare "ssn" to match any table
}

function loadPolicy(): PiiPolicy {
  const file = path.join(process.cwd(), "policies", "pii-columns.yml");
  if (!fs.existsSync(file)) return { columns: [] };
  return (parseYaml(fs.readFileSync(file, "utf8")) as PiiPolicy) ?? { columns: [] };
}

function referencesPii(sql: string, policy: PiiPolicy): string[] {
  const lower = sql.toLowerCase();
  return policy.columns.filter((c) => lower.includes(c.split(".").pop()!.toLowerCase()));
}

export default function (pi: ExtensionAPI) {
  const policy = loadPolicy();
  const allowUnmasked = process.env.PI_TD_PII_ALLOWED === "true";

  pi.on("tool_call", async (event, ctx) => {
    if (!isTeradataSqlTool(event.toolName) || policy.columns.length === 0) return;

    const input = event.input as Record<string, unknown>;
    const sql = extractSqlFromInput(input);
    if (!sql) return;
    if (classify(sql) !== "SELECT" && classify(sql) !== "WITH") return;

    const hits = referencesPii(sql, policy);
    if (hits.length === 0) return;

    if (allowUnmasked) {
      ctx.ui.notify(`[pii-guard] Query touches classified columns: ${hits.join(", ")} (allowed by profile)`, "warning");
      return;
    }

    return {
      block: true,
      reason:
        `[pii-guard] Query references classified column(s): ${hits.join(", ")}.\n` +
        `Set PI_TD_PII_ALLOWED=true only in an approved, audited environment, ` +
        `or rewrite the query against a masked/tokenized view instead.`,
    };
  });
}
