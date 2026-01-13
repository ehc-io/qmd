# QMD - Query Markdown

A containerized MCP (Model Context Protocol) server that provides hybrid search over your local markdown knowledge base. Works with Claude Code, Claude Desktop, Cursor, and other MCP-compatible agents.

## Features

- **Dual-mode communication**: STDIO for local agents (Claude Code), HTTP/SSE for remote agents
- **Stateless STDIO architecture**: Temporary containers (`docker run --rm`) with persistent volume storage
- **Hybrid search**: Combines BM25 keyword search and vector semantic search with RRF fusion
- **Vector embeddings**: OpenRouter API for high-quality embeddings (text-embedding-3-small)
- **SQLite persistence**: FTS5 for keyword search, BLOB storage for vectors in named Docker volume
- **Zero-config deployment**: Automated setup script (`setup-qmd-mcp.sh`) configures everything
- **No long-running containers**: For STDIO mode, containers auto-remove after each tool call

## Deployment Modes

### STDIO Mode (Claude Code, MCP Agents)
- **Architecture**: Stateless temporary containers
- **Lifecycle**: Container created per tool call, auto-removed after execution
- **Persistence**: Named Docker volume (`qmd-cache`) stores SQLite DB + embeddings
- **Setup**: Run `./setup-qmd-mcp.sh` or manually configure `~/.claude.json`
- **Use case**: Local development with Claude Code or other MCP-compatible agents

### HTTP Mode (Remote Agents, Web Services)
- **Architecture**: Long-running persistent container
- **Lifecycle**: Managed via `docker compose up/down`
- **Persistence**: Host directory mount via `.env` configuration
- **Setup**: Configure `.env` and run `docker compose up -d`
- **Use case**: Remote agents, web services, or when you need HTTP/SSE transport

## Quick Start

### STDIO Mode (Recommended for Claude Code)

```bash
# 1. Build the Docker image
docker compose build

# 2. Run the automated setup script
./setup-qmd-mcp.sh

# 3. Restart Claude Code

# 4. Start using QMD!
# In Claude Code: "Please index my markdown files using qmd"
```

The setup script will:
- ✓ Clean up old containers/volumes
- ✓ Configure `~/.claude.json` with correct MCP settings
- ✓ Verify Docker image and notes path
- ✓ Test embeddings are enabled

**See [Claude Code Integration via STDIO](#claude-code-integration-via-stdio) for details.**

---

### HTTP Mode (For Remote Agents)

#### 1. Configure Environment

```bash
cd qmd

# Copy the example environment file
cp .env.example .env

# Edit .env and add your OpenRouter API key
# Get your key at: https://openrouter.ai/keys
```

**`.env` file contents:**

```bash
# Required: OpenRouter API key for embeddings
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Optional: Embedding model (default shown)
QMD_EMBEDDING_MODEL=openai/text-embedding-3-small

# Optional: Knowledge base path on host
QMD_KB_PATH=./kb

# Optional: Cache path for SQLite DB
QMD_CACHE_PATH=./data
```

#### 2. Build the Image

```bash
docker compose build
```

#### 3. Run HTTP Server

```bash
# Start the server
docker compose up -d

# Verify it's running
curl http://localhost:3000/health
# {"status":"ok","mode":"http"}

# View logs
docker compose logs -f qmd

# Stop
docker compose down
```

#### 4. Test STDIO Mode (Optional)

Test the MCP server directly before configuring Claude Code:

```bash
# Send a proper initialize message
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' | \
  docker run -i --rm \
  -e OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  -v /path/to/your/notes:/app/kb:ro \
  -v qmd-cache:/root/.cache/qmd \
  qmd:latest mcp
```

Expected output includes: `"serverInfo":{"name":"qmd","version":"0.1.0"}` and `Embeddings: enabled`

## Claude Code Integration via STDIO

QMD uses a **stateless container architecture** for MCP/STDIO mode. Each tool call launches a fresh temporary container that executes and auto-removes (`--rm`). Persistence is achieved through a named Docker volume.

### Deployment Architecture

```
┌─────────────────────────────────────────────────┐
│ Claude Code                                     │
│   ↓ (launches on each MCP tool call)           │
│ docker run -i --rm ...                          │
│   ↓                                             │
│ ┌─────────────────────────────────────────┐     │
│ │ Temporary QMD Container (auto-removes)  │     │
│ │                                         │     │
│ │  /app/kb ← Volume: Your markdown files  │     │
│ │  /root/.cache/qmd ← Volume: qmd-cache   │     │
│ │                                         │     │
│ │  [SQLite DB + Embeddings] → Persists!   │     │
│ └─────────────────────────────────────────┘     │
└─────────────────────────────────────────────────┘
```

**Key Components:**

1. **Temporary Containers**: Each MCP tool call = new container with `--rm` flag (auto-cleanup)
2. **Named Volume (`qmd-cache`)**: Persists SQLite database and embeddings across all container runs
3. **Read-Only Mount**: Your markdown files mounted at `/app/kb:ro` (read-only)
4. **Stateless Design**: No long-running containers, all state in the persistent volume

### Setup with Automated Script

Use the provided setup script for automatic configuration:

```bash
./setup-qmd-mcp.sh
```

This will:
- Clean up old containers and volumes
- Update `~/.claude.json` with correct MCP configuration
- Verify Docker image and notes path
- Test embeddings are enabled

**After running, restart Claude Code to load the new configuration.**

### Manual Configuration

Edit `~/.claude.json` and add the QMD MCP server:

```json
{
  "mcpServers": {
    "qmd": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "OPENROUTER_API_KEY=sk-or-v1-your-key-here",
        "-v",
        "/path/to/your/markdown/notes:/app/kb:ro",
        "-v",
        "qmd-cache:/root/.cache/qmd",
        "qmd:latest",
        "mcp"
      ]
    }
  }
}
```

**Important:**
- Replace `sk-or-v1-your-key-here` with your OpenRouter API key
- Replace `/path/to/your/markdown/notes` with your actual notes directory
- The API key must be in `args` via `-e` flag (not a separate `env` section)
- After editing, **restart Claude Code** for changes to take effect

### Volume Persistence

The `qmd-cache` named volume ensures your indexed data persists:

```bash
# Check volume exists
docker volume ls | grep qmd-cache

# Inspect volume contents
docker run --rm -v qmd-cache:/cache qmd:latest ls -lh /cache/

# Verify database
docker run --rm -v qmd-cache:/cache qmd:latest \
  sqlite3 /cache/qmd.db "SELECT COUNT(*) FROM documents;"
```

**Data persists across:**
- Container restarts
- Docker daemon restarts
- System reboots

**To start fresh:**
```bash
docker volume rm qmd-cache
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `qmd_query` | Hybrid search combining BM25 keyword + vector semantic search |
| `qmd_vsearch` | Vector-only semantic search for conceptual similarity |
| `qmd_refresh_index` | Trigger ingestion pipeline for new/modified files |
| `qmd_get` | Retrieve full content of a specific file |
| `qmd_list` | List all indexed files in the knowledge base |

## Usage Examples

### Ingestion: Index Your Knowledge Base

After adding or modifying markdown files, trigger the ingestion pipeline:

```
You: "I just added new documentation files. Please index them."

Claude: [Calls qmd_refresh_index tool]
```

**MCP Tool Call:**
```json
{
  "name": "qmd_refresh_index",
  "arguments": {
    "force": false
  }
}
```

**Response:**
```json
{
  "message": "Ingestion complete",
  "stats": {
    "new": 5,
    "updated": 2,
    "unchanged": 10,
    "deleted": 0,
    "totalChunks": 245
  }
}
```

**Force re-index all files:**
```
You: "Please re-index everything from scratch"

Claude: [Calls qmd_refresh_index with force=true]
```

### Hybrid Search: Find Relevant Content

Combines keyword matching (BM25) with semantic similarity (vectors) using RRF fusion:

```
You: "Search for information about API authentication"

Claude: [Calls qmd_query tool]
```

**MCP Tool Call:**
```json
{
  "name": "qmd_query",
  "arguments": {
    "query": "API authentication OAuth JWT tokens",
    "limit": 5
  }
}
```

**Response:**
```json
{
  "results": [
    {
      "path": "docs/security/authentication.md",
      "score": 0.89,
      "excerpt": "## Authentication Methods\n\nOur API supports multiple authentication methods:\n- OAuth 2.0 with PKCE\n- JWT bearer tokens\n- API keys for server-to-server..."
    },
    {
      "path": "docs/api/endpoints.md",
      "score": 0.72,
      "excerpt": "### Authorization Header\n\nAll API requests require authentication via the Authorization header..."
    }
  ]
}
```

### Semantic Search: Conceptual Similarity

Use vector-only search when looking for conceptually related content:

```
You: "Find documents about handling errors gracefully"

Claude: [Calls qmd_vsearch tool]
```

**MCP Tool Call:**
```json
{
  "name": "qmd_vsearch",
  "arguments": {
    "query": "graceful error handling recovery patterns",
    "limit": 5
  }
}
```

**Response:**
```json
{
  "results": [
    {
      "path": "docs/patterns/resilience.md",
      "score": 0.85,
      "excerpt": "## Circuit Breaker Pattern\n\nWhen a service fails repeatedly, the circuit breaker opens to prevent cascading failures..."
    },
    {
      "path": "docs/api/error-codes.md",
      "score": 0.78,
      "excerpt": "## Retry Strategies\n\nImplement exponential backoff with jitter for transient failures..."
    }
  ]
}
```

### Retrieve Full Document

Get the complete content of a specific file:

```
You: "Show me the full content of the authentication docs"

Claude: [Calls qmd_get tool]
```

**MCP Tool Call:**
```json
{
  "name": "qmd_get",
  "arguments": {
    "path": "docs/security/authentication.md"
  }
}
```

**Response:**
```json
{
  "path": "docs/security/authentication.md",
  "content": "# Authentication\n\n## Overview\n\nOur API uses OAuth 2.0..."
}
```

### List All Indexed Files

See what's in your knowledge base:

```
You: "What files are in my knowledge base?"

Claude: [Calls qmd_list tool]
```

**MCP Tool Call:**
```json
{
  "name": "qmd_list",
  "arguments": {}
}
```

**Response:**
```json
{
  "files": [
    "docs/api/endpoints.md",
    "docs/api/error-codes.md",
    "docs/security/authentication.md",
    "docs/patterns/resilience.md",
    "notes/meeting-2024-01-15.md"
  ],
  "total": 5
}
```

### Real-World Workflow Examples

**Example 1: Research a topic across your notes**
```
You: "What have I written about database performance optimization?"

Claude: [Calls qmd_query] → finds 3 relevant documents
Claude: [Calls qmd_get] → retrieves full content of most relevant
Claude: "Based on your notes, you've documented several optimization strategies..."
```

**Example 2: Cross-reference project documentation**
```
You: "How does our error handling compare between the API and the CLI?"

Claude: [Calls qmd_vsearch with "error handling patterns"]
Claude: "I found error handling docs for both. The API uses HTTP status codes
while the CLI uses exit codes. Both implement retry logic..."
```

**Example 3: Find related content by concept**
```
You: "Find anything related to making systems more reliable"

Claude: [Calls qmd_vsearch with "system reliability resilience"]
Claude: "I found documents on circuit breakers, retry strategies, health checks,
and your notes from the SRE book club..."
```

## Volume Mappings

### STDIO Mode (Claude Code)

| Container Path | Purpose | Type | Example |
|---------------|---------|------|---------|
| `/app/kb` | Your markdown files | Host directory (ro) | `/Users/you/Notes:/app/kb:ro` |
| `/root/.cache/qmd` | SQLite DB + embeddings | Named volume (rw) | `qmd-cache:/root/.cache/qmd` |

**Why named volume for cache?**
- Persists across all container runs
- Survives system reboots
- No filesystem permission issues
- Fast I/O performance

**Why read-only for markdown files?**
- Prevents accidental modifications
- Security best practice
- QMD only reads, never writes to `/app/kb`

### HTTP Mode (Docker Compose)

In HTTP mode, volumes are configured via `.env` file:

```bash
# .env file
QMD_KB_PATH=/path/to/notes     # Your markdown directory
QMD_CACHE_PATH=./data          # Host directory for SQLite DB
```

### Mounting Multiple Folders (Advanced)

You can mount multiple directories into `/app/kb`:

```bash
# In ~/.claude.json, add multiple -v flags:
"args": [
  "run", "-i", "--rm",
  "-e", "OPENROUTER_API_KEY=...",
  "-v", "~/Notes:/app/kb/notes:ro",
  "-v", "~/Projects/docs:/app/kb/projects:ro",
  "-v", "~/Research:/app/kb/research:ro",
  "-v", "qmd-cache:/root/.cache/qmd",
  "qmd:latest", "mcp"
]
```

All directories will be indexed and searchable together.

## Instructing Agents to Use QMD via STDIO

### For Claude Code

Once configured in `~/.claude.json`, simply ask Claude naturally:

```
"Please index my markdown files using qmd"
"Search my notes for information about X"
"Find documents related to Y"
"List all files in my knowledge base"
```

Claude Code will automatically invoke the appropriate MCP tools.

### For Other MCP-Compatible Agents

Any agent supporting MCP over STDIO can use QMD. Configure the agent's MCP settings with:

**Command:** `docker`

**Args:**
```json
[
  "run", "-i", "--rm",
  "-e", "OPENROUTER_API_KEY=your-api-key",
  "-v", "/path/to/notes:/app/kb:ro",
  "-v", "qmd-cache:/root/.cache/qmd",
  "qmd:latest", "mcp"
]
```

**Available Tools:**
- `qmd_list` - List indexed files
- `qmd_refresh_index` - Index/re-index files
- `qmd_query` - Hybrid search (BM25 + vector)
- `qmd_vsearch` - Vector-only semantic search
- `qmd_get` - Retrieve full document content

### Persistence Across Sessions

The `qmd-cache` named volume ensures:
- Indexed documents persist between agent sessions
- Embeddings are generated once, reused forever
- No re-indexing needed unless files change
- Fast search (no cold start)

**First run:**
1. Agent calls `qmd_refresh_index` → generates embeddings (~30 sec for 100 docs)
2. Agent calls `qmd_query` → instant search results

**Subsequent runs:**
1. Agent calls `qmd_query` → instant results (no re-indexing)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | (required) | OpenRouter API key for embeddings |
| `QMD_EMBEDDING_MODEL` | `openai/text-embedding-3-small` | Embedding model to use |
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `QMD_PORT` | `3000` | HTTP server port |
| `QMD_KB_PATH` | `/app/kb` | Knowledge base path inside container |
| `QMD_CACHE_PATH` | `/root/.cache/qmd` | Cache directory for SQLite DB |
| `QMD_CHUNK_SIZE` | `500` | Tokens per chunk |
| `QMD_CHUNK_OVERLAP` | `50` | Overlap tokens between chunks |

## Docker Compose Configurations

### Production (HTTP Mode)

```bash
# Uses docker-compose.yml with .env file
docker compose up -d
```

### Development (Hot Reload)

```bash
# Combines both compose files
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### Custom Knowledge Base Path

```bash
# Override via environment or .env file
QMD_KB_PATH=/path/to/your/notes docker compose up -d
```

## Development

### Local Development (without Docker)

```bash
# Install dependencies
bun install

# Set environment variables
export OPENROUTER_API_KEY="sk-or-v1-your-key"

# Run with hot reload
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

### Project Structure

```
qmd/
├── .env                    # Environment variables (git-ignored)
├── .env.example            # Example environment file
├── docker-compose.yml      # Production config
├── docker-compose.dev.yml  # Development overrides
├── Dockerfile              # Multi-stage build
├── entrypoint.sh           # Dual-mode entrypoint
├── package.json
├── tsconfig.json
├── src/
│   ├── qmd.ts              # MCP server entry point
│   ├── db.ts               # SQLite schema & queries
│   ├── embeddings.ts       # OpenRouter API client
│   ├── ingest.ts           # Chunking & indexing pipeline
│   └── search.ts           # Hybrid search with RRF
└── kb/                     # Default knowledge base mount
```

## Troubleshooting

### STDIO Mode (Claude Code)

**QMD tools not showing up in Claude Code**

1. Check MCP configuration exists:
   ```bash
   cat ~/.claude.json | jq '.mcpServers.qmd'
   ```

2. Verify configuration has correct structure (type, command, args)

3. Restart Claude Code after any config changes

**Embeddings not enabled**

1. Check API key is in args (not env):
   ```bash
   cat ~/.claude.json | jq '.mcpServers.qmd.args' | grep OPENROUTER_API_KEY
   ```

2. Verify API key is valid:
   ```bash
   curl https://openrouter.ai/api/v1/models \
     -H "Authorization: Bearer sk-or-v1-your-key"
   ```

3. Test container directly:
   ```bash
   docker run --rm -e OPENROUTER_API_KEY="your-key" qmd:latest env | grep OPENROUTER
   ```

**No files found / Empty knowledge base**

1. Check notes path is correct in `~/.claude.json`

2. Verify path is accessible:
   ```bash
   ls -la "/path/to/your/notes"
   ```

3. Check files are visible in container:
   ```bash
   docker run --rm -v "/path/to/notes:/app/kb:ro" qmd:latest ls -la /app/kb/
   ```

**Index not persisting**

1. Verify named volume exists:
   ```bash
   docker volume ls | grep qmd-cache
   ```

2. Check database exists in volume:
   ```bash
   docker run --rm -v qmd-cache:/cache qmd:latest ls -lh /cache/
   ```

3. Verify data in database:
   ```bash
   docker run --rm -v qmd-cache:/cache qmd:latest \
     sqlite3 /cache/qmd.db "SELECT COUNT(*) FROM documents;"
   ```

**Containers left running**

This shouldn't happen with `--rm` flag, but check:

```bash
# Should be empty
docker ps --filter ancestor=qmd:latest

# Clean up if needed
docker ps -a --filter ancestor=qmd:latest -q | xargs docker rm -f
```

### HTTP Mode (Docker Compose)

**Container won't start**

```bash
# Check logs
docker compose logs qmd

# Verify image built
docker images | grep qmd

# Check .env file
cat .env
```

**Health check failing**

```bash
# Test endpoint
curl -v http://localhost:3000/health

# Check port availability
lsof -i :3000
```

### General Issues

**Docker image not found**

```bash
# Build the image
docker compose build

# Verify it exists
docker images | grep qmd
```

**Permission issues**

```bash
# Mount as read-only (STDIO mode always uses :ro)
-v ~/Knowledge_Base:/app/kb:ro

# For HTTP mode, check .env paths are accessible
ls -la "$QMD_KB_PATH"
```

## Architecture

### STDIO Mode (Claude Code)

```
┌─────────────────────────────────────────────────────────────┐
│                      Host Machine                           │
│                                                             │
│  ┌──────────────┐         ┌────────────────────────────┐   │
│  │ Claude Code  │         │   Docker Volume (Persist)  │   │
│  │              │         │                            │   │
│  │  MCP Client  │         │   qmd-cache:/root/.cache   │   │
│  └──────┬───────┘         │   ├── qmd.db (SQLite)      │   │
│         │                 │   └── embeddings (BLOBs)   │   │
│         │ Each tool call  └────────────────────────────┘   │
│         ▼                          ▲                        │
│  docker run -i --rm                │                        │
│         │                          │ Persists               │
│         ▼                          │                        │
│  ┌─────────────────────────────────┴──────────────────┐    │
│  │      Temporary Container (auto-removes)            │    │
│  │                                                     │    │
│  │  ┌──────────┐   ┌──────────┐   ┌──────────────┐   │    │
│  │  │   MCP    │──►│  Hybrid  │──►│   SQLite     │   │    │
│  │  │  Server  │   │  Search  │   │  FTS5+Vector │   │    │
│  │  └──────────┘   └──────────┘   └──────────────┘   │    │
│  │       │              │                              │    │
│  │       │         ┌────▼─────┐                        │    │
│  │       │         │ Ingest   │                        │    │
│  │       │         │ Pipeline │                        │    │
│  │       │         └────┬─────┘                        │    │
│  │       │              │                              │    │
│  │  Volumes mounted:    │                              │    │
│  │  • /app/kb (ro) ─────┘                              │    │
│  │  • /root/.cache/qmd (rw, persistent)                │    │
│  └─────────────────────────────────────────────────────┘    │
│         │                                                   │
│         │ Calls OpenRouter API                             │
│         ▼                                                   │
│  ┌──────────────────┐                                      │
│  │  OpenRouter API  │                                      │
│  │  (Embeddings)    │                                      │
│  └──────────────────┘                                      │
│                                                             │
│  ┌─────────────────────┐◄── Mounted read-only             │
│  │  Your Markdown      │                                   │
│  │  Notes Directory    │                                   │
│  └─────────────────────┘                                   │
└─────────────────────────────────────────────────────────────┘

Lifecycle:
1. Claude Code launches: docker run -i --rm -v ... qmd:latest mcp
2. Container starts, loads MCP server, connects via STDIO
3. Tool executes (search/index/etc), writes to qmd-cache volume
4. Container exits and auto-removes (--rm flag)
5. Next tool call repeats 1-4, data persists in qmd-cache
```

### HTTP Mode (Remote Agents)

For remote agents or when you need a persistent HTTP endpoint:

```bash
# Start persistent HTTP server
docker compose up -d

# Container runs continuously, listens on port 3000
# Data stored in host directory mapped via .env
```

**HTTP mode differences:**
- Long-running container (no `--rm`)
- HTTP/SSE transport instead of STDIO
- Managed via docker-compose
- Volume mounts from `.env` configuration

## Cost Estimate (OpenRouter)

| Item | Cost |
|------|------|
| `text-embedding-3-small` | ~$0.02 per 1M tokens |
| Initial indexing (100 docs) | < $0.01 |
| Per-query cost | ~$0.000002 (negligible) |

## License

MIT
