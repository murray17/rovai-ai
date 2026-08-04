---
document_type: version-architecture
version: v0.35
authority: version-design
status: frozen
last_updated: 2026-08-04
---

# v0.35 Native Session Member Identity Bootstrap Architecture

## 1. 设计目标

v0.35 将 Member Identity 从 AgentRun 生命周期移到 Session 启动配置生命周期，但不把它变成
新的持久 Session 状态。系统同时维护三种不同权威：

1. Session Charter：由 Bootstrap Evidence 冻结的 Core 平台合同；
2. Member Identity：从 AgentProfile 在本次符合条件的投递前读取的最新已提交六字段；
3. Memory Entrypoint：由 Bootstrap Evidence 冻结的 Session Memory 发现缓存。

完整 Bootstrap 是三者在 Runtime 边界的临时格式化结果，不是新的持久 aggregate。AgentRun
Dynamic Context 继续是每 Run 不可变输入，但不再承担成员本人身份。

## 2. 模型可见格式

Formatter 必须生成以下精确区段顺序：

```text
[SESSION_CHARTER]
<frozen charter>
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
{
  "schemaVersion": 1,
  "name": "...",
  "teamRole": "...",
  "professionalResponsibilities": "...",
  "personalityTraits": [...],
  "workingPrinciples": "...",
  "growthTopic": "..."
}
[/MEMBER_IDENTITY]

[MEMORY_ENTRYPOINT]
<frozen entrypoint>
[/MEMORY_ENTRYPOINT]
```

Formatter 使用确定性 JSON 转义和展示格式，字段顺序固定；合法空字符串与空数组仍输出。
禁止把目标成员的完整六字段 `MEMBER_IDENTITY` 投影并入 Session Charter、Memory
Entrypoint、Collaboration State 或 Current Input；既有 Peer Member Identity Projection 不变。

每个 ContextManifest v5 保存的动态 Payload 只能按下列顺序包含实际存在的区段：

```text
[COLLABORATION_STATE]?
[SHARED_CONVERSATION]?
[RUN_NOTICES]?
[CURRENT_INPUT]
```

其中 `CURRENT_INPUT` 必需，其余空区段省略。动态 Payload、其 Blob 与 digest 均不得出现
`MEMBER_IDENTITY`。

## 3. 两类 Bootstrap 组件

### 3.1 持久稳定组件

Native Session Bootstrap v2 Evidence 沿用现有持久字段和授权边界：

```text
conversation
nativeBindingId + generation
bootstrap formatter version
SESSION_CHARTER bytes + digest
MEMORY_ENTRYPOINT bytes + digest
observed Memory IDs + Revision IDs
authorization basis
delivery mode
creation time
```

同一可恢复 Session 的 Charter 与 Memory Entrypoint 从原 Evidence 读取，不从当前 Profile、
Memory 或 Camp 状态重建。相关 Memory observation 与授权 evidence 保持原行为。

### 3.2 临时身份投影

Core 在每次符合条件的 Bootstrap 投递前查询目标 `AgentProfile` 的当前六字段，一次性验证并
格式化 `MEMBER_IDENTITY`。不得从 `AgentRun.effective_config`、ContextManifest、旧 Payload、
Runtime 日志或 Bootstrap Evidence 恢复身份。

读取发生在数据库锁内，得到该读取可见的最新已提交值；随后释放锁再执行外部 CLI/RPC。
读取后提交的 Identity Update 不改变本次调用，只影响下一次符合条件的投递。Profile 缺失、
读取失败或字段无效时，在启动 Runtime 前 fail closed。

## 4. Session 创建与恢复矩阵

| 场景 | Charter | Member Identity | Memory Entrypoint | 是否投递完整 Bootstrap |
|---|---|---|---|---|
| 任意 Runtime 新 Session | 当前新 Evidence | 最新已提交值 | 当前新 Evidence | 是 |
| Claude Code Resume | 原 Evidence | 最新已提交值 | 原 Evidence | 是 |
| Codex Thread Resume | 原 Evidence | 最新已提交值 | 原 Evidence | 是 |
| 其他 Runtime Resume | 既有 Session 保留 | 不重新读取投递 | 既有 Session 保留 | 否 |
| Resume 失败后的 replacement | 当前新 Evidence | 重新读取最新值 | 当前新 Evidence | 是 |

Identity Update 本身不轮换 Native Session、不取消或重建 AgentRun，也不向正在运行的进程或
Thread 推送内容。Claude Code 与 Codex 在后续 Resume 自然重新注入；其他 Runtime 等到后续新
Session。

## 5. Evidence 与 ContextManifest

### 5.1 不持久化完整 Bootstrap

系统不得持久化：

- 完整格式化 Bootstrap Blob；
- 包含 Member Identity 的完整 Bootstrap digest；
- Bootstrap/Session 级 Member Identity Revision、digest、version 或 historical snapshot；
- 为 Resume 保存的“上次注入身份”。

Bootstrap Evidence digest 只覆盖 Charter 与 Memory Entrypoint 稳定组件。字段名、Read Model、
事件和文档不得把它描述成完整 Runtime prompt digest。

### 5.2 ContextManifest v5

ContextManifest v5 继续冻结 AgentRun 的消息边界、source references、Bootstrap Evidence
reference、Collaboration State、Run Notices、Current Input、附件、Skill/MCP exposure、Formatter
版本以及动态 Payload Blob/digest。它不冻结 Member Identity，也不保存 native Session 启动参数。

恢复同一 AgentRun 时，动态 Payload 仍逐字复用；Member Identity 是否重新读取由 Runtime 投递
矩阵决定。这两个恢复合同不得混为一个“完整 Payload”合同。

### 5.3 `first_payload` 临时组合

新 `first_payload` Session 的 Runtime input 在内存中按以下方式生成：

```text
format(latest identity, frozen charter, frozen memory entrypoint)
+ separator
+ frozen AgentRun Dynamic Context
```

ContextManifest 只保存右侧动态部分。Runtime Input ACK 表示 Rovai 完成并获得该调用的接受结果，
但持久证据不能重建完整首 Payload 或证明其中身份的精确字节。投递结果未知时继续使用既有
fail-closed/reconciliation 规则，不以新身份盲目重发同一不确定输入。

## 6. Claude Code

Claude Code request 必须把完整 Bootstrap 与普通 prompt 分开传递：

```text
new:
  --session-id <id>
  --append-system-prompt <formatted-bootstrap>

resume:
  --resume <id>
  --append-system-prompt <formatted-bootstrap>
```

新建与 Resume 共用同一 Bootstrap formatter 和 fail-closed 身份读取。Resume 不再把
`--append-system-prompt` 限制在 `new_session_charter` 存在时。MCP、权限、Workspace、模型、
普通 prompt 与 one-shot 输入结算语义保持原合同。

## 7. Codex

Codex thread request 必须在两种方法中携带完整 Bootstrap：

```text
thread/start:
  developerInstructions: <formatted-bootstrap>

thread/resume:
  developerInstructions: <formatted-bootstrap>
```

Rovai 的验收边界是出站 JSON 请求确实包含字段和本次最新格式化值。已知 Codex App Server
可能在 Resume 时继续采用 Thread 首次创建的 developer instructions；v0.35 不检测、不重试、
不 fork Thread，也不以模型输出推断是否替换成功。

Resume 失败后创建 replacement Thread 时，必须建立新 Bootstrap Evidence 并重新读取当时最新
身份，保持现有 replacement Thread 行为。受控 Resume 失败后由后续执行进入 New Session 的路径
同样保留。

## 8. 其他 Runtime

OpenCode、Copilot、Antigravity 及其他现有 `first_payload`/Adapter 路径不增加新的原生
instructions 接入。它们的新 Session 仍在首 Payload 前置完整 Bootstrap；Resume 仍只接收普通
动态上下文。

这不是“所有 Runtime Resume 都刷新身份”的承诺。Claude Code 与 Codex 是本版仅有的 Resume
重新注入例外。通用 Formatter 与首 Payload 临时组合可以修改，但不得改变 OpenCode 的外部调用
协议、Session Resume 方法或输入投递次数。

## 9. replacement 与失败边界

必须保持以下已有状态机结果：

- 新 Claude Session 注入 Bootstrap；
- 新 Codex Thread 注入 Bootstrap；
- Codex Resume 失败并立即创建 replacement Thread 时注入新 Bootstrap；
- 受控 Resume 失败后，后续执行进入 New Session 并注入 Bootstrap；
- `first_payload` Runtime 的新 Session 把 Bootstrap 放入首 Payload；
- 已经运行的 Runtime 不因 Identity Update 被中断或收到推送。

任何路径都不得为了可用性降级成无身份 Bootstrap、旧 Run 身份或只含 Charter/Memory 的部分
Bootstrap。

## 10. 合同断代与迁移

目标合同版本固定为：

```text
Native Session Bootstrap       v2
Bootstrap Formatter            v2
Member Identity                schemaVersion 1
AgentRun Context Formatter     v6
ContextManifest                v5
```

Native Binding compatibility 必须包含新的上下文合同版本。v0.35 不实现旧 Bootstrap、旧动态
Payload 或旧 ContextManifest 的恢复、翻译和双写；升级前的 Session 与未完成 Context 按新
compatibility 边界失效并走现有 New Session/失败路径。已终结历史记录不构成本版恢复目标。

## 11. 验收权威

自动化测试必须在不依赖模型回答的情况下证明：

- Formatter 的区段与 JSON 字段顺序；
- 新建、Resume、replacement 和 `first_payload` 矩阵；
- Identity Update 后下一次符合条件的投递读取最新值；
- 动态 Payload、ContextManifest 和 Bootstrap Evidence 不持久化目标成员的完整六字段
  `MEMBER_IDENTITY` 投影或完整首 Payload；
- Claude CLI 参数与 Codex RPC JSON 在 start/resume 中都正确；
- 身份读取失败 fail closed；
- 既有 New Session/replacement/受控 Resume 状态机无回归。

真实 Runtime Smoke 只作为补充兼容性证据。模型是否表现出新身份，尤其 Codex 是否采用新的
Resume developer instructions，不是 v0.35 Hard Gate。

## 12. 非目标

- Runtime 压缩检测、压缩后 Bootstrap 保留或主动 Resume；
- Codex 上游 developer instructions 替换语义；
- OpenCode 原生 instructions；
- 正在运行的 Session 身份热更新；
- 身份 Revision、审计快照或完整 Bootstrap 可重现性恢复；
- v0.34 Benchmark Evidence 与 Semantic Judge 未完成范围。
