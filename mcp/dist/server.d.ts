/**
 * HopFast MCP Server
 *
 * Assembles all tools, resources, and prompts into a single McpServer instance.
 * Keeping this separate from index.ts lets us support multiple transports.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare function createHopFastMcpServer(): McpServer;
//# sourceMappingURL=server.d.ts.map