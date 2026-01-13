#!/bin/bash
set -e

MODE="${1:-mcp}"
TRANSPORT="${MCP_TRANSPORT:-stdio}"

case "$MODE" in
  mcp)
    if [ "$TRANSPORT" = "http" ]; then
      exec bun run dist/qmd.js mcp --transport http --port ${QMD_PORT:-3000}
    else
      exec bun run dist/qmd.js mcp
    fi
    ;;
  ingest)
    shift
    exec bun run dist/qmd.js ingest "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
