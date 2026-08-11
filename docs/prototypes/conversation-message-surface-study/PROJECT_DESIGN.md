# Conversation Message Surface Study

## 1. Product context

- Product: Rovai-ai, a desktop workspace where a user and long-lived Agents collaborate inside a Camp.
- Target surface: the Camp conversation timeline only.
- Primary job: scan who said what, read long Agent output, and distinguish narrative from Task, Tool, Approval, and AgentRun artifacts.
- Success: user and Agent messages share a coherent grammar without assigning a background color to each Agent.
- Technical boundary: this is a self-contained HTML study. It does not call Core, Shell, a Runtime, or production IPC.

## 2. Existing UI read

- Preserve Neutral Porcelain + Steel, left-aligned messages, avatars, actor names, timestamps, blue `@` mentions, hover/focus Copy, the compact Task shape, Execution Drawer, Composer, and the three-tab Inspector.
- Evolve the current asymmetry where the user body is a Steel-soft bubble while Agent Markdown sits directly on the white conversation plane.
- Remove actor-driven surface ownership. Persistent surfaces belong to structured content, not to `user` or `agent` identity.
- Avoid Agent-specific message colors, right-aligned chat bubbles, delivery-state labels, invented reply/round data, gradients, glass, and decorative card walls.

## 3. Taste direction

- Product identity: a calm multi-actor work record with document-grade reading, not a consumer messenger.
- Recommended direction: Shared Reading Plane with stable identity geometry.
- Comparative directions: Narrative + Artifact Width and Uniform Neutral Message Sheets.
- Distinctive cue: Porcelain remains quiet; Steel expresses structure, focus, and interaction rather than speaker identity.

## 4. Reference translation

- Notion contributes open reading rhythm, warm-neutral restraint, and whisper-weight boundaries. Marketing typography, large decorative whitespace, and pill-heavy status treatment do not transfer.
- Replicate contributes code-forward hierarchy and respect for technical artifacts. Its gradients, giant type, saturated red, and all-pill geometry do not transfer.
- Intercom contributes a useful neutral-sheet comparison and sharp, low-shadow containment. Its orange branding and scale-heavy button motion do not transfer.

## 5. Shared prototype fixture

All variants use the same shell, tokens, type sizes, and transcript:

- one short user request with a structured `@` mention;
- three Agents switching in a short interval;
- two adjacent messages from the same Agent;
- long Markdown with heading, list, link, and table;
- a 20-line code sample;
- one wide Tool Result, one compact Task, one Approval, one `发送给@xxx` handoff, and one AgentRun entry;
- long actor and file names that force wrapping;
- the existing sidebar, Camp header, Execution Dock, Composer, and Inspector remain visually stable.

## 6. Variant rules

### A — Shared Reading Plane

- Message articles have no persistent background or border.
- Avatar and metadata occupy stable columns.
- Hover and focus may use a temporary Porcelain tint.
- Same-actor adjacency only changes vertical rhythm; metadata remains present.
- Narrative and artifacts share the available content column, with prose capped for reading.

### E — Narrative + Artifact Width

- Uses the same actor grammar as A.
- Narrative is capped at roughly 76–80 characters per line.
- Code, Tool, Task, Approval, and AgentRun artifacts may use the wider conversation column.
- Width breakout disappears at narrow sizes; no negative margins or page-level horizontal scrolling.

### B — Uniform Neutral Message Sheets

- Every ordinary user and Agent message uses the same weak neutral sheet.
- Sheets share identical border, radius, padding, and hover states.
- Artifacts remain structurally stronger than the parent message sheet.
- This is a control direction for detecting card fatigue and nested-surface problems.

## 7. Interaction and accessibility

- Copy controls remain in the DOM and become visible on `:hover`, `:focus-within`, and coarse pointers.
- Icon targets are at least 28 by 28 CSS pixels and have visible Steel focus rings.
- Inspector tabs support pointer and arrow-key navigation.
- Prototype buttons never imply persistence; local-only feedback states that no Core write occurred.
- At 1040×700 and 200% zoom, metadata wraps, flexible children use `min-width: 0`, and only code regions may scroll horizontally.

## 8. Evaluation

- Validate inline script parsing, unique DOM IDs, ARIA references, and absence of external resources.
- Capture all variants at 1440×920, 2560×1440, and 1040×700.
- Check page-level overflow, Copy hover/focus, Inspector tabs, Execution Drawer, and Composer feedback.
- Compare the variants using product fit, hierarchy, clarity, restraint, density, craft, and responsiveness rather than novelty.
