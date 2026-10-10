---
document_type: implementation-record
version: v1.72
authority: implementation-evidence
last_updated: 2026-10-10
---

# OpenCode V1/V2 适配

依据 User 2026-10-10 的执行意见实施。基线 `1126875f0`，分支 `rovai/mission/060`。
保持一个 OpenCode 产品和 `OpencodeCli` Adapter，复用 ACP、Fleet、Bootstrap、CLI 与监控机制。
本记录保存必要决定与实际验证范围；测试样本不是执行白名单。

## 必要决定

| 项目 | 实现边界 |
| --- | --- |
| 程序选择 | 显式路径优先，否则沿用发现顺序和默认 `opencode`。不主动寻找 `opencode2`，不在失败后换程序。 |
| 启动准备 | 检查选定程序身份后，使用匹配健康 Host／现有版本字段；不足时有界读取同一路径的 `--version`，再生成配置、完成现有 Host/Binding 冻结。无新缓存、表、管理器或页面／保存／浅发现探测。 |
| 未知与冲突 | 无法确定必要启动契约时报告具体初始化错误。缺少补丁验收记录不阻断。握手代际冲突时在正文前停止并回收 Host，不修补冻结结果或自动重发。 |
| Host 与 Session | Host 保留程序指纹、版本和配置兼容轴；Session 使用代际、ACP、workspace 与原生存储来源。补丁升级可以重建 Host，不仅因指纹变化丢弃 Session。MCP／权限隔离继续现有兼容判断。 |
| 旧 Session 与原生委派 | 旧 Binding 缺 compatibility key 时走现有 controlled restore，保留精确 Session ID。V2 订阅原生 child-session-updates；根轮结束时仍有活动子会话的 Host 不满足既有 quiescence 条件，由 Fleet 回收，避免旧 Run 继续执行。子会话文本、用量、压缩不混入根会话证据。 |
| 权限 | V1 保留 permission 与 build/plan 覆盖。V2 使用末项优先的 permissions：一般 allow/ask/deny 在前，shell/skill allow 在后，覆盖 build/plan。自定义／子 agent 保留原生规则，V2 原生残余请求进入既有审批，根 allow 不替其自动批准。ask/deny 不是全局询问／拒绝或只读沙箱。 |
| 原生配置 | 保留 OPENCODE_CONFIG_CONTENT 的模型、provider、MCP、自定义 agent 等内容，只覆盖已有权限意图及更新字段；非法配置明确报错。 |
| 压缩 | V1 移除 Rovai 强加的 `--pure`，使现有 session.compacted 插件可以加载；保留用户显式 OPENCODE_PURE 设置。V2 在插件生成／注入之前分流，接入原生 ACP session_info_update 的 opencode/compaction 完成标记。根 Session 的 completed＋messageId 驱动既有 Observer／Requirement；started、failed、child、历史 replay 不补发。原生 occurrence 去重、quarantine 与下一输入的 Bootstrap 补发继续复用。 |
| 可选交互 | 不声明未实现的 elicitation.form 或带 summary/patch 的 session.compaction capability；权限交互继续原生 ACP options。V2 压缩完成标记承接协作连续性，不关闭自动压缩。 |
| 用量 | V1 保留只读原生根 Session reader；V2 停用该 reader，接 prompt response 当前根会话本轮已报告用量，按 V2 缓存／reasoning 语义归一。复用 scope、checkpoint 和部分统计；未覆盖原生子会话／委派，不标完整 Run 总量。缺响应／字段保持未知，Session 累计成本不算本轮成本。 |

macOS 的 V2 `2.0.26` 包尝试从构建机 `/home/runner/...` 路径加载可选 msgpackr 原生模块，
本机 autofs 因此阻塞。隔离 syscall 追踪定位后，包已有的
`MSGPACKR_NATIVE_ACCELERATION_DISABLED=true` 可恢复正常 ACP 启动。
macOS V2 启动及代际尚未知的模型目录读取在用户未设置该变量时补充此环境值，
不修改原生全局配置。模型目录复用两代共有的 `acp` 入口，不增加版本子进程；V1 普通执行使用
`acp --log-level ERROR`，不强制关闭原生外部插件。

## 发布包与验证

本节保存初始适配与合流时的样本；后续修复后的本机开发构建另见下方验收记录。

| 样本 | 平台 | 已有证据 |
| --- | --- | --- |
| V1 `1.18.32` | macOS arm64 | 原 `acp --pure --log-level ERROR` 路径的修复前样本。协作、审批、取消、冷恢复、MCP 三服务器与配置生命周期实测通过；这些样本没有覆盖压缩后的 Bootstrap 补发，不能据此宣称该链路正常。 |
| V2 `2.0.26` | macOS arm64 | 官方 @opencode/cli-darwin-arm64 包，npm sha512 验证通过；二进制 SHA-256 为 `1b6418a3bd4211344d8a2b75d7d4367b24283ae548bd6b896cf717f6f8858f26`。拒绝 --pure，使用 acp --log-level error。隔离 initialize/session/new 确认 env 配置高于项目文件；下述基础链路、压缩和 MCP 实测通过。 |

真实协作复用 `scripts/probe-runtime-execution-metrics.mjs`，独立 Core data-dir、Skill Library、MCP、
原生 Home/config/data/cache/state；私有临时目录仅复制当前已授权 provider 配置。
模型 `sub2api/gpt-6.1-sol`。两代各轮只有一个来自 bundled rovai send 的公开消息；
Core 冷重启后原 Session/Binding 保持，原用量快照不重算。fixture／native shape／evidence 保存在私有验收目录，
不提交凭据或原生正文。脱敏结果随任务交付，不进入历史平台证据快照或执行白名单。

| 链路 | 2026-10-10 实测结果 |
| --- | --- |
| Bootstrap、Skills、CLI、公开输出 | 两代各两轮真实模型执行成功；确实读取 `cli-operations/SKILL.md`，调用当前 bundled `rovai thread read` 与 `rovai send --public-only`。公开消息和相同 final 各轮只形成一条消息；冷恢复保持同一 Native Session/Binding。 |
| 权限与取消 | 两代既有 `smoke-acp-runtime.mjs` 通过：普通回复、Shell 例外、同 Host/Session 延续、文件写审批、拒绝后无文件、运行中取消后 35 秒无延迟写入。V2 自定义 primary agent 在 Rovai allow 下保留原生 ask，实际出现审批；不外推所有子 agent。 |
| V2 原生子会话取消 | 复用同一 smoke，以 `ROVAI_ACP_CANCEL_RUNNING_TOOL=1 ROVAI_ACP_CANCEL_NATIVE_CHILD=1` 请求一个原生 general 子 agent。确认 child 的 Shell 写出 started 标记后取消根 Run；原生 parent/child ID 关联及两侧工具终止均已核对，Run 为 cancelled，35 秒后无延迟文件。 |
| CLI 授权过期 | 独立保存本轮临时 context，仅调用无副作用的 `thread read`：Run 活跃时 exit 0；该 Run 结束、后续 Run 仍运行时，旧 context exit 2，返回 CLI 授权失效错误。另有现有租约单测覆盖撤销。 |
| V2 原生自动压缩 | 保持 auto 开启，以测试 buffer 触发 3 个不同原生 completed messageId；Core 正好记录 3 个 occurrence。冷恢复后的下一轮附带 Bootstrap redelivery 并 ACK revision 1。第二轮新产生的 revision 2/3 保持待下一输入，未伪造已补发。历史回放没有重复累计。 |
| V2 用量 | 本轮根会话 Input/Output 可见，`inputOutputComplete=false`；未报告的 cache write 为 null。冷恢复不重复累计，V1 保持原 reader。 |
| MCP 与 Session 隔离 | 两代各 6 个 Run、8 次服务器实收调用：初始 stdio/HTTP/stdio，之后更新、相邻队员、取消分配、重新分配、删除各一次。更新替换 Host 而精确 Session ID 不变；相邻队员／取消分配／删除恢复原生定义。 |

MCP 验收曾出现 V2 模型报告工具不可用：初始 provider 请求的 system/tool 定义未列出原生 MCP
命名空间，但独立原生 ACP 复现通过 `execute` 成功调用同一工具。源码中原生 MCP 的连接与工具目录
刷新是异步的；现有证据不能把“目录未列出”直接判成投递丢失或工具不可调用。
验收现在明确允许原生发现及 `execute` 入口，并校验服务端真实调用次数；两代完整矩阵通过。
失败记录保留，不把成功样本外推为所有模型都能自动发现该入口，也不增加预热任务、自动重发或固定等待来掩盖该现象。

协作／压缩最终样本的 Core SHA-256 为 `c9eb1652d393a8611af99097ba95c5674f280ad4ad61f9baad739835cc7edde9`；
随后模型目录去掉额外版本读取，最终 MCP 与 V1 smoke 使用
`207b3d3a363d057ccee382778d9b7cfe1f0aa1e39ff8e3a91c7a6f31abf48351`。
V1 初始协作样本使用 `b3a8ab57c458796df92e3ab6ad79cba3ea608d05c5675ccf8690ceb938140370`；
各样本只证明对应构建所覆盖的链路。

Windows x64、macOS x64 没有本次真实执行证据。原平台限制不变，本机样本不外推为所有版本完整保证。
本次不声明可选 elicitation.form／summary-patch 交互或所有原生子 agent 权限组合已经验收；
原生委派取消样本限于上述 general 子 agent。发布前保留这些覆盖边界。

## V1 `--pure` 与真实自动压缩复核

2026-10-10 按 User 的专项测试要求，对同一个 V1 `1.18.32` 二进制和上述合流后 Core 做隔离 A/B。
本轮只在验收启动器中移除 `--pure`，没有修改生产启动策略。选用现有 `sub2api/gpt-6.1-sol`
配置的私有副本，独立 Core、Skill Library、MCP 和原生存储；没有使用免费模型额度，也没有写日常配置。
V1 二进制 SHA-256：`a3c45d4e1d6620b436851f1ef6b25c71befcf06a382e279a1eb1c2196424395e`。

复用 `probe-runtime-execution-metrics.mjs` 的两轮真实协作和冷恢复链路：读取 Skill、调用 bundled CLI、
读取受控大文件、原生自动压缩、公开发送／final 去重、冷恢复后的下一输入。测试模型声明
`limit.context=200000, input=200000, output=8192`，仅在隔离配置设置
`compaction={auto:true,reserved:176000,preserve_recent_tokens:1500,tail_turns:0}`，使实际工具结果触发
24000 token 阈值。原生数据库的 `compaction.auto=true`、成功 summary 和真实 `session.compacted`
分别核对；没有手动 compact、伪造 usage、注入完成事件或修改 Core 数据库。

| 检查 | 带 `--pure` | 仅移除 `--pure` |
| --- | --- | --- |
| 原生自动压缩／成功 summary | 1／1 | 1／1 |
| Core `session.compacted` observation | 0 | 1 |
| requested／acknowledged revision | 无 Requirement | 1／1 |
| 冷恢复后下一输入的 Bootstrap redelivery | 无；原生输入也没有补发 marker | 有；Core accepted 且原生输入包含补发 marker |
| 两轮真实 Run、精确 Native Session 恢复、公开去重 | 通过，但不能弥补漏补发 | 通过；每轮各 1 条公开消息 |
| 全局、项目、显式 config 三处测试插件 | 全部未加载 | 三处均加载并收到真实完成事件 |
| 插件 `shell.env` 对实际命令的影响 | 三个 canary 环境值为空 | 三个 canary 环境值均为 `active` |

测试插件使用原生 Plugin loader 和 hooks 执行，记录真实模型调用／事件，并向 Shell 注入无害 canary；
不是在测试客户端模拟插件或压缩通知。它们是受控功能插件，该结果不保证任意第三方插件的行为。

进一步复用 `smoke-acp-runtime.mjs`，给同一 inline 测试插件增加原生 `config` hook，只在运行内把
`cfg.permission.edit` 和 `cfg.agent.build.permission.edit` 设为 `allow`，不写用户配置。插件记录确认
hook 执行前 Core 注入的 root／build 默认均为 `ask`。带 `--pure` 时插件不运行，实际文件写入经过
审批；移除参数后，原生文件工具不再申请审批，连验收脚本准备拒绝的第二个文件也被创建，既有
denial 断言因此正确失败。这里的失败是实测插件覆盖配置的证据，不能记成兼容性通过。
这证明影响不限于插件日志或通知；保持启动 JSON 不变，并不足以保证启用用户插件后的实际权限不变。

同一权限 hook 的 pure 对照完整 smoke 通过，包括 1 次文件审批、1 次拒绝和运行中取消后 35 秒无延迟文件。
只含事件／Shell canary、没有权限 hook 的 no-pure 样本中，文件审批和拒绝仍通过；取消步骤的模型拒绝
执行 Bash 文件创建命令，未启动目标工具，脚本等待取消条件后超时。该样本保留为“取消未覆盖”，
不记为 Runtime 取消通过，也不把模型拒绝归因于删除参数。

根因由精确上游提交 `545f51d26cc39a907d2867492d498d9607ea5fa4` 交叉验证：
[CLI](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/index.ts)
把 `--pure` 写为 `OPENCODE_PURE=1`；
[Plugin loader](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/plugin/index.ts)
在 pure 模式把全部外部来源置空，包含 Rovai 注入的插件。
[配置合并](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/config/config.ts)
按原生规则合并全局、项目和 inline 插件；追加 Rovai 插件并不替换其他来源。
V1 ACP event 路由也没有转发 `session.compacted`，不能从普通回复成功推断另有可靠完成信号。

上述调查确实复现了既有 V1 启动路径的缺口；但将“原生插件可改权限”作为禁止删除参数的理由，
超出了原生信任边界。按 User 随后的澄清，插件是 OpenCode 内部执行的受信任代码，工具 ask/deny
不是针对插件的沙箱；故意改写配置的样本不等于 Rovai 丢失配置或原生审批引擎失效。

当前最小修复移除 Core 强加的 `--pure`，复用已测通的 plugin／Observer／Bootstrap 路径，不建立另一套
插件隔离或权限引擎。全局、项目及 inline 外部插件恢复按原生规则运行，这是需要明确的行为变化。
Rovai 继续传入已保存的权限值，并保留用户显式 `OPENCODE_PURE`；如果用户主动禁用插件，V1 的插件
监听也受该原生选择影响，不能宣称仍能通过它观察压缩。之前的 A/B 数据保留为修复前证据，
修复后开发构建及本机 V1 → Brew V2 的验收见下节，不用旧样本代替新构建的验证。

## 本机开发构建 V1 → Brew V2 验收

2026-10-10 按 User 要求先测本机 V1，再移除其独立可执行入口并执行 `brew install opencode`。
Brew 的 `2.0.25` 原先已经安装，只是被 PATH 前面的 V1 `1.18.32` 遮蔽；安装命令确认其已是当前版本。
切换后默认 `opencode` 命中 `/opt/homebrew/bin/opencode`，实际文件位于 `Cellar/opencode/2.0.25/bin/opencode`，
SHA-256 为 `e0c5d500b2b3d97d30f57f52a3a9a058098eb76116d1c9fd095951572318f808`。
只删除核对版本与指纹的 V1 可执行文件和空 bin 目录，保留 Shell 配置、原生配置及 Session 数据；
没有执行会连带删除共用 cache/state 的原生卸载流程。原 provider 配置前后 SHA-256 相同。

本轮 Core `0.4.7` 的 SHA-256 为
`a3de76de4d90718ccc34fd6e23dca947a9dbdc04edc50c6c2b307446963765d9`。
两代使用同一开发构建与 `sub2api/gpt-6.1-sol`，分别隔离 Core data-dir、Skill Library、MCP 和原生存储。
真实 Desktop 使用 `pnpm dev`，不覆盖日常 App；默认程序发现、Renderer/Main/Core 的真实调用与
协议脚本验收分别记录，不能用无模型 UI fixture 代替真实 Runtime。

去掉强制 `--pure` 后，全新 V1 环境稳定复现另一个冷启动问题：主动检查／模型目录进程启动后台
插件依赖安装，短进程退出后留下原生安装锁；下一 Host 必须等其 60 秒 heartbeat 过期，旧的 45 秒
ACP initialize 期限会先到。失败样本没有发送正文，串行仍可复现，不能归因于并发负载。
上游 [EffectFlock](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/core/src/util/effect-flock.ts)
及 [Npm 安装](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/core/src/npm.ts)
与隔离目录中的锁 owner、heartbeat 相互印证。
当前仅给 V1 initialize 90 秒有界窗口；其他 RPC 与 V2 保持原期限，不删锁、不新增缓存、不重发任务。
修复后全新 smoke 在 Run 启动约 72.6 秒后准备首份输入，随后实际回复、审批、拒绝及取消全部通过。

取消用例复用原 smoke：预置一个真实 Node fixture，启动后写 STARTED，再等待 30 秒准备写结果。
确认 STARTED 后才取消，35 秒后检查结果文件不存在；这避免模型在启动工具前拒绝 Shell 直接创建
文件而导致“取消尚未覆盖”，没有把模型拒绝或虚构的工具事件当成取消成功。

| 本轮检查 | V1 `1.18.32` | Brew V2 `2.0.25` |
| --- | --- | --- |
| 开发版默认发现、真实回复、版本页面 | 通过；命中原 V1 路径，真实回复及界面截图核对 | 通过；未指定路径时命中 Brew，真实回复及界面截图核对 |
| Bootstrap、实际读取 Skill、bundled CLI、公开/final 去重 | 两轮通过，每轮 1 条公开消息 | 两轮通过，每轮 1 条公开消息 |
| 自动压缩 → 冷恢复 → 下一轮补发 | 原生 auto/summary 1 次，Core observation 1 次，revision 1/1 | 原生 auto completed 1 次，Core observation 1 次，revision 1/1；未生成旧插件 |
| 热续接、冷恢复、用量去重 | 精确 Native Session/Binding 保持，旧用量快照一致 | 精确 Native Session/Binding 保持，旧用量快照一致；根轮统计为 partial，cache write 为 null |
| 写入审批、拒绝、运行中取消 | 实际审批和拒绝各 1 次；取消后 35 秒无延迟文件 | 实际审批和拒绝各 1 次；取消后 35 秒无延迟文件 |
| MCP 更换、相邻队员、撤销、重新分配、删除 | 6 Run、8 次服务端真实调用，旧 Host 隔离且 Session 保持 | 6 Run、8 次服务端真实调用，旧 Host 隔离且 Session 保持 |
| 已结束 Run 的旧 CLI context | 活跃 exit 0、过期 exit 2 | 活跃 exit 0、过期 exit 2 |
| 原生子会话取消 | 本轮未新增该样本 | 独立 general 子会话的 Shell 已启动；取消后 root subagent 与 child shell 均终止，35 秒无延迟文件 |

两次开发 App 均正常退出；验收结束没有本轮 Core/Runtime 进程残留，私有 provider 副本已清理，
日常 App 未退出或替换。CLI 取消租约语义另由现有 Core owner 覆盖，不把结束后的实测扩写成全部授权组合。
脱敏 JSON、失败样本和四张界面截图随任务交付；SQLite、原生完整正文和认证配置不进入附件或仓库。

本轮门禁：Debug Core 与 Desktop build、typecheck、Rust PR 层、OpenCode 定向 6、ACP 70 passed/2 ignored、
health 启动参数 owner 1、Runtime picker 与 Approval dock 独立 Electron 用例均通过。
`pnpm test` 初次有 3 个时间相关失败，未改测试超时；原命令复跑为 239 文件/2616 Vitest 用例全部通过，
后续 Node 339 passed/2 skipped，文档和 Skill 门禁通过。Desktop 一次性驱动修正了 Core-ready 等待、
当前导航 selector 和 Renderer/Core-only 方法边界；已接受的真实请求只验证读回及实际界面，没有重发。
这些是本机 macOS arm64、指定发行包与当前构建的证据，不替代其他发布平台或任意第三方插件的验收。

## 回归 owner

扩展既有 health 启动参数、ACP 配置／压缩／兼容、monitoring 稀疏解析、compaction admission、Fleet、
审批、取消与 CLI 租约测试。唯一新增进程 owner 为
`opencode_host_keeps_prepared_generation_and_stops_conflicting_handshakes`：修复前没有代际冲突停止，
V2 也会生成旧插件。既有 capability owner 只验证 initialize 参数，不能证明正文边界、健康 Host 身份与插件隔离；
新测试使用本地 shell/pipe，无模型／网络／日常数据，属于 extended-tests。

最小命令为 `cargo test -p rovai-core --features extended-tests --lib`，分别过滤 `opencode_`、
`acp::tests::`、`health::tests::`、`monitoring::tests::runtime_parsers_emit_sparse_usage_without_antigravity_inference`。

本地门禁通过：`cargo check --workspace`、`cargo fmt --all -- --check`、`pnpm test:rust:pr`、
`pnpm typecheck`、`pnpm test`（239 个 Vitest 文件、2613 个用例，及既有 Node／文档／Skill 门禁）。
定向 extended-tests：ACP 67、health 22（另 2 个手工用例 ignored）、Fleet 23、compaction 3、
CLI lease 2、usage parser 1、旧 Session compatibility 1；这些集合有重叠，不合计为独立覆盖数量。
文档执行 `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=1126875f0 pnpm docs:check:ci`。

## 与当前主干合流

PR 创建后合入 `origin/main` 的 `4d9285e29`，保留其 Cline／Command Code ACP、迁移与进程清理改动。
初始工作区自带的 `1126875f0` DSH 打开菜单测试仍保留；合流只合并其结果文案，不删除既有断言。
Core 更新为 0.4.7；重跑 workspace check／Rust PR 层、typecheck、Node 全套、文档基线检查均通过，
Vitest 为 239 文件／2616 用例，ACP 定向 70 passed／2 ignored，health 22 passed／2 ignored。
合流实测构建 SHA-256 为 `c167fcd5120ec586ccfb45012c591c89b5e0127fc230f7bdfc457ce2f27dc6c0`。
该构建重新通过 V1 普通执行／审批／拒绝／运行中取消，V2 原生子会话取消及 MCP 完整 8 调用矩阵。
V2 协作、公开去重、冷恢复与自动压缩联合样本通过：1 个原生 completed occurrence、1 次 Bootstrap
补发，requested／acknowledged revision 均为 1，冷恢复前后用量快照一致。

额外启动现有 Windows Runtime CI，首次在既有 Fleet receipt owner 的即时 `tree_is_empty` 断言失败；
该 fixture 只等待 leader 退出，没有等待 Job 活跃进程归零。沿既有 ManagedProcess 测试做法，在 5 秒有界窗口内
等待真实 Job 为空后再验证收据，不放宽最终断言，也不改生产回收逻辑。它仍不替代真实 Windows OpenCode 模型验收。

协议事实依据精确 [v2.0.26 源码](https://github.com/anomalyco/opencode/tree/v2.0.26/packages/cli/src/acp)、
[ACP 文档](https://opencode.ai/v2/docs/cli/acp/)及[权限规则](https://opencode.ai/v2/docs/permissions/)，
并通过实际发布包核对；普通执行不依赖版本登记。
