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
Write-Host "Close the browser window or press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

# Create a temporary user data dir
$TempDataDir = Join-Path $env:TEMP "brmonk-chrome-$(Get-Random)"
New-Item -ItemType Directory -Path $TempDataDir -Force | Out-Null

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
    # Clean up temp dir
    if (Test-Path $TempDataDir) {
        Remove-Item -Recurse -Force $TempDataDir -ErrorAction SilentlyContinue
    }
}
