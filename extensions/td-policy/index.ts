/**
 * /td-policy — View and manage the PII classification list
 *
 * Shows the current policies/pii-columns.yml contents and allows
 * adding/removing entries interactively.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const POLICY_FILE = path.join(process.cwd(), "policies", "pii-columns.yml");

interface PiiPolicy {
  columns: string[];
}

function loadPolicy(): PiiPolicy {
  if (!fs.existsSync(POLICY_FILE)) return { columns: [] };
  return (parseYaml(fs.readFileSync(POLICY_FILE, "utf8")) as PiiPolicy) ?? { columns: [] };
}

function savePolicy(policy: PiiPolicy): void {
  fs.mkdirSync(path.dirname(POLICY_FILE), { recursive: true });
  fs.writeFileSync(POLICY_FILE, stringifyYaml(policy, { lineWidth: 0 }));
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("td-policy", {
    description: "View or modify PII column classification list",
    getArgumentCompletions: (prefix) => {
      const items = ["list", "add <column>", "remove <column>"];
      return items
        .filter((i) => i.startsWith(prefix))
        .map((i) => ({ value: i, label: i }));
    },
    handler: async (args, ctx) => {
      const policy = loadPolicy();
      const subcommand = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "list";

      if (subcommand === "list" || !subcommand) {
        if (policy.columns.length === 0) {
          ctx.ui.notify("[td-policy] No PII columns classified yet.", "warning");
          return;
        }
        const lines = [
          `[td-policy] PII columns (${policy.columns.length}):`,
          ...policy.columns.map((c) => `  - ${c}`),
          ``,
          `File: ${POLICY_FILE}`,
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (subcommand === "add") {
        const column = args.trim().split(/\s+/)[1];
        if (!column) {
          ctx.ui.notify("[td-policy] Usage: /td-policy add <column_name>", "warning");
          return;
        }
        if (policy.columns.includes(column)) {
          ctx.ui.notify(`[td-policy] "${column}" is already classified.`, "warning");
          return;
        }
        policy.columns.push(column);
        policy.columns.sort();
        savePolicy(policy);
        ctx.ui.notify(`[td-policy] Added "${column}" — ${policy.columns.length} columns now classified.`, "info");
        return;
      }

      if (subcommand === "remove") {
        const column = args.trim().split(/\s+/)[1];
        if (!column) {
          ctx.ui.notify("[td-policy] Usage: /td-policy remove <column_name>", "warning");
          return;
        }
        const idx = policy.columns.indexOf(column);
        if (idx === -1) {
          ctx.ui.notify(`[td-policy] "${column}" not found in classification list.`, "warning");
          return;
        }
        policy.columns.splice(idx, 1);
        savePolicy(policy);
        ctx.ui.notify(`[td-policy] Removed "${column}" — ${policy.columns.length} columns now classified.`, "info");
        return;
      }

      ctx.ui.notify(`[td-policy] Unknown subcommand "${subcommand}". Use: list, add <col>, remove <col>`, "warning");
    },
  });
}
