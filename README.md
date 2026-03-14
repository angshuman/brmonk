# brmonk

AI-powered browser automation agent with a built-in TUI dashboard. Uses Playwright for browser control with support for multiple LLM providers (Claude, OpenAI, Grok/xAI).

## Screenshots

### Dashboard
Multi-session overview with status indicators, profile summary, and keyboard navigation.

![Dashboard](docs/screenshots/dashboard.png)

### Session View
Live agent execution with plan tracking, step-by-step log, token usage, and elapsed time.

![Session View](docs/screenshots/session.png)

### New Task Input
Task input with word wrapping, cursor, and smart suggestions.

![New Task](docs/screenshots/input.png)

### Action Required
The agent pauses and prompts you when it needs human intervention (login, CAPTCHA, etc.).

![Action Required](docs/screenshots/action.png)

### CLI Mode
Run tasks directly from the command line without the TUI.

![CLI Mode](docs/screenshots/cli.png)

## Features

- **Multi-LLM Support** — Claude (Anthropic), GPT-4o (OpenAI), and Grok (xAI). Auto-detects available API keys.
- **TUI Dashboard** — Real-time terminal UI showing agent progress, plans, logs, and session history.
- **Persistent Browser Context** — Cookies and localStorage survive across sessions. Log in once, stay logged in.
- **Smart Agent Loop** — Observe-reason-act cycle with automatic CAPTCHA/login detection, popup dismissal, and retry logic.
- **Document Management** — Import and manage documents (resumes, requirements, wish lists) for AI-powered matching.
- **Item Tracking** — Track anything found while browsing (jobs, apartments, products, contracts) and match against your documents.
- **Rich Skills System** — YAML-based skill definitions with shell commands, Python/Node scripts, browser automation, LLM analysis, and multi-step workflows. Create custom skills without writing TypeScript.
- **Session Memory** — All sessions are saved and reviewable. Rolling context summarization prevents token overflow.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│   CLI/TUI   │────>│  Agent Loop  │────>│  LLM Provider │
│  (app.ts)   │<────│  (loop.ts)   │<────│  (claude/oai) │
└──────┬──────┘     └──────┬───────┘     └───────────────┘
       │                   │
       │  Events           │  Tools
       │                   v
       │            ┌──────────────┐
       │            │   Browser    │
       └───────────>│   Engine     │
                    │ (Playwright) │
                    └──────┬───────┘
                           │
                    ┌──────v───────┐
                    │  DOM Extract │
                    │  + Actions   │
                    └──────────────┘
```

The agent loop follows an **observe → reason → act** cycle:
1. **Observe** — Extract DOM snapshot (interactive elements, forms, headings, text summary)
2. **Reason** — Send observation to LLM, get tool calls back
3. **Act** — Execute browser actions (click, type, navigate, etc.)
4. **Repeat** until done or max steps reached

## Quick Start

brmonk supports two deployment modes: **Docker** (recommended for production) and **Local** (simpler, good for development).

### Option 1: Docker Mode (recommended)

The browser runs on your host machine; brmonk runs in Docker and connects to it.

**macOS / Linux / WSL:**
```bash
# 1. Add your API key(s) to .env
cp .env.example .env && edit .env

# 2. Launch everything with one command
./brmonk.sh
```

**Windows (PowerShell):**
```powershell
# 1. Add your API key(s) to .env
copy .env.example .env
notepad .env

# 2. Launch everything with one command
.\brmonk.ps1
```

**Windows (CMD):**
```cmd
brmonk.bat
```

This builds the Docker image (first time), starts Chrome with remote debugging, starts brmonk in Docker, and opens the web UI at http://localhost:3333.

To stop: `./brmonk.sh --stop` or `.\brmonk.ps1 -Stop`

### Option 2: Local Mode (no Docker)

Runs brmonk directly on your machine.

**macOS / Linux / WSL:**
```bash
# Install deps & build on first run
npm install && npm run build && npm run build:web
npx playwright install chromium

# Set at least one API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start web UI
./scripts/start-local.sh

# Or start TUI console
./scripts/start-local.sh --console
```

**Windows (PowerShell):**
```powershell
npm install; npm run build; npm run build:web
npx playwright install chromium

$env:ANTHROPIC_API_KEY = "sk-ant-..."

.\scripts\start-local.ps1
```

### Manual Quick Start

```bash
# Install dependencies
npm install
npx playwright install chromium

# Set at least one API key
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
# or
export XAI_API_KEY=xai-...

# Build
npm run build

# Launch TUI dashboard
brmonk

# Or run a single task
brmonk run "Search for the latest AI news"

# Interactive REPL mode
brmonk interactive

# Web UI
npm run build:web
brmonk web --port 3333
```

## CLI Commands

```
brmonk                         Launch TUI dashboard
brmonk run <task>              Run a single automation task
  -p, --provider <provider>    LLM provider (claude, openai, grok, auto)
  -m, --model <model>          Model name
  --headful / --headless       Browser visibility
  --max-steps <n>              Maximum agent steps
  -v, --verbose                Verbose output

brmonk interactive             Start REPL mode
brmonk skills list             List all skills (built-in + user-defined)
brmonk skills info <name>      Show detailed skill information
brmonk skills init <name>      Create a new skill from template
brmonk skills validate <path>  Validate a skill definition
brmonk skills install <source> Install a skill from directory or file
brmonk skills remove <name>    Remove a user-installed skill
brmonk history list            List past sessions
brmonk history show <id>       Show session details
brmonk profile show            Show your profile
brmonk profile set             Set profile interactively
brmonk profile import <file>   Import a document (shortcut for docs import --type resume)
brmonk items list              List tracked items
brmonk items collections       List collections and counts
brmonk docs list               List stored documents
brmonk docs show <id>          Show document content
brmonk docs import <file>      Import a document
brmonk docs delete <id>        Delete a document
brmonk config set <key> <val>  Set a config value
brmonk config show             Show current config
```

## TUI Dashboard

The TUI provides a real-time view of agent activity:

- **Dashboard** — Session list with status indicators (running/completed/failed/paused), profile summary, memory stats. Keys: `n` new task, `j/k` or arrows to navigate, `Enter` view session, `p` profile, `q` quit.
- **Session View** — Live agent log with plan progress, elapsed time, token usage, and current action. Keys: `m` or `Enter` to send message to agent, `p` pause/resume, `s` screenshot, `b` back.
- **Input View** — Task input with word wrapping, cursor blinking, and contextual suggestions.
- **Action Required** — Automatic detection of login walls and CAPTCHAs. The agent pauses, opens the browser, and waits for you to complete the action.

## Configuration

Config file: `~/.brmonk/config.json`

| Key | Default | Description |
|-----|---------|-------------|
| `provider` | `"auto"` | LLM provider |
| `model` | `""` | Model override |
| `headless` | `false` | Run browser headless |
| `maxSteps` | `50` | Max agent steps per task |
| `persistBrowserContext` | `true` | Keep cookies/localStorage across sessions |
| `verbose` | `false` | Verbose logging |

## Skills

brmonk has a rich skills system with two types of skills:

### Built-in Skills
Hardcoded TypeScript skills that ship with brmonk:
- **tracker** — Track, organize, and match items found while browsing
- **documents** — Import, parse, and manage user documents for matching context
- **smart-browse** — Enhanced browsing with content extraction and summarization
- **web-search**, **data-extract**, **form-fill**, **screenshot**, **navigate**

### User-Defined Skills (YAML)
Create custom skills as YAML files in `~/.brmonk/skills/`. Each skill defines:
- **Instructions** — Markdown guidance injected into the agent's system prompt
- **Tools** — Named actions the LLM can invoke
- **Actions** — Multi-step execution pipelines for each tool

#### Action Step Types
| Type | Description |
|------|-------------|
| `shell` | Run a shell command with template interpolation |
| `script` | Execute a Python, Node.js, or Bash script |
| `browser` | Perform browser automation actions |
| `llm` | Make an LLM call for analysis or extraction |
| `conditional` | Branch execution based on previous output |

#### Quick Start: Create a Skill
```bash
# Scaffold a new skill
brmonk skills init my-skill

# Edit the generated skill.yaml
vim ~/.brmonk/skills/my-skill/skill.yaml

# Validate it
brmonk skills validate ~/.brmonk/skills/my-skill

# It's automatically loaded on next run
brmonk skills list
```

#### Example: skill.yaml
```yaml
name: github-pr
version: "1.0.0"
description: "Create and manage GitHub pull requests"
tags: ["github", "git"]

instructions: |
  ## GitHub PR Management
  Use this skill to create and list pull requests.
  Requires the `gh` CLI to be installed.

tools:
  - name: listPRs
    description: "List open pull requests"
    parameters:
      type: object
      properties:
        status:
          type: string
          description: "Filter: open, closed, merged, all"

actions:
  listPRs:
    steps:
      - type: shell
        command: "gh pr list --state {{status}} --json number,title,url"
        timeout: 15
      - type: llm
        prompt: |
          Format these PRs into a readable summary:
          {{previousStepOutput}}
```

#### Template Variables
All string fields support `{{variable}}` interpolation:
- `{{argName}}` — Arguments from the LLM tool call
- `{{previousStepOutput}}` — Output from the previous step
- `{{env.VAR_NAME}}` — Environment variables
- `{{skillDir}}` — Path to the skill directory
- `{{#if var}}...{{/if}}` — Conditional blocks

See `examples/skills/` for complete working examples.

## Launcher Scripts

brmonk includes launcher scripts for every platform. These handle building, starting the browser, starting the container, and opening the web UI — all in one command.

### One-Command Launchers (Docker mode)

| Script | Platform | Description |
|--------|----------|-------------|
| `./brmonk.sh` | macOS / Linux / WSL | Builds image, starts Chrome + Docker, opens web UI |
| `.\brmonk.ps1` | Windows PowerShell | Same as above for Windows |
| `brmonk.bat` | Windows CMD | Batch wrapper that calls `brmonk.ps1` |

**Options:**

| Flag (sh) | Flag (ps1) | Default | Description |
|-----------|------------|---------|-------------|
| `--port <n>` | `-Port <n>` | 3333 | Web UI port |
| `--cdp-port <n>` | `-CdpPort <n>` | 9222 | Chrome remote debug port |
| `--mcp` | `-Mcp` | off | Use MCP mode instead of CDP |
| `--rebuild` | `-Rebuild` | off | Force Docker image rebuild |
| `--stop` | `-Stop` | — | Stop all brmonk services |

### Local Mode Launchers (no Docker)

| Script | Platform | Description |
|--------|----------|-------------|
| `./scripts/start-local.sh` | macOS / Linux / WSL | Run natively with local Playwright browser |
| `.\scripts\start-local.ps1` | Windows PowerShell | Same for Windows |

**Options:**

| Flag (sh) | Flag (ps1) | Default | Description |
|-----------|------------|---------|-------------|
| `--port <n>` | `-Port <n>` | 3333 | Web UI port |
| `--console` | `-Console` | off | Launch TUI console instead of web UI |
| `--build` | `-Build` | off | Rebuild before starting |
| `--headless` | `-Headless` | off | Run browser headless |

### Browser Helper Scripts

| Script | Platform | Description |
|--------|----------|-------------|
| `./scripts/start-browser.sh` | macOS / Linux / WSL | Start Chrome with CDP (auto-detects WSL → Windows Chrome) |
| `.\scripts\start-browser.ps1` | Windows | Start Chrome with CDP |
| `./scripts/start-mcp-server.sh` | macOS / Linux / WSL | Start Playwright MCP server |
| `.\scripts\start-mcp-server.ps1` | Windows | Start Playwright MCP server |

## Docker

Run brmonk in a Docker container while the browser runs on your host machine. Two connection modes are available.

> **Easiest way:** Use `./brmonk.sh` or `.\brmonk.ps1` — they handle everything below automatically.

### Option A: Remote CDP (recommended)

Chrome DevTools Protocol gives brmonk full Playwright API access including live screenshots.

```bash
# 1. On your host, start Chrome with remote debugging:
./scripts/start-browser.sh          # macOS/Linux/WSL
.\scripts\start-browser.ps1         # Windows

# 2. Copy .env.example to .env and add your API key(s)
cp .env.example .env

# 3. Start brmonk in Docker:
docker compose --profile cdp up
```

Open http://localhost:3333 for the web UI.

### Option B: Remote MCP

Playwright MCP server runs on the host; brmonk connects over HTTP.

```bash
# 1. On your host, start the Playwright MCP server:
./scripts/start-mcp-server.sh       # macOS/Linux/WSL
.\scripts\start-mcp-server.ps1      # Windows

# 2. Start brmonk in Docker:
docker compose --profile mcp up
```

### Build the Docker Image Manually

```bash
# Build backend + frontend first
npm run build
npm run build:web

# Build Docker image
docker build -t brmonk .
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `BRMONK_BROWSER_BACKEND` | `playwright`, `playwright-mcp`, `remote-cdp`, or `remote-mcp` |
| `BRMONK_CDP_URL` | Chrome CDP endpoint (e.g. `http://host.docker.internal:9222`) |
| `BRMONK_MCP_URL` | Playwright MCP endpoint (e.g. `http://host.docker.internal:3100/mcp`) |
| `BRMONK_MEMORY_DIR` | Directory for persistent data (default: `~/.brmonk`) |
| `BRMONK_SKILLS_DIR` | Directory for user skills (default: `~/.brmonk/skills`) |
| `BRMONK_HEADLESS` | Run browser headless (`true`/`false`) |

## Development

```bash
npm run dev          # Watch mode
npm run build        # Compile TypeScript
npm run lint         # Type-check without emitting
npm run clean        # Remove dist/
```

## License

MIT
