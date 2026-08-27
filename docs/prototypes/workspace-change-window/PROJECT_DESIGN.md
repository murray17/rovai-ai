---
document_type: prototype-design-input
status: design-review
target_version: v1.29
last_updated: 2026-08-27
---

# Workspace Diff Evidence 设计输入

## Job and mode

Operate + Inspect。用户先在 Camp 中监督运行，需要时再回答两类不同问题：Runtime 是否通过可靠终态事件
明确报告了文件编辑，以及当前 Camp / exact execution root 的一组重叠 Run 最终留下了什么净变化。
前者只是执行时序中的普通 Canonical Activity，可在原位展开终态 patch；后者才是可进入完整 Review 的
会话历史 Evidence。临时 Git tree 只为后者提供计算材料，两层能力不能在来源、完整性或归因上互相替代。

## 权威模型

```text
临时 baseline/final Git tree
        ↓ 只负责计算
WorkspaceDiffCompleted Evidence + managed diff blob
        ↓ 长期读取
会话历史卡片与只读 Diff Review
```

旧卡片不依赖当前工作区、Git ref、baseline/final tree 或后续卡片。Git ref 清理、文件继续变化、用户提交
或新的 Window 完成都不会改变旧卡片。UI 不暴露 checkpoint chain、Undo 或重新计算入口。

## 生产还原基线

- App Shell 保持 `270px rail / 50px top row / flexible workspace`；普通 Inspector 保持 310px；
- 沿用生产 `CampWorkspace` 的会话时间线、底部 Agent 执行台、条件式 Inspector“执行”Tab、Execution Drawer、
  Run stage 与 Tool 四轨；默认 placement 为底部，右侧只是用户显式选择后的另一宿主；
- 沿用 `DESIGN.md` 的 Porcelain Day / Steel Night、平台原生字体、4/8/12/16/24 间距和紧凑桌面密度；
- 普通结构无阴影；历史卡片与差异使用 `--evidence-*` / `--diff-*` token，Runtime 单文件 presentation row
  继续沿用现有 Tool Activity 密度，展开内容才进入 evidence surface；
- 原型控制条位于 App 外，不进入生产 Renderer。

## 信息架构

### 1. 完成 Window 进入会话时间线

只有 `complete` 生成一张 `Files Changed` Evidence 卡片。卡片只保留 32px 中性文件图标、主标题、文件数与
增删统计，以及无缩进、无行间分隔线的文件行。多文件默认最多显示三行，再用“更多文件”原位展开。卡片
不显示捕获时间、“已保存”、参与运行数量、归因解释或底部 metadata footer。

卡片使用互不嵌套的两个交互层：上半区整体是打开 Review 默认文件的原生 Button；每条文件行各自是打开
同一 Review 并选中对应文件的原生 Button。“View”只是上半区内的无边框方向提示，不是卡片里第二个强按钮；
它使用主题 `--ink`、轻量 hover surface 与箭头，不使用品牌蓝色或常驻描边。这样既让整张卡片都可点击，
又避免 Button 嵌套、重复 Tab stop 和冒泡冲突。

Evidence 卡片与普通消息正文左轴对齐，不为它增加 timeline rail、连接线或事件圆点；会话页继续使用当前
生产结构，而不是为 Workspace Window 发明新的时间线语法。

每个 Window 只发布一张卡片。后续 Window 产生新卡片，不更新、覆盖或折叠旧卡片；A 与 B 可分别打开，
各自读取其 `WorkspaceDiffCompleted → diffBlobId`。卡片不放在某个队员消息或 Run card 内。

### 2. 非 complete 不新增 Workspace UI

`baseline_pending / active / final_pending`、`no_changes`、`unavailable` 和非 Git execution root 都不生成
会话卡片。执行台不增加“共享工作区观察”、Window 状态行、参与引用或部分 patch；这些状态继续由 Core
持有，不能为了可见性把 Workspace summary 复制进某个 Run。

### 3. 一个 Terminal FileChange Activity 投影为多条单文件行

执行台不展示泛化的“每条 command 变更”，也不保留 `apply_patch` 父行。`apply_patch` 只是 Runtime 内部原始
Tool 名称；Adapter 不解析其输入、不读取当前文件，也不把 Tool 名本身作为 Diff 数据源。可靠终态事件落为
一条 append-only FileChange Evidence 和一条 Canonical Activity，Renderer 再将 `changes[]` 扁平投影为
多条同级 presentation rows：

```text
[文件图标] 修改 CampWorkspace.tsx    +31 −8
  [该文件的 inline unified diff]
[文件图标] 修改 styles.css           +13 −3
pnpm test …                         ← 另一个真实 Tool Activity
```

这里没有 `apply_patch` 行，也没有“编辑了 N 个文件”的专用聚合 disclosure。文件变更 Activity 与相邻 Tool
Activity 一样进入现有“已执行 N 项操作”集合；该集合仍按权威 Activity/Tool item 计数，不按 presentation row
数量改写数据语义。展开集合后，每个单文件行独立控制自己的 inline diff，行与行之间没有父子关系；点击
只展开当前文件，不跳转文件、不进入 Workspace Review，也不打开专用 Operation Diff View。

集合内 Tool 行、文件行和展开 diff 统一顶格，移除旧 `.tool-group-items` 的左侧连接线、左 margin 与 inline diff
的二次缩进。层级由外层 disclosure、行 hover/focus 和垂直间距表达，不以牺牲代码宽度换取缩进。presentation
row 继续复用现有 Command View 的文件图标、“修改 xxx”文案、密度与 disclosure 语法；展开内容才进入
evidence surface。

多行不代表多条权威 Activity。每条行都携带同一个 `evidenceId / canonicalActivityId`，并通过 change index
定位同一 `changes[]` 中的元素；选择、历史和审计仍以 FileChange Evidence / Canonical Activity 为单位。

Codex v1 的准入条件是三个条件同时成立：

```text
method = item/completed
item.type = fileChange
item.status = completed
```

内容只取最终 `item.changes[]`。`item/started` 与 `item/fileChange/patchUpdated` 均不参与 v1 投影；异常退出时
若没有可靠 terminal `fileChange`，则不显示文件 Activity。此链路不依赖 Git，非 Git 项目也可显示。

### 4. 跨 Runtime 终态准入

“文件变更”是语义，不是强行统一事件名。每个 Adapter 必须证明自己的终态事件同时提供明确文件集合与
可直接展示的最终内容，才能投影同一种 Activity。当前源码能够确认的边界如下：

| Runtime / adapter | 实际终态边界 | 当前可获得的文件 Evidence | v1 UI 结论 |
| --- | --- | --- | --- |
| Codex app-server | `item/completed`，`fileChange.status=completed` | `changes[]` 含 `path / kind / diff` | 准入；每个 change 显示一条可独立展开的“修改 xxx”文件行 |
| ACP：OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen、TRAE | `session/update` 中 `tool_call_update.status=completed` | ACP 标准 `content.type=diff` 提供 `path / oldText? / newText`，collection update 按 replace 语义累计到终态 | 协议准入；某次运行实际发送 Diff 时逐文件显示，否则保持普通 Tool Activity |
| ACP baseline：Cursor、Kimi、Grok | 同一标准 ACP terminal ToolCall；run-level fallback 不补造 Tool | 只接纳标准 terminal `content.type=diff`，私有扩展或 Runtime 名不作为来源 | 协议准入；没有标准 Diff 时不显示文件 Activity |
| Claude Code | 完整 assistant `tool_use(name=Edit)` + matching 非错误 user `tool_result` | `file_path/old_string/new_string` 是一次 `exact_mutation`；不含真实文件行号或完整文件 before/after | 准入 Edit；显示单文件“修改 xxx”行，展开只显示 `−/+` 片段，不生成 `@@` |
| Antigravity | `step_update` 到 `DONE / SUCCESS` 等终态 | 能识别 edit/write Tool 名，但公共 payload 没有可靠 `path + diff` | 不显示文件 Activity |

因此 Renderer 只消费归一后的、已通过终态准入的 Evidence，不写 `if runtime === ...` 的猜测逻辑。未来某个
Adapter 补齐可靠证据时，遵循相同投影规则：一个可靠 single-file change 对应一条“修改 xxx”文件行；同一终态
事件的多条 row 仍共享一条 Canonical Activity。在此之前不增加占位、`unavailable` 或推测提示。

生产实现已在 Core 侧建立 terminal gate：Codex add/delete 完整内容先规范化为 unified diff；十个 ACP adapter
共享标准 terminal Diff 累计通路；Claude 只接纳原生 Edit 的 matching exact mutation，其他 Tool 与 Antigravity
fail closed。Renderer 只接收 Canonical typed projection，忽略 `file.change.updated` presentation，并把一个
Activity 的 entries 扁平显示为同级单文件 rows。Claude exact mutation 不显示行号或 hunk；同文件连续 Edit 仍是
多个 Tool 行。

### 5. 执行台两种承载位置

默认使用时间线底部形态：队员过程入口横向排列，下方打开可调高度详情，Composer 仍位于其下方。
普通 Inspector 此时只有“任务 / 队员”。用户显式“移到右侧”后，底部入口和详情完全撤下，Inspector
增加首个“执行”Tab，并承载同一份已挂载详情；“移回底部”恢复普通 Inspector。两处不同时显示两套
执行详情，不因 viewport 自动切换位置。两种 placement 内，Tool / 单文件变更列表都位于 Run process card
的完整可用宽度；不做左侧 Workspace observation、右侧 Tool list 的两栏分割。

### 6. 全宽只读 Review

完整 diff Review 只属于 Workspace Change Window。打开历史卡片时临时收起 310px Inspector，但保留
270px App Rail、50px Camp 顶行和明确的“返回会话”动作。Review 首先说明“这是完成时保存的不可变证据，
打开时不会重新读取当前工作区或执行 Git diff”；随后再说明共享 Window 的非归因与外部写入可能性。

Review 使用一个开放 evidence surface：左侧文件目录，右侧当前文件差异；不用浮层、Dialog、嵌套卡墙、
checkpoint 浏览器或新的全局一级页面。Porcelain Day 的代码上下文保持白色，新增与删除分别使用语义化的
浅绿/浅红行底和对比合格的深绿/深红文字；hunk 与选中状态保持中性灰，不用 Steel/Info 蓝染色 diff。
Steel Night 映射相同语义 token，但不强制反色或另建组件树。卡片统计与 Command inline diff 复用同一组
`--diff-add* / --diff-remove*` token，颜色以外仍保留 `+ / −`、行号和文本结构。

## 状态矩阵

| Layer | State | 会话时间线 | Run detail / Review |
| --- | --- | --- | --- |
| Workspace | `complete` | 新增不可变 `Files Changed` 卡片 | “View”打开完整 managed diff blob |
| Workspace | `no_changes` | 不新增卡片；旧卡片保留 | 不新增共享观察 UI |
| Workspace | `unavailable` | 不新增卡片；旧卡片保留 | 不新增共享观察 UI |
| Workspace | `baseline_pending / active / final_pending` | 不新增卡片；旧卡片保留 | 不新增共享观察 UI |
| Runtime file change | 可靠 terminal Evidence | 不进入 Camp 会话历史 | 一条 Canonical Activity；每个 change 扁平渲染一条可展开 row |
| Runtime file change | 只有 started / partial update | 不新增活动 | 不消费，不显示部分结果或推测 summary |
| Runtime file change | 异常退出或无可靠 terminal Evidence | 不新增活动 | 不增加任何文件变更 UI；原 Tool Activity 保持不变 |

## Responsive and accessibility

- 最小窗口 `1040×700` 仍保留 270px Rail 和既有 compact Inspector；会话卡片正文与摘要自然换行；
- `1040–1179px` 的 ordinary Inspector 收敛到既有 260px；底部详情与 Tool list 保持整宽并在自己的区域滚动；
- Review 文件栏缩至 206px，diff 自身横向滚动，整 App 不滚动；
- 状态使用文字、图标/形状与固定位置，不只依赖颜色；
- 历史卡片上半区、每条文件行、终态单文件 presentation row、文件 disclosure、场景切换、返回、状态和主题均可
  键盘操作，可见焦点使用 `--focus`，Tab 顺序与视觉顺序一致；
- Diff 同时提供 `+ / −`、旧/新行号和 `aria-label`，不是只有红绿背景；
- `prefers-reduced-motion` 下 spinner 改为静态状态环。

## Anti-goals

- 不把 Workspace Diff 命名为“Agent 修改”“本次执行改动”或队员贡献；
- 不把最终卡片放进 Inspector、某个 Run 或某位队员消息，也不复制到每个参与 Run；
- 不为 `no_changes`、`unavailable`、pending 或非 Git root 生成会话占位卡片；
- 不在会话区为 Evidence 卡片增加连接线、事件圆点或独立时间线轨道；
- 不在执行台增加“共享工作区观察”，也不把 Run card 分成 observation / Tool 两栏；
- 不把 terminal file change 与 Workspace Diff 合并、去重或用当前工作区文件补全；
- 不解析 Codex `apply_patch`、Codex `patchUpdated` 或 shell 输出；Claude 仅解析原生 Edit 的冻结字段，并要求 matching
  非错误 result，Write/NotebookEdit/ApplyPatch 不作为 Diff 数据源；
- 不为缺少可靠 terminal Evidence 的 Runtime 显示入口、占位、`unavailable` 或猜测结果；
- 不添加“编辑了 N 个文件”聚合层，不把 presentation row 误建成新的 Canonical Activity；
- 不把文件 Activity 放在“已执行 N 项操作”集合之外，也不让组内左侧缩进压缩 inline diff；
- 不在一个整卡 Button 内嵌套文件 Button；卡片上半区和文件行必须是同级、边界清晰的交互区域；
- 不创建 Operation Diff Review，不让单文件行跳转文件或 Workspace Review；
- 不同时挂两套执行台；底部与右侧只改变同一详情的宿主，不复制 Evidence 或 selection；
- 不展示 raw repository path、Git ref/OID、Managed Blob identity、checkpoint chain 或 Undo；
- 不在打开旧卡片时重新执行 Git diff、读取当前工作区或跟随新的 Window；
- 不借本功能重做 App Shell、会话信息架构、主题、字体、图标或状态体系。
