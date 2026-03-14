import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { McpBrowserConfig } from '../config.js';
import type { LLMToolDefinition } from '../llm/types.js';
import { logger } from '../utils/logger.js';

export interface McpToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export class McpBrowserEngine {
  private client: Client | null = null;
  private transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport | null = null;
  private tools: LLMToolDefinition[] = [];
  private headless: boolean;
  private mcpConfig: McpBrowserConfig;
  private remoteUrl: string | null = null;

  constructor(headless: boolean, mcpConfig: McpBrowserConfig, remoteUrl?: string) {
    this.headless = headless;
    this.mcpConfig = mcpConfig;
    this.remoteUrl = remoteUrl ?? null;
  }

  async initialize(): Promise<void> {
    if (this.remoteUrl) {
      // Remote MCP mode: connect to a host-running Playwright MCP server via HTTP
      await this.initializeRemote(this.remoteUrl);
    } else {
      // Local MCP mode: spawn Playwright MCP via stdio
      await this.initializeLocal();
    }

    // Discover available tools
    if (!this.client) throw new Error('MCP client not initialized');
    const toolsResult = await this.client.listTools();
    this.tools = toolsResult.tools.map(tool => ({
      name: tool.name,
      description: tool.description ?? '',
      parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    }));

    logger.info(`MCP browser engine ready with ${this.tools.length} tools`);
  }

  private async initializeRemote(url: string): Promise<void> {
    const parsed = new URL(url);

    // Try Streamable HTTP first (modern MCP), fall back to SSE (legacy)
    this.client = new Client(
      { name: 'brmonk', version: '1.0.0' },
      { capabilities: {} },
    );

    try {
      logger.info(`Connecting to remote MCP server via Streamable HTTP: ${url}`);
      const transport = new StreamableHTTPClientTransport(parsed);
      await this.client.connect(transport);
      this.transport = transport;
      logger.info('Connected via Streamable HTTP transport');
    } catch {
      // Streamable HTTP failed — try SSE fallback
      logger.info('Streamable HTTP failed, trying SSE transport...');
      this.client = new Client(
        { name: 'brmonk', version: '1.0.0' },
        { capabilities: {} },
      );
      const sseTransport = new SSEClientTransport(parsed);
      await this.client.connect(sseTransport);
      this.transport = sseTransport;
      logger.info('Connected via SSE transport');
    }
  }

  private async initializeLocal(): Promise<void> {
    const args = ['@playwright/mcp@latest'];

    if (this.headless) {
      args.push('--headless');
    }

    args.push(`--browser=${this.mcpConfig.browser || 'chrome'}`);

    if (this.mcpConfig.isolated) {
      args.push('--isolated');
    }
    if (this.mcpConfig.userDataDir) {
      args.push(`--user-data-dir=${this.mcpConfig.userDataDir}`);
    }
    if (this.mcpConfig.viewport) {
      args.push(`--viewport-size=${this.mcpConfig.viewport}`);
    }
    if (process.platform === 'linux') {
      args.push('--no-sandbox');
    }
    if (this.mcpConfig.extraArgs) {
      args.push(...this.mcpConfig.extraArgs);
    }

    this.transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', ...args],
    });

    this.client = new Client(
      { name: 'brmonk', version: '1.0.0' },
      { capabilities: {} },
    );

    await this.client.connect(this.transport);
    logger.info('MCP browser engine connected (stdio)');
  }

  getTools(): LLMToolDefinition[] {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.client) {
      throw new Error('MCP browser engine not initialized');
    }

    const result = await this.client.callTool({ name, arguments: args });
    return result as McpToolResult;
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Client may already be disconnected
      }
      this.client = null;
    }
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // Transport may already be closed
      }
      this.transport = null;
    }
    this.tools = [];
  }

  isInitialized(): boolean {
    return this.client !== null;
  }
}
