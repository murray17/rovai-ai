---
document_type: version-decisions
version: v1.72
authority: decision-rationale
lifecycle: current
last_updated: 2026-10-09
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

提示词不追加来源 ID、证据和恢复指令；会话真正恢复失败时结束当前尝试，显式确认才能以新会话继续。


<a id="v1-72-d19"></a>
## V1.72-D19：Command Code headless 使用冻结的普通 Prompt Bootstrap

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

<a id="v1-72-d20"></a>
## V1.72-D20：Cline 先在 macOS arm64 开放真实开发预览

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

<a id="v1-72-d21"></a>
## V1.72-D21：成功的模糊匹配编辑保留为补丁片段

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

<a id="v1-72-d22"></a>
## V1.72-D22：Command Code 使用官方 ACP 与必需 System Mod 开发预览

- 状态：accepted
- 日期：2026-10-05
- 当前权威：[Command Code ACP 边界](../../architecture/runtime-catalog-boundaries.md#command-code-acp-实施边界)、[Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md)

### 背景与选择

User 在消息 `677d610d-e4cf-4ffb-aba2-d4ebb021cbcd` 与 `1bd0ab39-6939-40cd-9653-b472b3b69082`
要求修复 System Bootstrap、warm 及全部可接能力。1.74.1 已有官方多 Session ACP，继续仅用 one-shot 会
丢失可接的常驻能力。选择共享 ACP Host/Fleet，macOS arm64 开放 Preview；新产品路径采用带 readiness 与
逐 Session 绑定校验的官方 System Mod，替代 D19 的候选 first_payload。完整输入变化由
[revision 5](model-context-change-command-code-acp.md)记录，Cline 的缺失插件反例独立保留。

### 后果与替代方案

原生 Mod 普通异常会被吞掉，所以必需绑定失败必须结束 Host。一个 Host 内其他 Session 随之失去驻留，但
可按精确绑定恢复；正确 Bootstrap 优先于保留失效进程。私有设置覆盖保留原生账号、模型和历史权威。
MCP 同名选择已有 native_wins_skip，避免改写原生全局/项目配置；冲突 Assignment 明确不可用。
未选择自造 ACP 代理或继续每轮 one-shot；也未将 handshake 和控制命令冒称模型 warm。
Preview 不代表完整资格：原生账号额度、自定义 BYOK 目录和压缩等未验证轴仍公开记录。


<a id="v1-72-d23"></a>
## V1.72-D23：macOS ACP 按内核身份回收独立进程组，并保留重启记录

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


<a id="v1-72-d24"></a>
## V1.72-D24：Cline 正常 System Rule 交付与 Command 原生 MCP 配置

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


<a id="v1-72-d25"></a>
## V1.72-D25：Cline 采用独立 Native Hub，删除 ACP 后端

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
以下为 User 85/87 阶段选择，已由 D26 取消认证独占与强制 cold：
实际安装只有实例内刷新合并，故账号 Host 结束即回收，同文件单个 Rovai 登录/Hub 进程；忙时明确拒绝。
接受每轮 cold 成本，避免 IdleWarm 长期占有认证源；不为了共享刷新器而合并成员可变 System 环境。
外部原生 CLI 不服从此锁，不能宣称所有 Cline 进程的刷新安全；实际刷新及外部并发资格单独保留。

当前 Hub 仅 macOS arm64 Preview，BYOK 与已登录 ChatGPT 账号路径分别验收；首次产品登录、实际刷新、
overflow recovery/retry、压缩取消、多 Session 压力及其他平台仍须独立验收。普通阈值压缩不能替代 overflow 资格。
Host 采用 member scope 且固定 B，不在活跃原生 Session 之间修改共享 Rule。配置差异可能增加
Host 重建，接受此成本以保证身份隔离。不保留不存在的旧会话兼容；历史实验及证据只作追溯。未选择另装 SDK、客户端压缩贡献、包装 ACP 或接管用户 Hub；它们无法满足本轮
原生安装、配置权威和恢复证据边界。


<a id="v1-72-d26"></a>
## V1.72-D26：Cline 认证交还原生，恢复普通 warm 与并行

- 状态：accepted
- 日期：2026-10-08
- 确认：User 消息 `21603f57-49eb-4683-b1e2-903e5ae7da11`（Thread 89）
- 当前权威：[Runtime Launch v53](https://github.com/murray17/rovai-ai/blob/ada6f6c16630872f21610a66cd842cd684545465/docs/contracts/runtime-launch-and-verification-v53.md#cline-native-hub)、[Cline 实施边界](../../architecture/runtime-catalog-boundaries.md#cline-实施边界)

### 背景与选择

D25 后续的原生认证实现把未验证刷新风险变成 Provider/账号字段门槛和文件级独占，账号每轮必须 cold，
多个成员无法同时使用用户已配置的原生来源。User 明确优先日常可用性并撤销这些附加策略。
所有认证直接引用所选原生来源，Cline 自己认证和保存刷新结果；Rovai 仅控制任务、隔离成员配置并反馈原生结果。
删除专属认证模块、锁和模式标记，复用共享 Fleet，不增加替代账号服务或兼容门槛。

### 后果与替代方案

多个成员各有独立 Hub 和冻结 Rule/MCP；原生刷新并发能力与普通并行请求分别记录，不因缺资格证据禁止执行。
旧 starting 锁记录不再参与启动；通用内核身份账本照常回收自有进程。正常 token 轮换与无关 Provider 更新不重绑。
未保留单一刷新所有者，因为它继续阻断本轮要求的 warm 和多成员；未共享一个 Hub，因为那需要另证成员配置隔离。
不通过复制 refresh token 建立伪独立账号。已授权的原生日常凭据可能被 Cline 更新，Rovai 自身不写回或删除。
登录成功仅说明原生命令完成；保持 Preview，首次授权、真实刷新和外部并发刷新未验证范围不被写成通过。


<a id="v1-72-d27"></a>
## V1.72-D27：Cline 唯一官方 ACP，完整退役 Native Hub

- 状态：accepted
- 日期：2026-10-08
- 确认：User 消息 `eeac1efb-50bd-4361-853f-dc77d0341d32`（Thread 95）
- 当前权威：[Runtime Launch v54](../../contracts/runtime-launch-and-verification-v54.md#cline-official-acp)、[Cline 实施边界](../../architecture/runtime-catalog-boundaries.md#cline-实施边界)、[ACP 输入说明](model-context-change-cline-acp.md)

### 背景与选择

Hub 增加 daemon、WebSocket 认证与完整历史搬运职责。User 明确要求回归官方 ACP，即使 ACP 仍有 compact 缺口。
只保留所选安装 cline --acp，复用共享 Host/Fleet、能力检查、恢复重放隔离、审批与结算。
D25 的后端选择被本决定取代；D26 的原生认证来源、普通 warm/并行原则继续适用于 ACP。
不整段回退，不恢复固定版本准入、账号白名单、旧 Bootstrap user 注入或认证锁。

### 后果与替代方案

旧 Binding 不兼容时正常重建原生 Session，generation 推进且明确连续性变化，不迁移隐含上下文或重发旧输入。
历史数据与通用进程账本保留，执行/探测/登录/恢复不再具备 Hub 分支。Pi 结算归回 Pi，不随 Hub 删除。
没有保留 Hub 备用、恢复 shim 或实现自有压缩；已知 ACP 原生方法、Rule 和 compact 差异逐项报告。
握手、已有登录、真实请求、warm/cold 与刷新分别验收，不用旧 Hub 成绩替代本轮结果。

<a id="v1-72-d28"></a>
## V1.72-D28：Cline 暂缓公开，保留官方 ACP 与历史数据

- 状态：accepted
- 日期：2026-10-09
- 确认：User 消息 `a795b147-1f20-45bd-b5b2-e8dce25d3268`（Thread 99）
- 当前权威：[Cline 实施边界](../../architecture/runtime-catalog-boundaries.md#cline-实施边界)、[Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md)

### 背景与选择

3.0.70 的官方 ACP 已通过账号/BYOK first、warm、cold，但其配置仍未接入原生自动 compaction。
User 要求暂不对外暴露；撤回 D20 的 macOS arm64 Preview，所有平台为 NotQualified，隐藏产品入口与安装引导。
D27 的唯一官方 ACP 后端保持，已有实现和正负证据保留，后续资格必须重新验证。

### 后果与替代方案

共享 Admission 阻止普通发现、检查和新执行；Renderer 不提供新选择。已保存配置按现有未准入合同只读，
无关身份编辑仍可保存，历史对话、Session 记录与凭据均不删除。不保留可启动 Hub，不用 Rovai 摘要代替原生压缩。
本轮优先调查 Command Code 模型目录与 BYOK 切换，不把两个 Runtime 的成功范围相互代用。
