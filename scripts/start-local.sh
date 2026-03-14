#!/usr/bin/env bash
# brmonk — Run natively without Docker (macOS/Linux/WSL)
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
#   ./scripts/start-local.sh                    # web UI on port 3333
#   ./scripts/start-local.sh --port 8080        # custom port
#   ./scripts/start-local.sh --console          # TUI mode (no web UI)
#   ./scripts/start-local.sh --build            # rebuild before starting
#   ./scripts/start-local.sh --headless         # run browser headless

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_PORT=3333
CONSOLE_MODE=false
DO_BUILD=false
HEADLESS=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)     WEB_PORT="$2"; shift 2 ;;
        --console)  CONSOLE_MODE=true; shift ;;
        --build)    DO_BUILD=true; shift ;;
        --headless) HEADLESS="--headless"; shift ;;
        -h|--help)
            echo "Usage: ./scripts/start-local.sh [options]"
            echo ""
            echo "Options:"
            echo "  --port <port>   Web UI port (default: 3333)"
            echo "  --console       Launch TUI console instead of web UI"
            echo "  --build         Rebuild before starting"
            echo "  --headless      Run browser in headless mode"
            echo "  -h, --help      Show this help"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

cd "$PROJECT_DIR"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║           b r m o n k                ║"
echo "  ║        Local Mode (no Docker)        ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "Error: Node.js is not installed."
    echo "Install Node.js 18+: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Error: Node.js 18+ required (found v$(node -v))."
    exit 1
fi

# Check dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

# Load .env
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

# Check API keys
if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$OPENAI_API_KEY" ] && [ -z "$XAI_API_KEY" ]; then
    echo "Warning: No API keys found." 
    echo "Set at least one in .env or environment:"
    echo "  ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY"
    echo ""
fi

# Build if needed or requested
if [ ! -d "dist" ] || $DO_BUILD; then
    echo "Building backend..."
    npm run build
    echo ""
fi

if [ ! -d "web/dist" ] || $DO_BUILD; then
    echo "Building web UI..."
    npm run build:web
    echo ""
fi

# Install Playwright browsers if needed
if ! npx playwright install --dry-run chromium &>/dev/null 2>&1; then
    echo "Installing Playwright Chromium..."
    npx playwright install chromium
    echo ""
fi

# Launch
if $CONSOLE_MODE; then
    echo "Starting brmonk TUI console..."
    echo ""
    node dist/cli.js $HEADLESS
else
    echo "Starting brmonk web UI on port $WEB_PORT..."
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Web UI:  http://localhost:$WEB_PORT"
    echo "  Mode:    local (Playwright)"
    echo "  Stop:    Ctrl+C"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    IS_WSL=false
    if grep -qi microsoft /proc/version 2>/dev/null || [ -n "$WSL_DISTRO_NAME" ]; then
        IS_WSL=true
    fi

    # Open browser
    if $IS_WSL; then
        cmd.exe /C start "http://localhost:$WEB_PORT" 2>/dev/null &
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        open "http://localhost:$WEB_PORT" 2>/dev/null &
    else
        xdg-open "http://localhost:$WEB_PORT" 2>/dev/null &
    fi

    node dist/cli.js web --port "$WEB_PORT" $HEADLESS
fi
