---
document_type: contract
name: Runtime Launch and Verification
version: v49
status: accepted
source_version: v1.72
last_updated: 2026-10-07
---

# Runtime Launch and Verification v49

继承 [v48](runtime-launch-and-verification-v48.md) 的原生连接配置、模型发现、真实 Host 验证、权限、Session、输入及关闭边界。
本版收紧 Codex Host 的完成与失败释放，不改变 Fleet TTL、容量、跨会话复用范围，也不启用其他 Adapter 的 warm。

## 连接设置呈现

继承的 `signed_in / signed_out / unknown` 原生事实边界不变；设置页未知状态文案缩短为“未确认”。
不能因未读取到官方凭据或辅助读取失败而显示“未登录”，不新增账号检查、后台轮询或执行准入。
设置页不显示共享配置影响、请求内容或填写说明区块，字段及保存语义不变。
命令、复制反馈与具体呈现由[原生连接 UI](../ui/components/app-shell-navigation.md#原生连接设置)拥有。

## 原生终态与释放

仅身份匹配的原生 `turn/completed`、状态 `completed` 有资格申请 `Reusable`；Fleet 仍检查健康、静默、
兼容性、retire_after_run 和租约归属。原生 `failed / cancelled / interrupted` 请求 `Stop`，包括未分类错误。
未知状态不是可信终态。中间 `error` 通知及 `willRetry=false` 不替代原生终态。

Host 资格不从模型回复、工具 401、命令退出值、公开 summary、retryable 或 Rovai 的业务结算结果推导。
原生 completed 缺少最终回复时，业务可以失败，但仍按原生 completed 申请安全复用。
成功资格的静默检查在旧 Run 仍阻止后继 claim 时进行；检查触发停止且未确认回收时，终态事务同样建立清理门禁。

运行时路由按 Host 实例、Run、epoch、Native Turn 校验。停止只能收紧资格，重复释放或旧执行事件不能
把 Stopping 改回 IdleWarm，也不能在重新检查租约失败时停止已取得同一 Host 的后继执行。

## 清理与 claim

可信失败终态的事务同时写入现有 cancel_requested_at 清理意图，保留 runtime_terminal 来源。
Delivery claim 在同一数据库并发边界检查现有 lane / 故障 execution-root 门禁，已有排队输入保持 waiting，
不创建后继 Run。既有 cleanup worker 在数据库锁、Fleet 操作锁之外等待退出，无关会话不等待该进程。

Codex 使用内部释放结果：可复用、已确认回收、无匹配租约、回收未确认。无匹配租约本身不证明退出；
只能结合已完成且未绑定路由的 launch barrier、既有停止回执或受管 owner record 的退出证据收口。
清理超时保留 Host、租约、容量和 owner record，后续扫描继续清理。既有 owner record 增补 Run/epoch 和已回收标记，
跨 Core 重启保留清理证明，直到数据库 ACK；不创建第二套恢复或原生结果状态机。

Windows Codex owner record 额外保存 Managed Process 的内部 Job 身份；重启退出证据由
[Managed Runtime Process](managed-runtime-process-v2.md#4-ownership-and-termination) 拥有。
已有确认回收的标记继续有效；没有该标记的 Windows scoped 记录保持门禁，不能仅凭 Job 活跃数归零、名称消失或根 PID 不存在补造回执。
owner record 目录及原子写入必须满足私有存储准入；初始化失败阻止 Core 启动，不能静默关闭持久 owner 记录。

已获取的 Codex 进程先由 Fleet 持有，再执行 initialize、认证及必要选模验证。任何验证失败均不发送任务正文，
停止未确认不能抹去受管记录。未取得 Host 的失败仍通过原有 launch barrier 证明没有在途创建。

## 原生会话与输入

可信终态且确认清理后，可按原绑定和现有兼容规则冷恢复精确 Native Thread；Host 回收不删除历史和绑定。
`thread/resume` 失败或返回不同 Thread ID 时，本次执行明确失败、零正文发送，不在本次执行中悄悄新建空 Thread。
已有明确不兼容的 Controlled/New 选择仍由原恢复合同决定。

accepted / delivery_unknown 且无可信终态的错误复用 [Accepted Input Recovery v6](accepted-input-recovery-v6.md)
的隔离与默认轮换规则；保留历史、输入和副作用证据，不保留旧绑定的后继资格。不新增输入自动重发、手工重试机会、
自动登录、token 刷新、凭据监听、认证代际或历史认证失败的全局准入锁。

## 诊断与范围

Codex 可信失败的 turn.error 优先使用 codexErrorInfo: unauthorized 或已支持 HTTP 变体的 httpStatusCode: 401。
已有结构化非认证错误优先于文本；仅缺少结构化信息时使用该 Runtime 错误的 message 兜底，不扫描普通输出、工具输出或 stderr。
认证拒绝摘要为“本次运行时认证被拒绝。”；只有独立缺少凭据证据才要求登录，不提前声称清理或恢复成功。

首次闭环范围是 Codex。ACP 的公开终态前释放与后台任务归属、Pi 的原生结果与业务交付判断仍需分别接入；
共享 Fleet 安全修补不等于这些 Adapter 已完成终态策略改造。测试、真实 Runtime 与平台证据分别记录。
