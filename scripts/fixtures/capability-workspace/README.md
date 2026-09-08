# Capability workspace acceptance

Run `pnpm test:capability-workspace`. The fixture mounts production SkillSettings, McpSettings,
CapabilityWorkspace and styles in a sandboxed Electron window. Its bridge and entities are in-memory
fixtures; no Core, Runtime, network import or daily Skill Library is started or modified. The native
folder chooser bridge is stubbed so cancellation and inspect requests are deterministic.

The runner creates its own temporary userData and removes only that directory. Set
`ROVAI_KEEP_CAPABILITY_FIXTURE=1` to retain screenshots; the result prints their absolute location.
The test covers imports, scope changes, filtering, invalid JSON, CAS conflicts, peer add/import actions, form discard on navigation,
native pointer/keyboard resizing, day/night at minimum and wide window sizes, and 200% zoom.
Unsupported local imports include same-name Codex/Claude entries, repeated reasons and long fields;
their layout must wrap independently of the name/source row. MCP and Skill deletion use real application
dialogs with cancellation, focus return/trapping, pending dismissal guards, errors and stale-target checks.
Core's Skill Library suite separately verifies the content/digest and default assignment contracts.
