---
document_type: runtime-research
runtime: cline-cli
authority: research-evidence-only
status: preview-implementation
last_updated: 2026-10-07
---

# Cline Native Hub 产品接入

User 消息 80（`c023f19a-9f1c-4558-b4d4-1bbab3ddffe9`）授权将 Cline 改为 Native Hub，验证后推送
当前 Mission 分支，并说明与其他 Runtime 的差异。基线 `d9b76dbd`。新 Binding 现在走独立认证的
`cline-hub-v1`；已有 Cline ACP Binding 按持久后端证据保留 `acp-v1`，不自动迁移。
当前只开放 macOS arm64 Preview，未提升 First-Class 或扩大其他平台资格。

## 官方入口与共享边界

本机选中入口仍为 Homebrew `cline/bin/cline` 3.0.3，启动同安装的 arm64 Mach-O；Hub build 0.0.41、
协议 v1。Adapter 调用官方 `cline hub --host 127.0.0.1 --port 0 --pathname /hub --cwd … start`，
由其启动原生 detached daemon。没有安装新版 CLI、导入实验 SDK 或 patch 二进制/node_modules；
最终接入为原生 Provider/settings 创建 Host 私有副本，原生元数据写入也留在副本内。

- 每个 Host 拥有独立私有 discovery/token/config。校验 loopback、路径、协议、文件权限与 kernel
  进程身份后才连接认证 WebSocket；不读取或接管已有用户 Hub。共享 ManagedProcess ledger 记录后代，
  断线、取消和回收仍由共享 Fleet/租约管理。关闭 WebSocket 不等同进程退出。
- member scope 复用按真实 Host 输入判断：安装/模型/权限、workspace、解析后的 MCP definitions、
  Bootstrap 字节摘要和原生配置摘要。Run-local 审计字段不参与兼容摘要。临时配置与持久 Session 历史分开。
- 冻结 Bootstrap B 沿现有 `ContextService` 生成，原样放入原生 Rule；两个 HTML 注释仅保护首尾空白。
  动态 P 仍使用共享 formatter。beforeModel hook 核验完整 B 在 System 恰好一次，所有 hook 返回空控制对象；
  不贡献 compaction implementation、工具目录或另一份 Charter。见 [模型输入变更记录](../../versions/v1.72/model-context-change-cline-native-hub.md)。
- cold 从原生 `session.get/messages` 读取完整 ID 和历史，再原样交给 `session.create(initialMessages,
  sessionConfig.sessionId)`；attach-only 不算恢复。缺历史或 ID 不一致直接失败，不猜测旧输入或跨 ACP 迁移。
- `beforeRun.snapshot.runId` 才承认原生接纳；`run.started` 不作为接纳证据。终态只接受匹配请求的
  `run.start` reply，成功还须已观察到真实模型执行。未知发送结果不重发。Missing-Send 沿共享事务收口，
  Hub candidate 与 ACP candidate 受冻结 protocol 隔离。
- 权限保留原生 act/plan 与 auto_approve；未自动批准的请求进入共享 ActionSafety。文件、命令输出和
  Usage 沿既有证据/监控合同。afterModel 只采 root 模型的稀疏原生数值并核对实际 Provider/model；
  原生 Session totals 与暂定零不作为 Run 用量。

本机 native Bash 会读取用户 `.bashrc` 并重排 PATH，导致裸 `rovai` 可能命中日常旧 CLI。
Host 只在子进程环境导出 `rovai` shell function，转调共享配置已绑定的 `$ROVAI_AGENT_CLI`；
不修改用户 shell 文件、安装或模型输入。真实验收必须由数据库 `source_operation_id` 证明 bundled CLI
确实发送，普通最终文本或 Missing-Send fallback 不算通过。

## Compaction 与版本门槛

读取原生 `compactionEnabled` / `compactionStrategy`。明确关闭保持关闭；basic/agentic 原样传给
`sessionConfig.compaction`；未设置时解析实际所选 CLI help 的默认，本机为 basic。非法类型、未知策略
或无法证明的默认直接拒绝，不能把错误当成未设置。没有 `/compact` 产品命令、自有摘要或自动输入重发。

先前 [同一实际安装的 96 次对照](native-hub-2026-10-07.md)已证明 basic 阈值压缩和同 ID cold，
未传配置与 off 的对照未见压缩。本次产品接线使用同一原生 SessionConfig seam，但不把短流程复验宣称为
产品长上下文/overflow+retry 资格。此安装没有可用的原生 basic compaction 生命周期事件，UI 不伪造开始/完成。

旧 `>=3.0.65` 是 ACP 原有门槛，仍用于冻结 ACP Binding；它不能证明 Hub 能力。新 Hub 不使用版本白名单，
而以实际入口、独立认证和无模型 Session 探测确认 Ready。当前 native provider 配置依赖 BYOK API key；
OAuth/订阅登录尚未覆盖。Ready 不表示 First-Class、凭据永久有效或所有模型均已验证。

## 产品验证与负例

隔离 Core data-dir、Skill Library、MCP、workspace 和原生配置副本；使用已授权的 Cline BYOK，未写日常数据。
脚本 [native_hub_product_probe.mjs](fixtures/native_hub_product_probe.mjs)只用 Core commands 创建成员/发送/审批/取消，
SQL 只读验证回执、Binding、Usage 和文件投影。默认流程覆盖两个成员、first/warm/cold；`--extended` 加入
native add/read/edit、批准、拒绝、执行中取消、延迟副作用排除和后续恢复。
`--lifecycle-only` 单独复验拒绝/取消/恢复，`--extensions-only` 通过 Core 启用并分配真实 stdio MCP、
调用随机回执工具，再让原生 `skills` 读取未放入 Prompt 的 Skill marker。所有流程正常退出后检查
Host temp 已回收，清理自有 Runtime Files Root 和 Provider 副本。最终脚本还逐字节核对配置源未变。

调用形式（所有路径必须为绝对路径，root 必须不存在）：

```sh
node docs/research/cline-runtime/fixtures/native_hub_product_probe.mjs --extended \
  --root /private/tmp/unique-cline-hub-fixture \
  --core /absolute/target/debug/rovai-core \
  --cline /absolute/selected/cline \
  --settings-source /absolute/authorized/native/settings
```

保留失败事实：早期 PATH 探针虽出现终态 marker，却没有实际 builtin send；扩展 SQL 回执断言后不再计为通过。
产品探针 12 原生失败且无完整终态文本；探针 13 第二成员已经实际发送，但原生 result 空文本，按共享合同
收为 `runtime_missing_final_output`。没有合成最终正文或重发原输入。探针 14 四轮完成且 Binding/记忆一致，
但同 Host 断言揭示 Run-local digest 误使暖续接重建 Host，已修复，并保留该断言复验。
探针 15 的原生 apply_patch 未保留请求的末尾 LF，后续 fixture 明确要求无 LF 的准确字节，没有修改
Native 结果来迎合断言。探针 16 前六轮通过，第七轮在审批前原生失败，未计入拒绝通过；其零值原生
记录没有成为 Core 的已知用量。探针 17 揭示拒绝后重复创建观察 Action 的唯一键冲突，已将拒绝结果
收为工具证据并复验。探针 18/19 分别修正 nullable threadTurnId 的取消脚手架和未启用的 MCP fixture。

合并主干前的最终探针 22 完整九轮通过：8 次 succeeded 与 1 次 cancelled；first/A→B→A/cold 的实际发送、同 Host
暖续接、同完整 ID/Binding/generation 冷恢复、原生 add/read/edit、批准、拒绝、执行中取消和后续任务
均通过。取消后等待 16 秒，15 秒延迟写入没有发生。探针 21 的三个 Run 另证明真实 MCP tools/call
一次和原生 Skill 读取。以上最终两组共 38 次 root 模型调用，四桶合计逐 Run 与原生持久历史一致；
reasoning 与费用均保持 NULL。此前两组的对账证据也保留，共 71 次调用；不把有失败的探针 16 宣称为
完整矩阵通过。脱敏逐 Run 证据见 [evidence.json](hub-adapter-implementation.evidence.json)。

完整性检查确认 9 个实际安装路径、3 个日常设置及既有用户 Hub discovery 的摘要/权限与此前研究一致，
用户 Hub 仍存活。隔离验收用 Provider 源文件与上一轮研究摘要不同，无法确认中间变更环节；它与本轮
最早保留的 11 份产品副本一致。没有凭不完整证据回写恢复。最终私有配置修复后，探针 22 的授权源
Provider/models 和 fixture 源 Provider/models/global-settings 共 5 项前后摘要一致。

合并主干前的验证包括 `pnpm test:rust:staged`（完整 workspace 默认层，458 passed / 2 ignored）、
52 项定向 Rust owner、显式真实 Hub Smoke、`pnpm typecheck`、`pnpm test`（Vitest 2589 项；
Node 337 passed / 2 skipped）和三项文档治理门禁。没有以此冒称已重跑打包 App 或完整扩展 Rust 层。

## 与当前主干合并后的验证

PR #662 创建时与 `main` 冲突，当前分支合入 `51c8b346`，保留主干的真实 Host 启动验证、共享故障
收口、原生配置只读边界和现有界面。成员 `installed_unverified` 不是执行阻断，显式诊断与实际任务
分别验证。旧 Cline ACP 的 3.0.65 门槛在真实 `initialize.agentInfo.version` 检查，不依赖历史 Ready；
Hub 后端与旧 Binding provenance 不变。当前 Hub 合同移入 Runtime Launch v52；本 Mission 的决定
D12–D18 重排为 D16–D22，主干已有 D12–D15 保留。

合并后探针 24 再次完成完整九轮（8 succeeded / 1 cancelled），探针 25 完成三轮真实 MCP/Skill。
38 次原生模型调用逐 Run 对账全部一致，两组各 5 项配置源摘要未变，Host temp、Provider 副本及自有
Runtime Files Root 均清理。探针 23 因旧 helper 等待成员 Ready 而在创建 Run 前停止，修正 fixture
后重新运行，未修改产品就绪语义或重放任务。

合并后的默认 Rust workspace 为 459 passed / 2 ignored，ACP 扩展层 69 passed / 2 ignored，
Vitest 2605 passed、Node 337 passed / 2 skipped，typecheck、fmt 与面向 `origin/main` 的文档门禁通过。
两个已有恢复 owner 继续覆盖 unknown input 不重放、旧 epoch 拒绝及公开终态：发现共享失败路径的
清理原因会命中旧取消兼容投影，现将 accepted unknown input 明确标记为失败清理，保留 failed 展示。
两个恢复 owner 与两个 slow Action owner 均通过，工具审批/执行 fixture 显式保留 accepted input。

中断旧 fixture 的诊断曾留下一个独立 Hub，已用该探针私有 token 关闭。诊断 Host 的 kernel ledger
现与产品 Host 一同保存在 Core data-dir，纳入启动回收。新增可复验脚本
[native_hub_diagnostic_recovery_probe.mjs](fixtures/native_hub_diagnostic_recovery_probe.mjs)，参数与上面的
产品脚本相同。真实验证在 ledger 记录后 SIGKILL 自有隔离 Core：原生 Hub 在重启前仍存活，新 Core
回收了准确进程和私有 Host 目录，随后普通诊断 Ready；全程零模型输入，Provider 源摘要不变。
这只证明诊断中断后的同机重启回收，不替代未完成的全故障矩阵。

完整逐项结果见下表；原先 ACP 的 App/Skill/MCP 证据不会自动成为 Hub 证据。

## 当前 Parity Matrix

| 核心能力轴 | 共享行为与接入 | 已有证据 / 仍缺范围 |
| --- | --- | --- |
| Auth / Provider / Model | 原生 BYOK 配置与模型、变更 fence | 3.0.3 + openai-compatible/gpt-6-sol 真实请求通过；OAuth/订阅和凭据轮换未验 |
| Host / Fleet / LRU | shared Fleet member scope、独占 lease、确认整树回收 | 独立认证/启动来源、暖 Host 复用与正常/取消清理通过；生产 TTL/压力未验 |
| Native Session / Continuation | 完整 ID warm/cold、旧 ACP 后端保留 | 两成员独立 Session、A 的 Binding/ID/generation 跨 Core 重启保持；缺失历史直接失败 |
| Bootstrap / Context | 现有冻结 B → 原生 Rule，动态 P 原 formatter | System 完整 B 恰好一次门禁、身份和早期记忆通过；未增加私有 Charter |
| Compaction continuity | 原生 sessionConfig off/basic/agentic/default | 同安装 basic 阈值与 cold 已验；产品长上下文、overflow+retry、压缩取消未验 |
| Skills | 既有受管索引 + 原生 config extension | 原生 skills 实际读取随机 marker 通过；受管索引/压缩后读取未验 |
| External MCP | 原生定义追加、Rovai assignment 同名完整定义优先 | Core 分配的 stdio 工具实际 tools/call 与随机回执通过；HTTP/更新/撤销未验 |
| Tool / Action / Command Output | 原生 ID 配对 + Cline typed decoder + 共享证据 | bundled CLI、原生 add/read/edit、共享文件投影 1 文件 +1/-1 通过；保留末尾 LF 负例 |
| Narration / Final / Missing-Send | 原生文本和匹配 run.start result、共享结算 | 真实发送与成功终态通过；空最终文本保守失败；纯 Missing-Send 产品复验未做 |
| Permission / Approval / Workspace | native toolPolicies + ActionSafety | 原生 smoke、Core allow/deny 通过；拒绝无写入，也无重复观察 Action |
| Built-in rovai CLI | 现有 process config/lease/private IPC | 两成员、first/warm/cold 各一条 source_operation_id 回执通过；全操作目录未重跑 |
| Usage / Cache / Cost | root afterModel 稀疏数值、native model window | 合并后 38 次调用四桶逐 Run 对账通过（前后累计保留 109 次），窗口 272000；reasoning 缺失 NULL、费用未知 |
| Retry / Queue / Cancel / Cleanup | native acceptance/run/epoch fence + run.abort + shared tree | 正常关闭、执行中取消、延迟副作用排除和新任务通过；网络/崩溃完整矩阵未验 |
| Ready / Version / Platform | 无模型 Hub probe、旧 ACP 独立门槛 | 3.0.3 Ready；只 macOS arm64 Preview，不外推其他平台 |

## 与其他智能体的区别

| Runtime | Rovai 运输后端 | System / Session 特点 | 当前差异 |
| --- | --- | --- | --- |
| Cline 新 Binding | 原生 Hub WebSocket，独立认证 daemon | Rule + `sessionConfig.compaction`；原生完整历史恢复 | 本机默认 basic，原生 Hub 没有可用 basic 压缩通知；BYOK/单平台 Preview |
| Cline 旧 Binding | 官方 ACP stdio | 既有 managed Rule / ACP load | 不自动迁移；保留 3.0.65 门槛与原 ACP compaction 缺口 |
| Command Code | 官方 ACP | 原生 System Mod / ACP Session | 原生压缩已验；当前 BYOK deferred MCP 实际调用仍未通过，保持 Preview |
| Codex CLI | 原生 app-server | 原生 thread/turn 与 instructions 接入 | 不需要额外 Hub daemon；使用既有原生审批和事件能力 |
| Claude Code | 原生 stream-json/control | System 接入与原生 resume | 进程/会话生命周期不同，仍归共享权限与证据合同 |
| Pi | 原生 JSONL RPC | 原生 Session 与 extension hooks | External MCP 为已接受 Unsupported；其三平台资格不移植给 Cline |
| 其他 ACP Runtime | 官方 ACP | 各自 session/new/load 与权限能力 | 共享 ACP Host；模型/压缩/工具细节和资格仍逐 Runtime 判断 |

以上运输差异不会建立第二套 Thread、身份、Memory、ActionSafety、builtin CLI 或 Usage 产品体系。
