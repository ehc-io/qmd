#!/usr/bin/env bun
import { parseArgs } from "util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { getStats, getAllDocuments, DB_PATH } from "./db.js";
import { runIngestion } from "./ingest.js";
import {
  hybridSearch,
  vectorSearch,
  formatSearchResults,
} from "./search.js";
import { isEmbeddingsEnabled, getModelName } from "./embeddings.js";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    transport: { type: "string", default: "stdio" },
    port: { type: "string", default: "3000" },
  },
  allowPositionals: true,
});

const command = positionals[0] || "mcp";
const KB_PATH = process.env.QMD_KB_PATH || "/app/kb";

// MCP Server instance
function createMcpServer() {
  const server = new Server(
    {
      name: "qmd",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "qmd_query",
          description:
            "Search the knowledge base using hybrid search (keyword + semantic). Use this for most retrieval tasks.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query",
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return",
                default: 5,
              },
            },
            required: ["query"],
          },
        },
        {
          name: "qmd_vsearch",
          description:
            "Vector-only semantic search. Use when looking for conceptually similar content rather than exact keyword matches.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query",
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return",
                default: 5,
              },
            },
            required: ["query"],
          },
        },
        {
          name: "qmd_refresh_index",
          description:
            "Trigger the ingestion pipeline. Scans the knowledge base folder for new or modified markdown files and updates the index. Use when the user mentions adding new files.",
          inputSchema: {
            type: "object",
            properties: {
              force: {
                type: "boolean",
                description: "Force re-indexing of all files",
                default: false,
              },
            },
          },
        },
        {
          name: "qmd_get",
          description:
            "Retrieve the full content of a specific file from the knowledge base.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "Relative path to the file within the knowledge base",
              },
            },
            required: ["path"],
          },
        },
        {
          name: "qmd_list",
          description: "List all indexed files in the knowledge base.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "qmd_query": {
        const query = (args as { query: string; limit?: number }).query;
        const limit = (args as { query: string; limit?: number }).limit || 5;
        return await handleHybridQuery(query, limit);
      }

      case "qmd_vsearch": {
        const query = (args as { query: string; limit?: number }).query;
        const limit = (args as { query: string; limit?: number }).limit || 5;
        return await handleVectorSearch(query, limit);
      }

      case "qmd_refresh_index": {
        const force = (args as { force?: boolean }).force || false;
        return await handleRefreshIndex(force);
      }

      case "qmd_get": {
        const path = (args as { path: string }).path;
        return await handleGetFile(path);
      }

      case "qmd_list": {
        return await handleListFiles();
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  });

  return server;
}

// Tool implementations
async function handleHybridQuery(query: string, limit: number) {
  try {
    const results = await hybridSearch(query, limit);
    const formatted = formatSearchResults(results);

    return {
      content: [
        {
          type: "text",
          text:
            results.length > 0
              ? `Found ${results.length} results for "${query}":\n\n${formatted}`
              : `No results found for query: "${query}"`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error searching: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleVectorSearch(query: string, limit: number) {
  try {
    if (!isEmbeddingsEnabled()) {
      return {
        content: [
          {
            type: "text",
            text: "Vector search unavailable: OPENROUTER_API_KEY not configured. Use qmd_query for keyword search.",
          },
        ],
        isError: true,
      };
    }

    const results = await vectorSearch(query, limit);
    const formatted = formatSearchResults(results);

    return {
      content: [
        {
          type: "text",
          text:
            results.length > 0
              ? `Found ${results.length} semantically similar results for "${query}":\n\n${formatted}`
              : `No results found for query: "${query}"`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error in vector search: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleRefreshIndex(force: boolean) {
  try {
    const result = await runIngestion(force);

    const status = [
      `Indexing complete:`,
      `- Added: ${result.added} documents`,
      `- Updated: ${result.updated} documents`,
      `- Deleted: ${result.deleted} documents`,
      `- Total chunks: ${result.totalChunks}`,
      `- Embeddings: ${isEmbeddingsEnabled() ? `enabled (${getModelName()})` : "disabled"}`,
    ];

    if (result.errors.length > 0) {
      status.push(`- Errors: ${result.errors.length}`);
    }

    return {
      content: [
        {
          type: "text",
          text: status.join("\n"),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error indexing: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleGetFile(path: string) {
  try {
    const fullPath = `${KB_PATH}/${path}`;
    const file = Bun.file(fullPath);

    if (!(await file.exists())) {
      return {
        content: [{ type: "text", text: `File not found: ${path}` }],
        isError: true,
      };
    }

    const content = await file.text();
    return {
      content: [
        {
          type: "text",
          text: `# ${path}\n\n${content}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function handleListFiles() {
  try {
    const docs = getAllDocuments();

    if (docs.length === 0) {
      // Fall back to scanning KB folder
      const files: string[] = [];
      const glob = new Bun.Glob("**/*.md");
      for await (const path of glob.scan({ cwd: KB_PATH, absolute: false })) {
        files.push(path);
      }

      if (files.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No markdown files found in ${KB_PATH}. Run qmd_refresh_index to index files.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Found ${files.length} files (not yet indexed):\n\n${files.map((p) => `- ${p}`).join("\n")}\n\nRun qmd_refresh_index to index these files.`,
          },
        ],
      };
    }

    const stats = getStats();
    return {
      content: [
        {
          type: "text",
          text: `Indexed ${docs.length} files (${stats.chunks} chunks):\n\n${docs.map((d) => `- ${d.path}`).join("\n")}\n\nDatabase: ${DB_PATH}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error listing files: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

// Main entry points
async function startStdioServer() {
  console.error("Starting MCP server in STDIO mode...");
  console.error(`Knowledge base: ${KB_PATH}`);
  console.error(`Database: ${DB_PATH}`);
  console.error(
    `Embeddings: ${isEmbeddingsEnabled() ? `enabled (${getModelName()})` : "disabled - set OPENROUTER_API_KEY"}`
  );

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP server connected via STDIO");
}

async function startHttpServer(port: number) {
  console.error(`Starting MCP server in HTTP/SSE mode on port ${port}...`);
  console.error(`Knowledge base: ${KB_PATH}`);
  console.error(`Database: ${DB_PATH}`);

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        const stats = getStats();
        return new Response(
          JSON.stringify({
            status: "ok",
            mode: "http",
            documents: stats.documents,
            chunks: stats.chunks,
            embeddings: isEmbeddingsEnabled(),
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response(
        "QMD MCP Server - Use STDIO mode for full functionality",
        { status: 200 }
      );
    },
  });

  console.error(`HTTP server listening on http://localhost:${server.port}`);
}

async function runIngestionCommand() {
  console.error("Running ingestion pipeline...");
  console.error(`Knowledge base: ${KB_PATH}`);
  console.error(`Database: ${DB_PATH}`);
  console.error(
    `Embeddings: ${isEmbeddingsEnabled() ? `enabled (${getModelName()})` : "disabled - set OPENROUTER_API_KEY"}`
  );

  const result = await runIngestion(true);

  console.error(`\nIngestion complete:`);
  console.error(`  Added: ${result.added}`);
  console.error(`  Updated: ${result.updated}`);
  console.error(`  Deleted: ${result.deleted}`);
  console.error(`  Total chunks: ${result.totalChunks}`);

  if (result.errors.length > 0) {
    console.error(`  Errors: ${result.errors.length}`);
    result.errors.forEach((e) => console.error(`    - ${e}`));
  }
}

async function main() {
  console.error(`QMD starting: mode=${command}, transport=${values.transport}`);

  switch (command) {
    case "mcp":
      if (values.transport === "http") {
        await startHttpServer(Number(values.port));
      } else {
        await startStdioServer();
      }
      break;
    case "ingest":
      await runIngestionCommand();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
