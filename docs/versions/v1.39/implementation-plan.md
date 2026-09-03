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
- [x] Pi 专属无 Prompt Machine Ready：版本、JSONL Host、extension handshake、原生 model state、private
  `--session` seed 初始化空 Session、完整 ID/canonical file、`new_session`、实际 `switch_session(exact file)` 与
  `get_state` 三元一致性；Snapshot validation 与 dispatch blocker 共用重检，且不自动声明行为能力。
- [x] Probe 通过 `--session-dir <probe-root>/sessions` 隔离原生 Session，不发送 Prompt/Tool/MCP，不等待 assistant
  lifecycle；正式 AgentRun 继续使用用户 Pi 原生 state，付费行为只留在显式 smoke/qualification suite。
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
- [x] 活动 Tool 组在底部执行台、Inspector 与局域网只读执行台优先展示已有公开证据中的具体当前指令；
  稳定 Tool 行、渠道卡片、Activity 分类及文件/Web typed Evidence 边界保持不变。
- [x] 消息完整 inline-code 文件候选通过 Core 来源与 Main `realpath + stat` 证明为现存普通文件后才生成链接；共享资源
  类型定义统一 inline-code 已知类型、会话链接与普通文件 Tab 图标，Main classifier 与不支持类型的系统打开路径不变。
- [x] 不存在通用偏好文件的新 profile 默认关闭世界地图；schema v4 保存值原样保留，schema v1–v3 继续迁移为开启，
  设置页未完成加载时也不短暂显示为开启。

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
- [x] Migration 135 专项：无 receipt acceptance 拒绝、错 binding 拒绝、合法原子接受、receipt 不可直接改删、父
  Delivery 与 Camp 永久删除可合法 cascade、FK=0，reopen 只保留一条 migration marker。

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
pnpm exec vitest run apps/desktop/src/renderer/src/execution-tool-grouping.test.ts apps/desktop/src/renderer/src/App.test.ts apps/desktop/src/shared/execution-presentation/feishu-card.test.ts
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

## 活动组具体指令验证（2026-09-03）

- `pnpm typecheck`：通过；
- `pnpm exec vitest run apps/desktop/src/renderer/src/execution-tool-grouping.test.ts apps/desktop/src/renderer/src/App.test.ts apps/desktop/src/shared/execution-presentation/feishu-card.test.ts`：
  3 个文件、211 项测试通过；
- `pnpm test`：138 个 Vitest 文件、1459 项测试通过，后续 Node suites 220 项通过、1 项平台条件跳过；
- `pnpm build:desktop`：Main、Preload 与 Renderer production build 通过；
- `pnpm docs:test`、`pnpm docs:check`、
  `DOCS_BASE_REF=53858ed40ca4a011d0e0e8f69a52e5d5e673cbde pnpm docs:check:ci`：通过；
- Impeccable changed-target detector：无发现。

## 文件引用存在性与共享图标验证（2026-09-03）

- 基于 `main@5a56103ee56a0e4c3e7a4a4c05917dbd5e05c7c3` 重放后通过 `pnpm typecheck`、`pnpm test`
  （Vitest 140 files / 1475 tests；Node/协议 220 passed、1 个 Windows-only skip）与 `pnpm build:desktop`。
- 已通过 `pnpm docs:test` 与
  `DOCS_BASE_REF=5a56103ee56a0e4c3e7a4a4c05917dbd5e05c7c3 pnpm docs:check:ci`；源码差异确认既有
  `file-preview-classifier.ts` 未修改。
- `pnpm test:desktop-bridge` 与 `pnpm test:file-reference-navigation` 在本机 Electron 启动阶段被宿主 sandbox 拒绝，
  进程在进入业务断言前退出，因此不把它们记为本机通过或功能失败；相同文件导航夹具以独立 `userData`、封闭 fake API
  和显式 `--no-sandbox` 受控重跑后 10/10 业务断言通过，并生成 Day/Night 截图供界面验收。
- 当前本机执行环境没有 `cargo`、`rustfmt` 或 `rustc`；Core 对共享注册表的读取、格式与授权断言由 PR Rust CI 门禁复验，
  不使用 TypeScript 结果替代。

## 世界地图首次默认验证（2026-09-03）

- 定向 red：新 profile 默认值与设置页加载态断言按预期失败 2 项；实现后 green：2 个文件、10 项测试通过；
- `pnpm typecheck`：通过；
- `pnpm test`：140 个 Vitest 文件、1475 项测试通过，后续 Node suites 220 项通过、1 项平台条件跳过；
- `pnpm build:desktop`：Main、Preload 与 Renderer production build 通过；
- `pnpm docs:test`、`pnpm docs:check`、
  `DOCS_BASE_REF=c6098169943471bacead4ab04cc1bbce24394ff3 pnpm docs:check:ci`：通过；
- Impeccable changed-target detector：无发现。
