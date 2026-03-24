import { fileURLToPath } from "node:url";
import path from "node:path";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_NAME = "sqlite-tasks";
const SERVER_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const DB_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "tasks.db",
);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT    NOT NULL,
    done  INTEGER NOT NULL DEFAULT 0
  )
`);

// Prepared statements — prepare once, execute many.
const stmt = {
    list: db.prepare("SELECT * FROM tasks"),
    getById: db.prepare("SELECT * FROM tasks WHERE id = ?"),
    insert: db.prepare("INSERT INTO tasks (title) VALUES (?)"),
    complete: db.prepare("UPDATE tasks SET done = 1 WHERE id = ?"),
    rename: db.prepare("UPDATE tasks SET title = ? WHERE id = ?"),
    delete: db.prepare("DELETE FROM tasks WHERE id = ?"),
} as const;

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
});

// ---------------------------------------------------------------------------
// Logging
//
// After connect:  sends MCP log notifications to the host.
// Before connect: falls back to stderr so fatal errors are still visible.
// ---------------------------------------------------------------------------

function logFatal(event: string, data?: Record<string, unknown>) {
    const entry = { ts: new Date().toISOString(), level: "error", event, ...data };
    process.stderr.write(JSON.stringify(entry) + "\n");
}

function log(level: LoggingLevel, event: string, data?: Record<string, unknown>) {
    server.server.sendLoggingMessage({ level, data: { event, ...data } });
}

// ---------------------------------------------------------------------------
// Tools  (LLM-invoked — may have side-effects)
// ---------------------------------------------------------------------------

server.registerTool(
    "list_tasks",
    { description: "List all tasks" },
    () => {
        const tasks = stmt.list.all();
        log("info", "list_tasks", { count: tasks.length });
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
    },
);

server.registerTool(
    "add_task",
    {
        description: "Add a new task",
        inputSchema: { title: z.string().describe("The task title") },
    },
    ({ title }) => {
        const { lastInsertRowid } = stmt.insert.run(title);
        log("info", "add_task", { id: lastInsertRowid, title });
        return {
            content: [{ type: "text", text: `Task created with id ${lastInsertRowid}` }],
        };
    },
);

server.registerTool(
    "complete_task",
    {
        description: "Mark a task as done",
        inputSchema: { id: z.number().describe("Task ID to mark as complete") },
    },
    ({ id }) => {
        const { changes } = stmt.complete.run(id);
        if (changes === 0) {
            log("warning", "complete_task", { id, outcome: "not_found" });
            return { content: [{ type: "text", text: `No task found with id ${id}` }] };
        }
        log("info", "complete_task", { id });
        return { content: [{ type: "text", text: `Task ${id} marked as done` }] };
    },
);

server.registerTool(
    "rename_task",
    {
        description: "Rename an existing task",
        inputSchema: {
            id: z.number().describe("Task ID to rename"),
            title: z.string().describe("New title for the task"),
        },
    },
    ({ id, title }) => {
        const { changes } = stmt.rename.run(title, id);
        if (changes === 0) {
            log("warning", "rename_task", { id, outcome: "not_found" });
            return { content: [{ type: "text", text: `No task found with id ${id}` }] };
        }
        log("info", "rename_task", { id, title });
        return { content: [{ type: "text", text: `Task ${id} renamed to "${title}"` }] };
    },
);

server.registerTool(
    "delete_task",
    {
        description: "Delete a task",
        inputSchema: { id: z.number().describe("Task ID to delete") },
    },
    ({ id }) => {
        const { changes } = stmt.delete.run(id);
        if (changes === 0) {
            log("warning", "delete_task", { id, outcome: "not_found" });
            return { content: [{ type: "text", text: `No task found with id ${id}` }] };
        }
        log("info", "delete_task", { id });
        return { content: [{ type: "text", text: `Task ${id} deleted` }] };
    },
);

// ---------------------------------------------------------------------------
// Resources  (read-only data the host or LLM can inspect)
// ---------------------------------------------------------------------------

server.registerResource(
    "tasks-all",
    "tasks://all",
    { description: "All tasks as a JSON snapshot" },
    async (uri) => {
        const tasks = stmt.list.all();
        log("info", "resource_read", { uri: uri.href, count: tasks.length });
        return {
            contents: [{
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify(tasks, null, 2),
            }],
        };
    },
);

server.registerResource(
    "task-by-id",
    new ResourceTemplate("tasks://{id}", { list: undefined }),
    { description: "A single task by its numeric ID" },
    async (uri, { id }) => {
        const task = stmt.getById.get(id);
        if (!task) {
            log("warning", "resource_read", { uri: uri.href, outcome: "not_found", id });
            throw new Error(`Task ${id} not found`);
        }
        log("info", "resource_read", { uri: uri.href, id });
        return {
            contents: [{
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify(task, null, 2),
            }],
        };
    },
);

// ---------------------------------------------------------------------------
// Prompts  (reusable message templates the host can surface)
// ---------------------------------------------------------------------------

server.registerPrompt(
    "new-task-prompt",
    {
        description: "Turns a rough idea into a clear, actionable task title",
        argsSchema: { rough_idea: z.string().describe("Your rough task idea") },
    },
    ({ rough_idea }) => ({
        messages: [
            {
                role: "user" as const,
                content: {
                    type: "text" as const,
                    text: `Turn this rough idea into a clear, actionable task title (max 10 words): "${rough_idea}"`,
                },
            },
        ],
    }),
);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

process.on("SIGINT", () => {
    db.close();
    process.exit(0);
});

try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log("info", "server_start", { name: SERVER_NAME, version: SERVER_VERSION });
} catch (err) {
    logFatal("server_start_failed", { error: String(err) });
    process.exit(1);
}
