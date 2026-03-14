# Start the Playwright MCP server with HTTP transport for brmonk Docker to connect.
# Run this on your HOST machine (Windows) before starting brmonk in Docker (MCP mode).
#
# Usage:
#   .\scripts\start-mcp-server.ps1              # uses default port 3100
#   .\scripts\start-mcp-server.ps1 -Port 3200   # uses custom port
#
# brmonk in Docker connects to http://host.docker.internal:<port>/mcp

param(
    [int]$Port = 3100
)

Write-Host "Starting Playwright MCP server on port $Port..." -ForegroundColor Cyan
Write-Host "brmonk in Docker will connect via http://host.docker.internal:${Port}/mcp" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

npx -y @playwright/mcp@latest --port $Port
