#!/usr/bin/env bash
# pi-teradata installer
# Installs Pi if missing, registers this package, and wires up Teradata MCP config.
set -euo pipefail

echo "==> pi-teradata installer"

if ! command -v pi >/dev/null 2>&1; then
  echo "-> Pi not found, installing @earendil-works/pi-coding-agent ..."
  npm install -g @earendil-works/pi-coding-agent
fi

echo "-> Registering package with Pi"
pi install "$(pwd)"

CONFIG_DIR="${HOME}/.pi/agent"
mkdir -p "${CONFIG_DIR}"

if [ ! -f "${CONFIG_DIR}/settings.json" ]; then
  cat > "${CONFIG_DIR}/settings.json" <<'EOF'
{
  "extensions": ["pi-teradata"]
}
EOF
  echo "-> Wrote default ${CONFIG_DIR}/settings.json"
else
  echo "-> settings.json already exists — add \"pi-teradata\" to \"extensions\" manually if needed"
fi

cat <<'EOF'

==> Next steps

1. Point Pi at a Teradata MCP server (dev sandbox recommended first):
   Add to ~/.pi/agent/mcp.json (or your MCP config location):
     {
       "mcpServers": {
         "teradata": {
           "command": "uvx",
           "args": ["teradata-mcp-server", "--profile", "dev"],
           "env": { "DATABASE_URI": "teradata://<user>:<pass>@<host>:1025/<db>" }
         }
       }
     }

2. Copy profiles/dev.profiles.yml or profiles/prod.profiles.yml into your
   teradata-mcp-server config directory to control which MCP tools are exposed.

3. Run `pi` and try:
     /td-explain SELECT * FROM sales.orders
     /td-profile sales.orders
     /agents-team   (switch to the "de-team" agent team)

EOF