---
document_type: implementation-record
version: v1.72
status: complete
authority: implementation-evidence
last_updated: 2026-11-10
---

# Kilo 接入简化

User sequence 48 的三项收敛，基线为 `83a853ee8f854ae19e70559c12e5297b09218a7b`，
沿用独立 worktree 与 `rovai/kilo-acp` 分支。当前合同为
[Launch v83](../../contracts/runtime-launch-and-verification-v83.md)及
[Accepted Input Recovery v9](../../contracts/accepted-input-recovery-v9.md)，取舍见 [D81](decisions.md#v1-72-d81)。

## 基线差异

| 范围 | 基线 | 本次结果 |
| --- | --- | --- |
| MCP 保存 | 主动退役受影响 Kilo Host | 只保存，下一 Run 既有兼容性决定复用或替换；Command Code 保持 |
| 权限 | 产品 allow/ask/deny、默认 allow、config Hook、强制 pure=false | 无产品档位，继承原生权限与 pure/用户插件，只转交原生审批 |
| 普通取消 | Kilo 专属等待，最后仍停止 Host | 共享 ACP 有界确认，满足 Fleet 检查则 Warm；不明、超时或异常回收 |
| cleanup 证明 | ACP 物理回收为主，Codex 留存回收回执 | 原回执明确保留 Reusable 或 Reaped，成功 durable ACK 后消费 |

模型/effort、Bootstrap、自动压缩、Skills、文件 Diff、前台子代理、用量及 bundled MCP cwd 均沿原入口，
不新增架构、数据库字段或迁移。B/P、Formatter、Manifest、Input Delivery Evidence 版本保持。

## 删除的特例

- 移除 MCP 保存路径的 Kilo 主动 invalidation，只保留 Command Code。
- 删除 `kilo/config.mjs`、生成/写入/plugin 注入及执行 permission 参数；不再设置 KILO_PURE。
- 删除 Kilo 产品权限选项与默认值，界面改为“沿用 Kilo 原生权限”。
- 删除 cancel_until 仅等待 Kilo 的分支，常驻 ACP 共用关联终态与 pending 请求检查。

旧成员仅对 Kilo 的退役 permission 键兼容，保存资料不被改写；新冻结执行配置省略该键。
旧缓存仍把 permission 列为 required 时同样忽略这一项，不恢复产品档位；其他 Runtime 的 required 不变。
未知其他键、非对象 values 及 schema 校验保持。原生规则、用户 plugin 和 instructions 的顺序保留。
独立问卷/后台子代理环境开关保留，未以权限插件代替它们。

## 共享入口变动

Core 使用原来的绝对阶段期限：2 秒 interrupt、2.5 秒 flush、非 Windows 3 秒/Windows 5 秒总预算。
ACP 等待原始和已提交 Steer RPC 全部结束，已关联的 end_turn/cancelled 才支持复用；错误、断连或未知结果不通过。
阶段失败在 flush 前即标记退役，迟到结果不能重新 Warm。
已业务取消的 Run 不再由正常终态回调抢先解绑，保留结果供取消 cleanup 读取，避免丢失 route 的竞争。

原 Fleet 清理回执集合保存实际 release outcome，Reusable 只确认旧 Run 的隔离，Reaped 才确认进程退出。
Core 复用释放成功即返回，避免随后 generic stop 杀掉 successor；ACK 之后才消费回执。
存活 Host 的 owner record、Bootstrap 和临时目录保留。下一 Run 使用独立 Run/epoch、新 CLI lease 和完整冻结 Bootstrap。
同 Run 的 epoch 递增由受控测试验证；不同 Run 的 epoch 数值可以同为 1，不把它误报成全局递增。

普通用户 Stop/Turn Stop 才选择 Reusable；shutdown、移除、禁用、配置不兼容、显式退役仍走停止。
ZCode 专用 cancel fence、Hermes Gateway 所有权和 Claude/Codex/Pi 生命周期保持。

## 测试结果

| 检查 | 结果 |
| --- | --- |
| `cargo test --workspace` | 484 passed、1 ignored |
| 共享 cleanup 原 owner | Kilo/OpenCode 快速、1.75 秒、超时、不回包、断连、原生错误、未知、显式停止；确认取消 Warm，其他回收；旧 epoch cleanup 不杀后继 |
| 原 active-input receipt owner | 两种终态顺序、多个已提交请求、取消、拒绝、unknown；cancelled 不能掩盖更晚真实错误 |
| 原 client-terminal owner | 已建终端停止、迟到 create 拒绝；原生不回终态保持取消未确认 |
| Fleet、ZCode、Hermes 定向 | Fleet 23、ZCode 13、Hermes 4 项通过，保留原所有权边界 |
| 权限/配置 owners | 空默认、旧字段及缓存 required 窄兼容、其他键/Runtime required 仍校验；有序 instructions、不改插件/pure/native permission |
| `TZ=UTC pnpm test` | Vitest 3,193 passed/2 skipped，Node 377 passed/2 skipped，文档与 Skills 门禁通过 |
| 类型/构建 | `pnpm typecheck`、`pnpm build:desktop` 通过 |
| 实际 Electron 选择器 | 原 runtime-model-picker 脚本通过，独立 userData；Kilo 原生权限说明、模型/effort 两入口保持 |
| 通用文档门禁 | `pnpm docs:test`、`pnpm docs:check`、带 integration base 的 `docs:check:ci` |

没有新增 Rust 测试函数；扩展既有 owner，原无 handle、迟到启动、受控延迟和取消失败断言继续保留。
完整归属及最小命令见[开发验证](../../development/testing.md#kilo-官方-acp-验证归属)。

## 真实证据

使用官方 Kilo 7.8.27（源码 `03a6f07d053cd7e6aa88fa1e258e93510335259f`）、生产 Core/CLI 与本地受控 Provider。
所有 dataDir、userData、Skills、MCP、HOME/XDG 与工作目录在 owned 临时根目录，未使用日常 App 数据。

Core fixture `rovai-kilo-simplify-accept-41u1t04g` 完成 **40 个 Run：37 succeeded、3 cancelled**：

- MCP 保存时原连接继续驻留；未执行的 A→B→A 复用原 A，真实执行的 A→B→A 使用各自配置并回收旧进程；忙时保存仍完成旧配置。禁用/删除下一轮不再收到工具，替换保持原 native Session。
- 旧成员保存 deny 仍可读且可修改模型/环境，新 40 个冻结配置全部为 Kilo permissions `values={}`；原生 allow/ask/deny、具体规则与批准/拒绝均实跑。用户插件在原生 pure=false 时执行，pure=true 时不执行；没有 Rovai config Hook，所有模型工具集合均没有 question。
- 普通取消及带 1/3 条用户插话的取消，后继均为同 Host `babbec08-04f6-4965-9ec3-3bbbd4be8c3b`、PID `72112`、native Session `ses_e372965ceffeykfnvC6Cb0R5em`；旧 Run cleanup ACK 分别 **60/57/71 ms**，均报告 reusable，没有宣称进程退出。
- 后继 CLI lease generation 分别 **2→3、10→11、12→13**，lease ID 也已改变。旧快照在 Core IPC 明确返回 `builtin_tool.run_not_bound`，CLI 拒绝发送；新租约实际提交公开消息。取消后的延迟 shell 文件效果不存在。
- 三条用户插话遵守现有串行调度：**1 条已提交原生、2 条仍排队**；取消后 3 个来源均结算，未把排队输入重投给后继。此结果不能冒充三条原生并发请求。
- 原生 probe `rovai-kilo-simplify-native-b20007ho` 独立提交 **原始 + 3 条补充**，确认全部实际进入同一 Session 后取消，4 个 RPC **14 ms** 内全部返回 cancelled，同 PID/Session 后继成功。共享 ACP owner 另覆盖多个 pending RPC 的两种终态顺序与错误。
- **65 个普通模型请求**逐字取得当前完整 Bootstrap；后继使用新的 Run/epoch 身份。原自动阈值/overflow/cold、逐模型 effort、相对 write Diff、前台子代理和 7.5 KiB 截断矩阵继续通过。MCP 的不同 cwd 入口在无 PATH Node 环境运行。

白名单机器结果见[证据](../../research/kilo-runtime/simplification-7.8.27-macos-arm64.json)。它不包含原始模型输入、认证上下文或凭据。

保留失败对照，不用最终成功覆盖过程中的发现：

1. 首轮夹具错误地期望环境编辑更新 Warm CLI；按 v68 只在切换权限环境的验收步骤 cold-spawn，生产环境语义未改。
2. 旧租约断言误以为公共 CLI 暴露底层认证错误；保留 CLI 拒绝，同时直接在 owned IPC 核对精确拒绝码，未放宽为“任意错误即通过”。
3. 真实取消曾在约 70 ms 内误走回收：原生终态回调先 detach，取消轮询丢失 route。增加业务终态资格检查，将已取消 Run 的释放交给现有 cleanup；原 owner 加入相同回调竞争，实际重验 Warm 通过。
4. 夹具把三条用户插话当作三条可同时派发的原生 RPC，在第二条等待超时；保持共享串行语义，分别记录 Core 排队与原生多 RPC 两条证据。

## 未验证范围

本轮实测限 macOS arm64。其他平台、所有官方 Provider/真实付费模型、完整 First-Class 矩阵及 Skills 深度资格
不由该批证据推断；当前开放范围见 [Platform Admission](../../contracts/runtime-platform-admission-v2.md#kilo-macos-preview)。
环境修改仍遵循 cold-spawn 语义。日常安装包不重启、不替换。

## 新提交

代码、合同与证据在同一新增提交交付到 `rovai/kilo-acp`；确切 SHA 随 Thread 交付消息发布。
不自动创建 PR，不把当前 Preview 或平台资格提升。

## 后续维护（User sequence 50）

以 `11cf6d326e05b2bace832ee1623f209cecec6acf` 为基线，继续收拢三个小范围维护项：

- 表单直接复用 `runtime-model-presentation.ts` 的 `runtimeEffortOption()`；键、文案及类型只维护一份。
  哪些 Runtime 不显示 effort 控件仍由原表单分支决定，模型选项与冻结历史的语义保持。
- Kilo/MiniMax 的共享目录收集器只在尝试选择其他模型后恢复初始模型；只有初始模型、未尝试切换时零 setter。
  尝试标记在写请求前设置，原生 setter 即使先改变状态再返回错误，也仍会恢复。
- Checklist 3.10 明确无产品权限覆盖时继承原生有效配置；3.13 及阻塞条件区分失管/未隔离执行与合法 IdleWarm。
  Probe timeout、App shutdown 等必须停止的场景仍要求回收。

验证扩展原表单/摘要及 `minimax_check_and_catalog_keep_their_intent_and_complete_options` owners：
保留原 MiniMax 2/8 与 Kilo 3 模型场景，增加两者单模型和 Kilo 全部其他模型选择失败的场景。
没有新增 Rust 测试函数、配置字段、能力生成框架或模型输入变更。当前契约和平台资格保持。

六组受控 Core/ACP 目录场景、44 项表单/摘要定向测试、实际 Electron 两入口、类型检查、桌面构建和通用文档门禁通过；
全量前端 3,195 passed/2 skipped、Node 377 passed/2 skipped。本轮没有重新运行官方 CLI 或付费模型。
首次默认 Rust 回归为 437 passed/1 failed/1 ignored：未改动的
`runtime_probe_process::tests::successful_leader_with_stdio_holding_descendant_finishes_bounded`
报 `runtime_probe_stdout_cleanup_timed_out`；该模块独立复跑 5 项通过，原 500 ms 清理期限与所有断言保持。
第二轮默认并行仍为 437 passed/1 failed/1 ignored，但失败换为未改动的
`managed_process::tests::cancellation_reaps_captured_detached_children_after_parent_exit` 的 3 秒退出确认超时；
该模块独立复跑 5 项通过。两处实现/测试相对本轮基线均无改动，未据此认定根因或调整生产行为、断言和期限。
随后使用 `cargo test --workspace -- --test-threads=4` 完整复跑，484 passed/1 ignored，前述两项均通过。
该结果保留实际运行参数，不将此前默认并行失败改记为通过。

## Apple Intel 开放（User sequence 61）

分支为 `rovai/kilo-acp`，本次基线为 `5831f2d24f123ea55c8fe087619d88c1bfb466b2`。
按维护者请求，将 `kilo-cli × macos-x64` 沿既有 Core Registry 从 NotQualified 改为 Preview，
与 macOS arm64 相同；允许发现、检查、安装配置、成员选择和普通执行，原机器与能力检查继续生效。
reason 保持 qualification_evidence_missing，evidenceRevision 为 null，不新增平台列表或校验机制。

本次只确认准入投影和既有机器门禁，不宣称 Intel 目标机真实模型验收已完成。
Linux/Windows 的目标机资格验收可基于本分支继续，当前两行保持 NotQualified，未借用 macOS 的结果。
当前权威和理由见 [Platform Admission](../../contracts/runtime-platform-admission-v2.md#kilo-macos-preview)与 [D82](decisions.md#v1-72-d82)。

本次本机验证：

- 既有 `runtime_platform_admission::` 测试 owner：5 passed，包含 Kilo 四个平台的开放状态、执行准入和空证据投影。
- `cargo test --workspace -- --test-threads=4`：484 passed、1 ignored、0 failed。
- `cargo fmt --all -- --check`、`git diff --check`、`pnpm docs:test`（10 passed）、`pnpm docs:check` 和
  `DOCS_BASE_REF=958784f6e17fc32d8b2753d7f14fd6122dceea9d pnpm docs:check:ci` 通过。
