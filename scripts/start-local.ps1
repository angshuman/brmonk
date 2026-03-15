# brmonk - Run natively without Docker (Windows)
#
# This script runs brmonk directly on your machine with a local browser.
# No Docker required. Good for development or simpler setups.
#
# Prerequisites:
#   - Node.js 18+
#   - npm dependencies installed (npm install)
#   - Built (npm run build && npm run build:web)
#   - At least one API key in .env or environment
#
# Usage:
#   .\scripts\start-local.ps1                    # web UI on port 3333
#   .\scripts\start-local.ps1 -Port 8080        # custom port
#   .\scripts\start-local.ps1 -Console          # TUI mode (no web UI)
#   .\scripts\start-local.ps1 -Build            # rebuild before starting
#   .\scripts\start-local.ps1 -Headless         # run browser headless

param(
    [int]$Port = 3333,
    [switch]$Console,
    [switch]$Build,
    [switch]$Headless,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

if ($Help) {
    Write-Host "Usage: .\scripts\start-local.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Port <port>   Web UI port (default: 3333)"
    Write-Host "  -Console       Launch TUI console instead of web UI"
    Write-Host "  -Build         Rebuild before starting"
    Write-Host "  -Headless      Run browser in headless mode"
    Write-Host "  -Help          Show this help"
    exit 0
}

Push-Location $ProjectDir

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "             b r m o n k                  " -ForegroundColor Cyan
Write-Host "        Local Mode (no Docker)            " -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Node.js is not installed." -ForegroundColor Red
    Write-Host "Install Node.js 18+: https://nodejs.org/"
    Pop-Location
    exit 1
}

$nodeVersion = [int](node -v).Replace("v","").Split(".")[0]
if ($nodeVersion -lt 18) {
    Write-Host "Error: Node.js 18+ required (found $(node -v))." -ForegroundColor Red
    Pop-Location
    exit 1
}

# Check dependencies
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    npm install
    Write-Host ""
}

# Load .env
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line -split "=", 2
            if ($parts.Count -eq 2) {
                [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
            }
        }
    }
}

# Check API keys
if (-not $env:ANTHROPIC_API_KEY -and -not $env:OPENAI_API_KEY -and -not $env:XAI_API_KEY) {
    Write-Host "Warning: No API keys found." -ForegroundColor Yellow
    Write-Host "Set at least one in .env or environment:"
    Write-Host "  ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY"
    Write-Host ""
}

# Build if needed
if (-not (Test-Path "dist") -or $Build) {
    Write-Host "Building backend..." -ForegroundColor Cyan
    npm run build
    Write-Host ""
}

if (-not (Test-Path "web/dist") -or $Build) {
    Write-Host "Building web UI..." -ForegroundColor Cyan
    npm run build:web
    Write-Host ""
}

# Install Playwright browsers if needed
try {
    $null = npx playwright install --dry-run chromium 2>$null
} catch {
    Write-Host "Installing Playwright Chromium..." -ForegroundColor Cyan
    npx playwright install chromium
    Write-Host ""
}

# Headless flag
$headlessArg = if ($Headless) { "--headless" } else { "" }

# Launch
if ($Console) {
    Write-Host "Starting brmonk TUI console..." -ForegroundColor Cyan
    Write-Host ""
    node dist/cli.js $headlessArg
} else {
    Write-Host "Starting brmonk web UI on port $Port..." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Web UI:  http://localhost:$Port" -ForegroundColor White
    Write-Host "  Mode:    local (Playwright)" -ForegroundColor White
    Write-Host "  Stop:    Ctrl+C" -ForegroundColor Gray
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""

    # Open browser
    Start-Process "http://localhost:$Port"

    node dist/cli.js web --port $Port $headlessArg
}

Pop-Location
