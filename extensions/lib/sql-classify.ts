/**
 * Shared, dependency-free SQL classification helpers for Teradata guard extensions.
 *
 * These are intentionally conservative (regex/keyword based, not a full parser).
 * Goal: cheap, fast, false-positive-tolerant classification good enough to gate
 * tool calls. For anything security-critical, pair this with a real SQL parser
 * (e.g. node-sql-parser with a Teradata-ish dialect) before relying on it in
 * a prod profile.
 */

export type StatementKind =
  | "SELECT"
  | "WITH"
  | "EXPLAIN"
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "MERGE"
  | "CALL"
  | "DDL" // CREATE / ALTER / DROP / RENAME
  | "TRUNCATE"
  | "GRANT_REVOKE"
  | "SET_SESSION"
  | "UNKNOWN";

const READ_ONLY_KINDS: StatementKind[] = ["SELECT", "WITH", "EXPLAIN", "SET_SESSION"];

const DDL_KEYWORDS = /^\s*(CREATE|ALTER|DROP|RENAME)\b/i;
const FIRST_KEYWORD = /^\s*([A-Za-z]+)/;

/** Strip leading line/block comments so keyword sniffing isn't fooled by `-- SELECT ...\nDROP TABLE`. */
function stripLeadingComments(sql: string): string {
  let s = sql.trimStart();
  let changed = true;
  while (changed) {
    changed = false;
    if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      s = nl === -1 ? "" : s.slice(nl + 1).trimStart();
      changed = true;
    } else if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end === -1 ? "" : s.slice(end + 2).trimStart();
      changed = true;
    }
  }
  return s;
}

export function classify(sqlRaw: string): StatementKind {
  const sql = stripLeadingComments(sqlRaw);
  if (DDL_KEYWORDS.test(sql)) return "DDL";
  if (/^\s*TRUNCATE\b/i.test(sql)) return "TRUNCATE";
  if (/^\s*(GRANT|REVOKE)\b/i.test(sql)) return "GRANT_REVOKE";
  if (/^\s*MERGE\b/i.test(sql)) return "MERGE";
  if (/^\s*CALL\b/i.test(sql)) return "CALL";
  if (/^\s*EXPLAIN\b/i.test(sql)) return "EXPLAIN";
  if (/^\s*WITH\b/i.test(sql)) return "WITH";
  if (/^\s*SELECT\b/i.test(sql)) return "SELECT";
  if (/^\s*INSERT\b/i.test(sql)) return "INSERT";
  if (/^\s*UPDATE\b/i.test(sql)) return "UPDATE";
  if (/^\s*DELETE\b/i.test(sql)) return "DELETE";
  if (/^\s*SET\s+(SESSION|QUERY_BAND)\b/i.test(sql)) return "SET_SESSION";
  const m = sql.match(FIRST_KEYWORD);
  return m ? "UNKNOWN" : "UNKNOWN";
}

export function isReadOnly(kind: StatementKind): boolean {
  return READ_ONLY_KINDS.includes(kind);
}

/** Splits a `;`-separated script into individual statements, respecting quotes at a basic level. */
export function splitStatements(sql: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (const ch of sql) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === ";" && !inSingle && !inDouble) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Very rough table-name extractor for FROM/JOIN/INTO/UPDATE/TABLE clauses — good enough for logging/diffing, not for security decisions. */
export function extractTables(sql: string): string[] {
  const re = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([A-Za-z0-9_."]+)/gi;
  const tables = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    tables.add(m[1].replace(/"/g, ""));
  }
  return [...tables];
}

/**
 * Locates the SQL text inside a Teradata MCP tool call's input object.
 * Different Teradata MCP servers name the arg differently (`sql`, `query`,
 * `statement`) — check all of them.
 */
export function extractSqlFromInput(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  for (const key of ["sql", "query", "statement", "cypher"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

/** Is this tool call plausibly a Teradata MCP SQL-executing tool? Adjust the pattern to your server's actual registered tool names. */
export function isTeradataSqlTool(toolName: string): boolean {
  return /teradata|td_|base_query|base_readQuery|dba_|qlty_|sec_/i.test(toolName);
}
