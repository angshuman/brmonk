#!/usr/bin/env bash
# brmonk - One-command launcher for macOS, Linux, and WSL
#
# Starts everything you need in one shot:
#   1. Chrome with remote debugging (CDP)
#   2. Docker container (brmonk agent + web UI)
#   3. Opens the web UI in your default browser
#
# Usage:
#   ./brmonk.sh                     # start everything (CDP mode)
#   ./brmonk.sh --mcp               # use Playwright MCP instead of CDP
#   ./brmonk.sh --port 8080         # custom web UI port
#   ./brmonk.sh --cdp-port 9333     # custom Chrome debug port
#   ./brmonk.sh --rebuild           # force Docker image rebuild
#   ./brmonk.sh --stop              # stop everything
#   ./brmonk.sh --local             # run without Docker (Node.js only)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_PORT=3333
CDP_PORT=9222
MCP_PORT=3100
FORCE_REBUILD=false
MODE="cdp"
STOP=false
LOCAL=false
HEADLESS=false
CONSOLE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)      WEB_PORT="$2"; shift 2 ;;
        --cdp-port)  CDP_PORT="$2"; shift 2 ;;
        --mcp-port)  MCP_PORT="$2"; shift 2 ;;
        --rebuild)   FORCE_REBUILD=true; shift ;;
        --mcp)       MODE="mcp"; shift ;;
        --stop)      STOP=true; shift ;;
        --local)     LOCAL=true; shift ;;
        --headless)  HEADLESS=true; shift ;;
        --console)   CONSOLE=true; shift ;;
        -h|--help)
            echo "Usage: ./brmonk.sh [options]"
            echo ""
            echo "Options:"
            echo "  --port <port>      Web UI port (default: 3333)"
            echo "  --cdp-port <port>  Chrome debug port (default: 9222)"
            echo "  --mcp-port <port>  Playwright MCP port (default: 3100)"
            echo "  --rebuild          Force Docker image rebuild"
            echo "  --mcp              Use Playwright MCP instead of Chrome CDP"
            echo "  --local            Run without Docker (requires Node.js 18+)"
            echo "  --headless         Run browser headless (local mode only)"
            echo "  --console          TUI console instead of web UI (local mode)"
            echo "  --stop             Stop all brmonk services"
            echo "  -h, --help         Show this help"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

IS_WSL=false
if grep -qi microsoft /proc/version 2>/dev/null || [ -n "$WSL_DISTRO_NAME" ]; then
    IS_WSL=true
fi

# ─── Banner ─────────────────────────────────────────────────
echo ""
echo "  ========================================"
echo "             b r m o n k"
echo "     AI Browser Automation Agent"
echo "  ========================================"
echo ""

# ─── Stop mode ──────────────────────────────────────────────
if $STOP; then
    echo "Stopping brmonk services..."
    cd "$SCRIPT_DIR"
    docker compose --profile cdp --profile mcp down 2>/dev/null || true
    # Kill browser/MCP processes
    for pidfile in /tmp/brmonk-browser.pid /tmp/brmonk-mcp.pid; do
        if [ -f "$pidfile" ]; then
            kill "$(cat "$pidfile")" 2>/dev/null || true
            rm -f "$pidfile"
        fi
    done
    # Clean up Chrome temp dir
    if [ -f /tmp/brmonk-chrome-dir.txt ]; then
        rm -rf "$(cat /tmp/brmonk-chrome-dir.txt)" 2>/dev/null || true
        rm -f /tmp/brmonk-chrome-dir.txt
    fi
    echo "Done."
    exit 0
fi

# ─── Find Chrome ────────────────────────────────────────────
find_chrome() {
    if $IS_WSL; then
        local WIN_PATHS=(
            "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
            "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
            "/mnt/c/Users/$USER/AppData/Local/Google/Chrome/Application/chrome.exe"
            "/mnt/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe"
            "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe"
        )
        if [ -d "/mnt/c/Users" ]; then
            for winuser in /mnt/c/Users/*/; do
                local u=$(basename "$winuser")
                [ "$u" = "Public" ] || [ "$u" = "Default" ] || [ "$u" = "Default User" ] && continue
                WIN_PATHS+=("/mnt/c/Users/$u/AppData/Local/Google/Chrome/Application/chrome.exe")
            done
        fi
        for path in "${WIN_PATHS[@]}"; do
            if [ -f "$path" ]; then echo "$path"; return; fi
        done
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        local MAC_PATHS=(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            "/Applications/Chromium.app/Contents/MacOS/Chromium"
            "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
        )
        for path in "${MAC_PATHS[@]}"; do
            if [ -x "$path" ]; then echo "$path"; return; fi
        done
    else
        for cmd in google-chrome google-chrome-stable chromium-browser chromium; do
            local p=$(which "$cmd" 2>/dev/null || true)
            if [ -n "$p" ] && [ -x "$p" ]; then echo "$p"; return; fi
        done
    fi
}

# ─── Open URL helper ───────────────────────────────────────
open_url() {
    if $IS_WSL; then
        cmd.exe /C start "$1" 2>/dev/null || true
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        open "$1" 2>/dev/null || true
    else
        xdg-open "$1" 2>/dev/null || true
    fi
}

# ═══════════════════════════════════════════════════════════
#  LOCAL MODE (no Docker)
# ═══════════════════════════════════════════════════════════
if $LOCAL; then
    cd "$SCRIPT_DIR"

    # Check Node.js
    if ! command -v node &>/dev/null; then
        echo "Error: Node.js is not installed."
        echo "Install Node.js 18+: https://nodejs.org/"
        exit 1
    fi
    NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VER" -lt 18 ]; then
        echo "Error: Node.js 18+ required (found $(node -v))."
        exit 1
    fi

    # Dependencies
    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        npm install
        echo ""
    fi

    # Load .env
    if [ -f ".env" ]; then
        set -a
        source <(grep -v '^\s*#' .env | grep -v '^\s*$')
        set +a
    fi

    # Check API keys
    if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$OPENAI_API_KEY" ] && [ -z "$XAI_API_KEY" ]; then
        echo "Warning: No API keys found in .env or environment."
        echo "Set at least one: ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY"
        echo ""
    fi

    # Build if needed
    if [ ! -d "dist" ] || $FORCE_REBUILD; then
        echo "Building backend..."
        npm run build
        echo ""
    fi
    if [ ! -d "web/dist" ] || $FORCE_REBUILD; then
        echo "Building web UI..."
        npm run build:web
        echo ""
    fi

    # Install Playwright browsers if needed
    npx playwright install --dry-run chromium 2>/dev/null || {
        echo "Installing Playwright Chromium..."
        npx playwright install chromium
        echo ""
    }

    HEADLESS_ARG=""
    if $HEADLESS; then HEADLESS_ARG="--headless"; fi

    if $CONSOLE; then
        echo "Starting brmonk TUI console..."
        echo ""
        node dist/cli.js $HEADLESS_ARG
    else
        echo "========================================"
        echo "  brmonk is running! (local mode)"
        echo ""
        echo "  Web UI:  http://localhost:$WEB_PORT"
        echo "  Mode:    local (Playwright)"
        echo "  Stop:    Ctrl+C"
        echo "========================================"
        echo ""
        open_url "http://localhost:$WEB_PORT"
        node dist/cli.js web --port "$WEB_PORT" $HEADLESS_ARG
    fi
    exit 0
fi

# ═══════════════════════════════════════════════════════════
#  DOCKER MODE (default)
# ═══════════════════════════════════════════════════════════

# ─── Check Docker ───────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    echo "Error: Docker is not installed or not in PATH."
    echo ""
    if $IS_WSL; then
        echo "Install Docker Desktop for Windows and enable WSL integration:"
        echo "  https://docs.docker.com/desktop/install/windows-install/"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Install Docker Desktop: brew install --cask docker"
    else
        echo "Install Docker: https://docs.docker.com/engine/install/"
    fi
    exit 1
fi

if ! docker info &>/dev/null; then
    echo "Error: Docker daemon is not running. Start Docker Desktop first."
    exit 1
fi

# ─── Check .env ─────────────────────────────────────────────
cd "$SCRIPT_DIR"
if [ ! -f .env ]; then
    echo "Warning: No .env file found."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "Created .env from .env.example. Please edit it and add at least one API key:"
    else
        cat > .env << 'ENVEOF'
# brmonk - Add at least one API key
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# XAI_API_KEY=xai-...
ENVEOF
        echo "Created .env - please add at least one API key and re-run."
        exit 1
    fi
    echo "  ANTHROPIC_API_KEY=sk-ant-..."
    echo "  OPENAI_API_KEY=sk-..."
    echo "  XAI_API_KEY=xai-..."
    echo ""
    read -rp "Press Enter after editing .env (or Ctrl+C to cancel)..."
fi

# ─── Build Docker image ────────────────────────────────────
IMAGE_EXISTS=$(docker images -q brmonk 2>/dev/null)
if [ -z "$IMAGE_EXISTS" ] || $FORCE_REBUILD; then
    echo "Building brmonk Docker image..."
    echo "(This includes: npm run build, npm run build:web, docker build)"
    echo ""
    npm run build
    npm run build:web
    docker build -t brmonk .
    echo ""
    echo "Docker image built successfully."
else
    echo "Docker image found. Use --rebuild to force a fresh build."
fi
echo ""

# ─── Start Chrome (CDP) or Playwright MCP ──────────────────
if [ "$MODE" = "cdp" ]; then
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
    echo "Found browser: $CHROME"
    echo "Starting Chrome with CDP on port $CDP_PORT (listening on all interfaces)..."

    # Create temp user data dir
    TEMP_DATA_DIR=$(mktemp -d -t brmonk-chrome-XXXXXX)
    echo "$TEMP_DATA_DIR" > /tmp/brmonk-chrome-dir.txt

    if $IS_WSL; then
        WIN_TEMP=$(cmd.exe /C "echo %TEMP%" 2>/dev/null | tr -d '\r')
        WIN_DATA_DIR="$WIN_TEMP\\brmonk-chrome-$$"
        WIN_CHROME=$(wslpath -w "$CHROME")
        cmd.exe /C "\"$WIN_CHROME\" --remote-debugging-port=$CDP_PORT --remote-debugging-address=0.0.0.0 --user-data-dir=\"$WIN_DATA_DIR\" --no-first-run --no-default-browser-check --disable-background-networking --disable-sync --window-size=1280,720 about:blank" 2>/dev/null &
    else
        "$CHROME" \
            --remote-debugging-port="$CDP_PORT" \
            --remote-debugging-address=0.0.0.0 \
            --user-data-dir="$TEMP_DATA_DIR" \
            --no-first-run \
            --no-default-browser-check \
            --disable-background-networking \
            --disable-sync \
            --window-size=1280,720 \
            "about:blank" &
    fi
    BROWSER_PID=$!
    echo "$BROWSER_PID" > /tmp/brmonk-browser.pid
    sleep 3
else
    echo "Starting Playwright MCP server on port $MCP_PORT (listening on all interfaces)..."
    npx -y @playwright/mcp@latest --port "$MCP_PORT" --host 0.0.0.0 &
    MCP_PID=$!
    echo "$MCP_PID" > /tmp/brmonk-mcp.pid
    sleep 3
fi
echo ""

# ─── Start Docker container ────────────────────────────────
echo "Starting brmonk container (web UI on port $WEB_PORT)..."
echo ""

export WEB_PORT
if [ "$MODE" = "cdp" ]; then
    BRMONK_CDP_URL="http://host.docker.internal:$CDP_PORT"
    docker compose --profile cdp up -d
else
    BRMONK_MCP_URL="http://host.docker.internal:$MCP_PORT/mcp"
    docker compose --profile mcp up -d
fi

echo ""
echo "========================================"
echo "  brmonk is running!"
echo ""
echo "  Web UI:   http://localhost:$WEB_PORT"
echo "  Mode:     $MODE (Docker)"
if [ "$MODE" = "cdp" ]; then
    echo "  Browser:  CDP on port $CDP_PORT"
else
    echo "  MCP:      port $MCP_PORT"
fi
echo ""
echo "  Stop:     ./brmonk.sh --stop"
echo "  Logs:     docker compose logs -f"
echo "========================================"
echo ""

# Open web UI
open_url "http://localhost:$WEB_PORT"

# Follow logs (Ctrl+C to detach)
docker compose logs -f
