---
document_type: contract
name: Runtime Launch and Verification
version: v52
status: accepted
source_version: v1.72
last_updated: 2026-10-07
---

# Runtime Launch and Verification v52

继承 [v51](runtime-launch-and-verification-v51.md) 的本地保存、执行准入、权限、原生协议与恢复边界。
按 User 的撤销要求，退出 Claude Code / Codex 自定义 API 配置功能；本版覆盖继承版本中所有原生连接
编辑、凭据回显和编辑、连接方式切换、模型目录生成、配置迁移及编辑器身份观察要求。

## 启动设置

`runtime.startup.get/save/inspect/check` 保留程序路径与普通子进程环境设置。
`RuntimeStartupConfiguration` 的可提交字段仅为 `programPath` 与 `environment`；保存补丁仅接受
`programPath` 和 `environment.<name>`。旧 `customApi`、`apiKey`、连接方式、URL、凭据修订、
模型映射及模型目录字段均按封闭输入拒绝，不忽略输入后返回成功。`runtime.startup.observe` 退出路由及客户端白名单。

读取与保存回执仅返回 `runtimeKind/revision/configuration/reconnectRequired`，不返回原生连接、登录观察
或静态 Key。历史普通配置中的连接选择不再生效；已存在的启动环境仍供原生进程使用，既有敏感变量隐藏与
编辑限制保留，不因为功能退出而删除或展示旧凭据。

保存继续是一次本地提交：字段校验、外部修改 CAS、原子持久化、修订与必要的失效标记。
不得触发或等待环境捕获、程序发现、账号/模型/Provider 查询、原生子进程、Host 重启或页面重载；
不得在回执后自动排队这些工作。冲突按字段保留草稿，写入失败不发布成功；收到成功回执即结束加载并显示“已保存”。
显式“检查状态”、原有程序选择预览和正式执行分别保留自己的检查入口。

## 原生配置与执行

升级、进入设置和保存普通启动字段均不修改、迁移或删除 Claude/Codex 原生文件、Key、登录凭据、
Provider、profile 或此前已经生成并被原生引用的模型目录。用户已有连接继续由原生 CLI 读取和使用。
不增加新存储、不清理用户文件、不自动切回官方登录，也不生成新的临时连接或认证覆盖。

保留执行所需的只读原生连接摘要、引用和输出脱敏，以及已冻结快照的反序列化兼容。
内部历史 `customApi` 快照名不构成编辑入口；它不携带完整 Key，不写原生文件，不启动账号或来源观察。
可读取来源的连接变化继续参与 Host/binding 兼容性，活跃进程沿现有生命周期完成；不能把旧连接 Host
当成已应用新配置。未知原生来源和协议处理继续由正常原生执行负责，不新增保存或执行前认证门槛。

队员模型与推理强度继续使用原生目录和能力元数据。移除编辑器附加的模型允许名单过滤；
不增加 Custom API 的推理强度 fallback，也不新增 `max/ultra` 选项。

## 界面与验证

两种智能体的启动设置仅保留程序路径、检查状态、环境变量及保存/放弃操作。
移除官方/API 单选、连接登录状态、URL、Key、Claude 模型映射和 Codex 自定义模型列表；
原有安装与登录指南仍由智能体目录提供。不增加替代提示、停用开关或隐藏编辑入口。

原生写回、迁移、Key 三态及目录生成测试随生产路径退役；只读来源、脱敏、旧快照、Host 隔离、
普通设置 CAS/写入失败、保存不等待检查和界面请求计数继续有可执行 owner。
具体清单与验证证据见 [v1.72 实施计划](../versions/v1.72/implementation-plan.md#2026-10-07-移除自定义-api-配置)。


<a id="cline-native-hub"></a>
## Cline Native Hub

`cline-cli` 仅支持内部协议 `cline-hub-v1`。不存在需兼容的旧会话，不保留 ACP transport、最低版本
或旧 Binding 后端推断。协议参与 Native Binding 和 Host compatibility；Hub Ready 必须通过所选 CLI
的独立、认证、无模型输入的 Session create/get/messages 探测。
Ready 不代表 First-Class、原生订阅可用或 compaction 全矩阵通过。

Hub 是官方 CLI `hub --host 127.0.0.1 --port 0 ... start` 创建的自有进程。launcher 正常退出
不等于 Host 退出；discovery 必须为当前 UID 的私有普通文件，地址/端口/协议一致，daemon 必须
匹配 Managed Process 已捕获的活内核身份。WebSocket 使用原生 token 子协议；不输出认证帧、
provider key、原生 stderr 或模型正文到诊断。只清理已核验的自有树，不调用用户共享 Hub shutdown。

root `beforeRun.snapshot.runId` 才能确认新 Input 已接纳；`run.started`、WebSocket 写入或 attach
均不能确认。每次 `run.start` 只投一次冻结 P。匹配 requestId 的 `ok:false` 为明确原生失败，保留封闭原生码、分类和固定安全说明，
不保留 raw message/details；发送、超时、断开及超限读取为传输结果未知。二者均不允许自动重发，
明确失败也不证明此前没有工具副作用。root
`beforeModel` 检查冻结 System Rule，`afterModel` 校验实际 provider/model 并投递原生稀疏数值。
最终状态只接受关联 requestId 的原生 result，成功必须已有接受和模型观测；事件文本不作为终态。

同 Host warm 使用已实例化的完整 Session ID。cold 先通过原生 get/messages 读取，再把原生返回的
完整 initialMessages 与原 Session ID 交回 session.create；不解析重写 compaction 历史，不用 attach 替代
执行内核恢复。当前原生接口不支持分页；接收单帧和完整消息限制为 64 MiB，发送请求限制为 16 MiB；读取超限返回
`cline_hub_history_limit_exceeded`；恢复请求超限在发送前返回 `cline_hub_history_restore_limit_exceeded`，
不裁剪或改写历史。大小上限是资源边界，不保证范围内所有历史在任意原生版本均可恢复。缺历史或 ID 改变时关闭恢复。

权限沿当前冻结 act/plan 与 auto_approve；只有 RuntimeManagedV2 的显式 true 可自动允许。
其余请求通过 `approval.requested` / `approval.respond` 进入共享 Action/Approval，选项为原生
布尔允许/拒绝。本轮结束、取消、连接失效或 epoch/Host 不匹配的响应被拒绝。cancel 发原生 run.abort，
共享清理独立确认整树退出。Usage 缺值仍缺值，Session 总计不冒领为 Run delta，未知 compaction
通知不合成生命周期。具体平台证据和剩余差异见 [Hub 产品矩阵](../research/cline-runtime/hub-adapter-implementation.md)。

Host 目录必须由本次准备阶段独占创建。进程尚未启动时，配置失败或任务取消均清理该目录；
成功 spawn 后，准备 guard 将清理权移交内核进程账本，不能因缺 marker 就删除可能仍在使用的配置。
不支持的平台以条件编译提供 `cline_hub_platform_not_qualified`，不编译 macOS 专属捕获方法。
认证来源按所选原生 Provider 判定，空 API key 不推断为 OAuth。显式 BYOK 沿原 session apiKey/baseUrl/model
交付；临时 Provider 文件只投影当前原生记录并保留其未知元数据，排除无关账号及已知 OAuth 凭据。
已确认的 `openai-codex` / `tokenSource:oauth` 使用持久原生 Provider 文件；不复制 token、合成 apiKey、
交换或刷新 OAuth，不在启动时覆盖源文件。账号身份由原生 accountId 区分；缺稳定标识、混合静态 key、
自定义账号端点或未知认证机制均明确失败，不回退 Provider/计费。原生 Cline 可写回同一文件的刷新状态。
普通 token/expiry/updatedAt 轮换不改变 Binding；账号、来源、Provider、模型和端点变化仍沿共享兼容性规则处理。
模型目录只来自当前 Provider 文件相邻的本地 models.json 及当前配置模型。

认证文件旁的私有锁与 owner 记录只保存源作用域和进程账本引用，不保存 token。锁按整个文件划分，
覆盖 Rovai 登录和 Hub 的完整进程生命周期。当前采用同作用域单个 Rovai 原生进程：忙时在发送前拒绝，
结束后回收账号 Host，不留 IdleWarm，下一轮使用相同 Session/Binding cold。BYOK warm 不变。
崩溃后必须按已有内核进程账本证明旧树退出才能交接；starting/所有权不明则阻断。Host/Camp/App 清理
不删除持久凭据或原生锁。此锁不能协调不遵守它的外部 Cline；不声明跨外部 CLI 的并发刷新资格。

用户可在现有 Cline 启动设置显式登录；自动检查或执行不得发起登录。使用同一绝对可执行路径，先核验
该安装 `auth --help` 的实际入口，再用参数数组调用原生 `auth --provider openai-codex`，无 shell 拼接。
私有 Core 方法为 `runtime.clineLogin.start({})`、`read({attemptId})`、`input({attemptId,input})`、
`cancel({attemptId})`，完整前缀均为 `runtime.clineLogin.`；返回 `{attemptId,status,output}`。
状态为 running/completed/failed/cancelled/expired/cleanup_unconfirmed。原生输出仅驻留有界内存
（64 KiB，600 秒），用于当前登录交互，结束清空；输入限 4096 字节单行，不进入事件、数据库、
公开审计、证据或模型。页面卸载和 Core shutdown 取消自有登录进程，未确认退出时不释放认证所有权。
completed 仅表示原生命令成功及账号元数据存在，不能冒充真实模型请求通过；随后沿现有检查入口核对原生 Session 可用性，不提交模型输入；也保留显式重新检查。

错误区分未登录、重新授权、订阅/权限不足、原生报告的服务不可达、能力不支持及传输结果未知。
只公开封闭分类与固定脱敏说明；原生将多种原因合并为重新授权时保留该事实，不臆测网络或撤销原因，
不删除凭据、不重放未知输入。精确安装及真实刷新/并发资格见[原生账号验收](../research/cline-runtime/native-account-auth-2026-10-08.md)。
