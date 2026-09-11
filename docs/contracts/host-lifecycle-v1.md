---
document_type: protocol-contract
contract: host-lifecycle-v1
authority: headless-host-startup-and-controlled-stop
status: accepted
version: 1
source_version: v1.59
last_updated: 2026-09-12
---

# Host Lifecycle v1

本合同拥有独立 Host 的初始 CLI 准入与停止适配。Core 的 authority、lease、恢复与关闭事务继续由
[Desktop Runtime Availability v2](desktop-runtime-availability-v2.md)及
[Planned Shutdown v6](planned-shutdown-v6.md)拥有。新增 Host 入口不改变 Desktop 的 Renderer 退出前保存门禁。
实现进度与平台资格见[当前版本](../versions/README.md)，不得由合同 accepted 推断可发布。

## CLI 与唯一运行层

`rovai-host run` 要求显式提供绝对路径：`--data-dir`、`--skill-library-root`、
`--runtime-camp-files-root`、`--mcp-config-path`。路径与平台存储准入复用 Core；不默认使用日常 Desktop
目录、全局 MCP 配置或另一 Host 的 Skill Library。Windows 私有目录准备与原生 ACL 验收仍须单独完成，
不能用普通目录创建或 macOS 通过作为替代。

默认只接受已有 authority；确认 authority 不存在时拒绝。只有显式 `--initialize` 才允许 Core 对已确认
不存在的 authority 初始化。该选项不覆盖未知/损坏/未来版本数据库、不抢占活动 lease，也不绕过原升级门禁。
同目录第二个进程拒绝启动并返回非零退出码；拒绝不终止第一 owner。

Host 进程只创建一个 Core runner 与其 Tokio runtime，直接调用共享应用运行层。不会启动 `rovai-core`
sidecar 或 Electron。可信进程内 service handle 与普通命令串行/独立请求通道复用，不等于网络 RPC 授权。
Core ready 只表示权威入口可用；可选子系统仍可以初始化或降级。诊断日志不构成新的业务事件协议。

## 停止与失败

在启动 Core 前注册停止监听：Unix `SIGINT` / `SIGTERM`，Windows console `Ctrl-C` / `Ctrl-Break`。
第一次受控停止进入一次现有 `core.shutdown` protocol 3；等待 durable cancel-all、Runtime 回收、报告和
runner 真实结束。十秒总期限包含启动期间收到停止信号后的剩余准入等待，不在启动完成后重置外层期限。
关闭 stdin、观察者断开或以后关闭 Web listener 不构成 Host 停止信号。

成功退出要求 protocol 3 的 completed report、`deadlineExpired = false`、
`controlledShutdownCyclePersisted = true`、`unresolvedExecutions = 0` 与 runner 完成同时成立。
准入拒绝、缺失/不兼容报告、未完成收口或超时均为非零退出；不能把超时或进程强杀伪装为业务完成。
硬停止后由进程 owner 结束所拥有的 Tokio runtime；accepted/unknown 输入与恢复继续按 Core 原合同处理。
Windows console 关闭、系统服务停止、父进程异常与三平台真实 Runtime 回收另行验收，不继承这两个 console
事件的资格。

`prepare --data-dir` 只为显式新路径创建私有目录并输出四个运行路径；不创建数据库或迁移已有数据。
`token` 为本机管理者生成随机令牌。可选 `--web-listen`、`--web-ui`、`--web-token-stdin` 接入
[共享 Web](host-web-v1.md)；LAN 参数与安全边界见该合同。Desktop 原父管道由同一个 Host 适配，
旧 `rovai-core` 兼容程序保留。受保护用户 IPC、Automation 时钟、日报、评测与渠道 Headless 驱动尚未交付；
Core 可启动不表示完整 Server 产品已完成。

## 验证 owner

`scripts/lib/host-lifecycle.test.mjs` 拥有 CLI 进程到共享 Core 的准入、活动 owner 拒绝、Unix 停止信号、
durable 关闭与再次打开 seam。只使用临时 data-dir、Skill Library、MCP config 及按既有规则绑定的隔离
Runtime 文件根；不调用模型。旧 stdio 回归继续拥有 Desktop 兼容入口；Windows console 验收单独留证。
