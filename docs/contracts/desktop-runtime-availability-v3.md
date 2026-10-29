---
document_type: protocol-contract
contract: desktop-runtime-availability-v3
authority: desktop-bootstrap-supervisor-authority-admission-and-request-transport
status: accepted
version: 3
last_updated: 2026-10-29
---

# Desktop Runtime Availability v3 Contract

本合同继承 [v2](desktop-runtime-availability-v2.md)，替代其第 1、9 节的首帧呈现规则，以及下述数据库准入、迁移、启动重试与 Windows 目录权限规则。Supervisor schema、generation/capability、错误传输及可选子系统门禁保持。

## 首帧启动反馈

Renderer 首个已提交帧必须显示既有不透明整窗品牌加载画布，不等待计时器、首份 Supervisor snapshot 或本机
Main Window Session IPC。非权威导航框架可在画布后挂载，但 rail、顶行与内容区不能先暴露给 User；画布自身不发起权威请求。

Core ready、Onboarding admission 与目标读取的交接期间持续显示加载。只有既有准入通过且真实目标可用后才
退出画布；沿用普通动效下的 180ms 淡出与 reduced-motion 行为，不新增最短展示时间。既有 horizon 标记、
纯色背景、1600ms 轻呼吸、辅助技术 polite busy status 及不显示技术阶段文案的规则继承 v2。

明确 blocked/crashed 或本地读取错误时，立即切换到独立恢复面，不等待 400ms，也不让加载画布的退出动效遮挡
恢复操作。恢复面沿用“暂时无法打开会话”、“重新打开”和“导出诊断”；原始技术错误仍只保存在诊断中。

首帧呈现规则只删除冷启动反馈延迟。普通 Thread 切换、关闭反馈各自的 400ms 时序不变；首帧画布不扩大权威读取、
Onboarding 或 Runtime 的准入，也不把非权威框架视为已进入、已读或可持久化的恢复目标。

## 当前呈现与验证

- [App Shell 冷启动反馈](../ui/components/app-shell-navigation.md#冷启动反馈)
- [Bootstrap Shell](../ui/components/bootstrap-shell.md)
- `pnpm test:startup-presentation`：首个提交、authority/Onboarding 交接、目标就绪、立即错误恢复、双主题、200% 与 reduced motion。

## 数据库启动与有界重试

本节替代 v2 第 3、4 节的只读预审/票据/快照复核/来源标记特判/重新准入，以及第 8 节的现有启动目录 ACL 模板要求。
正常顺序是目录实例锁 → 确定路径 → 单次读写打开 SQLite → 版本与完成记录 → 必要时逐版本事务 → 会话数据。
已存在库不带 CREATE；打开失败不另建空库。WAL/hot journal 恢复由 SQLite 执行，metadata/xattr/mtime/ctime/length
变化不触发拒绝或重新准入。当前版本仅检查 marker、最终 receipt、无未来 receipt 与核心表，历史完整结构检查留在升级。

保留路径类型/无链接跳转、目录锁与主文件稳定身份、两个主库/孤立日志的恢复边界、未知/未来/未完成状态拒绝、
事务原子性与现有库失败后原地保留。首次初始化用 staging + no-replace 发布，既有旧 manifest 才进入历史切换恢复。
不改变 schema、业务行格式或原 Session。细则由 [Availability-first Runtime](../architecture/availability-first-runtime.md#database-authority-state-machine)拥有。

SQLite busy timeout 统一 5000ms，Core 无额外数据库重试循环。Desktop 对明确可重试的启动失败最多自动重启一次，
间隔 250ms，先等待旧 child 退出；预算用尽展示已有恢复入口。显式重试与 ready 重置预算。
其他宿主使用相同 Core 结果，不自行叠加数据库恢复重试。`--require-existing-authority` 跨重启保护保持。

Windows 数据库、实例锁、正式/Bootstrap 目录、Runtime files 根与协调文件、Server 布局/日志以实际文件访问结果为准，
接受继承 ACL、额外 ACE 与无 WRITE_DAC 的可用对象，不自动改写现有 ACL。新目录/锁/布局文件保持 creation-time 保护，普通日志/Fleet 文件继承目录权限；实际读写失败
仍报错。凭据等专用 private API 不改变；具体调用范围见 [Windows Private Storage v2](windows-private-storage-v2.md#启动必需存储)。

锁等待和迁移均在 Core child，Electron/Renderer 保持响应，画布辅助状态持续为“正在打开会话”；真实错误立即进入
“暂时无法打开会话 / 重新打开 / 导出诊断”，不把技术阶段展示成业务空态。
