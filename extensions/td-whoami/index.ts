/**
 * /td-whoami — Show current Teradata governance context
 *
 * Displays the active PI_TD_PROFILE, which guards are enabled,
 * and what operations are allowed/blocked in the current session.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WRITE_PROFILES = new Set(["dev", "sandbox"]);

export default function (pi: ExtensionAPI) {
  pi.registerCommand("td-whoami", {
    description: "Show current Teradata profile, guards, and permissions",
    handler: async (_args, ctx) => {
      const profile = process.env.PI_TD_PROFILE ?? "prod";
      const piiAllowed = process.env.PI_TD_PII_ALLOWED === "true";
      const writesAllowed = WRITE_PROFILES.has(profile);

      const lines = [
        `Profile:       ${profile}`,
        `Writes:        ${writesAllowed ? "ALLOWED (dev/sandbox)" : "BLOCKED (read-only)"}`,
        `PII unmasked:  ${piiAllowed ? "ALLOWED (audit override)" : "BLOCKED (guard active)"}`,
        ``,
        `Active guards:`,
        `  readonly-guard      — ${writesAllowed ? "permissive" : "enforcing (blocks writes)"}`,
        `  pii-guard           — ${piiAllowed ? "permissive (override)" : "enforcing (blocks PII selects)"}`,
        `  ddl-approval-gate   — requires human confirm for DDL/DML`,
        `  explain-cost-gate   — warns on expensive queries`,
        `  schema-diff-guard   — warns on schema drift`,
        `  queryband-tagger    — stamps QUERY_BAND on all SQL`,
      ];

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
