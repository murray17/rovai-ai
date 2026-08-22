---
document_type: version-decisions
version: v1.27
lifecycle: current
last_updated: 2026-08-22
---

# v1.27 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前行为规范由链接的 Architecture 与 Contract 拥有。

<a id="v1-27-d01"></a>
## V1.27-D01：Provider 凭据只进入私有进程配置，Kimi Session 采用 `new_only`

### 背景

Kimi Code 可以通过环境变量配置 OpenAI-compatible provider。用户要用 MiniMax Token Plan 做真实本地验收，
但把 token 写入仓库、数据库、命令行、日志或共享 `~/.kimi/config.toml` 都会扩大秘密暴露面。另一方面，
Kimi native resume 依赖同一 Kimi home。真实 Probe 已证明新进程复用同一 home 时 exact resume 成功并保留
上下文，而 Rovai 为每个 Host 创建新的隔离 home 后会稳定得到 `Unknown sessionId`。

### 决定

1. Rovai 只从权限收窄的外部 env 文件读取六个显式 `KIMI_MODEL_*` 键，并只注入 Kimi 子进程；
   `KIMI_MODEL_CAPABILITIES=thinking` 只声明能力，Rovai 不强制关闭 Kimi/MiniMax thinking；
2. 默认文件为 `~/.config/rovai/kimi-code.env`，可由 `ROVAI_KIMI_CONFIG` 覆盖；内容不进入数据库、Evidence、
   diagnostics、命令或 Git；未知、重复、空值和权限过宽都 fail closed；
3. 每个 Kimi Host 使用新的隔离 `KIMI_CODE_HOME`，Run terminal 后停止并清理；
4. 当前 continuation strategy 固定为 `new_only`，snapshot 不声明 `session.resume`；Rovai portable context 仍按
   既有合同送入新 Session；
5. Catalog identity 与平台资格分离。macOS arm64 虽通过基础 ACP 行为验收，但在完整 Built-in CLI matrix
   建立合格 evidence 前保持 `not_qualified / runtime_platform.builtin_transport_unqualified`；其他平台独立取证。

当前规范见 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)与
[Runtime Launch and Verification v20](../../contracts/runtime-launch-and-verification-v20.md)。

### 后果

- 用户原有 Kimi 配置和认证状态保持不变，密钥暴露面限制在私有文件与目标子进程；
- 每个 Run 有确定性隔离和清理，代价是暂不复用 Kimi native conversation；
- 未来要启用 resume 必须先设计稳定隔离 home/binding，并以新证据和合同版本准入；
- Catalog identity 与逐平台 qualification 继续分离。
- Product Runtime 普通路径不会启动 Kimi；直接真实模型诊断不改变准入状态。

### 被拒绝方案

- **把 token 存入成员 Runtime 参数或数据库：** 会把秘密带入持久投影、诊断和备份面；
- **复用或改写 `~/.kimi/config.toml`：** 会污染用户日常 Kimi 环境并破坏验收隔离；
- **通过命令行参数传 token：** 容易进入进程列表与命令 Evidence；
- **仅凭同一 home 的 `session/resume`/`session/load` 成功就声明产品 continuation：** 这会绕过当前每 Host
  私有 home 的隔离与 compatibility 边界；跨隔离 home 的真实结果仍是 `Unknown sessionId`。
