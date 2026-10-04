---
document_type: version-decisions
version: v1.72
authority: decision-rationale
lifecycle: current
last_updated: 2026-10-04
---

# v1.72 版本决定

<a id="v1-72-d06"></a>
## V1.72-D06：Claude Code 打印模式通过原生双向控制协议接入审批

- 状态：accepted
- 日期：2026-09-30
- 当前权威：[Runtime Launch and Verification v46](../../contracts/runtime-launch-and-verification-v46.md) 与 [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md#claude-code-权限审批回调)

### 背景

打印模式缺少审批宿主时，原生权限规则要求询问的调用会被拒绝。Rovai 应当展示 Claude 发出的
真实权限请求，并把用户决定回填。此前 PR 的 command Hook 需要按完整输入匹配工具身份，
重复或并发调用存在歧义，累计观察缓存又使后续工具失去关联机会。

### 选择

保留打印模式和结构化输出，采用 stream-json 输入、stdio permission prompt 和原生控制消息。
原生 request_id 回复审批，tool_use_id 结算工具结果，进程所有权绑定 Run/epoch/Session。
初始化成功才发送任务；审批等待与持续读流独立，stdin 统一串行写入。结束由原生会话状态、
结果与待处理请求共同判断，带有界异常清理。Action/Approval、用户选项和 Dock 复用现有实现。

### 后果与替代方案

删除本 PR 注入的审批 command Hook、专用 IPC、完整工具输入匹配和累计缓存。仅保留待处理
控制请求；用户 Hook、Fast settings 与业务 `rovai send` lease 不受该替换影响。
原生 allow/ask/deny 配置保持冻结，不为修复审批增加 bypass 或全局 allow。
未采用非打印模式，因为它需要终端交互与输出协议改造；未保留 Hook 回退，因为第二条审批入口
会重新引入身份歧义。缺少可靠原生工具 ID 的版本明确拒绝并报告不兼容。

<a id="v1-72-d01"></a>
## V1.72-D01：Lark 作为独立 provider，克隆表族并参数化飞书实现

- 状态：accepted
- 日期：2026-09-24
- 当前权威：Lark Channel v1、Feishu Channel v17 与 Lark 渠道架构

### 背景

飞书渠道从设计之初就在 Core、可信域、发布器和合同中预留了 `brand=lark`，但登录入口固定为飞书账号站，运行期
长连接也没有按品牌传入 SDK 域，Lark 从未真正可用。`feishu_account` 上的 connected 唯一索引使同一时间只能连接一个
开发者账号，只要飞书与 Lark 共用该表族，两者就必然互斥。Principal 明确要求飞书与 Lark 作为两个独立渠道同时使用。

### 选择

新增 provider `lark`，拥有 5 张与飞书表结构等价的 `lark_*` 表、独立 Host 组件、8 个领域命令类型和 20 个初始请求名（D03 扩至 21 个）；
可信域、登录配置与 SDK 域按 provider 分离，飞书 provider 收窄为只接受飞书品牌。实现上不复制飞书代码：Core 领域逻辑
以 `ChannelProviderSpec` 参数化表名与 provider 常量，Main 以 Provider Profile 创建同一渠道服务类的第二个实例。
Core 只从请求名推导 Host actor。

### 后果

- 需要一次行为不变的参数化重构，覆盖飞书领域 SQL 中的表名字面量与 provider 常量；重构先于 Lark 接入独立合入。
- 三张在 CHECK 中写死 provider 值域的中立表必须重建；两个目录视图增加 Lark 分支。
- 同一队员可以同时拥有飞书与 Lark Bot；两家账号、Bot、会话和失败互不影响。
- 飞书 provider 不再接受 `larksuite.com`，理论上的历史 `brand=lark` 飞书行只保留可读，不自动迁移。
- 登录与控制台协议在 Lark 站点的一致性只能由真实租户证明，验收前产品不宣称支持 Lark。

### 未选择方案

- **在飞书 provider 内增加品牌选项**：改动最小，但受单 connected 账号约束，飞书与 Lark 只能二选一，不满足要求。
- **飞书表族增加 provider 列并改为按 provider 唯一**：迁移较小，但每条既有 SQL 都要补 provider 谓词，遗漏一处就会
  跨 provider 读写，隔离从结构保证退化为逐条人工保证。
- **复制飞书 Core 与 Main 代码并改名**：隔离清晰，但产生上万行重复实现，两家行为会逐步漂移。
- **中立请求增加 provider 参数代替独立请求名**：请求数更少，但会改变飞书既有请求合同，并让 actor 由 payload
  决定；按请求名推导 actor 与钉钉现有模式一致，请求面保持封闭可审计。

<a id="v1-72-d02"></a>
## V1.72-D02：导航摘要放入 Camp，范围失效配合完整快照恢复

- 状态：accepted
- 日期：2026-09-27
- 当前权威：[侧栏刷新架构](../../architecture/desktop-navigation-refresh.md)、[Navigation Read v1](../../contracts/navigation-read-v1.md)

### 背景

切换会话触发重复全局读取，导航仍聚合历史事件、全量载入会话后截取。单纯延迟刷新不能消除队列等待。
Principal 接受按会话/分组缩小范围，同时明确禁止新增持久化业务表和复杂同步机制。主线的通知与 Lark 迁移已占用
175 和 176；导航摘要独立顺延为 Migration 177。

### 选择

复用 camp 保存必要摘要、camp_view_state 保存已读、Core 事务保证一致性。在线提示声明行或分组；缺少可信
基础/变化范围时从摘要重新读取完整快照。活动序号按首次发布的用户消息更新，未读回复序号按首次发布、未撤回的
Agent 消息更新；Run 终态本身不产生新回复标记。

### 后果与替代方案

需要一次历史回填和摘要写入维护；正常读取不再付出历史聚合成本。不采用独立导航/分组变化表、删除补齐记录、
保留期或通用增量同步，避免双份状态与恢复协议。保留现有聚焦/低频完整性兜底；不引入优先级队列或独立数据库连接。

<a id="v1-72-d03"></a>
## V1.72-D03：Lark 入站附件复用持久下载队列并保留独立 Host 完成请求

- 状态：accepted
- 日期：2026-09-27
- 当前权威：[Lark Channel v1](../../contracts/lark-channel-v1.md#入站附件)、
  [Channel Message Bridge v1](../../contracts/channel-message-bridge-v1.md#inbound-attachments)与
  [Lark 渠道架构](../../architecture/lark-channel.md#共享而不复制)

### 背景

Lark 已有独立 Host 和 `Domain.Lark` 的 SDK 客户端，但入站观察仅保存附件摘要。飞书与钉钉后来新增的持久下载
链路不能直接复用飞书完成请求名：该请求名会被赋予飞书 Host 身份，Core 会拒绝 Lark 的待下载 Request。
因此只在 Host 打开资源描述会让下载长期停在队列，无法把文件交给 Agent。

### 选择

Lark 复用现有资源提取、下载器、等待队列、Source Ref 和失败提示；仅增加 Lark 专属完成请求名。
Core 从该封闭请求名赋予 `lark-channel-host`，继续以 provider、App、绑定和尝试代数校验完成结果。
Lark 文件导入 Camp 的 `lark/` 子目录，消息就绪后才可派发。

### 后果

- Lark 入站图片与普通文件由摘要升级为可读取的本地 Source Ref；文件夹与贴纸仍走整条消息失败提示。
- Lark Host 与飞书 Host 的下载候选、完成权限和文件目录保持隔离。
- 真实 Lark 租户的资源权限与客户端文件行为仍需单独验收；自动化测试不能解除该能力 gate。

### 未选择方案

- **复用飞书完成请求名**：请求名决定飞书 Host 身份，会破坏 provider 隔离并导致 Lark Request 无法完成。
- **另建 Lark 下载表和调度器**：可隔离状态，但重复了已有的 provider 分区、重试和 FIFO 语义，增加两套状态漂移风险。

<a id="v1-72-d04"></a>
## V1.72-D04：钉钉入站按平台签名链接下载，终态失败撤回排队卡

- 状态：accepted
- 日期：2026-09-27
- 当前权威：[Channel Message Bridge v1](../../contracts/channel-message-bridge-v1.md#inbound-attachments)

### 背景

真实钉钉租户的两条图片消息已经进入 Rovai，但下载三次失败，Agent 未执行，用户仍看到两张“进行中”排队卡。
对同一条失败请求进行只读核对：下载码兑换成功，平台返回 HTTP 签名 OSS 链接，图片内容可读取；
Host 的 HTTPS 限制在请求文件前拒绝该链接。原终态失败只删除尚未发送的排队确认，已发送卡片没有撤回任务。

### 选择

钉钉入站使用下载接口实际返回的 HTTP 或 HTTPS 签名链接，不改写协议；App 访问令牌仍仅用于兑换接口，
不转发给文件存储。所有 queued Request 的终态失败共用排队确认收口：未发出的确认删除，已发出的确认排队撤回，
再发送可见失败提示；钉钉失败提示卡使用终态失败状态。飞书、Lark 的成功准入和失败收口保持同一语义。

### 后果与替代方案

钉钉返回 HTTP 链接时文件下载使用 HTTP；这是本次真实租户可用性取舍。未采用仅把链接升级到 HTTPS：
当前 OSS 样本升级后可访问，但平台没有保证所有签名链接和存储域在改写协议后均有效。旧的两条请求已终态失败，
代码修复不会自动重新执行，需要用户发送新消息验收。

<a id="v1-72-d05"></a>
## V1.72-D05：公开 Composer 在发送前逐人邀请队外 Mention

- 状态：accepted
- 日期：2026-09-28
- 当前权威：[Public Camp Composer](../../architecture/camp-composer-draft.md#发送)与
  [结构化 Mention](../../ui/components/structured-mentions.md#member-typeahead)

### 背景与选择

Principal 希望在公开 Camp 正文中直接 `@` 队外成员，同时保留逐处提及并在发送时自动邀请。Core 已有成员加入与
消息发布命令，前者可使队员重返 Camp，后者只接受发送时可寻址的成员。采用本机 Composer 先从冻结正文去重
提取队外身份，逐人执行现有成员加入命令；全部成功后进入原消息发送流程。待邀请从当前正文派生，不存第二份名单。

### 后果与替代方案

成员加入和消息发布不是一个原子事务。部分邀请成功时不发消息，保留正文并展示逐人结果；发布失败时已加入的
队员仍在 Camp，重试需按最新名册重新判定。未采用扩展 Core 发送命令并在一笔事务中写入成员关系与消息：
这会改变现有发送、成员权限和幂等合同，超出本次交互目标。Pending Camp 首条输入没有先加成员的命令资格，
继续使用原激活路径。

<a id="v1-72-d07"></a>
## V1.72-D07：Thread 是公开命名，兼容入口与冻结 Session 身份保持

- 状态：accepted
- 日期：2026-10-01
- 当前权威：[Thread Naming v1](../../contracts/thread-naming-v1.md)、[ContextManifest v32](../../contracts/context-manifest-evidence-v32.md)、[Built-in Tool Transport v33](../../contracts/builtin-tool-transport-v33.md)

### 背景与选择

用户要求用简短标准名称替换 Camp，同时旧会话可 resume，新会话使用新 Bootstrap，升级即可获得新版 Skill。采用 Thread／threadId；reply chain 单独命名；内部 Conversation 保持私有。兼容入口只归一化已知别名，幂等身份保留旧表示；Bootstrap 按 Binding 使用已有冻结证据，Skill 复用现有原路径同步。

### 后果与替代方案

不采用 Conversation 作为公开名称，不重命名 SQL 或路径、不重写旧上下文，不以换 Session 规避兼容。上下文与工具新版本单独留证，旧版严格恢复。Migration 178 仅扩展新格式准入，保留失败回滚。完整前后对照及升级矩阵见[确认稿 r2](model-context-change-thread-rename.md)。

<a id="v1-72-d08"></a>
## V1.72-D08：User 为主称呼，旧 Session 继续读取冻结 Bootstrap

- 状态：accepted
- 日期：2026-10-02
- 当前权威：[User Naming v1](../../contracts/user-naming-v1.md)、[Built-in Tool Transport v34](../../contracts/builtin-tool-transport-v34.md)

### 背景与选择

Principal 对普通用户不直观，且现有指令同时用 User 和 Principal 指人类。用户确认 r2，要求简洁并保持旧会话可 resume。
使用 User、`--to-user` 与 `@User`，旧写法进入相同身份处理。公开 Bootstrap 生成收敛为一个模板，已有冻结证据优先；
新旧动态投影用已有 audience 与 A2A schema 区分。Skill 沿用安装包原路径同步。

### 后果与替代方案

不以轮换 Session 或重写旧摘要解决命名差异，也不增加兼容管理层、远程 Skill 服务或每轮迁移说明。
相比保留两份公开模板，统一生成减少重复指令，同时允许既有准入下未生成 Bootstrap 的旧执行继续恢复。
已有会话可能同时看到旧 Bootstrap 与新 Skill，旧别名确保仍可执行；具体证据与验证见[确认稿 r2](model-context-change-principal-user.md)。

<a id="v1-72-d09"></a>
## V1.72-D09：AI 创建队员使用普通草稿会话与独立静态入队回执

- 状态：accepted
- 日期：2026-10-02
- 当前权威：[Member Creation Flow v1](../../contracts/member-creation-flow-v1.md)、[Pending Camp Activation v3](../../contracts/pending-camp-activation-v3.md)、[Camp Open Projection v25](../../contracts/camp-open-projection-v25.md)、[Camp Activation](../../architecture/camp-activation-lifecycle.md#ai-队员创建)

### 背景与选择

Principal 要求 AI 成为默认入口，同时保持标准会话和已有队员设置。成功卡片只确认曾经创建，不承担当前配置状态。
创建回执与 Profile 使用同一事务、独立业务表和创建时快照；最近协助者偏好只在首次成功时更新。输入前不显示侧栏，
输入后由窗口内 map 保存草稿，首条发送仍走普通激活事务。

### 后果与替代方案

不采用工具日志重放生成卡片，避免普通 Open 扫描 Evidence；不另发系统消息，避免改变公屏和模型输入。
不持久化新草稿或在卡片订阅 Profile，接受刷新丢失草稿、历史卡片不反映当前状态的边界。资料删除与离队交给目标页。
新增 Migration 180 与 schema 130；历史创建不补卡。

<a id="v1-72-d10"></a>
## V1.72-D10：Run 主线按完整内容块分页，展开组独立读取

- 状态：accepted
- 日期：2026-10-02
- 当前权威：[Run Process Detail Surface v43](../../contracts/run-process-detail-surface-v43.md)、[Camp Open Read Path](../../architecture/camp-open-read-path.md#run-主线与展开组读取)与[会话工作区](../../ui/components/conversation-workspace.md)

### 背景与选择

用户观察到少量可见内容已经分页，且必须点击才能继续。原窗口按逻辑操作分页后再折叠，长 command 组占满页数，
短摘要却不产生可滚动区域。采用读取时计算内容块与完整组摘要，主线和展开组各有游标；首次不足视口时有界补读。
新选择器沿用既有请求与权限，旧 schema 2 读取保留。

### 后果与替代方案

不采用仅扩大原页大小：大组依然可能填满一页并增加传输；不建立持久化分组表：它需要维护实时补齐、版本化展示
分类及历史回填。读取时薄索引保留全 Run 元数据扫描和有序候选索引，换取无需迁移和有界传输。组身份沿稳定首 sequence，
旧子项变化用独立 changeSequence 更新，避免把 UI 分组变成新的执行事实或嵌套滚动层。

<a id="v1-72-d11"></a>
## V1.72-D11：一键草稿的内容本机保存，Core 只保留客户端存在标记

- 状态：accepted
- 日期：2026-10-03
- 当前权威：[Pending Camp Activation v4](../../contracts/pending-camp-activation-v4.md)、[Composer Draft v16](../../contracts/camp-composer-draft-v16.md)、[Camp Activation](../../architecture/camp-activation-lifecycle.md)

### 背景与选择

User 要求恢复一键新对话在消息模型重构前的草稿行为，并明确撤回“每项目一份”的限制。现有 Active Composer
已经按 Thread 本机保存；单独恢复 Pending 本机内容仍会被 Core 启动清理删掉身份，也无法列入导航。因此沿用本机
内容权威，只新增经 Host 认证的客户端 presence，让 Core 拥有导航和保留判断；每次新建保持独立身份。

### 后果与替代方案

新增小型表和事务内激活清理，需要一次加性迁移。保存要先写本机再确认 presence，失败保留编辑并阻止离开；
跨客户端只能隔离导航，不提供内容同步或冲突合并。拒绝重建旧 Core Draft、revision 和编辑租约体系：它会逆转
已完成的公开消息边界重构并引入不必要的多客户端协调。仅保留 Renderer map 也无法满足刷新和重启恢复。
AI 创建队员的专项窗口内生命周期继续由 D09 对应合同约束。

<a id="v1-72-d12"></a>
## V1.72-D12：Command Code headless 使用冻结的普通 Prompt Bootstrap

- 状态：accepted
- 日期：2026-09-27
- 确认：Principal 在 Camp 消息 `f70e9798-8f5c-4428-821f-bd51ec0b99f6` 确认 revision 4
- 当前权威：[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md#command-code-研究接入边界)、[当前版本模型上下文说明](model-context-change-command-code.md)、[Context Delivery Profile 10](../../contracts/context-delivery-profile-v10.md)

### 背景

Command Code 的官方 headless NDJSON 提供精确 Session 恢复，但没有已验证的单次高权限 Bootstrap 输入。受管 Mod 的 `appendSystemPrompt` 能追加原生 System Prompt，却是实验性接口；失败或格式异常可能继续模型调用，不能作为唯一的成员身份和 Charter 交付权威。项目／用户 `AGENTS.md` 又是共享原生状态，无法等同于目标 Native Binding 的冻结输入。

### 选择

候选 Product Adapter 使用现有 `first_payload`：Core 对目标 Native Binding 冻结的 Bootstrap `B` 与每 Run 冻结的动态输入 `P` 作精确选择，新 Session 将 `B + "\n\n" + P` 写入 headless stdin，普通完整 UUID 恢复只写 `P`；合格压缩补发沿用共享 envelope。明确接受此 Runtime 的 `B` 位于普通用户消息、低于 System/Developer 的产品差异，且只限 Command Code；身份、授权、CLI、文件和附件仍由 Core 合同独立约束。此决定允许按已确认方案实施，**不表示**压缩连续性、权限、Skills/MCP、Built-in、Usage、App 或平台 First-Class 已通过。

### 后果

- 用户不能把 Command Code 的 Bootstrap 理解为原生 System/Developer 指令。正式产品说明和资格证据必须保留该差异；若真实任务证明普通 Prompt 不足以维持 Charter 语义，禁止准入并重新提出上下文方案。
- 新／旧 Binding 与输入摘要继续按共享 Context evidence 冻结，未知接受结果不自动重投，`B` 超预算失败而不截断。
- Cline 的 ACP/Plugin 上下文方案独立决策；本条不替它接受普通 Prompt 层级。

### 未选择方案

- 将受管 Bootstrap 放进 Command Code Mod：其失败放行语义无法保证每个模型请求都有目标 `B`。
- 改写共享 `AGENTS.md`：会把成员私有的冻结 Bootstrap 投到项目／用户级并造成跨成员串线。
- 自封 ACP 代理：只改接口形状，不能补出上游缺失的高权限投递和审批保证。

<a id="v1-72-d13"></a>
## V1.72-D13：Cline 先在 macOS arm64 开放真实开发预览

- 状态：accepted
- 日期：2026-10-04
- 当前权威：[Cline 实施边界](../../architecture/runtime-catalog-boundaries.md#cline-实施边界)、[Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md)

### 背景与选择

User 在 Thread 消息 `33c5ae08-46e3-40ed-92ae-533dd4353b68` 要求保留开发包、配置队员并真实验证发送。
Cline 已有 shared ACP Host 和隔离真实模型证据，但尚未完成全部 First-Class 能力轴。仅 macOS arm64
开放平台 `Preview`，让开发包沿普通 discovery、Installation、队员配置和 AgentRun 路径取得产品证据。
不赋予 qualification revision，版本、原生认证、模型及权限检查保持生效。

### 后果与替代方案

允许在资格尚不完整时产生真实产品数据，因此必须清晰保留 Preview 与未知能力；其他平台继续关闭。
不选择伪造 Qualified 或验收专用绕过开关，它们会掩盖真实配置和发送路径的问题。继续完全关闭虽然保守，
却不能满足本次开发包的使用要求。此决定只允许开发预览，不接受 Cline 的尚未确认 Plugin Rule 提案，
也不把现有 FirstPayload 的试运行结果等同于 Bootstrap 或压缩连续性的正式资格。
