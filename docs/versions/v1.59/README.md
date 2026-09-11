---
document_type: version-overview
version: v1.59
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-09-12
---

# Rovai-ai v1.59：统一 Rust Host 与三平台 Server

前置：[v1.58](../v1.58/README.md)。前版未完成的评测验收保持原有事实，本版不把它们宣布为完成。
用户确认统一 Rust Host 与共享 Axum Web 方向，并授权在独立 worktree 实施、验证后推送远程任务分支。

## 范围与状态

最终由同一个 Rust Host 服务普通 Desktop、Desktop 开启的 Web 服务和独立 Server；后者不启动 Electron。
Server 覆盖 macOS arm64/x64、Windows x64、Linux x64。交付依次为 Server 与宽屏 Web、Desktop 共用 Web、
宽屏功能和多客户端回归、三平台正式验收与发布、Mobile UI。阶段 1 内先抽取 Core、回归旧入口，再验收真实
Headless 执行，最后接入认证、上传和 WebUI。详见[实施计划](implementation-plan.md)。

当前已抽取共享运行层，并开始初始 Headless CLI 的准入与停止适配。未宣称完整 Host、WebUI、
全部 Runtime 隔离或任何新增平台资格已完成。
架构由[统一 Host](../../architecture/unified-rust-host.md)拥有，取舍见[版本决定](decisions.md)。

所有新增设计只解决数据隔离、命令幂等、凭据保护和宿主运行问题。用户附件保持 source reference 弱持久性；
不做草稿同步、永久附件系统、通用沙箱、Relay、原生移动 App 或三平台系统服务安装器。
Windows/Linux 前置隔离原型失败时，先提交事实、最小修正、替代与影响，由用户确认相关修正后实施；
无依赖的工作继续。缺少实际环境不等于原型通过或失败。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 前版生命周期冻结；本概览、实施计划与[版本索引](../README.md)建立唯一 current v1.59 |
| Decisions | 已更新 | [V1.59-D01](decisions.md#v1-59-d01)解释唯一 Host 与分阶段迁移 |
| Contracts | 已更新 | [Host Lifecycle v1](../../contracts/host-lifecycle-v1.md)拥有初始 CLI 适配；原 Core wire、领域命令和存储语义保持；网络与草稿合同随相应实现同步 |
| Architecture | 已更新 | [统一 Rust Host](../../architecture/unified-rust-host.md)及架构导航记录已确认目标与当前实现的区分 |
| UI | 确认无需更新 | 当前抽取尚无 Renderer 改动；Web/Mobile 实现前同步对应 UI 规范 |
| Runtime Activity | 确认无需更新 | Runtime Adapter 语义与活动分类保持不变 |
| Runtime compatibility | 确认无需更新 | 库化不晋升平台资格；真实环境验证后才更新兼容性证据 |
| Documentation routing | 已更新 | 文档、架构与决定导航增加统一 Host 入口 |
| Root README | 确认无需更新 | 当前尚未交付新增支持平台，不提前增加可用性声明 |
