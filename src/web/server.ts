import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as crypto from 'node:crypto';
import { loadConfig } from '../config.js';
import { createProvider } from '../llm/provider.js';
import { BrowserEngine } from '../browser/engine.js';
import { McpBrowserEngine } from '../browser/mcp-engine.js';
import { AgentLoop } from '../agent/loop.js';
import { SkillRegistry } from '../skills/registry.js';
import { MemoryStore } from '../memory/store.js';
import { AgentEventBus, type AgentEvent } from '../events.js';
import { createApiRouter } from './api.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ActiveSession {
  id: string;
  task: string;
  agent: AgentLoop;
  eventBus: AgentEventBus;
  events: AgentEvent[];
  status: string;
  startedAt: number;
}

interface WsMessage {
  type: string;
  task?: string;
  sessionId?: string;
  message?: string;
}

export async function startWebServer(port: number): Promise<void> {
  const config = await loadConfig();
  const provider = createProvider(config.provider, config.model || undefined);
  const browser = new BrowserEngine(config.headless, config.persistBrowserContext);
  const skillRegistry = new SkillRegistry();
  const memory = new MemoryStore(config.memoryDir);

  let mcpEngine: McpBrowserEngine | undefined;
  if (config.browserBackend === 'playwright-mcp') {
    mcpEngine = new McpBrowserEngine(config.headless, config.mcpBrowser);
    await mcpEngine.initialize();
  }

  await skillRegistry.loadFromDirectory(config.skillsDir);
  await browser.launch();

  const sessions = new Map<string, ActiveSession>();
  const wsClients = new Map<WebSocket, string | null>(); // ws → subscribed sessionId
  let runningSessionId: string | null = null;

  const app = express();
  app.use(cors());
  app.use(express.json());

  // REST API
  const apiRouter = createApiRouter(sessions, memory, skillRegistry, config);
  app.use('/api', apiRouter);

  // Serve static frontend in production
  const webDistPath = path.resolve(__dirname, '../../web/dist');
  app.use(express.static(webDistPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(webDistPath, 'index.html'));
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  function broadcast(sessionId: string, event: AgentEvent): void {
    const msg = JSON.stringify(event);
    for (const [ws, subId] of wsClients.entries()) {
      if (ws.readyState === WebSocket.OPEN && subId === sessionId) {
        ws.send(msg);
      }
    }
  }

  async function startSession(task: string, ws: WebSocket): Promise<string> {
    const sessionId = crypto.randomUUID().slice(0, 8);
    const eventBus = new AgentEventBus(sessionId);

    const agent = new AgentLoop({
      llm: provider,
      browser,
      mcpEngine,
      skillRegistry,
      memory,
      eventBus,
      maxSteps: config.maxSteps,
    });

    const session: ActiveSession = {
      id: sessionId,
      task,
      agent,
      eventBus,
      events: [],
      status: 'running',
      startedAt: Date.now(),
    };

    sessions.set(sessionId, session);

    // Subscribe this ws to the session
    wsClients.set(ws, sessionId);

    // Forward all events to WebSocket clients and store them
    eventBus.onEvent((event: AgentEvent) => {
      session.events.push(event);
      if (event.type === 'status') {
        session.status = (event as { type: 'status'; sessionId: string; status: string }).status;
      }
      broadcast(sessionId, event);
    });

    // Send session-created to the originating client
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'session-created', sessionId, task }));
    }

    runningSessionId = sessionId;

    // Run the agent in background
    agent.run(task).then(async (state) => {
      session.status = state.status;
      if (runningSessionId === sessionId) {
        runningSessionId = null;
      }
      // Save session to memory
      try {
        await memory.saveSession(sessionId, state.history, task);
      } catch {
        // Non-critical
      }
    }).catch((err) => {
      session.status = 'failed';
      const errorMsg = err instanceof Error ? err.message : String(err);
      eventBus.emitError(errorMsg);
      if (runningSessionId === sessionId) {
        runningSessionId = null;
      }
    });

    return sessionId;
  }

  wss.on('connection', (ws: WebSocket) => {
    wsClients.set(ws, null);

    ws.on('message', (raw: Buffer) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsMessage;
      } catch {
        return;
      }

      if (msg.type === 'start-task' && msg.task) {
        void startSession(msg.task, ws);
      } else if (msg.type === 'subscribe' && msg.sessionId) {
        wsClients.set(ws, msg.sessionId);
        // Send event replay
        const session = sessions.get(msg.sessionId);
        if (session && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'event-replay',
            sessionId: msg.sessionId,
            events: session.events,
          }));
        }
      } else if (msg.type === 'send-message' && msg.sessionId && msg.message) {
        const session = sessions.get(msg.sessionId);
        if (session) {
          session.agent.injectMessage(msg.message);
        }
      } else if (msg.type === 'user-action-resolved' && msg.sessionId) {
        const session = sessions.get(msg.sessionId);
        if (session) {
          session.agent.resume();
        }
      } else if (msg.type === 'stop' && msg.sessionId) {
        const session = sessions.get(msg.sessionId);
        if (session) {
          session.agent.pause();
          session.status = 'paused';
        }
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
    });
  });

  // Graceful shutdown
  const cleanup = async (): Promise<void> => {
    logger.info('Shutting down web server...');
    if (mcpEngine) await mcpEngine.close();
    await browser.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void cleanup());
  process.on('SIGTERM', () => void cleanup());

  server.listen(port, () => {
    logger.info(`brmonk web server running at http://localhost:${port}`);
  });
}
