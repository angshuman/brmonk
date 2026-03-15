# brmonk - One-command launcher (Docker mode) for Windows
#
# What this does:
#   1. Builds the Docker image if needed
#   2. Starts Chrome with remote debugging in background
#   3. Starts brmonk in Docker (CDP mode)
#   4. Opens the web UI in your browser
#
# Usage:
#   .\brmonk.ps1                       # default: CDP mode
#   .\brmonk.ps1 -Port 8080           # custom web UI port
#   .\brmonk.ps1 -CdpPort 9333       # custom Chrome debug port
#   .\brmonk.ps1 -Rebuild             # force Docker image rebuild
#   .\brmonk.ps1 -Mcp                 # use MCP mode instead of CDP
#   .\brmonk.ps1 -Stop                # stop everything

param(
    [int]$Port = 3333,
    [int]$CdpPort = 9222,
    [int]$McpPort = 3100,
    [switch]$Rebuild,
    [switch]$Mcp,
    [switch]$Stop,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Help) {
    Write-Host "Usage: .\brmonk.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Port <port>      Web UI port (default: 3333)"
    Write-Host "  -CdpPort <port>   Chrome debug port (default: 9222)"
    Write-Host "  -McpPort <port>   Playwright MCP port (default: 3100)"
    Write-Host "  -Rebuild          Force Docker image rebuild"
    Write-Host "  -Mcp              Use MCP mode instead of CDP"
    Write-Host "  -Stop             Stop all brmonk services"
    Write-Host "  -Help             Show this help"
    exit 0
}

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "             b r m o n k                  " -ForegroundColor Cyan
Write-Host "     AI Browser Automation Agent          " -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# --- Stop mode ---
if ($Stop) {
    Write-Host "Stopping brmonk services..." -ForegroundColor Yellow
    Push-Location $ScriptDir
    docker compose --profile cdp --profile mcp down 2>$null
    Pop-Location
    # Kill browser process
    $pidFile = Join-Path $env:TEMP "brmonk-browser.pid"
    if (Test-Path $pidFile) {
        $pid = Get-Content $pidFile
        try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {}
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Done." -ForegroundColor Green
    exit 0
}

# --- Check prerequisites ---
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Docker is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Install Docker Desktop: https://docs.docker.com/desktop/install/windows-install/"
    exit 1
}

$dockerCheck = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Docker daemon is not running. Start Docker Desktop first." -ForegroundColor Red
    exit 1
}

# --- Check for .env ---
Push-Location $ScriptDir
if (-not (Test-Path ".env")) {
    Write-Host "Warning: No .env file found." -ForegroundColor Yellow
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "Created .env from .env.example. Please edit it and add at least one API key:" -ForegroundColor Yellow
    } else {
        $envContent = @(
            "# brmonk - Add at least one API key",
            "# ANTHROPIC_API_KEY=sk-ant-...",
            "# OPENAI_API_KEY=sk-...",
            "# XAI_API_KEY=xai-..."
        ) -join "`n"
        $envContent | Out-File -FilePath ".env" -Encoding utf8
        Write-Host "Created .env - please add at least one API key and re-run." -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Write-Host "  ANTHROPIC_API_KEY=sk-ant-..."
    Write-Host "  OPENAI_API_KEY=sk-..."
    Write-Host "  XAI_API_KEY=xai-..."
    Write-Host ""
    Read-Host "Press Enter after editing .env (or Ctrl+C to cancel)"
}

# --- Build Docker image ---
$imageExists = docker images -q brmonk 2>$null
if (-not $imageExists -or $Rebuild) {
    Write-Host "Building brmonk Docker image..." -ForegroundColor Cyan
    Write-Host "(This includes: npm run build, npm run build:web, docker build)"
    Write-Host ""
    npm run build
    npm run build:web
    docker build -t brmonk .
    Write-Host ""
    Write-Host "Docker image built successfully." -ForegroundColor Green
} else {
    Write-Host "Docker image found. Use -Rebuild to force a fresh build." -ForegroundColor Gray
}
Write-Host ""

# --- Start browser ---
$Mode = if ($Mcp) { "mcp" } else { "cdp" }

if ($Mode -eq "cdp") {
    Write-Host "Starting browser with CDP on port $CdpPort..." -ForegroundColor Cyan
    $browserProc = Start-Process powershell -ArgumentList "-NoProfile", "-File", "$ScriptDir\scripts\start-browser.ps1", "-Port", $CdpPort -PassThru -WindowStyle Normal
    $browserProc.Id | Out-File (Join-Path $env:TEMP "brmonk-browser.pid") -Force
    Start-Sleep -Seconds 3
} else {
    Write-Host "Starting Playwright MCP server on port $McpPort..." -ForegroundColor Cyan
    $browserProc = Start-Process powershell -ArgumentList "-NoProfile", "-File", "$ScriptDir\scripts\start-mcp-server.ps1", "-Port", $McpPort -PassThru -WindowStyle Normal
    $browserProc.Id | Out-File (Join-Path $env:TEMP "brmonk-browser.pid") -Force
    Start-Sleep -Seconds 3
}
Write-Host ""

# --- Start Docker container ---
Write-Host "Starting brmonk container (web UI on port $Port)..." -ForegroundColor Cyan
Write-Host ""

if ($Mode -eq "cdp") {
    docker compose --profile cdp up -d
} else {
    docker compose --profile mcp up -d
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  brmonk is running!" -ForegroundColor Green
Write-Host ""
Write-Host "  Web UI:   http://localhost:$Port" -ForegroundColor White
Write-Host "  Mode:     $Mode" -ForegroundColor White
if ($Mode -eq "cdp") {
    Write-Host "  Browser:  CDP on port $CdpPort" -ForegroundColor White
} else {
    Write-Host "  MCP:      port $McpPort" -ForegroundColor White
}
Write-Host ""
Write-Host "  Stop:     .\brmonk.ps1 -Stop" -ForegroundColor Gray
Write-Host "  Logs:     docker compose logs -f" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Open web UI
Start-Process "http://localhost:$Port"

# Follow logs
Pop-Location
docker compose logs -f
