---
document_type: version-overview
version: v0.20
lifecycle: current
authority: version-scope-and-status
last_updated: 2026-07-29
---

# Rovai-ai v0.20 受管 Product Runtime 发现与自动恢复

> 状态：完成（2026-07-29）
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.19 已验证的 Agent Runtime 扩展](../v0.19/README.md)
>
> 跨版本决策：
> [ADR-0066](../../adr/0066-managed-product-runtime-resolution.md) ·
> [ADR-0065](../../adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.20 让普通用户只选择 Product Runtime，不再选择 Installation 或文件路径。九种已接入
Runtime 始终出现在产品目录中；Core 用自身的搜索环境快速发现本机入口，只对确有需要的
候选执行深度探测，并在包管理器升级导致路径移动后自动验证和迁移同一个 Installation。

用户选择的 Runtime 即使尚未安装也会持久保存，不会回退。后续发现匹配入口时，Rovai
自动创建或复用 managed default Installation，解析成员选择并应用真实能力快照提供的
模型与安全权限默认值。

## 交付范围

### Core 启动与发现

- 在 Tokio 之前构建不可变 Runtime Search Environment；
- 合并继承 PATH、限时 login-shell PATH 和 macOS 已知目录，不修改进程全局 PATH；
- 快速发现九种 Runtime，分阶段发布路径与版本观察；
- Core 的数据库与 IPC ready 不等待发现，首页不弹启动提示；
- 显式重新检测可读取 interactive login shell，并向用户解释副作用。

### Installation 与能力证据

- 快速发现观察与持久能力快照分离；
- 最近成功快照与最近 Probe Attempt 分离；
- 24 小时软刷新、暂时失败保留上次成功、硬失效 fail closed；
- 每个 `(AdapterKind, authScope)` 只有一个普通用户使用的 managed default；
- 路径失效后按优先级顺序探测，成功后原子更新同一 Installation ID 并记录审计。

### 成员、Run 与 Native Session

- 成员持久选择 `AdapterKind`，允许 selected-unresolved，不自动回退；
- 缺少真实能力快照时模型和权限保持待解析；
- 发送触发的 Runtime Resolution Job 可跨 Core 重启恢复，并可取消发送；
- 成功解析后才原子创建公开消息、CampTurn、AgentRun 和冻结配置；
- Session 复用由 Adapter 兼容键决定，未知时仅在输入前做一次受控 Resume。

### Desktop

- 成员页固定展示九种产品，不展示路径；
- 设置页展示产品可用性、检查与安装说明；
- 路径、fingerprint、探测与迁移记录进入高级诊断；
- 所有用户可见的成功状态使用“已就绪”。

## 平台与数据边界

- 本版本只交付并验证 macOS 14+ Apple Silicon；
- Windows/Linux 搜索来源和 `.cmd`、`.ps1`、`.bat` shim 留给未来平台版本；
- 项目尚未发布，Runtime 领域采用新 schema，不兼容或迁移旧的路径型成员配置与重复
  Installation 数据；开发数据库可以重建；
- Product Runtime Catalog 仍只包含九种已实现 Adapter，兼容性候选不进入产品 UI。

## 完成定义

只有 [实施计划](implementation-plan.md) 的领域、Core、Desktop、恢复、安全和自动测试
证据全部完成后，本版本状态才改为完成。上述检查点和最终 macOS 验收现已全部通过；
可复现命令与结果记录在实施计划中。`ADR accepted` 本身仍不代表实现已经落地。
