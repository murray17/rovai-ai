---
document_type: implementation-plan
version: v1.57
lifecycle: current
status: in-progress
last_updated: 2026-09-11
---

# 官方 ZCode 实施与验收

官方 Runtime Adapter 已实现并经过真实 Core 验证；当前 Windows x64 / macOS arm64 Qualified、macOS x64 可执行 Preview，
完整 First-Class 资格仍未完成。[接入矩阵](../../research/zcode-runtime.md)逐项描述用户可观察差异；
[D02](decisions.md#v1-57-d02)明确逐平台发布资格与完整能力边界。

## 原 macOS 接入 Worktree 记录

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-zcode-runtime`
- Branch：`codex/zcode-runtime`
- 原始 Base：`23c002585f9a6840e82294b6d9e93667f7386118`；提交前已合并主线 `2ec2adff`（v0.2.2、v1.56 引用合同）。
- Governance：无先行主线治理提交；版本、合同和实现同一 PR 评审。
- Status：原接入已由 [PR #323](https://github.com/murray17/rovai-ai/pull/323) 合入，后续 v7 独立记录；First-Class 组合资格尚未闭合。
- 主 checkout 的并行文档改动不属于本任务；worktree 在 review/CI 期间保留。

## 已实现

- 官方 bundle 发现与 App/cjs/独立 Node composite fingerprint；统一无 GUI 启动；私有短 socket root。
- 复用 AcpHost/Fleet，Camp 内多成员 exact Session 切换、并发独立 Host；原生配置、mode、MCP 变化 fence。
- 原生 NDJSON 的 Session/Input/Turn/Tool correlation、accepted-input、前台终态与独立后台归属；未知回调拒绝。
- user FirstPayload、completed Compaction observer、标准审批、原生 Skills 与 additive MCP。
- narration/reasoning 隔离、Missing-Send、bundled CLI lease、稀疏 Usage、Read/Write/Edit 与 path-bound patch。
- 原生 detached Bash 的 pipe-owned cleanup companion；官方内核原样加载，Core/原生强杀后回收已记录的进程组。
- Migration 149 与 schema 99 的 Runtime/Skill/Compaction 闭集；目录、成员参数、安装导航、监控和活动统一呈现。

## 能力轴与验证状态

以下 `Verified + Implemented` 只适用于列出的行为及官方 App 3.11.2 / kernel 0.16.5 / Node 26.8.1 / macOS arm64。
未覆盖的组合场景仍单独记录，不能据此推导整轴 First-Class 或其他版本、平台通过。

| 能力轴 | Runtime / Rovai | 已通过行为与证据 |
| --- | --- | --- |
| Auth / Provider / Model | Verified / Implemented | 官方 MiniMax BYOK，native default 与显式模型；秘密只读自官方配置 |
| Host / Fleet / LRU | Verified / Implemented | Camp 内 A→B→A、并发独立 Host、配置变更、普通 shutdown；实际 Core 与原生 Host SIGKILL 后无残留/延迟写入 |
| Session / Continuation | Verified / Implemented | warm exact switch、Core cold resume、零历史动作/审批重放；无效 ID 一次 continuity loss 后唯一替代 Session |
| Bootstrap / Context | Verified / Implemented | FirstPayload、Session 标签不串线、warm/cold 恢复；用户已接受 user 注入与重投策略 |
| Compaction | Verified / Implemented，组合资格未全闭合 | 真实 Core manual/threshold auto/overflow reactive 完成与补发；auto compact 后 Core 重启恢复同一 Session 和补发；fail/cancel 另有原始协议与 parser 证据 |
| Skills | Verified / Implemented | 真实调用、更新、禁用/重新启用、取消分配/删除、项目冲突、重启恢复 |
| External MCP | Verified / Implemented | stdio/HTTP、native + assigned 同名优先、更新/取消分配/重分配/删除、相邻成员隔离 |
| Tool / Action / Output | Verified / Implemented | 六种命令输出、131100 字节 blob；Read/Write/空文件/Edit Diff 的实时与历史事实 |
| Narration / Final / Missing-Send | Verified / Implemented | 私有 reasoning、成功 terminal；zero-send、accepted-send suppression、tool→final |
| Permission / Cancel | Verified / Implemented | build allow/deny、plan 无写入、cancelled；等待 35 秒无延迟文件 |
| Built-in rovai CLI | Verified / Implemented | 当前完整 operation 集、Gather 返回、后续 Run、旧 lease 失效 |
| Usage / Cache / Cost | Verified / Implemented，组合资格未全闭合 | provider Turn input/output/cacheRead；其他字段 NULL；稀疏字段 parser 与实际持久化 |
| Retry / Queue / Cleanup | Verified / Implemented，组合资格未全闭合 | V4 accepted 输入、单终态、后台存活与前台完成分离、取消、Core/原生强杀；共享队列/epoch 回归 |
| Ready / Version / Platform | Verified / Implemented，完整组合资格未闭合 | 官方 identity、独立 Node、无模型调用 Probe；v3–v6 阶段为 arm64 Preview，v7 平台晋升另见下文 |

## 真实 Golden Flows

全部通过独立 Home、Core data、Skill Library 和测试项目执行。测试密钥来自用户授权的临时复制，生产实现不借用其他 Runtime 配置。
[脱敏证据清单](evidence/zcode-macos-arm64-2026-09-10.json)保存版本、内核 SHA、日志摘要 SHA 和有限 identity；不提交密钥、原始协议、Prompt 或个人路径。

| Owner | 结果 |
| --- | --- |
| `smoke-acp-runtime.mjs`（ZCode） | 文件/空文件/Edit Diff、六种命令输出、manual compact、审批/取消通过 |
| `smoke-trae-cold-resume.mjs`（ZCode selector） | exact resume、无历史重放、写入、取消、无效 Session 唯一 fallback 通过；最新 Node companion 复验通过 |
| `smoke-builtin-cli.mjs`（ZCode selector） | 完整共享业务操作、Gather、后续 lease 与失效旧 lease 通过 |
| `smoke-missing-send-recovery.mjs`（ZCode selector） | 三种发布边界通过 |
| `smoke-skills.mjs`（ZCode selector） | 全部 capability 生命周期与项目保护通过 |
| `smoke-mcp-projection.mjs`（ZCode selector） | stdio/HTTP、native 同名与 assignment 生命周期/相邻隔离通过 |
| `smoke-zcode-runtime.mjs` | A→B→A、并发、配置 fence、plan、shutdown 通过；Core/原生 Host 分别强杀、15 秒内回收及 35 秒后无文件通过 |
| `smoke-zcode-context.py auto` | 真实模型 36k threshold compact，Core observation 与下一请求补发通过 |
| `smoke-zcode-context.py reactive` | 本机代理注入一次 provider overflow，官方内核真实 compact/retry 与下一请求补发通过 |
| `smoke-zcode-context.py auto` + `ROVAI_ZCODE_CONTEXT_COLD_RESUME=1` | compact 后重启 Core，exact Session、原标签、revision 1 requested/acknowledged/accepted 通过 |
| `smoke-zcode-launch.swift` | 权限、Fleet、冷恢复、压缩后重启、两种强杀的所有被观察产品流程中新 ZCode App 注册数为 0 |

合并主线后的 v0.2.2 / v1.57 构建已重新通过文件矩阵和完整 Fleet 流程，App 注册观察为 0。
功能流早于最终进程回收 prelude 的证据与 v3 复验分开标记；不能声称每条历史功能流都运行在最终启动器上。
原始协议研究只用于说明上游字段和行为，不能替代上述 Core 产品路径。

## PR #323 原生环境与后台生命周期修订

基于 `9036378`，只调整 ZCode；不改变 Kimi/Kiro/Grok 的 HOME 或运行规则，不做全局 HOME 隔离重构。
bridge revision 为 v4。普通 Probe 沿用用户原生 HOME/存储，不发送生成请求；临时 cwd/socket 可清理。
前台完成后后台任务通过原始 task/Session/Turn/Tool 归属继续受管。Fleet 的空闲/容量回收和跨成员复用排除有后台任务的 Host，
原 Session 可续接，CLI lease 正常失效。取消与关闭分开，companion 对 closed-shell 后代保留回收责任。
ZCode 请求入口固定内部 CLI context，并沿 Node 异步链传递；子进程不会读取后来重绑给其他 Run 的 Host lease。
无请求归属的命令获得空 lease。这些私有快照随 Host 清理，不属于原生 BYOK/Home 复制，普通 Probe 不启用。

本次 v4 已完成完整 Rust 回归（Library 550 / CLI 33 / slow 309；Core 236 passed、5 个既有 ignored）、
Clippy warnings-as-errors、TypeScript、完整 `pnpm test`（1717 Vitest；末段 Node 224 passed、1 个平台 skip）与通用文档 CI。
最终代码还通过定向 Evidence fencing、ZCode parser、Fleet pin/优先续接、Probe 能力声明和 compatibility digest 复核。
Desktop 构建与其余历史 Golden Flows 本次未全量重跑，不能把下方 v3 基线改称 v4 实测。

- 真实文件矩阵：Read、Write、Edit、空文件、实时/历史投影均通过；真实 Edit +1/-1，Read 无 Files Changed。
- 真实后台模型验收由 `smoke-zcode-background.mjs` 单独拥有：原生环境一致、无生成 Probe、前台完成、跨成员隔离、
  原 Host/Session 优先续接、当前后台任务取消且旧服务继续、晚到失败原 Run 持久化、关闭记录与组清理。
  长时验收已通过：前台 15.453 秒完成，之后继续保留服务 310 秒；结果与日志摘要保存在版本 Evidence 的 `v4Revision`。
  最终 CLI 修订另以 10 秒保留参数重跑同一流程：旧后台 CLI 在新 Run 活跃时被拒绝，新 Run CLI 可用；
  两个原生自动通知轮次均观察到精确取消终态，无新增工具执行。该补测不替代此前 310 秒长时证据。
- 官方会启动没有 Rovai Input 的自动结果通知轮次。当前框架没有为其创建新 Run 的授权来源；按结构化
  `inputSource=background_task` 与 `foregroundExecutionId` 请求停止并保留诊断，未把它作为自动新 Run 能力接入。
  原任务退出结果仍按原身份落盘；未确认原生前台空闲前保留 Host 归属。
- 新增测试 owner：Fleet 的后台 pin/容量/TTL/原成员优先续接，没有等价旧 owner，Fake 状态足以验证其生命周期；
  `cargo test -p rovai-core --bin rovai-core zcode_` 同时验证 ZCode 专属“基础检查不冒充高级实测”的 Probe 语义。
  原生事件关联与跨轮迟到结果扩展既有 parser；取消 fencing/已结束 epoch 归属和 Action 终态门禁扩展既有数据库测试，
  不新增另一份完整数据库 fixture。取消后的观察不授予业务操作权限。
- `pnpm test:zcode-owner` 拥有真实进程组边界：shell close 后后代存活，Host 关闭后回收，独立进程不受影响。
  该边界不能由 PID/mock 或 parser 测试替代，已经接入默认 Node 回归。删除已退出组记录避免永久持有 PID。
  同一 owner 还验证请求异步链中的迟启动子进程保留原 lease、快照权限为 0600，以及无请求归属的命令不获取 Host 当前授权。
- 未覆盖：未安装更高 kernel 做真实升级验收；未重跑 v4 Core SIGKILL 与所有压缩/能力组合；未验证 x64/Windows。
  原生后台子代理完整模型/权限组合尚未做真实验收；延迟命令的异步授权边界由 OS 子进程回归覆盖。
  原生缺失的后台 exitCode 仍未知；不声称可回收自行逃逸到未登记组的任意后代。实际模型测试继续使用隔离目录与授权凭据。

## 本地回归（9036378 基线）

- `pnpm test:rust:pr`：合并主线后完整通过；library 550 passed，CLI 33 passed，slow 309 passed。
- Rust Core binary：合并主线后 234 passed，5 个既有 ignored。
- 没有禁用或删除测试；原有 Runtime 闭集期望遗漏已修正，并在合并后的完整 slow 门禁通过。
- `cargo clippy --workspace --all-targets -- -D warnings`：合并主线后通过。
- `pnpm typecheck`、`pnpm build:desktop`：通过；构建未启动日常 App。
- `pnpm test`：通过；Vitest 168 files / 1717 tests，末段 Node tests 223 passed / 1 个既有平台 skip，文档与 Skills 检查通过。
- 通用文档 CI 门禁与最终 compatibility source SHA 绑定：合并主线后通过。

新增 Rust 测试按最窄已有 owner 分配：原生事件关联/拒绝终态、结构化 hunk、原生配置/MCP precedence、
有界且绑定 Session/Tool 的输出 artifact；Migration 使用独立升级 owner。Shared Fleet、Usage、closed catalog 等扩展已有测试。
原生强杀遗漏 detached 组先实际复现（延迟文件出现），再由真实 Core/原生强杀复验修复；没有用 parser 成功替代进程回收。

## v7：Windows x64 / macOS x64 接入计划

用户要求两端同时可选择、配置并执行 ZCode。基线为 `1bf382a5`；最近的生产实现是本版本的
macOS arm64 ZCode Preview，不借用其他 Runtime 的平台资格。用户追加要求：Windows 验收通过后与
macOS arm64 一同标记 Qualified，各自绑定平台证据；macOS x64 同时开放，不把 Windows 结果记成 Intel Mac
真机验证。管理页仅显示版本与真实机器状态，去掉测试、试运行和实验性标签。当前实施阶段仍先用 Preview
完成 Windows 真实验证，尚未通过的流程不能作为资格证据。

| 能力轴 | 接入策略与本次验证范围 | 当前证据状态 |
| --- | --- | --- |
| Auth / Provider / Model | 复用官方终端/App 配置与原生模型目录，不新增凭据入口 | Windows 原生 BYOK 已验证，Core 待验；Intel Mac 待验 |
| Host / Fleet / LRU | 复用既有 ZCode Fleet；Windows 以原子 Job 管理全部后代，macOS 保留组 companion | Windows 实现/回收待验；Intel Mac 复用 Unix 路径，待真机 |
| Native Session / Continuation | 同一 exact Session 与原生 transport；暖续接和冷恢复分别验证 | Windows 原生 exact resume 已验证，Core 待验 |
| Bootstrap / Context | 不改变已确认 FirstPayload 或 Context 合同 | 复用当前实现，跨平台 Core 待验 |
| Compaction continuity | 复用现有 completed observation 与下一 eligible input 补发 | 不新增能力声明，组合验收仍未冻结 |
| Skills | 保留 zcode delivery group 与原生项目发现 | Core 跨平台投影待验 |
| External MCP | 复用 assigned/native union；Windows 原生 cwd launcher 不使用 /bin/sh | 适配及参数、路径、生命周期待验 |
| Tool / Action / Command Output | 原生事件映射不变；修正 Windows 路径 fixture，核验真实文件与命令 Evidence | Windows 原生读写/输出/退出码/超时已验证，Core 待验 |
| Narration / Final / Missing-Send | 保留唯一原生成功边界和公开 send 抑制 | Core 跨平台待验 |
| Permission / Approval / Workspace | 原生模式、审批与普通阻断不变 | 原生 Plan 仅模型遵守，不能代替强制权限验证 |
| Built-in rovai CLI | 复用 Run/epoch lease；Windows prelude 保留异步 context 冻结 | Windows Core 真实 CLI 待验 |
| Usage / Cache / Cost | 沿用已有 provider Turn 稀疏字段，不推导未知值 | Windows 原生 usage 可见，Core 待验 |
| Retry / Queue / Cancel / Cleanup | Windows 不发送 Unix 负 PID；通过 Job 空集证明清理，不把 kill 或根进程退出当证明 | 实现及真实后代/取消/关闭待验 |
| Ready / Version / Platform | 官方 Windows EXE/资源与两种 Mac bundle；独立 Node 纳入复合身份；私有临时目录 | 布局/完整性/准入回归与 Windows 真机待验，Intel Mac 未实测 |

本段是实施前 Parity Matrix。完成后在同段追加实际结果，不用先前原生独立测试冒充 Rovai Camp 通过。
不升级 First-Class、不改变 Schema/Context，不静默降低其他 Runtime 的安全边界。

### v7 实际结果（2026-09-11）

- Windows x64 与 macOS arm64 已分别冻结 [Windows 证据](../../../qualification/runtime-platform/windows-x64-zcode-v1.json)
  和 [arm64 证据](../../../qualification/runtime-platform/macos-arm64-zcode-v1.json)，Core 两行标记 Qualified。
  arm64 使用目标主机已有 v3–v6 记录和维护者发布批准，本轮未重跑 Mac；macOS x64 为可执行 Preview，未宣称真机通过。
- Windows 官方 App 3.11.2 / kernel 0.16.5 / Node 24.19.0 / MiniMax-M2.5 经真实 App CLI 完成配置、Camp 投递、
  Read/Write/Edit/空文件、六类命令输出、原样 exit 7、未截断大输出、warm/cold exact Session、CLI 公开消息、Usage、
  原生后台任务观察、取消与受控退出。131129 字节完整输出及 blob hash 独立核对；取消后等待 40 秒无延迟文件。
- 修复两项真实失败并重跑原路径：Node CommonJS 无法加载 Win32 verbatim module path；Session 协议 cwd 与
  canonical cwd 比较不一致。Windows Job 回收使用 ActiveProcesses=0，非根 PID/kill 请求推断。
- 管理页和 Onboarding 保留版本、真实机器状态与错误，不显示测试、试运行、实验性标签；不改变 Core 准入与普通阻断。
- 本机日常安装版另经显式备份、Release 构建和安装验证；真实 Camp 约 35 秒完成小狗年龄 3→4、原生 Read/Edit/Write、
  stdout/stderr/empty/delay/独立 exit 7，32 条 Evidence，业务 `rovai send` 消息已持久化。该记录不替代隔离全矩阵。
- Windows MCP cwd/argv 和异步 CLI lease 真实进程回归、ZCode 6 项 Library、平台准入 5 项、ManagedProcess 14 项
  （7 个既有 helper ignored）、3 个 Renderer 测试文件 202 项通过；类型检查、Windows Release 打包验证及设置页布局检查通过。
- 完整 Windows 回归并非全绿：10 项 file-preview 失败已在未修改 main 重现；Rust path-projection 失败也有 main 对照，
  完整 Rust suite 中另有 authority/ACL fixture 失败且长任务被中断，不声称全部为已证明的基线问题，也未禁用或删除测试。
- Compaction/Skills/完整 MCP assignment/权限及升级漂移的 Windows 组合未全量重跑，账号/GUI 缺口保持前述边界。
  工作分支 `codex/zcode-windows-macos-x64` 基于 `1bf382a5`，合并前同步新的 origin/main 并重新运行提交门禁。

## First-Class 前仍需冻结的资格

- 在完整 Core 流程中联合验证 compact fail/cancel 与 Skills/MCP/权限保留；当前失败/取消证据来自原始协议与 parser，成功及 cold-after-compact 已有 Core 证据。
- provider Usage 在多次 retry、compaction、resume 组合中的无重复归属，以及 MCP mutation 的审批/取消网络副作用，补充逐流真实证据。
- Adapter 专属协议损坏、Probe timeout、idle eviction 和版本/Node 升级 drift 组合；现有共享安全回归不能替代该官方版本的全部真实流程。
- macOS x64 尚无目标主机资格；Windows 已有 v7 平台证据，但未运行的高级组合不得借用 arm64 功能流补记为通过。

GUI/Computer Use 回调为 NotImplemented。账号登录与 BYOK 都在范围内；图片沿用现有附件路径，经原生 Read 看图，不能因没有结构化 Prompt 图片而标为不支持。
不把这些限制声明为上游 Unsupported，不把 Preview 或代码可评审等同于正式第一版接入完成。


## v5：账号范围与图片能力纠正

- 原生终端账号登录生成的 Z.ai／BigModel 配置与 BYOK 共用模型解析，普通 Probe 改为记录
  `zcode.native_configuration`，不把配置加载表述为仅 BYOK。缺少配置时提供官方 `/login` 指引。
- App-only `.zcode/v2` 登录态尚不能直接替代终端配置；真实 OAuth 登录/订阅余额未验收。
- 按用户要求，图片和其他 Runtime 一样投递授权文件路径，由 ZCode 原生 Read 读取/处理并给模型。
  保留官方模型 `supportsImages` 配置；不预上传，不改变共享 Runtime、ContextManifest 或 schema 99。
- 图片上传方案已撤回。其临时协议/迁移测试不作为本次交付证据，不把它们的结果算到路径方式。
- `scripts/smoke-zcode-images.mjs` 用普通 Camp 附件投递两张随机数字图片，证明原生 Read、实际视觉理解、
  Read 不形成 Files Changed、无 attachment upload 和原 Session 冷恢复；MiniMax-M3 实测通过，GUI 注册数为 0。
- 首轮点阵字体造成一个数字误读，答案断言失败；换成系统字体后按原准确性断言通过。失败记录与撤回的
  上传方案测试均不冒充最终通过证据。未覆盖真实 OAuth/订阅、App-only 登录复用、所有图片格式/尺寸和其他平台。
- 最终路径实现验证：ZCode Library 5 项、普通 Probe 1 项、平台准入 5 项通过；Vitest 1717 项、
  末段 Node 224 项通过（保留 1 项平台 skip）；Clippy、格式与通用文档 CI 通过。最终差异未重跑全部 Rust slow 套件，
  不沿用已撤回方案的测试数量。隔离凭据、原生 Home/历史已清理，14 个改动文件和 17 份本轮日志的密钥匹配为 0。

## v6：App 账号验收与失败修正

App-only 配置加载已补齐，真实 Start Plan 生成遇到上游 `captcha verify failed`（3007），当时暂停了
合并与安装。用户随后确认其为免费账号，并要求即使缺少真实订阅测试，也按 zcode-acp 的接法先交付。
本次以个人 Coding Plan 原生凭据透传、Start Plan 回调明确拒绝的边界收口；保留未覆盖标记，继续此前
授权的 PR 合并和 App 打包安装。该范围确认不把免费账号调用或缺少凭据的订阅验收记为通过。

- 终端配置优先，缺失时只读 App config 和 family 模式/选择，完整目录经官方内存 registry RPC 加载。
  普通 Probe 沿用用户原生环境；真实模型验收单独使用隔离凭据副本、HOME、存储、Core 和 Skill Library。
- App 的 Start Plan 请求另需 Renderer 临时人机验证头；不解密凭据，不提取验证码结果，不启动 GUI。
  Coding Plan/Team Plan、账号刷新及账号图片生成仍未完成真实验收，不能把 Basic Ready 当作生成成功。
- 修复 `turn.failed` 后 `projection.status=error` 被误判未收敛的问题，保留前台工具/审批/请求门禁。
  失败仅映射固定脱敏提示；业务失败不污染 Host，不触碰原后台任务归属及 Run CLI lease。
- 扩展已有配置 owner，覆盖 App/CLI 优先级、原生自定义目录、OAuth/API Key family、禁用模型、轮换和目录脱敏。
  独立 transport 回归拥有 reader/settler/request 并发 seam：修复前 Core 在约 3 秒后只见断线；修复后收到鉴权失败，
  Host 可继续处理请求。它无真实进程、文件或 DB，纯 event owner 无法覆盖此跨 worker 终态丢失。
  最小命令：`cargo test -p rovai-core --lib zcode::`。
- 新增显式 `scripts/smoke-zcode-account.mjs`。默认模式要求真实随机 nonce；`--expect-auth-failure` 单独验证
  错误码、不可重试、无 Final 和关闭 Core，仅是失败路径证据。用 `smoke-zcode-launch.swift` 观察 GUI 注册数。
- main 已同步至 0.2.3；Schema 99/Migration 149 与上下文合同不变。v3/v4/v5 实测仍保留各自版本阶段，
  不冒充本轮重新执行。实际门禁、账号失败与清理结果集中记录在 [v6 证据](evidence/zcode-macos-arm64-2026-09-10.json)。
- zcode-acp 对照收口复用既有配置 owner，增加 Z.ai/BigModel App 个人 Coding Plan case：`id.secret`
  原样交给内核签名、不擅加 Start Plan Bearer、目录脱敏、原生显式套餐选择和 entitlement 禁用均保留。
  不新增测试函数或真实凭据夹具；现有 transport owner 继续验证验证头拒绝、失败终态与 Host 可复用。
  错误提示明确限定为当前 Rovai Host 的验证能力，并指向官方 App 或原生 Coding Plan/API Key 配置。

### ACP 边界收尾验证

最终 Rust PR gate 为 Library 551 / CLI 33 / slow 309，通过 Clippy all-targets、格式、类型与文档门禁；
Vitest 1724（169 files）、Node 224 通过，保留 1 项既有平台 skip。首次完整 Rust 运行有一个既有 MCP
本机 HTTP 测试报 `IncompleteMessage`；该项单独复验及完整 PR gate 重跑均通过，没有修改或跳过测试，
未确定偶发中断根因。首次失败和最终成功日志分别保留，失败测试的合成凭据夹具已清理。

`package:mac:daily` 的 App/Core/CLI arm64 架构及 ad-hoc 签名通过。隔离 packaged App 启动、Core ready、
ZCode Installation 存在及独立 data/Skill Library/MCP 检查通过，无模型请求。首次清理脚本未显式声明
非默认临时根而被保护检查拒绝；修正调用参数后清理原夹具，并重跑启动与清理通过，不涉及产品代码改动。
以上是 Preview 交付检查，不能替代未执行的个人 Coding Plan 真实订阅验收。
