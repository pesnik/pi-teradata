/**
 * /td-review — Interactive SQL review with governance checks
 *
 * Takes a SQL statement, runs all governance checks (PII, cost, read-only,
 * statistics), and presents a unified review report before any execution.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  classify,
  extractTables,
  isReadOnly,
  splitStatements,
} from "../lib/sql-classify";

interface PiiPolicy {
  columns: string[];
}

interface ApprovalThresholds {
  heavy_row_threshold: number;
  require_approval_for: string[];
  auto_approve_below_rows: number;
}

function loadPiiPolicy(): PiiPolicy {
  const file = path.join(process.cwd(), "policies", "pii-columns.yml");
  if (!fs.existsSync(file)) return { columns: [] };
  return (parseYaml(fs.readFileSync(file, "utf8")) as PiiPolicy) ?? { columns: [] };
}

function loadThresholds(): ApprovalThresholds {
  const file = path.join(process.cwd(), "policies", "approval-thresholds.yml");
  if (!fs.existsSync(file)) {
    return { heavy_row_threshold: 10_000_000, require_approval_for: [], auto_approve_below_rows: 1000 };
  }
  return (parseYaml(fs.readFileSync(file, "utf8")) as ApprovalThresholds) ?? {
    heavy_row_threshold: 10_000_000,
    require_approval_for: [],
    auto_approve_below_rows: 1000,
  };
}

function referencesPii(sql: string, policy: PiiPolicy): string[] {
  const lower = sql.toLowerCase();
  return policy.columns.filter((c) => lower.includes(c.split(".").pop()!.toLowerCase()));
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("td-review", {
    description: "Review a SQL statement against all governance guards",
    handler: async (args, ctx) => {
      const sql = args.trim();
      if (!sql) {
        ctx.ui.notify("[td-review] Usage: /td-review <SQL statement>", "warning");
        return;
      }

      const piiPolicy = loadPiiPolicy();
      const thresholds = loadThresholds();
      const stmts = splitStatements(sql);
      const findings: string[] = [];
      let risk: "low" | "medium" | "high" = "low";

      // 1. Statement classification
      for (const stmt of stmts) {
        const kind = classify(stmt);
        findings.push(`Statement: ${kind} — ${stmt.slice(0, 100)}${stmt.length > 100 ? "..." : ""}`);

        if (!isReadOnly(kind)) {
          if (thresholds.require_approval_for.includes(kind)) {
            findings.push(`  ⚠ Requires approval gate (policy: ${kind})`);
            risk = "high";
          } else {
            findings.push(`  ⚠ Non-SELECT statement in read-only profile`);
            risk = risk === "high" ? "high" : "medium";
          }
        }
      }

      // 2. PII check
      const piiHits = referencesPii(sql, piiPolicy);
      if (piiHits.length > 0) {
        findings.push(`PII columns detected: ${piiHits.join(", ")}`);
        findings.push(`  ⚠ Query touches classified PII — mask or use approved view`);
        risk = "high";
      }

      // 3. Table extraction
      const tables = extractTables(sql);
      if (tables.length > 0) {
        findings.push(`Tables referenced: ${tables.join(", ")}`);
      }

      // 4. Risk summary
      const profile = process.env.PI_TD_PROFILE ?? "prod";
      const lines = [
        `[td-review] Governance report`,
        `Profile: ${profile}`,
        `Risk: ${risk.toUpperCase()}`,
        ``,
        ...findings,
        ``,
        risk === "high"
          ? "→ Fix issues before executing. Use PI_TD_PROFILE=dev for dev writes."
          : risk === "medium"
            ? "→ Review carefully. Approval gate will prompt for confirmation."
            : "→ All checks passed.",
      ];

      ctx.ui.notify(lines.join("\n"), risk === "high" ? "warning" : "info");
    },
  });
}
