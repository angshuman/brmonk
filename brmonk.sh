#!/usr/bin/env bash
# brmonk — One-command launcher (Docker mode)
# Works on macOS, Linux, and WSL.
#
# What this does:
#   1. Builds the Docker image if needed
#   2. Starts Chrome with remote debugging in the background
#   3. Starts brmonk in Docker (CDP mode)
#   4. Opens the web UI in your browser
#
# Usage:
#   ./brmonk.sh                     # default: CDP mode, port 9222, web UI on 3333
#   ./brmonk.sh --port 8080         # custom web UI port
#   ./brmonk.sh --cdp-port 9333     # custom Chrome debug port
#   ./brmonk.sh --rebuild           # force Docker image rebuild
#   ./brmonk.sh --mcp               # use MCP mode instead of CDP
#   ./brmonk.sh --stop              # stop everything

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_PORT=3333
CDP_PORT=9222
MCP_PORT=3100
FORCE_REBUILD=false
MODE="cdp"
STOP=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)     WEB_PORT="$2"; shift 2 ;;
        --cdp-port) CDP_PORT="$2"; shift 2 ;;
        --mcp-port) MCP_PORT="$2"; shift 2 ;;
        --rebuild)  FORCE_REBUILD=true; shift ;;
        --mcp)      MODE="mcp"; shift ;;
        --stop)     STOP=true; shift ;;
        -h|--help)
            echo "Usage: ./brmonk.sh [options]"
            echo ""
            echo "Options:"
            echo "  --port <port>      Web UI port (default: 3333)"
            echo "  --cdp-port <port>  Chrome debug port (default: 9222)"
            echo "  --mcp-port <port>  Playwright MCP port (default: 3100)"
            echo "  --rebuild          Force Docker image rebuild"
            echo "  --mcp              Use MCP mode instead of CDP"
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

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║           b r m o n k                ║"
echo "  ║   AI Browser Automation Agent        ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ─── Stop mode ──────────────────────────────────────────────
if $STOP; then
    echo "Stopping brmonk services..."
    cd "$SCRIPT_DIR"
    docker compose --profile cdp --profile mcp down 2>/dev/null || true
    # Kill background browser process if we started one
    if [ -f /tmp/brmonk-browser.pid ]; then
        kill "$(cat /tmp/brmonk-browser.pid)" 2>/dev/null || true
        rm -f /tmp/brmonk-browser.pid
    fi
    echo "Done."
    exit 0
fi

# ─── Check prerequisites ────────────────────────────────────
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

# ─── Check for .env file ────────────────────────────────────
cd "$SCRIPT_DIR"
if [ ! -f .env ]; then
    echo "Warning: No .env file found. Creating one from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "Please edit .env and add at least one API key:"
        echo "  ANTHROPIC_API_KEY=sk-ant-..."
        echo "  OPENAI_API_KEY=sk-..."
        echo "  XAI_API_KEY=xai-..."
        echo ""
        read -rp "Press Enter after editing .env (or Ctrl+C to cancel)..."
    else
        cat > .env << 'EOF'
# brmonk — Add at least one API key
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# XAI_API_KEY=xai-...
EOF
        echo "Created .env — please add at least one API key and re-run."
        exit 1
    fi
fi

# ─── Build Docker image ─────────────────────────────────────
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

# ─── Start browser ──────────────────────────────────────────
if [ "$MODE" = "cdp" ]; then
    echo "Starting browser with CDP on port $CDP_PORT..."
    # Start browser in background
    "$SCRIPT_DIR/scripts/start-browser.sh" "$CDP_PORT" &
    BROWSER_PID=$!
    echo "$BROWSER_PID" > /tmp/brmonk-browser.pid
    # Wait a moment for browser to start
    sleep 3
    echo ""
else
    echo "Starting Playwright MCP server on port $MCP_PORT..."
    "$SCRIPT_DIR/scripts/start-mcp-server.sh" "$MCP_PORT" &
    BROWSER_PID=$!
    echo "$BROWSER_PID" > /tmp/brmonk-browser.pid
    sleep 3
    echo ""
fi

# ─── Start Docker container ─────────────────────────────────
echo "Starting brmonk container (web UI on port $WEB_PORT)..."
echo ""

# Override ports if non-default
export WEB_PORT
if [ "$MODE" = "cdp" ]; then
    BRMONK_CDP_URL="http://host.docker.internal:$CDP_PORT"
    docker compose --profile cdp up -d
else
    BRMONK_MCP_URL="http://host.docker.internal:$MCP_PORT/mcp"
    docker compose --profile mcp up -d
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  brmonk is running!"
echo ""
echo "  Web UI:   http://localhost:$WEB_PORT"
echo "  Mode:     $MODE"
if [ "$MODE" = "cdp" ]; then
    echo "  Browser:  CDP on port $CDP_PORT"
else
    echo "  MCP:      port $MCP_PORT"
fi
echo ""
echo "  Stop:     ./brmonk.sh --stop"
echo "  Logs:     docker compose logs -f"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Open browser to web UI
if $IS_WSL; then
    cmd.exe /C start "http://localhost:$WEB_PORT" 2>/dev/null || true
elif [[ "$OSTYPE" == "darwin"* ]]; then
    open "http://localhost:$WEB_PORT" 2>/dev/null || true
else
    xdg-open "http://localhost:$WEB_PORT" 2>/dev/null || true
fi

# Follow logs
docker compose logs -f
