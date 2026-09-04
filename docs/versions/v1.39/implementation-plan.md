---
document_type: implementation-plan
version: v1.39
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-04
---

# v1.39 实施与验收

## 已实现

- [x] 从 main 当前结构重新建立 `AdapterKind::Pi`、Rust/TypeScript/UI closed set、独立 optional subsystem 与
  `pi-jsonl-rpc-v1` Host；未合并旧 Pi 分支。
- [x] Pi 安装存在性只由 `runtime.pi` optional subsystem 检查；缺安装时 Core、Skills、MCP 和其他 Runtime 保持可用，
  retry 幂等。版本、Machine Ready 与平台资格仍是独立门禁。
- [x] Migration 135：v1.44/schema85 → v1.45/schema86、当前 DDL closed-set 扩展、不可变 exact-binding receipt、
  acceptance guard、原子回滚、外键检查和重开幂等测试。
- [x] Migration 136：v1.45/schema86 → v1.46/schema87；保留历史 receipt V1 reader、Writer 只写 V2，新增 Prompt
  Transform/Image 私有证据，把旧 Pi `managed` permission 规范化为 `partial_managed`；Receipt UPDATE guard 与父
  Delivery cascade-safe DELETE guard、回滚、重开和 `foreign_key_check` 有专项测试。
- [x] Pi 专属无 Prompt Machine Ready：版本、JSONL Host、extension handshake、原生 model state、private
  `--session` seed 初始化空 Session、完整 ID/canonical file、`new_session`、实际 `switch_session(exact file)` 与
  `get_state` 三元一致性；Snapshot validation 与 dispatch blocker 共用重检，且不自动声明行为能力。
- [x] Probe 通过 `--session-dir <probe-root>/sessions` 隔离原生 Session，不发送 Prompt/Tool/MCP，不等待 assistant
  lifecycle；正式 AgentRun 继续使用用户 Pi 原生 state，付费行为只留在显式 smoke/qualification suite。
- [x] Fleet `resident_multi_session`、串行 Session switch、并发 Burst、health/quiescence、owner lease、LRU、cancel、
  shutdown/reap 与 private directory cleanup；Pi 使用 workspace reuse identity，同时保留当前 Camp/member invalidation
  scope，其他 Runtime 的 member-scoped identity 不变。
- [x] confirmed revision 3：正式 Host 恢复 Pi 原生 Built-in tools、Extensions、Skills、Context files、Prompt templates
  与 Settings；v5 薄 extension 只保留 binding、Bootstrap、最小 V2 receipt、Session 状态和 `bash/edit/write` 部分审批。
  自动 Extension 阻断 pre-input RPC 时只允许一次 managed-only 降级；完整 session locator 仍只在 Core 私有状态。
- [x] Shell Approval 使用当前 project trust 下 Pi 实际 shell path/args/transport；permission 为 `partial_managed`，
  read/grep/find/ls 与未知 Extension Tool 按 Pi 原生语义执行，不声明完整 sandbox 或 mutation coverage。
- [x] `.pi/skills` delivery group作为原生资源的追加来源；每 Session 只验证本轮 managed Skill 是实际 catalog 子集。
- [x] direct human prompt/skill Slash Command 按 Pi `get_commands` catalog 显式展开；原始 Formatter 22、实际 Runtime
  payload、source/expanded bytes 与 closed transform evidence 在 dispatch 前私有冻结，extension command 不绕过 receipt。
- [x] 当前授权 PNG/JPEG/GIF/WebP 以 exact bytes/MIME/order 进入 Pi `prompt.images`；模型 image capability、每项
  20 MiB/合计 80 MiB、digest 漂移均在 prompt 前验证，图片数量、每项证据和有序集合 digest 私有持久化。
- [x] stderr、startup prelude 与单条 malformed stdout 进入脱敏 Runtime diagnostic；持续 framing/response identity
  冲突才 poison Host。创建 gate 按 `(agent_run_id, execution_epoch)` singleflight，不跨进程或文件 IO 持有全局锁。
- [x] 删除 Pi Core-managed MCP bridge；Pi capability 为 `Unsupported`，dispatch 不读取 MCP 配置/Assignment、不依赖
  `mcp` subsystem、不生成 projection、不启动 Server 或 proxy Tool。已有 Assignment 与其他 Runtime projection 不变，
  历史 ContextManifest MCP 字段在 Pi 无 MCP 恢复路径中忽略。
- [x] ACP Client Terminal 使用单一 derived-child API，在 request 最终 cwd/env 生效后解析 bare/relative command；
  Windows 派生 `.cmd/.bat` 继续进入 CommandShim identity 与原子 Job 链。
- [x] `agent_settled` 唯一成功终点、assistant snapshot 去重、Missing-Send gate、Cancellation Settlement v2 与迟到
  epoch/binding fence。
- [x] Activity v2、terminal write/edit path、Pi assistant model-call Usage、稀疏 cache/cost 与 source digest 去重。
- [x] 三 shipped platform 均显式 `preview`：开放 discovery、检查、队员选择、Diagnostics 与 AgentRun 供主动测试，
  同时保留 `qualification_evidence_missing`、空 evidence revision 和实验性 UI disclosure；release 不使用本地 override。
- [x] 活动 Tool 组在底部执行台、Inspector 与局域网只读执行台优先展示已有公开证据中的具体当前指令；
  稳定 Tool 行、渠道卡片、Activity 分类及文件/Web typed Evidence 边界保持不变。
- [x] 消息完整 inline-code 文件候选通过 Core 来源与 Main `realpath + stat` 证明为现存普通文件后才生成链接；共享资源
  类型定义统一 inline-code 已知类型、会话链接与普通文件 Tab 图标，Main classifier 与不支持类型的系统打开路径不变。
- [x] 不存在通用偏好文件的新 profile 默认关闭世界地图；schema v4 保存值原样保留，schema v1–v3 继续迁移为开启，
  设置页未完成加载时也不短暂显示为开启。
- [x] Renderer 附件展示统一：集中分类、Composer 48px 单排、用户 72px 图片与 46px 文件、Agent 正文后图片区和
  两列文件区；用户图片/文件拥有独立于正文宽度的右锚定工件轨，Runtime 图片并入来源消息，两个主题共用
  组件树并提供十类 artifact token。
- [x] 用户长消息超过 20 个显式文本行后只挂载前 19 行和第 20 行静态省略号，不提供展开/收起交互；待发送
  队列编辑器仅保留取消与保存，不复制执行中的停止按钮。

## 已取得的本机证据

- [x] Pi 0.84.4 官方配置使用 MiniMax M3 直接请求成功。
- [x] 隔离开发 smoke：Probe 不污染 Session、First Run、Core/Host restart exact resume、warm LRU、allow-once、deny、
  cancel 无延迟文件副作用、公开 locator 隐私与结构化 Usage。
- [x] Pi 0.84.4 真实 Skill 调用；导入、重启恢复、project-owned 同名 shadow 与删除产品流程。
- [x] Pi 0.84.4 真实 workspace Resident：跨 Camp A→B→A exact Session switch、并发 Run 独立 Host、六类 Bash output
  与 Core planned shutdown 后完整 descendant/private Host config 回收。
- [x] Pi 0.84.4 真实 Skill 动态矩阵：update、disable/re-enable、unassign/restore、hard delete、project-owned 同名
  shadow，以及同一 Host 相邻 Session 无旧 catalog/marker 泄漏。
- [x] Pi 0.84.4 真实 Missing-Send zero-send、accepted-send suppression 与原生 Read tool→final；Bash matrix 另覆盖
  多 Tool 后 final。
- [x] Pi 0.84.4 当前 Built-in CLI 15-operation full Run 与 resumed/new-lease Run。
- [x] deterministic tests：A→B→A exact switch、并发独立 Host、receipt 全字段/nonce mismatch、协议重放/迟到、
  Pi dispatch 无 MCP subsystem 依赖、managed extension 无 MCP surface、历史 MCP manifest 忽略、ACP derived command、
  Usage dedupe、cleanup 和 platform matrix；revision 3 另覆盖原生 launch args、零模型 Machine Ready、V2 nonce/
  governed subset、prompt/skill Slash 展开、digest drift、图片 bytes/MIME/order、宽容 Session header 与私有证据。
- [x] Migration 135/136 专项：无 receipt acceptance 拒绝、错 binding 拒绝、合法原子接受、receipt 不可直接改删、父
  Delivery 与 Camp 永久删除可合法 cascade、历史 V1 保留、新 V2 写入、permission migration、FK=0 与 reopen 幂等。

## 发布前仍需关闭

- [ ] 在 macOS arm64 补齐接入 Checklist 的剩余真实 Golden Flow：manual/threshold/overflow compaction、read-only/
  workspace 边界、invalid JSON/crash/timeout、真实 retry/queue late event、idle eviction、packaged planned shutdown 与
  Core crash recovery。
- [ ] macOS arm64 通过后生成 Pi 专属 immutable qualification artifact，并单独审查是否晋升该平台。
- [ ] 在真实 macOS x64 与 Windows x64 分别重复完整矩阵；Windows 额外验证 npm `.cmd/.bat` locator、System32
  interpreter、resolved target、fingerprint 与执行期 identity。
- [ ] 只有精确平台证据完成后才把对应 Pi Admission 从 `preview` 改为 `qualified`；不得从本机 smoke 或其他 Runtime
  evidence 外推，Preview 的可运行性也不替代该证据。

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
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
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

## Pi 三平台实验性开放验证（2026-09-03）

- Runtime Platform Admission 矩阵断言 Pi 在 macOS arm64、macOS x64、Windows x64 均为 `preview`，
  `allows_runtime_use=true`、`is_qualified=false`、`evidenceRevision=null`；Cursor 继续被阻断。
- Core 定向测试证明 Pi 进入 discovery/Diagnostics/Dispatch 且没有平台 blocker；Renderer 182 项定向测试证明
  Runtime 检查、队员 selector 与 onboarding 接受 Preview，并显示实验性 disclosure。
- `pnpm check:rust`、Rust lib 484 项、CLI 32 项、Core 208 项通过，5 项 manual Runtime smoke 按设计忽略；
  `pnpm typecheck` 通过。
- `pnpm test`：140 个 Vitest 文件、1477 项测试通过，后续 Node suites 220 项通过、1 项 Windows-only skip；
  `pnpm build:desktop` 通过。
- `pnpm docs:test`、`pnpm docs:check` 与
  `DOCS_BASE_REF=5cfbce5ff8d734fb84b46fddacd91d011898cf85 pnpm docs:check:ci` 通过；Impeccable
  changed-target detector 无发现。

## 附件分区展示验证（2026-09-03）

- `pnpm typecheck`：通过；
- `pnpm test`：141 个 Vitest 文件、1490 项测试通过，后续 Node suites 220 项通过、1 项平台条件跳过；
- `pnpm build:desktop`：Main、Preload 与 Renderer production build 通过；
- production `runtime-image-gallery` fixture：Day/Night、1040/1440/2560 三档窗口、Agent 原比例图片区、
  用户 72px 方形预览、键盘焦点与 Lightbox 验证通过；
- production `camp-open-projection` fixture：用户/Agent/Composer 三种附件样式、Agent 十类文件、
  560px 阈值下两列/一列切换、48px 单排滚动、方向键/Home/End、鼠标滚轮横移及无页面横向溢出验证通过；
- `pnpm docs:test`、`pnpm docs:check`、
  `DOCS_BASE_REF=5cfbce5ff8d734fb84b46fddacd91d011898cf85 pnpm docs:check:ci`：通过。

## 用户消息布局与队列编辑验证（2026-09-04）

- 定向 red/green：用户长消息静态截断、20 行边界、附件 CSS 轨道和待发送编辑动作共 3 个 Vitest 文件、
  47 项测试通过；`pnpm typecheck` 通过。
- `pnpm test`：146 个 Vitest 文件、1534 项测试通过，后续 Node suites 220 项通过、1 项 Windows-only skip；
  `pnpm build:desktop` 通过。
- production `camp-open-projection` fixture 使用短正文证明附件宽度不受消息长度约束：1200px 下正文 78px、
  附件轨 748px，左侧与队员头像轨道同位，右侧与正文同轴并距用户头像 10px；1040×700、1440×920、
  Day/Night 与 200% zoom 均无页面横向溢出，截图已人工核对。
- 当前宿主的 Chromium sandbox 在进入业务断言前拒绝初始化；夹具按已有受控回退
  `ROVAI_CAMP_OPEN_ACCEPT_NO_SANDBOX=1` 重跑后全部业务断言通过，未启动 Core、SQLite、Skill Library 或 Runtime。
- `docs/prototypes/conversation-user-message-layout/preview.png` 已从更新后的 HTML 重新生成，静态省略号无 hover、
  展开或收起控件。
- `pnpm docs:test`、`pnpm docs:check` 与
  `DOCS_BASE_REF=934aa6f6f4b66919a6daced1c1a537c997507120 pnpm docs:check:ci`：通过。
