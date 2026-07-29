---
document_type: ui-feature-design
authority: renderer-ui-feature
status: accepted
target_version: v0.21
implementation_status: in_progress
related_adr: ADR-0069
last_updated: 2026-07-29
---

# 长期记忆页设计

本文定义长期记忆页的信息架构、状态语言、交互和适配要求。领域语义以
[ADR-0068](../adr/0068-brokered-memory-retrieval-and-session-entrypoint.md)、
[ADR-0069](../adr/0069-single-effective-memory-and-scope-bounded-agent-mutation.md)和
[ADR-0070](../adr/0070-normalized-sqlite-memory-store-v2.md)的已接受合同为准。本文
冻结目标 UI，但不构成已实施证明。主题、Token、组件外观和通用无障碍要求以
[Meridian](meridian.md)为准。

`rovai-memory-claude-design` 只作为信息架构输入。生产设计保留其中清晰的 Scope
划分、成员/关系归属、列表与详情、提案抽屉，改用 Meridian Day/Night、系统无衬线
字体、紧凑工作表面和现有 React/Radix/CSS 技术栈。

v0.18 页面实现只代表旧合同基线。v0.21 的来源标签、Hearth Proposal、写入策略、
容量和操作收敛尚未实施或完成视觉验收。

## 1. 设计目标

页面必须让用户在几秒内回答：

1. 哪些长期记忆正在被使用？
2. 它属于所有伙伴、某位伙伴，还是两位伙伴之间？
3. 它由用户创建、伙伴形成，还是来自用户采纳的家园共识提议？最近由谁修订？
4. 哪些家园共识提议仍等待决定，哪些记忆只是到了建议复核时间？
5. 如何修订、停止沿用、重新沿用或遗忘一条记忆？

本轮同时解决四个现有问题：

- 长期记忆从设置页移到一级导航，成为日常协作对象；
- Scope 与治理状态不再混在一组互斥入口中；
- 伙伴来源只作为 UI 与审计事实，不再伪装成效力或优先级；
- 大卡片和阻塞式详情改为紧凑列表 + 固定详情 Workbench。

## 2. 稳定术语与状态映射

### 2.1 Scope

Scope 使用三个紧凑横向 Tab，不提供第四个“全部范围”Tab：

| 产品名称 | 领域 Scope | 说明 |
|---|---|---|
| 家园共识 | `hearth` | 对所有适用伙伴生效；伙伴提议必须经用户接受才成为 Memory |
| 伙伴经验 | `companion` | 归属于一位伙伴，只对该伙伴未来工作适用 |
| 协作默契 | `relationship` | 归属于一个无序伙伴对，并明确双方或单向适用 |

首次进入页面默认选择“家园共识”。同一 App 会话内离开再返回时保留 Scope、治理
过滤、搜索词、列表选择和滚动位置；主题切换不得重置这些 UI 状态。

### 2.2 治理过滤

Scope 下方提供独立的治理过滤：

```text
全部 / 伙伴来源 / 建议复核 / 已停止沿用
```

| 过滤 | 精确定义 |
|---|---|
| 全部 | 当前 Scope 中所有未遗忘 Memory，包括正在沿用与已停止沿用 |
| 伙伴来源 | 创建来源为伙伴直接形成，或由伙伴提议并经用户采纳的 Memory |
| 建议复核 | 正在沿用且 `reviewDue=true` 的 Memory，不改变其效力 |
| 已停止沿用 | Lifecycle 为 `retired` 的 Memory |

“伙伴来源”和“建议复核”可以同时成立。列表行同时显示来源与复核文字徽标，不用
颜色覆盖其中一个状态。来源不会因用户后来修订而改变；详情另行显示最近 Revision
Actor。已经 Forget 的正文不进入普通列表，只在现有审计/导出边界内保留无正文证明。

### 2.3 三种不同的用户治理对象

| 对象 | 是否已经生效 | 页面表达 | 是否需要用户决定后才生效 |
|---|---:|---|---:|
| Active Memory | 是，所有来源同等 | 普通列表；显示创建来源与最近 Revision Actor | 已经生效 |
| Pending Hearth Memory Proposal | 否 | “家园共识提议”抽屉 | 是，接受或编辑后接受；也可拒绝 |
| Review Due | 是 | Active Memory 上的“建议复核” | 否，只是提醒 |

页面不得出现 Memory Authority、`provisional`、`user_confirmed` 或“标记为已确认”。
“等待确认”只描述 Hearth Memory Proposal，不能描述 Companion/Relationship Memory。

## 3. 信息架构

### 3.1 一级导航

- 图标轨增加并激活独立“记忆”入口，顺序保持“新对话 / 成员 / 记忆 / 设置”。
- 有 pending Hearth Memory Proposal 时，记忆图标显示 attention 数量点；可访问名称
  包含精确数量。
- 进入长期记忆页时隐藏对话列，与成员页一致，只保留图标轨和全宽内容区。
- 设置分区不再包含“记忆”，但其他页面可以深链到指定 Memory 或指定提案。
- “查看”通知和图标数量点都打开一级长期记忆页，不先进入设置。

### 3.2 页面骨架

从上到下固定为：

```text
页面标题与全局操作
紧凑摘要条
伙伴写入策略条
家园共识提议提示条（仅有 pending 时）
Scope Tabs
治理过滤 + 当前 Scope 搜索
列表 | 固定详情
```

页面内容最大宽度 1400px。普通区不使用阴影；标题、摘要、策略、过滤与 Workbench
依靠 `--surface`、`--surface-subtle`、边界和间距建立层级。

## 4. 页面区域

### 4.1 页头

页头沿用 46px 上下文栏：

- 标题：“长期记忆”；
- 说明：“应用级 · 由你治理；伙伴可形成经验与默契，家园共识需你确认”；
- 右侧操作：“导出…” quiet、“＋ 新增长期记忆” primary。

“新增长期记忆”打开 Radix Dialog。用户保存后直接创建 Active Memory；对话框默认
使用当前 Scope，并只提供该 Scope 合法的 Kind、成员和 Relationship Direction。

### 4.2 紧凑摘要条

四项摘要共享一个横向表面和内部竖分隔，不做四张统计卡：

| 摘要 | 计数 |
|---|---|
| 正在沿用 | Lifecycle 为 `active` 的全部 Memory |
| 待确认家园共识提议 | status 为 `pending` 的 Hearth Memory Proposal |
| 伙伴来源 | 正在沿用且创建来源为伙伴直接形成或伙伴提议后由用户采纳 |
| 建议复核 | 正在沿用且 `reviewDue=true` 的 Memory |

计数使用 mono。摘要条只承担全局概览，不混入第四套筛选交互；提议抽屉、伙伴来源
和建议复核都使用下方已经存在的明确入口。

### 4.3 伙伴写入策略条

标题固定为：

```text
允许伙伴写入长期记忆
```

说明固定为以下完整文案，不再追加辅助段落：

```text
开启后，伙伴可以直接新增或修订自己的伙伴经验与当前协作默契，并提交等待你确认的家园共识提议。关闭只阻止之后的伙伴写入，不改变已有记忆和提议。
```

右侧绑定 `agentMemoryWritesEnabled`，使用有可访问名称的 `switch`，新安装默认开启。
切换提交期间禁用 Switch 并保留当前焦点；成功后 Toast：

- 开启：“已允许伙伴写入长期记忆。”
- 关闭：“已关闭伙伴写入；已有记忆和家园共识提议不会改变。”

失败时恢复服务端值并显示错误，不用乐观状态伪造成功。关闭开关不能从列表移除、
停止沿用或 Forget 任何已有 Memory，也不能自动拒绝 Hearth Memory Proposal。

### 4.4 家园共识提议提示与抽屉

仅在存在 pending Hearth Memory Proposal 时显示一行 attention 提示：

```text
N 条家园共识提议等待确认
这些提议尚未生效；接受或编辑后接受才会成为所有伙伴可用的长期记忆。
```

右侧操作“查看提议”。点击后打开基于 Radix Dialog 的右侧抽屉：

- 常规宽度 440px，最小窗口不超过可用内容宽度的 52%；
- 标题“家园共识提议”，副文案“接受后才会成为正在沿用的家园共识”；
- 每条固定显示 Hearth Scope、Kind、Retrieval Keys、完整候选正文、提议伙伴、
  来源 Camp/Run 和 stale 原因；
- 操作顺序为“拒绝” quiet danger、“编辑后接受” quiet、“接受” primary；
- stale Proposal 禁用两个接受操作并显示原因，仍允许拒绝；
- 批量操作只允许拒绝，不提供批量接受；
- 接受或拒绝后留在抽屉并把焦点移到下一条；最后一条处理完成后显示空状态，不强制
  关闭抽屉。

抽屉打开时约束焦点，`Escape` 关闭，关闭后焦点返回“查看提议”。遮罩使用
`--overlay`，不得用自制不可聚焦抽屉或阻塞式全屏页面。

### 4.5 Scope Tabs、过滤与搜索

三个 Scope 使用一行紧凑 Tab：

- 文字、稳定图标和 mono 数量同时显示；
- 激活态使用 `--brand-soft`、`--brand-ink` 和 2px 下边线；
- 数量统计各自 Scope 的未遗忘 Memory，不随治理过滤和搜索变化；
- 伙伴经验和协作默契不使用大尺寸说明卡。

下一行左侧是治理过滤 Chips，右侧是有可见 Label 的搜索框。搜索只作用于当前
Scope，匹配当前正文、成员名称、Relationship 双方、Kind 和可见来源元数据；占位
根据 Scope 显示“搜索家园共识 / 伙伴经验 / 协作默契”。

切换 Scope 会清空搜索词并恢复该 Scope 最近一次治理过滤和选中记录。切换治理过滤
保留搜索词。搜索无结果时不清除详情之外的页面状态。

### 4.6 列表 + 固定详情 Workbench

Workbench 是一个 1px `--line`、10px 圆角的单一表面：

- 左侧列表自适应，最小 480px；
- 右侧详情常规宽度 360px，可在 320–400px 内收缩，左边 1px `--line`；
- 两列各自滚动，详情不会以 Drawer 覆盖列表；
- 选择行使用 `--brand-soft` + 2px `--brand` 左边线；
- 行与详情都不使用阴影或大面积身份色。

#### 列表行

每行按稳定顺序显示：

1. Kind 徽标：`偏好 ○`、`约定 □`、`经验 ◇`，文字和形状双编码；
2. 一行标题或正文摘要；
3. 伙伴归属或 Relationship 身份；
4. Scope、Revision、更新时间和复核时间；
5. 来源徽标“伙伴形成 / 伙伴提议 · 你已采纳 / 用户创建”，以及条件性的
   “最近由伙伴修订”“建议复核”“已停止沿用”。

伙伴经验使用共享 `MemberAvatar(size="list")` + 姓名 + 角色。协作默契同时显示两位
伙伴，并使用：

- `A ↔ B · 双方适用`；
- `A → B · 仅对该方向适用`。

箭头必须有对应文字，不能只靠方向图形。成员身份色只用于头像环、姓名和小方点。

#### 详情

详情首屏必须显示：

- Scope 与 Kind；
- 完整正文；
- 伙伴归属，或完整 Relationship 双方和 Direction；
- Lifecycle 与复核计划；
- 当前 Revision、版本、创建/更新时间；
- 创建来源：用户创建、伙伴形成或伙伴提议后由用户采纳；
- 最近 Revision Actor，以及可用的来源 Camp/Run；
- Projection 问题（如有）。

所有正在沿用的 Memory 无论来源都提供主操作“修订”，以及更多菜单中的“安排复核”
“停止沿用”“遗忘”。不存在确认或提升优先级操作。已停止沿用的 Memory 以“重新沿用”
为主操作；重新沿用仍需 Core 重新检查普通容量和该 Memory 适用的 Agent-origin 容量。
Forget 保持 danger Dialog，必须明确正文清除不可逆，且不能声称删除执行引擎已读取
或外部导出的副本。

### 4.7 伙伴写入通知

每次成功直接写入都显示一条 `aria-live="polite"` 的非阻塞通知：

- 新增：“伙伴形成了 1 条伙伴经验。”或“伙伴形成了 1 条协作默契。”；
- 修订：“伙伴修订了 1 条长期记忆。”；
- 操作“查看”打开长期记忆页、切换到对应 Scope 并选中该 Memory；
- 提供关闭按钮，关闭不改变 Memory；
- 通知不包含完整 Memory 正文，避免敏感内容进入瞬时外围表面。

直接写入通知不能要求确认，也不能使用 attention/danger 外观。Hearth Proposal
使用独立文案“1 条家园共识提议等待确认”，其“查看”打开提议抽屉，不打开普通
Memory 详情。

## 5. 创建、修订与生命周期操作

### 5.1 用户新增

- 从当前 Scope 打开时预选该 Scope；
- 家园共识可选 Preference、Agreement、Lesson；
- 伙伴经验可选 Preference、Agreement、Lesson，并必须选择一位伙伴；
- 协作默契只可选 Agreement、Lesson，必须选择两位不同伙伴和 mutual/directed；
- directed 必须明确 Actor 与 Counterparty；
- 保存后直接形成 Active Memory，不经过 Proposal。

### 5.2 修订

Memory Scope、Kind、伙伴归属、Relationship pair 和 Direction 均不可通过修订
改变；要改变边界必须新增 Memory 并显式停止沿用旧 Memory。修订编辑完整正文与
Retrieval Keys、复核计划，使用当前
`memoryId + expectedVersion + baseRevisionId`。用户或伙伴发布的新 Revision 都立即
成为同等有效的 Current Revision；详情保留创建来源和逐 Revision Actor 审计。

### 5.3 停止沿用与遗忘

- “停止沿用”是可逆 Lifecycle 变化，不删除正文；
- “重新沿用”重新检查 Scope 总容量和适用的 Agent-origin 容量；
- “遗忘”执行不可逆正文清除并保留必要证明；
- 全局伙伴写入开关不替代以上任何逐条操作。

## 6. Loading、Empty、Error 与并发

- 初次 Loading 使用摘要、策略和 Workbench 的稳定骨架，不显示虚构计数。
- 当前 Scope 完全没有 Memory 时显示 Scope-specific 空状态和“新增记忆”操作。
- 仅过滤/搜索无结果时显示“没有符合条件的记忆”，并提供“清除筛选”。
- pending Hearth Proposal 为零时隐藏提示条；已打开抽屉在最后一条处理后显示完成状态。
- 顶层读取失败保留页头并提供“重试”；单个操作失败保留当前选择、草稿和焦点。
- 所有写操作使用服务端 version/CAS。冲突后刷新对应记录，在详情内说明“内容已被
  更新，请重新检查”，不得用 Renderer 本地值覆盖。
- Projection 问题不把已提交的 SQLite Memory 回滚；详情显示可恢复的诊断入口。

## 7. 主题、适配与无障碍

- Day/Night 使用完全相同的信息架构、尺寸、文案和操作。
- 使用系统无衬线字体、现有 Meridian Token 和共享成员头像组件；不引入暖米色
  Claude 调色、衬线标题、卡片墙、玻璃、辉光或页面级阴影。
- 普通正文达到 WCAG 2.2 AA 4.5:1，边界、焦点和状态达到 3:1；状态同时使用文字
  与形状/图标。
- `switch`、Scope Tabs、治理过滤、列表选择、菜单、Dialog 和 Drawer 都有可访问
  名称、可见焦点和与视觉一致的键盘顺序。
- `prefers-reduced-motion` 下取消 Drawer 位移动画和 Toast 滑入，不丢状态反馈。

几何要求：

| 窗口 | 布局 |
|---|---|
| `1440×920` | 52/176px 图标轨 + 最大 1400px 内容；列表与 360px 详情并列 |
| `1040×700` | 仍保持双列；详情最低 320px，列表最低 480px；上方控制允许换行 |

两种尺寸都不得出现整页横向滚动。Workbench 使用剩余高度，列表和详情独立滚动；
页头、策略和当前过滤不应被详情内容挤出视口。

## 8. 读取模型与事件要求

实现可以调整字段命名，但一个原子页面快照至少需要：

- 策略启用值、version 和写入状态；
- 四项摘要计数；
- 每条 Memory 的 Scope、Kind、Lifecycle、创建来源、当前 Revision Actor、Review、
  Current Revision、版本、身份归属和可展示来源；
- pending Hearth Memory Proposal 的完整候选、Retrieval Keys、Kind、来源、版本和
  stale 原因；
- Projection 问题；
- 可定位到 `memoryId` 的直接伙伴写入事件，以及可定位到 `proposalId` 的 Hearth
  Proposal 事件。

页面必须从 Core 权威读取这些状态，不能从标签文字或前端历史推断 Lifecycle、
创建来源、Revision Actor、Agent-origin 容量或 pending 数量。

## 9. 设计验收

后续实现至少验证：

- 默认开启与关闭后只影响未来伙伴写入和 Hearth Proposal；
- Companion 三种合法 Kind、Relationship 两种合法 Kind与双方向展示；
- Companion/Relationship 直接写入立即进入列表且不进入 Proposal Drawer；
- Hearth Proposal 的接受、编辑后接受、拒绝和 stale 路径；
- 所有 Active Memory 来源同等生效，且页面不存在确认或 Authority 操作；
- Scope 与治理过滤正交，搜索只作用于当前 Scope；
- Relationship pair 与 Direction 在列表、详情中始终可见；
- Day/Night × `1440×920` / `1040×700` × mouse/keyboard；
- Drawer 焦点约束、Escape、焦点返回、Toast `aria-live` 与 reduced motion；
- Loading、空 Scope、过滤无结果、读取失败、CAS 冲突和 Projection 问题。

## 10. 非目标

- 不改变 Hearth、Companion、Relationship 的领域边界或合法 Kind。
- 不允许 Agent 直接写 Hearth，或执行退役、重新沿用、Supersession、Review、
  Proposal Decision 或 Forget。
- 不把伙伴来源 Memory 提升为权限、审批、安全决定或用户原话。
- 不增加非 Hearth Proposal、批量接受、自动合并、模型置信度、投票或时间自动接受。
- 不为未发布的旧策略字段、默认值或 acknowledgement 流程保留 UI/Contract 兼容。
- 不复制外部原型的视觉主题、字体、静态假数据或自制 Drawer 实现。
