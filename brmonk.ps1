# brmonk - One-command launcher for Windows
#
# Starts everything you need in one shot:
#   1. Chrome with remote debugging (CDP)
#   2. Docker container (brmonk agent + web UI)
#   3. Opens the web UI in your default browser
#
# Usage:
#   .\brmonk.ps1                       # start everything (CDP mode)
#   .\brmonk.ps1 -Mcp                  # use Playwright MCP instead of CDP
#   .\brmonk.ps1 -Port 8080            # custom web UI port
#   .\brmonk.ps1 -CdpPort 9333        # custom Chrome debug port
#   .\brmonk.ps1 -Rebuild              # force Docker image rebuild
#   .\brmonk.ps1 -Stop                 # stop everything
#   .\brmonk.ps1 -Local                # run without Docker (Node.js only)

param(
    [int]$Port = 3333,
    [int]$CdpPort = 9222,
    [int]$McpPort = 3100,
    [switch]$Rebuild,
    [switch]$Mcp,
    [switch]$Stop,
    [switch]$Local,
    [switch]$Headless,
    [switch]$Console,
    [switch]$Help
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Help) {
    Write-Host "Usage: .\brmonk.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Port <port>      Web UI port (default: 3333)"
    Write-Host "  -CdpPort <port>   Chrome debug port (default: 9222)"
    Write-Host "  -McpPort <port>   Playwright MCP port (default: 3100)"
    Write-Host "  -Rebuild          Force Docker image rebuild"
    Write-Host "  -Mcp              Use Playwright MCP instead of Chrome CDP"
    Write-Host "  -Local            Run without Docker (requires Node.js 18+)"
    Write-Host "  -Headless         Run browser headless (local mode only)"
    Write-Host "  -Console          TUI console instead of web UI (local mode)"
    Write-Host "  -Stop             Stop all brmonk services"
    Write-Host "  -Help             Show this help"
    exit 0
}

# ─── Banner ─────────────────────────────────────────────────
Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "             b r m o n k                  " -ForegroundColor Cyan
Write-Host "     AI Browser Automation Agent          " -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# ─── Stop mode ──────────────────────────────────────────────
if ($Stop) {
    Write-Host "Stopping brmonk services..." -ForegroundColor Yellow
    Push-Location $ScriptDir
    docker compose --profile cdp --profile mcp down 2>$null
    Pop-Location
    # Kill browser/MCP processes
    $pidFile = Join-Path $env:TEMP "brmonk-browser.pid"
    if (Test-Path $pidFile) {
        $procId = Get-Content $pidFile
        try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
    $mcpPidFile = Join-Path $env:TEMP "brmonk-mcp.pid"
    if (Test-Path $mcpPidFile) {
        $procId = Get-Content $mcpPidFile
        try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
        Remove-Item $mcpPidFile -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Done." -ForegroundColor Green
    exit 0
}

# ─── Find Chrome/Edge/Brave ────────────────────────────────
function Find-Browser {
    $paths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

# ═══════════════════════════════════════════════════════════
#  LOCAL MODE (no Docker)
# ═══════════════════════════════════════════════════════════
if ($Local) {
    Push-Location $ScriptDir

    # Check Node.js
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "Error: Node.js is not installed." -ForegroundColor Red
        Write-Host "Install Node.js 18+: https://nodejs.org/"
        Pop-Location; exit 1
    }
    $nodeVersion = [int](node -v).Replace("v","").Split(".")[0]
    if ($nodeVersion -lt 18) {
        Write-Host "Error: Node.js 18+ required (found $(node -v))." -ForegroundColor Red
        Pop-Location; exit 1
    }

    # Dependencies
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
        Write-Host "Warning: No API keys found in .env or environment." -ForegroundColor Yellow
        Write-Host "Set at least one: ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY"
        Write-Host ""
    }

    # Build if needed
    if (-not (Test-Path "dist") -or $Rebuild) {
        Write-Host "Building backend..." -ForegroundColor Cyan
        npm run build
        Write-Host ""
    }
    if (-not (Test-Path "web/dist") -or $Rebuild) {
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

    $headlessArg = if ($Headless) { "--headless" } else { "" }

    if ($Console) {
        Write-Host "Starting brmonk TUI console..." -ForegroundColor Cyan
        Write-Host ""
        node dist/cli.js $headlessArg
    } else {
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  brmonk is running! (local mode)" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Web UI:  http://localhost:$Port" -ForegroundColor White
        Write-Host "  Mode:    local (Playwright)" -ForegroundColor White
        Write-Host "  Stop:    Ctrl+C" -ForegroundColor Gray
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Start-Process "http://localhost:$Port"
        node dist/cli.js web --port $Port $headlessArg
    }

    Pop-Location
    exit 0
}

# ═══════════════════════════════════════════════════════════
#  DOCKER MODE (default)
# ═══════════════════════════════════════════════════════════

# ─── Check Docker ───────────────────────────────────────────
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Docker is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Install Docker Desktop: https://docs.docker.com/desktop/install/windows-install/"
    exit 1
}

$null = docker info 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Docker daemon is not running. Start Docker Desktop first." -ForegroundColor Red
    exit 1
}

# ─── Check .env ─────────────────────────────────────────────
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

# ─── Build Docker image ────────────────────────────────────
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

# ─── Determine mode ────────────────────────────────────────
$Mode = if ($Mcp) { "mcp" } else { "cdp" }

# ─── Start Chrome (CDP) or Playwright MCP server ───────────
if ($Mode -eq "cdp") {
    $Chrome = Find-Browser
    if (-not $Chrome) {
        Write-Host "Error: Chrome/Edge/Brave not found. Please install a Chromium browser." -ForegroundColor Red
        Pop-Location; exit 1
    }
    Write-Host "Found browser: $Chrome" -ForegroundColor Green
    Write-Host "Starting Chrome with CDP on port $CdpPort (listening on all interfaces)..." -ForegroundColor Cyan

    # Create a temp user data dir so it doesn't conflict with your main profile
    $TempDataDir = Join-Path $env:TEMP "brmonk-chrome-$(Get-Random)"
    New-Item -ItemType Directory -Path $TempDataDir -Force | Out-Null

    $browserProc = Start-Process -FilePath $Chrome -ArgumentList @(
        "--remote-debugging-port=$CdpPort",
        "--remote-debugging-address=0.0.0.0",
        "--user-data-dir=$TempDataDir",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-sync",
        "--window-size=1280,720",
        "about:blank"
    ) -PassThru

    $browserProc.Id | Out-File (Join-Path $env:TEMP "brmonk-browser.pid") -Force
    # Store temp dir path for cleanup on stop
    $TempDataDir | Out-File (Join-Path $env:TEMP "brmonk-chrome-dir.txt") -Force
    Start-Sleep -Seconds 3
} else {
    Write-Host "Starting Playwright MCP server on port $McpPort (listening on all interfaces)..." -ForegroundColor Cyan
    $mcpProc = Start-Process powershell -ArgumentList "-NoProfile", "-Command", "npx -y @playwright/mcp@latest --port $McpPort --host 0.0.0.0" -PassThru -WindowStyle Normal
    $mcpProc.Id | Out-File (Join-Path $env:TEMP "brmonk-mcp.pid") -Force
    Start-Sleep -Seconds 3
}
Write-Host ""

# ─── Start Docker container ────────────────────────────────
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
Write-Host "  Mode:     $Mode (Docker)" -ForegroundColor White
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

# Follow logs (Ctrl+C to detach)
Pop-Location
docker compose logs -f
