# Capability workspace acceptance

Run `pnpm test:capability-workspace`. The fixture mounts production NativeSkillsSettings,
ToolboxSettings, McpSettings and their shared layout/styles in a sandboxed Electron window.
Its bridge and entities are in memory; it starts no Core or Runtime and does not read or modify
native Skill directories, legacy Library data or MCP configuration on the host.

The runner creates temporary userData and removes only that directory. Set
`ROVAI_KEEP_CAPABILITY_FIXTURE=1` to retain screenshots; the result prints their absolute location.

Native Skills coverage includes refresh, read-only controls, file search, duplicate names in distinct
folders, long paths, focus and keyboard navigation, sticky controls, binary/large files, read retry,
late responses across files and Skills, full text above 1 MiB, bounded plain-text prefixes for oversized
files, day/night layouts, narrow/wide windows and 200% zoom.
The toolbox covers member selection, failed-save rollback, retry with the same command identity,
filtered bulk changes that preserve other members, and its reading dialog.

MCP coverage retains import, assignment, invalid JSON, CAS conflicts, masked credentials and explicit
reveal, late responses, draft discard, pointer/keyboard resizing, dialog cancellation and focus trapping,
pending dismissal guards, deletion errors, stale targets, minimum window sizes and zoom.

The retired SkillSettings page and its legacy import/group tests are removed. Shared file reading
is now exercised through the current native settings. Core's legacy Skill Library tests continue to
own persisted Revision, projection and recovery compatibility; this fixture is not evidence for those paths.
