# PROJECT_DESIGN · B 底部执行台 × Agent 级执行过程

## 1. Product context

- **Product:** Rovai-ai，本地优先的多 Agent 协作工作空间。
- **Surface:** `CampWorkspace` 会话区；本稿只覆盖 Renderer 的底部 Agent 入口、执行过程面板、Task 关联入口、Inspector 和 Composer 周边。
- **Primary job:** 让用户把“谁在持续工作”看成一个长期的 Agent 过程，同时仍能在同一面板里读到多个底层 AgentRun 的证据。
- **Chosen layout:** **B · 底部执行台**。执行摘要靠近消息输入，展开后占用会话列底部，不覆盖公共时间线，也不占用右侧 Inspector。
- **Non-goals:** 不改 Core、AgentRun、Execution Evidence、Message Delivery、取消/审计事实或 IPC 数据边界；本稿不是生产 React 实现。

## 2. Existing UI read

- 复用 main 的 Arctic Dawn Day：270px 侧栏、会话阅读列、310px Inspector、白色阅读表面、细分隔线、低频阴影。
- 复用现有可追溯内容：Run ID、生命周期时间、调用方式、A2A 深度、CampTurn、投递状态、`RunExecutionDisclosure` 证据摘要、Task/上下文/审批。
- 用户确认删除面板内“当前责任 / 状态 / purpose 业务标题 / 预期交付”；Agent pill 仍保留由真实 Run 状态聚合出的入口状态。
- 保持现有操作边界：停止仍是 CampTurn 级；公共 A2A 消息不重复渲染 Run 来源；历史证据按持久化事实恢复。
- 删除 Renderer Inspector 的“审计”页签；Task 关联执行改为一个 Agent 级入口，不再列出多个 Run 按钮。

## 3. Product identity and taste direction

**一句话：** 冷静、证据优先的执行工作台，像一条贴着 Composer 的连续轨道，而不是 AgentRun 列表。

- **Keep:** Arctic Dawn 的冷纸白、北极星靛蓝、低饱和身份色、状态色与证据色分离；单一工作表面而非卡片墙。
- **Add:** 底部执行台用强结构上边界和轻微暖灰底承接；Agent 级入口用头像环、名称和状态文字建立连续身份。
- **Avoid:** 深色 Sentry 式监控墙、发光/渐变、每个 Run 的导航卡、数字仪表盘、把执行过程做成第二条聊天记录。
- **Reference routing:** Notion 的轻量分隔和内容优先可借鉴；Sentry 的深紫高密度监控语气不采用。Arctic Dawn 是权威 Token 来源。

## 4. Information architecture

```text
Camp + Agent
├─ 公共消息时间线（不插入 Run 来源行）
├─ B 底部执行台（唯一执行入口）
│  ├─ Agent pills（每个 Agent 一个，选中 agentId）
│  └─ Evidence-first 连续轨道
│     ├─ Run 边界元数据（无业务标题）
│     ├─ 投递状态
│     └─ 现有执行证据
├─ Approval Dock（CampTurn 级）
└─ Composer（Stop 仍为 CampTurn 级）
```

生命周期文案使用“当前 Camp 中的长期入口”。面板在 running、waiting、succeeded、failed、cancelled 均可打开；关闭只改变 Renderer 选择态，不删除历史。

## 5. Visual tokens

- **Surface:** `--canvas #F2F4F1`、`--surface #FBFCFA`、`--surface-raised #FFFFFF`、`--conversation-surface #FFFFFF`。
- **Structure:** `--line #DDE1DA`、`--line-strong #CBD1C8`、`--control-line #8B9389`。
- **Brand:** `--brand #343B72`、`--brand-soft #ECEEF8`、`--focus #4D83A2`。
- **State:** success `#3E775C/#E7F1EA`、attention `#8A6226/#F8EDDA`、danger `#A24C46/#F7E6E3`、info `#416C86/#E5EEF3`。
- **Evidence:** `#F5F6F4` / `#FFFFFF` / `#252A36` / `#D5DAD3`。
- **Typography:** system sans for prose; monospace only for time, counts, CampTurn and stable IDs. Body 13px, metadata >=10.5px.

## 6. Component and interaction decisions

### Bottom Agent entry bar

- B does not render RunPulse or any other execution entry above the public timeline.
- The compact Agent pills in the bottom dock are the only persistent execution entry in the conversation column.
- Pills are keyed by `(campId, agentId)` and show name plus current/last status only.
- Repeated AgentRun facts update the same chip; no Run count is used as the entry label.
- A terminal Agent remains selectable after leaving and re-entering Camp when the membership is present again.

### Conversation messages

- Public messages do not render “打开执行过程” or any other execution action below each message. The bottom Agent dock remains the single persistent execution entry in the conversation column.
- User and Agent messages share the same left-aligned reading axis; identity color distinguishes the user's message without reversing its avatar or bubble to the right.
- Lightweight handoff footers and the expanded Agent process show recipient identity only. Delivery status pills such as “已送达 / 等待审批” are omitted from this conversation surface; complete status facts remain available in the Context Delivery surface and underlying delivery model.
- Copy mirrors current `main`: an icon-only `message-copy-button` follows the message surface, stays visually hidden by default, and appears on hover or `focus-within`; its accessible name remains “复制这条消息”.
- The prototype removes the earlier text “复制 / 定位” action row. Copy feedback is announced through the existing live status surface.

### Task timeline entry

- The conversation entry uses only the current `TaskTimelineCard` contract: `status`, `title`, and resolved assignee name. Description, Criteria count, blocker, audit, and AgentRun facts stay in their respective detail surfaces.
- The whole entry is one button that opens the Task inspector; it does not contain a nested “在任务中查看” action.
- The final HTML fixes the selected **紧凑双行卡** treatment at about 47px. Status sits beside title and assignee, preserving the frozen field contract, long-title resilience, state readability, and keyboard target without making Task visually dominant.

### Scope preservation

- This revision does not redesign the sidebar “队员 / 长期事项” rows, current-member roster, Camp top bar, Composer, Approval Dock, Context/Approval panels, or Task Inspector details.
- Those surfaces remain in the HTML only to preserve the real Camp context. They must not be treated as proposed product changes or copied into a Renderer implementation diff for this feature.

### Execution drawer / bottom dock

- Selection state is `executionDrawerAgentId` in the future Renderer implementation.
- The body is a chronological, evidence-first Agent process. Each Run boundary uses only `runId`, lifecycle time, invocation kind, CampTurn and A2A depth, then renders recipient identity and existing execution evidence inline; Run boundaries are not selectors. Delivery status pills are intentionally absent here.
- On every explicit Agent entry click, choose the newest `running` Run; if none, choose the newest `queued` or `waiting` Run. Scroll it into visual focus and expand its available evidence by default without moving keyboard focus.
- If the Agent has no non-terminal Run, show the history from the beginning with evidence collapsed until the user expands it.
- Closing changes only the Renderer open state. Reopening from the bottom Agent pill, Task relation, stop event, or message delivery resolves the same Agent process.
- No automatic close or auto-open on terminal/status changes; no AgentRun-level stop or navigation.

### Inspector

- Tabs are `任务 / 上下文投递 / 审批`; `审计` is intentionally absent in this revision.
- Related Task execution is one Agent row with “打开执行过程”; it never renders one button per AgentRun.

## 7. Prototype behavior and data safety

- This standalone HTML uses a small, clearly labelled fixture shaped like `CampSnapshot`, `AgentRunView`, `MessageDeliveryView` and evidence views. It does not connect to Core, IPC, filesystem, network or browser storage.
- `purpose` and `expectedOutput` remain underlying AgentRun facts but are intentionally absent from this panel. The prototype does not shorten or rephrase them into display copy.
- Agent-level “当前责任 / 状态” fields are absent. Only the persistent Agent pill uses a derived current/last state so users can find active and historical processes.
- Run boundary intervals derive from lifecycle timestamps; all visible process body content is Run metadata, Message Delivery, or Execution Evidence.
- Narration, plan and tool rows appear only when corresponding Execution Evidence exists. The Renderer must not invent a work summary, conclusion, or percentage.
- The complete field-by-field availability audit is recorded in [`DATA_SOURCES.md`](./DATA_SOURCES.md).
- Clickable behavior mirrors production intent: compact Task navigation, hover/focus message copy, Agent chip selection, dock expand/collapse, evidence disclosure, Inspector tabs, approval decision feedback, Composer draft/Stop feedback and notes popover.
- “发送”“批准”“停止” are local visual feedback only; they do not execute a command.

## 8. Verification plan

- Render at 1440×920 and 1040×700; check that the bottom dock stays above Approval Dock/Composer and that the Inspector remains usable.
- Confirm there is no top execution entry, there is one bottom pill per Agent, no Run selector, terminal history can be reopened, and no “审计” tab exists.
- Confirm messages share the left reading axis, contain no repeated execution action or delivery status pills, copy controls are icon-only and hover/focus revealed, and the final Task card renders only status/title/assignee.
- Confirm an Agent click visually centers its newest running/non-terminal Run and opens that Run's evidence while preserving focus on the clicked control.
- Keyboard-check all buttons/tabs/disclosures, visible focus rings, reduced-motion fallback, and no page-level horizontal scroll.
- Compare against the existing `CampWorkspace`: preserve message order, Task/Context/Approval semantics and evidence fields; change only the Renderer aggregation/lifecycle presentation.
