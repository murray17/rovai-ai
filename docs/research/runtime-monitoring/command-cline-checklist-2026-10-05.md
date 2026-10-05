---
document_type: runtime-research
authority: research-evidence-only
status: partial-verification
last_updated: 2026-10-05
---

# Command Code / Cline：14 轴实现与真实验收

User 消息 `677d610d-e4cf-4ffb-aba2-d4ebb021cbcd`、`1bd0ab39-6939-40cd-9653-b472b3b69082` 要求修复
Bootstrap、warm 和此前遗漏，并尽可能接入、验证全部能力。本记录按
[Runtime 接入 Checklist](../../development/runtime-integration-checklist.md)区分产品实现、真实原生探针和未覆盖边界。

本轮把 **Command Code 1.74.1 官方 ACP 接入 Product、共享 Fleet 与受管 System Bootstrap**；原生默认
sub2api/gpt-6-sol 已完成真实生成、A→B→A、exact cold、手动和自动压缩后的身份/记忆恢复。隔离开发包中
芝士为 Command Code、叮叮为 Cline，Command 首次/warm/App 重启、文件增删、内置 CLI 和数值主路径已过。
Cline 仍用官方 ACP；已补齐 compaction policy/observer 展示，但当前上游 ACP 没有启用原生 compaction，
可选 Plugin 缺失后仍会调用模型，尚不能将 Bootstrap 从 first_payload 安全移走。

平台 macOS arm64；Cline 固定 3.0.65，Command Code 固定 1.74.1；两者分别使用自身隔离原生配置中的
sub2api BYOK，未借用另一 Runtime 的认证。两者保持 **Preview**，不把主路径成功写成 First-Class。
修改前基线为 `59a43b52`；历史证据保留在[前轮记录](command-cline-checklist-2026-10-05.evidence.json)，
本轮记录见[新增证据](command-cline-completion-2026-10-05.evidence.json)。证据不包含凭据、完整模型输入或原生历史。

User 消息 52 后继续完成的真实崩溃矩阵、排队恢复与 Session 负向验收见
[故障恢复补验](command-cline-fault-recovery-2026-10-05.md)及[对应证据](command-cline-fault-recovery-2026-10-05.evidence.json)。
这轮修复继承 stdout 阻塞退出检测、macOS 独立进程组漏清理、Core 重启遗留后代、accepted/unknown 永久 waiting、
失败误显示成取消，以及 Command 恢复不存在历史时静默成功。以下仍未覆盖的子项继续保留，不以新增通过替代整轴资格。

## 本轮实际修复

1. 新增 closed `command-code-cli`、发现/版本检查、安装指南、模型/权限、成员设置和监控入口；
   Migration 185 原子扩展 Runtime/Skill CHECK identity，schema 134→135，保留行、触发器与回滚 receipt。
2. 接入现有 `AcpCliRuntimeAdapter` 和 Fleet。原生多 Session 常驻、精确恢复、队列、取消、终态及
   bundled CLI 使用共享 owner；没有新增私有进程池或逐 Run headless wrapper。
3. 官方 `appendSystemPrompt` 按完整 `state.sessionId` 读取冻结 B；Mod readiness 验证 nonce/PID/revision，
   每次模型请求验证绑定、摘要和大小。原生吞普通异常，所以坏绑定直接退出 Host，不能无 B 继续生成。
   App 持久化的 delivery mode 为 `managed_system_prompt`；普通 user prompt 只交付 P。
4. 原生 `config.json.model` 可以使用自定义 BYOK。上游 ACP picker/set_model 不接受该 ID 时，Rovai
   使用 `command-code-cli://runtime-default` 保留原生默认；不伪造自定义模型的显式选择能力。
5. 工具初始/终态按 Session、Prompt、ToolCall 配对，补回稀疏终态的路径与参数；过滤尚未执行的 proposed
   diff，仅成功单次 edit_file 替换生成 `reported_mutation`。中文/空格文件、Command 与 Files Changed
   复用现有可点击增删展示，未知完整文件状态不伪装为完整 diff。
6. `session/prompt.result._meta.usage` 作为本 Prompt 消费，输入已含缓存，扣除缓存后得到未缓存输入；
   `result.usage` 的 Session 累计值不重复入账。`usage_update.used/size` 独立表示会话上下文。
   Session 累计费用和缺失 reasoning 不伪造为 Run 字段。
7. External MCP 使用标准 Session mcpServers；原生同名按既有 `native_wins_skip` 明确标记跳过。
   应用内实测发现 Command 被误列入“原生配置通道”的排除表，导致分配可见但未传到 ACP；已移出该表。
   修复后 stdio/HTTP 连接、schema 发现、配置更新和同名跳过通过；当前 BYOK 的真正工具调用仍有下述上游问题。
8. Cline 原生审批拒绝只有 `tool_call_update.pending → failed`，可能没有执行阶段的 `tool_call`；
   原配对器因此退出读取，真实 App Run 留在 waiting。现已保存权限提案的输入、接受重复失败，
   并保留到后续 rawOutput 到达，避免把拒绝后的 completed envelope 改记成功。
   权限通知不再提前登记成工具结果，防止后续原生结果引起审计幂等冲突；
   Session/Prompt/ToolCall 仍精确隔离，无初始输入的成功编辑仍拒绝。
9. App 权限切换复测暴露 Cline 自动批准仍沿用旧值；代码检查确认 Cline auto_approve 与 Command
   permission_mode 都错误保存在常驻 Host 上。已改为每轮从 frozen Runtime 解析，并通过原生 Session
   RPC 设置。新包两者各完成 manual allow_once → auto/bypass 写入，第二轮无审批；Cline 同 PID 58632。
10. 前轮已修的 Cline policy 注册、active observer lease、压缩事件数值白名单和会话归属检查继续保留；
   它们只证明接线，不把未发生的原生压缩算成已完成。

## Bootstrap 与压缩：已通过和不能冒领的部分

| Runtime / 场景 | 真实证据 | 当前行为 |
| --- | --- | --- |
| Command System 必需门禁 | 官方 Runtime initialize 后工厂已注册；删除绑定后进程停止，未进入 Provider；Node 子进程覆盖错 ID、缺失、错摘要、空值、超预算 | 受管 System B；加载/绑定失败即停止 |
| Command A→B→A | 同 PID 68884，A/B 原生 UUID 独立；A 返回仍记住自身 System 与早期 marker，无 B 串话 | 常驻多 Session；Core 另有同 Host A/B/A 实测 |
| Command 手动 compact | 长会话真实报告 22 条消息压为 5 条；之后及关闭 Host 再 exact load 后均保留身份和记忆 | 每次原生模型请求重新追加同一冻结 B |
| Command 自动 compact | 仅隔离探针将窗口设为 65536；第 9 个工具轮次观察到 summarized，tokensBefore=37648、tokensAfter=33835、tokensSaved=3813；后续身份和早期 marker 保留 | 真实 threshold 场景通过；不是 overflow/retry 资格 |
| Command App/Core 冷恢复 | 原生 Session `68c8f864-2efd-4f94-b85e-e82c82c0f3c7`、Binding 和 generation=4 重启前后相同；实际 bundled CLI 发回早期 marker | 产品恢复通过；原生 Session、Binding 和 generation 保持不变 |
| Cline System Rule 正向 | 独立 beforeModel witness 见 B 恰好一次，真实模型回应 marker | 官方 Rule 能追加 System |
| Cline Plugin 缺失反例 | witness 见 B=0，模型仍被调用并正常结束 | 缺少必需加载门禁；保留 first_payload |
| Cline compaction | 全局设置显式 enable、两轮真实预算探针仍无事件；固定版本 ACP buildConfig 未传 config.compaction，SDK 仅 enabled=true 才安装 prepareTurn | 不声称 manual/auto/overflow 已支持 |

Command 首次短会话 `/compact` 返回 Nothing to compact，不计作压缩成功；上表使用后续真正压缩的证据。
自动压缩探针中的原生 token 估计与 Provider 输入数并不等价，不能据此推算额外窗口或冒领溢出恢复。
Command System 常驻保护不依赖 compaction detector；尚无压缩进度的产品展示验证。

Cline 的[固定版本 Plugin loader](https://github.com/cline/cline/blob/cli-v3.0.65/sdk/packages/core/src/extensions/plugin/plugin-loader.ts)
会在加载错误后继续。Rule 函数抛错虽然能中断请求，却不能覆盖“文件不存在、根本未加载”的路径；首个非空
Prompt 才延迟加载 Plugin，ACP 无已验证的 required-plugin readiness。调查 3.0.68 的 ACP/loader 与 3.0.65
字节一致。直接移除 user 层 B 会造成真实无 Charter 调用，故未这样切换，也未静默 fork Cline 或改成另一套 SDK Host。

## MCP 的新增上游反例

修复漏传后，原生 `search_tools` 确实返回 `mcp__command_parity50__echo` 的完整 schema，服务器已启动。
但在本次 sub2api/gpt-6-sol 下，模型反复调用 search_tools，没有实际调用 echo；已通过 App 的 Run cancel
停止循环，服务器调用计数为零。1.74.1 发布包源码中，`supportsDeferredTools` 对带自定义 Provider 前缀的
模型返回 true；`createToolCatalog.schemas` 过滤 deferred MCP，`createSearchToolsTool` 只返回 schema 文本，
没有改变下次请求的工具 schema 集合。官方 Mod 的可变 hook 也没有已验证的工具目录覆盖接口。
因此当前组合的 MCP invocation 保持未通过，不能靠模拟 shell 调用、替换模型 ID 或握手状态宣称成功。

另用限一次 search 的真实模型验证了配置更新、HTTP `initialize/tools/list` 与测试头、撤销后工具/Skill 不再可见，以及 native 同名
优先：Rovai exposure 为 `skipped_native_name_conflict`，实际启动的是 native 定义。它们是连接与发现证据，
不覆盖上述真正工具调用缺口。没有静默修改第三方 CLI 或增设另一套 MCP 代理。

## 按 Checklist 全部 14 轴对照

已有 Runtime 一栏描述共享合同或代表实现，不意味着每个已存在的 Runtime 在每个平台都完成所有子项。
“部分”表示轴内已有 `Verified + Implemented` 子项，但整轴仍未通过；未知字段不是虚构的零。

| 能力轴 | 共享标准 / 代表实现 | Cline 3.0.65 | Command Code 1.74.1 |
| --- | --- | --- | --- |
| Auth / Provider / Model | 原生认证；默认/显式模型；配置变化使旧 Host/Binding 失效 | **部分**：自身 BYOK、默认模型、配置摘要通过；完整凭据轮换/显式切换矩阵未完成 | **部分**：自身原生默认 BYOK 真实通过；默认哨兵修复；自定义 ID 的显式 set_model 被上游拒绝；完整 OAuth/凭据轮换未验 |
| Host / Fleet / LRU | 统一 Fleet；ACP/Pi 常驻，Claude 等 one-shot resumable | **部分**：共享 Fleet、真实 warm/A→B→A 已过；完整 LRU 压力未验 | **部分**：共享 Fleet，Core 常驻控制与真实原生 A→B→A、App warm 通过；完整 LRU 压力未验 |
| Native Session / Continuation | 完整 ID；warm、exact cold、Core 重启；replay 隔离 | **部分**：原生及 App/Core exact cold、原 Binding/generation 保留通过；不存在/截短 ID 原生拒绝；Runtime/Core/App 强杀后新输入成功 | **部分**：真实 warm、exact cold、同 Session/Binding/generation 通过；原生错误 ID 静默成功已用官方 catalog 门禁补齐；Runtime/Core/App 强杀恢复通过，网络矩阵未全验 |
| Bootstrap / Context | native append、managed system、first_payload 三类并存 | **目标未完成**：first_payload；Rule 正向通过但缺失反例阻断 System-only | **Verified + Implemented 主路径**：受管 System、readiness/每请求绑定门禁、A/B 隔离、压缩及冷恢复保留；B/P 不重写共享正文 |
| Compaction continuity | System 保护或合格完成信号后补发；manual/threshold/overflow/retry 分验 | **Blocked 上游 ACP 接缝**：policy/observer 已实现，原生未 enable；不把普通 `/compact` 回复当压缩 | **部分**：真实 manual、threshold 和随后 cold 通过；overflow/retry 与产品压缩进度尚未验证 |
| Skills | 当前 Skills v2 工具箱索引；原生发现由 Runtime 拥有 | **部分**：真实原生发现/读取/撤销、工具箱共享通路已接；全部并发/同名矩阵未验 | **部分**：`.commandcode/skills` 原生读取在 App 通过；当前平台/工具箱共享索引已接；新 Host 撤销原生 Skill 已过；同 Host 热更新/相邻隔离未全验，非旧 managed group 投递 |
| External MCP | Session/Run 投影、同名策略、更新/撤销/隔离 | **部分**：ACP 不消费 session 字段，使用 Host 私有官方 config；App stdio/HTTP 真实调用、测试头、更新、撤销、相邻隔离已过；HTTP 并发压力未验 | **部分**：标准 session mcpServers，native_wins_skip；App stdio/HTTP 连接、schema 发现、更新、撤销及同名跳过已过；当前 BYOK 真实 echo 未调用，不能把发现算作调用通过 |
| Tool / Action / Output | 原生 ID、准确路径、生命周期、输出、退出码和分级 Diff | **部分**：App read/edit ±、失败编辑、非零与空输出通过；部分 editor 路径/大输出未全验 | **部分**：App 中文空格 read/edit/read、+1/−1 点击通过；原生 stdout/stderr、16001 字节和空输出过；非零 exit 上游仍 completed/text-only，不猜退出码 |
| Narration / Final / Missing-Send | 思考私有、显式 send、唯一 final、合格 zero-send 恢复 | **部分**：显式发送、zero-send 与公开去重已过；故障后终态单独记录 | **部分**：App 显式 CLI 与零发送最终回复恢复通过；MCP 搜索循环取消后不恢复公开结果，故障矩阵见新增证据 |
| Permission / Approval / Workspace | 原生审批权威；allow/deny/cancel；授权目录 | **部分**：App allow_once / deny 已过：允许后写入，拒绝无文件且 Run 正常结束；拒绝后回复与 manual→auto 权限刷新通过；更广审批选项/并发矩阵未验 | **部分**：五种原生 mode 接线；真实 default deny 和运行中 cancel 通过；App allow_once/deny 已验，允许后写入成功，拒绝无目标文件；default→bypass 刷新后新写入无审批 |
| Built-in rovai CLI | 当前 Run lease、进程注入、结束解除、发送去重 | **部分**：App first/warm/第二成员/cold 显式公开回帖已过；全 operation 矩阵未完成 | **部分**：App first/warm/cold 真实公开发送通过；全 operation 矩阵未完成，运行中退出清理已过 |
| Usage / Cache / Cost | 消费与 Context 分离、稀疏原生字段、未知 NULL | **部分**：四桶、可选 reasoning、live used、配置匹配 272k 和重开已过；费用未知 | **部分**：Prompt 四桶 cache-inclusive、实测命中、latest used/272k、App 持久化通过；reasoning 和 Run fee 未得到可归属值 |
| Retry / Queue / Cancel / Cleanup | accepted 不盲投、迟到隔离、取消/断网/整树回收 | **部分**：工具 cancel、planned shutdown、Runtime/Core/App SIGKILL 通过；超过 75 秒无迟到写入，排队输入在 cleanup ACK 后自动成功；Provider overload 后不重放已发送输入 | **部分**：工具 cancel、planned shutdown、Runtime/Core/App SIGKILL 通过；新 Core 回收 ledger 后开放调度；超过 75 秒无迟到文件，排队输入在 cleanup ACK 后自动成功；完整网络/压力矩阵未验 |
| Ready / Version / Platform | 安装 Ready 与行为资格分离；逐平台固定版本证据 | **Preview**：macOS arm64；其他平台 NotQualified | **Preview**：最低 1.74.1、catalog 18 项、schema 135、macOS arm64；其他平台 NotQualified |

代表 Runtime 的输入位置并不完全相同：Codex/Claude/Grok 有 native append 接缝，Pi/DeepSeek Harness 使用
受管 System，OpenCode/Copilot 等使用 first_payload。对齐的是冻结输入、连续性、权限和证据语义，不能把
缺少字段的 Runtime 伪装成提供了同样原生协议。

## Checklist 九条 Golden Flow 的剩余范围

| Flow | 已有真实证据 | 仍未闭合 |
| --- | --- | --- |
| First Run | 两者自身 BYOK、默认模型、Bootstrap、工具、Final 与内置 CLI | 不外推所有 Auth/Provider 组合 |
| Warm Host | 两者原生与 App warm；动态权限刷新；Command System 绑定 | 完整 idle eviction / 20、200 Host 压力 |
| Multi-Session / Concurrency | 两者 A→B→A；本轮两 Runtime 同时运行真实工具 | 全部同 Runtime 并发、相邻 Session 能力变更矩阵 |
| Cold Resume | 有效 App/Core cold 保留完整 Session/Binding；Cline 错 ID 拒绝；Command 加官方 catalog 门禁 | 全部网络/协议故障组合；错误恢复须记连续性丢失后的新 Session，不能计入 exact resume |
| Context / Compaction | Context used/window 与消费分离；Command manual、threshold、随后 cold | Cline ACP compaction 上游接缝；Command overflow+retry 与产品进度展示 |
| Skill / MCP Projection | 原生发现、更新/撤销；Cline stdio/HTTP 真实调用；Command 连接、发现与同名优先 | Command 当前 BYOK deferred MCP invocation；完整热更新/并发压力 |
| Safety / Output | allow/deny/cancel、文件 ±、stdout/stderr/empty；Cline 非零/失败编辑 | 全部 read-only/审批选项/大输出组合；Command 结构化非零退出码缺失 |
| Monitoring | 四桶、缓存命中、272k、Session gauge、App 持久化与重开 | 全部 retry/compaction 计量组合；缺失的可归属费用与 Command reasoning |
| Failure / Cleanup | planned shutdown、Runtime/Core/App 强杀、迟到写入检查、清理后排队自动发送 | 真 Runtime 的完整协议错误/Probe timeout/断网矩阵；其他平台；macOS 未观测后代不等价于 OS Job |

## 验证范围与保留边界

自动回归覆盖 Runtime catalog、模型默认值、数据库双迁移与原子回滚、稀疏 usage/缓存语义、工具初末配对、
私有字段排除和必需 System Mod 子进程门禁。真实探针与 packaged App 证据独立记录，不用 fixture 代替真实模型。
Cline 拒绝回归最终 Run `1d633037-d57b-4ee0-bfe7-0beca9dbfdfd` 正常 succeeded，目标文件不存在；
此前失败和中间候选曾停在 waiting/running，均显式取消并记录为失败尝试，没有计入通过。
权限通知与真实工具结果的不同来源见[固定版原生审批桥](https://github.com/cline/cline/blob/cli-v3.0.65/apps/cli/src/acp/permissions.ts)。
具体测试总数、App Run、指标、MCP/审批结果在[新增 evidence](command-cline-completion-2026-10-05.evidence.json)。

运行中退出最终使用独立 Node 测试进程：核验两者真实 child PID 和启动标记后退出隔离 App，等待超过
60 秒写入时点。退出前 12 个所属进程全部消失，两个延迟文件均不存在，重启后两个 Run 为 cancelled。
原始 setup 的 Cline 旧权限、Command 禁止长 sleep、Cline 默认 30 秒超时不算退出成功；最终真实 Run 为
`8a458900-df25-4a5a-9530-eced73924f20` 与 `4f58cefc-8ce7-4ecb-a840-71b0e000c070`。
随后 Command Run `14325670-a3ec-4c1b-8630-ae33a9c3bb2b`、Cline Run
`7cf58f43-259f-4ee4-86ba-ed533c58409f` 均 succeeded，并各用 bundled CLI 恰好公开回复一次。

开发包仅替换既有 `RovaiRuntimeAcceptance/mission-052-cline-…/Application/Rovai AI.app`，显式使用该目录下
userData、managed-skill-library 和 MCP 配置；未升级全局 CLI、未重启日常 App。原生 Summary、Provider 配置与
wire 保留在私有验收目录，公开证据只保留必要 IDs、数值、验证结果和测试 marker。

已明确的剩余差异是 Cline 必需 Plugin 门禁/ACP compaction 配置接缝，Command 自定义 BYOK 的 MCP 延迟加载、模型显式选择/结构化
非零退出码/Run 费用，以及上表未覆盖的压力、网络和平台矩阵。这些项保持 Preview/未验证，不虚构
Unsupported 决定，也不把 Mission 或 First-Class 标成完成。
