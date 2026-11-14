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
当前合同为 [Runtime Launch v91](../../contracts/runtime-launch-and-verification-v91.md)，差异选择见 [D86](decisions.md#v1-72-d86)。

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
所有模型响应均来自独立 loopback Provider；`fixture-key` 为假密钥，没有借用其他 Runtime 认证。
Core、内置 CLI、HOME、Skills、MCP、Goose data、cache、workspace 全部位于脚本新建目录。
Core 与内置 CLI 同目录，未触碰日常 App、SQLite 或用户全局配置。

- 原生入口：[probe-goose-runtime.mjs](../../../scripts/probe-goose-runtime.mjs)，原生白名单结果见[研究记录](../../research/goose-runtime/native-probe-1.59.0-macos-arm64.json)。
- 产品入口：[smoke-goose-runtime.mjs](../../../scripts/smoke-goose-runtime.mjs)，真实 Core IPC、正式成员配置/投递、官方 Goose 和真实内置 CLI。
- 两个入口职责不同，均保留；原始 Provider 请求与事件只留私有夹具，公开文件只导出白名单。
- Renderer 通过生产组件的浏览器内存夹具验收，日/夜主题中名称、官方图标、短安装指引和布局正确；不等同打包 App 验收。

## 14 轴结果

| Checklist 轴 | 已有证据 | 仍未验证或不支持 |
| --- | --- | --- |
| Auth/Provider/Model | 非生成目录、Provider/model 路由；选中 gpt-6.1-sol/high 的实际 Provider 请求含 reasoning.effort=high | 真实账号/OAuth/付费 Provider；ACP authenticate 不证明登录 |
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
当前增量合同为 [Runtime Launch v91](../../contracts/runtime-launch-and-verification-v91.md)，
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
