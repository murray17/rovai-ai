# Task

Create a Task only for responsibility that needs tracking across Runs and independent handoff or acceptance. Use ThreadMessage for brief coordination, answers, progress and questions.

Choose an operation with `rovai task --help`, then read its exact help. Reuse an existing Task where possible; put scope and requirements together in `description`.

Decide from current Task state; read it when the needed information is missing or stale. Submit only the fields you intend to change.

Tasks preserve responsibility; messages communicate it. Bring the Task to the appropriate state before publishing a required handoff, request or result. A Task-linked Send requires exactly one effective Agent recipient; User attention does not affect that count.
