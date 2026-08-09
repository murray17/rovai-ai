---
document_type: ui-design-system
authority: renderer-ui-detail
status: accepted
design_direction: arctic-dawn-v3
target_version: v0.49
implementation_status: in_progress
last_updated: 2026-08-09
---

# Arctic Dawn V3 设计规范

本文是 Arctic Dawn Renderer 的唯一视觉与交互详规。它把 V3 原型中有效的
产品方向、访谈决定及现有领域/安全合同收敛为可实施规范。设计已形成共同理解；
用户已于 2026-07-30 明确授权生产实现；首轮范围以及随后确认的导航、设置覆盖与
空 Camp 欢迎状态均已完成。2026-08-03 新增的结构化 Mention 与用户消息原生拖选也已
完成生产实现；2026-08-06 用户再次确认原交互稿中的“Mention 视觉方案 A + 信息弹窗
布局 2”，本节据此冻结 Composer 与历史 Mention 的共同呈现和点击行为；重新打包的 App
已通过真实输入、点击、Enter/Space、Esc 焦点返回、拖选和截图验收。

v0.44 进一步确认删除队员详情中的公共消息摘要模型配置和整个“高级设置”入口，同时完整
保留 Member Runtime Parameters；实施状态以 v0.44 实施计划与代码证据为准，不能从本文
`accepted` 推断代码已完成。

v0.45 进一步冻结 Scheme C 会话区：执行动态只作常驻摘要，执行详情按需成为
唯一的 AgentRun 过程详情面；Inspector 删除“活动”页，保留“任务 / 上下文投递 / 审批 / 审计”。
执行详情不提供 AgentRun 级 Stop，活跃 CampTurn 的停止入口仍只在 Composer 发送位置，并 fence
整棵 AgentRun/Message Delivery 执行树。外部 HTML 只提供会话区关键层级参考，不能覆盖本
Arctic Dawn Shell、Token、导航或无障碍合同。

v0.47 进一步冻结 Durable Task v2 的四层界面：会话卡只作五态责任感知，Inspector list
负责发现，Inspector detail 负责完整责任与审计，现有 AgentRun UI 负责执行事实。Task 取消不等于
执行取消，terminal Task 只读，version conflict 保留用户草稿；永久移除队员使用中文影响
preview，并由 Core 在一个事务中完成 membership/Task/Lead 收口。版本级细节以
[v0.47 生产设计](../versions/v0.47/production-design.md)为准，生产实现状态以对应实施计划和
代码证据判断。

v0.49 进一步冻结设置“通用”、每个 Main Window Session 一次性解析启动位置、稳定一级位置
即时提交、macOS 登录项四态和窗口 reset。它只增加 Desktop Shell 偏好与 Renderer 表面，不把
设置、窗口状态或登录项写进 Core/SQLite，也不改变执行恢复。版本级细节以
[v0.49 生产设计](../versions/v0.49/production-design.md)为准。

## 权威边界

1. 有效 ADR、`CONTEXT.md`、Core 合同和安全边界决定产品语义与可执行行为。
2. 本文决定 Renderer 的视觉、信息架构、产品文案映射和交互呈现。
3. `rovai-arctic-dawn-v3-package` 是全局设计输入；
   `rovai-arctic-dawn-members-v4.html` 是队员页与 Member Identity Dialog 的后续
   定向输入；`rovai-navigation-settings-empty-v7-package` 后续覆盖统一侧栏导航、
   设置导航投影和空 Camp 欢迎状态。HTML、静态假数据、旧词汇、原型切换器和演示
   事件处理器不是生产实现。
4. 现有代码、Migration 和测试只证明当前实现事实，不能反向覆盖已确认的新设计。

## 设计合同

### 设计方向切换

- Arctic Dawn V3 取代 Meridian 中与其冲突的视觉和信息架构。
- 原型必须在现有 React、Radix 和 CSS Variables 技术栈中重建，不直接复制单文件
  HTML。
- 原型出现的用户词汇必须映射到现有领域语言：产品界面使用“队员”“记忆”
  “Agent 运行时”等已确认术语；Member 的正式中文名只使用“队员”，不以“成员”或
  “伙伴”代称，也不使用“长期记忆”“执行引擎”作为对应正式名称；领域代码
  继续使用 Camp、AgentProfile、Product Runtime 等稳定名称。
- 与领域合同冲突的演示行为不进入产品。例如，用户点击原型中的“发送”不能绕过
  New Conversation Draft 与原子 Camp Creation。

### 版本页面范围

v0.24 必须在一个版本内收敛下列生产界面：

- Quick Chat 与 Camp 对话工作区；
- 队员与记忆；
- 设置中的技能、MCP、Agent 运行时、外观和诊断与修复；
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
| `--surface-subtle` | `#F6F7F3` | 侧栏与次级面板 |
| `--surface-muted` | `#ECEFE9` | Hover、Disabled、弱分组 |
| `--surface-selected` | `#E9ECF7` | Tab 和需要品牌强调的列表选择；当前 Camp 使用灰色 `--surface-muted` |
| `--conversation-surface` | `#FFFFFF` | Camp 会话阅读区与输入停靠区背景 |
| `--inspector-surface` | `#FFFFFF` | Camp Inspector 背景 |
| `--conversation-inspector-line` | `#CBD1C8` | 会话区与 Inspector 的强结构分隔 |
| `--home-surface` | `#FFFFFF` | Quick Chat 首页右侧主内容区背景 |
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

状态色与品牌色、队员身份色严格分离：

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

证据区不继承品牌渐变、队员底色或插画。Diff 还必须使用 `+/-`、行号与结构，不能只
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

### 队员身份与图像

- `AgentProfile.id` 稳定映射 `--identity-1..8`：
  `#A65F4A / #39777A / #74628F / #9A6A32 / #4F729B / #8A5C75 /
  #547245 / #8C6146`。
- 身份色只进入头像环、名称或小型身份点，不表示运行、权限、审批、Presence、
  Lead 或 Capability。
- 一个受控 `avatarRef` 同时解析 [ADR-0056](../adr/0056-controlled-member-avatar-assets.md)
  定义的完整 portrait 与紧凑 icon，不增加第二个 Profile 字段。完整半身照只用于
  队员详情、身份编辑和外观预设；圆形 icon 用于名册、详情标题、队员选择、`@`
  候选和消息身份位。
- 两种 rendition 必须来自同一内置或受管复合资产。未知引用、缺文件、完整性失败或
  图片加载失败统一回退为受控字符头像/肖像占位，不能解释任意路径或 URL。
- 工作区背景、Quick Chat 品牌以外的内容、命令、Diff、Task、审批、审计、错误、
  恢复、Memory 正文和设置页禁止人物插画或图片纹理。

### A2A 会话消息

- Agent 使用 `camp.message.send`（CLI `rovai send`）提交的 A2A 正文是真正的公共
  CampMessage，按作者显示并进入公共时间线、公共 FTS、Shared Conversation 和有权历史。
- 一条公共消息可以关联 `0..N` 个 Message Delivery。公共消息事实只创建一次；Delivery
  负责收件人、队列、等待、目标 AgentRun 和终态，不能被 Renderer 拆成第二条消息或第二套发送。
- 消息 footer 可以显示“发送给 @队员名…”和 Delivery 状态；footer 只读取冻结的 recipient
  snapshot，不把展示顺序当作调度优先级。
- Reply-to 只建立公共关系；回复 Agent-authored Public A2A Message 时 Core 可加入作者作为
  一个默认目标，回复用户或系统事件不新增 Delivery，也不扩展原消息其他收件人。
- 执行详情展示 Delivery/AgentRun 的过程状态和证据摘要；公共正文仍在消息区直接可读，
  Drawer、Delivery 或 AgentRun 不得冒充另一个发送者发言，也不创建 result route。
- 公共正文按持久 sequence 排列；后台 Runtime 到达时间、Scheduler 顺序、canonical recipient
  顺序和 Renderer 选择都不能重排公共时间线。

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
- 置顶 Project 显示与普通 Project 相同的完整分组结构；其 Camp 列表同样先显示最近 5 条，
  不因置顶而预取或直接展开全部记录。
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
- Quick Chat、Camp、队员和记忆显示普通导航；设置页保留同一 270px 侧栏槽位，
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
2. 一级入口：“新对话 / 队员 / 记忆”；
3. “跳转到对话…”入口，点击或 `Command/Ctrl+K` 打开 Camp 快速跳转；
4. “置顶”区，仅在存在有效置顶时显示；
5. “项目”区：directory Project 在前，文件夹样式“快速对话”投影固定在末尾；
6. 底部只保留“设置”。

- Camp 快速跳转只导航到按标题匹配的 Camp，不冒充消息全文检索。
- 普通 Project、置顶 Project 与 Quick Chat 投影统一先展示 Navigation Snapshot 中最近 5 个
  Camp。“查看更多”从 offset 5 开始按每次 10 条读取并追加，按 Camp ID 去重；读取失败保留当前
  列表。已经读取的缓存跨项目折叠与置顶位置变化保留，“收起”只把可见数量恢复为 5，之后再次
  “查看更多”优先恢复缓存，不重复请求。
- Camp 行显示标题、运行/未读完成等权威 Navigation marker 和唯一三点菜单。菜单固定
  包含“置顶/取消置顶、重命名、删除”，删除前有分隔线；普通区与置顶区使用同一结构。
- 可置顶 Project 显示文件夹、展示名、`＋` 和唯一三点菜单，菜单只包含“置顶项目/取消置顶
  项目”。Renderer 维护一个纯本地持久“当前项目”：文件夹/名称主行同时选择该项目并切换 Camp
  children 的展开状态，主行自身通过 `aria-expanded / aria-controls` 表达状态，不显示独立折叠按钮。
  三点菜单和 `＋` 是右侧独立兄弟按钮，不触发选择或展开。快速对话同样可成为当前项目但不显示
  Project 菜单。
- 当前项目文件夹不使用稳定底色，只保留语义与轻量文字状态；当前打开 Camp 使用稳定灰色底、
  左侧品牌标记和字重表达更强选中态，不使用蓝色底。点击 Project/快速
  对话后的 `＋` 只把对应项目作为本次创建目标；取消 Dialog 不改变当前项目，创建成功并进入
  Camp 后才由该 Camp 更新当前项目。
- 从“项目”标题 `＋` 成功一键创建到新目录时，空 Pending Camp 仍不进入 Navigation；Renderer
  单独把已校验的当前工作目录显示为零 Camp 项目行，并显示“还没有对话”。该 Shell-only 行保留
  项目级 `＋`，但在 Core 尚未投影 canonical Project group 前不显示项目置顶菜单；离开并清理空
  Pending 不删除当前项目行，新窗口则重新校验目录，失效时回退快速对话。
- Project 标题和分页操作不显示会话数量。只显示初始 5 条且仍有剩余内容时仅显示“查看更多”；
  可见数量大于 5 且仍有剩余内容时同时显示“查看更多 / 收起”；全部可见时只显示“收起”；总数不
  超过 5 时两者都不显示。Project 目录的三点菜单与 `＋` 默认同时隐藏，在整行 Hover 或键盘
  `focus-visible` 时同时显示；鼠标点击目录后移出不能因残留焦点继续显示，触摸替代路径下保持可见。
  Camp 菜单触发器沿用相同的可达性要求。
- Sidebar 菜单操作失败保留当前行和焦点。不存在 archive、trash 或顶栏重复入口。
- 删除侧栏 Core 健康摘要；Health Snapshot、探测、诊断页和导出能力继续保留，
  用户通过“设置 → 诊断与修复”访问。

### Quick Chat 与新对话

- Renderer 跨 Main Window Session 持久保存当前项目；点击 Project、Quick Chat 或其中任意 Camp
  都更新该选择。已保存 directory Project 不再存在时精确回退快速对话。新窗口恢复当前项目，
  但不把它冒充 Restorable Location 或 Core Project 实体。
- 一键创建关闭时，左上角“新对话”打开创建 Dialog 并预选当前项目；Project/快速对话后的 `＋`
  打开同一 Dialog 并预选该入口对应项目；“项目”标题后的 `＋` 选择工作目录后打开同一 Dialog，
  并预选新目录。
- 一键创建开启且默认配置有效时，上述四类入口跳过 Dialog，使用入口目标项目、已保存默认队员与默认 Lead
  创建 Core-owned Pending Draft。空 Pending 立即显示 Composer，但不进入导航或 Restorable Location；
  正文或附件非空后进入导航并显示灰色“草稿”，第一条消息成功时才原子激活。创建拒绝或配置失效时
  必须打开 Dialog、保留入口对应项目并提示重新确认。
- Quick Chat 只显示品牌落地内容和“继续未完成的事”，不显示可直接发送的 Composer。
- Quick Chat 首页右侧主内容区使用白色 `--home-surface`；统一左侧菜单继续使用
  `--surface-subtle`，不随首页表面改变。
- 创建 Dialog 接受 New Conversation Draft 并调用原子 Active Camp Creation；成功后才
  进入已持久化正式 Camp 并聚焦正常 Composer。一键 Pending 与 Dialog Active 是同一 Composer 的
  两种创建边界，不建立 Renderer-only Draft。
- 原型中落地页输入后直接“发送”、双击导航才打开 Dialog 等演示事件不进入产品。
- Quick Chat 页面不再叠加通用 AppHeader；App Shell 右侧第一行叠加一条
  不改变内容起始位置的 50px 隐形窗口拖拽栏。页面继续使用居中的品牌舞台：
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
- 会话阅读区与输入停靠区使用白色 `--conversation-surface`。用户消息继续使用
  `--brand-soft` 淡靛蓝表面，Agent 最终正文继续直接显示在白色阅读背景上。
- 主阅读流使用同向左对齐布局。用户消息、Agent 消息和 A2A 消息按持久顺序连续
  排列，以头像、显示名称、时间及消息表面共同表达身份与类型。
- 用户消息使用弱 `brand-soft` 表面；Agent 最终正文保持开放阅读表面。队员身份色
  只点缀头像和名称，不给整段消息铺身份底色。
- 用户消息为精确纯文本；Agent 最终回复和 Runtime 公开叙述使用安全 GFM，禁止
  raw HTML、脚本、危险 URL 和远程嵌入。Tool/文件/命令输出只走结构化证据组件。
- 每条用户和 Agent 正文支持浏览器原生文本选择；鼠标在正文上按下并拖动可选中
  任意片段，系统复制快捷键只复制当前选区。每条消息另提供键盘可达的整条复制
  操作，入口仅在消息表面悬停或聚焦时显示；复制使用当前显示名称，不暴露内部
  handle、Inbox ID、AgentRun ID 或路由标识。
- 日期边界使用横向分隔线。删除 Meridian 的点状竖向时间轨、附着节点及 EXEC
  菱形节点，不提供旧节点体系兼容样式。
- Task 在创建时间位置投影唯一实时卡片；后续标题、负责人和状态变化只更新原卡，
  不追加 Task 消息。其他非审批结构化边界内容继续出现在真实发生位置。Approval
  不进入消息区或执行过程。
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
  等没有对应 Tool Call 的系统失败仍按其真实 AgentRun/Pending Intent 状态进入活动、
  审计或就地错误提示，不得为了视觉统一伪造成 Tool Call。
- AgentRun 运行中只显示 Runtime 报告的公开叙述与动作；`reasoning`、`thought` 和思考摘要
  不进入 Renderer，即使 Runtime 主动提供也不展示。Core 可以继续按 ADR-0061 保存相应权威
  Evidence，但 Renderer 不提供正文或“查看完整思考摘要”入口，也不在 Runtime 没有报告时
  补造步骤。终态后折叠不改变持久证据或 Inspector 状态。
- Task 卡只显示当前五态中文文字、标题和负责人，不显示描述、验收条件、关闭说明、审计、
  百分比或关联 AgentRun 状态；点击后读取 Inspector 中的当前 Task。阻塞、完成、取消、自动释放
  及普通更新都只原地刷新，不创建额外 Task 节点、移动卡片或重排会话。
- Approval 保留独立交互语义，但不混入消息区。所有 pending Approval 固定显示在
  Composer 正上方的非模态停靠式审批弹框（Approval Dock）；单项直接展示请求，多项
  聚合为“N 项待审批”并按权威顺序提供逐项展开与处理。弹框高度有上限并内部滚动，
  不能覆盖消息或把 Composer 推出窗口。
- Renderer 只能呈现发起请求的 Agent Runtime 实际返回的选项、scope、lifetime、
  后果与阻塞影响，不建立假想的跨 Runtime 通用审批档位，也不得因视觉统一改写原生
  option identity。
- 执行动态常驻显示活跃/等待/最近终态 AgentRun 的轻量摘要和数量；点击 chip 只选择
  执行详情中的 AgentRun，不自动滚动会话或抢焦点。
- 执行详情按需显示所选 AgentRun 的 Delivery、ContextManifest、等待条件、终态和
  Canonical Runtime Activity/Evidence 摘要。后台事件不得自动打开、切换或聚焦 Drawer；
  用户已打开的终态 AgentRun 保持 selected，直到主动关闭或切换。
- 终态过程仍可收进默认折叠入口，摘要格式为 `处理过程 · {本地化耗时}`；该入口和
  执行详情只提供查看，不产生 AgentRun 级取消协议。
- 不使用英文 `Worked for …`；Agent 最终回复位于折叠入口之外并保持直接可见。
- [会话事件交互样例](examples/arctic-dawn-conversation-events.html)用于评审上述
  层级与展开行为；示例数据和某个 Runtime 的审批按钮不构成跨 Runtime 合同。

### Camp Composer

#### 结构化队员 Mention

> Core-owned 内容、稳定身份与派生寻址由 accepted
> [ADR-0096](../adr/0096-core-owned-structured-mentions-and-derived-addressing.md)约束；
> 本节是 Renderer 视觉与交互的权威合同。二者不能互相替代。

##### 不得回退的交互合同

“飞书式”只描述紧凑、可识别、可直接查看身份信息的行内交互语法。颜色使用本设计的
`--mention-ink` / `--mention-ink-hover` 语义 Token，Focus 继续使用 Arctic Dawn Token。
以下基线来自用户提供的 `rovai-mention-popover-prototype-v2`，并于 2026-08-06 再次确认、
纳入 `pnpm accept:structured-mentions-ui`：

| 场景 | 呈现 | 允许的交互 | 明确禁止 |
|---|---|---|---|
| Composer 中可用的 Member Mention | 默认无底色、无边框的蓝色原子行内文字 | Pointer Down 保持整体选中；单击、Enter、Space 打开人物信息卡；仍可整体替换或删除 | 打开队员页、全局 Toast、拆开编辑名称或改变寻址 |
| 历史消息中的可解析 Member Mention | 同一默认无底色、无边框的蓝色行内文字 | 单击、Enter、Space 打开人物信息卡；保留文本拖选和复制 | 切换页面、打开 Inspector、显示全局 Toast、发 Core 命令或改变消息 |
| Composer 中已失效的 Member Mention | 保留完整原子 Token 和明确不可用态 | 整体选择、替换或删除 | 打开信息卡、发送、静默降级或再次寻址 |
| 历史消息中的已离队、已移除或不可解析 Member Mention | 保留结构化身份、最后可解析名称和不可用状态 | 选择和复制 | 聚焦为按钮、打开信息卡、恢复寻址/执行能力、导航或发 Core 命令 |
| All Members Mention | 同一蓝色原子行内文字 | Composer 中整体编辑；Composer 与历史中打开范围信息卡 | 展开成多个正文 Token、角色 Toast 或队员导航 |
| 手写、粘贴或旧消息中的普通 `@文字` | 普通文本 | 原生编辑、选择和复制 | 猜测为结构化 Mention、增加蓝色样式、弹窗或寻址 |

默认状态严格为 `display: inline`、`padding: 0 1px`、3px 圆角、透明背景和无边框；只有
Hover、Focus 或弹窗打开时才使用 8% `--mention-ink` 背景与同强度描边反馈。不得重新做成
持续有底色的 Chip、Badge 或按钮外框。历史消息拖选形成非空文本选区时，释放按键不得
误触发弹窗。

可操作的 Member Mention 必须具有 `role="button"`、键盘焦点、`aria-haspopup="dialog"`
和 `查看{队员名}的基础信息`可访问名称。单击或键盘激活后，在原 Mention 附近打开非模态、
视口碰撞感知的人物信息卡，当前 Camp、视图和 Inspector 均保持不变。信息卡固定采用
“布局 2 · 4:5 角色卡侧栏”：宽 392px、左侧 128px 受控 portrait、最小高度 302px；右侧
依次展示名称、团队角色、Presence、Agent 运行时状态、专业职责、工作准则和性格底色。
图片只能从现有受控 `avatarRef` portrait rendition 解析；没有图片时使用低权重占位，不
新增第二套身份字段。

信息卡使用 `role="dialog"` 与 `aria-modal="false"`，不做 Focus Trap。点击外部或按 `Esc`
关闭；由键盘打开后将焦点置入卡片，按 `Esc` 关闭后把焦点返回原 Mention。`@所有队员`
使用独立范围卡：历史消息展示发送时冻结的 `addressedAgentIds`，Composer 展示当前
可提及队员。信息卡只读，不提供“查看完整队员资料”或任何页面跳转入口。

把人物信息卡改成全局角色 Toast、队员页跳转或其他信息架构，属于产品交互变更，不是重构。
除非用户明确确认，否则同一变更必须保留上述合同，并同时通过：

1. 更新本节和 [UI 索引](README.md)；
2. 更新 Renderer 语义测试，继续断言按钮而非链接、精确可访问名称和弹窗语义；
3. 更新并运行 `pnpm accept:structured-mentions-ui`，验证样式、点击、键盘、拖选不误触、
   不离开会话、布局 2 结构及真实截图；
4. 若内容身份或寻址也改变，再单独更新 ADR-0096 与 Core 合同。纯 Renderer 视觉调整
   不得借机改写 Core 语义。

##### 输入与原子编辑

- 在 Composer 普通文本位置直接键入 `@` 时，无论它前面是空格、中文、英文或标点，
  都打开同一候选菜单；不得再使用只接受 ASCII 边界或“前一字符不是 Unicode 字母/数字”
  的另一套判断。菜单打开时方向键改变高亮项，Enter 选择候选且不发送消息，Esc 关闭。
  只有候选选择会把输入片段替换为结构化 Mention；关闭菜单或未选择时保留普通
  `@文字`。Paste 的纯文本 `@文字` 不打开菜单，也不创建 Mention。
- 只有用户从 `@` 候选中选中队员，或者在 Rovai-ai 内保留一个已有的结构化
  Member Mention，才会建立稳定队员身份和寻址关系。手工输入或纯文本 Paste 得到的
  `@队员名` 只是普通文字，不显示为 Mention，不寻址也不唤醒队员。
- Member Mention 是原子编辑单元：光标不能进入队员名内部，左右移动时以整个
  Mention 为一个位置跨越，Backspace 或 Delete 一次删除整个 Mention，不允许留下
  视觉仍为蓝色但路由身份已损坏的部分 Token。
- Composer 中 Pointer Down Member Mention 或 All Members Mention 会选中整个 Token，
  完成单击后还会打开相应信息卡；此时输入或 Paste 会整体替换它，Backspace 或 Delete
  会整体删除它。鼠标拖选经过 Token 时只能完整包含或排除该结构化身份，不产生半个 Mention。
- 复制包含 Mention 的正文时，标准剪贴板 `text/plain` 始终使用当前可见文本，例如
  `@小河狸`，复制到其他应用时不暴露内部身份字段。Rovai-ai 可以为完整选中的 Mention
  附加应用内部结构化身份；只复制 Mention 的一部分时只保留普通文本。
- 将带结构化身份的内容 Paste 到另一 Camp 时，Renderer/Core 重新校验精确目标：只有
  仍是目标 Camp 当前可提及队员的 Member Mention 继续保持蓝色结构，其余降级为不唤醒的
  普通文本。All Members Mention 保留为目标 Camp 的 `@所有队员`，并在该消息发送接受时
  冻结目标 Camp 的收件人。纯文本 Paste 永远不反向解析为 Mention。

##### 显示身份与失效

- Member Mention 在 Composer 中作为完整蓝色行内元素显示；发送后按上表继续保持同一
  结构化身份，不回退为通过正文重新解析的 `@` 字符串。
- Member Mention 始终以稳定 `agentId` 解析显示身份。当前队员改名后，历史
  Mention 显示新名称而不改写消息正文或改变历史寻址；队员永久移除后，历史 Mention
  保留移除时的最后名称和蓝色身份外观，但不可点击、不可再寻址，也不能唤醒该身份。
- 已保存 Draft 中的 Mention 如果在发送前因队员离队、移除或不再属于当前 Camp 而失效，
  Composer 将整个 Token 显示为明确的无效态并阻止成功发送。Core 重新校验后以
  `mention_target_unavailable` 在创建任何 CampMessage、CampTurn 或 AgentRun 前拒绝，
  完整保留 Draft；不得静默降级为普通文字、删除目标或回退给 Default Lead。用户必须
  删除该 Token 或重新选择队员。Agent 运行时暂时不可用不改变 Mention 身份，继续遵循
  现有执行准入、消息保留和失败恢复规则。
- Structured Camp Message Content 只保存稳定身份，不把队员名称变成第二个身份真源。
  Renderer 显示、剪贴板纯文本、按队员的搜索以及之后构建的 AgentRun 上下文都从
  `agentId` 投影当前名称；已移除身份使用其保留的最后名称。改名不改写历史
  Structured Content；每个 AgentRun 仍在 ContextManifest 中冻结它当时实际收到的纯文本
  投影与 digest。

##### 寻址与持久化

- 用户未插入任何 Member Mention 时，现有 Default Lead 寻址继续适用，但 Renderer 不在
  Composer、乐观消息或历史消息中自动补出蓝色 `@Lead`。默认收件人是路由事实，只有
  用户显式插入的结构化引用才是正文 Member Mention。
- `@所有队员` 是一个独立的蓝色原子 All Members Mention，Composer 不把它展开为多个
  Member Mention。发送接受时 Core 冻结当时实际寻址的确切 CampMember ID 集合；历史
  消息仍显示一个 `@所有队员`，之后的队员加入、离队或移除不改变该历史收件人集合。
- 用户正文可以多次使用同一 Member Mention，也可以同时使用 All Members Mention 和
  与之重叠的 Member Mention；乐观消息和历史消息保留所有原始出现位置。发送时 Core
  对它们解析出的 `agentId` 取并集并去重，同一队员只被寻址和唤醒一次，不因
  正文中的重复或重叠创建多个直接 AgentRun。
- 同一条消息中的全部唯一 Mention 收件人在一个 Core 事务中创建各自的 queued AgentRun，
  Default Lead 不会吞掉或串行阻塞同消息里的其他 Mention；调度器并发执行各 AgentRun 的启动前
  检查。产品不承诺多个独立 Runtime 进程拥有完全相同的操作系统启动时间戳。
- Member Mention 和 All Members Mention 是 Core-owned Camp Composer Draft 内容，不是
  Renderer-only DOM 装饰。切换 Camp 或重启应用后必须恢复同一身份和原子编辑结构；发送
  失败保留正文、Mention 和附件，只有发送接受才在同一 Core 事务中生成消息 Mention
  记录并消费 Draft。Renderer 不得通过重新解析普通正文恢复丢失的 Mention。
- 结构化 Mention 是显式消息寻址的唯一真源。Core 从通过校验的 Draft 内容派生 Default、
  Explicit 或 Broadcast 寻址及去重收件人集合；Renderer 和其他调用者不得再并行提交一份
  可以增删或覆盖 Mention 目标的 `agentIds`。界面中的蓝色身份与实际唤醒对象必须
  来自同一份耐久 Draft。
- 发送前 Renderer 同步保存当前正文、Mention 和附件并取得 Core 返回的精确 Camp
  Composer Draft Revision。发送命令引用该 Revision；Core 只在当前耐久 Draft 仍与它
  一致时执行原子消费。版本不一致以 `draft_changed` 在任何 CampMessage、CampTurn 或
  AgentRun 之前拒绝，界面重新加载新 Draft，不覆盖也不自动发送它。
- Draft 和已接受的用户消息使用同一份封闭的有序 Structured Camp Message Content：
  `Text`、`MemberMention(agentId)` 与 `AllMembersMention`。Core 从该内容统一派生
  纯文本正文、Renderer 蓝色结构、内容完整性和收件人索引；不保存易错的 Unicode 字符
  偏移，也不引入 HTML、Markdown AST 或通用富文本模型。旧用户消息没有结构化内容时按
  单个 `Text` 片段读取，不反向解析其中的 `@` 文字，也不显示猜测出的蓝色或可点击
  Mention。旧记录已有的收件人 ID 继续作为历史寻址、审计和按队员搜索事实，但不用于
  猜测 Mention 的正文位置；只有新版结构化 Composer 创建的消息拥有可见 Mention。

- Pending Approval 弹框固定在 Composer 正上方，属于输入停靠区而非会话时间线、
  Dialog 或全屏 Overlay。多个队员同时请求审批时显示聚合计数，例如“2 项待审批”，
  并同时保留队员身份、Runtime、请求范围和每一项的独立决定状态。
- 审批弹框常规最大高度 260px，超出后内部滚动；标题行显示 pending 总数和涉及队员，
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
- Active 空 Camp 欢迎状态保持 Camp Header、消息滚动区、Composer、Approval Dock 与 Inspector
  原结构，不新增页面或第二套发送入口。Pending 空草稿复用同一消息区与 Composer，但激活前隐藏
  Inspector 与配置 mutation，文案为“当前只是一份草稿”；它是 ADR-0145 的 Core 领域状态，不是
  Renderer 第二真源。
- Active 内容包含轻量 Arctic Dawn 星与地平线图形、`ARCTIC DAWN · NEW CAMP`、标题
  “开始这段协作”和简短说明。Pending 使用“新对话草稿 / 开始一段新对话”，并明确输入后自动
  保留、发送第一条消息才正式创建。图形只使用现有 Token/SVG，不加载外部图片。
- 当前协作配置摘要从当前事实计算：Quick Chat/Project 展示名、Default Lead、在队的队员数和
  Agent 运行时就绪摘要。缺失、部分就绪或未就绪必须使用真实文案，不能补造 Ready。
- 提供三个起步建议：“先了解项目 / 整理成任务 / 检查工作区”。点击只把对应示例
  需求写入现有 Camp Composer 并聚焦，不自动发送、不改变寻址、不创建 Task 或 AgentRun。
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
- 本地停止状态必须覆盖该 Turn 的全部非终态 AgentRun：消息区运行卡和执行详情
  立即显示“正在停止…”，停止运行中动画和强调。草稿继续可编辑，但权威终态返回前
  不显示或触发下一轮发送。
- Core 确认 CampTurn 终态取消后，消息区只投影一条独立的
  “你已在 {本地化耗时} 后停止”。耗时从 Turn 创建到取消请求，位置优先使用
  `camp_turn.cancel_requested` 的全局序列；它不是 CampMessage，也不进入 Agent 输入。
  多队员和 A2A 执行树仍只显示一条。队员消息标题不再长期附着“已停止”。
- 取消 Turn 仍有未确认外部效果时，停止事件增加“结果待确认”及打开执行详情
  的入口。执行详情继续逐 AgentRun 展示权威终态；UI 不声称外部效果已回滚。
- 发送不等待 Runtime Discovery 或深度检查。Renderer 先显示乐观用户消息，Core 原子
  保存消息和 queued AgentRun；调度前轻量确认失败时保留用户消息，并把 Agent 运行时修复
  原因显示为 AgentRun 失败或恢复入口。
- Composer 随内容自动增高到有界最大值，超过后内部滚动；发送、停止、正在停止、
  解析中和不可提交状态保持相同布局，避免按钮跳动。
- 不保留两套提交快捷键。可见快捷键提示只显示 `Enter`。

### Camp 右侧详情栏（Inspector）

- Inspector 使用白色 `--inspector-surface`，与会话区之间使用
  `--conversation-inspector-line` 强结构分隔；内部组件继续沿用既有表面与状态色。
- Camp 右侧详情栏删除“活动”页，只保留四个手动激活的页签：
  “任务 / 上下文投递 / 审批 / 审计”。
- AgentRun 动态、等待与终态只由执行详情展示；“审计”显示不可混入聊天或普通活动
  的时间、Actor、动作、目标、结果和证据。
- 执行详情使用“运行中 / 等待审批 / 已完成 / 失败 / 已停止 / 恢复中”等本地化
  文字，不显示原型的 `DONE`；流式更新合并播报，不能通过 `aria-live` 逐字朗读。
- “任务”列表使用 compact item 显示标题、状态、负责人、单行 preview 与验收条件数量；详情
  显示完整 description、ordered Criteria、creator/source AgentRun、version/timestamps、条件说明、
  closure 与 audit cause。只读 Related execution 从 CampSnapshot 的 AgentRun/Delivery 关系派生并
  进入现有执行详情，不能成为 TaskRecord 或反向改变 Task。
- Task editor 按表单 projected final state 动态要求 blocker/completion/cancel 字段；terminal
  Task 完全只读。Version conflict 刷新最新详情、保留未提交草稿，不自动 replay 旧 patch。
- User/Default Lead 的“取消 Task”仍提交 versioned update，必须填写原因并明确“取消 Task 不会
  取消已经接受或正在运行的 AgentRun”；普通 Agent 不显示该入口。
- “任务”“审批”分别投影当前 Task 与 Approval 权威状态；“审批”页与 Composer
  上方固定面板读取同一 pending 队列，不复制或重排决定。计数徽标只在数量大于 0
  时显示。
- “上下文投递”页同时展示当前协作配置和 AgentRun 的 ContextManifest 投递证据，且必须来自
  当前 Camp 的生产 Read Side；原型中的 Project 名、Design route 与约束文字只是演示数据，
  不得硬编码或当作用户内容。ContextManifest 不代表当前 Camp 的全部事实都已进入 Prompt。
- “审计”按时间显示 Actor、动作、目标、结果和证据引用；普通叙述、A2A 正文和
  Tool 输出不能复制成审计聊天。
- 切换页签不得改变 Camp、草稿、时间线滚动或运行状态；页签必须具备完整
  `tablist / tab / tabpanel` 语义和键盘操作。
- 窗口宽度不低于 1180px 时详情栏固定为 310px；在
  `1040–1179px` 时固定为 260px。用户可从 Camp 顶栏完整隐藏或恢复；隐藏后详情栏
  退出布局和无障碍树，不保留窄栏，也不变成 Drawer 或 Overlay。
- Inspector 首次使用默认展开，后续在本机记住显示偏好；该偏好不写入 Core，不产生
  Camp 事件或审计。Header 的执行/审批状态摘要在隐藏时仍可用；执行摘要打开或聚焦
  执行详情，Approval 摘要打开 Inspector 的“审批”页。
- 详情栏不提供拖拽、双击或键盘调宽。统一侧栏仍固定 270px；响应式变化只作用于
  详情栏与中央内容的内部排版。

### Camp 顶栏与停止入口

- Header 左侧显示“Quick Chat/Project 展示名 › Camp 标题”，标题截断但完整值可访问；
  旁边使用“第 N 天”并由 Camp 创建时间纯函数派生。
- Camp 顶栏右侧只承载执行、待审批等状态摘要和 Inspector 显示/隐藏按钮，不渲染
  “停止”按钮或 `•••` 操作菜单。
- 没有 Active AgentRun 或 pending Approval 时不渲染空徽标。执行状态摘要打开或聚焦
  执行详情，Approval 摘要打开 Inspector 的“审批”页；两者都不能在 Header
  直接执行停止、审批、置顶、重命名或删除。
- 停止入口只占用 Composer 的发送位置，调用当前 CampTurn 整棵 AgentRun/A2A
  执行树的停止命令。进入停止流程后立即显示“正在停止…”并防止重复请求；停止 ACK
  不等待 Navigation 重载、Camp 重新激活或 Git observation。多个 Runtime interrupt
  并行执行并使用独立短 deadline；超时后必须强制终止或完成可靠 fencing。
- 置顶/取消置顶、重命名和删除统一使用侧栏 Camp 行的三点菜单；顶栏不重复这些操作。
- App Shell 顶部明确分为三种结构：Camp 继续使用显性 50px `AppHeader`；
  Quick Chat 与设置叠加独立、纯结构的 50px 隐形拖拽栏，内容仍跨越 App Shell
  两行；队员与记忆同样使用纯结构的 50px 隐形拖拽栏，但该栏独占第一行，
  页面内容从第二行开始，保留窗口顶部的视觉呼吸区。
- 队员的 `member-detail-header` 与记忆的 `memory-library-header` 位于空白拖拽栏
  之后，也可继续承担 `drag` 表面；其中按钮、链接、输入、菜单、`summary` 及其他
  交互元素必须明确为 `no-drag`。页面提示与错误位于 Header 之后。

## 队员

### 页面结构

- 队员是统一侧栏一级页面，不隐藏侧栏；右侧第一行保留纯空白的 50px 拖拽区，
  页面内容从第二行开始，不再复用通用 AppHeader。未选中或列表为空时仍显示
  “队员 / 从左侧选择或创建队员”的 Header 骨架。
- 选中队员时的详情 Header 显示 50px 圆形 icon、Member Name、Team Role、
  Presence 与 Runtime 状态，右侧保留“编辑身份”和真实操作菜单；未选中时
  的 Header 骨架不补造操作。
- 主体是填满剩余高度的双栏 Workbench，常规为 272px 名册 + 自适应详情；
  `1040–1179px` 时名册 250px。两栏独立滚动，不变成队员卡片墙，也不为普通
  Workbench 添加浮层阴影。
- 普通模式的名册只分“在队”和“暂时离队”。`removed` 不显示，也不存在“已移除”
  分组。Presence 和 Agent 运行时状态是两个独立维度。
- 名册行显示共享头像、唯一 Member Name、角色、明确 Runtime Readiness 文字和状态
  图标；不得显示内部 handle，也不能因未配置 Agent 运行时而用整行低透明度降低对比度。

### Member Order

- 名册在普通“在队 / 暂时离队”分组中直接显示拖拽把手和简短说明，不再切换到独立
  排序模式。拖拽只改变权威 Member Order，不改变队员所属 Presence 分组。
- 拖拽不能成为唯一输入方式；聚焦队员行或把手时必须提供等价的键盘“上移/下移”
  操作与明确可访问名称。提交 `members.reorder` 失败时恢复服务端顺序、宣布错误并
  保留原焦点。
- Member Order 只影响展示、新 Camp 初始队员顺序和失效 Lead 的未来修复；不改变
  Presence、当前有效 Lead、权限、能力或执行优先级。

### 队员详情

- 未选择时显示解释性空状态；选择后的首个身份区采用
  `minmax(190px, 240px) + minmax(0, 1fr)`：左侧显示 `4:5` 完整半身照，右侧标题行
  使用 50px 圆形 icon、Member Name、角色/身份说明和“编辑身份”。窄窗口时 portrait
  列收窄到约 190px，不裁掉主体。
- 身份区右侧直接显示专业职责、性格底色、工作准则与成长课题，不再增加“身份高级项”
  折叠入口；Presence 操作位于身份区下方。之后依次是
  Agent Runtime、Memory Capability 和危险区。不得显示或允许编辑内部
  handle，也不增加 Camp 数、消息数、记忆数或能力评分统计卡。
- Presence 操作直接使用“暂时离队 / 归队”，不弹出 Camp successor Dialog；
  Runtime 配置变化不能自动改变 Presence。
- “运行配置”区域的“Agent 运行时”选择只展示 Product Runtime，不展示 Installation ID、
  可执行路径、fingerprint 或发现来源。选择 Agent 运行时后，其下“运行参数”默认展开；
  切换 Agent 运行时会再次展开，用户仍可手动收起。模型、模型
  参数和权限由所选 Adapter 的专用组件与真实 descriptor 渲染；不得虚构跨 Runtime
  通用档位。Runtime、模型和权限作为一个草稿原子保存。
- 区域底部只保留一个“保存运行时”按钮，不显示“放弃更改”或独立清除按钮。只要
  已选择 Agent 运行时，按钮在上次保存完成后保持可用；请求期间禁用并显示
  “正在保存…”，完成后恢复并显示成功 Toast。选择“不选择 Agent 运行时”后点击
  “保存运行时”即清空已有运行配置。
- `runtime_default` 不显示模型或模型参数覆盖；固定模型只显示该模型实际报告的选项。
  权限与沙箱使用普通下拉框或开关，不显示危险/高风险标签、不使用警告色，也不增加
  二次确认。
- 区域打开时立即展示最近缓存结果；缓存缺失或过期只向 Core 发送后台刷新信号，不
  阻塞身份、模型、权限或其他参数编辑。切换 Runtime 会更新本地草稿并异步请求检查；
  保存只提交草稿，不显示“正在检查并保存”也不重复执行完整探测。
- 状态摘要只使用“正在检查… / 可用 / 需要登录 / 未安装 / 版本不支持 / 不可用 /
  暂时无法确认”；未选择时显示“未配置 Agent 运行时”。当前 Runtime 需要处理时显示一个
  主状态、次级原因与“前往 Agent 运行时”入口，不回退到其他 Runtime，也不在区域顶部
  叠加第二条 Readiness 警告。
- “允许写入记忆”是队员自身未来 AgentRun 的 Capability 配置，与应用级
  Agent Memory Write Policy 分离；关闭任一层都不能修改已有 Memory。
- 队员详情不渲染“高级设置”、对话压缩模型或任何 Summary provider/model 配置；相关
  展开按钮、state、import、CSS 和测试随能力一起删除，不保留空入口。
- 详情内部在可用宽度足够时两列，不足时单列；身份、Runtime、Memory 能力和危险区的
  阅读顺序保持一致。

### 创建、编辑与移除

- 创建/编辑身份使用受视口高度约束的 Radix Dialog，内容区独立滚动，取消与提交操作
  固定在滚动区之外。弹窗统一使用“队员”文案，创建提交按钮显示“创建”；专业职责、
  工作准则与成长课题默认显示两行，工作准则和成长课题按上下顺序排列。
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
- 危险区“永久移除队员”要求明确二次确认并说明不可恢复。`queued/running/waiting` AgentRun
  是唯一 blocker；存在时用中文提示用户先等待或停止运行。不存在时 preview 至少说明
  “将从 N 个 Camp 移除，并释放 M 个未完成 Task”，Core 再原子结束全部 Current
  CampMembership、释放 Task、收口 Default Lead 并标记 removed；UI 不要求逐个 Camp 离开。
- 移除继续保留头像、Runtime 配置、Memory、历史 Camp 关系、terminal Task、AgentRun 和身份；
  被释放的非终态 Task 通过 audit 说明 membership ending，不伪装成 Agent 主动修改。
- 历史消息、Task 和 AgentRun 继续显示 removed 队员原姓名、角色与头像，但身份位
  不可再打开详情，也不进入 `@`、Lead、Task 或新 Camp 候选。

## 记忆

### 页面骨架与状态语言

- 记忆是统一侧栏一级页面，右侧第一行保留纯空白的 50px 拖拽区，页面内容
  从第二行开始。Header 显示“记忆”和现有说明
  “所有正在沿用的记忆都立即生效；形成来源仅用于说明和审计。”，右侧
  “导出…”与“＋ 新增记忆”；不再显示“可回看 · 可修订 · 可遗忘”副标题。
- 页面依次为：四项紧凑摘要条、队员写入策略、待确认的共同记忆提案提示、
  Scope Tabs、治理过滤与搜索、列表/详情 Workbench。
- Scope 固定为“共同记忆 / 队员记忆 / 队员间记忆”，分别映射
  `hearth / companion / relationship`；首次进入默认共同记忆。Scope 表示所有权和适用范围，
  与 Kind“偏好 / 约定 / 经验”正交。
- 治理过滤固定为“全部 / 队员形成 / 建议复核 / 已停止沿用”，与 Scope 正交：
  “队员形成”和“建议复核”可以同时成立。
- 正在沿用的记忆、待确认的共同记忆提案与 Review Due 是三个不同对象：
  正在沿用的记忆已生效；提案接受前未生效；Review Due 只是提醒。UI 禁止出现
  `provisional`、Authority、“标记为已确认”或非 Hearth 的“等待确认”。

### 摘要、策略与 Proposal

- 四项摘要共享一个表面和内部竖分隔，不做统计卡墙：
  “正在沿用 / 共同记忆提案 / 队员形成 / 建议复核”。
- 应用级策略标题固定为“允许队员写入记忆”，正文固定为：

  > 开启后，队员可以直接新增或修订与你之间的记忆和队员间记忆，并提交等待你
  > 确认的共同记忆提案。关闭只阻止之后的队员写入，不改变已有记忆和提案。

- 策略 Switch 提交期间禁用；失败恢复服务端值。关闭不能 Retire、Forget 或拒绝
  任何已有对象。
- 只有存在待确认的共同记忆提案时显示 attention 提示“N 条共同记忆提案等待
  确认”。“查看提案”打开右侧 Radix Drawer；Drawer 常规 440px，显示完整候选、
  Kind、Retrieval Keys、提议队员、来源和 stale 原因。
- 每条 Proposal 的操作顺序为“拒绝 / 编辑后接受 / 接受”。stale 禁用两个接受
  操作但允许拒绝；批量只允许拒绝，禁止批量接受。处理后聚焦下一条，最后一条显示
  完成空状态。
- Companion/Relationship 的直接队员写入已经生效，不进入 Proposal Drawer；它们
  使用非阻塞通知和“查看”深链，通知不回显完整正文。

### Scope、搜索与 Workbench

- Scope Tab 显示图标、文字和未遗忘数量；数量不随治理过滤或搜索变化。
- 搜索只作用于当前 Scope，匹配当前正文、队员、Relationship 双方、Kind 和可见
  来源元数据。切换 Scope 清空搜索并恢复该 Scope 最近的过滤与选择；主题切换不
  重置页面状态。
- Workbench 为单一双栏表面，采用
  `minmax(310px, 0.9fr) minmax(390px, 1.1fr)`；在 `1040×700` 仍保持并列，
  两栏独立滚动，不转为覆盖式详情 Drawer。
- 列表行依次显示 Kind（`偏好 ○ / 约定 □ / 经验 ◇`）、正文摘要、归属、Revision/
  时间、创建来源和条件状态。状态不能只依赖颜色。
- Companion 显示队员头像、姓名与角色；Relationship 显示双方及
  `A ↔ B · 双方适用` 或 `A → B · 仅对该方向适用`，箭头必须有文字解释。
- 来源固定为“用户创建 / 队员形成 / 队员提议 · 你已采纳”，并另行显示最近
  Revision Actor。来源不改变正在沿用的记忆的效力、优先级或权限。
- 详情首屏显示 Scope、Kind、完整正文、归属/方向、Lifecycle、复核计划、当前
  Revision、版本、创建/更新时间、形成来源、最近 Revision Actor、可用来源与
  Projection 问题。

### 写操作与并发

- 用户新增从当前 Scope 预选：Hearth/Companion 允许 Preference、Agreement、
  Lesson；Relationship 只允许 Agreement、Lesson，并要求两位不同队员和明确方向。
- 修订只能改变正文、Retrieval Keys 和复核计划；Scope、Kind、队员、pair 和
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
  “返回 App”、设置说明和“通用 / Skill / MCP / Agent 运行时 / 外观 / 通知 / 诊断与修复”。
- “返回 App”恢复进入设置前的一级页面和 Camp，不把用户强制送回 Quick Chat。
- 设置分类由 Electron Main 作为 Desktop Shell 偏好保存，跨 Main Window Session 保留最后选择；
  全新安装或记录损坏时默认“通用”。明确深链到某一分类同样更新最后选择。设置本身不成为
  Restorable Location。
- 设置内容区使用自适应滚动面板，内部宽度
  `min(980px, 可用宽度 - 42px)`；通用、Skill、MCP、Agent 运行时、外观、通知和诊断与修复统一使用
  同一个无外框设置页头：eyebrow、一级标题、说明、可选右侧操作区和底部分隔线。各页只允许
  一个该共享页头，不叠加通用 AppHeader，也不得回退为带边框、圆角或背景卡片的 Hero。
  全部设置分类的内容滚动面板统一使用实白页面底色。
  App Shell 右侧第一行叠加一条与页面表面同色的 50px 隐形拖拽栏，设置内容
  继续跨越两行，不因该拖拽栏下移。
- 设置侧栏不显示健康 footer；“诊断与修复”仍是设置分类并读取 Core 诊断 Read Model。
- 设置页不增加“上下文投递”或“记忆”分区；公共消息摘要模型不再有任何配置表面，记忆仍是
  一级页面。

### 通用

- 共享页头固定为 `Settings / General`、标题“通用”、说明
  “设置 Rovai-ai 的启动方式、新对话与窗口行为。”；正文按“启动 / 新对话 / 窗口”排列。
- “登录时启动 Rovai-ai”使用标准 Switch，说明“登录 macOS 后自动打开 Rovai-ai。”。只有
  已安装的 packaged App 可操作；Development 显示 unchecked disabled 和
  “仅在已安装的 Rovai-ai 应用中可配置”。
- 安装与首次启动不主动注册登录项；全新安装默认 `not-registered`/unchecked。若 macOS 已保留
  有效注册，则直接显示系统状态，不使用应用首次运行标记强制覆盖。
- Login Item Registration 直接显示 macOS 系统状态：`enabled` checked；`not-registered`
  unchecked；`requires-approval` checked，并同时显示“等待系统授权，当前尚未生效”和
  “打开系统设置”；`not-found` unchecked，并提示重新安装或修复。Switch 不能用应用本地
  Boolean 冒充系统真源。
- “启动后打开”使用带 legend 的 Radio group。默认选择“上次使用的位置”，说明
  “恢复最近打开的对话、队员页或记忆页。”；第二项“快速对话”说明
  “每次启动都从快速对话首页开始。”。选择只影响下一个 Main Window Session，不立即跳转。
- Radio group 后固定说明“此设置只决定启动后显示的位置。已有 Camp、草稿、任务、审批和
  运行记录仍按 Rovai-ai 的既有恢复规则处理。”，不得增加执行恢复开关。
- “新对话”先提供默认队员与默认 Lead。全新安装保持未配置，不自动采用全部队员；选择只形成
  本地草稿，至少一位在队队员且 Lead 属于所选队员后，由“保存默认配置”原子生效。未保存草稿
  不能被一键创建读取。
- 队员永久移除、暂时离队、缺失或 Lead 不再有效时，Renderer 只把已保存配置锁存为“需要重新
  确认”；不得删除 ID、替换 Lead 或自动关闭一键创建。即使队员重新归队也必须显式重新保存才
  解锁。Runtime 配置与 readiness 不参与结构有效性判断。
- “一键创建新对话”默认关闭。每次从关闭切换为开启都显示非 danger 确认 Dialog，列出左上入口、
  已有 Project `＋`、快速对话 `＋`、“项目”标题 `＋` 四类入口，并说明项目由实际入口决定以及当前
  默认队员、Lead；主按钮必须为“开启一键创建”，不能写“确定”。关闭
  立即恢复 Dialog 路径。
- Switch 标题旁的 `?` 是非点击帮助标记；鼠标悬浮时显示“一键创建如何工作？”Tooltip，移开
  `?` 立即隐藏。文案逐项说明四类入口的项目来源，队员与 Lead 始终取本页保存值。全 App 的视觉
  `?` 帮助标记统一遵循纯 Hover 规则，不响应点击或键盘聚焦。
- 一键创建开启时始终显示当前生效摘要；失效时显示 attention 文案“默认队员配置需要重新确认。
  一键创建时将改为打开创建弹窗。”，开关保持 checked，所有创建入口安全回退 Dialog。
- 失效回退 Dialog 必须列出被过滤队员的姓名与状态、原默认 Lead 状态和本次临时 Lead，并声明这些
  预选调整只用于本次创建、不修改“设置 → 通用”的保存配置；失效锁存仍在但保存值已恢复时也要
  明示需要确认，不能伪造成员或 Lead 变化。
- Restorable Location 只包含 Quick Chat、当前 Camp、队员页及可选队员/身份或运行配置页签、
  记忆页。Settings、New Conversation Dialog、Notification Center、Command Palette、Approval、
  Toast、错误 Dialog 与其他临时表面永不成为启动目标。
- 恢复目标未通过 Core 权威读取前显示稳定 Startup Gate，不先闪 Quick Chat。Camp 删除后回退
  Quick Chat；Member 移除后进入队员页并选择首个可管理队员或空状态；Core 暂时不可用时保留
  原目标并继续等待/重试，不清除或重跑启动路由。
- “窗口”说明固定为“Rovai-ai 会自动保存窗口大小和位置，并确保下次打开时窗口仍位于可见的
  显示器区域。”，下方只提供“重置窗口大小与位置”。不增加“记住窗口位置”Switch。
- Reset 恢复 `1440×920` 默认尺寸（受当前 display work area 约束）并在当前显示器居中；它不
  改变页面、Camp、Member、Tab、Draft、Approval、AgentRun 或焦点。全屏时按钮 disabled，显示
  “请先退出全屏，再重置窗口大小与位置”，且退出全屏后不自动执行。
- General 的 Login Item、Startup Preference 与 Window Reset 使用独立 Loading、Submitting、
  Error 和 Recovery；`requires-approval`、`not-found` 与写失败必须是持久 inline status，不能
  只显示 Toast。

### 技能

- 保留现有 Settings App Shell、侧栏结构和侧栏交互；HTML 交互稿只约束 Skill 内容区，
  不替换设置导航。内容区 Hero 标题“Skill 管理”，说明按 Skill 独立选择 Runtime
  生效组，右侧只显示“应用全局配置”。
- 页面只有上下两区。上区“添加 Skill”使用“本地文件夹 / GitHub”两个 Tab；本地选择
  包含 `SKILL.md` 的完整目录，GitHub 接受仓库或带 ref/子目录的链接。两者都先检查
  候选，再确认写入受管 Library；不显示项目投递状态或 Camp 关联状态。
- 下区“已安装 Skills”提供名称/简介搜索和自适应豆腐块网格。每张卡显示名称、说明、
  `Rovai 内置 / 用户导入`、启停 Switch、当前生效组 Chip、分组多选入口，以及承载
  Revision、安装/更新时间、文件数、大小、来源和删除操作的更多菜单。
- 关闭 Skill 只弱化说明区并暂停全部 Rovai 投递，不能禁用生效组入口。关闭时仍可
  增删分组，已有选择必须保留；重新启用后按保存的分组恢复。删除中的 Imported Skill
  显示等待现有 AgentRun 释放，内置 Skill 不显示删除。
- 生效组菜单始终显示全部九组，可多选；每项显示组名、原生相对路径、`已验证 /
  暂未验证`、对应 Runtime 和按当前 AgentProfile Runtime 实时派生的队员。没有队员的
  分组仍显示，队员只用于查看，不进入 Assignment。新 Skill 默认不选择任何组。
- 新内置和 Imported Skill 默认启用。Rovai 内置为 `rovai-memory-stewardship`、
  `rovai-worktree`、`rovai-grill-duo` 与 `rovai-grill-duo-with-docs`；
  同名 Imported 更新创建不可变 Revision，内置同名导入拒绝。导入不执行内容，启用、
  内置来源和 `allowed-tools` 都不能授予额外权限。
- Settings 不展示 Shadowed、Duplicate visible、Stale 或项目级投递清单。这些实际
  AgentRun 事实只在 Camp Inspector 的“上下文投递”页中显示，并明确不声称
  Runtime 或模型已经读取正文。

### MCP

> v0.37 局部替代：本节的 Server list row、导入默认分配和 typed split Dialog 已由
> [v0.37 MCP 生产设计](../versions/v0.37/production-design.md) 替代。App Shell、Arctic Dawn
> Token、状态、安全、响应式与无障碍规则继续有效。

- 共享设置页头标题“MCP”，说明它是应用级外部 MCP Library、按队员分配且不修改各 Agent 运行时
  的个人配置；操作为“从本机 Agent 导入 / ＋ 添加 MCP”。
- 真源路径条显示当前权威 `~/.rovai/mcp.json` 或受控旧命名空间选择结果，并提供
  Finder 入口。UI 是该文件的图形编辑器，不建立 SQLite MCP 真源。
- Server 行显示启用 Switch、名称、`STDIO / HTTP`、命令或 URL、来源、明确队员
  分配、编辑与删除。停用是 neutral 状态，不使用危险色或整行不可读透明度。
- 导入只产生候选；用户逐项确认后一次性复制可移植定义，不同步来源、不写回来源，
  不复制 OAuth 状态、Token 或明文凭据。默认分配具体的当前在队的队员，未来队员不会
  自动获得。
- 添加/编辑 Dialog 使用 typed Stdio 或 Streamable HTTP 字段和有界键值编辑器；
  密钥值默认遮罩，不进入普通错误、日志或诊断。
- malformed 外部文件必须保留原文并阻止覆盖，提供“重新读取 / 打开文件”；权限
  不安全时提供显式修复。不能用空配置静默覆盖。
- 启停、编辑、删除只影响后续 AgentRun；正在执行与恢复中的 AgentRun 保持冻结 Exposure
  Snapshot。普通 UI 不声称 Rovai-ai 审批了 Runtime 原生 MCP 副作用。

### Agent 运行时

- 页面始终显示 Product Runtime Catalog 中全部已接入产品，不因本机未安装而隐藏；
  文档调研候选不进入普通 UI。
- Hero 操作为“重新检测全部”。旁边明确说明：显式重新检测会执行交互式登录 Shell
  初始化，但只读取 PATH；未登记产品不会因此启动 Session 或检查登录。
- 每行显示产品名、一个可操作主状态、版本/渠道、必要的次级说明、自查命令和
  “检查可用性 / 安装说明”。主状态只使用“正在检查… / 可用 / 需要登录 / 未安装 /
  版本不支持 / 不可用 / 暂时无法确认”，不得显示“已找到”“尚未检查”“已找到，
  尚未检查”或“已检查”。
- 页面立即使用 Core 最近缓存；缺失、过期或硬失效项在后台排队检查。仍可用的最近
  成功快照在刷新期间继续显示“可用”，刷新失败作为次级说明。快速发现不冒充认证或
  深度能力检查；单行“检查可用性”只请求 Core 异步刷新，不锁定其他行或页面编辑。
- “高级诊断与自定义启动入口”默认折叠；可执行路径、来源、fingerprint、最后探测、
  退避和迁移审计只在这里出现。普通队员只选择 Product Runtime，永不选择
  Installation ID 或路径。
- 未安装产品仍可被队员持久选择并处于 unresolved；页面不得自动改选另一个
  Agent 运行时。

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

### 诊断与修复

- Hero 操作为“运行完整自检 / 导出诊断 JSON”。完整自检严格只读，不同步 Skill、
  不初始化或修复 MCP、不 rescan/probe Runtime、不修改 SQLite、不登录或替换 Runtime。
- 页头后显示固定隐私边界：屏幕和 v5 导出不包含 Token、Cookie、登录信息、用户消息、
  Memory 正文、附件正文、Tool 输出或绝对 Home、SQLite、Runtime、Skill entry、工作区/项目路径。
- “诊断摘要”在同一表面显示“正常 / 需要处理 / 暂时无法确认”数量；三项之和等于完整检查数。
  Partial 与 Recovery 必须诚实标注，不把 unknown 或失败刷新伪装为全局成功。
- “需要处理的问题”只显示 attention。每项有问题名、原因与影响、默认收起的诊断详情和一个
  明确下一步。Skill 可重新同步，MCP 只修复安全权限，malformed 只前往设置，Runtime 只单项重检或
  前往设置，SQLite/数据问题只导出诊断。没有“修复全部”。
- 修复请求完成后必须复检同一 check ID；只有 `ok` 更新为 Success。复检仍为 attention/unknown 或失败时，
  保留最近成功报告、摘要和问题，并显示明确 Recovery/未修复说明。
- “完整检查结果”按“全部 / 需要处理 / 正常 / 暂时无法确认”筛选，且始终包含 Product
  Runtime Catalog 的全部九项。未使用且未安装的 Runtime 为正常非问题；只有被未移除队员选择且不可用才
  是 attention；超时和瞬时失败为 unknown。
- 页面覆盖 Loading、Running、Partial、Error、Success、Disabled 和 Recovery，原型状态切换器不进生产。
  `1440×920` 与 `1040×700` 均不出现整页水平滚动；长次级文字不小于 10.5px，操作与 disclosure 至少 28px。
- 导出使用显式 Save Dialog；取消零写入，成功后原子写入 `0600` 且提供当前 session 精确文件的
  Finder 入口。唯一格式为 `rovai-diagnostics-v5`，由 typed report 和 allowlisted 计数组成并经 Core 集中 redaction。

## 创建新对话 Dialog

- “新对话”从任意页面打开同一个 Radix Dialog。宽度
  `min(760px, 视口宽度 - 72px)`，最大高度 `min(790px, 视口高度 - 72px)`；
  Header/Footer 固定，Body 独立滚动。
- Header 为 `NEW CAMP`、标题“创建新对话”和说明
  “确定这段对话的工作环境与队员”；关闭按钮有可访问名称。
- Dialog 始终按下列顺序显示：

1. **工作目录 · 可选**：默认“快速对话”，也可选择已知 canonical Project 路径或
   “选择工作目录…”。普通安全目录和 Git worktree 都允许；Git 只显示动态能力提示，
   不执行 `git init`。Picker 取消不改变 Draft、不报错、不持久化。
2. **队员与 Lead**：默认选择全部在队的队员，顺序来自 Member Order；Agent 运行时状态只
   显示提示，不影响结构选择。存在有效已保存默认配置时预选该配置；否则默认全部在队队员。
   队员集非空，Lead 必须在已选队员中。
3. **可选配置 / 对话名称**：默认收起；展开后聚焦输入框，折叠摘要显示规范化名称或“未设置”，
   同时提供规范化 Unicode scalar `0 / 80` 计数与清空按钮。超过 80 时阻止继续输入；留空为
   “未命名对话”，不把名称生成委托给 Runtime/LLM。

- Footer 摘要只显示 Quick Chat/目录展示名、队员数与 Lead，右侧
  “取消 / 创建”。提交期间锁定会改变 Draft 的控件并防止重复创建。
- Core 原子接受后才关闭 Dialog、刷新 Navigation、进入耐久 Camp 并聚焦 Composer；
  Dialog 固定创建 Active，此时没有消息、AgentRun 或预建 Conversation 也合法。
- 失败保持 Dialog、目录、队员、Lead、名称、滚动和焦点。Core 刷新候选后不得静默
  删除队员、替换 Lead 或回退 Quick Chat。
- Renderer 不再展示“协作方式”“并肩协作”“领队统筹”或“暂未开放”；创建请求继续固定提交
  现有 `peer` 语义。本次 UI 删除不修改 Core union、SQLite 字段或历史 Camp。
- `Escape`、关闭与取消在非提交态关闭并把焦点返回原入口；页面切换、主题偏好和
  Quick Chat 落地页都不能产生第二套 Draft 真源。

## 通用状态、交互与无障碍

### 页面状态

- 每个一级页和设置页都必须覆盖 Loading、Empty、Partial、Error、Disabled、
  Submitting 与 Recovery；空状态解释原因并提供一个明确下一步。
- 读取失败保留页面 Header 与可恢复导航；局部写失败保留选择、草稿和焦点，不把
  整页替换为通用错误。
- Toast 只用于已完成的非阻塞反馈，`aria-live="polite"`；错误、审批或人物信息查看
  不能只用短暂 Toast。流式 AgentRun 不逐 token 播报。
- `recovering` 和 Unsettled External Effect 使用明确对象、最后已知状态、不确定性
  和下一步；不得声称停止等于外部副作用已回滚。

### 键盘与焦点

- 最低目标 WCAG 2.2 AA：普通文字 `4.5:1`，控件边界、焦点和非文字状态 `3:1`。
- 主要操作完全可键盘完成，焦点顺序与视觉顺序一致；Icon-only 控件有可访问名称。
- `focus-visible` 使用 2px `--focus`、`outline-offset: 1px`，不被 sticky、
  overflow 或固定审批区裁切。
- 模态 Radix Dialog/Drawer 负责 focus trap、`Escape` 和 focus return；非模态锚定
  Popover 不设 focus trap，并按局部合同处理 `Escape`、点击外部和 focus return。
  提交中可以阻止关闭，但必须说明忙碌状态。
- Tab 使用手动激活模式并实现方向键、Home/End；列表选择、排序、Switch、Menu 和
  Disclosure 使用对应语义，不用点击 `div` 模拟。
- 可点击目标最低 `28×28px`，主要操作优先 32px。Hover 不能是发现操作的唯一方式。

### 动效与窗口

- 动效限于 120–180ms opacity 或 2–4px 位移；遵循 `prefers-reduced-motion`。
  禁止光晕、脉冲、粒子、视差、大幅弹簧和全局 `transition: all`。
- 几何基准为 `1440×920`，最小窗口为 `1040×700`。应用范围内不得出现整页横向
  滚动或遮挡主要操作。
- Electron Main 始终自动保存 normal window bounds。重新创建窗口时把保存尺寸与位置 clamp
  到仍存在的 display work area；原外接显示器移除或状态损坏时，在 primary display 使用受约束的
  默认尺寸并居中，不能让窗口留在不可见坐标。
- General 的“重置窗口大小与位置”以当前窗口所在 display 为目标；全屏时不执行、不排队。
  Window geometry 变化不得重新加载 Renderer 或改变当前一级页面与业务状态。
- 270px 统一侧栏永不收缩。Camp Inspector 在 `1040–1179px` 为 260px、其他为
  310px；队员名册在窄区间为 250px；Memory 双栏最低 310/390；设置内容不再为
  第二列导航预留宽度。
- `1040×700` 下队员详情内部、外观卡片和健康摘要允许从多列变单列/两列；区域顺序
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
- v0.44 删除 `MemberAdvancedSettings`、`SummaryModelSettings`、“高级设置”展开入口、
  “对话压缩模型”文案及对应 state/import/CSS/test；不得删除 Member Runtime Parameters。
- v0.45 删除 Inspector “活动”页及其专属 route/state/IPC/test，把 AgentRun 过程详情迁入
  执行详情；执行动态只保留摘要和选择，不新增 AgentRun 级 Stop。CampTurn Stop 只
  保留 Composer 发送位置，Approval Dock 继续位于 Composer 正上方。具体边界见
  [Run Process Detail Surface v1](../contracts/run-process-detail-surface-v1.md)。Message
  Delivery、Public A2A 和 Context Profile 的领域语义由对应 ADR/Contract 约束，不能在
  Renderer 猜测。
- 删除 `rovai.rail-expanded` 等旧纯 UI 偏好，不迁移、不双读。Pin 使用新的
  `navigation.json`；ThemePreference 按已确认合同保留但全部解析为 Day。
- v0.49 新增 Main-owned `general-preferences.json` 与 `restorable-location.json`，继续复用并增强
  `window-state.json`。这些文件不进入 Core/SQLite；登录项状态只从 macOS 读取，不在文件中保存
  第二份 Boolean。Renderer 只能通过窄 Preload bridge 访问，不能读取文件路径或任意 JSON。
- v0.49 的一键 Pending Draft 由 Core/SQLite Migration 67 持有，不写入上述 Shell 文件；它按
  ADR-0145 复用现有 Composer Draft 与首消息发送事务，不增加旧 Active Camp 双读或兼容 UI。
- Quick Chat 全栈切换与旧 `<userData>/lobby/` 精确删除遵守 ADR-0074；不增加
  Lobby 别名、旧序列化值、双目录或 CSS 兼容类。
- Quick Chat 的项目式 Renderer 投影、设置覆盖侧栏和 `Rovai AI` 字标遵守
  ADR-0078，不改写正式产品身份或领域合同。
- 旧 Meridian 和旧记忆设计文档的有效安全、状态、Memory 与无障碍规则已经迁入
  本文；旧文件直接删除。历史版本只允许用勘误说明原设计文件已移除，不得继续把它们
  路由为当前权威。
- 生产代码实施已于 2026-07-30 取得用户明确确认；文档完成、原型可浏览或 ADR
  accepted 本身仍不等于实现完成。

## 明确非目标

- v0.24 不实现 Arctic Dawn Night，不根据 Day 自动生成暗色。
- 不新增 Project 领域实体、Quick Chat 实体、账号/资料菜单、Camp archive/trash、
  拖拽调宽、移动端布局或原型页面切换器。
- v0.49 不增加隐藏/后台登录启动、关闭窗口行为、默认 Project、执行恢复、自动批准、语言、
  通知规则或自动更新设置。
- 不改变 Runtime-native 权限、Memory Scope、Task、Camp Creation、A2A 私有正文或
  Execution Evidence 的权威边界。
- 不把静态原型数据、示例审批选项、示例路径、产品版本号或演示事件处理器复制到生产。
