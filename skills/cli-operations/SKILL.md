---
name: cli-operations
description: Choose among Rovai messages, Tasks, Missions, history and Memory; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly.
---

# Rovai CLI coordination

Use `rovai --help` to find an operation and its exact `--help` for syntax. Read only the references needed by the current decision. Write user-facing prose in the user's language.

## Choose the result to preserve

| Need | Operation family |
| --- | --- |
| Public answer, progress, question or one-time collaboration | ThreadMessage |
| Shared objective or whole-Mission status | Mission |
| Member identity, profile images or a requested profile edit | Member |
| Default Lead requests independent work from several members | One ThreadMessage with repeated `--to`; replies return separately |
| Responsibility that survives Runs and can be handed off and accepted independently | Task |
| Thread or message evidence | Thread/History |
| Who is running, queued or waiting | Thread execution query |
| Durable collaboration preference, agreement or lesson | Memory governance |

Choose the smallest object that fully serves the request. Tasks own durable responsibilities; project sources and history own their facts.

## Member operations

`member get` supplies the current Profile version and image paths; `member update` changes the global Profile. Send only the fields the User asked to change. For a newly created member, use the `agentId` returned by `member create`, even before it joins this Thread. Use `member-studio` for creation proposals and confirmation, not edits to an existing Profile.

## Coordinate operations

1. Read the authoritative state needed for the decision.
2. Use one supported input source per call, following that operation's help.
3. Inspect the committed business result before taking the next step.
4. Publish any required Thread-visible answer before ending the Run.

A successful operation proves its own commit, not downstream execution, validation or completion of the user's objective.

## References

- [Send](references/send.md): public messages, Agent routing, parallel invitations and User attention.
- [Task](references/task.md): durable responsibility and Task-linked messages.
- [Mission](references/mission.md): objective, status and public explanation.
- [Thread/History](references/camp-history.md): message reads, addressing, execution state and pagination.
- [Memory](references/memory.md): route durable information to `memory-stewardship`.
- [Recovery](references/recovery.md): follow `error.recovery`, especially uncertain outcomes.
