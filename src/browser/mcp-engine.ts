import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpBrowserConfig } from '../config.js';
import type { LLMToolDefinition } from '../llm/types.js';
import { logger } from '../utils/logger.js';

export interface McpToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export class McpBrowserEngine {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: LLMToolDefinition[] = [];
  private headless: boolean;
  private mcpConfig: McpBrowserConfig;

  constructor(headless: boolean, mcpConfig: McpBrowserConfig) {
    this.headless = headless;
    this.mcpConfig = mcpConfig;
  }

  async initialize(): Promise<void> {
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
    logger.info('MCP browser engine connected');

    // Discover available tools
    const toolsResult = await this.client.listTools();
    this.tools = toolsResult.tools.map(tool => ({
      name: tool.name,
      description: tool.description ?? '',
      parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    }));

    logger.info(`MCP browser engine ready with ${this.tools.length} tools`);
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
