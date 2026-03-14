#!/usr/bin/env bash
# Start Chrome/Chromium with remote debugging enabled.
# Works on macOS, Linux, and WSL (launches Windows Chrome from WSL).
#
# Usage:
#   ./scripts/start-browser.sh              # default port 9222
#   ./scripts/start-browser.sh 9333         # custom port
#
# For Docker: brmonk connects to http://host.docker.internal:<port>
# For local:  brmonk connects to http://localhost:<port>

set -e

PORT="${1:-9222}"
IS_WSL=false

# Detect WSL
if grep -qi microsoft /proc/version 2>/dev/null || [ -n "$WSL_DISTRO_NAME" ]; then
    IS_WSL=true
fi

echo "╔══════════════════════════════════════════════╗"
echo "║  brmonk — Starting browser (CDP port $PORT)  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

find_chrome() {
    if $IS_WSL; then
        # WSL: look for Windows Chrome via /mnt/c/
        local WIN_PATHS=(
            "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
            "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
            "/mnt/c/Users/$USER/AppData/Local/Google/Chrome/Application/chrome.exe"
            "/mnt/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe"
            "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe"
        )
        # Also try the Windows username if different from WSL username
        if [ -d "/mnt/c/Users" ]; then
            for winuser in /mnt/c/Users/*/; do
                local u=$(basename "$winuser")
                [ "$u" = "Public" ] || [ "$u" = "Default" ] || [ "$u" = "Default User" ] && continue
                WIN_PATHS+=("/mnt/c/Users/$u/AppData/Local/Google/Chrome/Application/chrome.exe")
            done
        fi
        for path in "${WIN_PATHS[@]}"; do
            if [ -f "$path" ]; then
                echo "$path"
                return
            fi
        done
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        local MAC_PATHS=(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            "/Applications/Chromium.app/Contents/MacOS/Chromium"
            "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
        )
        for path in "${MAC_PATHS[@]}"; do
            if [ -x "$path" ]; then
                echo "$path"
                return
            fi
        done
    else
        # Linux
        for cmd in google-chrome google-chrome-stable chromium-browser chromium; do
            local p=$(which "$cmd" 2>/dev/null || true)
            if [ -n "$p" ] && [ -x "$p" ]; then
                echo "$p"
                return
            fi
        done
    fi
}

CHROME=$(find_chrome)

if [ -z "$CHROME" ]; then
    echo "Error: Chrome/Chromium not found."
    if $IS_WSL; then
        echo "Install Chrome on Windows: https://www.google.com/chrome"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Install Chrome: brew install --cask google-chrome"
    else
        echo "Install Chrome: sudo apt install google-chrome-stable"
    fi
    exit 1
fi

echo "Browser: $CHROME"
echo "CDP URL: http://localhost:$PORT"
if $IS_WSL; then
    echo "Mode:    WSL → Windows Chrome"
fi
echo ""
echo "Press Ctrl+C to stop."
echo ""

if $IS_WSL; then
    # WSL: create temp dir on Windows side, launch via cmd.exe for proper window display
    WIN_TEMP=$(cmd.exe /C "echo %TEMP%" 2>/dev/null | tr -d '\r')
    WIN_DATA_DIR="$WIN_TEMP\\brmonk-chrome-$$"
    
    # Convert WSL path to Windows path for the chrome executable
    WIN_CHROME=$(wslpath -w "$CHROME")
    
    cmd.exe /C "\"$WIN_CHROME\" --remote-debugging-port=$PORT --user-data-dir=\"$WIN_DATA_DIR\" --no-first-run --no-default-browser-check --disable-background-networking --disable-sync --window-size=1280,720 about:blank" 2>/dev/null
    
    # Cleanup
    cmd.exe /C "rmdir /S /Q \"$WIN_DATA_DIR\"" 2>/dev/null || true
else
    # macOS / Linux: create temp dir and launch directly
    TEMP_DATA_DIR=$(mktemp -d -t brmonk-chrome-XXXXXX)
    trap "rm -rf $TEMP_DATA_DIR" EXIT

    "$CHROME" \
        --remote-debugging-port="$PORT" \
        --user-data-dir="$TEMP_DATA_DIR" \
        --no-first-run \
        --no-default-browser-check \
        --disable-background-networking \
        --disable-sync \
        --window-size=1280,720 \
        "about:blank"
fi
