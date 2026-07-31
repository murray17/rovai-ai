---
document_type: version-overview
version: v0.26
lifecycle: current
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-07-31
---

# Rovai-ai v0.26 Member Runtime Parameters

> 状态：设计已冻结，生产实现与本地验收已完成
>
> 前置版本：[v0.25 Attachment Composer](../v0.25/README.md)
>
> 跨版本决策：[ADR-0082](../../adr/0082-member-owned-runtime-parameters.md)、
> [ADR-0083](../../adr/0083-background-runtime-checks-and-actionable-status.md)、
> [ADR-0084](../../adr/0084-conversation-surface-controls-and-stop-outcome-projection.md)
>
> 生产设计：[production-design.md](production-design.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

在队员页现有“运行配置”区域下增加默认收起的“运行参数”，恢复队员级模型、模型
参数和 Runtime 原生权限控制，同时继续由 Core 管理 Installation、路径、fingerprint、
认证范围和探测证据。完整配置只影响以后创建的新 AgentRun；Runtime 发现、检查和缓存
统一移入 Core 后台，普通页面只展示是否可用与修复动作。

同一版本补齐会话表面 v3：Inspector 可从 Camp 顶栏完整隐藏并本机记忆，终态停止以
CampTurn 级独立事件进入时间线，复制入口跟随正文，队员与记忆页复用可拖拽顶栏。

## 已确认范围

- Product Runtime、模型策略和权限参数组成一个原子保存的队员配置。
- Runtime 未就绪时仍可只保存产品选择；后续就绪不自动补参数。
- `runtime_default` 同时跟随默认模型和默认模型参数，不保存覆盖值。
- 固定模型只展示该模型能力快照实际报告的参数。
- 九种 Runtime 使用专用组件、原生字段和值，不做跨 Runtime 转换。
- 首次显式保存采用每个 Adapter 明确定义的最宽松权限默认值。
- UI 不显示危险/高风险标签，不使用警告色，不增加二次确认。
- 能力变化导致配置失效时进入 `needs_attention`，不静默修复。
- v41 Migration 清空全部既有队员 Runtime 选择与参数，不提供兼容迁移。
- 普通队员页不展示 Installation ID、路径、fingerprint、auth scope 或探测/迁移信息。
- Core 在启动发现、后续发现、Runtime 变化、队员切换、缓存过期和显式检查后异步排队
  探测；同一 Product Runtime 去重。
- 页面打开优先展示缓存，缺失或过期时后台刷新；保存队员配置不执行完整检查，AgentRun
  启动前只进行轻量文件身份和持久状态确认。
- 用户主状态只使用“正在检查… / 可用 / 需要登录 / 未安装 / 版本不支持 / 不可用 /
  暂时无法确认”；不展示“已找到”“尚未检查”“已检查”等内部阶段。
- Inspector 默认展开、可完整隐藏并仅在本机记忆；Run/审批摘要可恢复并定位页签。
- 每个终态取消 CampTurn 只显示一条“你已在 {耗时} 后停止”；未确认效果从该事件
  进入 Inspector，队员消息不重复终态取消标签。
- 消息正文复制入口、时间线和 Composer 同轴，以及队员/记忆共享顶栏按
  ADR-0084 实现；不采用原型静态页面或旧窄屏侧栏规则。

## Runtime 字段

| Runtime | 模型参数 | 权限参数 |
|---|---|---|
| Codex CLI | `reasoning_effort` | `sandbox_mode`, `approval_policy` |
| OpenCode | snapshot 报告时使用 `reasoning_effort` | `permission` |
| GitHub Copilot CLI | snapshot 报告时使用 `reasoning_effort` | `allow_all` |
| Claude Code | `effort` | `permission_mode` |
| Kiro CLI | 无通用推理参数 | 无持久化权限字段 |
| Qoder CLI | snapshot 报告时使用 `reasoning_effort` | `permission_mode` |
| CodeBuddy | snapshot 报告时使用 `reasoning_effort` | `permission_mode` |
| Qwen Code | snapshot 报告时使用 `reasoning_effort` | `approval_mode` |
| Antigravity | 无通用推理参数 | `mode`, `sandbox`, `dangerously_skip_permissions` |

## 非目标

- 自定义 Installation、可执行路径或 auth scope 的队员级选择。
- 跨 Runtime 统一权限等级、字段转换或兼容别名。
- 修改既有冻结 AgentRun。
- Night 视觉设计；继续使用 Arctic Dawn Day。
- 删除 Core 内部 Discovery、Probe Attempt、Snapshot、退避或完整性状态机。
- 为 Inspector 偏好或停止事件新增 Core 设置、CampMessage 或快照字段。

## 完成定义

ADR、Migration、Core 原子命令与后台检查调度、九种 Runtime 编辑器、可操作状态投影、
Readiness/冻结边界、Renderer 语义测试、Core 测试、Typecheck、桌面构建和本地 macOS
arm64 打包全部通过。
