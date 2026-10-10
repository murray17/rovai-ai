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
| 压缩 | V1 保留 session.compacted 插件。V2 在插件生成／注入之前分流，接入原生 ACP session_info_update 的 opencode/compaction 完成标记。根 Session 的 completed＋messageId 驱动既有 Observer／Requirement；started、failed、child、历史 replay 不补发。原生 occurrence 去重、quarantine 与下一输入的 Bootstrap 补发继续复用。 |
| 可选交互 | 不声明未实现的 elicitation.form 或带 summary/patch 的 session.compaction capability；权限交互继续原生 ACP options。V2 压缩完成标记承接协作连续性，不关闭自动压缩。 |
| 用量 | V1 保留只读原生根 Session reader；V2 停用该 reader，接 prompt response 当前根会话本轮已报告用量，按 V2 缓存／reasoning 语义归一。复用 scope、checkpoint 和部分统计；未覆盖原生子会话／委派，不标完整 Run 总量。缺响应／字段保持未知，Session 累计成本不算本轮成本。 |

macOS 的 V2 `2.0.26` 包尝试从构建机 `/home/runner/...` 路径加载可选 msgpackr 原生模块，
本机 autofs 因此阻塞。隔离 syscall 追踪定位后，包已有的
`MSGPACKR_NATIVE_ACCELERATION_DISABLED=true` 可恢复正常 ACP 启动。
macOS V2 启动及代际尚未知的模型目录读取在用户未设置该变量时补充此环境值，
不修改原生全局配置。模型目录复用两代共有的 `acp` 入口，不增加版本子进程；普通 V1 执行仍保留 `--pure`。

## 发布包与验证

| 样本 | 平台 | 已有证据 |
| --- | --- | --- |
| V1 `1.18.32` | macOS arm64 | 原 `acp --pure --log-level ERROR` 保持。协作、审批、取消、冷恢复、MCP 三服务器与配置生命周期实测通过。 |
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

额外启动现有 Windows Runtime CI，首次在既有 Fleet receipt owner 的即时 `tree_is_empty` 断言失败；
该 fixture 只等待 leader 退出，没有等待 Job 活跃进程归零。沿既有 ManagedProcess 测试做法，在 5 秒有界窗口内
等待真实 Job 为空后再验证收据，不放宽最终断言，也不改生产回收逻辑。它仍不替代真实 Windows OpenCode 模型验收。

协议事实依据精确 [v2.0.26 源码](https://github.com/anomalyco/opencode/tree/v2.0.26/packages/cli/src/acp)、
[ACP 文档](https://opencode.ai/v2/docs/cli/acp/)及[权限规则](https://opencode.ai/v2/docs/permissions/)，
并通过实际发布包核对；普通执行不依赖版本登记。
