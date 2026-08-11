# PROJECT_DESIGN · P2 Neutral Porcelain × Conversation / Settings / Members / Memory

## 1. Product Context

- **Product:** Rovai-ai，本地优先的多 Agent 研发工作空间。
- **Target user:** 在本机组织长期队员、Camp、任务、审批与执行证据的软件开发者。
- **Target surface:** 同一 App Shell 内的 Active Camp 会话、底部 Agent 级执行台、七个设置页面、队员名册与详情、记忆目录与详情，以及这些页面触发的 Dialog / Drawer。会话信息架构以生产提交 `95e4aa2`、ADR-0154 与 Run Process Detail Surface v2 为准，`agent-execution-process-b` 仅作交互参照；保留本原型既有 Composer、Approval 与 App Shell。
- **Primary job-to-be-done:** 验证 P2 冷瓷灰 + Steel 风格能否同时承载真实会话、AgentRun 证据、偏好配置、长期队员身份、运行能力和治理型记忆，而不损失产品信息密度与状态辨别。
- **Success criteria:** 会话、设置、队员、记忆四类工作台看起来属于同一个精密本地工具；用户能区分消息、长期 Task、Agent 级执行历史、语义状态与危险操作。所有可见能力、术语和交互来自当前 Renderer 合同，不引入新能力或伪造本机状态。
- **Content/data that must appear:** 270px 统一侧栏；文件夹式 Project / Quick Chat 与项目置顶；生产层级的新对话 Dialog；统一左对齐、统一 Agent 表面的消息；紧凑会话 Task；每 Agent 一个的底部执行入口及连续 AgentRun 证据；任务 / 上下文投递 / 审批三个 Inspector 页签；应用/能力/支持三组七个设置分类；队员同源 icon、4:5 半身照与可点击 Runtime 状态；记忆目录 / 详情与提案 Drawer。
- **Interaction requirements:** Execution Drawer 初始关闭，只由用户点击 Agent 打开；优先聚焦最新 running Run，且只有被聚焦的 running stage 默认展开。历史 Run 保持折叠但可手动展开，终态过程可反复重开；关闭或焦点位于 Drawer 内时按 Esc 均回到触发入口。页面切换保留执行历史、草稿与本地未提交状态；队员 tabs 使用 manual activation；记忆筛选与详情联动。所有提交动作只给出明确的本地原型反馈。
- **Technical constraints:** 交付为独立、自包含、可点击 HTML 原型；不修改生产 React/CSS，不接入 Core，不加载外部字体、框架或网络资源。四组生产内置角色图经压缩后以内嵌 JPEG data URI 保存。基准尺寸 `1440×920`，最小尺寸 `1040×700`，兼顾 200% Zoom。

## 2. Existing UI Read

- **Current visual vocabulary:** Arctic Dawn Day；冷纸白主表面、靛蓝品牌、低饱和 Aurora、细分隔线、极少阴影。
- **Strongest existing cue to preserve:** 统一 270px 侧栏与“会话阅读区 + Composer + Inspector”的核心三段结构。
- **Components/tokens to reuse:** Camp Header、公共消息行、Composer、Approval Dock 预留、Inspector Tabs、Task / Context / Approval、AgentRun 证据表面与稳定身份色。
- **Patterns to preserve:** 单一工作表面而非卡片墙；状态不只靠颜色；品牌色、身份色、状态色、证据色分离；稳定产品词汇。
- **Patterns to evolve:** 侧栏由 Arctic Dawn 灰绿转为 P2 中性冷瓷灰；主区层级减少装饰，但不再把消息区压成单色设置页：身份色、用户消息色、执行证据色和任务状态色各自承担语义，不互相替代。
- **Patterns to remove or avoid:** 参考稿的 76px 研究切换栏、假同步状态、假健康 footer、版本号、品牌副标题、演示事件和不存在的 Runtime 设置。
- **Accessibility/state conventions already present:** WCAG 2.2 AA、2px `focus-visible`、28px 最小点击目标、Radix 语义、manual tabs、reduced motion、Loading/Empty/Partial/Error/Disabled/Submitting/Recovery。

## 3. Taste Direction

- **Product identity sentence:** 一层安静、精密的冷瓷灰工具外壳，包裹一个证据优先、可长期工作的多 Agent 协作空间。
- **Recommended taste direction:** P2 Neutral Porcelain 的中性冷灰 + 克制 Steel 强调，保留 Arctic Dawn 的可信度与语义色。
- **Direction to avoid:** 蓝灰过重的企业后台、全白泛 SaaS、过度“高级”的玻璃拟态、卡片墙或为了统一而单色化状态。
- **Why this makes the UI more useful:** 侧栏退后、Composer 和当前协作事实前进；用户更快确认“我在哪、和谁一起、下一步在哪输入”。
- **What should feel distinctive:** 冷瓷灰侧栏、细而清晰的 Steel 选择标记、统一左对齐的公共会话，以及贴近 Composer、按队员聚合全部 AgentRun 的底部执行台。
- **What should stay quiet:** 非当前导航、装饰图形、空 Inspector、元数据、非阻塞说明。

## 4. Selected References

### [`rovai-porcelain-gray-study.html`](../porcelain-gray-study/rovai-porcelain-gray-study.html) · P2 Neutral

- **Why it fits:** 它给出经过 P0–P4 对比后的明确中性冷灰侧栏方向，与 Rovai-ai 的固定 270px Sidecar 同构。
- **Transferable traits:** `#F3F4F4` 侧栏、`#E8EAEA` Hover、`#E9ECEE` Active、`#526F88` Steel indicator/focus、低阴影、细线分隔、系统字体和紧凑工具密度。
- **Non-transferable brand details:** 研究控制栏、Steel × Porcelain 文案、假 Logo/副标题、假状态、假设置内容和 7–9px 文字。
- **Implementation substitutions:** 用真实 Camp、Project、队员、Runtime、Draft 和 Inspector 术语替代示例；用当前 SVG/字符图形替代参考标记；使用现有状态与证据 Token。
- **Risk:** 若把参考色直接写入全局 `:root`，会意外改变全部 Renderer 页面并破坏现有精确 Token 测试。
- **Weakening rule:** 任何 P2 选择若降低可读性、证据识别或状态辨别，优先回退到 Arctic Dawn 的 `--control-line`、状态色和证据表面。

## 5. Visual Theme & Atmosphere

- **Design thesis:** Sidecar 像精密仪器的冷瓷灰外壳；中央 Camp 是更明亮、可书写的工作纸面。
- **Emotional tone:** 冷静、可靠、专注、不过度办公化。
- **Product personality:** 本地、专业、耐用、有轻微品牌温度，但不拟人化或游戏化。
- **First viewport message:** “这段协作正在推进；消息讲结论，底部执行台保留可复查的过程。”
- **Visual weight priorities:** 当前消息与 Composer > 当前队员执行过程 > 长期 Task > Inspector > 非当前侧栏项。

## 6. Color Palette & Roles

- **Page/background:** `#ECEEEF`，只作为外层画布与轻微结构间隙。
- **Primary surface:** `#FBFBFA`；会话阅读区与 Composer 使用 `#FFFFFF`。
- **Conversation surfaces:** 会话轨道使用近白 `#FCFCFB`；用户消息使用低饱和 Steel-soft `#E8EEF3`；全部队员消息使用同一个中性白色表面，身份色只进入头像与作者名；执行证据使用 `#F4F6F3`，Task 与 running 状态使用各自语义色。
- **Identity acquisition:** 不按“Lead / Renderer 工程”等角色名取色。复用生产 `theme.ts` 的 FNV-1a 稳定哈希，把 `AgentProfile.id` 映射到 `--identity-1..8`；展示名或团队角色变化不会改色。用户、系统、证据与状态使用各自固定语义色。
- **Secondary/elevated surface:** `#F0F2F4` / `#FAFBFB`；真正浮层才使用白色与阴影。
- **Sidebar:** `#F3F4F4`；Panel `#FAFBFB`；Hover `#E8EAEA`；Active `#E9ECEE`。
- **Primary text:** `#171B20`；侧栏文字 `#2B3238`。
- **Secondary text:** `#616A73`；侧栏次级文字 `#626B72`。
- **Muted text:** 不采用参考中对小字过浅的 `#8A949D`；小字号使用至少满足 AA 的现有 `--faint` 校正值。
- **Accent/CTA:** Steel `#526F88`；强交互 `#3D5874`；高对比文字 `#FFFFFF`。
- **Border/divider:** `#DFE4E8`；侧栏 divider `#DADDE0`；强结构继续使用现有 `--line-strong` / `--conversation-inspector-line`。
- **Focus ring:** `#526F88`，2px，offset 2px；若对比不足则回退现有 `--focus`。
- **Success/warning/error:** 保留现有语义色，不用 Steel、Aurora 或身份色替代。
- **Color constraints:** P2 颜色只作用于原型的壳层与非语义选择；会话新增颜色必须是身份/状态语义色，不能用装饰色伪造运行状态；Evidence、Diff、Approval、Danger、身份图像不随 P2 壳层染色。

## 7. Typography Rules

- **Font families and fallbacks:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif`。
- **Display/hero:** Active Camp 不设营销式 Hero；Camp 名称使用 Header 的紧凑工具层级。
- **Section headings:** 13–15px，650–700 weight。
- **Subheadings:** 12–13px，650 weight。
- **Body:** 13px，1.6 line-height。
- **Labels/captions:** 10.5–11px；不复制参考稿 7–9px 的正文密度。
- **Code/mono:** 仅用于时间、计数、稳定 ID 和短状态；不把普通中文导航强制等宽化。
- **Weight rules:** 同一行最多三个清晰层级；不依赖全粗体建立层级。
- **Line-height rules:** 中文正文 1.55–1.7；单行导航 1.25–1.35。
- **Letter-spacing rules:** Eyebrow 0.1–0.12em；正文与导航默认字距。

## 8. Component Styling

### Sidebar

- 270px 固定宽度；P2 Sidecar 背景，右侧 1px divider，无阴影。
- Brand 行只显示受控 Logo 与 `Rovai AI`，不显示副标题或假健康信息。
- 当前 Camp 使用浅灰 Active、左侧 2px Steel indicator 和字重。当前 Project 不显示“当前”文字；本轮探索按用户确认使用稳定浅灰底，同时保留 `aria-current`。
- directory Project 与快速对话均为文件夹式主行；不显示独立 caret。三点菜单和 `＋` 是主行外的 sibling 控件，支持整项目置顶且不复制原分组。
- Hover/Focus/Active 都有独立状态；触摸替代路径不依赖 Hover。

### Camp Header

- 50px 白色/近白表面，细底线；左侧 Project › Camp 与“第 N 天”，右侧只保留 Inspector 显隐。
- 不在 Header 放 Run / Activity、Stop、置顶、删除或执行摘要；执行唯一入口位于会话底部。

### Conversation Timeline

- “你”和所有队员使用同一个左侧头像 + 正文网格；不为用户消息建立右对齐分支。
- 每条消息只有 name / role / time 与正文；不放“已送达”“等待审批”“来自执行”等消息标签。
- 复制按钮位于消息右侧，默认隐藏，只在消息 hover 或内部控件 focus 时显现；按钮为 icon-only，并保留可访问名称。
- A2A 关系只在正文下方显示 `发送给@队员`，不加冒号；`@队员` 使用默认透明、蓝色文字的结构化 Mention，hover / focus / open 时出现 8% 浅蓝反馈并可打开队员资料卡。消息内不提供“打开执行过程”或任何 Run 入口。
- 日期分隔严格使用生产 `M月D日 周X · DAY N`，不伪造“今天 · 主题”字段。

### Conversation Task

- 会话中的 Task 是约 47px 的紧凑双行入口，只显示 status / title / assignee。
- 不在会话 Task 卡显示描述、验收条件或 AgentRun 数量；完整长期责任仍属于右侧任务 Inspector。

### Agent Execution Dock

- RunPulse 位于会话底部、现有 Approval / Composer 之上；Execution Drawer 是同一区域内的非模态、可收起详情区，不是顶部 Activity、右侧覆盖层，也不遮挡 Composer。
- RunPulse 按 `(Camp / Conversation, Agent)` 聚合；同一 Agent 多次 AgentRun 只追加到内部连续历史，不增加第二个入口。
- Drawer 初始关闭，后台状态变化不自动打开或切换 Agent。点击 Agent 后优先定位最新 running Run，其次最新 queued / waiting Run；若只剩终态，则聚焦最新 terminal Run。
- 只有“正在运行且被聚焦”的 stage 默认展开 Evidence；queued / waiting 与 succeeded / failed / cancelled 的历史 disclosure 默认折叠，但用户仍可逐条展开。
- succeeded / failed / cancelled 不触发自动关闭或数据清空。收起、切换页面、离开并返回 Camp 后，入口和全部历史仍可重新查看；关闭按钮或焦点位于详情区时按 Esc 都把焦点交还原触发控件。
- 删除的是 Inspector 审计 Tab，不是 AgentRun、Evidence、取消或底层审计语义；原型不新增 Run 级取消。

### Composer

- 保持白色输入表面、附件队列、Mention 原子 Token 和发送位；1440 下维持 790px，`>=1800px` 时扩展到 1040px，改善 2K 工作区的输入宽度。
- 只在可发送时使用 Steel 主操作；Disabled 保持可读，不靠透明度隐藏原因。
- Approval Dock 位置不变；本首屏无 pending Approval 时不渲染。

### Inspector

- 白色表面，使用强结构 divider；不变成 Drawer 或浮层。
- 三个 manual tabs 保持“任务 / 上下文投递 / 审批”；选中使用 Steel indicator，不给整栏铺品牌底色。
- 空状态短而具体，并说明数据何时出现；不制造计数或 Ready 状态。

### Settings

- 进入设置后，P2 侧栏槽位完整替换为“返回 App”和应用/能力/支持三组七分类；不同时显示普通导航与设置导航。
- 七页分别覆盖通用、外观、通知、Skill、MCP、Agent 运行时与诊断修复。General 保留“启动 / 新对话 / 窗口”；其余页面沿用生产内容边界，不把浏览器原型状态冒充本机能力。
- 设置右侧用 Steel 做结构锚点而不是整面染色：顶部极浅 Steel wash、页头竖 rail 与下划线、分段标记、选中行内嵌边线、主操作和本地状态点共享同一色阶；正文与禁用能力仍保留瓷灰表面。
- 外观页明确标注 Night 尚未设计；Runtime、MCP、诊断只展示“示例快照”，不伪造版本、路径、凭据、最近检查时间或健康结论。
- 启动位置、默认队员、Default Lead、一键创建、Skill / MCP 配置与诊断动作只做本地状态演示；返回 App 必须恢复 Camp 草稿、Inspector、Lead、执行台选择与展开状态。

### Members

- 队员模式保留 App 一级导航，在原会话导航槽位展示名册、在队 / 暂离分组和新增 / 排序入口；内容区不再重复第二条队员 rail。
- 详情只包含“身份 / 运行配置”两个 manual tabs。身份页展示专业职责、性格底色、工作准则、成长课题，不制造加入日期、Camp 数量或身份评分。
- 圆形 icon 与右侧 4:5 半身照来自同一位生产角色资产；身份色继续由稳定 `AgentProfile.id` 映射，不从角色名称推断。
- Team Role 下方的 Presence 是不可点击状态；Runtime 是独立可点击入口，包含状态点、产品、状态文字与右箭头。hover / focus 显示进入反馈，激活后切到运行配置并聚焦 Runtime selector。
- Runtime 页列出当前支持的九种产品，并明确模型与权限字段来自 descriptor；保存、离队、归队、图片更换与永久移除均停留在本地原型。

### Memory

- 记忆页使用“目录 + 详情”治理工作台，而不是统计卡墙；范围为共同记忆、队员记忆、队员间记忆，治理筛选与搜索共同约束目录。
- 详情展示生命周期、适用队员、形成来源、Retrieval Keys、建议复核和版本记录；修订、复核、停止 / 重新沿用与永久遗忘保持独立危险等级。
- 共同记忆提案使用右侧 Drawer，只有接受或编辑后接受才会生效；示例按钮不创建真实 Revision。

### Dialogs and Drawers

- 新建 Camp、队员身份 / 头像 / 移除、Skill、MCP、Runtime、诊断与记忆操作复用一个语义 Modal；通知中心和共同记忆提案使用右侧 Drawer。
- 新对话 Modal 保留快速对话、已有 Project、选择工作目录、非阻塞 Git 状态、成员至少一位、Lead 联动和 Unicode 80 字名称；不渲染重复“创建摘要”或静态黄色提示。
- Modal / Drawer 打开时约束焦点，Esc 关闭，关闭后回到原触发控件；危险操作使用独立 Danger 色和影响说明。
- 覆盖层明确写出“原型不写 Core / Main”，不能用成功提示暗示真实持久化、文件访问或网络访问。

### States and overlays

- Loading、Error、Disabled、Submitting、Recovery 使用真实文案和稳定几何。
- Toast 只用于原型内已完成的非阻塞反馈；Mention Popover、Dialog、Drawer 和 Approval 不用 Toast 替代。
- 普通页面面板无阴影；Popover/Dialog 可使用单一 float shadow。

## 9. Layout Principles

- **Spacing scale:** `4 / 8 / 12 / 16 / 20 / 24 / 32px`。
- **Container width:** Camp 阅读列使用 `min(790px, 可用宽度 - 54px)`；Composer 在常规桌面沿同一轴线，`>=1800px` 独立扩展到 1040px。
- **Grid:** 270px Sidecar + 自适应主区。Camp 保留 Header + Conversation + Agent Execution Dock + Approval 预留 + Composer + Inspector；设置使用单列滚动页；队员使用直接详情；记忆使用目录 + 详情双栏。队员与记忆的右侧工作区跨越窗口完整高度，3px Steel 顶边后直接进入 30px 页面留白与自身可拖拽 Header，不叠加 AppHeader 或独立 50px 空白占位条。
- **Section rhythm:** 时间分隔 → 公共消息 → 紧凑 Task → 结论消息 → Agent 执行台 → Composer。
- **Density model:** 工具型紧凑密度，正文仍保持 13px 与充足行高。
- **Whitespace philosophy:** 空白用于突出输入和当前事实，不用空白制造虚假豪华感。
- **Breakpoints:** `>=1180px` Inspector 310px；`1040–1179px` 260px；Sidecar 始终 270px。窄幅下 MCP 卡片改为单列，Runtime 操作换行，队员身份保持 190px 半身照，记忆目录 / 详情保持至少 260 / 300px。
- **Mobile collapse strategy:** 本产品不做移动端；在 `1040×700` 与 200% Zoom 下允许页面内部纵向滚动，不能产生整页横向滚动，半身照、页头操作和 Dialog 主动作必须仍可到达。

## 10. Depth, Motion, And Interaction

- **Elevation levels:** 页面 0；固定 Approval/Popover 1；Modal 2。普通导航、消息、Inspector 无阴影。
- **Border/ring/shadow rules:** 默认靠 1px 边界和表面差建立层级；Focus ring 永远可见。
- **Motion personality:** 精确、短促、近乎静止。
- **Transition rules:** 120–160ms，仅 opacity、background、border-color 与 2px 位移；禁止 `transition: all`。
- **Touch target rules:** 图标按钮与 tabs 至少 28×28px；主要操作优先 32px。

## 11. Do's And Don'ts

### Do

- 使用当前产品词汇、信息顺序和交互语义。
- 让 Sidecar 退后，让 Composer 与协作配置成为首屏视觉锚点。
- 保留状态色、身份色、证据色的独立职责。
- 用细线、表面差、字重和位置建立层级。
- 在原型中明确标注本地交互不写入 Core。

### Don't

- 不复制研究控制栏、假同步、假健康、版本号或假 Runtime 能力。
- 不在消息、Header 或每次 AgentRun 上复制执行入口；每个 Agent 只有一个长期入口。
- 不移动 Approval Dock，不把 Stop 放进 Header，不改变 Composer Mention 的输入、原子 Token 与发送行为；A2A footer 只复用同一资料卡语义。
- 不把用户消息右对齐，不在消息下显示送达 / 审批状态，不在紧凑 Task 卡塞入描述或验收条件。
- 不伪造本机 Runtime、MCP、Skill、诊断或持久化结果；所有假数据必须明确标为示例快照。
- 不用 7–9px 小字、过浅灰、玻璃模糊、Glow、渐变按钮或持续动画。
- 不修改或覆盖现有 `renderer-p1-complete` 原型和用户的其他工作树改动。

## 12. Implementation Mapping

- **Files likely to change:**
  - `docs/prototypes/renderer-p2-empty-camp/PROJECT_DESIGN.md`
  - `docs/prototypes/renderer-p2-empty-camp/rovai-p2-empty-camp.html`
  - `docs/prototypes/renderer-p2-empty-camp/README.md`
- **Existing components to reuse semantically:** `CampNavigation`、`CampWorkspace`、公共 Message、`StructuredMentionComposer`、Task / Context / Approval Inspector Tabs、Settings、`MemberSidebar` / `MemberManagement`、`MemoryLibrary` 与当前 Dialog / Drawer 合同。
- **Tokens/classes/variables to extend:** 只在独立 HTML 内定义 `--p2-*` 作用域 Token；不改生产 `:root`。
- **New components needed:** 无生产组件；原型局部建立 Agent 聚合的 RunPulse / Execution Dock、连续 AgentRun 时间线与 Evidence 展开结构。
- **Assets needed:** 四组现有生产内置角色的圆形 icon 与半身图经压缩后嵌入单个 HTML；Logo、星、地平线和普通图标继续使用内联 SVG / 字符。页面无外部资源请求。
- **Data/copy assumptions:** 使用匿名、非敏感、与当前合同一致的项目、队员、Memory 与 Runtime 示例；不复制真实用户路径、凭据、消息或持久化记录，示例状态不代表本机事实。
- **Prototype interaction coverage:** Camp 会话对齐生产提交 `95e4aa2`：消息复制、统一 Agent 表面、结构化 A2A Mention、真实日期格式、紧凑 Task、按 Agent 聚合的入口、显式打开 Execution Drawer、仅 focused running stage 默认展开、终态历史聚焦与重开；Composer / Attachment / Approval 边界保持不变，并在 2K 扩宽输入。其余覆盖文件夹侧栏 / Project pin、新对话目录与成员联动、七页设置、队员名册 / tabs / Presence / 可点击 Runtime / 头像弹窗、记忆范围 / 治理 / 目录详情 / 提案 Drawer。所有保存、导入、修复、删除与发送均不接 Core、Main 或 Desktop Shell。

## 13. Evaluation Plan

- **Build/typecheck:** 独立 HTML 做语法与静态资源检查；不因原型运行生产构建。若后续迁入 React，再运行 `pnpm typecheck`、相关 Vitest 与 desktop build。
- **Browser/screenshot:** 应实际渲染 `2560×1440`、`1440×920` 和 `1040×700`，检查会话与执行台、2K Composer、七个设置页面、队员 Runtime 入口、记忆、代表性 Dialog / Drawer；若运行环境无法控制浏览器，不把静态验收表述成已完成视觉验收。
- **Responsive:** 检查 Sidecar、三项 Inspector、横向可滚动的 Agent 入口、执行历史独立滚动、Composer、设置页头、队员半身照、记忆双栏、Dialog 主动作和 200% Zoom；禁止整页横向滚动。
- **Contrast/readability:** 普通文字至少 4.5:1，控件边界/Focus/非文字状态至少 3:1；重点复核 P2 次级文字。
- **Interaction states:** Hover、Focus、Active、Selected、Disabled、Empty；验证初始无 Drawer、点击 running Agent 后仅 focused running stage 默认展开、点击 terminal Agent 后最新 Run 获得焦点但历史保持折叠、手动展开历史、收起 / Esc 回焦与终态重开；同时验证消息复制 hover / focus、三项 Inspector 键盘、Mention / Composer 回归、设置路由、队员 tabs、记忆筛选 / 详情及 Modal / Drawer 焦点路径。
- **Product fit:** 首屏必须让用户理解当前 Camp、协作配置和下一步输入，不能看起来像设置页或通用 SaaS Dashboard。
- **Reference alignment:** P2 的中性冷瓷灰、Steel 强调、低阴影和细线分隔清晰可见，但研究工具与假内容不可见。
- **Generic UI regression:** 检查是否出现卡片墙、过度圆角、渐变主按钮、营销式 Hero、假统计或无意义 Badge。
- **Better-than-original check:** 对照 B 定稿：执行入口是否只在底部且按 Agent 聚合，消息是否只承担讨论结论，1040×700 下展开历史是否仍让 Composer 可达；若任一边界退化，应回滚对应选择。
