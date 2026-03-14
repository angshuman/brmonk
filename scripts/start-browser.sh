#!/usr/bin/env bash
# Start Chrome/Chromium with remote debugging enabled for brmonk Docker to connect via CDP.
# Run this on your HOST machine before starting brmonk in Docker.
#
# Usage:
#   ./scripts/start-browser.sh              # uses default port 9222
#   ./scripts/start-browser.sh 9333         # uses custom port
#
# The browser will open with remote debugging on the specified port.
# brmonk in Docker connects to http://host.docker.internal:<port>

set -e

PORT="${1:-9222}"

echo "Starting Chrome with remote debugging on port $PORT..."
echo "brmonk in Docker will connect to this browser."
echo ""

# Detect OS and find Chrome
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    CHROME_PATHS=(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        "/Applications/Chromium.app/Contents/MacOS/Chromium"
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    )
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    CHROME_PATHS=(
        "$(which google-chrome 2>/dev/null || true)"
        "$(which google-chrome-stable 2>/dev/null || true)"
        "$(which chromium-browser 2>/dev/null || true)"
        "$(which chromium 2>/dev/null || true)"
    )
else
    echo "Error: Unsupported OS. Use start-browser.ps1 for Windows."
    exit 1
fi

CHROME=""
for path in "${CHROME_PATHS[@]}"; do
    if [[ -n "$path" && -x "$path" ]]; then
        CHROME="$path"
        break
    fi
done

if [[ -z "$CHROME" ]]; then
    echo "Error: Chrome/Chromium not found. Please install Chrome or set the path manually."
    exit 1
fi

echo "Found browser: $CHROME"
echo "Remote debugging URL: http://localhost:$PORT"
echo ""
echo "Press Ctrl+C to stop."
echo ""

# Create a temporary user data dir to avoid conflicts with existing Chrome profiles
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
