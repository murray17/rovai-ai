---
document_type: contract
name: Hermes Managed Runtime
version: v1
status: accepted
source_version: v1.72
last_updated: 2026-10-24
---

# Hermes Managed Runtime v1

`hermes-cli` 复用 [Runtime Launch v71](runtime-launch-and-verification-v71.md)、共享 ACP Host、Fleet、
Run 队列、Replay Quarantine、CLI lease 与 Explicit Send。以下补充只适用于 Hermes。

## 安装与进程

最低支持官方 source install **0.22.4**，不按 commit、dirty 状态或版本上界锁死。
`ROVAI_HERMES_BIN` 与通用启动设置选择入口。通过官方 `--print-runtime-command` 保留安装绑定的
绝对解释器、`-I` 与 bootstrap，只替换最终入口为私有进程启动器。不修改安装源码，不构造或覆盖
原生 Agent、SessionManager 和工具执行器。实际执行入口为未改写的 `hermes --profile default acp`
与 `hermes --profile default gateway run --force --no-supervise --external-supervisor`。

普通链路为 **共享 ACP 客户端 → 官方 hermes acp → 官方 Gateway**。启动器准备私有 Home、启动
专用 Gateway，然后在同一进程直接运行官方 ACP，继承 stdin/stdout；不读写、转发或过滤普通 ACP 消息。
每个 binding 保有持久原生 Home，每 Run 冷启动，结束后由 Fleet/ManagedProcess 回收整棵执行树。
Core 启动沿既有 owned-processes 记录清理遗留进程。只退出 ACP viewer 不算结束实际执行。

同 Binding 的执行与维护复用共享调度 lane、Fleet owner 和原生 Gateway 所有权；不再持有 Hermes
全局锁或额外 storage flock。启动器仅连接自己刚启动、PID/Home/external supervisor 匹配的 Gateway，
不接管日常共享 Gateway。每 Run 只启动一次，不自动 respawn；专用子进程通过官方
`HERMES_GATEWAY_MAX_STARTS=0` 避免把正常逐 Run 启动误判为守护进程重启风暴。
Hermes 外层 ACP initialize 使用 90 秒预算，覆盖 Home 准备、启动器最多 55 秒的 Gateway 就绪等待及后续
官方 ACP 导入/握手余量；超时仍走既有进程清理，不自动重试或重发输入。

最低版本由官方 ACP initialize 验证。删除 `_rovai/ready`、控制器 PID/revision 握手、补充事件能力的
统一门禁。必要接口按实际调用的原生结果处理，不要求每轮取得额外 receipt、连续事件序号或完整工具证据。
最低版本策略不等于所有新版已验收。

私有 Home 使用选中原生 Home 的 config、`.env`、auth 与 Skills。auth 及其锁、已准备 installs、用户
Skills 连接到原生路径，Run 内禁用隐式依赖下载。相对 Skills 配置仍以原生 Home 为基准，变量按原生 dotenv
环境展开。私有 config 关闭消息平台、profile multiplex、auto-resume、cronjob、原生 memory 注入、
后台 memory review 和标题模型调用。SessionDB、控制 socket 与 Gateway 锁不共享。
配置保留稀疏的原始 YAML 副本，不展开整份原生默认值。文件缺失、空白、只有注释或显式 null 均按空配置；
仅在需要改写的配置节兼容缺失/null，保留其他字段与变量表达式，源文件不写回。语法错误和错误的顶层类型
明确报错；追加禁用工具和压缩 Hook 时保留已有条目且不重复追加。
binding 首次创建时将原生来源 Home 与 `default` profile 记录在私有 `native-source.json`；后继 Run
继续使用该来源和原 SessionDB。旧 binding 从已有原生链接接续来源；没有来源链接时保留私有 Home
已存的配置，不猜测另一个来源。不迁移 Session 或复制原生数据库。
启动环境里的 Home 变化不替换旧 binding 的来源。受管代码摘要只参与进程兼容性，删除原生配置/凭据摘要门槛；
秘密不进入公开配置和日志，不借用其他 Runtime 的凭据。

与共享同类 CLI 恢复规则一致，使用当前选定且可用的 Hermes。版本、入口路径、安装记录、指纹和配置
变化触发必要的探测及新进程启动，不单独否定原 Session 的恢复资格。实际最低版本与能力由当前进程
验证，缓存版本缺失或过期不构成额外拒绝理由。Hermes 不持有跨成员/Session 的长锁：Fleet 保护同一
binding 的活动 owner，原生 Gateway 保护实际 Home；不同 binding 可以并发启动。

## Session 与输入

官方 `session/new` 返回原生 ID；`session/resume` / `session/load` 精确恢复，历史 replay 留在共享
隔离阶段。原生精确 `data.details=not_found` 只在对应恢复请求上识别为目标缺失；不重新包装私有错误码，
Hermes 不走自动新 Session 回退。旧安装的路径、版本、指纹和普通配置不单独阻止尝试恢复。

恢复历史与新任务准备分开。恢复时先传空 MCP 列表保持原生既有 assignment，再通过一次官方控制调用
查询状态并在 idle 时应用当前 assignment（含显式撤销）。running、approval、queued、unknown 分别
表示恢复成功后有原生阻塞；模型和权限修改随后使用官方 ACP。提交与取消的在途状态、原生 admission、
重连及事件回放由官方 ACP 处理，Rovai 不再另建一套逐 prompt 状态。每 Run 冷启动本身重新连接原存储；
不能用重连自动重发已接受或结果未知的业务输入。正常续聊不要求用户运行维护 CLI。

采用 Hermes 专属 `first_payload`：Core 为成员准备的完整 Bootstrap B 原样放在第一条实际普通任务
P 前，使用 `[Rovai 协作规则]` 分隔，同一次 `session/prompt` 提交；不增加确认调用。
规则变化使用“规则更新”块；原生压缩完成后的下一普通输入使用“规则恢复”块。准确字节见
[已确认 R1](../versions/v1.72/model-context-change-hermes-first-input.md)。B/P 的内容来源、Formatter 和共享选择不变。
这是 **user 层协作规则**，不提供 system/developer 层优先级。启动器不解析或覆盖 personality、
agent.system_prompt、HERMES_EPHEMERAL_SYSTEM_PROMPT；这些值继续由原生 Gateway 自行解析。

“首次”按 Native Binding/generation 对应的原生 Session 和 `runtime_input_delivery.status=accepted`
判断，进程重启不重复。完整 B 的 SHA-256 包含成员身份，下一普通输入接受后才推进已投递状态。
Hermes envelope v1 在既有输入账本增加 nullable `hermes_rules_envelope_version`、`hermes_rules_digest`、
`hermes_rules_delivery_kind`（initial/update/compaction_recovery/none）与 `hermes_runtime_payload_blob_id`。
最终正文复用 Managed Blob 冻结，引用随 prepared 原子持久化，并进入原有 request digest；恢复原字节。
prepared、dispatch、delivery_unknown 均不代替 accepted；未知原任务不得因补规则自动重放。
此处是 Hermes 对“完整身份不进入 Delivery digest/Blob”的明确例外，其他 Runtime 保持原合同。

官方 `post_compaction` Hook 只在私有 Home 配置，并只准入已提交、同 Session 的 `summarize`；
原生 Session 旋转、失败、started、其他 kind 不猜测为当前 Session 的完成事件。
通过既有 CLI observer、Host/relay lease、Binding/generation 与 outbox 去重产生 Redelivery Requirement。
下一条尚未物化的普通输入附带一份当前 B 和本次 P；Steer 不携带规则，也不消费 Requirement。
仅输入 accepted ACK 消费选定 revision，较晚完成事件保持 pending。**不保证当前 Run 内立即补回**，
不额外创建 Run、提示词调用或重放旧任务。通知不可用时不能宣称已恢复。

只依赖原生阈值自动压缩，不新增手动压缩按钮；删除 `_rovai/compact` 和 `_rovai/session_info` 私有接口。
原生 `usage_update` 可提供上下文 gauge，不作为压缩完成信号；protect_first_n 不是永久保留保证。
每 Run 创建新进程树并刷新 Built-in CLI lease，终端通过原生 env_passthrough 获得当前 ROVAI 环境。
旧 managed_system_prompt Evidence 保留原义；旧冻结输入不重写。

Ready 声明 `context.charter.first_payload`、`context.compaction.signal_driven`、
`context.compaction.best_effort`、`session.set_model`、`session.set_mode` 与结构化权限。
不宣称 managed system、native system 保留或受管 reasoning 配置。旧 Ready 在现有发现/检测入口失效并
重新探测；不因此轮换原 Session，也不把静态发现当成验证通过。

ACP 没有同轮插话方法，故保留按需 `session.steer`。共享 ACP ingress fence 先确认精确 Run/Session/prompt
仍活动，再读取当前原生 generation 并提交一次 generation 约束的 Steer；只有 queued 且 generation 匹配
才接受。原生明确未投递时才允许共享队列后继处理，未知响应不重试。正常取消直接用官方 `session/cancel`。
不为 Steer 长期开启第二条 Gateway 事件流。
取消响应可能早于原生提交；若没有本轮执行活动，接受账本保持未知而不是把规则记为已接受，任务终态仍为取消。

## 用户明确处理未知执行

保留已有用户维护入口，不扩展另一套恢复框架。Core 已失败收口、旧进程清理确认后，用户可在普通终端执行：

```sh
rovai app agent-run hermes-inspect --agent-run-id <原中断任务ID> > hermes-inspection.json
cat hermes-inspection.json
rovai app agent-run hermes-discard --inspection-file hermes-inspection.json --acknowledge-effects
```

App 必须已运行。首条只查询原会话 snapshot 与精确 `prompt.receipt`；返回执行身份与警告：
**原任务可能已产生文件修改、公开消息或其他外部效果**。确认文件含 Run/version/epoch、Thread/member、
当前 binding/generation、原生 Session/admission/execution generation；不含业务正文、凭据或原始历史。
检查可以报告 idle、running、approval、queued、unknown；没有唯一且独立阻塞的 unknown 时不提供确认对象。
Agent 受管进程继续禁止 `rovai app`，不开放 Built-in Tool 代确认。

第二条须显式 acknowledgeEffects，Core 重验来源、绑定、成员及清理状态，先持久化用户意图，再启动
Fleet 拥有的一次性控制进程。该进程复用原 binding 的持久 Home，不创建 Run、CLI lease、Session 或
`session/prompt`，不通过普通输入 gate 投递 `/discard` 文本。入口同样解析当前选定的可用 Hermes，
不要求继续使用旧 Run 的安装记录、路径或指纹；原 Run 只确定执行身份、binding 和存储归属。
任何 running、permission、queued 或多个 unknown 均拒绝处理；不顺便释放另一个原生排队任务。

确认后再次查询精确 receipt：已有 terminal 时只报告原生事实；仍为同一 unknown 时调用官方
`prompt.resolve_unknown(session_id, admission_id, execution_generation)`，再核对 terminal receipt
与空闲 Session。官方可能保存同 owner 已捕获的结果，或把丢失执行标为 interrupted；Rovai 不伪造
completed，不把旧 Run 改为成功。用户意图和原生结果分别写入既有 Command 账本，历史输入与效果证据保留。
响应未知时复用原确认文件，按相同身份重查／幂等处理，不能生成新任务或挑选“最新 admission”替代。

进程树回收确认后，用户可在原 Thread 发送一条**新的任务**，沿普通路径恢复原 Session 和新的 CLI lease。
此操作不点击“继续执行”、不创建 continuation Delivery，也不改其他 Runtime 的共享 continuation 会话选择。
当前产品入口为 User CLI，没有新增聊天按钮；普通聊天文本 `/discard` 不能替代它。

## 模型、权限、Skills 与 MCP

目录来自官方 ACP model state，模型选择直接用 `session/set_model`。官方 ACP 没有受管 reasoning
设置能力，本轮删除原生内部 `route_supported_efforts` 依赖与 reasoning mutation，沿用 Hermes 自身配置。
不以通用 `set_config_option` 空 ACK 冒充参数已生效，不制造 Fast 开关。

`default / accept_edits / dont_ask` 是官方文件编辑策略，通过 `session/set_mode` 设置并接收官方 ACK。
它不代替命令审批，也不是 OS sandbox；CoreEnforced read-only 工作区仍拒绝启动。权限请求与响应直接
走共享 ACP。私有 config 继续关闭 clarify toolset，避免问卷代答。

Skills 索引遵循原生 Home 的 skills、create_dir、external_dirs 与禁用列表。`~/.agents/skills` 必须显式
加入 external_dirs；最近 Git 根的 `.hermes/skills`、`.agents/skills` 只在 project discovery 开启且该根
受信时采集。设置页仅用户来源，Thread 候选可含受信项目来源；保留路径身份，不把索引存在当成实际加载。
仅在原生 `.env` 定义的目录变量尚无 Rust 索引等价保证。

私有 Home 只适配必要路径，实际发现和加载仍由 Hermes 执行。`external_dirs` 的字符串表示单个目录，
列表项按原生方式转成字符串、去除首尾空白并过滤空项，再展开环境变量与 `~`；相对目录以 binding
记录的原来源 Home 为基准。`create_dir` 使用去除首尾空白后的非空字符串；空白保留未设置语义。
缺失、null 和其他类型不增加额外校验，原 Skills 链接、未知字段与来源 config 保持。

新 Session 的 MCP 只随官方 ACP `session/new` 绑定，不在创建后重复发现。冷恢复先恢复历史，再读取一次
完整状态快照；idle 时用该快照的 revision/generation 提交一次 `session.mutate(editor_mcp)`，其他执行状态
暂不修改。每 Run 冷 Gateway 需要重建凭据与连接，不能因持久分配列表未变而跳过。空 assignment 通过
显式 mutation 撤销，因为原生 ACP load 的空列表本意是保留。

原生操作正常返回的已发现服务子集可继续使用，缺失服务通过现有诊断告警；全部外部 MCP 都不可用时，
仍允许原生工具和普通对话。保留用户分配，同轮不自动重试发现。新建优先呈现原生日志，恢复的结构化结果
可报告缺失名称；不为展示再发一次发现。RPC 断线、异常返回、状态冲突及未确认的撤销仍报错，不能当作
部分发现失败，也不能把缺失返回字段当作已撤销。快照只在紧接着的操作内传递，不建立状态缓存或轮询。

Gateway 启动前从私有 config 排除 Rovai assignment 同名的原生 MCP，其他原生服务保留，源 config 不变。
工具可能经 tool_search/tool_describe/tool_call 延迟发现，不能只检查直接 tools 数组。

## 结果与观测

普通请求以官方 ACP 的相关响应为准，共享客户端校验请求与 Session 归属：

| 原生结果 | Core 处理 |
| --- | --- |
| 明确成功，补充详情缺失 | 正常结束；缺失详情保持未知 |
| 明确失败或取消 | 保留原生终态与已有输出 |
| 连接中断或无法确认执行结果 | 保留未知，不自动重放 |
| 不属于当前 Session/请求 | 不错误关联到当前任务 |

公开 Send、任务结算和输入去重继续遵守共享产品规则。模型自然语言不作为成功证明。
删除额外 Gateway 工具/用量事件订阅、序号连续性检查、逐轮 replay/receipt 对账及 rawInput/rawOutput 重建。
官方 tool_call/tool_call_update 原样进入共享活动投影，不过滤后再模拟另一套事件。原生失败错误不会变成 end_turn；
已接受活动或明确 `admitted_turn_failed` 不声明为可安全重试的未接受输入。其他不明错误保留不确定性。

官方编辑 Diff 可能只是预览或片段，不能声明完整文件状态；现有工具结果文本、位置与操作记录按原生实际
字段显示。删除 Hermes 专用 patch 解析、私有 mutation/file-state 接口和完整 Diff 承诺。原生缺少参数、
文件片段或结果细节时保持缺失，不扫描磁盘补证，不使明确成功的任务失败。既有持久化证据仍可读。

官方 PromptResponse.usage 是 Session 累计值，不能作为本 prompt 的 delta 入账。删除逐 prompt 的
stats/事件/receipt 增强采集后，当前 Hermes 任务消耗（含失败前已知但 ACP 未单独报告的用量）保持未知；
不估算费用，也不把上下文 usage_update 当消耗。以后只有原生提供可可靠归属的计数时才恢复该能力。
ACP 图片继续交给原生媒体流程，具体识图质量由模型与 Hermes 配置决定。

## 准入

macOS arm64 为 Preview，其他平台 Not Qualified。Ready 只证明当前安装/认证/协议探测。
能力证据与限制见 [Hermes 验证记录](../research/hermes-runtime/README.md)。Migration 214 / projection
schema 164 扩展 Runtime、Skill group 闭集；Migration 215 / schema 165 仅增加 nullable Hermes 输入证据，保留既有 Run、Binding、成员、输入与历史。
