---
document_type: version-overview
version: v0.35
lifecycle: current
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-08-04
---

# Rovai-ai v0.35 Native Session Member Identity Bootstrap

> 中文名：成员身份原生会话启动配置
>
> 状态：设计冻结，生产实施与自动化验收已完成
>
> 前置版本：[v0.34 Benchmark Evidence & Semantic Judge](../v0.34/README.md)
>
> 跨版本决策：[ADR-0100](../../adr/0100-latest-member-identity-native-session-bootstrap.md)
>
> 实施设计：[architecture.md](architecture.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)

## 版本意图

把六字段 Member Identity 从每个 AgentRun 的冻结动态上下文迁移到 Native Session
Bootstrap。Session Charter 与 Memory Entrypoint 继续使用已有不可变证据，Member Identity
则在符合条件的 Session 创建或 Resume 边界读取 AgentProfile 最新已提交值并临时格式化。

本版本不建立身份历史、Session 级身份 Revision 或即时推送协议。它明确接受完整 Bootstrap
不再可被持久证据逐字重建，以换取当前身份在 Claude Code 与 Codex Resume 时自然生效。

## 冻结的模型输入合同

完整 Bootstrap 固定为三个区段，顺序不可变化：

```text
SESSION_CHARTER
MEMBER_IDENTITY
MEMORY_ENTRYPOINT
```

`MEMBER_IDENTITY` 使用 schema version 1，完整包含 Name、Team Role、Professional
Responsibilities、Personality Traits、Working Principles 与 Growth Topic。AgentRun Dynamic
Context 不再包含身份，只保留：

```text
COLLABORATION_STATE?
SHARED_CONVERSATION?
RUN_NOTICES?
CURRENT_INPUT
```

新 Session 使用当前 Charter、最新身份和当前 Memory Entrypoint；Resume 使用原 Charter、
最新身份和原 Memory Entrypoint。身份读取或格式化失败时 fail closed，不回退旧 Run 或旧
Session 身份。

## Runtime 投递边界

| Runtime 路径 | 新 Session | Resume |
|---|---|---|
| Claude Code | `--session-id` 与 `--append-system-prompt` | `--resume` 与 `--append-system-prompt` |
| Codex | `thread/start.developerInstructions` | `thread/resume.developerInstructions` |
| `first_payload` 及其他既有路径 | 首 Payload 前置完整 Bootstrap | 保持现状，不重新注入 Bootstrap |

Claude Code 与 Codex 是本版仅有的 Resume 重新注入例外。Rovai 必须在两个 Codex 请求中都
传 `developerInstructions`，但不负责检测或规避 Codex 可能继续采用 Thread 首次 developer
instructions 的上游行为。

Resume 失败后立即创建 replacement Session 时，replacement 按新 Session 规则重新读取最新
身份。受控 Resume 失败后延迟到后续执行创建新 Session，以及所有既有 replacement / New
Session / `first_payload` Bootstrap 行为必须保持成立。

## Evidence 与持久化边界

- `NativeSessionBootstrapEvidence` 继续保存和复用 Session Charter、Memory Entrypoint、
  相关 Memory observation、授权依据和 delivery mode；
- 不新增 Bootstrap/Session 级 Member Identity Blob、Revision、Digest、版本或历史快照；
- Evidence digest 只证明 Charter 与 Memory Entrypoint 稳定组件，不代表完整 Bootstrap；
- ContextManifest v5 只冻结 AgentRun Dynamic Context，不保存完整首 Payload；
- `first_payload` 的完整 Bootstrap 与动态上下文只在投递前临时拼接，不持久化其完整字节或
  Digest；
- 新 AgentRun 不再把 Member Identity 当作冻结动态配置或恢复来源。

合同断代固定为 Native Session Bootstrap v2、Bootstrap Formatter v2、Context Formatter v6
与 ContextManifest v5；Member Identity 自身保持 schema version 1。升级前 Session 与未完成
Context 不进入兼容翻译或旧 Formatter 恢复分支。

## 保持不变

- 六字段仍由一次 versioned Identity Update 原子保存；
- Avatar、Runtime/模型/权限、Presence 与 Memory Capability 继续独立保存；
- 其他成员仍只看到 Name、Team Role、Professional Responsibilities 与 advisory
  availability；
- Personality Traits、Working Principles 与 Growth Topic 仍只投递给本人；
- 身份字段不授予 Capability、权限或完成证明，也不自动形成或修改 Memory；
- 正在运行的 Runtime 不即时接收身份更新。

## 明确不在范围

- Runtime 内部压缩后的 Bootstrap 保留与压缩检测；
- 压缩后主动 Resume；
- Codex Resume 时 developer instructions 替换不生效的修复或规避；
- OpenCode 或其他 Runtime 的新原生 instructions 接入；
- 正在运行的 Session 中即时更新身份；
- v0.34 未完成 Benchmark Evidence 与 Semantic Judge 范围。

## 完成定义

[implementation-plan.md](implementation-plan.md) 的全部 Checkpoint 必须完成。自动化门禁只需
证明 Rovai 构造并发送正确的 Bootstrap、CLI 参数、RPC 字段与持久化边界；真实 Runtime Smoke
可以作为补充证据，但不要求模型输出证明 Claude Code 或 Codex 实际采用了新的 Resume 身份。
