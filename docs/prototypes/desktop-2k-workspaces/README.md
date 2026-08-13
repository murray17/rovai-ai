# 2K workspace interaction prototypes

Open [`index.html`](index.html) in a browser. The prototype is self-contained and does not connect to
Rovai Core, local Agent Runtime, MCP, SQLite or the filesystem.

Use the prototype toolbar to compare `1440×920` and `2560×1440`, switch Porcelain Day / Steel Night,
and navigate among Quick Chat, Memory, Members, Agent Runtime and Diagnostics.

The traffic lights at the top left mirror the packaged App's native macOS title bar inset. They only
show local prototype feedback in a browser and do not close, minimise or zoom the browser window.

This study intentionally excludes Camp (which already owns a 2K layout contract) and New
Conversation (whose dialog width is deliberately bounded at 760px). See [`PROJECT_DESIGN.md`](PROJECT_DESIGN.md)
for the layout rationale and authority boundaries.
