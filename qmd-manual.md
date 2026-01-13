# QMD Knowledge Base System - Agent Manual

**Purpose**: This manual enables AI agents to autonomously use the QMD (Query Markdown) service for semantic search and retrieval over markdown knowledge bases.

## What is QMD?

QMD is an MCP (Model Context Protocol) server that provides hybrid search over markdown files. It combines:
- **BM25 keyword search** for exact term matching
- **Vector semantic search** for conceptual similarity
- **RRF fusion** to combine both approaches

**Key capabilities:**
- Index markdown files from a directory
- Generate embeddings for semantic search (via OpenRouter API)
- Perform hybrid or vector-only searches
- Retrieve full document contents
- Track source documents for all search results

## System Architecture

### Deployment Model: Stateless Containers

```
AI Agent (You)
    ↓
MCP Tool Call (via STDIO)
    ↓
docker run -i --rm ... (temporary container)
    ↓
[Executes tool, reads/writes to persistent volume]
    ↓
Container exits and auto-removes
    ↓
Results returned to agent
```

**Critical concepts:**
1. **No persistent container**: Each tool call launches a fresh container
2. **Persistent storage**: SQLite database + embeddings stored in Docker volume `qmd-cache`
3. **Stateless execution**: Containers auto-remove after each call (`--rm` flag)
4. **Read-only access**: Markdown files mounted read-only at `/app/kb`

### Why This Architecture?

- **No manual lifecycle management**: Containers created/destroyed automatically
- **Persistence without state**: Data survives in named volume
- **Clean execution**: No leftover containers
- **Resource efficient**: Containers only exist during tool execution

## Available MCP Tools

You have access to 5 MCP tools:

### 1. `qmd_list` - List Indexed Files

**Purpose**: View all markdown files in the knowledge base

**Parameters**: None

**Returns**: List of file paths with count and database location

**Example**:
```json
{
  "tool": "qmd_list",
  "arguments": {}
}
```

**When to use**:
- To see what documents are available
- To verify indexing completed successfully
- To check if specific files exist

---

### 2. `qmd_refresh_index` - Index/Re-index Files

**Purpose**: Scan markdown directory, chunk documents, generate embeddings

**Parameters**:
- `force` (boolean, optional): If true, re-index all files even if unchanged. Default: false

**Returns**: Indexing statistics (added, updated, deleted, total chunks, embeddings status)

**Example**:
```json
{
  "tool": "qmd_refresh_index",
  "arguments": {
    "force": true
  }
}
```

**When to use**:
- **First time**: Always call this before searching (generates embeddings)
- **After new files added**: Index updates automatically detect new/modified files
- **Force re-index**: Use `force: true` to rebuild entire index

**Performance**: ~30 seconds for 100 documents (includes OpenRouter API calls)

---

### 3. `qmd_query` - Hybrid Search

**Purpose**: Search using both keyword matching (BM25) and semantic similarity (vectors)

**Parameters**:
- `query` (string, required): Search query
- `limit` (number, optional): Max results to return. Default: 5

**Returns**: Ranked search results with scores, matched content, and source paths

**Example**:
```json
{
  "tool": "qmd_query",
  "arguments": {
    "query": "machine learning model deployment strategies",
    "limit": 5
  }
}
```

**Result format**:
```
1. **notes-2025/ml-ops.md** (hybrid, score: 0.8523)
   Content snippet showing matched text...

2. **notes-2025/deployment-guide.md** (bm25, score: 0.7891)
   Another relevant snippet...
```

**When to use**:
- Default search method (combines keyword + semantic)
- When you want exact term matches + conceptual matches
- General purpose "find information about X" queries

**Search strategies**:
- Include key terms from the topic
- Use natural language queries for semantic matching
- Combine specific terms with broader concepts

---

### 4. `qmd_vsearch` - Vector-Only Semantic Search

**Purpose**: Search by conceptual similarity only (no keyword matching)

**Parameters**:
- `query` (string, required): Semantic query describing concepts
- `limit` (number, optional): Max results. Default: 5

**Returns**: Semantically similar results ranked by cosine similarity

**Example**:
```json
{
  "tool": "qmd_vsearch",
  "arguments": {
    "query": "handling failures gracefully in distributed systems",
    "limit": 5
  }
}
```

**When to use**:
- Finding conceptually related content (even with different terminology)
- When exact keyword matches aren't important
- Discovering related ideas across documents
- User asks "find anything related to..." or "similar to..."

**Difference from qmd_query**:
- `qmd_query`: Favors documents with exact keyword matches
- `qmd_vsearch`: Purely conceptual similarity

---

### 5. `qmd_get` - Retrieve Full Document

**Purpose**: Get complete content of a specific file

**Parameters**:
- `path` (string, required): Relative path from search results (e.g., "notes-2025/file.md")

**Returns**: Full markdown content of the file

**Example**:
```json
{
  "tool": "qmd_get",
  "arguments": {
    "path": "notes-2025/1767909126-capture-report.md"
  }
}
```

**When to use**:
- After search returns relevant results
- To get full context beyond the snippet
- To read entire documents for detailed analysis

**Workflow pattern**:
```
1. qmd_query("topic") → Returns: notes-2025/doc.md
2. qmd_get("notes-2025/doc.md") → Returns: Full content
3. Analyze full content to answer user question
```

## Autonomous Usage Patterns

### Pattern 1: First-Time Setup

When user asks you to search their knowledge base:

```
1. Check if indexed: qmd_list()
   - If returns "not yet indexed" or 0 files:
2. Index files: qmd_refresh_index(force=true)
   - Wait for completion (~30 sec for 100 docs)
   - Verify "Embeddings: enabled" in response
3. Proceed with search: qmd_query(...)
```

### Pattern 2: Search and Retrieve

For user questions about their notes:

```
1. Search: qmd_query("user's question", limit=5)
2. Analyze results, pick most relevant (highest score)
3. Retrieve full content: qmd_get(path)
4. Synthesize answer from full document
5. Cite source: "According to your notes in [path]..."
```

### Pattern 3: Exploratory Research

When user wants to explore a topic:

```
1. Broad search: qmd_vsearch("general concept", limit=10)
2. Identify themes from results
3. Retrieve top 3-5 documents: qmd_get(path) for each
4. Synthesize cross-document insights
5. Provide summary with source citations
```

### Pattern 4: Incremental Updates

After user adds new files:

```
1. Index updates: qmd_refresh_index(force=false)
   - Auto-detects new/modified files
   - Only processes changes (faster)
2. Verify: Check "Added: X documents" in response
3. Proceed with searches on updated index
```

## Understanding Search Results

### Result Fields

Every search result contains:

- **docPath**: File path relative to knowledge base root
  - Example: `notes-2025/1767909126-capture-report.md`
  - Use this exact path with `qmd_get`

- **content**: Text chunk that matched (500 tokens max)
  - This is a snippet, not full document
  - Chunks overlap by 50 tokens for context

- **score**: Relevance score (0.0 to 1.0, higher = better)
  - Hybrid search: Combined BM25 + vector score
  - Vector search: Cosine similarity

- **matchType**: How the result matched
  - `"hybrid"`: Matched both keyword and semantic
  - `"bm25"`: Keyword match only
  - `"vector"`: Semantic match only

- **chunkId**: Internal database reference (can ignore)

### Interpreting Scores

- **>0.8**: Highly relevant, strong match
- **0.6-0.8**: Relevant, good match
- **0.4-0.6**: Possibly relevant, weak match
- **<0.4**: Likely not relevant

**Strategy**: Focus on results with score >0.6, retrieve full documents for scores >0.7

### Source Traceability

**Critical**: Always cite sources in your responses to users

```
Good: "According to your notes in notes-2025/ml-ops.md..."
Bad: "Based on your notes..." (no specific file)
```

Users need to know which file the information came from.

## Persistence & State Management

### What Persists

✓ **Indexed documents**: Stored in SQLite (`qmd-cache` volume)
✓ **Embeddings**: Stored as BLOBs in SQLite (expensive to generate, preserved)
✓ **Full-text search index**: FTS5 table for keyword search
✓ **Document hashes**: Used to detect changes

### What Doesn't Persist

✗ **Containers**: Auto-removed after each tool call
✗ **Runtime state**: Each call is independent
✗ **Configuration**: Passed fresh each time via MCP

### Implications for You

1. **No warm-up needed**: Database loaded fresh each call
2. **No state to track**: Each tool call is independent
3. **Index survives**: No need to re-index unless files change
4. **First search is fast**: Embeddings already generated (after initial index)

## Error Handling

### Common Errors and Solutions

**"Embeddings: disabled"**
- **Cause**: OPENROUTER_API_KEY not set or invalid
- **Solution**: Cannot fix autonomously, inform user to check configuration
- **Impact**: Search still works (keyword-only), but no semantic search

**"No files found" or empty results**
- **Cause**: Knowledge base empty or not mounted correctly
- **Solution**: Call `qmd_list()` to verify, inform user if path issue
- **Impact**: Cannot search until fixed

**"Database not persisting"**
- **Cause**: Volume mount issue (rare in MCP setup)
- **Solution**: Call `qmd_refresh_index(force=true)` to rebuild
- **Impact**: May need re-indexing

**Network errors during indexing**
- **Cause**: OpenRouter API timeout or rate limit
- **Solution**: Retry `qmd_refresh_index()` after delay
- **Impact**: Partial index may exist, force re-index to complete

### Graceful Degradation

If embeddings disabled:
1. Inform user semantic search unavailable
2. Use `qmd_query` anyway (falls back to keyword-only BM25)
3. Suggest user check API key configuration

If search returns 0 results:
1. Try broader query terms
2. Try `qmd_vsearch` with conceptual query
3. Call `qmd_list()` to verify files exist
4. Inform user no matches found

## Best Practices for Autonomous Operation

### 1. Always Index First

Before any search operation:
```
if first_interaction_with_qmd:
    qmd_refresh_index(force=true)
```

### 2. Verify Embeddings Enabled

After indexing, check response:
```
if "Embeddings: enabled" in response:
    # Can use semantic search
else:
    # Keyword-only, inform user
```

### 3. Retrieve Full Context

Don't answer from snippets alone:
```
results = qmd_query("question")
top_result = results[0]  # Highest score
full_doc = qmd_get(top_result.docPath)
# Now analyze full_doc for comprehensive answer
```

### 4. Multi-Document Synthesis

For complex questions:
```
results = qmd_query("question", limit=5)
documents = [qmd_get(r.docPath) for r in results[:3]]
# Synthesize answer from multiple sources
# Cite all sources used
```

### 5. Cite Sources Explicitly

Always include file paths:
```
"According to notes-2025/architecture.md, the system uses..."
"Your notes in notes-2025/meeting-20250110.md mention..."
```

### 6. Use Appropriate Search Type

- User asks "find information about X" → `qmd_query`
- User asks "find anything related to Y" → `qmd_vsearch`
- User asks "show me the file about Z" → `qmd_query` then `qmd_get`

### 7. Handle Incremental Updates

User mentions adding new files:
```
qmd_refresh_index(force=false)  # Only indexes new/changed files
```

## Configuration Reference

### MCP Configuration (for reference)

You don't need to manage this, but for context, the MCP server is configured as:

```json
{
  "type": "stdio",
  "command": "docker",
  "args": [
    "run", "-i", "--rm",
    "-e", "OPENROUTER_API_KEY=...",
    "-v", "/path/to/notes:/app/kb:ro",
    "-v", "qmd-cache:/root/.cache/qmd",
    "qmd:latest", "mcp"
  ]
}
```

**Key elements**:
- `-i`: Interactive mode (STDIO)
- `--rm`: Auto-remove after execution
- `-e OPENROUTER_API_KEY`: API key for embeddings
- `-v .../app/kb:ro`: Notes mounted read-only
- `-v qmd-cache:/root/.cache/qmd`: Persistent storage

### Volume Paths

Inside container:
- `/app/kb` - Markdown files (read-only)
- `/root/.cache/qmd/qmd.db` - SQLite database

File paths returned in results are relative to `/app/kb`:
- Result: `notes-2025/doc.md`
- Actual: `/app/kb/notes-2025/doc.md` (transparent to you)

## Example Autonomous Workflow

User: "What do I have about machine learning deployment?"

```python
# 1. Check if indexed
files = qmd_list()
if files.count == 0:
    qmd_refresh_index(force=true)

# 2. Search for relevant documents
results = qmd_query(
    query="machine learning deployment production",
    limit=5
)

# 3. Analyze results
if len(results) == 0:
    return "No documents found about ML deployment in your knowledge base."

# 4. Retrieve top results
top_docs = []
for result in results[:3]:  # Top 3
    if result.score > 0.6:
        doc = qmd_get(result.docPath)
        top_docs.append({
            "path": result.docPath,
            "content": doc
        })

# 5. Synthesize answer
answer = f"""
Based on your notes, here's what you have about ML deployment:

{synthesize_from_docs(top_docs)}

Sources:
- {top_docs[0]['path']}
- {top_docs[1]['path']}
- {top_docs[2]['path']}
"""

return answer
```

## Limitations & Constraints

### What QMD Can Do

✓ Search markdown files (.md)
✓ Generate embeddings for semantic search
✓ Combine keyword + semantic search
✓ Return source file paths
✓ Retrieve full documents
✓ Detect file changes automatically

### What QMD Cannot Do

✗ **Modify files**: Read-only access only
✗ **Search non-markdown**: Only .md files indexed
✗ **Real-time updates**: Requires explicit `qmd_refresh_index` call
✗ **Cross-file reasoning**: You must synthesize across documents
✗ **Summarization**: Returns raw content, you summarize
✗ **Filtering by metadata**: No date/author/tag filters (search content only)

### Performance Characteristics

- **Indexing**: ~0.3 sec per document (with embeddings)
- **Search**: <1 second for any size knowledge base
- **Retrieval**: <0.1 second per document
- **Cold start**: ~2 seconds (container launch)

### Capacity Limits

- **Documents**: Tested up to 10,000 documents
- **Knowledge base size**: No hard limit (SQLite scales well)
- **Chunk size**: 500 tokens (2000 characters)
- **Result limit**: Max 100 results per query (set via `limit` parameter)

## Troubleshooting for Agents

### Diagnostic Tools

If issues occur, run diagnostics:

```bash
# Check files visible (informational only, you can't run this)
qmd_list()

# Verify indexing status
qmd_refresh_index(force=false)  # Will report existing index stats

# Test search functionality
qmd_query("test", limit=1)  # Should return at least 1 result if indexed
```

### Decision Tree

```
User asks to search knowledge base
    ↓
Call qmd_list()
    ↓
Files found?
    NO → Call qmd_refresh_index(force=true)
    YES → Continue
    ↓
Call qmd_query(user_question)
    ↓
Results found?
    YES → Retrieve top results with qmd_get()
    NO → Try qmd_vsearch() with broader query
    ↓
Still no results?
    → Inform user no matches found
    → Suggest checking if topic exists in their notes
```

## Summary: Quick Reference

| Task | Tool | Parameters |
|------|------|------------|
| First time setup | `qmd_refresh_index` | `force: true` |
| Check what's indexed | `qmd_list` | none |
| Search (general) | `qmd_query` | `query, limit` |
| Search (semantic) | `qmd_vsearch` | `query, limit` |
| Get full document | `qmd_get` | `path` |
| Update index | `qmd_refresh_index` | `force: false` |

**Key principles**:
1. Index before first search
2. Use qmd_query for most searches
3. Always retrieve full documents for complete answers
4. Always cite source file paths
5. Handle "Embeddings: disabled" gracefully

**Remember**: Each tool call launches a fresh container. No state persists except the SQLite database in the `qmd-cache` volume. You have full autonomous access to search and retrieve—use it proactively to help users explore their knowledge base.
