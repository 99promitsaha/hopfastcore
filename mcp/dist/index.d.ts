#!/usr/bin/env node
/**
 * HopFast MCP Server — Entry Point
 *
 * Supports two transport modes:
 *
 *   stdio  (default) — for Claude Desktop, Claude Code, and any MCP client
 *                       that spawns the server as a child process.
 *     npx hopfast-mcp
 *     node dist/index.js
 *
 *   http   — Streamable HTTP transport for remote / cloud agents.
 *             Agents connect to POST /mcp and GET /mcp (SSE).
 *     node dist/index.js --http [--port 3100]
 *
 * Environment variables:
 *   HOPFAST_API_URL   — HopFast backend URL (default: http://localhost:8080)
 *   PORT              — HTTP server port when using --http flag (default: 3100)
 */
export {};
//# sourceMappingURL=index.d.ts.map