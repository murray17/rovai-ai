---
document_type: implementation-plan
version: v1.39
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-03
---

# v1.39 实施与验收

## 已实现

- [x] 从 main 当前结构重新建立 `AdapterKind::Pi`、Rust/TypeScript/UI closed set、独立 optional subsystem 与
  `pi-jsonl-rpc-v1` Host；未合并旧 Pi 分支。
- [x] Pi 安装存在性只由 `runtime.pi` optional subsystem 检查；缺安装时 Core、Skills、MCP 和其他 Runtime 保持可用，
  retry 幂等。版本、Machine Ready 与平台资格仍是独立门禁。
- [x] Migration 135：v1.44/schema85 → v1.45/schema86、当前 DDL closed-set 扩展、不可变 exact-binding receipt、
  acceptance guard、原子回滚、外键检查和重开幂等测试。
- [x] Pi 专属 Machine Ready：版本、extension handshake、原生 model state、创建 Session、完整 ID/canonical file、
  实际 `switch_session(exact file)` 与 `get_state` 三元一致性；Snapshot validation 与 dispatch blocker 共用重检。
- [x] Probe 通过 `--session-dir <probe-root>/sessions` 隔离原生 Session，正式 AgentRun 继续使用用户 Pi 原生 state。
- [x] Fleet `resident_multi_session`、串行 Session switch、并发 Burst、health/quiescence、owner lease、LRU、cancel、
  shutdown/reap 与 private directory cleanup；Pi 使用 workspace reuse identity，同时保留当前 Camp/member invalidation
  scope，其他 Runtime 的 member-scoped identity 不变。
- [x] `ManagedSystemPrompt` 与 revision 1 收据；完整 session locator 只在 Core 私有状态，公开面仅有不可逆 digest。
- [x] Shell Approval 使用 Pi 实际 shell path/args/transport；read/write/edit/bash 与未知 mutation fail-closed。
- [x] `.pi/skills` delivery group；managed extension 每 Session 重新发现并验证 exact Skill catalog。
- [x] External MCP `AdditivePerRun / RovaiWins / CoreManaged`；Core-owned stdio/Streamable HTTP transport、取消和清理。
- [x] `agent_settled` 唯一成功终点、assistant snapshot 去重、Missing-Send gate、Cancellation Settlement v2 与迟到
  epoch/binding fence。
- [x] Activity v2、terminal write/edit path、Pi assistant model-call Usage、稀疏 cache/cost 与 source digest 去重。
- [x] 三 shipped platform 均显式 NotQualified；release build 忽略本地 qualification override。

## 已取得的本机证据

- [x] Pi 0.84.4 官方配置使用 MiniMax M3 直接请求成功。
- [x] 隔离开发 smoke：Probe 不污染 Session、First Run、Core/Host restart exact resume、warm LRU、allow-once、deny、
  cancel 无延迟文件副作用、公开 locator 隐私与结构化 Usage。
- [x] Pi 0.84.4 真实 Skill 调用；导入、重启恢复、project-owned 同名 shadow 与删除产品流程。
- [x] Pi 0.84.4 真实 External MCP 单 Run：RovaiWins、stdio、Streamable HTTP 三个 projected Tool。
- [x] Pi 0.84.4 真实 workspace Resident：跨 Camp A→B→A exact Session switch、并发 Run 独立 Host、六类 Bash output
  与 Core planned shutdown 后完整 descendant/private Host config 回收。
- [x] Pi 0.84.4 真实 Skill 动态矩阵：update、disable/re-enable、unassign/restore、hard delete、project-owned 同名
  shadow，以及同一 Host 相邻 Session 无旧 catalog/marker 泄漏。
- [x] Pi 0.84.4 真实 MCP 动态矩阵：update、disable/re-enable、unassign/restore、delete、相邻 Session no-leak、
  mutation deny-before-dispatch、cancelled settlement、stdio Server reap 与延迟副作用缺失。
- [x] Pi 0.84.4 真实 Missing-Send zero-send、accepted-send suppression 与原生 Read tool→final；Bash matrix 另覆盖
  多 Tool 后 final。
- [x] Pi 0.84.4 当前 Built-in CLI 15-operation full Run 与 resumed/new-lease Run。
- [x] deterministic tests：A→B→A exact switch、并发独立 Host、receipt 全字段/nonce mismatch、协议重放/迟到、
  stdio/HTTP MCP bridge、Usage dedupe、Unknown mutation、cleanup 和 platform matrix。
- [x] Migration 135 专项：无 receipt acceptance 拒绝、错 binding 拒绝、合法原子接受、receipt 不可改删、FK=0、
  reopen 只保留一条 migration marker。

## 发布前仍需关闭

- [ ] 在 macOS arm64 补齐接入 Checklist 的剩余真实 Golden Flow：manual/threshold/overflow compaction、read-only/
  workspace 边界、invalid JSON/crash/timeout、真实 retry/queue late event、idle eviction、packaged planned shutdown 与
  Core crash recovery。
- [ ] macOS arm64 通过后生成 Pi 专属 immutable qualification artifact，并单独审查是否晋升该平台。
- [ ] 在真实 macOS x64 与 Windows x64 分别重复完整矩阵；Windows 额外验证 npm `.cmd/.bat` locator、System32
  interpreter、resolved target、fingerprint 与执行期 identity。
- [ ] 只有精确平台证据完成后才把对应 Pi Admission 行改为 `qualified`；不得从本机 debug smoke 或其他 Runtime
  evidence 外推。

## 必跑命令

```bash
pnpm check:rust
pnpm test:rust:lib
pnpm test:rust:cli
pnpm test:rust:core
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm smoke:skills
pnpm smoke:mcp-projection
pnpm smoke:missing-send-recovery
ROVAI_PI_BIN=<pi-0.84.4> pnpm smoke:pi-runtime
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=aae13734669c363e7b307a6407e6868eda1e6b8e pnpm docs:check:ci
```
