# Start Chrome with remote debugging enabled for brmonk Docker to connect via CDP.
# Run this on your HOST machine (Windows) before starting brmonk in Docker.
#
# Usage:
#   .\scripts\start-browser.ps1              # uses default port 9222
#   .\scripts\start-browser.ps1 -Port 9333   # uses custom port
#
# The browser will open with remote debugging on the specified port.
# brmonk in Docker connects to http://host.docker.internal:<port>

param(
    [int]$Port = 9222
)

Write-Host "Starting Chrome with remote debugging on port $Port..." -ForegroundColor Cyan
Write-Host "brmonk in Docker will connect to this browser." -ForegroundColor Cyan
Write-Host ""

# Find Chrome installation
$ChromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)

$Chrome = $null
foreach ($path in $ChromePaths) {
    if (Test-Path $path) {
        $Chrome = $path
        break
    }
}

if (-not $Chrome) {
    Write-Host "Error: Chrome/Edge/Brave not found. Please install Chrome or set the path manually." -ForegroundColor Red
    exit 1
}

Write-Host "Found browser: $Chrome" -ForegroundColor Green
Write-Host "Remote debugging URL: http://localhost:$Port" -ForegroundColor Green
Write-Host ""

# Create a temporary user data dir (Chrome 136+ requires --user-data-dir for remote debugging)
$TempDataDir = Join-Path $env:TEMP "brmonk-chrome-$(Get-Random)"
New-Item -ItemType Directory -Path $TempDataDir -Force | Out-Null

# Chrome removed --remote-debugging-address; it now only binds to 127.0.0.1.
# Set up port forwarding so Docker (host.docker.internal) can reach it.
$portForwarded = $false
try {
    netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 2>$null | Out-Null
    netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 connectport=$Port connectaddress=127.0.0.1 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Port forwarding: 0.0.0.0:$Port -> 127.0.0.1:$Port (for Docker access)" -ForegroundColor Green
        $portForwarded = $true
    } else {
        Write-Host "Warning: Port forwarding failed. Run as Administrator for Docker access." -ForegroundColor Yellow
    }
} catch {
    Write-Host "Warning: Port forwarding requires Administrator privileges." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Close the browser window or press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

try {
    & $Chrome `
        "--remote-debugging-port=$Port" `
        "--user-data-dir=$TempDataDir" `
        "--no-first-run" `
        "--no-default-browser-check" `
        "--disable-background-networking" `
        "--disable-sync" `
        "--window-size=1280,720" `
        "about:blank"
}
finally {
    # Clean up port forwarding rule
    if ($portForwarded) {
        netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 2>$null | Out-Null
    }
    # Clean up temp dir
    if (Test-Path $TempDataDir) {
        Remove-Item -Recurse -Force $TempDataDir -ErrorAction SilentlyContinue
    }
}
