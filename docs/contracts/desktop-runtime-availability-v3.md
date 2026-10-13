---
document_type: protocol-contract
contract: desktop-runtime-availability-v3
authority: desktop-bootstrap-supervisor-authority-admission-and-request-transport
status: accepted
version: 3
last_updated: 2026-10-12
---

# Desktop Runtime Availability v3 Contract

本合同继承 [v2](desktop-runtime-availability-v2.md)，仅替代其第 1、9 节关于启动反馈等待 400ms 的呈现规则。
Supervisor schema、generation/capability、SQLite 权威准入与迁移、启动重试、错误传输及可选子系统门禁均保持不变。

## 首帧启动反馈

Renderer 首个已提交帧必须显示既有不透明整窗品牌加载画布，不等待计时器、首份 Supervisor snapshot 或本机
Main Window Session IPC。非权威导航框架可在画布后挂载，但 rail、顶行与内容区不能先暴露给 User；画布自身不发起权威请求。

Core ready、Onboarding admission 与目标读取的交接期间持续显示加载。只有既有准入通过且真实目标可用后才
退出画布；沿用普通动效下的 180ms 淡出与 reduced-motion 行为，不新增最短展示时间。既有 horizon 标记、
纯色背景、1600ms 轻呼吸、辅助技术 polite busy status 及不显示技术阶段文案的规则继承 v2。

明确 blocked/crashed 或本地读取错误时，立即切换到独立恢复面，不等待 400ms，也不让加载画布的退出动效遮挡
恢复操作。恢复面沿用“暂时无法打开会话”、“重新打开”和“导出诊断”；原始技术错误仍只保存在诊断中。

本合同只删除冷启动反馈延迟。普通 Thread 切换、关闭反馈各自的 400ms 时序不变；首帧画布不扩大权威读取、
Onboarding 或 Runtime 的准入，也不把非权威框架视为已进入、已读或可持久化的恢复目标。

## 当前呈现与验证

- [App Shell 冷启动反馈](../ui/components/app-shell-navigation.md#冷启动反馈)
- [Bootstrap Shell](../ui/components/bootstrap-shell.md)
- `pnpm test:startup-presentation`：首个提交、authority/Onboarding 交接、目标就绪、立即错误恢复、双主题、200% 与 reduced motion。
