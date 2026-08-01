---
document_type: production-design
version: v0.29
authority: version-design
status: frozen
last_updated: 2026-08-01
---

# v0.29 队员工作台生产设计

## 权威与原型边界

本设计在现有 [Arctic Dawn V3](../../ui/arctic-dawn.md)、有效 ADR、Core 合同与生产代码
基础上收敛。`rovai-members-a3/index.html` 已在浏览器中实际打开并交互核对；其布局与
交互是本轮设计输入，但假队员、静态 Runtime 字段、演示状态和单文件实现不是生产合同。

只有本文明确标记为“已确认”的项目才替代既有 UI 规范。仍在讨论或本文未涉及的部分
继续遵守现行权威文档，不能从原型静默推断。

## 已确认：队员页上下文侧栏

进入“队员”一级页后，统一侧栏采用上下文投影：

1. 品牌行固定；
2. “新对话 / 队员 / 记忆”全局入口固定；
3. “跳转到对话…”固定；
4. 侧栏中部由普通页面的“置顶 / 项目”切换为队员名册；
5. 底部“设置”固定。

队员页主内容不再渲染独立名册栏，只显示当前选中队员的详情。侧栏与主内容之间只有
一份名册选择状态，不允许用隐藏的第二份列表维持旧 Workbench。

切换到 Quick Chat、Camp 或记忆等其他一级页面后，侧栏中部恢复普通导航投影。停留在
队员页期间，项目和 Camp 列表不与队员名册并列显示；用户通过“跳转到对话…”，“新对话”
或既有历史导航离开队员页。

这项决定替代 Arctic Dawn V3 中“普通侧栏在队员页继续显示置顶/项目”以及“队员主体
包含 272/250px 页面内名册”的对应规则。它不改变 Camp、Project、Member、Member Order
或 Presence 的领域含义。

## 已确认：身份与运行配置双 Tab

当前队员详情使用且只使用两个顶层 Tab：“身份”和“运行配置”。两个工作区互斥显示，
不再沿用当前生产页把身份、运行配置依次纵向堆叠的结构，也不增加第三个概括性“设置”
Tab。

Tab 只改变信息架构，不合并持久化命令：六字段身份继续由 Member Identity Update 独立
保存，角色图片、Member Runtime Configuration、Memory Write Capability 与 Presence
继续遵守各自的 mutation 和失败边界。切换 Tab 本身不得提交、回滚或伪造任一领域状态。

运行配置仍必须复用 Runtime 专用生产组件及当前 Adapter Capability Snapshot；A3 中的
静态“权限方案”字段不进入生产实现。

## 已确认：单队员运行配置草稿

Renderer 同一时间只持有当前选中队员的一份 Member Runtime Configuration 草稿，不为
多位队员缓存隐藏草稿。

- 当前队员在“身份 / 运行配置”之间切换时保留草稿且不提示；Tab 切换不重新从已保存
  Profile 或能力快照覆盖用户编辑。
- 草稿为 dirty 时，选择另一位队员、激活另一位队员的运行配置快捷入口或离开队员页，
  必须阻止目标切换并显示明确确认，操作为“继续编辑 / 放弃更改”。
- “继续编辑”关闭确认并保留当前队员、Tab、草稿和焦点；“放弃更改”清除当前草稿后
  执行原来请求的唯一目标切换，不保留可恢复的隐藏副本。
- 保存成功后清除 dirty 状态并使用最新服务端 Profile 继续显示。保存失败、CAS 冲突或
  能力快照校验失败继续保留草稿和当前队员，不静默修复或改写字段。

这项离开保护只管理 Renderer 草稿，不增加 Core 草稿实体、自动保存、跨重启恢复或
多队员批量提交，也不在页面内增加含义含混的“取消”按钮。

## 已确认：Member Order 专门模式

v0.29 保留 Member Order 的完整编辑能力。普通名册行的末端用于 Runtime 状态和快捷
入口；名册标题提供“调整顺序”，进入后切换为专门排序模式：

- 行末 Runtime 快捷入口暂时退出，显示拖拽把手和等价的键盘上移/下移操作；
- 每次移动继续提交权威 `agents.reorder`，不引入仅在 Renderer 保存的排序草稿或额外
  “保存顺序”命令；
- “在队 / 暂离”仍由 Member Presence 决定，排序不能改变分组；
- 排序只改变 Member Order，不能改变 Presence、Runtime Readiness、Capability、权限、
  当前有效 Default Lead 或执行优先级；
- 提交失败恢复服务端顺序、播报错误并保留原操作焦点；退出排序模式恢复 Runtime 状态
  入口和普通选择行为。

这项设计保留 Member Order 对展示、新 Camp 初始队员顺序和未来 Lead 修复的现有领域
作用，同时避免在窄侧栏中长期并列两个竞争性的行末操作。

## 已确认：Agent 运行时产品术语

普通产品界面统一使用“Agent 运行时”；当前队员详情中的配置工作区和 Tab 使用
“运行配置”。“执行引擎”退出当前产品词汇，不再作为 selector、状态、空状态、Toast
或帮助文案的别名。

领域代码和协议仍可使用 Product Runtime、Runtime、Adapter 与 AdapterInstallation；
Codex CLI、Claude Code 等具体产品保留自身名称。此决定已同步修正根
[`CONTEXT.md`](../../../CONTEXT.md)中的产品术语和未配置状态，不改变任何持久化值、IPC
字段、AdapterKind 或 Runtime 合同。

## 已确认：四类名册 Runtime 状态投影

侧栏行末的 Runtime 标记是 `Runtime User Status` 的紧凑入口，不是新的持久状态或
Readiness 真源。生产实现使用四类视觉投影：

| 投影 | 含义 |
|---|---|
| `✓` | 当前有可用的 Agent 运行时证据；仍可用的缓存正在后台刷新时继续显示可用 |
| `○` | 队员没有选择 Agent 运行时 |
| `!` | 已有选择，但需要用户登录、安装、处理版本、修正配置或执行其他明确修复 |
| 中性检查/未知标记 | 正在检查且没有可用缓存，或当前暂时没有可靠结论 |

第四类标记必须在 reduced-motion 下仍可辨认，不能只靠旋转动画。每个标记同时是运行
配置快捷入口，并通过可访问名称和可见 Tooltip 提供具体队员名、Agent 运行时产品与完整
状态文字；不能让 `✓ / ○ / !` 或颜色成为唯一信息。详情 Header 和运行配置 Tab 继续显示
完整 `Runtime User Status`、次级原因与可用修复入口。

这项投影不允许把“正在检查”误报为“需要处理”，也不允许因后台刷新把仍可用的缓存
降级为未知。

## 已确认：Renderer-only 版本边界

v0.29 只重建 Renderer 的侧栏投影、队员详情信息架构、草稿离开保护、状态映射、焦点
和响应式呈现。现有 App 状态已经提供 AgentProfile、AdapterInstallation、Product Runtime
Availability 与所需队员命令；本版本不得新增或改变：

- SQLite schema、Migration 或持久化值；
- Core 领域对象、状态机、命令语义或 Read Side 权威；
- Electron IPC 方法、共享 Contracts 或 Adapter Runtime 协议；
- Member Identity、Runtime Configuration、Presence、Memory Capability、Member Order、
  Camp Summary Model 或 Permanent Removal 的 mutation 边界。

若生产实施发现现有合同不足，必须停止对应实施、记录具体缺口并重新进入设计确认；不得
为了完成页面顺手扩张 Core 或数据模型。

### 必须保留的既有能力

A3 未展示下列能力不构成删除授权：

- v0.28 品牌行通知入口与未读徽标；
- 新增队员、身份编辑、复合头像选择与圆形裁切；
- Presence 的暂离/归队；
- 伙伴记忆 Capability 的即时独立保存；
- 永久移除的预检、明确二次确认和历史保留语义；
- ADR-0060 规定的应用级 Camp 共享摘要模型入口。该入口继续位于当前队员 Runtime
  附近，在“运行配置”Tab 的默认折叠高级区域中按需读取；它仍是所有 Camp 共享配置，
  不是当前队员的 Runtime Preference，也不与“保存运行时”合并提交。

## 已确认：名册规模边界

v0.29 以 100 位未移除队员作为明确验收规模。在此范围内名册使用普通 DOM 列表和独立
滚动，不分页、不虚拟化，也不增加 Core 查询接口。超过 100 位时应保持基本可访问，
但性能和高效排序不属于本版本承诺。

- 未移除队员不超过 20 位时保持 A3 的紧凑名册，不占用空间显示无必要搜索框；第 21 位
  起在名册标题下显示本地筛选。
- 筛选只匹配 Member Name 与 Team Role，不匹配内部 ID、handle、Runtime 字段、Memory、
  Presence 或身份长文本。
- 筛选是临时 Renderer 状态，不持久化、不改变分组计数、Member Order、选择、Lead 或
  任何 Core 对象；无结果使用明确空状态并允许一键清除。
- 进入 Member Order 模式前清除筛选并显示完整名册，避免在隐藏行之间执行难以理解的
  排序；排序模式不提供筛选。
- 验收至少覆盖 13 位 A3 基准、21 位筛选边界与 100 位键盘/滚动/选择压力样例。

## 生产收敛：App Shell 与名册

队员页继续使用 270px Arctic Dawn 统一侧栏和 50px AppHeader。A3 在小于 920px 时把
侧栏收窄为 230px 的演示规则不进入生产；现行最小窗口与 200% Zoom 合同仍以固定 270px
侧栏为准。

品牌行继续显示 `Rovai AI`、v0.28 通知入口和未读徽标。队员名册区的 Header 显示标题、
未移除队员总数、“新增队员”和“调整顺序”；Icon-only 操作必须有可访问名称和 Tooltip。
新增成功后选择新队员并打开“身份”，不自动选择或保存 Agent 运行时。

名册滚动区独立于右侧详情，使用细滚动条、`overscroll-behavior: contain`、只在确有隐藏
内容时出现的顶部/底部渐隐提示，以及不会遮挡 Focus Ring 的“在队 / 暂离”Sticky 分组
标题。`removed` 不进入名册；Presence 和 Runtime 状态继续是两个独立维度。

普通行依次显示受控圆形 icon、Member Name、Team Role 和行末 Runtime 快捷入口。身份色
只点缀 icon/选择，不承担 Presence 或 Runtime 状态。名称和角色允许省略号截断，但完整值
可访问；不能显示 handle、Installation ID、路径或 fingerprint。

首次进入且存在队员时，选择 Member Order 中第一位 `present` 队员；没有 `present` 时
选择第一位 `away` 队员。没有任何未移除队员时显示解释性空状态和唯一主操作“新增队员”。
选择和 Tab 是当前 App 会话内的 Renderer 状态，不写入 Core，也不要求跨 App 重启恢复。

## 生产收敛：入口、Tab 与焦点

- 点击名册行主体选择该队员并打开“身份”；点击行末 Runtime 标记选择该队员并打开
  “运行配置”。详情 Header 的 Runtime 状态入口对当前队员执行同一动作。
- 由 Runtime 快捷入口进入时，更新完成后聚焦第一个真实可编辑控件“Agent 运行时”；若
  离开保护先出现，只有用户确认放弃后才执行选择与焦点移动。
- 同一队员的行主体、Runtime 快捷入口与 Tab 切换不触发离开确认；它们只切换当前
  panel，并保留该队员 dirty 草稿。
- Tab 使用 `tablist / tab / tabpanel`、手动激活、方向键和 Home/End；非当前 panel 退出
  Tab 顺序和无障碍树，但其草稿由上层 Renderer 状态保留。
- 行选择后键盘焦点保留在触发行，避免详情重绘把用户传送到页面顶部；只有明确 Runtime
  快捷入口按上述合同主动移动焦点。Dialog、菜单和确认框关闭后返回原触发控件。
- 筛选不自动改变当前选择。若当前队员不匹配筛选，详情继续显示该队员，筛选区明确提示
  当前选择未出现在结果中；清除筛选即可恢复其行。

## 生产收敛：详情 Header 与队员操作

详情 Header 位于两个 Tab 之外，持续显示 50px 圆形 icon、Member Name、Team Role、
Presence 状态和完整 Runtime User Status。Runtime 状态是可激活入口；Presence 只显示
当前事实，不能因视觉相似而成为含义不明的切换按钮。

Header 直接保留“编辑身份”。`•••` 必须实现为有可访问名称的真实菜单，不得保留原型
死按钮；菜单承载“更换角色图片”“暂时离队 / 归队”和“永久移除队员”。Presence 变化
继续即时独立保存且不弹 successor Dialog；永久移除继续执行预检和名称确认，并使用
danger 呈现。当前存在 dirty 配置草稿时，永久移除先经过同一放弃确认。

身份 Dialog、头像 Dialog、Presence、Memory Capability、Runtime、摘要模型和移除分别
显示自己的 busy/error/success，不使用全页面锁，也不存在跨区域“一键全部保存”。

## 生产收敛：“身份”Tab

身份首屏使用 A3 的左侧身份摘要 + 右侧 `4:5` portrait。常规默认高度均为 360px；
portrait 使用现有 `MemberPortrait` 和受控 `avatarRef`，保持 360px，不因文字展开继续拉伸，
也不裁剪主体或加载任意路径/URL。

摘要按下列顺序显示：

1. 专业职责：默认最多 4 行；
2. 性格底色：默认最多 2 行标签；
3. 工作准则：默认最多 3 行；
4. 成长课题：默认最多 3 行。

只有真实视觉溢出的字段显示“展开”；操作名称包含字段名。展开只作用于当前字段并变为
“收起”，允许身份摘要超过 360px，其他字段与 portrait 不随之展开。窗口、字体或内容
变化后重新判断溢出；空值显示“未设置”，不出现无效展开操作。

身份区之后使用单一分隔行显示“伙伴记忆”、当前开关状态和固定说明：

> 允许这位伙伴在协作中形成长期偏好、约定或经验时写入记忆。

Switch 继续即时独立保存 Memory Write Capability；失败恢复服务端值并保留当前 Tab 和
焦点。它不与身份或 Runtime 保存合并，也不改变既有 Memory。

## 生产收敛：“运行配置”Tab

Tab 顶部固定说明：

> 为这位队员设置后续 Run 使用的 Agent 运行时、模型和该运行时提供的权限选项。保存后
> 仅影响之后创建的 Run。

随后显示一个完整状态摘要和生产 `MemberRuntimeParameters` 表单。状态摘要使用具体
Product Runtime、完整 Runtime User Status、版本/次级原因及必要修复入口；名册四类图标
不能替代这里的精确信息。

- Agent 运行时 selector 始终列出 Product Runtime Catalog；空动作显示“不选择 Agent
  运行时”，保存后的空状态显示“未配置 Agent 运行时”。
- 模型策略、模型、模型参数和原生权限严格来自 ADR-0082、Core Adapter policy 与当前
  Adapter Capability Snapshot。Codex `sandbox_mode` 与 `approval_policy` 等独立字段
  不能被合并；九种 Runtime 继续使用各自生产组件。
- 能力快照不可用时允许只保存 Product Runtime Selection，说明需要检查完成后回来保存
  参数；不伪造模型或权限。失效持久值继续显式显示并阻止无效保存，不能静默回默认。
- 页面打开使用最近缓存并只触发后台 ensure/refresh；切换 Runtime 不同步执行完整检查，
  保存也不显示“正在检查并保存”。仍可用缓存刷新期间继续为可用。
- 表单只提供“保存运行时”；请求期间显示“正在保存…”。不显示“取消”，也不增加独立
  清除按钮；选择“不选择 Agent 运行时”后保存即调用现有清除命令。
- 保存成功显示 Toast、刷新权威 Profile 并清除 dirty；失败保留草稿、Tab 和焦点。

运行表单之后保留默认折叠的“高级设置 · Camp 共享摘要模型”。展开后才读取应用级摘要
模型配置，继续使用自身“保存摘要模型”和 CAS；它不与 Member Runtime Configuration
共用按钮或草稿。摘要模型存在未保存选择时，同样参加离开保护，避免因切换队员或页面
静默丢失；不为多位队员缓存不同的隐藏摘要草稿。

## 生产收敛：并发、独立修改与离开保护

AgentProfile 的身份、头像、Memory Capability、Presence、Runtime 和 Member Order 都会
推进同一 Profile version。Renderer 不再用 `${agent.id}:${agent.version}` 无条件重挂载
Runtime 表单。

dirty Runtime 草稿记录其起始持久 Runtime Selection/Preference 基线：

- 当前 App 已知由身份、头像、Memory、Presence 或 Member Order 成功导致的版本推进，
  在持久 Runtime 基线未变时可以把草稿安全带到新 Profile version；
- 权威刷新若显示持久 Runtime Selection/Preference 已改变，Renderer 不得自动 rebase、
  覆盖或用更新后的 version 提交旧草稿，而是显示明确冲突，要求用户重新读取或放弃；
- 当前队员被其他操作移除或不再可管理时，禁止保存草稿，保留冲突说明并允许离开；
- Runtime 能力快照变化可以更新状态与选项有效性，但不得重置用户输入；最终保存仍由
  Core 在当前 snapshot 上原子校验。

离开保护覆盖所有可能最终离开队员页的入口：新对话、记忆、设置、Camp 快速跳转、
通知深链、Runtime 修复入口及选择其他队员。单纯打开通知中心、身份/头像 Dialog 或同一
队员的另一 Tab 不算离开，草稿继续保留。确认框一次只执行原请求目标，不允许确认后又
落到过期的第二个导航目标。

## 页面状态、响应式与无障碍

- Loading 保留 App Shell 和稳定几何，名册使用骨架但不虚构人数或状态；读取失败保留
  全局导航和重试。Partial Runtime 数据使用中性检查/未知投影，不阻塞身份区。
- 排序、Presence、Memory、Runtime、摘要模型和移除的局部失败各自保留选择、草稿和焦点；
  Toast 只用于成功的非阻塞反馈，错误不能只靠短暂 Toast。
- 几何验收继续使用 `1440×920` 与 `1040×700`。A3 已在浏览器中实际验证
  `1040×700` 为 270px 侧栏 + 770px 主区且无整页横向溢出；这只是设计输入，生产 App
  仍须重新验收。
- 详情区独立纵向滚动。常规与 1040px 基准保持双列身份摘要；在 200% Zoom 或有效内容
  宽度不足时，身份摘要/portrait 和 Runtime 字段按阅读顺序转为单列，侧栏仍为 270px，
  不产生整页横向滚动或遮挡保存、菜单、Tab 和 Focus Ring。
- 所有点击目标至少 `28×28px`；状态不只靠颜色；Icon-only 控件有可访问名称；Tooltip
  可由 Hover 与 Focus 打开。Sticky、Overflow 和渐隐层不能裁切 `focus-visible`。
- 第四种中性 Runtime 状态在 `prefers-reduced-motion` 下使用静态形状/文字替代持续旋转；
  `forced-colors` 下仍有边界和符号。页面支持 Tab、Shift+Tab、方向键、Home/End、Escape
  与 Dialog/Menu Focus Return，不要求指针或拖拽。

## 验收矩阵

生产验收至少覆盖：

- 0、1、13、20、21 和 100 位未移除队员；在队/暂离空分组、长名称/角色、筛选无结果；
- 普通名册、筛选、排序模式、拖拽、键盘上移/下移、服务端排序失败和焦点恢复；
- 四类紧凑 Runtime 投影及全部完整 Runtime User Status，含可用缓存后台刷新；
- 行主体、行末快捷入口、Header Runtime 入口、两个 Tab 的精确选择与焦点路径；
- 专业职责/性格底色/工作准则/成长课题无溢出、临界溢出、逐字段展开和 200% Zoom；
- 伙伴记忆成功/失败、Presence、身份、头像、移除，以及它们与 dirty Runtime 草稿的
  独立 version 推进；
- 九种 Product Runtime 的生产字段、无 snapshot、失效模型/权限、未安装/需登录、保存
  成功、异步失败、CAS 冲突与清除选择；
- dirty 草稿在同队员 Tab 间保留，切换队员和所有离开入口的继续编辑/放弃路径，以及
  持久 Runtime 被外部改变后的冲突路径；
- Camp 共享摘要模型的折叠按需读取、独立保存、来源队员变化和 dirty 离开保护；
- `1440×920`、`1040×700`、200% Zoom、reduced-motion、forced-colors、键盘和读屏；
- v0.28 通知入口、快速跳转、新对话、设置返回和其他普通侧栏投影无回归；
- 实施 diff 不包含 Migration、Core、IPC/Contracts 或 Adapter 语义变化。

## 明确非目标

- 不增加第三个队员详情 Tab、移动端布局、虚拟列表、分页或 Core 队员搜索。
- 不持久化当前队员、当前 Tab、筛选、排序模式或未保存草稿，也不提供跨重启恢复。
- 不新增全 Profile 自动保存、“保存全部”、多队员批量 Runtime 配置或隐藏多草稿缓存。
- 不改变 Summary 生成、Member Identity、Runtime Permission、Memory、Presence、Removal、
  Member Order、Camp、Project、Notification 或 AgentRun 的领域语义。
- 不复制 A3 的静态 Runtime 列表、合并权限字段、假队员、演示 Toast 或 230px 侧栏断点。
- 不重做 Arctic Dawn Token、Night 主题、身份素材系统、Dialog 裁切器或设置页。

## 设计门禁状态

高影响决策、现有合同继承、关键异常路径和验收矩阵已经写入。用户于 2026-08-01 明确
确认本文已经形成共同理解，设计现已冻结；随后已明确授权并完成生产实施。实施与验收
证据见[实施计划](implementation-plan.md)。
