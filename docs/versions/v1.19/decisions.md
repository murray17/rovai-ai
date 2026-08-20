---
document_type: version-decisions
version: v1.19
lifecycle: current
last_updated: 2026-08-20
---

# v1.19 决策记录

本文件只解释 v1.19 的安全与输入语义取舍；当前字段和行为由 Architecture 与 Contracts 直接拥有。

<a id="v1-19-d01"></a>

## V1.19-D01：复用 Host 的 Run tmp 使用稳定路径、逐 lease 清空，并以 per-Camp gate 串行 Authority ingress

### 背景

`ROVAI_RUN_TMP` 在 Runtime Host 启动时进入环境，因此 warm Host 后续 bind 无法把进程环境可靠切换到新的
lease 子路径。保持现状又会让后继 Run 看到同一 process root 中的旧文件；同时各 Runtime 没有把该目录加入
原生文件准入，默认 sandbox 下可能根本无法写入。另一侧，Agent 与 Composer 会并发把同一个 Camp Authority
根从不可枚举模式临时切成可更新模式，没有共享锁时，一个操作恢复权限会使另一个操作中途失败。

### 决定

每个 Host 保留一个精确、稳定的 Run tmp 路径；`bind` 在签发新 lease token 和写 active context 前，必须删除
旧的受管内容、重建同一路径并恢复私有权限。重置失败即拒绝 bind。`unbind`、unregister 与全局 fence 尽力
清理，但不能把清理成功作为已结束 lease 的虚假保证；后继 bind 的强制重置是最终 admission。active lease
authentication 返回该 exact root，文件冻结仍重验 lease generation、AgentRun、epoch 与 exact path。

所有 Runtime Adapter 把这个精确根加入原生 workspace/additional-directory 入口，不加入其父目录。Camp
Authority ingress 使用进程内、跨 `CampAttachmentStore` 实例共享的 per-Camp mutex，覆盖根权限切换、子目录
创建/删除和失败清理；不同 Camp 可并行。它不替代数据库事务、View gate 或 built-in invocation guard。

### 后果

- warm Host 保留进程和 Native Session 的收益，但文件临时区不会跨 lease 继承；
- Runtime 能在默认受限权限下真实写入 `ROVAI_RUN_TMP`，同时不能枚举相邻 Core 私有目录；
- 同 Camp 大文件 ingress 会互相排队，不同 Camp 仍可并行，且不会扩大数据库临界区；
- bind 多一个受管目录重建的 fail-closed 前置步骤，异常清理失败会使该 Host 无法获得新 lease。

### 被拒绝方案

- 每个 lease 改用新子目录并只更新 CLI context：已经运行的 Host 环境仍指向旧路径，模型与子进程不会可靠
  获得新值；
- 只在 unbind 清理：崩溃或 best-effort 失败会把旧文件带入后继 lease；
- 让 Runtime 写整个 process root：扩大到 context token 与其他 Core 私有内容；
- 恢复全局 invocation/数据库锁：会串行所有 Camp 并把大文件 I/O 带回全局临界区。

### 当前权威影响

- [Camp Attachment v4](../../contracts/camp-attachment-v4.md)
- [Built-in Tool Transport v19](../../contracts/builtin-tool-transport-v19.md)
- [Runtime Launch and Verification v13](../../contracts/runtime-launch-and-verification-v13.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [Camp Published Attachment View](../../architecture/camp-published-attachment-view.md)

<a id="v1-19-d02"></a>

## V1.19-D02：Agent Send 与 Composer 共享“正文或附件至少一项”的 payload 门禁

### 背景

Composer 已允许 ready attachment 独立构成消息，而 Agent `camp.message.send` 仍要求非空 body。结果是文件已
成为正式 Send 输入，却无法执行最直接的 `rovai send --file <path>`，Agent 只能制造无信息占位正文。继续要求
字段存在但允许空串仍会使 direct CLI 只传 `--file` 在 Schema requiredness 阶段失败。

### 决定

Send v12 把 `body` 设为可选、缺省 `""`，`files` 继续缺省 `[]`。领域准入要求 `body.trim()` 非空或 files
至少一项；两者同时为空稳定拒绝。Attachment-only 消息保存真实空 body，不生成占位正文，继续使用同一公共
消息、附件 publication、Delivery、receipt、Replay 和 Agent output 语义。

### 后果

- `rovai send --file <path>`、JSON `{"files":[...]}` 与显式空 body 都能发送纯附件；
- Schema 只表达字段 shape/default，跨字段和 whitespace 规则由领域服务统一拥有；
- 正文寻址在空 body 时自然没有 inline recipient，显式 `--to`、`--public-only` 和 `--to-principal` 规则不变。

### 被拒绝方案

- 保持 body required 并要求占位文本：制造没有业务信息的公共历史；
- 只把 `minLength` 改为 0：direct CLI 仍必须显式提供 `--body`，没有实现目标命令；
- 只依赖 JSON Schema `anyOf`：无法完整表达 trim 后空白，且会把领域 admission 分散到 transport。

### 当前权威影响

- [Camp Message Send v12](../../contracts/camp-message-send-v12.md)
- [Built-in Tool Transport v19](../../contracts/builtin-tool-transport-v19.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
