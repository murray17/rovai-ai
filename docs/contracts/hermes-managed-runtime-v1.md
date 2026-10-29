---
document_type: contract
name: Hermes Managed Runtime
version: v1
status: accepted
source_version: v1.72
last_updated: 2026-10-28
---

# Hermes Managed Runtime v1

`hermes-cli` 使用共享 ACP、Fleet、Run 队列、Replay Quarantine 和 Explicit Send。
原生会话定位方案已直接替换未发布的私有 Home 实验，不提供迁移、旧启动器回退或双版本协商。

## 安装与进程

最低版本为官方 Hermes **0.22.4**，不锁 commit 或版本上界；实际能力通过当前安装的原生接口验证。
`ROVAI_HERMES_BIN` 或通用启动设置选定程序，直接执行 `hermes --profile default acp`。
不解析/替换 Python 启动串，不生成 `host.py`。子进程固定 `HERMES_HOME=当前用户 ~/.hermes`，
清除子进程的 profile 选择，不再识别旧私有 Home 启动变量，不修改 Shell 配置或用户 `.env`。

链路为 **共享 ACP 客户端 → 官方 Hermes ACP → 原生共享 Gateway**。Rovai 只拥有启动的 ACP 连接。
使用 `ManagedProcessPurpose::RuntimeConnection`，退出、超时和强制清理只作用于客户端根进程，
不捕获或回收 Gateway 后代，即使 Gateway 是首次连接时由官方客户端启动的。
不执行 `gateway run --force`，不读取锁 PID 强杀，不逐 Run 重启原生 Gateway。
Fleet 在 Run 结束时关闭 ACP；原生 Gateway 的存活不等于 Rovai 保留 warm Host。
ACP initialize 沿用 90 秒预算，超时不自动重放输入。

用户 config、`.env`、Hook、插件、指令文件及 Skills 不由此适配层改写。原生记忆、画像、Skills、
personality、system prompt 和默认工具集合均由 Hermes 自己处理；不额外禁用，也不强行开启。
Hermes 正常保存会话、记忆和刷新认证不属于 Rovai 配置覆盖。多个 Session 共享 Home 及原生长期记忆，
不同 Session ID 只隔离会话，不能承诺成员之间的长期记忆隔离。

版本、入口、安装记录、指纹或普通配置变化只触发探测/进程更新，不单独拒绝精确恢复。
不同 Binding 并行；同 Binding 使用既有调度和 Fleet owner，不新增全局锁。
Hermes 使用显式 Native Binding Host 策略，不生成或比较 Host/Binding/runtime 配置兼容性摘要，
不追加实现 revision 摘要。实际启动配置、版本下限、协议、权限、工作目录与同 Binding 所有权仍保留。
Run 冻结配置的审计摘要与下述 B 内容摘要继续使用，不作为 Hermes resume 的配置相等门槛。

## Session 与输入

使用官方 `session/new` 创建并保存精确原生 ID；后继通过官方 resume/load 恢复同一 Session。
历史 replay 使用共享隔离阶段。原生目标缺失、不兼容、running、approval、queued 或 unknown
按原生事实处理，不偷偷新建会话、不重放已接受或结果未知的输入。

完整 Core Bootstrap B 与原任务 P 的 Formatter 不变：首次实际任务是 `[Rovai 协作规则]` B 块加 P；
同 Session 后继仅 P；B 内容真实变化时使用 `[Rovai 协作规则更新]` B 块加 P。同一次 prompt 提交，
不额外调用模型。首次/更新以既有接受账本和完整 B 摘要判断，不以 PID、Run 或重连次数判断。
准确正文与授权见 [已确认 R2](../versions/v1.72/model-context-change-hermes-first-input.md)。
这是 **user 层规则**，不承诺 system/developer 优先级或多次压缩后完整保留。

不注册 `post_compaction` Hook、不建立 Hermes observer、不生成或消费 Hermes 压缩补发需求。
压缩后下一输入在 B 未变化时仍只提交 P。旧 pending 停止消费，不伪造 acknowledged；旧记录、
冻结正文及 `compaction_recovery` 枚举保持可读，不产生新的 recovery 投递。其他 Runtime 不变。
当前规则基线只查询已接受的 `initial` / `update`；不接续旧 system 注入或 recovery 实验。
现有 nullable Hermes 输入证据/Managed Blob 继续记录 initial/update/none；prepared/unknown 不算 accepted。

Ready 声明 `context.charter.first_payload`、`hermes.native_session_cli`、模型/权限原生能力；
撤下 managed system、压缩保留、signal_driven/best_effort 旧能力。缓存按现有发现机制重新探测，
不因能力缓存变化轮换 Session。Ready 不是所有工具、终端后端或平台已验收的证明。

运行中补充输入通过官方 `session/prompt` 的 `/steer` 交付，普通消息仍进入既有后续队列。
按 User sequence 130–134，接受同一原生 Session 内“当前轮插入，来晚则紧接着执行”的原生行为，
不要求一项 Core Run 只对应一项原生 prompt。已知 Run 结束、取消或 owner 改变时不再发送；
检查后才发生的原生结束不丢弃已提交输入，也不自动重复投递。
Core 保留原 Run／epoch／Binding 与活动 CLI lease，直到原请求及所有已提交补充请求返回，
再统一收尾；期间的原生事件和 CLI Send 仍归这项 Run，普通 waiting 消息不会提前启动。
接收回执取匹配 RPC 的 `end_turn`，只表示原生已处理本次提交，不证明同一原生轮次消费；
`admitted_turn_failed` 证明已接收但执行失败，失败保留到 Run 终态。明确协议/参数拒绝回普通队列，
取消、连接丢失及其他不明结果保留未知，不重发。补充请求可能执行完整任务，不套用短 Steer ACK
超时；生命周期仍使用现有 Run 取消、执行预算和连接退出处理。
不解析 slash 通知或模型正文判断回执，不维护私有 Gateway 通道。
边界与验证见[Core Steer 验证](../research/hermes-runtime/README.md#core-steer-接通2026-10-28)。
取消直接发 `session/cancel`，按真实终态处理。ACP 退出不能证明已提交工具停止；无法确认时保留未知。

## 内置 CLI 的原生会话来源

模型继续普通 `rovai send ...`，没有新参数、逐 Run 路径或查询上下文的前置请求。
CLI 读取本机原生终端提供的 `HERMES_SESSION_PLATFORM=local` 和逻辑 `HERMES_SESSION_CHAT_ID`；
不使用可能随压缩旋转的物理 `HERMES_SESSION_ID`，不按 cwd、日志、时间或最新活跃成员猜测。
旧上下文文件来源仍服务其他 Runtime，不改变其协议。

CLI 通过固定安装入口运行。macOS 安装版 App 在启动初始化时建立 `~/.local/bin/rovai` 到同包 CLI
的固定链接；同路径 App 更新直接使用新二进制，已有普通文件或不同目标不覆盖，冲突记录安装诊断。
开发与隔离验收 App 不修改日常入口；隔离原生 smoke 在测试用户 Home 中预先完成 CLI 安装。
Hermes 每次 Run 不建立、更新或核对链接；没有逐 Run 安装握手、版本检查或后台修复。
这不是逐 Run wrapper；共享 Gateway 的 PATH 必须能找到该固定入口，不靠给 ACP 设置 PATH 传递。
Hermes 的 process 配置没有 `context.json` 输出：创建、绑定、Task 刷新/重试、解绑与撤权均不写该文件。
内存 ActiveLease、Run/epoch、Binding、撤权和回执继续复用共享注册表；`run-tmp` 与实例端点保留。
Core 在自己的用户数据目录 `Rovai AI/builtin-tools/connection.json` 发布一个私有端点描述；
仅含本地 IPC 地址，启动更新、正常退出按自身端点清理。不存 Session/Run 映射或凭据。
多个隔离 Core 不共享 Home；同一用户端点指向当前发布实例，不扫描/猜测其他实例。

一次业务请求携带 `source=hermes_native_session`、`nativeSessionId` 和既有 request_id/operation/input。
Core 在现有 invocation_gate 内定位唯一 Hermes Conversation，取得其非取消的 running Run 与 epoch，
再核对活动注册表中相同 Binding/generation 的唯一 ActiveLease。没有、歧义或失效明确拒绝。
不新增表、业务字段或映射文件，不向 CLI 返回上下文/凭据。捕获的身份进入现有 Router、Domain Service、
回复锚点和发送回执；之后只能成功或因撤权失败，不能中途重新定位后继 Run。

**按调用时归属**：旧后台执行直到下一 Run 才首次调用，会归入下一 Run；不证明原生执行的最初来源。
排队消息不改变当前 Run。业务请求只派发一次；派发后丢失结果报告未知，不自动重新定位/重发。
这不是新的认证体系；本机原生 Session 标识是定位输入，业务权限仍由 Core 当前活动执行判断。
原生 Hermes 调用环境仍禁止用户级 `rovai app`，插件缺失/旧 context 不参与这条链路。

## 用户明确处理未知执行

删除未发布的 `hermes-inspect` / `hermes-discard` 私有控制入口，不再启动私有 Gateway 维护。
原生 unknown 与 Core 失败各保留事实和诊断，不能把 ACP 关闭视为原生已结算。
需要维护时遵循用户安装的官方接口及明确目标；本接入不提供自动解除 unknown 或新 Session 绕过。
旧私有实验目录不再运行、不自动删除，不导入或合并其数据库。

## 模型、权限、Skills 与 MCP

模型目录只服务菜单，不承担执行准入：原生 Session 创建成功时，缺失、损坏或不完整的目录不使
Hermes 不可用，也不合成猜测的模型项。原生默认沿用会话状态；显式选择的完整模型 ID 交给
`session/set_model`，由原生确认或拒绝，失败不回退默认模型。文件编辑策略使用 `session/set_mode`。
本次 new/resume 返回相同完整模型 ID 时跳过设置；用户选择裸模型名时只比较完整模型名。
双方明确报告 Provider 时比较 Provider 与模型名；兼容 `custom:<命名Provider>:<模型>` 与
`custom:<模型>` 的已知报告差异，两个不同的命名 Provider 不视为相同。不做任意后缀、大小写或
别名模糊匹配；不同或缺失时把用户选择的完整 ID 原样交给原生设置。
相同 `currentModeId` 同样跳过模式设置。不增加状态查询、跨 Run 缓存或 warm 管理。
不以通用配置空 ACK 冒充设置成功；reasoning/Fast 沿原生配置。权限请求走共享 ACP，
文件审批模式不是命令审批或 OS sandbox；CoreEnforced read-only 仍拒绝。

Hermes 自己继续按原生配置加载 Skills。Rovai 的文件候选固定扫描执行 Host 用户 Home 下
`.hermes/skills`、`.agents/skills`；当前对话另扫描已有项目根下的同名两个目录，不向上找 Git 根。
全局设置只读用户级，没有项目则不读项目级。公共扫描、缓存、预览、文件去重和显式引用保持原义。
不解析 Hermes 配置中的外部/创建目录、禁用、平台或信任条件；任意非约定目录不自动加入菜单。
候选只证明文件已发现，不证明原生启用或加载。未启用文档也可由用户显式引用；未选中项不会
因扫描加入模型输入。Rovai 不修改 Hermes 配置，原生加载其他目录的行为不受影响。

MCP 当前分配直接随原生 new/resume 参数提供；不二次发现、不改用户配置排除同名服务。
同名策略保持未知（`sameNamePolicy: null`），撤下旧 `rovai_wins` 能力，不承诺覆盖原生配置的同名服务。
原生正常返回的部分失败保持可用、日志如实呈现；异常/断线不伪装成部分成功。
**官方恢复空列表表示保留既有分配，不证明撤销。**当前无 ACP 确认的显式清空能力，不宣称即时撤销；
用户配置来源的 MCP 继续由原生管理。Gateway 重启后的凭据恢复须由正常 resume 参数重新提供。
当前 ACP stdio MCP 参数未传递自定义 `cwd`，不宣称按该目录启动服务。

## 结果与观测

当前请求以官方 ACP 的关联响应为准：明确成功不因增强详情缺失改成失败；原生失败/取消保留终态；
断线未知不自动重放；其他 Session/请求不串联。公开 Send 与任务结算仍遵守共享产品规则。
不靠模型自然语言判成功，不追加 Gateway 事件订阅、receipt 对账或连续序号成功门禁。

原生 ACP 默认不启用 `clarify`；用户原生配置启用后的问卷不转为执行审批。当前客户端不广告
elicitation form，按官方 `clarify-*` toolCallId 识别权限卡片，再核对问题、choices、`choice-N` 与
`skip` 结构；无 choices 的开放题也属于问卷。已识别但字段缺失或冲突时仍按不支持处理，不回落授权。
归属校验后复用共享问卷取消回执与 Prompt 观察，返回 `cancelled`，不选择答案或 Skip option。
官方 ACP 将取消转换为空答复，原生工具可能报告 skipped 或 unanswered，不能宣称收到用户答案。原生正常结束时记录
`runtime_questionnaire_unsupported` 并引导 User 在 Thread 补充信息；已有 Send 和工具效果保留，
原生错误及真实取消优先。不自动重放，下一条真实输入仍恢复原 Session。
普通执行审批及其他 Runtime 保持各自规则；不修改原生配置、不安装 Hook，也不增加问卷表单。

工具通知按原生字段投影，可展示有原生依据的工具事件、输出和文件路径。当前官方 ACP 路径未接通
Hermes 的结构化 `reported_mutation` / Diff 生成；原生预览不能冒充完整状态。旧控制器的文件验收
不代表当前生产能力，历史证据仍可读取。缺少参数、Diff 或文件完整状态保持未知，不扫描磁盘补证。
原生 PromptResponse usage 不冒充本 prompt 消耗：已验版本返回驻留 Agent 的累计计数，同一 Session
也可能因 Agent 重建而从零开始；没有计数代次/请求前基线时，不直接取总数或跨 Run 相减。
失败前缺少可归属 usage 也不估算。缺少可靠的逐 Run 用量或费用时显示未知，不以累计总量补齐。
原生 `usage_update` 仅作上下文 gauge，不能替代消费统计或压缩完成事件。
当前已验官方 ACP 未发送实时压缩生命周期；恢复历史中的摘要标记只代表历史内容，不产生当前 Run
的压缩事件或补发需求。能力限制与复现见[原生观测验证](../research/hermes-runtime/README.md#原生-acp-观测验证2026-10-25)。
ACP 图片沿原生媒体流程，能力取决于配置及模型。

## 准入

2026-10-28 按维护者明确要求，macOS arm64/x64、Windows x64、Linux x64 均采用普通 `enabled` 状态，
允许发现、检查、配置与执行；不采用 Preview，也不显示实验或资格缺失提示。用户设置、引导、
选择菜单、安装指南与监控筛选均消费共享准入。Windows 连接采用上述根进程所有权，不将共享 Gateway 放入 Run 的 Job。
已有身份、输入账本和证据保留，不新增迁移或运行回退。开放不代表完成各平台完整能力矩阵；具体未覆盖路径见
[验证记录](../research/hermes-runtime/README.md)，平台状态见[准入合同](runtime-platform-admission-v2.md#hermes-初始准入)。
