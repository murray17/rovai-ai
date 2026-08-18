---
document_type: implementation-plan
version: v0.39
authority: implementation-plan-and-acceptance
status: completed
last_updated: 2026-08-05
---

# v0.39 实施与验收计划

> Codex Isolated Home 已完成实现、真实 Runtime Smoke 与 packaged App 验收。

## Checkpoint 0：Codex 隔离权威冻结

- [x] 明确用户所说的任务是 Camp，不是 Task 或 CampTurn；
- [x] 冻结 Isolated Codex Home 身份为 `campId + agentProfileId`，与 Conversation 连续性一致；
- [x] 冻结首次复制用户 config、删除顶层 MCP、强制项目 `untrusted`、写入 Rovai external MCP
  的配置所有权；
- [x] 冻结 `auth.json` 软链接、共享插件例外和 `rovai_team` runtime-only credential；
- [x] 冻结 per-AgentRun app-server：不再全局复用，三个 Run 终态关闭，后续 Run 新进程 resume；
- [x] 冻结 Camp 生命周期、Camp delete cleanup record 和 72 小时孤儿 GC；
- [x] 接受 [ADR-0107](decisions.md#adr-0107)
  并发布[实施合同](codex-home-isolation.md)。

## Checkpoint 1：Home Manager 与持久协议

- [x] 新增 `CodexHomeManager`，集中拥有安全路径、owner marker、权限、锁、原子 TOML 更新、
  auth symlink 和 plugin state access；
- [x] 使用 `<data>/codex-homes/<camp_id>/<agent_profile_id>/`，禁止 Adapter 自行拼接路径；
- [x] 首次创建复制用户 config snapshot，完整删除顶层 `mcp_servers`，不写回用户文件；
- [x] 既有 Home 不自动 rebase 用户 config；schema upgrade 使用显式 migration；
- [x] 为当前 execution root 强制 `untrusted`，保留 `AGENTS.md` 指令发现；
- [x] 增加 Home metadata schema、external projection digest 和敏感信息 redaction tests。

## Checkpoint 2：逐 AgentRun Codex 进程

- [x] 删除 `CodexCliRuntimeAdapter.agent_hosts` 与 `RuntimeHostKey` 的 Codex 全局复用路径；
- [x] 每个 `agentRunId + executionEpoch` 创建独占 `CodexHost`，启动时显式设置隔离
  `CODEX_HOME`；
- [x] 重复 ensure 只复用同一 live AgentRun runtime，后续 AgentRun 必须得到新 PID；
- [x] `running` / `waiting` 保留进程，`succeeded` / `failed` / `cancelled` 进入同一幂等 shutdown；
- [x] cancellation、launch error、host crash、epoch replacement、worker panic 和 Core shutdown
  均完成有界回收；
- [x] 非 AgentRun Codex 内部作业改用 job-scoped 临时 Home，不回退用户真实 Home。

## Checkpoint 3：MCP 代次、验证与 Session 恢复

- [x] 每个 AgentRun 从 frozen Projection Input/Exposure 生成完整外部 MCP，整项替换而非字段合并；
- [x] 配置 digest 变化时在进程启动前原子更新；running/waiting Run 不热切换；
- [x] `rovai_team` 继续在 start/resume request 中注入，Binding credential 不落盘；
- [x] app-server initialize 后、首个 Turn 前读取 effective config，拒绝项目层或系统层未知顶层
  MCP；
- [x] external MCP explicit rejection 的单次降级必须关闭首进程、写入降级集合并启动新进程；
- [x] 新进程在同一 Home 中 `thread/resume`；Home 缺失/损坏执行 controlled Native Session
  replacement，不伪报原生历史恢复。

## Checkpoint 4：Camp 删除与 GC

- [x] Migration 新增不依赖 Camp foreign key 的 Home cleanup record、retry fields 与索引；
- [x] Camp delete transaction 原子写 cleanup record，提交后立即 wake、删除并在失败时持久退避；
- [x] 清理只 unlink auth/plugin symlink，不进入用户共享 target；
- [x] member leave/rejoin、Presence removed 和 Task/CampTurn/AgentRun 终态均不清理有效 Home；
- [x] Core startup 与周期 worker 清理超过 72 小时的未知孤儿，合法 Camp Home fail closed；
- [x] 覆盖路径穿越、伪 marker、symlink Camp dir、并发 Core 和时钟回拨。

## Checkpoint 5：回归、真实 Smoke 与打包

- [x] 增加同名 stdio-user / HTTP-Rovai 与 HTTP-user / stdio-Rovai 跨 transport 回归；
- [x] 验证用户 config byte digest 不变、项目 `.codex` 禁用、`AGENTS.md` 保留、插件例外可用；
- [x] 验证同 Home 跨 Run resume、跨 Camp/成员隔离、每 Run 新 PID 和三个终态无进程泄漏；
- [x] 验证 projection 代次、旧 Run recovery、external degradation 和 Team credential 不落盘；
- [x] 验证 Camp delete immediate cleanup/retry、symlink target 安全和 72 小时 orphan GC；
- [x] 扩展 `scripts/smoke-mcp-projection.mjs` 并使用真实 Codex app-server，而非 rendered config
  或 mock；
- [x] 通过 Rust/Core/Desktop 相关 tests、format、clippy、typecheck，并重新生成 packaged macOS
  App；
- [x] 用最新 packaged App 复现原失败 Camp 场景并证明成功，记录二进制构建时间和真实结果。

## 2026-08-05 验收证据

- `cargo test --workspace`、`cargo clippy --workspace --all-targets -- -D warnings`、
  `cargo fmt --check`、`pnpm typecheck`、`pnpm test` 与 `pnpm build:desktop` 通过；
- 本机 Codex `0.146.0` 真实 app-server 验证项目 `.codex` 层禁用、`AGENTS.md`
  instruction source 保留、两个并行成员 PID 隔离，以及同一 Camp/成员后续 AgentRun 使用新
  PID `thread/resume` 到同一 Native Session；
- `scripts/smoke-mcp-projection.mjs` 通过 Debug Core 和 packaged Release Core 两次真实 Camp
  验证，结果分别来自 Rovai stdio、Rovai HTTP 和 Rovai stdio，未命中同名项目 Runtime MCP；
- 最终 arm64 App 位于 `dist/mac-arm64/Rovai-ai.app`，App 与内置 Core 的 strict codesign 验证
  通过；`resources/bin/rovai-core` 与 bundle 内 Core 的 Mach-O UUID 均为
  `83AA9EBD-065F-3D59-B0C2-08A99E63562B`，bundle 内 Core 修改时间为
  `2026-08-05T14:20:01+0800`；
- packaged App 使用 `ROVAI_ALLOW_ISOLATED_INSTANCE=1` 和独立 `userData` 成功启动；正常终止时
  Core 与 Electron 均完成回收。
