# Database startup acceptance

`measure.mjs` compares two compatible Core/Agent CLI executable pairs against one isolated healthy database. It runs no model, excludes initialization/executable warmup, alternates pair order, records nine samples each, and cleans its data/Skill Library/Runtime root.

```sh
node .github/assets/database-startup/measure.mjs target/startup-baseline/rovai-core target/debug/rovai-core .github/assets/database-startup/macos-arm64.json
```

The baseline executable is built from `4d3aba9a550f2798245a18af403d0cbaa7bea7f8`. The candidate source and full evidence are recorded in [the implementation record](../../../docs/versions/v1.72/database-startup-simplification.md). Results describe local warm debug Core readiness; they are not daily user-data or universal cold-start claims.

`packaged-macos.json` / `packaged-macos.png`: isolated ad-hoc arm64 App; real xattr, held WAL writer, Renderer animation during opening, retained members/Thread and SQLite quick_check. `server-macos.json`: separate standalone Server with isolated data/Skills/MCP; authenticated HTTP reads and restart preserve the roster, without model execution. Daily host restart and Windows GUI are not claimed.
