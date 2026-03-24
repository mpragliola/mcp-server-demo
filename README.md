# mcp-sqlite-demo

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server that
manages a to-do list backed by a local SQLite database. Built as a learning
reference for the three core MCP primitives: **Tools**, **Resources**, and
**Prompts**.

## What it demonstrates

| Primitive      | Example                          | Purpose                             |
| -------------- | -------------------------------- | ----------------------------------- |
| **Tools**      | `add_task`, `complete_task`, ... | LLM-invoked actions (side-effects)  |
| **Resources**  | `tasks://all`, `tasks://{id}`    | Read-only data the host can inspect |
| **Prompts**    | `new-task-prompt`                | Reusable message templates          |

### Tools

| Tool            | Description                    |
| --------------- | ------------------------------ |
| `list_tasks`    | Return all tasks               |
| `add_task`      | Add a new task by title        |
| `complete_task` | Mark a task as done by ID      |
| `rename_task`   | Rename an existing task by ID  |
| `delete_task`   | Delete a task by ID            |

### Resources

| URI             | Description                    |
| --------------- | ------------------------------ |
| `tasks://all`   | JSON snapshot of all tasks     |
| `tasks://{id}`  | Single task looked up by ID    |

### Prompts

| Name              | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `new-task-prompt` | Turns a rough idea into a clear, actionable task title |

## Quick start

```bash
npm install
npm run build
npm start          # runs via stdio transport
```

For development with auto-recompilation:

```bash
npm run dev
```

The server communicates over **stdio** — it is meant to be spawned by an MCP
host (e.g. Claude Desktop), not run directly in a browser or HTTP client.

## Connecting to a host

Add the server to your MCP host config (e.g. Claude Desktop `claude_desktop_config.json`):

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

## Project structure

```
src/
  index.ts      Single-file server: tools, resources, prompts, lifecycle
package.json
tsconfig.json
```

## License

MIT
