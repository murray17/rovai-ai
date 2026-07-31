---
document_type: ui-design-system
authority: renderer-ui-detail
status: accepted
design_direction: arctic-dawn-v3
target_version: v0.25
implementation_status: complete
last_updated: 2026-07-31
---

# Arctic Dawn V3 设计规范

本文是 Arctic Dawn Renderer 的唯一视觉与交互详规。它把 V3 原型中有效的
产品方向、访谈决定及现有领域/安全合同收敛为可实施规范。设计已形成共同理解；
用户已于 2026-07-30 明确授权生产实现；首轮范围以及随后确认的导航、设置覆盖与
空 Camp 欢迎状态均已完成。

## 权威边界

1. 有效 ADR、`CONTEXT.md`、Core 合同和安全边界决定产品语义与可执行行为。
2. 本文决定 Renderer 的视觉、信息架构、产品文案映射和交互呈现。
3. `rovai-arctic-dawn-v3-package` 是全局设计输入；
   `rovai-arctic-dawn-members-v4.html` 是成员页与 Member Identity Dialog 的后续
   定向输入；`rovai-navigation-settings-empty-v7-package` 后续覆盖统一侧栏导航、
   设置导航投影和空 Camp 欢迎状态。HTML、静态假数据、旧词汇、原型切换器和演示
   事件处理器不是生产实现。
4. 现有代码、Migration 和测试只证明当前实现事实，不能反向覆盖已确认的新设计。

## 设计合同

### 设计方向切换

- Arctic Dawn V3 取代 Meridian 中与其冲突的视觉和信息架构。
- 原型必须在现有 React、Radix 和 CSS Variables 技术栈中重建，不直接复制单文件
  HTML。
- 原型出现的用户词汇必须映射到现有领域语言：产品界面使用“成员”“执行引擎”等
  已确认术语；领域代码继续使用 Camp、AgentProfile、Product Runtime 等稳定名称。
- 与领域合同冲突的演示行为不进入产品。例如，用户点击原型中的“发送”不能绕过
  New Conversation Draft 与原子 Camp Creation。

### 版本页面范围

v0.24 必须在一个版本内收敛下列生产界面：

- Quick Chat 与 Camp 对话工作区；
- 成员与长期记忆；
- 设置中的技能、MCP、执行引擎、外观和诊断；
- 创建新对话 Dialog；
- 上述页面共用的 App Shell、导航、状态、浮层和响应式行为。

实施可以分检查点推进，但版本验收不允许上述范围继续混用 Meridian 与 Arctic Dawn
两套设计。原型顶部的页面/运行态切换器仅用于浏览设计稿，不是产品导航。

### 主题合同与实施顺序

主题偏好类型保持不变：

```ts
type ThemePreference = "system" | "day" | "night"
type ResolvedTheme = "day" | "night"
```

- Arctic Dawn V3 原型是 Day 的设计基准，先覆盖本版本全部页面。
- Night 保留为正式主题能力，但最终视觉等待用户后续提供独立设计稿。
- 实现者不得把 Day Token 机械反色或自行补全为最终 Night，也不得把 Meridian Night
  重新命名后视作已经完成的 Arctic Dawn Night。
- v0.24 中 `system`、`day`、`night` 三种偏好全部解析为 `ResolvedTheme = "day"`。
  选择 `night` 或深色系统下的 `system` 都渲染 Arctic Dawn Day，不加载 Meridian
  Night Token。
- 偏好值可以继续持久化，但本版本不承诺旧 Night 视觉兼容。全界面 Day 完成即可
  满足 v0.24 主题范围；后续 Night 设计与实现另开版本。

### Arctic Dawn Day Token

Arctic Dawn 使用冷纸白、北极星靛蓝、低饱和极光绿与极少量晨曦暖色。下列 Day
Token 是生产基准；原型中对比度不足的 `--faint` 和控件边界已经校正：

| Token | 值 | 用途 |
|---|---:|---|
| `--canvas` | `#F2F4F1` | App 背景 |
| `--surface` | `#FBFCFA` | 主阅读与工作表面 |
| `--surface-raised` | `#FFFFFF` | Dialog、Popover、输入和浮层 |
| `--surface-subtle` | `#F6F7F3` | 侧栏、Inspector、次级面板 |
| `--surface-muted` | `#ECEFE9` | Hover、Disabled、弱分组 |
| `--surface-selected` | `#E9ECF7` | 当前 Camp、Tab 和列表选择 |
| `--ink` | `#202438` | 主文字 |
| `--muted` | `#5F6678` | 次级正文 |
| `--faint` | `#6E7382` | 小字号元数据；替代原型中不达 AA 的 `#83899A` |
| `--line` | `#DDE1DA` | 装饰分隔与非交互边界 |
| `--line-strong` | `#CBD1C8` | 强结构边界 |
| `--control-line` | `#8B9389` | 必须可辨认的输入与交互控件边界 |
| `--brand` | `#343B72` | 品牌、主要操作、稳定选择 |
| `--brand-hover` | `#29305F` | 主要操作 Hover |
| `--brand-contrast` | `#FFFFFF` | Brand 表面上的文字 |
| `--brand-soft` | `#ECEEF8` | 品牌弱背景 |
| `--brand-ink` | `#343B72` | Brand-soft 上的文字和图标 |
| `--aurora` | `#719D94` | 低频品牌图形与运行中的非语义装饰 |
| `--aurora-soft` | `#E7F0EC` | 极光弱背景 |
| `--violet` | `#9082B4` | 低频品牌图形 |
| `--violet-soft` | `#EFEBF6` | 紫色弱背景 |
| `--ember` | `#D3A45F` | Quick Chat 品牌温度，不表示警告 |
| `--ember-soft` | `#F8EDDA` | 晨曦弱背景 |
| `--focus` | `#4D83A2` | Focus ring |
| `--overlay` | `rgba(28, 32, 43, 0.42)` | Modal 遮罩 |
| `--shadow-float` | `0 18px 56px rgba(38, 45, 58, 0.12)` | 真正浮层 |

状态色与品牌色、成员身份色严格分离：

| 状态 | 前景 | 弱背景 |
|---|---:|---:|
| `success` | `#3E775C` | `#E7F1EA` |
| `attention` | `#8A6226` | `#F8EDDA` |
| `danger` | `#A24C46` | `#F7E6E3` |
| `info` | `#416C86` | `#E5EEF3` |
| `neutral` | `#5F6678` | `#ECEFE9` |

- `attention` 专用于等待用户、待审批和需要处理；`ember` 不能替代它。
- `danger` 专用于停止、永久删除、遗忘和确定失败；普通停用不使用 danger。
- 状态必须同时包含文字与图标、形状或稳定位置，不能只靠颜色。
- 交互控件若没有其他可辨认边界，必须使用 `--control-line`；浅色 `--line` 不能单独
  承担组件边界。

命令、文件、Diff、审计、结构化 JSON 和 Tool Call 详情使用独立中性证据 Token：

| Token | 值 |
|---|---:|
| `--evidence-canvas` | `#F5F6F4` |
| `--evidence-surface` | `#FFFFFF` |
| `--evidence-ink` | `#252A36` |
| `--evidence-muted` | `#5F6678` |
| `--evidence-line` | `#D5DAD3` |
| `--diff-add` / `--diff-add-soft` | `#2F694D` / `#E4F0E8` |
| `--diff-remove` / `--diff-remove-soft` | `#8F3F3A` / `#F5E4E1` |
| `--diff-hunk-soft` | `#E5ECEB` |

证据区不继承品牌渐变、成员底色或插画。Diff 还必须使用 `+/-`、行号与结构，不能只
依靠红绿色。

### 字体、密度与表面

- 正文采用系统无衬线栈：
  `-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif`。
- 等宽采用 `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`，
  只用于命令、路径、时间、稳定 ID、计数和短状态。
- 正文基准 13px；长正文 12.5–13px、`line-height: 1.6–1.7`；次级文字不得小于
  10.5px；9–10px 只用于短元数据且必须满足对比度。
- 间距只使用 `4 / 8 / 12 / 16 / 20 / 24 / 32px` 系列。控件圆角 6–8px，
  工作表面 10–11px，Dialog 15px。
- 普通面板、消息、列表行和 Inspector 不使用阴影；阴影只属于 Dialog、Popover
  和固定审批面板等真正浮层。
- 工作区不是卡片墙。优先使用单一表面、内部分隔、列表行和选择态；页级大卡片不能
  代替信息层级。

### 成员身份与图像

- `AgentProfile.id` 稳定映射 `--identity-1..8`：
  `#A65F4A / #39777A / #74628F / #9A6A32 / #4F729B / #8A5C75 /
  #547245 / #8C6146`。
- 身份色只进入头像环、名称或小型身份点，不表示运行、权限、审批、Presence、
  Lead 或 Capability。
- 一个受控 `avatarRef` 同时解析 [ADR-0056](../adr/0056-controlled-member-avatar-assets.md)
  定义的完整 portrait 与紧凑 icon，不增加第二个 Profile 字段。完整半身照只用于
  成员详情、身份编辑和外观预设；圆形 icon 用于名册、详情标题、成员选择、`@`
  候选和消息身份位。
- 两种 rendition 必须来自同一内置或受管复合资产。未知引用、缺文件、完整性失败或
  图片加载失败统一回退为受控字符头像/肖像占位，不能解释任意路径或 URL。
- 工作区背景、Quick Chat 品牌以外的内容、命令、Diff、Task、审批、审计、错误、
  恢复、Memory 正文和设置页禁止人物插画或图片纹理。

### A2A 会话消息

- `team.post_message` 的已投递正文进入本地用户可见的 Camp 会话，按真实发送者显示
  `发送者 → @接收者`，并直接展示消息正文。
- A2A 正文的权威对象仍是 InboxMessage，不复制为 CampMessage，不进入公共 FTS、
  摘要、Shared Conversation 或无关 Agent 上下文。
- 会话不为成功路径补造“协作请求已送达”“执行中”“协作结果已返回”等系统卡或
  状态徽标。回复以回复者自己的消息表达，不再附加“已返回”。
- Delivery、AgentRun、失败与恢复状态属于 Activity/Audit；它们不得冒充发送者发言。
- 公共 CampMessage 与已投递 InboxMessage 按持久事件顺序合并，禁止按角色或 Renderer
  到达时间重排。

### 统一侧栏置顶

- “置顶”是生产功能。
- Project 与 Camp 都提供独立的置顶/取消置顶操作。
- 置顶目标在统一侧栏顶部的“置顶”分区中提供快捷入口。
- 置顶状态由 Electron Main 作为应用级 UI 偏好原子保存到
  `userData/navigation.json`，跨 App 重启恢复。
- 置顶不写入 Core SQLite，不产生 Camp 领域事件或审计，也不为 Project 建立独立
  identity、table 或 lifecycle。
- 置顶后，目标从普通 Project/Camp 分组移到“置顶”，不在两个位置重复显示；取消
  置顶后按最新 Navigation Read Side 返回原分组。
- 置顶 Project 显示完整 Project 分组及其 Camp 列表。
- 置顶区先排列 Camp、后排列 Project；每种类型内部按置顶时间正序排列。
- 不增加置顶拖拽排序。取消后重新置顶等同于一次新置顶，排到该类型末尾。
- 每次读取 Navigation 时清理无法解析的置顶记录：永久删除的 Camp 不再置顶；一个
  canonical Project 不再包含任何 Camp 时也不再置顶。Electron Main 将清理后的
  状态原子写回 `navigation.json`。
- Camp 重命名和 Project 展示名变化从最新 Read Side 投影，不改变稳定置顶键。
- Camp 置顶键使用 Camp ID；Project 置顶键使用权威
  `directory:<canonical-project-path>`。记录至少保存 `kind / targetKey / pinnedAt`。
- `navigation.json` 只保存该应用级 UI 偏好并使用当前用户权限与原子替换；不得把
  Camp 标题、Project 展示名或整份 Navigation 快照复制进去。

### 统一侧栏结构

- App Shell 使用固定 270px 统一侧栏，不再拆分为可变宽图标轨与 224px 对话列。
- Quick Chat、Camp、成员和长期记忆显示普通导航；设置页保留同一 270px 侧栏槽位，
  但用设置分类完整覆盖普通导航，不同时显示两套导航。
- 品牌区不显示原型中的 `•••`“个人菜单”。在没有真实账号/资料命令前，不渲染死
  按钮或占位菜单。
- 普通与设置侧栏的可见字标统一使用 `Rovai AI`，不显示“北极晨光 · Workspace”
  或其他副标题。正式产品名、窗口标题、安装包、关于页、应用数据和内部 namespace
  继续使用 `Rovai-ai`，遵守 ADR-0048 与 ADR-0078。
- 删除图标轨的 52/176px 展开状态、拖拽 separator、双击/方向键调宽以及
  `rovai.rail-expanded` 等旧持久化状态，不做迁移。

统一侧栏从上到下固定为：

1. 品牌：受控 Logo 与 `Rovai AI`，无副标题，右侧无操作；
2. 一级入口：“新对话 / 成员 / 长期记忆”；
3. “跳转到对话…”入口，点击或 `Command/Ctrl+K` 打开 Camp 快速跳转；
4. “置顶”区，仅在存在有效置顶时显示；
5. “项目”区：directory Project 在前，文件夹样式“快速对话”投影固定在末尾；
6. 底部只保留“设置”。

- Camp 快速跳转只导航到按标题匹配的 Camp，不冒充消息全文检索。
- 普通项目式分组（含 Quick Chat 投影）默认直接展示最近 5 个 Camp；“显示更多”按
  现有 Navigation 排序加载剩余记录。分组不使用旧下拉箭头或折叠状态。
- Camp 行显示标题、运行/未读完成等权威 Navigation marker、直接置顶按钮和行菜单。
  置顶按钮与行菜单在 Hover、Focus-within 和触摸替代路径下都可达。
- Project 行显示文件夹、展示名和直接置顶按钮；Project 不是可选择的领域对象，
  点击不创建独立 Project workspace。
- Sidebar Camp 行菜单只包含已存在的 Camp 级命令，例如重命名、永久删除；操作失败
  保留当前行和焦点。不存在 archive、trash 或顶栏重复入口。
- 删除侧栏 Core 健康摘要；Health Snapshot、探测、诊断页和导出能力继续保留，
  用户通过“设置 → 诊断”访问。

### Quick Chat 与新对话

- 统一侧栏“新对话”是单击操作，直接在当前页面上打开创建新对话 Dialog。
- Quick Chat 只显示品牌落地内容和“继续未完成的事”，不显示可直接发送的 Composer。
- 创建 Dialog 接受 New Conversation Draft 并调用原子 Camp Creation；成功后才
  进入已持久化 Camp 并聚焦正常 Composer。
- 原型中落地页输入后直接“发送”、双击导航才打开 Dialog 等演示事件不进入产品。
- Quick Chat 页面不再叠加通用 AppHeader，使用居中的品牌舞台：
  `ARCTIC DAWN · QUICK CHAT`、标题“在晨光里，开始下一段协作”及简短说明。
- “继续未完成的事”最多显示 Navigation Read Side 全局最近 5 个 Camp，并保留
  `loading / unread_completed / none` 等已有 marker 与相对时间。这个标题是恢复工作
  的产品文案，不新增 `unfinished` 领域状态，也不从 Task 或消息正文猜测是否完成。
- 没有可恢复 Camp 时显示简短空状态和“新对话”操作；空状态仍不能内嵌 Composer。
- Quick Chat 品牌 SVG 可以使用星、地平线和一个低频 `ember` 点，但不加载外部图片、
  等级、RPG 装饰或持续动画。

### 快速对话与 Project 分组

- 产品中文使用“快速对话”，英文使用 `Quick Chat`。
- 普通侧栏只有“置顶 / 项目”两个会话分区。“项目”区先显示按 canonical
  `projectPath` 聚合的 directory Projects，最后显示文件夹样式的“快速对话”。
- “快速对话”只是 Renderer 项目式投影，不进入 `ProjectNavigationGroup`，不提供
  整组 Project 置顶；其中每个 Camp 仍可独立置顶。
- Navigation Snapshot 继续分别读取 `quickChat` 与 `projects`，Renderer 只在渲染时
  合并排序；不得修改 binding、IPC 或 Core 领域模型。
- 内部标识遵守 ADR-0074：`QuickChat` / `quick_chat` / `quickChat` /
  `quick-chat`，不保留旧别名或兼容读取。
- UI、空状态、Dialog、无障碍名称、测试名和 CSS class 禁止再出现“大厅”或
  `Lobby`。历史版本快照中的文字不构成当前产品文案。

### Camp 执行过程

- Camp 主区使用 `50px Header + minmax(0, 1fr) 阅读区 + 审批停靠区 + Composer`。
  阅读列宽为 `min(790px, 可用宽度 - 54px)`，消息正文最大 690px；窄窗口只减少
  两侧留白，不改变信息顺序。
- 主阅读流使用同向左对齐布局。用户消息、Agent 消息和 A2A 消息按持久顺序连续
  排列，以头像、显示名称、时间及消息表面共同表达身份与类型。
- 用户消息使用弱 `brand-soft` 表面；Agent 最终正文保持开放阅读表面。成员身份色
  只点缀头像和名称，不给整段消息铺身份底色。
- 用户消息为精确纯文本；Agent 最终回复和 Runtime 公开叙述使用安全 GFM，禁止
  raw HTML、脚本、危险 URL 和远程嵌入。Tool/文件/命令输出只走结构化证据组件。
- 每条用户和 Agent 正文可选择并提供键盘可达的复制操作；复制使用当前显示名称，
  不暴露内部 handle、Inbox ID、Run ID 或路由标识。
- 日期边界使用横向分隔线。删除 Meridian 的点状竖向时间轨、附着节点及 EXEC
  菱形节点，不提供旧节点体系兼容样式。
- Task 与其他非审批结构化边界内容继续出现在其真实发生位置，不因取消竖轨而脱离
  会话顺序。Approval 不进入消息区或执行过程。
- 会话时间线不显示 `Thinking / Progress / Steps / Tool` 分区标题、分区计数或
  `DONE` 标签。
- Agent 的公开叙述与 Tool Call 摘要在运行期间按发生顺序平铺，不按内部阶段重新
  分组。
- 文件读取、文件写入、命令执行及其错误都是 Tool Call。默认行只显示动作图标、
  本地化摘要和必要状态，例如“读取文件”“运行命令”或“运行命令 · 失败”；不得
  把命令或错误升级为独立时间线卡。
- Tool Call 的参数、精确范围、`cwd`、退出码、时长、输出和失败原因在数据存在时
  仍须结构化保留并可按需展开。轻量摘要不能以丢失证据为代价。
- Tool Call 自身的失败属于该 Tool Call；Runtime 崩溃、执行准入拒绝、恢复不确定
  等没有对应 Tool Call 的系统失败仍按其真实 Run/Pending Intent 状态进入活动、
  审计或就地错误提示，不得为了视觉统一伪造成 Tool Call。
- AgentRun 运行中直接显示已经由 Runtime 报告为公开的叙述与动作；不显示隐藏思维链，
  不在 Runtime 没有报告时补造步骤。终态后折叠不改变持久证据或 Inspector 状态。
- Task 继续使用独立的紧凑边界事件，冻结事件发生时的标题、状态变化、负责人和
  时间；点击后才读取 Inspector 中的当前 Task。
- Approval 保留独立交互语义，但不混入消息区。所有 pending Approval 固定显示在
  Composer 正上方的非模态停靠式审批弹框（Approval Dock）；单项直接展示请求，多项
  聚合为“N 项待审批”并按权威顺序提供逐项展开与处理。弹框高度有上限并内部滚动，
  不能覆盖消息或把 Composer 推出窗口。
- Renderer 只能呈现发起请求的 Agent Runtime 实际返回的选项、scope、lifetime、
  后果与阻塞影响，不建立假想的跨 Runtime 通用审批档位，也不得因视觉统一改写原生
  option identity。
- 进入终态后，过程内容统一收进一个默认折叠入口，摘要格式为
  `处理过程 · {本地化耗时}`，例如“处理过程 · 2分18秒”。
- 不使用英文 `Worked for …`；Agent 最终回复位于折叠入口之外并保持直接可见。
- [会话事件交互样例](examples/arctic-dawn-conversation-events.html)用于评审上述
  层级与展开行为；示例数据和某个 Runtime 的审批按钮不构成跨 Runtime 合同。

### Camp Composer

- Pending Approval 弹框固定在 Composer 正上方，属于输入停靠区而非会话时间线、
  Dialog 或全屏 Overlay。多个成员同时请求审批时显示聚合计数，例如“2 项待审批”，
  并同时保留成员身份、Runtime、请求范围和每一项的独立决定状态。
- 审批弹框常规最大高度 260px，超出后内部滚动；标题行显示 pending 总数和涉及成员，
  下方按权威请求顺序切换单项详情。解决一项后从 pending 队列移除并聚焦下一项；
  最后一项解决后整个弹框消失并把焦点返回 Composer 或原触发控件。
- 审批弹框与 Inspector“审批”页读取同一对象和同一决定命令；两个入口不能创建两份
  本地状态、改变顺序或重复提交。Header 的审批数也来自同一队列。

#### Composer 附件

- 不显示回形针或文件选择器。用户通过 Paste 文件/截图或把普通文件拖进 Composer
  接入附件；纯文本 Paste 必须保持原生输入。
- Composer 顶部使用 52px 横向队列，图片显示方形安全预览，其他文件显示类型、名称
  和大小；队列溢出时只在自身横向滚动。
- `preparing` 显示“正在安全接入…”，`error` 显示可移除错误。任一项准备中或失败时
  整条消息不可发送；不提供部分发送。
- 正文仍必须非空，不用合成文案代替用户消息。导航或重启后从 Core 恢复正文和 Ready
  附件；发送失败保留，成功后同时清空。
- 发送后的附件在用户正文下方纵向冻结。安全栅格图片可通过键盘打开 Radix Lightbox；
  SVG、HTML、脚本、可执行文件和未知类型永不作为 Renderer 内容执行或渲染。
- Renderer 不显示稳定绝对路径。Agent Runtime 通过自己的冻结上下文获得公共 Camp
  Attachment Path，此路径不是 Project 或 Worktree 内容。

### 空 Camp 欢迎状态

- 当 Camp 尚无公共/A2A 消息、AgentRun 或其他时间线内容时，用完整欢迎状态替换
  “这段 Camp 还没有消息。”单行占位；出现第一项权威内容后欢迎状态立即退出。
- 欢迎状态保持 Camp Header、消息滚动区、Composer、Approval Dock 与 Inspector
  原结构，不新增页面、领域状态、Draft 或第二套发送入口。
- 内容包含轻量 Arctic Dawn 星与地平线图形、`ARCTIC DAWN · NEW CAMP`、标题
  “开始这段协作”和简短说明。图形只使用现有 Token/SVG，不加载外部图片。
- 上下文摘要从当前事实计算：Quick Chat/Project 展示名、Default Lead、在队成员数和
  执行引擎就绪摘要。缺失、部分就绪或未就绪必须使用真实文案，不能补造 Ready。
- 提供三个起步建议：“先了解项目 / 整理成任务 / 检查工作区”。点击只把对应示例
  需求写入现有 Camp Composer 并聚焦，不自动发送、不改变寻址、不创建 Task 或 Run。
- 起步建议使用紧凑边界和单一表面；在窄窗口或 200% Zoom 下从三列变为单列，不能
  把 Composer 或 Inspector 推出视口。
- Inspector 的空状态按各 Tab 说明尚无数据。Approval 文案必须说明请求会固定出现
  在 Composer 正上方并可在 Inspector 查看，禁止声称进入时间线。
- 正常发送态使用 `Enter` 提交，`Shift+Enter` 插入换行；不要求
  `Command/Ctrl+Enter`，也不渲染原型中的 `⌘↵` 提示。
- 输入法组合态不得提交；`@` 候选打开时，`Enter` 先选择候选，不能同时发送。
- 当前 CampTurn 仍可停止时，发送位置显示明确的 danger“停止”按钮；此时
  `Enter` 不触发停止，用户必须点击按钮确认该动作。
- 点击停止后 Renderer 立即以本地 Turn ID 进入“正在停止…”，只禁用重复停止，不
  全局锁定导航或其他 UI；收到 Core `agent_run.cancelled` 后立即刷新一次当前 Camp
  Snapshot，并以权威终态退出该本地状态。
- 本地停止状态必须覆盖该 Turn 的全部非终态 AgentRun：消息区运行卡和 Inspector
  立即显示“正在停止…”，停止运行中动画和强调。草稿继续可编辑，但权威终态返回前
  不显示或触发下一轮发送。
- Pending Execution Intent 解析期间保留草稿并显示“正在检查执行引擎…”和
  “取消发送”；解析失败不创建 CampMessage/CampTurn/AgentRun，错误就地说明且草稿
  继续可编辑。
- Composer 随内容自动增高到有界最大值，超过后内部滚动；发送、停止、正在停止、
  解析中和不可提交状态保持相同布局，避免按钮跳动。
- 不保留两套提交快捷键。可见快捷键提示只显示 `Enter`。

### Camp 右侧详情栏（Inspector）

- Camp 右侧详情栏使用五个手动激活的页签：
  “活动 / 任务 / 上下文 / 审批 / 审计”。
- “活动”显示运行动态、等待与终态；“审计”显示不可混入聊天或普通活动的时间、
  Actor、动作、目标、结果和证据。
- “活动”使用“运行中 / 等待审批 / 已完成 / 失败 / 已停止 / 恢复中”等本地化文字，
  不显示原型的 `DONE`；流式更新合并播报，不能通过 `aria-live` 逐字朗读。
- “任务”显示当前 Task 列表、负责人、状态与进度，并承担从历史 Task 边界事件进入
  当前状态的目标。
- “任务”“审批”分别投影当前 Task 与 Approval 权威状态；“审批”页与 Composer
  上方固定面板读取同一 pending 队列，不复制或重排决定。计数徽标只在数量大于 0
  时显示。
- “上下文”必须来自当前 Camp 的生产 Read Side；原型中的 Project 名、Design
  route 与约束文字只是演示数据，不得硬编码或当作用户内容。
- “审计”按时间显示 Actor、动作、目标、结果和证据引用；普通叙述、A2A 正文和
  Tool 输出不能复制成审计聊天。
- 切换页签不得改变 Camp、草稿、时间线滚动或运行状态；页签必须具备完整
  `tablist / tab / tabpanel` 语义和键盘操作。
- 窗口宽度不低于 1180px 时详情栏固定为 310px；在
  `1040–1179px` 时固定为 260px。它在应用支持的窗口范围内始终可见，不变成
  Drawer、Overlay 或折叠栏。
- 详情栏不提供拖拽、双击或键盘调宽。统一侧栏仍固定 270px；响应式变化只作用于
  详情栏与中央内容的内部排版。

### Camp 顶栏与停止入口

- Header 左侧显示“Quick Chat/Project 展示名 › Camp 标题”，标题截断但完整值可访问；
  旁边使用“第 N 天”并由 Camp 创建时间纯函数派生。
- Camp 顶栏右侧只承载 Run、待审批等状态摘要，不渲染“停止”按钮或 `•••`
  操作菜单。
- 没有 Active Run 或 pending Approval 时不渲染空徽标。状态摘要可以导航到对应
  Inspector Tab，但不能在 Header 直接执行停止、审批、置顶、重命名或删除。
- 停止入口只占用 Composer 的发送位置，调用当前 CampTurn 整棵 AgentRun/A2A
  执行树的停止命令。进入停止流程后立即显示“正在停止…”并防止重复请求；停止 ACK
  不等待 Navigation 重载、Camp 重新激活或 Git observation。多个 Runtime interrupt
  并行执行并使用独立短 deadline；超时后必须强制终止或完成可靠 fencing。
- 置顶/取消置顶使用侧栏 Camp 行的快捷按钮；重命名和删除使用同一行的菜单。
  顶栏不重复这些操作。

## 成员

### 页面结构

- 成员是统一侧栏一级页面，不隐藏侧栏，也不叠加通用 AppHeader。
- 页面 Header 高度至少 64px：标题“成员”、稳定说明；右侧只保留
  “＋ 新增成员”primary，Member Order 不再使用单独的页级模式按钮。
- 主体是填满剩余高度的双栏 Workbench，常规为 272px 名册 + 自适应详情；
  `1040–1179px` 时名册 250px。两栏独立滚动，不变成成员卡片墙，也不为普通
  Workbench 添加浮层阴影。
- 普通模式的名册只分“在队”和“暂时离队”。`removed` 不显示，也不存在“已移除”
  分组。Presence 和执行引擎状态是两个独立维度。
- 名册行显示共享头像、唯一 Member Name、角色、明确 Runtime Readiness 文字和状态
  图标；不得显示内部 handle，也不能因未配置执行引擎而用整行低透明度降低对比度。

### Member Order

- 名册在普通“在队 / 暂时离队”分组中直接显示拖拽把手和简短说明，不再切换到独立
  排序模式。拖拽只改变权威 Member Order，不改变成员所属 Presence 分组。
- 拖拽不能成为唯一输入方式；聚焦成员行或把手时必须提供等价的键盘“上移/下移”
  操作与明确可访问名称。提交 `agents.reorder` 失败时恢复服务端顺序、宣布错误并
  保留原焦点。
- Member Order 只影响展示、新 Camp 初始成员顺序和失效 Lead 的未来修复；不改变
  Presence、当前有效 Lead、权限、能力或执行优先级。

### 成员详情

- 未选择时显示解释性空状态；选择后的首个身份区采用
  `minmax(190px, 240px) + minmax(0, 1fr)`：左侧显示 `4:5` 完整半身照，右侧标题行
  使用 50px 圆形 icon、Member Name、角色/身份说明和“编辑身份”。窄窗口时 portrait
  列收窄到约 190px，不裁掉主体。
- 身份区继续显示长期角色说明、可折叠 instructions 与 Presence 操作；之后依次是
  Agent Runtime、Memory Capability/高级摘要设置和危险区。不得显示或允许编辑内部
  handle，也不增加 Camp 数、消息数、长期记忆数或能力评分统计卡。
- Presence 操作直接使用“暂时离队 / 归队”，不弹出 Camp successor Dialog；
  Runtime 配置变化不能自动改变 Presence。
- “Agent运行时”区域的普通选择只展示 Product Runtime，不展示 Installation ID、
  可执行路径、fingerprint 或发现来源。模型、模型参数和权限由所选 Adapter 的真实
  descriptor 渲染；不得虚构跨 Runtime 通用档位。
- 当前 Runtime 未解析、需要登录、快照过期或缺少安全默认值时显示精确 blocker 与
  “前往执行引擎”修复入口，不回退到其他 Runtime。
- “允许写入长期记忆”是成员自身未来 AgentRun 的 Capability 配置，与应用级
  Agent Memory Write Policy 分离；关闭任一层都不能修改已有 Memory。
- “高级设置”默认折叠，只在展开后读取 Camp 共享摘要模型；可选自动回退、当前成员
  Runtime 默认模型或当前成员 Runtime 提供的明确模型，不增加独立“上下文”设置页。
- 详情内部在可用宽度足够时两列，不足时单列；身份、Runtime、Memory 能力、高级设置
  和危险区的阅读顺序保持一致。

### 创建、编辑与移除

- 创建/编辑使用宽度不超过 960px、受视口高度约束并可内部滚动的 Radix Dialog。
  常规是 `310–350px` 外观编辑列 + 自适应身份字段列；有效宽度不足或 200% Zoom
  时改为单列，Footer 操作始终可达。
- 外观编辑从同一源图同时生成完整半身照和独立圆形 icon。原图作为 portrait；
  圆形取景结果用于名册、消息、提及和选择器，但两者仍由一个受控 `avatarRef`
  指向同一复合资产。
- 圆形取景支持指针拖动、滚轮与滑杆缩放、方向键 1% 微调、`Shift + 方向键` 4%
  加速、重置，以及 28/32/34/44px 圆形实际尺寸预览。低有效分辨率必须给出文字
  警告；Focus Ring、禁用态和操作说明不能被遮挡。
- 文件选择与保存继续服从 ADR-0056：只接受明确选择的静态 PNG/JPEG，不采纳 v4
  演示文案中的 WebP、Data URL 或任意路径；图片正文、绝对路径和元数据不进入
  SQLite、日志、诊断或导出。选择取消、解码失败、保存失败和并发冲突均保留身份
  草稿、裁切状态和焦点。
- 编辑时选择内置外观只替换 appearance；新增时预设可以填入可继续编辑的外观与
  建议身份文字，但不能复用身份、权限、Presence、Capability 或 Runtime 关系。
- Member Name 全局唯一；错误与并发冲突保留草稿和焦点。
- 危险区“永久移除成员”要求明确二次确认并说明不可恢复。非终态 AgentRun 是唯一
  blocker；移除保留头像、Runtime 配置、Memory、Camp 关系、Task、Run 和历史身份。
- 历史消息、Task 和 AgentRun 继续显示 removed 成员原姓名、角色与头像，但身份位
  不可再打开详情，也不进入 `@`、Lead、Task 或新 Camp 候选。

## 长期记忆

### 页面骨架与状态语言

- 长期记忆是统一侧栏一级页面。Header 显示“长期记忆”、说明
  “应用级 · 由你治理；伙伴可形成经验与默契，家园共识需你确认”，右侧
  “导出…”与“＋ 新增长期记忆”。
- 页面依次为：四项紧凑摘要条、伙伴写入策略、pending Hearth Proposal 提示、
  Scope Tabs、治理过滤与搜索、列表/详情 Workbench。
- Scope 固定为“家园共识 / 伙伴经验 / 协作默契”，分别映射
  `hearth / companion / relationship`；首次进入默认家园共识。
- 治理过滤固定为“全部 / 伙伴来源 / 建议复核 / 已停止沿用”，与 Scope 正交：
  “伙伴来源”和“建议复核”可以同时成立。
- Active Memory、Pending Hearth Memory Proposal 与 Review Due 是三个不同对象：
  Active 已生效；Proposal 接受前未生效；Review Due 只是提醒。UI 禁止出现
  `provisional`、Authority、“标记为已确认”或非 Hearth 的“等待确认”。

### 摘要、策略与 Proposal

- 四项摘要共享一个表面和内部竖分隔，不做统计卡墙：
  “正在沿用 / 待确认家园共识提议 / 伙伴来源 / 建议复核”。
- 应用级策略标题固定为“允许伙伴写入长期记忆”，正文固定为：

  > 开启后，伙伴可以直接新增或修订自己的伙伴经验与当前协作默契，并提交等待你
  > 确认的家园共识提议。关闭只阻止之后的伙伴写入，不改变已有记忆和提议。

- 策略 Switch 提交期间禁用；失败恢复服务端值。关闭不能 Retire、Forget 或拒绝
  任何已有对象。
- 只有存在 pending Hearth Proposal 时显示 attention 提示“N 条家园共识提议等待
  确认”。“查看提议”打开右侧 Radix Drawer；Drawer 常规 440px，显示完整候选、
  Kind、Retrieval Keys、提议成员、来源和 stale 原因。
- 每条 Proposal 的操作顺序为“拒绝 / 编辑后接受 / 接受”。stale 禁用两个接受
  操作但允许拒绝；批量只允许拒绝，禁止批量接受。处理后聚焦下一条，最后一条显示
  完成空状态。
- Companion/Relationship 的直接伙伴写入已经生效，不进入 Proposal Drawer；它们
  使用非阻塞通知和“查看”深链，通知不回显完整正文。

### Scope、搜索与 Workbench

- Scope Tab 显示图标、文字和未遗忘数量；数量不随治理过滤或搜索变化。
- 搜索只作用于当前 Scope，匹配当前正文、成员、Relationship 双方、Kind 和可见
  来源元数据。切换 Scope 清空搜索并恢复该 Scope 最近的过滤与选择；主题切换不
  重置页面状态。
- Workbench 为单一双栏表面，采用
  `minmax(310px, 0.9fr) minmax(390px, 1.1fr)`；在 `1040×700` 仍保持并列，
  两栏独立滚动，不转为覆盖式详情 Drawer。
- 列表行依次显示 Kind（`偏好 ○ / 约定 □ / 经验 ◇`）、正文摘要、归属、Revision/
  时间、创建来源和条件状态。状态不能只依赖颜色。
- Companion 显示成员头像、姓名与角色；Relationship 显示双方及
  `A ↔ B · 双方适用` 或 `A → B · 仅对该方向适用`，箭头必须有文字解释。
- 来源固定为“用户创建 / 伙伴形成 / 伙伴提议 · 你已采纳”，并另行显示最近
  Revision Actor。来源不改变 Active Memory 的效力、优先级或权限。
- 详情首屏显示 Scope、Kind、完整正文、归属/方向、Lifecycle、复核计划、当前
  Revision、版本、创建/更新时间、形成来源、最近 Revision Actor、可用来源与
  Projection 问题。

### 写操作与并发

- 用户新增从当前 Scope 预选：Hearth/Companion 允许 Preference、Agreement、
  Lesson；Relationship 只允许 Agreement、Lesson，并要求两位不同成员和明确方向。
- 修订只能改变正文、Retrieval Keys 和复核计划；Scope、Kind、成员、pair 和
  Direction 不可变。改变边界需要新增 Memory 并显式停止沿用旧项。
- Active 项提供“修订 / 设置复核时间 / 停止沿用 / 永久遗忘”；Retired 项主操作
  为“重新沿用”。重新沿用必须通过 Core 容量检查。
- Forget 使用 danger Dialog，明确正文清除不可逆，但不能声称删除 Runtime 已读内容、
  AgentRun 冻结输入、外部导出或用户备份。
- 所有写操作使用服务端 version/CAS。冲突刷新对应项并提示重新检查，不能让
  Renderer 本地值覆盖。Projection 问题不回滚已经提交的 SQLite Memory。
- Loading 使用稳定骨架且不显示虚构计数；空 Scope、过滤无结果、读取失败、CAS
  冲突和 Projection 问题各有独立状态和明确下一步。

## 设置

### 共享结构

- 设置继续使用 App Shell 的 270px 侧栏槽位，但设置导航完整覆盖普通 App 导航，
  不在内容区右侧增加 188px 二级导航。覆盖侧栏顺序为 Logo/`Rovai AI`、
  “返回 App”、设置说明和“技能 / MCP / 执行引擎 / 外观 / 诊断”。
- “返回 App”恢复进入设置前的一级页面和 Camp，不把用户强制送回 Quick Chat。
- 再次进入设置时保留上次选择的设置分类，不强制重置到“技能”。
- 设置内容区使用自适应滚动面板，内部宽度
  `min(980px, 可用宽度 - 42px)`；各页只有一个 Hero，不叠加通用 AppHeader。
- 设置侧栏不显示健康 footer；诊断仍是设置分类并读取原有 Health Snapshot。
- 设置页不增加“上下文”或“记忆”分区；摘要模型在成员高级设置，长期记忆是一级
  页面。

### 技能

- Hero 标题“技能”，说明 Skill 保存在 Rovai-ai 本机受管仓库、通过执行引擎原生
  规则投影，且启用不会扩大权限；操作为“重新同步项目 / 导入 Skill”。
- “本机技能库”每行显示名称、说明、`Rovai-ai 内置 / 用户导入`、当前 Revision
  摘要、文件数、大小、安装时间、内容风险摘要、启用 Switch 与 Finder 入口。
- Imported Skill 可删除；Bundled Skill 不显示删除。删除中的项显示“等待投影排空”，
  新 AgentRun 不再使用，当前 Run 不热切换。
- 风险摘要只报告脚本、可执行文件、二进制候选和声明工具；导入不执行内容，风险
  摘要不是安全批准。启用、Bundled 来源和 `allowed-tools` 都不能授予额外权限。
- 导入支持单 Skill 目录或集合目录一级候选；同 digest 幂等，同名不同内容明确确认
  更新，Bundled 同名拒绝。新 Imported Skill 默认停用。
- “项目投影状态”按 Project/执行引擎展示 Ready、Stale、Shadowed、Unsupported 或
  损坏；显示受管具体入口和 Revision，不把暴露事实声称为 Runtime 已读取正文。
  项目自有同名内容优先，Rovai-ai 不覆盖也不删除。

### MCP

- Hero 标题“MCP”，说明它是应用级外部 MCP Library、按成员分配且不修改各执行引擎
  的个人配置；操作为“从本机 Agent 导入 / ＋ 添加 MCP”。
- 真源路径条显示当前权威 `~/.rovai/mcp.json` 或受控旧命名空间选择结果，并提供
  Finder 入口。UI 是该文件的图形编辑器，不建立 SQLite MCP 真源。
- Server 行显示启用 Switch、名称、`STDIO / HTTP`、命令或 URL、来源、明确成员
  分配、编辑与删除。停用是 neutral 状态，不使用危险色或整行不可读透明度。
- 导入只产生候选；用户逐项确认后一次性复制可移植定义，不同步来源、不写回来源，
  不复制 OAuth 状态、Token 或明文凭据。默认分配具体的当前在队成员，未来成员不会
  自动获得。
- 添加/编辑 Dialog 使用 typed Stdio 或 Streamable HTTP 字段和有界键值编辑器；
  密钥值默认遮罩，不进入普通错误、日志或诊断。
- malformed 外部文件必须保留原文并阻止覆盖，提供“重新读取 / 打开文件”；权限
  不安全时提供显式修复。不能用空配置静默覆盖。
- 启停、编辑、删除只影响后续 AgentRun；正在执行与恢复中的 Run 保持冻结 Exposure
  Snapshot。普通 UI 不声称 Rovai-ai 审批了 Runtime 原生 MCP 副作用。

### 执行引擎

- 页面始终显示 Product Runtime Catalog 中全部已接入产品，不因本机未安装而隐藏；
  文档调研候选不进入普通 UI。
- Hero 操作为“重新检测全部”。旁边明确说明：显式重新检测会执行交互式登录 Shell
  初始化，但只读取 PATH；未登记产品不会因此启动 Session 或检查登录。
- 每行显示产品名、可用性、版本/渠道、简短说明、自查命令、
  “检查可用性 / 安装说明”。用户文案使用“已就绪 / 正在检测 / 已找到待检查 /
  未找到 / 需要登录 / 需要处理 / 刷新失败，仍使用上次成功检查”等精确状态。
- 快速发现不冒充认证或深度能力检查；进入页面不启动所有 CLI。单行“检查可用性”
  才按对应产品合同触发需要的深度探测。
- “高级诊断与自定义启动入口”默认折叠；可执行路径、来源、fingerprint、最后探测、
  退避和迁移审计只在这里出现。普通成员只选择 Product Runtime，永不选择
  Installation ID 或路径。
- 未找到产品仍可被成员持久选择并处于 unresolved；页面不得自动改选另一个执行
  引擎。

### 外观

- 页面使用三个可选择卡：“跟随系统 / 日间 / 夜间”，不再显示
  “晨线 / 夜航 / Meridian Day / Meridian Night”。
- 顶部同时显示“当前显示 · 日间”和真实保存的偏好，避免用户选择 Night 后误以为
  Night 已实现。
- `日间`展示 Arctic Dawn Day miniature；`跟随系统`说明 v0.24 暂时显示 Day；
  `夜间`显示“视觉待设计”而不是伪造暗色 miniature，并说明当前仍路由到 Day。
- 切换原子保存 `ThemePreference`，不做全应用颜色渐变，不移动焦点，也不改变
  Camp、Tab、草稿、滚动、列表选择或 Dialog。首次绘制前解析，不能先闪 Meridian
  Night 或其他旧主题。

### 诊断

- Hero 操作为“重新检测 / 导出诊断 JSON”，并明确不会展示或导出 Token、登录信息、
  Cookie、MCP 明文凭据、用户消息、Memory 正文、附件正文或 Tool 输出。
- “本地依赖”使用一个四列摘要表面显示 Rust Core、SQLite、Git 和执行引擎；
  `1040px` 可换为两列。每项包含图标、文字状态和版本/说明。
- “诊断信息”按行显示 App/Core 版本、应用数据目录、SQLite、Git、每个 Product
  Runtime 的动态状态和能力摘要。屏幕可以显示应用自有路径；导出用 `~` 或占位符
  脱敏用户 Home，且不包含任意工作目录清单。
- 部分失败必须逐项显示，不把“3/4 就绪”伪装成全局成功。重新检测失败保留最近
  成功证据与失败说明。
- 导出使用显式 Save Dialog；取消零写入，成功后提供 Finder 入口。JSON 结构化、
  版本化且经过集中 redaction 测试。

## 创建新对话 Dialog

- “新对话”从任意页面打开同一个 Radix Dialog。宽度
  `min(760px, 视口宽度 - 72px)`，最大高度 `min(790px, 视口高度 - 72px)`；
  Header/Footer 固定，Body 独立滚动。
- Header 为 `NEW CAMP`、标题“创建新对话”和说明
  “确定这段对话的工作环境、成员与协作方式”；关闭按钮有可访问名称。
- 四个步骤始终按下列顺序显示：

1. **工作目录 · 可选**：默认“快速对话”，也可选择已知 canonical Project 路径或
   “选择工作目录…”。普通安全目录和 Git worktree 都允许；Git 只显示动态能力提示，
   不执行 `git init`。Picker 取消不改变 Draft、不报错、不持久化。
2. **成员与 Lead**：默认选择全部在队成员，顺序来自 Member Order；执行引擎状态只
   显示提示，不影响结构选择。成员集非空，Lead 必须在已选成员中。
3. **协作方式**：`peer` 显示为“并肩协作”并可选；`lead_coordinated` 显示为
   “领队统筹 · 暂未开放”且不可选，Core 仍必须拒绝绕过 UI 的请求。
4. **对话名称 · 可选**：留空为“未命名对话”；显示 80 Unicode scalar 上限与就地
   错误，不把名称生成委托给 Runtime/LLM。

- Footer 摘要显示 Quick Chat/目录展示名、成员数、并肩协作与 Lead，右侧
  “取消 / 创建”。提交期间锁定会改变 Draft 的控件并防止重复创建。
- Core 原子接受后才关闭 Dialog、刷新 Navigation、进入耐久 Camp 并聚焦 Composer；
  此时没有消息、Run 或预建 Conversation 也合法。
- 失败保持 Dialog、目录、成员、Lead、名称、滚动和焦点。Core 刷新候选后不得静默
  删除成员、替换 Lead、改变模式或回退 Quick Chat。
- `Escape`、关闭与取消在非提交态关闭并把焦点返回原入口；页面切换、主题偏好和
  Quick Chat 落地页都不能产生第二套 Draft 真源。

## 通用状态、交互与无障碍

### 页面状态

- 每个一级页和设置页都必须覆盖 Loading、Empty、Partial、Error、Disabled、
  Submitting 与 Recovery；空状态解释原因并提供一个明确下一步。
- 读取失败保留页面 Header 与可恢复导航；局部写失败保留选择、草稿和焦点，不把
  整页替换为通用错误。
- Toast 只用于已完成的非阻塞反馈，`aria-live="polite"`；错误或审批不能只用短暂
  Toast。流式 Run 不逐 token 播报。
- `recovering` 和 Unsettled External Effect 使用明确对象、最后已知状态、不确定性
  和下一步；不得声称停止等于外部副作用已回滚。

### 键盘与焦点

- 最低目标 WCAG 2.2 AA：普通文字 `4.5:1`，控件边界、焦点和非文字状态 `3:1`。
- 主要操作完全可键盘完成，焦点顺序与视觉顺序一致；Icon-only 控件有可访问名称。
- `focus-visible` 使用 2px `--focus`、`outline-offset: 1px`，不被 sticky、
  overflow 或固定审批区裁切。
- Radix Dialog/Drawer/Popover 负责 focus trap、`Escape` 和 focus return；提交中
  可以阻止关闭，但必须说明忙碌状态。
- Tab 使用手动激活模式并实现方向键、Home/End；列表选择、排序、Switch、Menu 和
  Disclosure 使用对应语义，不用点击 `div` 模拟。
- 可点击目标最低 `28×28px`，主要操作优先 32px。Hover 不能是发现操作的唯一方式。

### 动效与窗口

- 动效限于 120–180ms opacity 或 2–4px 位移；遵循 `prefers-reduced-motion`。
  禁止光晕、脉冲、粒子、视差、大幅弹簧和全局 `transition: all`。
- 几何基准为 `1440×920`，最小窗口为 `1040×700`。应用范围内不得出现整页横向
  滚动或遮挡主要操作。
- 270px 统一侧栏永不收缩。Camp Inspector 在 `1040–1179px` 为 260px、其他为
  310px；成员名册在窄区间为 250px；Memory 双栏最低 310/390；设置内容不再为
  第二列导航预留宽度。
- `1040×700` 下成员详情内部、外观卡片和健康摘要允许从多列变单列/两列；区域顺序
  不变。200% Zoom 与 reduced motion 仍须验证 Dialog、审批停靠区、菜单和焦点可达。

## 实施迁移边界

- Arctic Dawn 在现有 React 19、Radix、CSS Variables 和 Renderer 测试结构中重建；
  不新增 CSS 框架、CSS-in-JS、字体、图标库、动画库或状态管理库。
- 共享色值只在 Token 层定义；组件不得新增散落的主题专属十六进制或按
  `theme === ...` 分支硬编码颜色。
- 删除旧图标轨、对话列、竖向时间轨、EXEC 节点、Thinking/Progress/Steps 分区、
  旧 Approval 时间线卡、Quick Chat Composer、Header Stop/`•••`、Meridian 文案、
  Night Token 使用者、188px 设置二级导航、侧栏 Core 健康入口及无使用者的
  CSS/class/test fixture。
- 删除 `rovai.rail-expanded` 等旧纯 UI 偏好，不迁移、不双读。Pin 使用新的
  `navigation.json`；ThemePreference 按已确认合同保留但全部解析为 Day。
- Quick Chat 全栈切换与旧 `<userData>/lobby/` 精确删除遵守 ADR-0074；不增加
  Lobby 别名、旧序列化值、双目录或 CSS 兼容类。
- Quick Chat 的项目式 Renderer 投影、设置覆盖侧栏和 `Rovai AI` 字标遵守
  ADR-0078，不改写正式产品身份或领域合同。
- 旧 Meridian 和旧长期记忆设计文档的有效安全、状态、Memory 与无障碍规则已经迁入
  本文；旧文件直接删除。历史版本只允许用勘误说明原设计文件已移除，不得继续把它们
  路由为当前权威。
- 生产代码实施已于 2026-07-30 取得用户明确确认；文档完成、原型可浏览或 ADR
  accepted 本身仍不等于实现完成。

## 明确非目标

- v0.24 不实现 Arctic Dawn Night，不根据 Day 自动生成暗色。
- 不新增 Project 领域实体、Quick Chat 实体、账号/资料菜单、Camp archive/trash、
  拖拽调宽、移动端布局或原型页面切换器。
- 不改变 Runtime-native 权限、Memory Scope、Task、Camp Creation、A2A 私有正文或
  Execution Evidence 的权威边界。
- 不把静态原型数据、示例审批选项、示例路径、产品版本号或演示事件处理器复制到生产。
