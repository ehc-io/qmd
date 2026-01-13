#!/bin/bash
set -e

# QMD MCP Setup Script
# This script cleans up old containers/volumes and configures QMD for Claude Code

echo "================================"
echo "QMD MCP Setup & Cleanup Script"
echo "================================"
echo ""

# Configuration
NOTES_PATH="/Users/eduk/Library/CloudStorage/GoogleDrive-eduardo@ehc.io/My Drive/Second-Brain/Captured-Notes"
VOLUME_NAME="qmd-cache"
IMAGE_NAME="qmd:latest"

# Load API key from .env
if [ -f .env ]; then
    source .env
    if [ -z "$OPENROUTER_API_KEY" ]; then
        echo "ERROR: OPENROUTER_API_KEY not found in .env file"
        exit 1
    fi
else
    echo "ERROR: .env file not found"
    exit 1
fi

echo "Step 1: Cleaning up existing QMD containers..."
CONTAINERS=$(docker ps -a --filter ancestor=$IMAGE_NAME -q)
if [ -n "$CONTAINERS" ]; then
    echo "  Found containers to remove: $CONTAINERS"
    docker stop $CONTAINERS 2>/dev/null || true
    docker rm $CONTAINERS 2>/dev/null || true
    echo "  ✓ Removed old containers"
else
    echo "  ✓ No containers to remove"
fi

echo ""
echo "Step 2: Cleaning up old volumes..."
# Remove both possible volume names
docker volume rm qmd_qmd-cache 2>/dev/null && echo "  ✓ Removed qmd_qmd-cache" || echo "  - qmd_qmd-cache not found"
docker volume rm qmd-cache 2>/dev/null && echo "  ✓ Removed qmd-cache" || echo "  - qmd-cache already removed"

# Recreate the volume
docker volume create $VOLUME_NAME
echo "  ✓ Created fresh volume: $VOLUME_NAME"

echo ""
echo "Step 3: Updating ~/.claude.json MCP configuration..."

# Create a temporary file with the QMD config
# Note: API key must be in args, not env section, for Docker to receive it
cat > /tmp/qmd-mcp-config.json << EOF
{
  "type": "stdio",
  "command": "docker",
  "args": [
    "run",
    "-i",
    "--rm",
    "-e",
    "OPENROUTER_API_KEY=$OPENROUTER_API_KEY",
    "-v",
    "$NOTES_PATH:/app/kb:ro",
    "-v",
    "$VOLUME_NAME:/root/.cache/qmd",
    "$IMAGE_NAME",
    "mcp"
  ]
}
EOF

# Update the claude.json file
if [ -f ~/.claude.json ]; then
    # Backup the original
    cp ~/.claude.json ~/.claude.json.backup
    echo "  ✓ Backed up ~/.claude.json to ~/.claude.json.backup"

    # Update or add the qmd MCP server config
    jq --slurpfile qmdconfig /tmp/qmd-mcp-config.json \
        '.mcpServers.qmd = $qmdconfig[0]' \
        ~/.claude.json > /tmp/claude.json.new

    mv /tmp/claude.json.new ~/.claude.json
    echo "  ✓ Updated ~/.claude.json with new QMD configuration"
else
    echo "  WARNING: ~/.claude.json not found, creating new one"
    cat > ~/.claude.json << EOF
{
  "mcpServers": {
    "qmd": $(cat /tmp/qmd-mcp-config.json)
  }
}
EOF
    echo "  ✓ Created ~/.claude.json with QMD configuration"
fi

# Cleanup temp file
rm /tmp/qmd-mcp-config.json

echo ""
echo "Step 4: Verifying configuration..."

# Test that the image exists
if ! docker image inspect $IMAGE_NAME > /dev/null 2>&1; then
    echo "  ERROR: Docker image '$IMAGE_NAME' not found"
    echo "  Please run: docker compose build"
    exit 1
fi
echo "  ✓ Docker image exists"

# Test that the notes path is accessible
if [ ! -d "$NOTES_PATH" ]; then
    echo "  ERROR: Notes path not found: $NOTES_PATH"
    exit 1
fi
echo "  ✓ Notes path accessible"

# Count markdown files
MD_COUNT=$(find "$NOTES_PATH" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
echo "  ✓ Found $MD_COUNT markdown files"

# Test MCP connection
echo ""
echo "Step 5: Testing MCP connection..."
TEST_OUTPUT=$(echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' | \
docker run -i --rm \
  -e OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  -v "$NOTES_PATH:/app/kb:ro" \
  -v $VOLUME_NAME:/root/.cache/qmd \
  $IMAGE_NAME mcp 2>&1)

if echo "$TEST_OUTPUT" | grep -q '"serverInfo"'; then
    echo "  ✓ MCP server responds correctly"
else
    echo "  ERROR: MCP server test failed"
    echo "  Output: $TEST_OUTPUT"
    exit 1
fi

# Check if embeddings are enabled
if echo "$TEST_OUTPUT" | grep -q "Embeddings: enabled"; then
    echo "  ✓ Embeddings enabled"
elif echo "$TEST_OUTPUT" | grep -q "Embeddings: disabled"; then
    echo "  WARNING: Embeddings disabled (check OPENROUTER_API_KEY)"
fi

echo ""
echo "================================"
echo "Setup Complete! ✨"
echo "================================"
echo ""
echo "Next steps:"
echo "1. Restart Claude Code to pick up the new configuration"
echo "2. In Claude Code, run: 'Please index my markdown files using qmd'"
echo "3. Then try searching: 'Search for information about X'"
echo ""
echo "Useful commands:"
echo "  - Check volume: docker run --rm -v $VOLUME_NAME:/cache $IMAGE_NAME ls -lh /cache/"
echo "  - View logs: docker logs <container-name>"
echo "  - Manual test: see qmd-manual.md"
echo ""
