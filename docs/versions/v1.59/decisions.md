---
document_type: version-decisions
version: v1.59
lifecycle: current
authority: decision-rationale
last_updated: 2026-09-11
---

# v1.59 版本决定

<a id="v1-59-d01"></a>
## V1.59-D01：唯一 Rust Host，按语义保真检查点接入 Web

- 状态：accepted
- 日期：2026-09-11
- 当前权威：[统一 Rust Host](../../architecture/unified-rust-host.md)

独立 Server 和 Desktop Web 需要同一业务、恢复与权限事实。另建 Node Server 或第二份 Core 会产生双重
调度、状态与迁移成本。选择把现有应用运行层嵌入同一个 Rust Host，并让 Axum 模块只消费既有服务句柄。
旧 Desktop 先通过共享运行层回归，再迁本机 IPC，避免 HTTP 并发暗中改变原普通串行命令语义。

代价是必须逐项交代 Main 后台职责，三平台各自验证 Runtime、环境与隔离；共享代码不提供兼容性证明。
首轮只补草稿归属、上传引用、显式会话认证与 OS 控制面保护，保留 source reference 弱持久性。
不采用跨端同步、永久上传资产、通用沙箱或新的基础常驻服务来替代这些具体边界。
