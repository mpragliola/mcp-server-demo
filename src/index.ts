import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Database from "better-sqlite3";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Logger
// After connect: sends MCP notifications/message to the host.
// Before connect (fatal startup errors): falls back to stderr.
// ---------------------------------------------------------------------------
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";

// stderr fallback — only used before the transport is live
function logFatal(event: string, data?: Record<string, unknown>) {
    const entry = { ts: new Date().toISOString(), level: "error", event, ...data };
    process.stderr.write(JSON.stringify(entry) + "\n");
}

function log(level: LoggingLevel, event: string, data?: Record<string, unknown>) {
    server.server.sendLoggingMessage({ level, data: { event, ...data } });
}

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, "tasks.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done  INTEGER NOT NULL DEFAULT 0
  )
`);

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
    name: "sqlite-tasks",
    version: "1.0.0",
});

// ---------------------------------------------------------------------------
// TOOLS  (LLM calls these — may have side effects)
// ---------------------------------------------------------------------------

server.registerTool(
    "list_tasks",
    {
        description: "List all tasks in the database",
        inputSchema: {},
    },
    () => {
        const tasks = db.prepare("SELECT * FROM tasks").all();
        log("info", "list_tasks", { count: tasks.length });
        return {
            content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
        };
    }
);

server.registerTool(
    "add_task",
    {
        description: "Add a new task to the database",
        inputSchema: { title: z.string().describe("The task title") },
    },
    ({ title }) => {
        const result = db.prepare("INSERT INTO tasks (title) VALUES (?)").run(title);
        log("info", "add_task", { id: result.lastInsertRowid, title });
        return {
            content: [
                { type: "text", text: `Task created with id ${result.lastInsertRowid}` },
            ],
        };
    }
);

server.registerTool(
    "complete_task",
    {
        description: "Mark a task as done",
        inputSchema: { id: z.number().describe("Task ID to mark as complete") },
    },
    ({ id }) => {
        const result = db.prepare("UPDATE tasks SET done = 1 WHERE id = ?").run(id);
        if (result.changes === 0) {
            log("warning", "complete_task", { id, outcome: "not_found" });
            return { content: [{ type: "text", text: `No task found with id ${id}` }] };
        }
        log("info", "complete_task", { id });
        return { content: [{ type: "text", text: `Task ${id} marked as done` }] };
    }
);

server.registerTool(
    "delete_task",
    {
        description: "Delete a task from the database",
        inputSchema: { id: z.number().describe("Task ID to delete") },
    },
    ({ id }) => {
        db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
        log("info", "delete_task", { id });
        return { content: [{ type: "text", text: `Task ${id} deleted` }] };
    }
);

server.registerTool(
    "rename_task",
    {
        description: "Rename an existing task",
        inputSchema: {
            id: z.number().describe("Task ID to rename"),
            title: z.string().describe("New title for the task"),
        }
    },
    ({ id, title }) => {
        const result = db.prepare("UPDATE tasks SET title = ? WHERE id = ?").run(title, id);
        if (result.changes === 0) {
            log("warning", "rename_task", { id, outcome: "not_found" });
            return { content: [{ type: "text", text: `No task found with id ${id}` }] };
        }
        log("info", "rename_task", { id, title });
        return { content: [{ type: "text", text: `Task ${id} renamed to "${title}"` }] };
    }
);

// ---------------------------------------------------------------------------
// RESOURCES  (LLM/host reads these — read-only, no side effects)
// ---------------------------------------------------------------------------

// Static resource: snapshot of all tasks
server.resource(
    "tasks-all",
    "tasks://all",
    { description: "All tasks in the database as a JSON snapshot" },
    async (uri) => {
        const tasks = db.prepare("SELECT * FROM tasks").all();
        log("info", "resource_read", { uri: uri.href, count: tasks.length });
        return {
            contents: [
                {
                    uri: uri.href,
                    mimeType: "application/json",
                    text: JSON.stringify(tasks, null, 2),
                },
            ],
        };
    }
);

// Dynamic resource: single task by ID via URI template
server.resource(
    "task-by-id",
    new ResourceTemplate("tasks://{id}", { list: undefined }),
    { description: "A single task looked up by its numeric ID" },
    async (uri, { id }) => {
        const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
        if (!task) {
            log("warning", "resource_read", { uri: uri.href, outcome: "not_found", id });
            throw new Error(`Task with id ${id} not found`);
        }
        log("info", "resource_read", { uri: uri.href, id });
        return {
            contents: [
                {
                    uri: uri.href,
                    mimeType: "application/json",
                    text: JSON.stringify(task, null, 2),
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// PROMPTS  (reusable message templates the host can surface as slash commands)
// ---------------------------------------------------------------------------

server.prompt(
    "new-task-prompt",
    "Turns a rough idea into a clear, actionable task title",
    { rough_idea: z.string().describe("Your rough task idea") },
    ({ rough_idea }) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Turn this rough idea into a clear, actionable task title (max 10 words): "${rough_idea}"`,
                },
            },
        ],
    })
);

// ---------------------------------------------------------------------------
// Start — stdio transport (host spawns this process and talks over stdin/stdout)
// ---------------------------------------------------------------------------
try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log("info", "server_start", { name: "sqlite-tasks", version: "1.0.0" });
} catch (err) {
    logFatal("server_start_failed", { error: String(err) });
    process.exit(1);
}