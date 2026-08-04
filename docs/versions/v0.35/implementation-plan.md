---
document_type: implementation-plan
version: v0.35
authority: implementation-status
status: complete
last_updated: 2026-08-04
---

# v0.35 实施与验收计划

设计与 ADR 已冻结，以下生产实施和自动化验收已经完成。完成状态依据代码、Migration、测试和
可复现验收证据记录，不由 ADR `accepted` 推断。

## Checkpoint 1：合同断代与 clean break

- [x] 引入 Native Session Bootstrap v2、Bootstrap Formatter v2、Context Formatter v6 与
  ContextManifest v5；Member Identity 保持 schema version 1。
- [x] 将新上下文合同纳入 Native Binding compatibility，使旧 Session 与未完成 Context 不进入
  legacy Resume 或 Formatter 翻译分支。
- [x] 从新 AgentRun effective configuration、动态 Payload 与恢复来源移除 Member Identity。
- [x] 更新数据库约束、Read Model 和事件语义，使 Bootstrap Evidence digest 明确只覆盖稳定
  Charter/Memory 组件。

## Checkpoint 2：Bootstrap Formatter 与 Evidence 分离

- [x] 建立唯一 Formatter，按 `SESSION_CHARTER → MEMBER_IDENTITY → MEMORY_ENTRYPOINT`
  生成完整 Bootstrap，并固定 JSON 字段顺序与空值行为。
- [x] 在符合条件的投递前读取 AgentProfile 最新已提交六字段；读取/验证失败在 Runtime 调用前
  fail closed。
- [x] 保持 Session Charter、Memory Entrypoint、Memory observation、授权依据与 delivery mode 的
  现有 Evidence 生成和复用。
- [x] 证明 Bootstrap Evidence、ContextManifest、Managed Blob 和 durable digest 均不保存目标
  成员的完整六字段 `MEMBER_IDENTITY` 投影或完整格式化 Bootstrap。
- [x] 让 ContextManifest v5 只冻结四区段 AgentRun Dynamic Context，并保持该动态 Payload 的
  byte-identical recovery。

## Checkpoint 3：Claude Code 与 Codex Resume 注入

- [x] Claude Code 新建同时传 `--session-id` 与 `--append-system-prompt`，Resume 同时传
  `--resume` 与 `--append-system-prompt`。
- [x] Codex `thread/start` 与 `thread/resume` 都传
  `developerInstructions: <formatted bootstrap>`。
- [x] Codex Resume 失败后的 replacement Thread 重新建立 Bootstrap 并重新读取最新身份。
- [x] 保持受控 Resume 失败后后续执行进入 New Session、输入只投递一次和未知结果 fail-closed
  状态机。

## Checkpoint 4：`first_payload` 与其他 Runtime 回归

- [x] 新 `first_payload` Session 在内存中临时拼接完整 Bootstrap 与冻结动态上下文，不保存完整
  首 Payload 或其完整 digest。
- [x] OpenCode、Copilot、Antigravity 与其他既有 Adapter 的 Resume 不新增 Bootstrap 重新注入，
  外部调用协议和输入投递次数不变。
- [x] 保持所有 Runtime 的 New Session Bootstrap、replacement Binding、Context Read Marker、
  MCP/Skill exposure 与普通 input ACK 行为。
- [x] 验证 Identity Update 不轮换 Session、不改写已发送调用，也不推送到正在运行的 Runtime。

## Checkpoint 5：专项自动化验证

- [x] Formatter 测试覆盖精确区段顺序、schemaVersion、六字段顺序、JSON 转义、空值与动态上下文
  禁止项。
- [x] Core 集成测试覆盖新 Session、Claude Resume、Codex Resume、replacement、受控失败后的
  New Session、`first_payload` 和身份并发读取边界。
- [x] Adapter request capture 测试断言 Claude 参数与 Codex start/resume JSON，不以模型输出作为
  断言。
- [x] 负例覆盖 Profile/身份不可用、部分 Bootstrap、完整 `MEMBER_IDENTITY` 投影持久化泄漏、
  旧 Context 恢复和重复输入投递。
- [x] 既有 Session Bootstrap、Memory Entrypoint、ContextManifest、replacement 与 Runtime
  adapter 测试更新后继续通过。

## Checkpoint 6：全量门禁与完成

- [x] `cargo test --workspace` 通过。
- [x] `cargo clippy --workspace --all-targets -- -D warnings` 通过。
- [x] `pnpm typecheck` 与 `pnpm test` 通过。
- [x] `pnpm build:desktop` 通过。
- [x] `git diff --check` 通过。
- [x] 未运行 Claude/Codex 真实 Runtime Smoke；按冻结合同，它们是补充兼容性证据而非 Hard Gate，
  且不以模型是否采用新身份作为完成判断。
- [x] README 的 `implementation_status` 已在上述必需项与架构验收全部成立后改为 `complete`。

## 完成证据（2026-08-04）

- Rust：`cargo test --workspace` 通过（Core library 279 项；主程序 56 项，另有 5 项手工 Runtime
  smoke 按合同忽略）；`cargo clippy --workspace --all-targets -- -D warnings` 通过。
- TypeScript / Node：`pnpm typecheck` 通过；`pnpm test` 通过（Vitest 179 项、Node 52 项）。
- Desktop：`pnpm build:desktop` 通过。
- 静态完整性：`cargo fmt --all -- --check` 与 `git diff --check` 通过。
- 本版本没有并入或改写 v0.34 的未完成范围；v0.34 继续保持未完成历史快照。
