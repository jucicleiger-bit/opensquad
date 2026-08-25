## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## agent-browser

Use `agent-browser` as the browser validation hub after UI, frontend, layout, styling, or visual changes.

Rules:
- Open the changed surface with `npx agent-browser open <url>` after the local app is running.
- Validate at least one desktop viewport and one mobile viewport with screenshots before finishing visual work.
- Use `npx agent-browser snapshot`, `npx agent-browser screenshot`, and targeted interaction commands to confirm the layout, responsive behavior, and changed workflows.
- Report any layout defects found and fix them before final handoff when they are in scope.
