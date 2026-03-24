# mcp-sqlite-demo

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server that manages a to-do list backed by a local SQLite database. Built as a tutorial example of MCP Tools, Resources, and Prompts.

---

## Tools

| Tool | Description |
|---|---|
| `list_tasks` | Return all tasks |
| `add_task` | Add a new task by title |
| `complete_task` | Mark a task as done by ID |
| `rename_task` | Rename an existing task by ID |
| `delete_task` | Delete a task by ID |

## Resources

| URI | Description |
|---|---|
| `tasks://all` | JSON snapshot of all tasks |
| `tasks://{id}` | Single task looked up by ID |

## Prompts

| Name | Description |
|---|---|
| `new-task-prompt` | Turns a rough idea into a clear, actionable task title |

---

## Install

```bash
npm install
```

## Build & start

```bash
npm run build
npm start
```

The server communicates over **stdio** — it is meant to be spawned by an MCP host (e.g. Claude Desktop), not run directly in a browser or HTTP client.

### Claude Desktop config

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sqlite-tasks": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-demo/dist/index.js"]
    }
  }
}
```
