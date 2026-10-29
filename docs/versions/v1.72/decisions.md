---
document_type: version-decisions
version: v1.72
authority: decision-rationale
lifecycle: current
last_updated: 2026-10-29
---

# v1.72 版本决定

<a id="v1-72-d06"></a>
## V1.72-D06：Claude Code 打印模式通过原生双向控制协议接入审批

- 状态：accepted
- 日期：2026-09-30
- 当前权威：[Runtime Launch and Verification v48](../../contracts/runtime-launch-and-verification-v48.md) 与 [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md#claude-code-权限审批回调)

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
## V1.72-D12：安装发现与真实启动验证解耦

- 状态：accepted
- 日期：2026-10-05
- 当前权威：[Runtime Launch v48](../../contracts/runtime-launch-and-verification-v48.md)、[Runtime 边界](../../architecture/runtime-catalog-boundaries.md)、[Camp Member Fast v2](../../contracts/camp-member-fast-v2.md)

### 背景

版本展示和历史探测状态进入配置冻结、队列及派发门禁，CLI 实际可启动时也可能等待手动检测。
独立 Probe 成功并不能保证下一进程可执行，却增加冷启动成本和两个状态来源。

### 选择

发现只保存安装入口及安全身份；协议、模型与权限在实际执行 Host 的正文屏障内验证。
保留 Adapter 无法在正文前握手时的最小特例及主动诊断，不以历史健康结果授权运行。

### 后果与替代方案

保留现有字段和快照便于诊断，无 schema 迁移；旧 Ready 不再是调度通行证。
取消必须覆盖初始化等待，配置失败也须产生可见 Run，模型选择延迟到真实 Host 确认。
未选择 LKG、额外健康快照、重试调度或后台轮询，因为它们保留双重准入并增加状态复杂度；
也不直接删除门禁后发送正文，实际初始化验证必须先于输入。


<a id="v1-72-d13"></a>
## V1.72-D13：Fast 偏好直接交给真实 Runtime

- 状态：accepted
- 日期：2026-10-06
- 当前权威：[Camp Member Fast v3](../../contracts/camp-member-fast-v3.md)、[Runtime 边界](../../architecture/runtime-catalog-boundaries.md#camp-队员-fast-边界)

### 背景与选择

可选速度偏好依赖资格预测，增加子进程并可能把明确关闭值丢弃、意外继承原生 Fast 默认。
沿用现有三态存储、绑定代次及冻结，删除资格授权；关闭语义由支持路径的明确参数和开发回归保证，
不以每次运行观察确认或历史成功为条件。真实反馈只描述当前 Run，不反写偏好。

### 后果与替代方案

旧资格列无需立即迁移；不可靠的原生默认保持未知，部分 Runtime 会拒绝或忽略可选设置。
明确拒绝按原错误处理，不做兼容重启或重放。未选择恢复自动资格检查、扩展能力缓存或维护旧版参数回退，
因为它们继续混淆用户意图与实际生效，并可能扩大费用范围或污染后续 Turn。

<a id="v1-72-d14"></a>
## V1.72-D14：连接编辑以原生来源为权威，不另建 Key 副本

- 状态：superseded
- 日期：2026-10-04
- 后续撤销：User 于 2026-10-07 取消连接编辑；原生配置不改写，执行只读兼容与脱敏保留。
- 当前权威：[Runtime Launch v52](../../contracts/runtime-launch-and-verification-v52.md)、[Runtime Catalog](../../architecture/runtime-catalog-boundaries.md#claude-code-与-codex-原生配置)与[启动设置 UI](../../ui/components/app-shell-navigation.md#原生连接设置)

### 背景与选择

用户要求已经可用的 CLI 配置直接复用，并明确取消自动复制 Key 到 Rovai 私存。采用 Claude Code 与 Codex
原生配置的字段编辑；连接方式独立记录，官方登录继续归 CLI 管理。配置身份参与既有执行兼容性判断，
凭据只保留来源和摘要，不建立第二套有效连接或凭据同步体系。

### 后果与替代方案

编辑共享文件可能影响外部 CLI，必须在设置页说明；无法无损切换的原生版本／来源组合须明确报错。
保留凭据副本可使旧快照更易重放，却会创造迁移、同步和清理责任，故拒绝该方案。复制整个 Home 会影响
Skills、MCP 和会话，亦不采用。字段级合并及原生文件原子写入是必要边界，不扩成通用供应商平台。

<a id="v1-72-d15"></a>
## V1.72-D15：保存切换原生连接，撤回双路径保留与启动覆盖

- 状态：superseded
- 日期：2026-10-04
- 后续撤销：User 于 2026-10-07 取消连接编辑；原生配置不改写，执行只读兼容与脱敏保留。
- 当前权威：[Runtime Launch v52](../../contracts/runtime-launch-and-verification-v52.md)、[Runtime Catalog](../../architecture/runtime-catalog-boundaries.md#claude-code-与-codex-原生配置)与[启动设置 UI](../../ui/components/app-shell-navigation.md#原生连接设置)

### 背景与选择

D14 的原生来源权威继续保留；用户进一步撤回“保存官方后仍须保留另一套 API”的承诺。选择只在用户保存时
修改原生配置，未保存的完整表单与新 Key 仅留在编辑会话内。正常执行交给 CLI 自己读取连接和认证，不再持久化
独立模式或启动时重建 provider、临时文件与认证屏蔽。已有队员参数、权限、协作及恢复兼容性继续沿用。
原生托管存储可能保存 API Key，不能把不透明凭据直接当作官方账号。设置时复用原生账号类型读取，未知保持未知；观察与文件基线分离，保存不等待账号状态；
首屏先返回本地字段，辅助来源／身份／版本读取放到独立的一次补充请求，结果不能覆盖编辑中的草稿。来源限制只约束受影响字段，不能清空整表；未知写入目标不因默认文件存在而被推定有效。
来源位置缓存按实际入口与配置目录区分，普通环境变量不使其失效；明确换入口／目录后在同一编辑会话补充确认，按真实修改保留草稿，不恢复保存前的同步识别。
明确保存官方选择时用原生 ChatGPT 登录方式字段排除 API 类型，而不解密、复制或删除钥匙串对象。
这仍属于保存时编辑原生配置，不恢复执行时的额外认证判断；模型调用与登录刷新继续由 CLI 负责。

### 后果与替代方案

保存官方后，再用 API 可能需要重新填写，这换取了单一原生配置权威和更少的版本／认证兼容分支。OAuth 不删除，
共享配置影响如实说明；无法写回的已知有效覆盖在保存时报告。拒绝继续保留两条路径及运行时覆盖，也不采用
启动前写文件、退出后还原的方案，避免并发进程互相改变配置。前端保存前往返切换必须无损，失败保留全部草稿。

<a id="v1-72-d16"></a>
## V1.72-D16：继续执行是新的 User 授权，接入现有 Delivery lane

- 状态：accepted
- 日期：2026-10-07
- 当前权威：[AgentRun Continuation v2](../../contracts/agent-run-continuation-v2.md)、[Accepted Input Recovery v8](../../contracts/accepted-input-recovery-v8.md)、[Message Delivery v11](../../contracts/message-delivery-v11.md)、[AgentRun Recovery](../../architecture/agent-run-recovery.md)

### 背景与选择

停止不代表效果回滚；旧 Run 的 accepted/unknown 投递不能当作未执行。User 希望保留原目标、工作区，
由一次明确点击开始新执行，同一失败 Run 可多次尝试且状态独立。选择在命令事务中保存新授权，引用原
业务输入，并重用当前上下文 builder、命令幂等与唯一队列。一次续做有明确批次边界，不引入新生命周期。

### 后果与替代方案

需要增量迁移表示一条授权 Delivery 对应原多条业务输入，并保留其单 Run 归属约束。旧输入事实不改写，
清理门禁不放宽。拒绝重置旧 Run、复制冻结投递或单后继链，也不建设恢复协调器、效果对账系统或语义审批器。
提示词不追加来源 ID、证据和恢复指令。2026-10-08 User 明确要求可用性优先与默认降级，
替代早期显式新会话确认：继续即授权，兼容时优先恢复，已知不适用则自动新建；实际恢复失败在本次
输入尚未投递时允许一次新会话尝试。清理和接受后不重放的边界不变，不增加另一套恢复流程。

<a id="v1-72-d17"></a>
## V1.72-D17：Pending 首条消息原子邀请队外队员

- 状态：accepted
- 日期：2026-10-08
- 当前权威：[Pending Camp Activation v5](../../contracts/pending-camp-activation-v5.md)、[Camp Message Send v26](../../contracts/camp-message-send-v26.md)与[Public Camp Composer](../../architecture/camp-composer-draft.md#发送)

User 确认一键草稿也应允许队外 Mention。延伸 D05 的编辑交互，在首消息事务中复用成员写入，
同时完成邀请、激活与发布；命令正常拒绝也显式撤销暂写成员，再保存拒绝回执。Active 路径仍按 D05。

直接放开 Pending 的单独成员命令会改变空草稿清理和放弃语义；先激活再邀请会留下零消息正式会话。
选择首消息原子提交保住现有生命周期，也把邀请权限限定在 User inline 输入；并发败方按当前 Active
名册重验。代价是发送准入与成员写入在事务内组合，须用数据库回归证明拒绝、异常与回放无残留。


<a id="v1-72-d18"></a>
## V1.72-D18：使命提及复用稳定身份，保存与入队原子提交

- 状态：accepted
- 日期：2026-10-08
- 当前权威：[Mission v12](../../contracts/mission-v12.md)、[Mission 架构](../../architecture/missions.md#inline-member-references)、[使命板 UI](../../ui/components/mission-board.md#description-member-mentions)

### 背景与选择

User 确认交互稿及模型仍读取 `@名字` 文字后，授权实现、创建 PR 并合入 main。使命描述需要保留每次提及的
位置与稳定身份，同时允许保存时邀请队外队员。采用文本/个人引用片段，在 Core 同一事务内保存描述与成员关系；
编辑器复用现有 Composer，模型接口继续返回原有 description 字符串。

### 后果与替代方案

需要一次增量迁移；旧字符串按字面迁移，重命名不会重绑身份。未采用按显示名解析，避免同名、改名和纯文本粘贴
产生隐式邀请。未复用会话先入队再发消息的跨命令流程，因为使命保存失败必须保持原队伍。成员准入与事件仍复用
现有 Camp owner；不引入第二套队伍、执行路由或模型正文数组。

<a id="v1-72-d19"></a>
## V1.72-D19：Mention 只统一模型消息元数据，格式按 Run 冻结

- 状态：accepted
- 日期：2026-10-09
- 当前权威：[Message Mentions v1](../../contracts/message-mentions-v1.md)、[ContextManifest v33](../../contracts/context-manifest-evidence-v33.md)、[Camp History v12](../../contracts/camp-history-v12.md)

公开自动输入与 read 需要向模型提供完整目标身份，但两者已有不同的正文、作者字段和恢复证据。
选择共用已保存目标的 Mention 投影，保留各入口正文；格式切换沿用 Run 的冻结版本，旧回执原样回放。
这样已有 Session 的后续 Run 能直接生效，旧 Run 未物化的中间态仍可按原格式恢复。

重解析 @文字或查询当前 Lead/队伍会改变历史目标；把切换绑到 Session 会扩大升级、轮换与上下文成本。
本次均不采用。代价是保留旧 Run formatter 与旧回执的封闭输出分支，并在既有数据库约束中准入新版本；
不建设第二套名称、预算或格式协商机制。

<a id="v1-72-d20"></a>
## V1.72-D20：Windows 以当前 Job 活跃数归零解除后继执行门禁

- 状态：accepted
- 日期：2026-10-09
- 当前权威：[Managed Runtime Process v2](../../contracts/managed-runtime-process-v2.md#4-ownership-and-termination)、[Windows Desktop Platform](../../architecture/windows-desktop-platform.md#3-managed-processes-and-shutdown)、[Cancellation Settlement v2](../../contracts/cancellation-settlement-v2.md#后续执行与清理)、[Camp 会话工作区](../../ui/components/conversation-workspace.md#public-camp-v160-当前边界)

### 背景与选择

非队长 Claude 完成后，Windows 收尾曾要求 Job 的生命周期累计成员数、完成端口通知和逐成员退出句柄
全部吻合。普通 Job 通知可能丢失；现场可出现 `ActiveProcesses=0` 而累计 91、通知 90 的状态，
使已完成 Run 的下一条 Delivery 长期 waiting，直到重启。现改为本次持有的有效 Job 成功查询
`ActiveProcesses == 0` 即完成资源收尾，提交 ACK 并唤醒现有调度器。用户停止和正常结束使用
同一判据；查询失败或仍有活动成员只在一次有界预算内重试，并通过现有 worker 局部恢复。

### 后果与替代方案

这是可用性优先的边界：不额外等待所有历史进程对象和在途 I/O 完成；可信原生业务结果
与 Job 清理分别结算，临时启动文件删除错误不延迟后继执行。保留原子 Job 所有权、
`KILL_ON_JOB_CLOSE`、精确 Run/epoch 持久回执和会话恢复规则。
未保留累计计数与通知对账，也未改用 PID 枚举或逐进程句柄补扫；前者依赖不保证送达的消息，
后两者重新引入历史身份与等待门禁。macOS、Linux 进程管理不随此决定改变。


<a id="v1-72-d21"></a>
## V1.72-D21：DSH 原生 ACP 为主，Web 模型在原生迁移完成后补充

- 状态：accepted
- 日期：2026-10-09
- 当前权威：[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md#deepseek-harness-acp)

DSH 将共享 settings 改为 Profile 配置后，仅在 Web 保存的模型不会自动出现在 ACP。
User 要求保留 `0.1.5-rc.2` 支持底线和原生配置优先级，以新增补充解决问题。
采用同进程内的配置准备插件，由 Probe 与 Host 共用，模型目录继续由 ACP 返回。
迁移完全由 DSH 拥有，Rovai 只做原生迁移期间的 Patch 隔离、非破坏性备份和完成核对。

没有选用升级强制迁移、复制 Home、配置迁移数据库或自行生成模型目录。
CLI 整块模型覆盖也不适合：本地原生实验表明，DSH 导入时会吸收当时加载的配置，
可能漏导旧模型或永久保存 Web 补充。改用原生 Loader 的非持久化更新，代价是维护一个窄的
初始化能力适配，并用最低版、旧共享版与 Profile 版的真实进程/HTTP 回归守住边界。
来源判断和一次回退只服务于配置准备，不能扩展成路由切换或新的恢复系统。
同 ID 的原生与 Web 选择需要区分时，仅在现有成员/冻结模型选择中保存可选来源标记，
由目录元信息在显式选择时提供；不维护来源数据库或历史。Web 故障只阻断依赖补充的选择，
Host 后续复用沿用现有配置指纹，选模阶段不再重复核验全部原始文件。

提示词不追加来源 ID、证据和恢复指令；会话真正恢复失败时结束当前尝试，显式确认才能以新会话继续。


<a id="v1-72-d22"></a>
## V1.72-D22：Command Code headless 使用冻结的普通 Prompt Bootstrap

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

<a id="v1-72-d23"></a>
## V1.72-D23：Cline 先在 macOS arm64 开放真实开发预览

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

<a id="v1-72-d24"></a>
## V1.72-D24：成功的模糊匹配编辑保留为补丁片段

- 状态：accepted
- 日期：2026-10-05
- 当前权威：[Runtime File Change Observation v7](../../contracts/runtime-file-change-observation-v7.md)、[Runtime 文件变化架构](../../architecture/runtime-file-change-observation.md)

### 背景与选择

User 要求 Cline 与 Command Code 的编辑能够点击查看增删。两者原生输入有修改片段，但执行器允许模糊匹配；
Cline 甚至在零 fuzz 时规范化标点。把输入复用为 exact mutation 会承诺无法证明的旧文件字节，而只保留路径又丢失了
已经确认成功的可审阅内容。选择新增 `reported_mutation`，保留来源区别、顺序与补丁统计，复用既有 Evidence 和 UI。

### 后果与替代方案

持久化语义增加一个可选种类，后续读取必须继续区分完整状态、精确替换与原生补丁。接受不能由片段获得净差异、
行号及实际旧字节的限制；不会据此提升 Runtime 资格。没有选择执行前后读取文件或 Git 捕获，因为并发写入、非 Git
工作区及完整状态归属会引入另一套观测权威。继续只显示路径可保持旧边界，却不能满足用户审阅已执行修改的要求。

<a id="v1-72-d25"></a>
## V1.72-D25：Command Code 使用官方 ACP 与必需 System Mod 开发预览

- 状态：accepted
- 日期：2026-10-05
- 当前权威：[Command Code ACP 边界](../../architecture/runtime-catalog-boundaries.md#command-code-acp-实施边界)、[Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md)

### 背景与选择

User 在消息 `677d610d-e4cf-4ffb-aba2-d4ebb021cbcd` 与 `1bd0ab39-6939-40cd-9653-b472b3b69082`
要求修复 System Bootstrap、warm 及全部可接能力。1.74.1 已有官方多 Session ACP，继续仅用 one-shot 会
丢失可接的常驻能力。选择共享 ACP Host/Fleet，macOS arm64 开放 Preview；新产品路径采用带 readiness 与
逐 Session 绑定校验的官方 System Mod，替代 D22 的候选 first_payload。完整输入变化由
[revision 5](model-context-change-command-code-acp.md)记录，Cline 的缺失插件反例独立保留。

### 后果与替代方案

原生 Mod 普通异常会被吞掉，所以必需绑定失败必须结束 Host。一个 Host 内其他 Session 随之失去驻留，但
可按精确绑定恢复；正确 Bootstrap 优先于保留失效进程。私有设置覆盖保留原生账号、模型和历史权威。
MCP 同名选择已有 native_wins_skip，避免改写原生全局/项目配置；冲突 Assignment 明确不可用。
未选择自造 ACP 代理或继续每轮 one-shot；也未将 handshake 和控制命令冒称模型 warm。
Preview 不代表完整资格：原生账号额度、自定义 BYOK 目录和压缩等未验证轴仍公开记录。


<a id="v1-72-d26"></a>
## V1.72-D26：macOS ACP 按内核身份回收独立进程组，并保留重启记录

- 状态：accepted
- 日期：2026-10-05
- 当前权威：[Managed Runtime Process v2](../../contracts/managed-runtime-process-v2.md#macos-acp-descendants)

### 背景与选择

真实 Command Code / Cline 在 Runtime leader 被强杀后留下独立进程组的 shell 工具；Cline 在 Core 被强杀后
还会迟到写入。stdout EOF 与根进程退出都不能证明整树已空。沿用 Managed Process，在 macOS 捕获 kernel
unique identity 与 PID version，以 audit-token signal 校验目标；私有 ledger 在 Core 重启、开放执行前回收。
ACP 另行观察 leader，保留有界的末帧消费。结果未知的公开 batch 沿已有恢复合同失败收口、禁止重放；清理确认独立。

### 后果与替代方案

依赖 XNU libproc 的固定 ABI，缺失或变化时关闭相关启动/清理确认；验收不外推其他 macOS 版本或平台。
未选择裸 PID/进程名补杀，因为可能命中复用身份或其他 App；未引入第三方 CLI fork、每 Runtime 私有池或
新的常驻代理，因为已有 Managed Process 与 Core 启动回收可拥有此职责。该方案不保证 Core 永不重启时的
自动回收，也不等价于 Windows Job 对未观测后代的内核级限制。


<a id="v1-72-d27"></a>
## V1.72-D27：Cline 正常 System Rule 交付与 Command 原生 MCP 配置

- 状态：accepted
- 日期：2026-10-06
- 确认：User 消息 `144d1d46-1ceb-4975-a8de-0b6d08f93c65` 与 `f80961bc-8447-42f1-83e0-a1f02b8107b9`
- 当前权威：[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)、[Cline System 输入说明](model-context-change-cline-system.md)、[Bootstrap 补发架构](../../architecture/native-session-bootstrap-redelivery.md)

### 背景与选择

官方 Cline Rule 可正常追加 System，故意移除受管 Plugin 的失败放行反例不应阻挡 User 已要求的主路径。
选择独立 Session 绑定的 managed_system_prompt，保留数值 observer，停止 user 层 Bootstrap 补发。
正常加载、A/B/A、cold 和绑定准确性仍需真实证据；不声称已实现必需 Plugin readiness 或原生压缩。

Command 官方 ACP 同时支持原生配置与客户端 MCP；按 User 指示由 Command 原生配置拥有 MCP。
Core 把分配结果写入 Host 私有 mcp.json，保留原生同名优先，更新/撤销经共享 compatibility fence 生效。
已解析 env/headers 转义防二次展开，stdio cwd 通过固定 argv launcher 保留；不改用户/项目原文件。

### 后果与替代方案

两个 Bootstrap/MCP profile 改变时旧 Binding 会沿既有流程失效；新 profile 内仍要求 exact continuation。
未选择继续把 Cline 身份放首条 user，亦未选择 fork 上游、用 shell 伪造 MCP 调用或替换真实模型 ID。
原生 MCP 发现成功不代表当前自定义 BYOK 调用成功；未通过项保留，两个 Runtime 仍为 Preview。


<a id="v1-72-d28"></a>
## V1.72-D28：Cline 采用独立 Native Hub，删除 ACP 后端

- 状态：accepted
- 日期：2026-10-07
- 确认：User 消息 `c023f19a-9f1c-4558-b4d4-1bbab3ddffe9`（Thread 80）
- 当前权威：[Cline 实施边界](../../architecture/runtime-catalog-boundaries.md#cline-实施边界)、[Runtime Launch v52](../../contracts/runtime-launch-and-verification-v52.md#cline-native-hub)、[Native Hub 输入说明](model-context-change-cline-native-hub.md)

### 背景与选择

实际安装的 3.0.3 为编译后二进制，ACP 没有可验证的 compaction 配置注入口。原生 Hub 的
sessionConfig 已验证可传入原生 basic，并在同一安装完成阈值压缩与同 ID cold。User 在阅读
该方案和证据后要求把 Cline 改为这一套并推送分支。选择官方 CLI 自有认证 Hub，不安装替代
Runtime、不修补上游、不实现第二套压缩器；共享 Fleet/Managed Process 和领域合同保持权威。

User 在消息 83（`b70db5df-d6eb-4d76-aadb-a88f32b8e5d9`）明确不存在旧会话，要求删除兼容逻辑。
Cline 仅冻结 `cline-hub-v1`；删除 ACP Host、3.0.65 门槛、Plugin observer 和后端 provenance 查询。
以实际认证 Session 探测判断能力。原生文件 Rule 承载原冻结 B，readonly hook
检查正常模型请求并采集稀疏数值。临时配置和永久历史分离，未知发送结果不自动重投。

### 后果与替代方案

User 85（`6dbd9e73-aef0-45cd-afcc-0688d3c4cf39`）要求 Cline 自己认证，User 87
（`a8b7cc52-e1b9-4293-9e65-278962e9823f`）进一步授权直接使用已登录账号。选择引用持久原生认证文件，
允许 Cline 自行写回，不复制日常 refresh token 创建伪独立授权。Rovai 仅管理认证来源和进程所有权。
以下为 User 85/87 阶段选择，已由 D29 取消认证独占与强制 cold：
实际安装只有实例内刷新合并，故账号 Host 结束即回收，同文件单个 Rovai 登录/Hub 进程；忙时明确拒绝。
接受每轮 cold 成本，避免 IdleWarm 长期占有认证源；不为了共享刷新器而合并成员可变 System 环境。
外部原生 CLI 不服从此锁，不能宣称所有 Cline 进程的刷新安全；实际刷新及外部并发资格单独保留。

当前 Hub 仅 macOS arm64 Preview，BYOK 与已登录 ChatGPT 账号路径分别验收；首次产品登录、实际刷新、
overflow recovery/retry、压缩取消、多 Session 压力及其他平台仍须独立验收。普通阈值压缩不能替代 overflow 资格。
Host 采用 member scope 且固定 B，不在活跃原生 Session 之间修改共享 Rule。配置差异可能增加
Host 重建，接受此成本以保证身份隔离。不保留不存在的旧会话兼容；历史实验及证据只作追溯。未选择另装 SDK、客户端压缩贡献、包装 ACP 或接管用户 Hub；它们无法满足本轮
原生安装、配置权威和恢复证据边界。


<a id="v1-72-d29"></a>
## V1.72-D29：Cline 认证交还原生，恢复普通 warm 与并行

- 状态：accepted
- 日期：2026-10-08
- 确认：User 消息 `21603f57-49eb-4683-b1e2-903e5ae7da11`（Thread 89）
- 当前权威：[Runtime Launch v53](https://github.com/murray17/rovai-ai/blob/ada6f6c16630872f21610a66cd842cd684545465/docs/contracts/runtime-launch-and-verification-v53.md#cline-native-hub)、[Cline 实施边界](../../architecture/runtime-catalog-boundaries.md#cline-实施边界)

### 背景与选择

D28 后续的原生认证实现把未验证刷新风险变成 Provider/账号字段门槛和文件级独占，账号每轮必须 cold，
多个成员无法同时使用用户已配置的原生来源。User 明确优先日常可用性并撤销这些附加策略。
所有认证直接引用所选原生来源，Cline 自己认证和保存刷新结果；Rovai 仅控制任务、隔离成员配置并反馈原生结果。
删除专属认证模块、锁和模式标记，复用共享 Fleet，不增加替代账号服务或兼容门槛。

### 后果与替代方案

多个成员各有独立 Hub 和冻结 Rule/MCP；原生刷新并发能力与普通并行请求分别记录，不因缺资格证据禁止执行。
旧 starting 锁记录不再参与启动；通用内核身份账本照常回收自有进程。正常 token 轮换与无关 Provider 更新不重绑。
未保留单一刷新所有者，因为它继续阻断本轮要求的 warm 和多成员；未共享一个 Hub，因为那需要另证成员配置隔离。
不通过复制 refresh token 建立伪独立账号。已授权的原生日常凭据可能被 Cline 更新，Rovai 自身不写回或删除。
登录成功仅说明原生命令完成；保持 Preview，首次授权、真实刷新和外部并发刷新未验证范围不被写成通过。


<a id="v1-72-d30"></a>
## V1.72-D30：Cline 唯一官方 ACP，完整退役 Native Hub

- 状态：accepted
- 日期：2026-10-08
- 确认：User 消息 `eeac1efb-50bd-4361-853f-dc77d0341d32`（Thread 95）
- 当前权威：[Runtime Launch v54](../../contracts/runtime-launch-and-verification-v54.md#cline-official-acp)、[Cline 实施边界](../../architecture/runtime-catalog-boundaries.md#cline-实施边界)、[ACP 输入说明](model-context-change-cline-acp.md)

### 背景与选择

Hub 增加 daemon、WebSocket 认证与完整历史搬运职责。User 明确要求回归官方 ACP，即使 ACP 仍有 compact 缺口。
只保留所选安装 cline --acp，复用共享 Host/Fleet、能力检查、恢复重放隔离、审批与结算。
D28 的后端选择被本决定取代；D29 的原生认证来源、普通 warm/并行原则继续适用于 ACP。
不整段回退，不恢复固定版本准入、账号白名单、旧 Bootstrap user 注入或认证锁。

### 后果与替代方案

旧 Binding 不兼容时正常重建原生 Session，generation 推进且明确连续性变化，不迁移隐含上下文或重发旧输入。
历史数据与通用进程账本保留，执行/探测/登录/恢复不再具备 Hub 分支。Pi 结算归回 Pi，不随 Hub 删除。
没有保留 Hub 备用、恢复 shim 或实现自有压缩；已知 ACP 原生方法、Rule 和 compact 差异逐项报告。
握手、已有登录、真实请求、warm/cold 与刷新分别验收，不用旧 Hub 成绩替代本轮结果。

<a id="v1-72-d31"></a>
## V1.72-D31：Cline 暂缓公开，保留官方 ACP 与历史数据

- 状态：accepted
- 日期：2026-10-09
- 确认：User 消息 `a795b147-1f20-45bd-b5b2-e8dce25d3268`（Thread 99）
- 当前权威：[Cline 实施边界](../../architecture/runtime-catalog-boundaries.md#cline-实施边界)、[Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md)

### 背景与选择

3.0.70 的官方 ACP 已通过账号/BYOK first、warm、cold，但其配置仍未接入原生自动 compaction。
User 要求暂不对外暴露；撤回 D23 的 macOS arm64 Preview，所有平台为 NotQualified，隐藏产品入口与安装引导。
D30 的唯一官方 ACP 后端保持，已有实现和正负证据保留，后续资格必须重新验证。

### 后果与替代方案

共享 Admission 阻止普通发现、检查和新执行；Renderer 不提供新选择。已保存配置按现有未准入合同只读，
无关身份编辑仍可保存，历史对话、Session 记录与凭据均不删除。不保留可启动 Hub，不用 Rovai 摘要代替原生压缩。
本轮优先调查 Command Code 模型目录与 BYOK 切换，不把两个 Runtime 的成功范围相互代用。


<a id="v1-72-d33"></a>
## V1.72-D33：Send 单一文件入口兼容请求，教学只教正文

- 状态：accepted
- 日期：2026-10-10
- 确认：User 消息 19，`a206aab3-b280-4a0f-9096-3f9f187426b6`
- 当前权威：[Built-in 运输不变量](../../architecture/foundational-invariants.md#skills-builtin-transport)、[Transport v37](../../contracts/builtin-tool-transport-v37.md)

### 背景与选择

Agent 为复杂正文另包 JSON 增加了转义工作和教学开销，旧 Session 又持有冻结的 JSON 文件说明。
沿用唯一 `--input-file`：CLI 复用完整封闭 Send Schema 识别旧请求，否则将合法文本作为正文。
新教学只演示正文文件，既有 Session 保留原 Bootstrap；兼容细节由实现负责，仅在发生具体冲突时诊断。

### 后果与替代方案

接受裸 JSON 同时可作示例和请求的歧义，由严格请求匹配优先；不承诺无效旧请求保持旧报错行为。
拒绝另加 `--body-file` 或格式开关，以免引入第二套调用入口和选择教学；拒绝重写旧 Bootstrap，
避免把轻量输入改进变成 Session 迁移。输入文件不新增目录约束或发送后自动删除，现有生命周期继续拥有临时文件。

<a id="v1-72-d32"></a>
## V1.72-D32：Kimi Provider 配置回归官方来源

- 状态：accepted
- 日期：2026-10-10
- 确认：User 消息 `e6a1d1c6-ff21-46f4-8a70-75b386cd1e6b`
- 当前权威：[Kimi 当前边界](../../architecture/runtime-catalog-boundaries.md#kimi-code-当前边界)、[Runtime Launch v56](../../contracts/runtime-launch-and-verification-v56.md)

### 背景与选择

Rovai 专属 env 会把 Kimi 的默认模型切换为内存中的临时 Provider，官方配置变更因此可能未被采用。
User 要求删除自有 env 与变量注入，正式运行、检查和目录探测统一交由原生 Kimi 读取官方配置。

### 后果与替代方案

退役专属文件解析、校验和 Host 摘要，不自动改写官方配置、迁移凭据、删除旧文件或重写显式模型选择。
只在旧 env 中配置的 Provider 必须由用户在 Kimi 原生配置中提供；历史 Run/Session 保留。
拒绝把旧 env 保留为隐式 fallback，因为这会继续形成两个配置来源；也不把旧字段自动合并进官方 TOML，
避免覆盖用户已经配置的 Provider。MCP、权限与原生 Session 延续继续使用已有合同。

<a id="v1-72-d34"></a>
## V1.72-D34：Windows Web 凭据采用目录信任与可用性优先

- 状态：accepted
- 日期：2026-10-11
- 确认：User 消息 `83d8555f-36b5-4d12-875d-304bc654c792` 与 `6d0d31b5-12f3-46bf-ab60-149d18a18d64`
- 当前权威：[Host Web v4](../../contracts/host-web-v4.md#windows-web-凭据可用性)、[Windows Private Storage v2](../../contracts/windows-private-storage-v2.md#windows-web-credential-exception)、[统一 Rust Host](../../architecture/unified-rust-host.md#身份与控制面)

### 背景与选择

备份恢复可保留有效凭据内容，却把单文件 protected DACL 变成正常目录继承。精确权限模板检查
因此拒绝操作系统允许读取的凭据，连查看 Token 也失败。User 明确选择在已准入数据目录内接受
正常继承，以操作系统读写能力为基础；额外文件权限加固尽力完成，不是使用远程连接的前置条件。

### 后果与替代方案

不再承诺每个 Windows Web 凭据文件独立受保护或精确匹配 ACL 模板；承诺普通文件/路径检查、
内容验证与原子持久化。通用私有存储、数据目录准入和其他平台保持原合同。
拒绝先自动修 ACL 再允许连接，因其仍要求用户拥有额外改权能力；拒绝全局放宽私有文件规则，
因为本次可用性决策仅属于 Web 凭据。读取失败不生成替代 Token，实际保存失败不能报告成功。

<a id="v1-72-d35"></a>
## V1.72-D35：队员环境回归 CLI 启动配置

- 状态：accepted
- 日期：2026-10-12
- 当前权威：[Runtime Launch v59](../../contracts/runtime-launch-and-verification-v59.md)、[本机启动设置](../../architecture/runtime-catalog-boundaries.md#本机启动设置)

### 背景与选择

会话环境快照要求升级前已有原生 Session 找回历史环境，缺失时拒绝执行；领取事务中的单会话错误
又使无关 Camp 一起等待。User 明确选择方案 A，以已有聊天可继续、错误隔离和简单配置行为为优先。
队员配置负责保存，真正创建 CLI 时读取；存活进程自然保持原环境。复用健康进程不读取最新配置。

### 后果与替代方案

原生 Session 的历史续接与环境配置分离，冷恢复使用当前配置，不承诺历史环境可复现。
拒绝补齐/恢复历史快照，因为其读取与解密仍会成为旧会话门槛；拒绝保存后驱逐 Warm 或强制重置，
因为保存不应中断正常工作。旧表由普通迁移退役，保留当前配置密钥与所有聊天数据，不另建迁移或生效追踪系统。

<a id="v1-72-d36"></a>
## V1.72-D36：业务完成独立于过程文本和用量收尾

- 状态：accepted
- 日期：2026-10-12
- 确认：User 在本次会话限定第 1–4 项并要求完成后提交 PR；第 3、4 项使用现有停止与继续
- 当前权威：[统一 Rust Host](../../architecture/unified-rust-host.md#组件和唯一权威)、[Runtime Monitoring](../../architecture/runtime-monitoring.md)、[Usage v9](../../contracts/runtime-usage-monitoring-v9.md)

### 背景与选择

协作命令已经提交，却因正文定稿失败返回错误；用量刷盘和原生尾读也曾成为 Run 结算的等待项。
选择业务可用性：文本交给既有维护任务，用量由周期采集补充，接受统计缺失与每轮切分不完全。

### 后果与替代方案

不再保证命令成功时过程文本已定稿，或 Run 结束时用量已齐全。迟到统计依赖短期去重基线，迁移保留
该状态直到现有过期清理。拒绝继续以统计完整性阻塞执行，也不增加强制放行、自动重放或对账体系。
完成回包缺失的具体原因仍需诊断；本改动只移除已确认的辅助收尾耦合，并验收手动停止与继续。

正常退出在 writer fence 之后提供不超过剩余 hard deadline 的 `1s` 最终正文落盘机会；渠道只在正文
定稿后封存终态快照。接受异步保存不等于允许正常退出直接丢弃缓冲或永久封存流式占位；两者不回到普通命令路径。

<a id="v1-72-d37"></a>
## V1.72-D37：会话身份决定恢复目标，原生结果决定能否恢复

- 状态：accepted
- 日期：2026-10-12
- 当前权威：[Runtime Launch v60](../../contracts/runtime-launch-and-verification-v60.md)、[Session continuity](../../architecture/foundational-invariants.md#session-continuity-与-bootstrap)

### 背景与选择

历史配置摘要把进程替换与对话重开耦合，升级或连接配置变化会在调用 CLI 前丢掉原本可用的恢复机会。
User 选择可用性优先：同类 CLI 尝试当前绑定的原 ID，原生恢复结论才决定是否一次降级。上下文文案更新
不要求历史完全一致；新输入使用当前正常装配，旧输入证据与原生历史保留。

### 后果与替代方案

接受旧原生历史含旧说明，也接受缺乏可靠机器证据的错误需要正常报错；不承诺每个 CLI 都能自动判断历史丢失。
拒绝扩大摘要兼容白名单、恢复文本猜测、凭据确认及上下文迁移门槛。保留当前权限、并发和输入防重，
新建失败不提前删除旧目标；这使故障处理与上下文恢复分离，而不增加恢复账本。


<a id="v1-72-d38"></a>

## V1.72-D38：内部输入和结果只保留实际功能依赖

- 状态：accepted
- 日期：2026-10-12
- 当前权威：[输入快照与数据库准入](../../contracts/input-snapshot-storage-v1.md)、[Built-in Transport v38](../../contracts/builtin-tool-transport-v38.md)、[Domain Command Result v2](../../contracts/domain-command-result-v2.md)

### 背景与选择

User 确认 1—5 一起实施。SQL 全文比对、上下文中间副本与摘要、工具结果 receipt、目录指纹和命令请求
摘要使内部模块重复证明自己生成的材料。保留实际输入、必要来源、旧历史及客户端实际查询的结果，删除
这些额外关联；目录进程内缓存，协议兼容继续使用已有版本。Usage 的派生失败不进入业务提交路径。

### 后果与替代方案

接受同一归属内相同 commandId 的首次结果优先，内容改变需新 ID；不再通过目录 hash 自动发现忘记升级
协议版本的接口变化。旧中间证据仍可读，新记录对应字段为空；实际输入文字、权限、停止、继续和原生会话
规则保持。拒绝双 digest、风险分类、回执账本、重试框架和额外后台对账体系。


<a id="v1-72-d39"></a>
## V1.72-D39：零成员会话保留历史，以显式邀请恢复工作

- 状态：accepted
- 日期：2026-10-13
- 当前权威：[Camp Membership v3](../../contracts/camp-membership-v3.md)、[成员生命周期](../../architecture/foundational-invariants.md#member-lifecycle)和[会话队员 UI](../../ui/components/conversation-workspace.md#camp-队员管理)

### 背景与选择

最后成员保护让正确输入姓名的永久删除按钮仍不可用，也把会话历史是否存在与当前队伍绑定。
User 已确认同组件交互稿，并在移除多余的失效接收者提示后授权独立 worktree 实施。
会话允许零成员，Default Lead 使用既有 null；历史与本地草稿保留，邀请首位 present 队员后恢复接收能力。

### 后果与替代方案

删除共用已有事务、Task 释放及 lifetime fence，永久移除仍阻止未结束执行。
不自动派给会话外默认队员，因为它会改变寻址和可见范围；不保留不可删除的系统队员，因为它会引入另一套身份与执行规则。
相较删掉空会话，保留原会话可继续阅读和恢复讨论；代价是 Renderer 必须明确区分空队伍、全体暂离与失效接收者。

<a id="v1-72-d40"></a>

## V1.72-D40：路由投影与完整身份分层，既有原生会话继续恢复

- 状态：accepted
- 日期：2026-10-13
- 当前权威：[Collaboration State v4](../../contracts/collaboration-state-v4.md)、[Built-in Transport v39](../../contracts/builtin-tool-transport-v39.md)、[ContextManifest v34](../../contracts/context-manifest-evidence-v34.md)、[Profile 11/12](../../contracts/context-delivery-profile-v11.md)

### 背景与选择

专业职责扩为 10,000 字符后，自动向每位成员重复投递全部职责会增加无关上下文。User 确认 R4：
团队角色承担简短分工，协作名单与 member list 只提供路由，完整身份按需 get，本人身份继续全文投递。
提高完整上下文与确实阻碍长职责的局部容量；显式 Runtime 配置和原生实际限制仍各自有效。

### 后果与替代方案

工具与动态投影使用新版本，兼容分支保留旧 claimed/冻结输入；这不参与 Native Binding 的恢复判断。
接受旧 Session 历史中仍有旧名单，后续新 Run 按现有摘要和 accepted ACK 自然刷新，不要求用户重开。
拒绝自动摘要、增加身份字段、收紧队友字段权限、默认全员 get，以及通过截断或重写历史规避容量。


<a id="v1-72-d41"></a>
## V1.72-D41：冻结前用同一份完整上下文选批

- 状态：accepted
- 日期：2026-10-14
- 当前权威：[Profile 13](../../contracts/context-delivery-profile-v13.md)、[Manifest 36](../../contracts/context-manifest-evidence-v36.md)、[公开 Delivery 架构](../../architecture/public-a2a-message-delivery.md)

已有 Bootstrap 摘要不能证明下次输入无需 Bootstrap。User 确认把本 Run 的启动内容和预算相关
区段在 claim 时固定，复用现有 FIFO 前缀选择；未选责任留在 waiting。预算按实际冻结正文加补发
包装计算，覆盖 Memory 更新和 Session 更换，实际发送仍由既有摘要、补发与 ACK 规则决定。

拒绝领取后退回队列或拆分冻结 Run，以免改变 accepted／unknown 防重和责任归属。固定预留
128 KiB 虽修改小，却会拒绝本能装下的单条输入。选择每 Run 一份必要快照，代价是把公开 Run
的身份／索引刷新截止点前移至 claim；不增加重试协调器、第二条队列或证明摘要体系。


<a id="v1-72-d42"></a>
## V1.72-D42：单文件头像与显示取景，渠道按发布意图导出静态封面

- 状态：accepted
- 日期：2026-10-14
- 确认：Mission 队员头像简化的 R8 交互稿；User 消息 27 授权实现并 PR 合入 main
- 当前权威：[Member Avatar v1](../../contracts/member-avatar-v1.md)、[队员身份 UI](../../ui/components/member-identity.md)、[成员投影](../../architecture/foundational-invariants.md#member-projection)

### 背景与选择

半身照与动态小头像派生使配置、素材生成和图片处理同时承担多余复杂度。User 最终确认上传后仍需裁切确认，
因此保留轻量取景交互，把取景存为元数据；新资产只有一份图片，内部显示裁切，发布时才导出静态 PNG。
头像弹窗以上传为主、预设默认折叠；配置及会话卡使用紧凑头像，性格/准则/成长默认收起。

### 后果与替代方案

接受直接播放文件的明确资源预算和大 GIF 拒绝，不新增压缩、选帧或智能取景系统。旧 icon/source 原样兼容，
主动换图进入新流程，避免批量重写取景。拒绝仅隐藏裁切器却继续逐帧派生，也不以界面简洁掩盖部分保存失败。
渠道以现有发布意图冻结一次静态导出，避免用户换图导致重试前后不同；不建立头像自动同步或新的数据库状态机。

<a id="v1-72-d43"></a>

## V1.72-D43：新操作去掉组合正文副本，删除按实际解除的引用登记回收

- 状态：accepted
- 日期：2026-10-14
- 当前权威：[Execution Record Storage v1](../../contracts/execution-record-storage-v1.md)

用户确认可用性优先，只减少新写入。输入、结果已有独立存储，组合预览可以按既有语义读取时生成；
不另建 command 表或迁移框架。格式固定在操作创建时，保留进行中旧操作的收尾方式和所有旧正文。
分页只组合本页预览，后台状态、身份及授权读取一起衔接；采用现有 schema admission 阻挡旧写入者。

会话删除复用现有候选队列和回收恢复机制，在业务事务中收集并登记实际删除的引用。
最终引用保护补齐无外键的 Action 结果。全历史孤立文件扫描不能证明文件已无业务用途，因此不执行；
本次也不承诺现存文件因升级缩小。活动投影统一和目录实时化各自交付，不作为本项前置。

<a id="v1-72-d44"></a>

## V1.72-D44：取消新 Run 的冻结目录，保留消息正文边界

- 状态：accepted
- 日期：2026-10-14
- 当前权威：[Camp History v14](../../contracts/camp-history-v14.md)

User 取消“每次开工复制所有会话名称与活动时间”的需求。新 Run 直接查询当前公开可见的会话，目录活动由
可见消息发送时间决定；历史正文搜索仍使用原冻结边界。共享快照和增量快照只是换一种方式保留已取消需求，
因此不采用。旧模式继续读已有目录，不在读取时迁移。

复用 history_fence_version 会扩大旧 CHECK 并重建 ContextManifest；本次选择只加一个默认旧模式的固定标记，
避免为目录行为扫描或复制历史 Context。该标记与操作存储格式独立，不建立版本管理框架。


评审补充：每次目录查询汇总全局发布事件会把存储节省转化为读取负担。User 明确允许在 Camp 上保存最后
可见公开消息的两个标量及必要初始化标志，随发布／可见性变化事务维护；它们不是每 Run 的历史目录。
采用既有后台维护分批补齐，未知状态在读取时有正确索引回退，避免阻塞启动或暂时错误排序。

<a id="v1-72-d45"></a>

## V1.72-D45：新操作自身承载活动小字段，读取旧活动表保持兼容

- 状态：accepted
- 日期：2026-10-14
- 当前权威：[Execution Record Storage v2](../../contracts/execution-record-storage-v2.md)

User 要求只精简存储，优先可用性。既有操作已拥有输入、结果和顺序，活动表重复保存派生状态与完整 diff
没有必要。新格式将必要小字段放回同一条操作，通过固定只读视图衔接旧活动表；视图不保存数据，不形成另一套缓存。
展开 patch 使用同次已授权的 Evidence 正文，沿用分类与冲突归并，避免复制修改正文来维持显示。

保留 #615 的薄索引和分组引擎，不为减少存储重写分页或 Renderer。旧操作按创建格式收尾，不支持任意旧 App 写入新库。
该项独立验收，不阻挡组合预览及目录取消；具体证据按同环境事件流的写入、空间、分页与展开测量评估。

<a id="v1-72-d46"></a>

## V1.72-D46：新操作限制预览总量，结果摘要与重复正文分开更新

- 状态：accepted
- 日期：2026-10-15
- 当前权威：[Execution Record Storage v3](../../contracts/execution-record-storage-v3.md)

User 确认可用性优先，只改前三项新写入问题。按创建格式固定行为，让旧操作正常收尾；精确对应的 Codex
原生／规范化 diff 只留一份正文，大参数预览采用总字节预算，文件授权保留选中操作的小字段事实。
不将独有或未准入的原生内容当作冗余，也不把有计算语义的 Run 汇总改为每次访问重算。

输出截满后直接丢弃最新摘要会破坏“重启后只收到状态”的结果关联，因此保留同一记录上的可空摘要标量。
仅摘要变化的进行中事件不推进展示版本、不重写正文；终态和合法结果替换继续原有归约。
接受摘要仍产生数据库页写入，不引入通用节流器或另一套回放状态机。迁移不扫描历史正文，不承诺存量自动缩小。

<a id="v1-72-d48"></a>
## V1.72-D48：Steer 复用消息、上下文与投递证据

- 状态：accepted
- 日期：2026-10-14
- 合并映射：Mission 064 原 D42；主线 D42 已用于头像方案，本次合入主线后保留为 D48。
- 当前权威：[公开投递架构](../../architecture/public-a2a-message-delivery.md#用户运行中插话)、[Manifest 37](../../contracts/context-manifest-evidence-v37.md)、[Delivery v15](../../contracts/message-delivery-v15.md)

### 背景与选择

用户要求插话尽量像普通消息，支持多队员与附件，不为模型新增 Steer 指导或快照解释。
采用普通 CampMessage、逐接收者 Delivery 和共同 Builder／Formatter；扩展已有 Manifest 与 Runtime
Input Delivery 的关联以保留每次实际输入及回执。开始执行和注入的差别封装在 Runtime 投递层。

### 后果与替代方案

没有采用独立 RunSupplement、平行消息存储或 Steer 专用上下文。多输入关联有迁移成本，但不可用
覆写启动快照替代，否则无法恢复原输入、关联晚到回执或防止重复发送。原生实验成功的 Adapter 仍须
满足目标绑定和结束竞态后才开放；未准入队员正常排队，不限制整条多目标消息。


<a id="v1-72-d47"></a>
## V1.72-D47：以实际结构收敛碰撞迁移，插话资格独立于普通执行

- 状态：accepted
- 日期：2026-10-15
- 确认：User seq40 授权完成合并与发布收口
- 当前权威：[Manifest 39](../../contracts/context-manifest-evidence-v39.md)、[Delivery v16](../../contracts/message-delivery-v16.md)

主线与分支已分别产生 Migration 199／schema 149 数据，仅重新编号代码不能判断已存在数据库。
选择识别已知表结构、约束和格式元组。先前分支 203 与后来主线操作格式 203 再次同号，
最终追加 204／schema 154，按结构补齐另一部分；历史载荷、版本与 199／203 回执原样保留。
拒绝把同号数据库全部当作主线或重建历史上下文，也不制造通用任意分支迁移框架。

旧 Runtime 可以正常执行，却可能缺当前插话回执。资格绑定实际活跃 Run 的冻结程序与协议，
Core 统一提供 UI 与发送前判断；当前成员配置不能替代已有 Host。代价是未知版本保守排队，
而非提高普通运行门槛或先发输入后用超时探测能力。已知业务结果异常独立追踪，接受与消费分开表述。

<a id="v1-72-d49"></a>
## V1.72-D49：Claude 回执归属受管执行，启动期先接收插话意图

- 状态：accepted
- 日期：2026-10-15
- 确认：User seq86、seq88；UUID 只关联回执，不作为额外执行门禁
- 当前权威：[Delivery v17](../../contracts/message-delivery-v17.md)、[公开投递架构](../../architecture/public-a2a-message-delivery.md#用户运行中插话)

同一受管 Claude 执行可以在前一段 result 后处理补充消息。要求原前台 result 前确认会把实际已接收的
输入误判为未知，且补充输入终态门禁曾阻止可靠结束的 Run 收尾。选择按受管执行接受精确回显；
不承诺原生同轮，不用 UUID 全数确认作为 Run 完成条件。缺回执单独保留，不自动重发。

启动连接暂未就绪不等于不支持插话。已明确目标且版本支持时沿用 Delivery 绑定意图，初始输入接受后
再构建／投递；失败、停止不自动创建新任务。选择有界读取冻结程序缺失版本，避免旧发现缓存误挡新版本，
读取失败仍保留普通运行。没有改用 Hook，也不引入独立核对服务、提示词、消息副本或新存储结构。

<a id="v1-72-d52"></a>
## V1.72-D52：文件下载独立于预览并交给浏览器

- 状态：accepted
- 日期：2026-10-18
- 确认：User 的文件传输方案及 seq3 实施授权；seq27 明确改为准入后直接传输，退出全过程撤销和旧预览版本约束
- 当前权威：[Host Web v7](../../contracts/host-web-v7.md)、[统一 Rust Host](../../architecture/unified-rust-host.md#草稿与用户文件)

增大原有整文件读取预算仍会让大成果无法交付，并把页面和服务器内存绑定到文件大小。
选择已认证申请加短期下载专用能力，让浏览器管理保存与取消；上传、预览和下载各自控制资源。
普通 Bearer 不进 URL，票据从原 Session 和精确来源派生；来源在申请时授权，GET 只验证票据、Session 和安全打开。

此前的活动流撤销、事件缺口重验及最终块校验，把普通下载与 Core 活动、旧预览版本和多条取消路径耦合。
按 User 的可用性优先选择取消这些运行机制：准入后直接发送当前文件，保留有界读取、背压、超时与资源释放。
代价是已签发能力可在短期内用于仍存在的文件，业务删除不追溯撤回它；Session 撤销只挡新准入，不中断已准入流。
下载不提供所见版本或原子快照，并发原地写入可能混合；预览读取和 legacy 来源自身的完整性约束不因此改变。

拒绝继续保留周期授权、事件监听与严格尾块校验，也不提供普通/严格双模式。
网络认证仍显式定义凭证路由，代理须排除敏感路径日志；不为下载引入持久资产、快照或新的文件保存规则。
原生下载不提供页面可证的“保存完成”，页面只负责申请反馈，浏览器处理后续保存和失败。

预览归属沿用已证明的编辑身份，重登只产生新 Session 的下载能力；不另造前端句柄恢复。
完成票据在缓存压力下回收，分开表达缓存与并发错误；阻塞 I/O 持有许可，中断保留安全结构化原因。
本轮不重构上传状态、界面或附件身份，原 commandId 和 Core 成功回执继续拥有恢复语义。


<a id="v1-72-d50"></a>
## V1.72-D50：MiniMax Code 复用 ACP 生命周期，系统提示只约束 Host

- 状态：accepted
- 日期：2026-10-16
- 确认：User 接入讨论 seq4 指定 ACP 优先、简单 Host/resume 与不接 Fast；seq6 授权实施并要求完成后对比
- 当前权威：[MiniMax Code ACP 边界](../../architecture/runtime-catalog-boundaries.md#minimax-code-acp-实施边界)、[Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md)

MiniMax 的 append 文件只在进程启动时读取，原生 Session 又可以跨进程精确恢复。选择沿用共享
Fleet 和既有 Bootstrap 内容摘要：实际系统提示变化时替换 Host，同时保留原 Session；不建立
另一套冻结机制，也不把内容摘要变成恢复门禁。相比每轮新建 Session，这保留原生历史；相比
永不更新 Host，这避免身份与系统规则过期。

原生 ACP Steer 返回同 Turn 的接收结果，图片仍通过授权路径交付；不虚构图片块参数。
原生不支持 additionalDirectories，不发送该非标准扩展，沿用原生权限和 Core 附件授权。
不把 highspeed 模型包装成 Fast。仅 macOS arm64 进入实验性 Preview，其他平台保持未准入；
这是此次实现的开发验收范围，不把脚本模型证据或用户实施授权解释成真实模型 First-Class 资格。

<a id="v1-72-d51"></a>

## V1.72-D51：Task 以实例能力退出默认工作流，执行保持可用

状态：accepted；确认：User 2026-10-17 消息 fd9bee73-2ea8-4798-9d3d-dbb9ca067963，R4。

Task 与消息协作重复，直接删除会破坏存量责任和恢复。因此默认关闭业务能力，保留历史，只在调用时校验；不采用忙时拒绝切换或中止既有执行。Bootstrap、Send、Skill 统一一套教学，Task 只在局部发现与动态 section 受控，避免双套配置漂移。

数字键位按真实入口顺序一次迁移，其他冲突键清空、非冲突偏好保留；迁移失败以内存新映射维持可用，再显式重试落盘。代价是四个旧自定义键位会被覆盖，这是 User 明确选择的升级行为。

当前规范：[Task v6](../../contracts/durable-task-v6.md)、[Transport v42](../../contracts/builtin-tool-transport-v42.md)、[Manifest v40/v41](../../contracts/context-manifest-evidence-v40.md)、[Shortcuts v2](../../contracts/desktop-shortcuts-v2.md)。逐项输入对照与实施状态见 [R4](model-context-change-task-capability.md)。


<a id="v1-72-d53"></a>
## V1.72-D53：长粘贴文件归属 Thread，以单向发送保护限制删除

- 状态：accepted
- 日期：2026-10-20
- 当前权威：[Public Composer](../../architecture/camp-composer-draft.md#长粘贴生成文件)、[Composer Draft v19](../../contracts/camp-composer-draft-v19.md)

### 背景与选择

长粘贴自动生成文件需要跨普通退出恢复，系统临时目录不足以拥有这份内容；同项目可以有多个草稿，
因此使用既有 Thread 输出目录与 Main 登记。首次发送不搬迁文件，也不把正文存入 Core 或再复制进草稿。

选择仅对最终发送快照中的生成附件持久写入、首版不撤销的保护标记，并在同一登记队列内协调删除。
已移除附件不受后续发送连带保护，本次无附件也不解除更早保护。用户优先要求可用性和架构简洁：
接受少量实际未发布的文件保留到 Thread 删除，以避免误删已发布文件。移除引用不以物理清理成功为条件；
草稿保存失败与清理失败分开处理，发送后先保存新草稿再释放恢复登记。

2026-10-21 按 User 的实际复现收窄 Clipboard 豁免：私有 MIME 同时承载纯正文，不能把格式存在当作
含有结构化身份。只在恢复后仍有 Member、All Members 或 Skill Atom 时优先插入结构化内容；
内部纯正文沿用同一单次长粘贴入口，保留现有复制格式及附件生命周期。

2026-10-22 补齐 Web：浏览器不能依赖 Electron Main；现有上传回执不可变，不能用更新回执或
逐次追加发送事件记录删除资格。因此在 Core 原 SQLite 中增加一张仅属于生成文件的资格表，
复用数据库锁和上传事务；不新建数据库服务，也不重做普通上传。

### 未选择方案与后果

未选择每次发送关联、失败解除保护、结果轮询或后台对账；它们可以精确回收更多文件，但需要新增状态和恢复责任。
也不建立定时扫描、引用计数或垃圾回收器。必要登记的裁剪豁免和既有 Pending 启动目录清理仍需补齐，否则
文件在磁盘上存在也不能保证草稿恢复。普通外部文件、消息删除和 Run 取消不在本次变更范围。

<a id="v1-72-d54"></a>

## V1.72-D54：中断复用事件通知，短亮与持久已读分离

- 状态：accepted
- 日期：2026-10-21
- 确认：User 的 R2 计划讨论与消息 c2984afb-b95c-4699-8114-387552b6d7c1 授权独立 worktree 实施。
- 当前权威：[Notification Episode v11](../../contracts/notification-episode-v11.md)、[Current User Attention v9](../../contracts/current-user-attention-v9.md)、[通知架构](../../architecture/notification-episodes.md#中断蓝点与实时反馈)。
- 后续：[V1.72-D55](#v1-72-d55) 收窄并替代本决定的停止来源、精确确认及短亮机制；以下保留当时理由。

强退时无法依赖前端离开回调。沿用 Core 已有恢复收口事务，将真实中断作为通知来源，保留唯一
Disposition 已读真源；不采用启动逐会话推断或本机标记未读，因为前者扩大恢复扫描，后者把用户
手动提醒与结果注意力混在一起，跨窗口确认和重启恢复都难以一致。

立即确认可见结果可能早于侧栏第一次读取，所以另用精确实时准入与本机操作意图短亮。
等待侧栏绘制才 ACK 会让折叠、裁切或隐藏状态槽阻塞已读，因此不采用该屏障。
代价是短亮只保证在当时可绘制的槽位出现；已结束的私有来源退出候选而保留未确认审计，
本轮不引入历史单聊产品。新增分类、Journal 描述和有界确认接口构成持久兼容边界。

规模实测发现，轻量 SQL 若等待启动附件维护持有的主连接锁，仍会延迟首份蓝点结果。
因此只将该批量读取放入既有独立读队列，以已准入数据库的惰性只读 WAL 连接读取。
快照事务仍包含同一 Journal 边界与 Disposition；写入、恢复和准入责任保持在原 owner。
连接失败只让读取失败，不扩大为 Core 启动失败。

<a id="v1-72-d55"></a>

## V1.72-D55：执行中断提醒以 Thread 展示确认，删除手动停止短亮

- 状态：accepted
- 日期：2026-10-21
- 确认：User 消息 613cf2d5-70c3-41c9-a5fb-7f7b9ee4c3de 收窄为 App 退出提醒；67fde392-eb82-4f7e-8284-54075161ff78 授权修改并清理多余代码。fb453917-508a-49ce-ba19-8fa4fe1481f2 补充确认保留 Run 异常退出提醒。
- 当前权威：[Notification Episode v12](../../contracts/notification-episode-v12.md)、[Current User Attention v10](../../contracts/current-user-attention-v10.md)、[执行中断提醒](../../architecture/notification-episodes.md#执行中断提醒)。
- 替代：[V1.72-D54](#v1-72-d54) 的手动停止来源、精确结果确认及独立短亮；通知事实与唯一 Disposition 继续保留。

原实现把“退出打断过这个会话”扩展为逐 Run 的停止注意力。无输出的停止可能没有可见来源供确认，
精确短亮又要求本机意图、准入描述、计时和槽位判断。普通快照推进还会通过 callback 身份触发重复读取。
这些成本与本次所需的退出提醒不相称，继续补终态标记只能修局部症状。

选择保留现有退出/启动恢复事务与通知持久性，包括 App 运行期间已确认的执行丢失，
把已读依据收窄为正式 Thread 内容成功展示。
读取仍按通知事件和已有恢复机制，普通执行进度不参与。删除手动停止 producer 与整套短亮链路，
旧手动停止事实保留审计但不参与侧栏候选，不伪造已读。协议删除准入描述，数据库升级只换 producer。

拒绝给空输出逐个补占位或增加展示状态机，也不改用本机标记未读、独立退出清单或每次启动全会话计算。
代价是打开会话即可确认执行中断提醒，不证明用户看过每个被中断 Run；这一语义符合本次会话级目标。
其他精确通知、回复水位、手动提醒与运行显示保持各自责任。

<a id="v1-72-d56"></a>

## V1.72-D56：环境编辑直接显示完整值，标量转换集中在 Renderer

- 状态：accepted
- 日期：2026-10-21
- 确认：User 消息 85cf3936-84af-4e82-886f-28aa1c277c83 要求删除全部隐藏逻辑；6aa5baf6-aeb5-4e9f-8a3e-0a98edc7cb6e 确认标量输入及取消非必要校验。
- 当前权威：[Runtime Launch v69](../../contracts/runtime-launch-and-verification-v69.md)、[队员环境变量](../../ui/components/member-identity.md#队员环境变量)。

凭据占位混入可编辑 JSON，会让用户修改其他字段时遭遇保留标记校验，且额外查看请求带来版本与迟到回包交互。
选择完整值直接编辑，移除遮蔽状态及标记，Owner 权限、加密持久化和公开输出脱敏继续各自负责。
不再用眼睛按钮或逐项编辑器补充状态，也不增加变量行入口。

数字和布尔值是常见设置，要求用户逐个补引号没有必要。转换集中在公共 Renderer 解析函数，
预览和提交共享同一字符串映射；Core 保持字符串合同，避免 JS/Rust 的数值表现差异。
原始草稿保留到成功保存，保证输入与失败恢复不被自动格式化打断；不支持的结构值与不安全数字明确拒绝。
独立条数和名称长度上限缺少额外收益，取消后仍由 UTF-8 容量、名称语法、保留名和版本冲突保护实际边界。

<a id="v1-72-d57"></a>
## V1.72-D57：Team 作为创建预设，Custom 独立保留，指引在创建时固定

- 状态：accepted
- 日期：2026-10-18
- 确认：User 在 Team 设计 Thread sequence 29 确认 R1 和实施。
- 当前权威：[Team Templates v1](../../contracts/team-templates-v1.md)、[Bootstrap v6](../../contracts/native-session-bootstrap-v6.md)、[Team 架构](../../architecture/team-management.md)。

User 要求不创建团队也能配置一键新建，且指引只作启动材料，不因编辑重新投递。因此保留独立 Custom
默认值，Team 仅提供有版本的创建输入；拒绝旧配置自动生成团队与 Thread 实时绑定 Team。
指引在成功创建事务内固定，后续队员和合法 Bootstrap 补发读同一文本；不提供会话指引编辑器。
代价是旧会话不跟随模板修订，换用新指引需要创建新会话。

创建偏好从旧 JSON 只导入一次到 SQLite，使默认 Team 删除与回退可在一个事务完成。保留旧文件用于
恢复，避免跨文件提交失败时出现已删 Team 仍被选中的状态。模型输入仅增加非空 TEAM_GUIDANCE 段，
版本与确认见 [R1](model-context-change-team-guidance.md)。

<a id="v1-72-d58"></a>
## V1.72-D58：引用只定位公开来源，沿用正文和发布事务

- 状态：accepted
- 日期：2026-10-22
- 当前权威：[Thread Reference v1](../../contracts/thread-reference-v1.md)、[Composer 架构](../../architecture/camp-composer-draft.md)

### 背景与选择

User 要求在既有输入框选择对话，并在交互迭代中加入使命；明确拒绝上下文版本兼容工程。
Atom 按 ID 绑定，本机标签只展示；Core 首次发布捕获标题并保存在原消息段。来源弱引用，读取 live 内容，
不复制全文或自动安排摘要。引用沿既有 body 输出定位链接，成员 mentions 与 Skill 语义保持原样。

### 后果与替代方案

不新增 references 数组、上下文块、Composer V3、serializer 版本或数据库表；不改变已冻结 Context Blob。
命令回放先于目标读取，源删除不使合法消息失效。若未来需要发送时历史快照，须独立定义读取边界，不能
用当前引用 ID/标题冒充。未选择标题重绑、自动解析普通文本、跨 Host ID 或引用引发执行的方案。

<a id="v1-72-d59"></a>
## V1.72-D59：Command Code 回归原生 HOME 与 Binding 身份

- 状态：accepted
- 日期：2026-10-24
- 当前权威：[Runtime Launch and Verification v72](../../contracts/runtime-launch-and-verification-v72.md)、[Command Code ACP 边界](../../architecture/runtime-catalog-boundaries.md#command-code-acp-实施边界)

### 背景与选择

官方 1.88 已提供 ACP BYOK 目录/选模与正式 Mod 参数。用户明确要求删除私有 HOME、配置副本及摘要
兼容性机制，避免原生状态有多个所有者、外部配置变化被解释为新会话。保留现有共享 Fleet，以实际所属
身份及进程健康/租约选择 Host，以精确原生 Session ID 延续会话；显式修改通过既有失效事件应用。
后续审查确认 dispatch 在 Fleet 之前验证磁盘入口仍会阻断 warm；将既有启动验证/刷新收回 cold spawn，
继续保留显式禁用/删除安装准入。MCP 成功保存不能等同于配置变化，Store 直接传递实际改动涉及成员，
Fleet 按成员限定失效，不引入配置差异扫描或新依赖管理器。
后续可用性修复删除新旧 Bootstrap 相等门槛与 JSON 封装额外上限；每 Run 发送前用既有 Context 的
冻结 B 更新现有 binding，使成员指令在后继 Run 生效，不新增跨 Host 冻结状态。
成员环境保存只传播实际修改事实，命令重放不重复退役。
health probe 删除覆盖所有错误的 Command 特例，沿其他 ACP 已有分类与脱敏处理。

### 后果与替代方案

不迁移或清空旧摘要和 Session，不改变冻结 Bootstrap。原生配置加载时机由 CLI 拥有；外部编辑不会由
Rovai 自动扫描后重启。拒绝保留旧 HOME fallback、把摘要换名为 profile/generation、每轮比较配置快照或
新增 Command 专属池/缓存。MCP 同名优先交给原生行为，仅保留有实测依据的 cwd/字面量适配。
冷恢复删除目录预检，直接向原生提交精确 ID；接受 1.88 可能静默打开空会话的代价，不额外承诺恢复证明。
此决定替代 D27 中 Command 私有原生 MCP 文件路径，不改变 Cline，也不代表公开资格通过。

<a id="v1-72-d60"></a>
## V1.72-D60：Command Code 在 macOS 与 Windows 开放 Preview

- 状态：accepted
- 日期：2026-10-25
- 确认：User 消息 17fcec4d-6c8b-4004-8450-f70af4e7b588（seq61）要求“mac两个端都开放”。
- 补充确认：同日 Windows 会话要求“缺口你快速验证一下，验证完就开放”，并要求将 Windows 与上述 macOS 提交一同合入。
- 当前权威：[Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md#8-command-code-macos-preview)、[Command Code ACP 边界](../../architecture/runtime-catalog-boundaries.md#command-code-acp-实施边界)。

原生 HOME、官方 Mod/ACP、共享 Fleet 简化已合入；1.88 的 BYOK 与 MCP 原生实测具备使用依据，
但现有记录不覆盖完整 Core/App、Intel 与子代理资格。选择已有 Preview 状态在 macOS arm64/x64
允许正常发现、配置、检查和执行，保留缺失资格原因与空 evidenceRevision，不把开放请求当作完整验收证明。
同日 Windows 真实 Core/MCP、配置更新与撤销、原生压缩、权限拒绝及强杀回收补验后，Windows x64 也采用
Preview。保留原生 Windows MCP 路径／参数及拒绝后缺少最终回复的已知边界；不据此宣称完整资格。
最低版本仍为 1.88.0 稳定版；Linux 继续 NotQualified，Cline 与 Cursor 继续暂缓公开。

公开入口共用现有产品目录和 Core 平台准入，不增加 Renderer 平台白名单、专属检查、实验标签或启动分支。
拒绝继续全平台隐藏 Command，也不凭单平台原生试验直接标为 qualified。此次只改变准入范围，不调整
Bootstrap、Host/Session 生命周期或用户原生配置；后续完整资格仍须以实际平台证据确认。


<a id="v1-72-d61"></a>
## V1.72-D61：Command Code Linux 随目标机验收开放 Preview

- 状态：accepted
- 日期：2026-10-25
- 确认：维护者要求“剩下的赶紧跑完”，随后要求 Linux 完成后更新到 macOS 开放分支。
- 当前权威：[Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md#9-command-code-linux-preview)、[Command Code ACP 边界](../../architecture/runtime-catalog-boundaries.md#command-code-acp-实施边界)。

GNU x64 目标机已用官方 1.88.0、真实 Sub2API 与隔离 Core/浏览器执行验收。选择沿既有 Preview
开放 Linux，保持稳定版 ≥1.88.0、原生配置所有权和共享 Fleet；不继续全平台隐藏，也不把单台机器
证据扩张为所有发行版或子代理的完整资格。Windows 的公开范围独立决定。

官方 ACP 将 shell `exit 7` 的 Tool 状态报告为 completed，输出仍包含实际 Exit code: 7；Core 如实
采用该状态。维护者明确接受这项差异，本轮不再以它阻断开放；不从输出文本另造退出码解析或状态管理。
其余未通过或未覆盖项按实际证据记录，不由这一接受决定自动豁免。

<a id="v1-72-d62"></a>

## V1.72-D62：Hermes 使用官方 ACP 与专用 Gateway，逐 Run 冷恢复并保持最低版本策略

- 状态：accepted
- 日期：2026-10-23
- 授权：User 在 Hermes Thread 的 2026-10-22 sequence 3 要求开启 worktree 接入；sequence 4 允许真实 LLM 与原生 BYOK/Sub2API；sequence 10 要求最低版本策略；2026-10-23 sequence 18 在官方入口验证后要求开始切换。不宣称跨平台资格确认。
- 当前权威：[Hermes Managed Runtime v1](../../contracts/hermes-managed-runtime-v1.md)、[Runtime Catalog](../../architecture/runtime-catalog-boundaries.md#hermes-受管-acp)、[平台准入](../../contracts/runtime-platform-admission-v2.md#hermes-初始准入)。

只包装官方 ACP viewer 不能保证执行者退出，暖 Gateway 也会保留旧 B 与终端环境。
官方入口 Probe 已证明专用 Gateway 每 Run 重启后能恢复原 Session、刷新 B 和 CLI 环境。因此本轮取代早期
进程内 SessionManager/AIAgent 覆盖，选择 Fleet 拥有的官方 ACP＋专用 Gateway，以公开 RPC 完成精确
Steer/取消、reasoning/MCP mutation 和原生事件补充。controller 借用发行物的传输及纯格式化帮助函数，
不修改服务端执行器、聊天循环或安装源码。

代价是每 Run 冷启动成本、binding 独立 Home 和多进程回收；官方结果只足以提供文件片段，不能延续早期
完整文件快照的能力宣称。保留 >=0.22.4，不锁 commit/dirty/上界，实际能力与协议仍探测核对。
macOS arm64 维持 Preview，其他平台与完整 Fleet/CLI/UI 矩阵未完成不晋升 Qualified；已测版本与兼容策略分开。


<a id="v1-72-d63"></a>
## V1.72-D63：Hermes 规则随用户输入交付，原生提示词由 Hermes 解析

- 状态：accepted
- 日期：2026-10-23
- 当前权威：[Hermes Managed Runtime v1](../../contracts/hermes-managed-runtime-v1.md#session-与输入)、[Bootstrap v6](../../contracts/native-session-bootstrap-v6.md#hermes-的-user-层投递例外)、[Bootstrap Redelivery](../../architecture/native-session-bootstrap-redelivery.md#hermes-完成通知与下一普通输入)。
- 确认：[Hermes 首次输入 R1](model-context-change-hermes-first-input.md)，User sequence 31。

原先 system overlay 注入要求 Rovai 复刻原生 env/config/personality 优先级，增加持续兼容责任。
选择复用 Core 的 B、在首条实际普通用户输入前置规则，让 Hermes 自行拥有原生系统提示词；代价是 user 层
规则没有 system/developer 优先级，并且需要按精确接受事实跟踪规则更新和冷恢复。

0.22.4 原生 protect_first_n 在首次压缩后退化，不能证明无限次完整保留。使用官方 committed Hook
及已有输入账本，在下一普通输入补发，不介入当前 Run 的原生模型循环。接受这段完整规则可见性空窗。
未选择继续解析并拼接原生 system overlay，也未选择补丁原生压缩器或在每轮无条件重复 B。
进程/CLI lease 生命周期仍按 D62，不由投递位置改变推导旧进程可跨 Run 复用。

<a id="v1-72-d64"></a>
## V1.72-D64：Hermes 未知执行由用户明确处理，原生与 Rovai 终态分别保留

- 状态：accepted
- 日期：2026-10-23
- 授权：User sequence 34 要求修正能力残留，并提供官方精确 unknown 恢复操作；不返回 system 注入。
- 当前权威：[Hermes 未知执行](../../contracts/hermes-managed-runtime-v1.md#用户明确处理未知执行)、[恢复架构](../../architecture/agent-run-recovery.md)、[User Automation](../../contracts/user-automation-v6.md#hermes-显式恢复)。

强杀后 Core 失败收口不能消除原生 unknown admission，普通恢复门禁又先于聊天输入，故 `/discard`
文本不能充当可靠出口。选择用户 CLI 的检查／明确确认操作，用官方精确 receipt 与 resolve_unknown
解除原会话阻塞，保留旧任务失败和副作用证据；下一任务仍由用户另行提交。

代价是当前需用户普通终端操作，尚无专用聊天按钮。未选择自动放弃未知任务、重放原输入、编辑原生数据库，
或自动换 Session 绕过。与既有“继续执行”产生独立 Run 的语义分开，不改其他 Adapter 或共享队列合同。

<a id="v1-72-d65"></a>
## V1.72-D65：Hermes 优先恢复原会话，执行门禁与恢复分开

- 状态：accepted
- 日期：2026-10-23
- 授权：User sequence 36 要求按可用性处理版本、路径、安装记录与指纹漂移，取消全局长锁。
- 当前权威：[Hermes Session 与输入](../../contracts/hermes-managed-runtime-v1.md#session-与输入)、[恢复架构](../../architecture/agent-run-recovery.md)。

采用共享同类 CLI 的当前目标选择，旧 Run 的安装信息不永久绑定可执行文件。原 binding 的 Home/profile
和 Session ID 继续保留；实际兼容性由当前选定 Runtime 验证。先恢复历史与状态，再按原生执行、审批、
排队或 unknown 阻塞新输入。读取断线只重连原受管 Gateway；不重放业务输入、不自动换 Session。

移除跨 Hermes 会话的长锁，复用调度 lane、Fleet owner 与同 Home 文件锁。不同成员/Session 不互相
等待。用户维护入口只用于 D64 的异常确认，不能成为普通续聊的前置步骤。

代价是实际缺失或不兼容的原生 Session 仍会如实失败，unknown 仍需用户明确处理；当前不新增聊天按钮。
未选择以安装指纹永久封锁旧 Session，亦未选择通过新建 Session 掩盖原生阻塞。其他 Adapter 的回退策略不变。


<a id="v1-72-d66"></a>
## V1.72-D66：Hermes 普通交互直连官方 ACP，增强观测不决定任务终态

- 状态：accepted
- 日期：2026-10-24
- 授权：User sequence 38 明确要求以可用性、原生兼容与低维护成本简化 Hermes 接入。
- 当前权威：[Hermes Managed Runtime v1](../../contracts/hermes-managed-runtime-v1.md)、[Runtime Catalog](../../architecture/runtime-catalog-boundaries.md#hermes-受管-acp)。

D62/D65 的控制器重复了官方 ACP 已有的 admission、事件回放与终态处理，并要求额外事件通道完整，
使补充观测丢失也能破坏明确成功。选择共享 ACP 直接使用官方协议；启动器只准备 Home/进程，移除消息
转发、工具过滤与重建、连续序号回放、逐 prompt receipt 成功门禁、额外文件锁及内部 reasoning 依赖。
只在官方 ACP 的实际缺口保留按需 MCP 撤销、Steer 与已有 unknown 操作。

代价是结构化 Diff、完整工具参数和可归属的 prompt 用量可能缺失；如实降级，不模拟上游没提供的保证。
失败/取消照原生处理，中断未知不重放，错误 Session/请求不串联。沿用 FirstPayload、官方完成 Hook 的
下一普通输入补发、原生能力关闭策略、逐 Run 冷启动、共享 Fleet/队列/Send/CLI lease。
未选择扩大 Gateway/Fleet、恢复或证据框架，也不为内部实验分支持续维持私有接口兼容。


<a id="v1-72-d67"></a>
## V1.72-D67：Hermes 使用原生 Home 与调用时活动 Run，不追溯命令的原始执行

- 状态：accepted
- 日期：2026-10-25
- 授权：User sequence 56 的完整方案与 sequence 60 的实施授权。
- 当前权威：[Hermes Runtime](../../contracts/hermes-managed-runtime-v1.md)、[内置工具运输](../../contracts/builtin-tool-transport-v43.md)、[进程所有权](../../contracts/managed-runtime-process-v2.md)。

私有 Home/逐 Run Gateway 与插件逐执行身份方案需要额外维护，且偏离用户原生环境。采用官方 ACP、
原生共享 Home，通过原生逻辑 Session 在 Core 现有关系和活动 lease 中一次解析 Run；不新增映射、
上下文交换、上游补丁或模型参数。CLI 与 Core 同包发布，其他 Runtime 的原有运输不动。

明确接受旧后台执行在后继 Run 首次调用时归后继 Run；固定一次操作的身份，派发未知不自动重新定位。
取消压缩补发，保留首次/真实变更的 user 层规则；多次原生压缩可能丢失完整规则。
共享 Gateway 不属于 Run，关闭 ACP 不承诺工具停止；记忆与配置也不按成员隔离。

取代 D62–D66 中私有 Home、专用 Gateway、Hook 补发和私有控制的当前实施选择，保留其历史理由。
未选择插件安装、逐 Run 包装路径、MCP 替代 CLI 或原生执行来源证明；未上线实验无迁移和回退要求。

User sequence 64/66/68/70 确认进一步删除没有消费者的 Hermes CLI 文件投影和没有有效决策用途的
Host/Binding/runtime 兼容性摘要。复用 Command Code 分支已经定义的显式 Native Binding 策略，
其他 Runtime 的调用路径保持原义；固定同包 CLI 入口由安装版 App 初始化提供，Run 不再重复安装。
不增加表、握手或后台管理。旧实验规则记录只保留历史读取，不参与新的规则基线；当前 Diff、MCP cwd
及用量能力按实际实现说明，不为旧文档承诺恢复封装。

User sequence 81/82 继续确认模型菜单与执行分离、相同原生模型/模式不重复设置，以及 Hermes Skills
固定目录发现。模型选择由原生接口判断；文件候选只索引用户/项目的四个约定目录，不还原原生加载
状态。接受外部自定义目录不再自动列入菜单、原生未启用文档可被用户显式引用的边界，保留原生
加载与现有精确文件引用。没有新缓存、配置同步或原生状态管理器。


<a id="v1-72-d68"></a>
## V1.72-D68：数据库以 SQLite 可用性为准，历史检查只在升级和恢复执行

- 状态：accepted
- 日期：2026-10-29
- 授权：User 要求完成数据库启动减重、验证、Review、合并与遵守宿主保护的安装，以可用性和旧数据保留为首要目标。
- 当前权威：[Availability-first Runtime](../../architecture/availability-first-runtime.md)、[Availability v3](../../contracts/desktop-runtime-availability-v3.md#数据库启动与有界重试)、[Windows Private Storage v2](../../contracts/windows-private-storage-v2.md#启动必需存储)。

文件状态快照把正常 SQLite 恢复、WAL 提交和 macOS 来源标记变化当作身份漂移，增加连接与误阻断。选择目录实例锁下
单次读写打开，无 CREATE；SQLite 负责日志恢复，Core 只保留路径类型、主文件稳定身份、版本与完成记录、事务升级及真实
I/O 错误。当前版本不重演历史结构链；历史编号冲突和旧 switch 仅进入对应升级/恢复。新库仍要求已确认 absence 和 no-replace。

Windows 以实际访问权限判断已有启动存储，不要求模板匹配或改 ACL 权限。新对象创建时保护，专用凭据函数不放宽。
Desktop 最多追加一次启动重启，避免叠加 SQLite 5 秒等待。接受没有启动期全历史校验的边界，深度检查保留给诊断和特定迁移。
不改变数据格式，允许同一 schema 的旧程序回滚；回滚也会恢复旧的误阻断风险。

未选择继续增加 macOS/Windows 例外、自动修权、损坏库自动 quarantine 后建空库或引入新重试框架：这些选择或继续扩大
状态空间，或会让老用户误见空会话。此决定替代历史启动票据/元数据复核与现有启动目录 ACL 模板的当前约束，保留历史理由。
