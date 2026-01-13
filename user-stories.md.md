Here is the architecture and user stories tailored to your specific setup: using **Claude Code** with a **Centralized Knowledge Folder** (monorepo style) and requiring both **Search** and an **Ingestion/Embedding trigger** via MCP.

---

### 1. The Architecture

Since QMD runs locally, the "Pipeline" is integrated directly into the MCP server. Instead of an external API, the Agent calls an MCP Tool to trigger the indexing/embedding process on your machine.

```mermaid
flowchart TD
    subgraph Local_Environment ["Your Local Machine"]
        
        %% The User Interface
        Agent[("🤖 Claude Code (CLI)"))]
        
        %% The File System
        subgraph FileSystem ["📂 Central Knowledge Folder"]
            DirRoot["/Knowledge_Base"]
            DirA["/Project_Alpha"]
            DirB["/Tech_Specs"]
            DirC["/Meeting_Logs"]
            
            DirRoot --> DirA & DirB & DirC
        end
        
        %% The QMD System
        subgraph QMD_System ["⚙️ QMD (MCP Server)"]
            Router["MCP Router"]
            
            %% Search Path
            SearchEngine["🔎 Search Engine"]
            Hybrid["Hybrid Fusion (RRF)"]
            Reranker["🧠 LLM Re-ranker"]
            
            %% Ingestion Path
            IngestProc["🔄 Ingestion Processor"]
            Chunker["📄 Chunker"]
            Embedder["Math(Vector Embedder)"]
            
            %% Data Stores
            SQLite[("🗄️ SQLite DB\n(FTS5 + Vectors)")]
        end
        
        %% Models
        Models["📦 Local GGUF Models\n(node-llama-cpp)"]
    end

    %% Connections
    Agent <-->|"MCP Protocol (stdio)"| Router
    
    %% Read Flow
    Router --"qmd_query"--> SearchEngine
    SearchEngine --> Hybrid
    Hybrid --> Reranker --> Agent
    Reranker -.-> Models
    
    %% Write/Ingest Flow (The Requested Endpoint)
    Router --"qmd_refresh_index"--> IngestProc
    IngestProc -->|"Scan"| FileSystem
    IngestProc --> Chunker --> Embedder --> SQLite
    Embedder -.-> Models
    
    %% DB Connections
    SearchEngine <--> SQLite
```

#### Key Architectural Components for Your Setup:
1.  **Central Folder Map:** You map your root `/Knowledge_Base` as a single QMD Collection (or multiple collections if distinct).
2.  **Ingestion Endpoint (Tool):** We expose a tool (e.g., `qmd_refresh_index`) to Claude. This allows Claude to say "I see you added new notes, let me index them for you."
3.  **Local Inference:** All embedding and reranking happens on your GPU/CPU via `node-llama-cpp`, ensuring no data leaves your structured folders.

---

### 2. User Stories

These stories are written from the perspective of you (the Developer) interacting with Claude Code, leveraging the specific architecture above.

#### Story 1: The "Autonomous Librarian" (Ingestion Pipeline)
**As a** developer who just dumped 50 new PDF-to-Markdown exports into my `Knowledge_Base/Research` subfolder,
**I want** to tell Claude "Update your knowledge base" via the chat,
**So that** the new files are parsed, chunked, and embedded immediately without me opening a separate terminal window to run CLI commands.

*   **The Interaction:**
    *   **User:** "Claude, I just added the new Q3 architecture specs to the research folder. Please index them."
    *   **Claude (Action):** Calls `qmd_refresh_index(collection="research")`.
    *   **System:** QMD scans the folder, detects diffs, generates embeddings for new files, and updates the SQLite index.
    *   **Claude (Response):** "I've indexed 50 new documents. I can now answer questions about the Q3 specs."

#### Story 2: The "Cross-Reference" Coder
**As a** coder working on a feature in `Project_Alpha` that depends on legacy logic from `Project_Beta` (stored in a different subfolder),
**I want** Claude to automatically search across the entire directory structure when it encounters an unknown function name,
**So that** it implements the interface correctly based on the definitions in the other project's documentation.

*   **The Interaction:**
    *   **User:** "Implement the `UserSync` adapter. Check the legacy docs for the required fields."
    *   **Claude (Action):** Calls `qmd_query(query="UserSync adapter required fields", collection="central_kb")`.
    *   **System:** Performs vector search to find conceptually similar docs + BM25 for exact field names, then re-ranks them.
    *   **Claude (Response):** "I found the requirements in `Legacy_Systems/Sync/specs.md`. Here is the implementation matching those constraints..."

#### Story 3: The "Hallucination Check"
**As a** user relying on Claude to summarize a structured meeting log from `Meeting_Logs/2024`,
**I want** Claude to retrieve the raw file content verbatim using the specific path it found during search,
**So that** I can trust the summary is based on the actual text and not a generative guess.

*   **The Interaction:**
    *   **User:** "What did we decide about the database migration last Tuesday?"
    *   **Claude (Action):** 
        1. Calls `qmd_search("database migration")` -> gets list of files.
        2. Identifies `Meeting_Logs/2024/2024-10-12.md`.
        3. Calls `qmd_get(file="Meeting_Logs/2024/2024-10-12.md")`.
    *   **System:** Returns the full markdown content.
    *   **Claude:** "According to the logs from Oct 12th, the decision was to postpone migration until Q2."

#### Story 4: The "Repo-Wide" Refactor
**As a** lead developer planning a refactor,
**I want** to ask Claude high-level questions like "How do we handle error logging across all our sub-projects?",
**So that** Claude aggregates patterns from `Project_A/docs`, `Project_B/docs`, and `Shared_Lib/docs` into a single answer.

*   **The Interaction:**
    *   **User:** "Summarize our error logging patterns."
    *   **Claude (Action):** Calls `qmd_vsearch(query="error logging patterns exception handling")` (Vector Search is crucial here as different folders might use different terminology).
    *   **System:** Returns top snippets from diverse subfolders based on semantic similarity.
    *   **Claude:** "I found 3 distinct patterns used across your projects: Winston in Project A, raw console logs in Project B..."

---

### 3. Proposed MCP Tool Definitions (For Implementation)

To support the specific "Ingestion Pipeline" requirement, you would ensure `src/mcp.ts` includes this tool definition in addition to the standard search tools:

**Tool:** `qmd_refresh_index`
*   **Description:** "Triggers the ingestion pipeline. Scans the central folder for new or modified markdown files, updates the FTS index, and generates vector embeddings. Use this when the user mentions adding new files."
*   **Arguments:** 
    *   `collection` (string, optional): The name of the specific sub-collection to update (e.g., "docs"), or "all" for the root.
    *   `force` (boolean, optional): If true, forces re-embedding of all files (slow).

**Tool:** `qmd_query` (Hybrid)
*   **Description:** "Search the knowledge base. Use this for almost all retrieval tasks. It combines keyword matching with semantic understanding."
*   **Arguments:** `query` (string), `limit` (number).