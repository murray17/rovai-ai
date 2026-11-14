---
document_type: implementation-record
version: v1.72
status: preview
last_updated: 2026-11-14
---

# Goose 官方 ACP 接入

已确认 [R1](model-context-change-goose-acp.md) 后，在 `rovai/goose-acp` 独立 worktree 实施。
研究起点为 `c7295e2b0b4667a5434c855cd2dd456bcf637e4c`，实施前合并
`origin/main@f3719e667e260d7227ad0111a77ecbb485c901e1`，不修改主 checkout。
当前合同为 [Runtime Launch v92](../../contracts/runtime-launch-and-verification-v92.md)，差异选择见 [D86](decisions.md#v1-72-d86)。

## 基线差异和共享入口

| 范围 | 最终实现 |
| --- | --- |
| 产品身份 | `goose-cli`、官方 `goose acp`、现有入口发现与版本检查；Migration 224 将闭集扩至 schema 174 |
| Bootstrap | 共享冻结全文，经原生 keyed append RPC 每轮更新；成功后才发 Dynamic Context，不生成 instructions 文件 |
| Session/Host | 共享 ACP/Fleet，精确 `session/load`；配置不兼容时通过现有获取入口回收旧 Host，不能停放后复活旧 Host |
| 插话 | 原生活动 Run ID 先确认初始接收，原生 steer 的 runId/messageId 确认补充输入；成功不强制退役 |
| 取消 | 共享 2s interrupt / 2.5s flush / 3s 非 Windows 总期限；确认收尾后走原 Reusable，异常沿原回收 |
| 模型 | 原生 Provider inventory；Provider/Model 不透明路由；`thinking_effort` 按需查询，沿既有表单及历史展示 |
| 权限 | 原生 auto/approve/smart_approve 与原始审批选项；默认 auto，经原生 mode 选项生效，不建第二权限求值器 |
| MCP | 保存不清理；冻结前形成稳定 owned 名；load 后、prompt 前原生 list/remove 撤回旧分配，保留用户扩展 |
| cwd | 不同 cwd 的 stdio 使用已有 bundled Rovai launcher；Node 仅为测试 MCP 明确指定的程序 |
| 工具 | 原生稳定 toolName 映射共享文件、命令及子代理展示；write/edit 无完整前像时不生成 Diff |
| 用量 | 累计 input/output、累计估算费用与 Context Gauge 分开；逐消息仅补 cache，不读 Goose SQLite |
| UI | 现有模型、思考强度、执行模式控件与官方图标；安装指南保持普通短文案 |

新增薄层集中于 `goose.rs` 的原生词汇/数值映射和现有 ACP 的接口调用。
没有新增进程池、Steer 队列、取消状态机、认证副本、MCP 管理器、原生数据库 reader、Node wrapper、hash 校验或装载握手。
既有 macOS 资格登记的 revision 随兼容性登记文档更新；没有为 Goose 新增安装校验或资格摘要机制。
Kilo 的权限 Hook、instructions 文件、第二个 prompt 与无条件 Steer 退役均未复制到 Goose。

## R1 模式范围的实施收窄

原方案列出了四个原生模式。固定上游 `ops_toolcalling.rs` 的 Chat 分支跳过所有工具，
`prompt_manager.rs` 也明确生成 no-tool System 提示，因此 `chat` 无法调用必须使用的 Rovai 公共发送 CLI。
本版只开放 auto/approve/smart_approve；不为 chat 绕过公共输出合同，也不把原生 final 自动公开。
这是可执行模式范围的收窄，B/P 构建、字段形状、投递位置与版本轴保持已确认 R1。

## 证据边界

真实官方程序为完整 CLI **1.59.0**，固定源码 `5d03ef6ed07ba59826328f1aff18d9a754ff8ad2`，macOS arm64。
以下原生探针与 Core smoke 的模型响应均来自独立 loopback Provider；`fixture-key` 为假密钥，没有借用其他 Runtime 认证。
Core、内置 CLI、HOME、Skills、MCP、Goose data、cache、workspace 全部位于脚本新建目录。
Core 与内置 CLI 同目录，未触碰日常 App、SQLite 或用户全局配置。
另有用户明确授权的真实 Sub2API 小范围验收，配置变更与隔离边界见下文“真实 Sub2API 验收”。

- 原生入口：[probe-goose-runtime.mjs](../../../scripts/probe-goose-runtime.mjs)，原生白名单结果见[研究记录](../../research/goose-runtime/native-probe-1.59.0-macos-arm64.json)。
- 产品入口：[smoke-goose-runtime.mjs](../../../scripts/smoke-goose-runtime.mjs)，真实 Core IPC、正式成员配置/投递、官方 Goose 和真实内置 CLI。
- 两个入口职责不同，均保留；原始 Provider 请求与事件只留私有夹具，公开文件只导出白名单。
- Renderer 通过生产组件的浏览器内存夹具验收，日/夜主题中名称、官方图标、短安装指引和布局正确；不等同打包 App 验收。

## 14 轴结果

| Checklist 轴 | 已有证据 | 仍未验证或不支持 |
| --- | --- | --- |
| Auth/Provider/Model | 非生成目录、Provider/model 路由；合成 gpt-6.1-sol/high 请求含 reasoning.effort=high；真实 Sub2API/gpt-6 普通回复、write/edit 与 Core CLI 发送 | OAuth、其他真实 Provider/模型；ACP authenticate 不证明登录 |
| Host/Fleet/LRU | 同 Host/PID Warm；取消后同 PID；不兼容配置进入共享退役 | 并发压力和跨平台 LRU |
| Session/Continuation | Core 重启后新 Host 加载原精确 Session | 原生历史损坏、并发多 Binding 全矩阵 |
| Bootstrap/Context | 原生持久 key 与 Provider System 中的完整 B 一致，普通 user 无重复 B | 图片与大附件 Core/App 实测 |
| Compaction | 原生及 Core 自动阈值、真实 overflow 错误后摘要/重试；后继 B 保留 | 不承诺父 B 进入摘要或子代理；未另建压缩插件/观察器 |
| Skills | 原生 load_skill 实读项目 .goose/skills；原生探针覆盖更新/删除 | 完整 Toolbox Assignment 和各平台技能目录资格；仍 DocumentationOnly |
| MCP | A→B→撤回、原 Session 保持、旧工具消失、不同 cwd、原始 argv、保存不杀 Host | 远程 HTTP 和多 Binding 并发 Core 验收 |
| Tool/Action/Output | write/edit 实际结果、shell 输出去重、7.5 KiB 永久预算、delegate provenance | 原生 write/edit 无完整前像，完整 Diff Unsupported |
| Narration/Final | 正式内置 send 发布，普通 Run 不产生第二份 final | 所有模型、provider 的叙述形状 |
| Permission/Workspace | Core 原生 approve 审批 allow_once；原生探针 allow/reject | 完整 Core deny/read-only 矩阵 |
| Built-in CLI | 正式 CLI、public send、同进程新 lease、旧 lease 拒绝 | 每个 CLI 操作的 Goose 专属真实模型验证 |
| Usage/Cache/Cost | 累计每轮基线、cache 不双记、独立 Gauge；原生估算费用如实标注 | 真实账单；压缩 cache 缺失保持 partial，不能补零 |
| Retry/Queue/Cancel | 插话提前 ACK，成功 Warm；普通取消同 PID/Session、新 Run/lease，旧租约拒绝 | Goose 专属全部断连/迟到/无回包注入矩阵 |
| Ready/Version/Platform | 静态安装与 Provider 认证分离，现有版本读取；macOS arm64 Preview | Intel、Linux、Windows NotQualified；不声明 FirstClass |

九项 Golden Flow 尚未全部取得完整真实账号/故障证据，因此这次交付是 Preview。
并发、完整 Safety/Output、真实账单和故障回收不能由一次普通成功或其他 Runtime 的测试推导。

## 回归和失败证据

Rust 扩展现有 owner，不新增测试函数：模型路由/选项、权限默认、Skills 组、MCP 稳定名字、
闭集迁移原子性/rollback、平台矩阵、Bootstrap、Steer ABI admission、原生数值 parser 和 Fleet Binding 范围。
前端扩展现有 Runtime 列表和原生 effort 用例，不增加新控件。

实施中保留了真实 Core 失败对照：初始冷恢复遗漏 load 准入、审批运行实例遗漏统一查找、
原生初始接收遗漏导致 Steer 未准备、共享 Steer 退役标记导致成功后冷启，均已通过对应原生 Core 场景修正。
另增加“不兼容旧 Host 已回收、不能在配置撤回后复活”和“首轮与 Warm 相同调用费用一致”断言，
避免只看结果成功而漏掉生命周期/数值边界。
完整命令结果和最终白名单另记于验收结果；先前失败不当成通过，也不扩展为跨平台资格。

## 用户复核后的精简（2026-11-14）

User sequence 123 要求能收窄的请求、存储和文件创建都收窄；基线为 `6902e8e8d5`。
本阶段增量合同为 [Runtime Launch v91](../../contracts/runtime-launch-and-verification-v91.md)，
不改 B/P 正文、选择或投递位置，不截断模型会话历史，R1 和各模型输入版本轴保持不变。

| 原行为 | 收窄后 |
| --- | --- |
| 相同显式配置仍设置 Provider/model/effort | 复用已报告选项，相同值省略；未知仍设置，恢复原生默认仍重新解析 |
| 原生模式单独调用并维护选择状态 | 使用同一原生 mode 选项接口及既有会话快照，无第二份状态 |
| 每轮 extensions/list | 只在精确恢复后撤回旧分配；正常兼容复用不查询，新 Session 不查旧项 |
| 冷恢复向客户端回放全部历史 | 原生 replayTail=1，只减少客户端回放；模型仍拿完整原生会话 |
| 探测创建会话后只停止进程 | 在同一绝对期限内精确 session/delete；选项失败仍清理，删除拒绝如实失败 |

官方 1.59.0 的原生列表与实际 Provider 请求分别观察 auto/approve/smart_approve：每种均为 17 项，
没有 ask_user、AskUserQuestion 或 request_user_input 类工具。MCP 表单仍由原生返回 cancel，后继任务可继续；
不新增问卷 UI、工具猜测过滤器或原生权限覆盖。

Skills 管理实际走 nativeSkills.list/read，Core 已验证用户 `~/.agents/skills` 发现与正文读取；
生产 NativeSkillsSettings 的隔离 Electron 夹具验证选择 Goose 后路径与预览，复用原组件、不新增产品控件。
这不提升完整 Skills Assignment／跨平台矩阵的验证标签。

没有新 instructions、权限插件、MCP 配置副本、数据库 reader 或常驻服务。
共享 CLI context、Run tmp、MCP 冻结快照仍按既有生命周期管理，官方会话库／模型缓存／最近 10 份请求日志仍存在；
不声称零写盘，不新增文件旁路删除器。

扩展原有 live-model owner 的第一版夹具漏掉轮间解绑，被共享归属检查拒绝；
补齐夹具的原解绑步骤后通过，没有放松生产隔离断言。协议、Core 与 UI 原始结果保留在隔离验收目录，
公开证据仅导出固定白名单。

本轮定向结果：官方原生 58 次受控请求、Core 18 成功／1 取消通过，目录与选项探测原生会话均为零残留；
原 live-model／健康探测 owners、`pnpm test:capability-workspace` 与 `pnpm typecheck` 通过。
既有 UI 夹具在 Goose 下显示 `.agents/skills` 路径和正文；没有修改生产 Renderer。
新增 Rust 测试函数为零，没有改变共享恢复隔离、取消期限或 CLI lease 规则。
本轮 workspace 复跑：438 Core lib、31 CLI、4 host、11 web 通过，保留原有 1 ignored；
文档三项通用门禁通过，差异门禁同时使用本轮基线和分支实施基线。

## 最终选定验收

[Core 白名单证据](../../research/goose-runtime/core-smoke-1.59.0-macos-arm64.json)记录 **18 个成功 Run、1 个取消 Run**。
原生探针在本次精简复跑 58 次合成 Provider 请求（新增三模式工具集合观察）；二者不混加为真实付费 Run 数。
同样两个模型调用的首轮/Warm 均为 input 200、output 40、cache-read 20，原生估算费用一致；
缺失 cache-write 保持 null，Context Gauge 独立进入监控。
仅将已知 Session 费用快照保留为下一轮基线，原生费用缺失事件仍保持 unobserved。

- `pnpm typecheck`、`pnpm build:desktop` 通过。
- `pnpm test`：Vitest 276 文件、3282 通过、2 跳过；Node 测试 377 通过、2 跳过，文档/Skills/壳层门禁同时通过。
- `cargo test --workspace` 使用 `RUST_TEST_THREADS=2` 控制本机并发；438 个 Core lib、31 个 CLI、4 个 host、11 个 web 测试通过，保留原有 1 个 ignored。
- extended-tests 的目录、数值、迁移、MCP、默认、Skills、Steer ABI、metadata、Fleet 和原请求/迟到事件插话回执既有 owners 通过；新增 Rust 测试函数为零。
- `pnpm docs:test`、`pnpm docs:check` 与固定实施基线 `DOCS_BASE_REF=f3719e667e260d7227ad0111a77ecbb485c901e1 pnpm docs:check:ci` 通过。

第一次并行默认回归有一个进程探针因 stdout cleanup deadline 失败；保留失败日志，未改超时或删除断言。
控制本机并发后完整 workspace 通过。后续 Goose 独有边界以官方 Core smoke 与相应既有 owners 复测。

## 真实 Sub2API 验收（2026-11-14）

User sequence 128 明确要求配置本机官方 Goose 并测试真实模型。使用 Homebrew `block-goose-cli` 1.59.0，
原生 `custom_providers/custom_sub2api.json` 声明 OpenAI engine 与 `base_path: v1/responses`；
`config.yaml` 选择该 Provider 和 `gpt-6`，凭据进入官方文件存储 `secrets.yaml`。
保留原配置的 telemetry 设置，不修改 Kilo/OpenCode 配置或系统环境，不增加 Rovai Provider 转发器。
本机 Sub2API 目录报告 `gpt-6`，未报告此前合成夹具使用的 `gpt-6.1-sol`。

首轮自定义 Provider 只指定 Responses URL，原生路径推导追加了 Chat Completions 路径并失败；
改为官方 JSON 的显式 `base_path` 后通过。该修正只在用户原生配置中，不修改 ACP 接入。

[白名单证据](../../research/goose-runtime/sub2api-real-1.59.0-macos-arm64.json)覆盖：

- 官方 `goose acp` 从文件读取默认 Provider/model，无 Provider、model 或凭据环境覆盖；真实文本响应 `end_turn`，约 3.8 秒。
- 真实模型依次调用原生 write/edit，Unicode 与空格文件路径的最终内容准确，约 7.8 秒；测试 Session 经精确原生删除。
- 隔离 Core 复制这份已生效的原生配置，目录发现 `custom_sub2api/gpt-6`；真实 Run 成功，write/edit 都进入共享 file-operation 投影，并通过正式 bundled CLI 发布结果。
- 文件行、状态与预览入口复用现有共享组件；没有完整原生前像，仍不生成完整红绿 Diff 或增删计数。未启动打包 App 重做该真实 Run 的 UI 验收。

自动验收 HOME、原生 data/cache、项目、Core data、Skill 与 MCP 根均独立；用户原生配置本身是本次明确授权的修改。
私有验收目录中的临时凭据副本在完成后删除，公开记录不含密钥、完整用户配置或 Provider 请求正文。
这次结果不替代既有合成故障矩阵，不提升平台资格，仍为 macOS arm64 Preview。

## 目录与参数探测收尾（2026-11-14）

User sequence 130 以 21a086f10447fd9d2ea466597e2fb410f7f15e9e 为审查基线。
当前合同更新为 [Runtime Launch v92](../../contracts/runtime-launch-and-verification-v92.md)，
沿现有 worktree 实施，没有修改 Bootstrap、Dynamic Context、原生会话历史或 R1 输入版本。

| 范围 | 本次结果 |
| --- | --- |
| 完整目录 | initialize 后直接调用原生 providers/list 与 defaults/read，不创建/删除 Session，不切模型 |
| 目标 thinking_effort | 保留必要临时 Session，不读取 inventory；跳过已确认同值，Provider 回显后重新判断 model |
| 参数发布 | 现有目录事务只合并目标选项/观察 metadata，保留其他 Provider、默认标记、目录名称和成功时间 |
| 初始/过期目录 | Renderer 先独立初始化一次目录，再订阅目标；有效目录下不重复读取 inventory |
| 新 Session 默认 | 已由原生选择默认，不再立即重复设置 provider=goose |
| Warm/冷恢复默认 | 保留原生别名重新解析当前默认，包含显式模型切回默认；本轮不改变外部配置生效时机 |
| 迁移重复 | Goose/Kilo 共用闭集检查与 trigger 保护下的改写 helper；各自迁移号、schema、事务、回滚不变 |

目标查询返回局部数据后，若继续按完整目录覆盖 SQLite，会丢失其他 Provider 的条目。
因此在既有 commit 入口增加可选目标语义，事务内只修改该条目的参数；普通目录/其他接入调用保持原义。
这是沿用原目录存储，没有新增参数表、模型缓存、配置镜像或第二份目录来源。

思考强度继续与 MiniMax/DSH 使用相同的共享目标队列、缓存预读、在途合并、过期复核和迟到响应隔离。
字段分别为 Goose thinking_effort、MiniMax thinkingEffort、DSH reasoning_effort，值均来自对应原生响应。
用户保存的未知值不会被刷新静默改写；原生确认无选项可缓存为空，失败不能变成“无档位”。

新增确定性反例保留原 delete_error、session_error 和目标失败清理断言。
UI 夹具首次没有实际设置过期状态，随后模拟的目录时间又早于安装投影，被原有迟到保护正确拒收；
修正夹具过期条件与单调时间后，既有原生选项显示断言通过，没有放松生产时间检查或删除断言。
原生脚本扩展中的局部重名在启动前被语法检查发现并修正，不作为官方程序失败。

官方 1.59.0 的原生探针在任何 session/new 前完成目录/defaults 读取，原生会话行数为零、生成数为零；
全探针仍完成 58 次受控响应。Core smoke 完成 18 成功/1 取消，另一个 Provider 的模型、原生默认和
完整目录时间在目标查询后保持，实际受控请求仍含 high。
真实 Sub2API/gpt-6 的目标查询返回 off/low/medium/high/max；只覆盖 high 的正式 Core Run，
write/edit 与 bundled CLI 发送成功，不据此宣称所有档位、Provider 或平台已验收。
明细见[本轮白名单](../../research/goose-runtime/catalog-options-1.59.0-macos-arm64.json)。

本轮回归：health 边界、live selection、catalog parser 与 catalog migration 既有 extended owners 通过；
持久化 target slow owner 使用 slow-tests/extended-tests 实际执行 1 项并通过。
初次 extended-only 筛选为零匹配，不能作为通过；补开 slow 后，夹具缺少“已确认”状态被生产 guard 拒绝，
补齐真实参数观察应有的状态后通过，保留失败记录和拒绝断言。
默认 workspace 为 438 Core lib、31 CLI、4 host、11 web 通过，保留原 1 ignored；
原生参数组件 41 项、类型检查、共享 Electron picker（含成员/创建入口）及文档三项门禁通过。
