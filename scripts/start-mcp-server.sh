#!/usr/bin/env bash
# Start the Playwright MCP server with HTTP transport for brmonk Docker to connect.
# Run this on your HOST machine before starting brmonk in Docker (MCP mode).
#
# Usage:
#   ./scripts/start-mcp-server.sh              # uses default port 3100
#   ./scripts/start-mcp-server.sh 3200         # uses custom port
#
# brmonk in Docker connects to http://host.docker.internal:<port>/mcp

set -e

PORT="${1:-3100}"

echo "Starting Playwright MCP server on port $PORT..."
echo "brmonk in Docker will connect via http://host.docker.internal:$PORT/mcp"
echo ""
echo "Press Ctrl+C to stop."
echo ""

npx -y @playwright/mcp@latest --port "$PORT" --host 0.0.0.0
