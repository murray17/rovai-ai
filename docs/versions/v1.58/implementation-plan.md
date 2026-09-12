---
document_type: implementation-plan
version: v1.58
lifecycle: current
authority: implementation-status
status: in_progress
last_updated: 2026-09-12
---

# v1.58 实施与验证

## 已实现

| 问题 | 复用与实现 | 取舍／演示 |
| --- | --- | --- |
| 真实记录缺少可比较的日统计 | Core 只读快照、owner CLI、规则统计与 SVG | 无新数据列；先看 coverage、数量／分母，再让 Automation 分析已准备输入 |
| 上下文改动缺少真实任务对照入口 | Qualification Runner、Case admission、双 View Judge；冻结 build、方案与配置 | 通用 12 Case 和两个 3 Case 专项；hard/Judge 分开；缺 Judge 仍不可通过 |
| 合同测试可能把全局执行结果误分配为逐项证据 | 现有 contract profile 改为每个 selector 记录真实 harness 输出 | 零匹配、忽略、编译失败和超时显式不足 |
| 每周结果可能用重跑成功掩盖失败 | 每周独立有限 campaign 与保留报告投影 | 曲线固定使用首次尝试，所有后续尝试单列 |
| 分析 Agent 不能调用用户级导出 | Main 配置、现有 Scheduler tick、工作区报告 | Agent 只解释文件；App 不在线没有常驻保证 |
| 原评价项容易把非代码任务套入实现／测试要求 | 冻结 generic-task-v2 profile、复用原七个 Outcome ID 与五个 Process ID | 通用质量按 50/25/25 汇总；协作只做三组五项状态统计，未知保留分母 |
| 读者难以从计数找到变化和证据 | 共享离线 HTML、原 JSON／SVG、轻量分析完成记录 | 质量与硬门槛分开；每日比例直接展示数量与分母，日期断点保留，证据限定报告范围 |
| Source Attachment 外部路径仍被复制并预扫目录 | 共享 resolver 保留宿主重检后直接返回 exact stored source path；Camp 与 Single Chat 共用 | 删除 execution-root/Run Temp 参数、复制函数和 `source-attachments` 创建；不新增权限、preflight 或 fallback |

入口：[操作指南](../../development/evaluation.md)、[回归集](../../../qualification/context-regression/README.md)、[架构](../../architecture/execution-evaluation.md)。

## 验证证据

代码实现及本地验证已完成，版本状态因下述运行验收缺口保持 `in_progress`。以下来自 2026-09-10 至 2026-09-12 的实际命令输出，未列出的执行不得推断为通过。私有原始报告留在运行目录，仓库保留脱敏索引和摘要。

| 验证 | 实际结果 | 能说明什么 |
| --- | --- | --- |
| `pnpm test` | 170 个 Vitest 文件、1722 个测试通过；最后一组 Node 测试 232 通过、1 个既有平台测试跳过 | 代码及现有合同回归；不代表模型任务质量 |
| `pnpm test:rust:staged` | 547 个 lib、34 个 CLI、234 个 Main 测试通过；5 个既有 ignored 保持 | 实际工作区编译与默认测试 |
| `pnpm test:rust:pr` | 547 个 lib、34 个 CLI、309 个 slow integration 测试通过 | 仓库要求的 PR 前完整 Rust 范围；与上一行重叠的测试不重复计入样本量 |
| Source Attachment 定向 Rust | resolver 5 项、Single Chat source-path 1 项、Camp source-path publication slow test 1 项通过 | exact stored path、顶层 symlink、目录不预扫、missing/kind-changed、Single Chat owner/run 与 Camp 既有 publication 均有实际覆盖 |
| `rovai-core` all-targets / Clippy | `--all-targets --features slow-tests` check 与 `-D warnings` Clippy 通过 | 新 resolver 签名与五类 Runtime input call site 均编译，无警告 |
| `rovai-core` 全量回归 | Main 237 通过、6 个既有 manual smoke ignored；lib 553 通过 | 合入最新 main 的 Claude 模型目录后，两组全量 Core 回归均无失败；Source Attachment 与保留业务能力一起通过 |
| 文档治理 | `pnpm docs:test`、`pnpm docs:check`、固定 base 的 `pnpm docs:check:ci` 通过 | v9/v4、D06、模型上下文确认记录与 current 路由满足通用门禁 |
| Trace slow-test | 3 个定向测试通过，含当前 SQLite schema 的读写 authorizer 断言 | 不读取正文、不修改状态，排除与跨日回放口径 |
| Case admission | 15 个 Case 的初始 fixture 不通过、reference 两次通过 | 样本／验收器可以区分预设缺陷；不证明 Runtime 会完成任务 |
| 当前合同 Runner | 16 条标准通过，每条引用实际匹配的测试 harness 结果 | 逐项执行证据；先前编译失败记录保留 |
| 日报实际出口 | 隔离空 Core → Trace → Daily CLI → `prepared` 完成，重复生成复用同一成功报告 | 空数据库真实导出与报告链路；Run 数为 0，零分母及 Memory 为 null；不是生产使用分析 |
| 日报曲线渲染 | 实际 SVG 通过 macOS Quick Look 渲染并检查 | 8 个图的标题、零值和未知态可读；单日空样本不构成使用趋势 |
| 真实 Runtime 单 Case | DEMO-101 产物与收口通过；此前 workspace-write 的宿主沙箱失败完整保留 | 当前用户侧执行链路；权限不同，不能比较为质量提升 |
| macOS 嵌套沙箱准入 | 外层受管 profile 内运行子 `sandbox-exec`，实际 exit 71 | 每周 Automation 内的子 Runner 路径受阻；不解除用户 IPC 隔离 |

构建、typecheck、Clippy 与文档治理检查均已实际运行。真实 API Judge、基线／候选完整对照、独立保留集、真实日常分析 Agent 及自动触发均未完成验收，不能用上表替代。

本次 Runtime 构建身份为源码 `eeadf1ab73a23addb7b8677f054080b5fad2425c` 加生产内容摘要 `6d406e4ca0c1c305c3c630c471c1173228773e5f6955252ddc83819ce21f7728`；Core 二进制摘要 `7ce4f3f8be5807869445452057c63fd2face6bda0b9789c1433e758a3271d441`。内容摘要包含当时未提交实现，不能仅凭 HEAD 认为评测的是无改动基线。

### 整轮回归与修正验证

通用 12 Case 均尝试了真实 Runtime 执行，模型配置为三位 Codex CLI `gpt-5.6-sol` 队员、medium reasoning、固定 Case 预算，Judge 为未配置。冻结计划摘要 `2bea552dbaf6c680be6a96e7a2faf50b5fc0862c59724993484e17908545b163`；外层评测器摘要 `2b6891dcc126dcc5523857ae486e341ddce47f15029ad8a3c82aefb780199d8f`。

原始报告为 **degraded**：5 个硬性通过、4 个硬性失败、3 个不足，26 项证据缺口。第一次尝试的周曲线保留 5/12 及未知项；这不是语义通过率。A2A 场景暴露了当前 Delivery 与旧 Runner 的适配错误；历史消息被误当人工干预；工具失败场景的实际产物也未满足验收。原始报告未改写，不能把所有失败都归因于模型或产品退化。

修正只涉及评测器的交接身份／预算投影、投递水位与异常清理，并同步日报的交接统计；Case、reference、rubric、模型及每个 Case 的预算保持原值。三个回归断言先实际失败，修正后相关 42 个 Node 测试通过。对原始 105、109、110 的保留观察重新推导时验证了源摘要：105 的预算耗尽仍是失败，109／110 的历史准备不构成人工干预；这份诊断不替换原报告。

随后用新构建补跑 DEMO-105 与 DEMO-109，二者的真实产物、收口和专项规则均通过：前者接纳两位不同队员的两次交接，后者观察到两次历史读取。补跑构建的生产内容摘要为 `38d15285ca65360481c5b6236f305b32608ee4718eddbc2f84821401c6d35f15`，Core 摘要 `3eced955cdf7e019b6f3bc82fd1646efedece68348d45d28df7cf11a55a8e759`；日报 definition 2 的实际空 Core 导出及同日复用也通过。完整 12 Case 没有用最终评测器重跑，真实 Judge 仍未运行，不能合并挑选这些尝试宣称全套通过。

这些是共享开发主机上的功能验证；期间另有构建／测试负载，未做性能隔离，不据耗时变化归因或声称能力提升。私有证据目录名为 `rovai-context-weekly-acceptance-20260910-01`、`rovai-context-runtime-repair-20260910`、`rovai-daily-export-acceptance-20260910-02`；公开源码不提交原始日志、模型回复或运行环境文件。

### 指标修订与离线报告验证

在上述旧口径实测之后，按[指标修订计划](evaluation-metrics-revision.md)实施 Suite 2.0.0 与评分 2.0.0。原始 Case、fixture、verifier 与准入 seals 不变；新标准不得直接换算旧报告。代码将任务质量与协作诊断分开，所有计划重复先在 Case 内汇总；关键协作未执行、部分满足和未知均不会被质量分抵消。协作分组已有失败时仍保留其他细项缺失原因。

本轮实际本地验证如下，均为评测设施验证，不代表模型任务质量提升：

| 验证 | 结果与依据 |
| --- | --- |
| 完整 `pnpm test` | 171 个 Vitest 文件、1730 个测试通过；最后一组 Node 测试 244 通过，1 个既有 Windows 平台测试跳过 |
| 后续定向验证 | 最终评分／Gate／Judge View 30 项、每周 1 项 Node 测试及日报／HTML 12 项 Vitest 测试通过，覆盖非代码任务、N/A 与未执行、未知／分歧、权重、硬门槛、日期间距和证据安全；与完整测试有重叠，不累计为样本数 |
| 真实 Trace 离线重放 | 用既有隔离空 Core 导出的元数据生成新版日报并执行 prepared；这只重新分析元数据，没有执行用户原任务。零分母显示 N/A，记忆显示不可用，无历史连续曲线 |
| 失败记录保留 | 首次离线配置误把导出时间字段放进 scope，实际结果为 Trace scope mismatch；失败报告保留，修正配置后在独立目录生成成功报告，并补入口类型校验 |
| HTML 浏览 | Chrome 的 1440 与 390 宽度均验证筛选、Case 展开和日报 30 天切换；无页面异常、外网请求或视口溢出。真实 Trace 链接可解析；合成 Gate 夹具显著标注，不作为实际评分 |
| 独立界面复核 | 修正稀疏日期按点数等距与判定列逐字换行；复核两项均 resolved，结论 ship。保留原布局和产品设计世界 |
| 历史报告兼容 | 真实旧周报告补生成 HTML，JSON 保持原值，明确没有新标准分数 |

本轮最终 typecheck、桌面构建、Clippy 和 Rust PR 范围再次通过（547 个 lib、34 个 CLI、309 个 slow integration）；未增加或修改 Rust 测试。共享报告模块的后续改动运行相应定向测试，不把重叠测试累计为新的独立验证样本。

私有本轮证据目录为 `evaluation-metrics-v2-20260910-DtAc8P`；包含原始失败与更正后的日报、测试输出、浏览器检查、显著标记的 UI 测试夹具及旧报告。分析完成记录的成功／失败和引用校验只用合成测试验证；真实日常分析 Agent 仍未验收。

本环境未提供真实 Judge 配置及所需 API 凭据，本轮没有执行新标准的真实 Judge 或完整基线／候选对照。原先 12 Case 的结果继续属于旧标准与旧评测器；不能合并补跑、UI 夹具或测试结果宣称新标准 Gate 通过。

### 宿主链路与后续失败复核

后续增量见[宿主接入与失败复核](evaluation-host-integration.md)。已完成真实 Rovai 定时触发、宿主回归、报告和分析 Agent 交付，以及每日统计到真实分析登记的链路。周回归保留 degraded，缺 Judge 与预算未运行项不算通过；开发版 Electron 的 owner CLI 提交／取消也已实测。旧回归记录保持原样，新增 Case 111 v2 和 ledger 1.1 的版本、修正依据、定向补验与重放在该记录单列。当前权威合同为 [Execution Evaluation v14](../../contracts/execution-evaluation-v14.md) 与 [User Automation v5](../../contracts/user-automation-v5.md)。

## 明确限制

精确 Memory 计数、全来源 provenance、历史 Run build 和完整 native Tool 错误不可用。共用主机上的隔离目录不等于独立主机 Formal qualification。小样本回归不证明统计上的非劣性；用户确认、测试通过与报告生成均不证明实际能力提升。首批独立验收保留集未运行；不会把公开回归 Case 改名冒充保留样本。


## Runtime 外层沙箱清理

- 实现：删除 Managed Process 的 denial-root 全局配置、捕获/派生字段、`sandbox-exec` 包装及 Core 初始化调用；Agent CLI 防误调用继续生效。
- Rust 测试退役：删除 `macos_runtime_sandbox_denies_user_automation_root_but_keeps_other_files_visible`，其生产路径及 OS denial 合同同时退出。现有 Unix stdio/PID/reap 与 Windows Job 测试继续拥有进程合同；现有 CLI 测试扩充单标记、双标记和空值 case，不增加平行 Rust 测试。
- 回归 owner：`core-startup-availability.test.mjs` 新增真实 Core 启动 → Runtime Probe → 子沙箱的集成断言。仅测试 Managed Process 无法捕获旧 Core 启动时注册的全局沙箱，因此使用独立数据和 Skill Library fixture；不提交模型请求。
- 旧构建实测：同一新回归在已安装旧 Core 上失败，子沙箱退出 `71`；候选 Core 返回 `0`。最小独立命令在当前 Codex 环境成功。
- 本地门禁：`pnpm typecheck`、完整 `pnpm test`（Vitest 174 文件、1755 测试及 Node 套件）、Rust PR 范围（553 lib、35 CLI、309 slow）、Core binary 测试（236 通过、5 个既有 ignored）、Clippy、格式与通用文档治理通过。
- 启动集成：完整 Core startup suite 10 通过、1 个 Pi 缺失检查按既有 macOS 规则跳过；同时将该文件两处已失效的 Composer RPC 夹具改为当前 v2 document，保留旧队列恢复的历史存储夹具。真实 CLI 的单标记、双标记及空标记场景均在 User Automation dispatch 前退出 `2`。
- 最小回归命令：`node --test --test-name-pattern='Core-managed macOS probes' scripts/lib/core-startup-availability.test.mjs`。本条 supersedes 本文较早批次的沙箱准入约束，旧失败记录不改写。

## Claude Code 动态模型目录

删除固定家族候选与 help 模型名称筛选；通过当前原生 CLI 的无 Prompt `initialize` 控制交换获取结构化
`models`，保持原生环境、权限、认证和 Provider。映射到统一 `ModelDescriptor`，保存显示名称、描述和单条
`runtimeMetadata`，effort 仅来自明确报告值。现有目录刷新、LKG、过期、已保存选择和 Run 实际模型观察保持分离。
旧 help 目录不能再服务选择或证明当前 Ready；失败不创建 fallback。

当前规范同步至 [Runtime Catalog](../../architecture/runtime-catalog-boundaries.md#claude-code-原生模型目录)、
[Runtime Launch v39](../../contracts/runtime-launch-and-verification-v39.md)、Contracts/CURRENT/文档入口及成员局部 brief。
不新增 Version Decision：此项是按已确认 Runtime 原生权威原则修正局部发现实现，无独立高成本架构取舍。
不更改 Schema/Migration、Native Session Bootstrap、ContextManifest、Activity、其他 Runtime 协议或权限。

测试所有权：扩展既有 Claude Adapter 映射测试与统一缓存边界测试；新增唯一 Claude NDJSON 进程测试，
覆盖真实 managed-process seam 的无用户输入、关联 ID、失败与回收，纯 parser 测试不能证明该进程边界。
原先没有 Claude 初始化进程 owner；只有 `system.init.model`、无相关 `models` 的响应必须失败，不能被旧别名
fallback 接纳。最小命令为 `cargo test -p rovai-core --bin rovai-core health::claude_catalog_tests`。
既有 Claude 错误终态进程测试增加默认/显式模型两行，验证默认省略参数、opaque ID 与原生 effort 值透传，
同时保留原终态错误与脱敏断言。新增 ignored 原生无 Prompt smoke，不调用生成式 Claude Runtime smoke。

验证记录（2026-09-12，macOS arm64）：

- `pnpm typecheck`、`pnpm test`、`pnpm build:desktop`、`pnpm docs:check` 与绑定 base 的
  `pnpm docs:check:ci` 通过。Vitest 174 个文件、1757 项通过；Node 脚本 317 项通过、2 项平台限定跳过。
- `pnpm test:rust:pr` 通过：Library 553、CLI 35、slow integration 309 项；新版 Claude cache admission、
  LKG、旧目录拒绝和保存默认策略均包含其中。
- 最终 `pnpm test:rust:staged` 的 workspace-default 门禁通过：553 Library、35 CLI、237 Main，6 项显式
  ignored；`cargo fmt --all --check` 和 `cargo clippy --workspace --all-targets -- -D warnings` 通过。
- 原生 `claude_catalog_real_runtime_smoke` 通过，Claude Code 2.1.236 的无 Prompt 控制初始化返回五项
  `default`、`opus[1m]`、`sonnet`、`sonnet[1m]`、`haiku`；这些仅是本机当次观察，不能成为白名单或版本映射。
- 一次性生产组件 Electron 夹具验证日/夜主题 1040×700、模型名称/ID/描述、键盘打开、opaque ID 选择、
  目录替换、刷新失败保留选择和默认策略。此证据不冒充真实模型生成。
- `pnpm package:mac:daily` 通过 App/Core/CLI 的 arm64 ad-hoc 签名门；隔离 packaged App 经生产
  `runtime.modelCatalog.open` 返回 fresh 原生目录及完整模型 metadata，未提交用户消息。
- 首次 workspace 门禁发现兼容性登记文件属于既有平台资格摘要；撤回对该文件的编辑，把此次观测留在本文，
  原摘要绑定测试复核通过。浅发现版本测试该次失败后单独复跑和最终 workspace 复跑均通过。

## 飞书接口扫码登录

按用户确认的完整流程说明实现独立 Web 协议适配器、指定 Session 的请求/可信域层和共享身份归一化器。
登录、恢复与后续开放平台 bootstrap 从 HTTP HTML 被动提取，不创建隐藏浏览器；单请求/正文期限与独立总期限、
旧 attempt 隔离和原连接保留由服务测试覆盖。UI 增加 completing_login、手动刷新与提交结果核对动作。
先提交 Core 账号/Session、再激活的顺序不变；丢回执复用同一 commandId，明确拒绝才清理 pending。

当前权威更新为 [Feishu Channel v16](../../contracts/feishu-channel-v16.md)、[飞书渠道架构](../../architecture/feishu-channel.md)和
[渠道设置](../../ui/components/channel-settings.md)，同步 Contracts/CURRENT/开发与文档入口。无数据库 Migration、Runtime、
模型上下文或新版本切换；按用户已指定的协议路线实现，不新增重复的 Version Decision。

本轮验收（2026-09-12）：`pnpm test` 通过，Vitest 176 个文件、1804 项通过，Node 脚本 317 项通过、
2 项平台限定跳过；随后补充绝对截止时间检查，飞书会话服务 31 项与 `pnpm typecheck` 通过。提交激活与
回执不完整、请求域、HTML 解析、控制台 API 和渠道协调器的定向回归共 148 项通过。
`pnpm test:feishu-login`、`pnpm test:desktop-bridge`、`pnpm test:dingtalk-login` 和 `pnpm build:desktop` 通过。
`pnpm docs:test`、`pnpm docs:check` 及以任务起点 `4516ba39f0b2c6c15ec06e64792cef52da855182` 为 base 的
`pnpm docs:check:ci` 通过，`git diff --check` 无错误。
飞书 Electron 验收使用隔离 userData/sessionData，验证原生 Session、逐跳重定向、正文超时、Cookie 恢复、管理请求和
生产 Dialog；截图检查覆盖日夜主题及 200% 缩放。钉钉首次与另一原生窗口验收并行时出现 child view 获取失败，
随后顺序复跑通过；没有据此修改钉钉登录实现。

`ROVAI_FEISHU_LIVE_PROBE=1 pnpm test:feishu-login` 的真实匿名初始化与待扫码查询通过，当前响应没有明确二维码有效期。
该观察不证明真人确认、跨域账号交接、真实 Core 保存或实际 Bot 发布成功，这些仍需有账号的隔离验收。

随后完成独立开发实例中的真人扫码确认与身份读取，暴露并修复两处兼容遗漏：`enter_app` 的空字符串
`cross_login_uri` 应按可选字段处理；Main 已输出 `portalOrigin` 和 `larkoffice.com` Cookie，但 Core 仍按旧 Session
形状拒绝保存。空 URI 的成功与未登录落点回归、Main 保存/激活及请求层共 111 项通过；扩展既有 Core 原子保存测试，
覆盖三个门户与品牌匹配、旧记录、未知字段和相似域拒绝。真实 Core 隔离请求从 `CORE_REQUEST_FAILED` 复现为
`applied`、`sessionRevision=1`。仅更新该开发实例的 Core 后，沿用原 pending 与 commandId 完成核对，数据库提交回执
与界面“已连接”均已确认，无需再次扫码；原始身份、Cookie 和认证 URL 未进入验证记录。结果不明提示去除未证实的
“恢复本地服务”归因。此次证明连接保存与激活，不证明 Bot 发布或消息收发。

同日再次核实匿名初始化：`data.step_info` 只有 `status/token/user/subtitle`，没有明确到期字段；不保存原始票据。
保留 `expiresAt=null` 与本地 `waitUntil` 的区分，收到服务端 `status=5` 后在原二维码区域显示可点击刷新的过期态，
并移除旧二维码；本地总等待结束仍单独提示。113 项定向测试与类型检查通过；Electron 夹具验证刷新入口、键盘焦点、
忙碌状态下的操作、旧码移除和过期/本地超时区分，钉钉共用 Dialog 回归通过。

随后按用户反馈取消两渠道 Dialog 的本地截止时间与会话存储说明。提交前的等待、请求和登录阶段超时统一进入
`awaiting_refresh`，结束旧请求后保留弹窗，让用户点击二维码区域刷新；不显示超时报错或将其称为二维码过期。
飞书兜底调整为扫码 5 分钟、交接 30 秒、身份 20 秒、整体 10 分钟；正常状态仍由渠道响应驱动。
钉钉超时不再由 finally 无条件关闭 Dialog，新尝试、迟到回调与保存阶段分别受保护。
本次定向回归 5 个文件、230 项通过，类型检查与两渠道的隔离 Electron Dialog 验收通过；截图验证亮色、暗色及
200% 缩放下的等待刷新入口。阶段期限测试分别让扫码、交接与 Cookie 身份读取阻塞，确认及时停止且不留下待提交会话。

## 钉钉接口扫码登录

当前边界见 [DingTalk Channel v13](../../contracts/dingtalk-channel-v13.md)，实际官方脚本、接口与匿名实测范围见
[协议调查](../../research/dingtalk-login-protocol.md)。实现独立 Login Protocol/Transport，正常流程本地生成 QR、串行推进状态，
同 Session 完成 SSO 与 `/baseInfo`；官方页只负责额外交互。attempt/generation、取消、独立期限与保存阶段锁定共同隔离迟到结果。
Main/Core/Renderer 支持缺失展示名称，Migration 150 放宽两个名称字段的 NULL 约束，身份与原子提交次序不变。

2026-09-12 的代码与隔离验证记录：

- `pnpm typecheck`、`pnpm build:desktop` 通过；通用文档测试、检查和基于本次 Git base 的 `pnpm docs:check:ci` 通过。
- Core lib 全量 554 项通过；迁移测试补充真实 Owner/应用身份引用后，独立复验通过，覆盖保留关系、触发器和回执失败回滚。
- Vitest 当前共 178 文件、1,844 项；全量复验曾出现评测宿主、Core 启动、日报测试的墙钟期限失败。
  `--maxWorkers=2` 一轮为 1,840 通过、4 项超时；随后对三个对应文件以 `--maxWorkers=1` 复验，30 项全部通过，
  未修改它们的实现、断言或时限。钉钉相关用例均通过，不把全量并发运行描述成一次无失败的通过记录。
- `pnpm test` 的产品指纹断言同步 Data Contract v1.58/schema 100 后独立通过；其余脚本检查在前一轮通过。
- `pnpm test:dingtalk-login`、`pnpm test:desktop-bridge` 通过。生产 Renderer/preload 与原生 sandbox 页面在独立临时目录运行，
  检查本地 QR、SSO/身份阶段、刷新、取消、原账号保留、日夜主题和 200% 缩放；一轮并行截图执行完成断言但退出超时，后续独立重跑通过。
- 生产 Electron 网络层匿名 Probe 在最新代码上再次通过：后台上下文、本地 PNG 与待扫码响应；测试用扫码期限主动结束，未启动 Core。

真实手机确认、企业选择、安全挑战、SSO 后身份确认及 packaged App 的账号操作尚未验收；不据此提升发布或 Stream gate。
临时匿名 Cookie 与二维码响应已清理，不保存到代码仓库或日常账号数据库。本增量不修改模型上下文。

## 渠道登录最终合并验证

按本次最后确认的版本整合飞书与钉钉接口扫码、真实飞书保存兼容修复及手动刷新恢复，并合并 main 的连接菜单方案。
“已连接”随账号呈现，“管理连接”统一承接切换与断开；二维码弹窗不显示本地截止时间或会话存储说明。
提交前超时保留刷新区域，只有渠道明确过期才显示过期；本地提交保护和旧账号保留不变。

- Typecheck、桌面构建、Rust format 与全 workspace/all-targets Clippy（warnings 视为失败）、文档治理与按实际 main base 的 diff-aware 门禁通过。
- 完整 JavaScript 检查以两个 Vitest worker 运行：180 文件、1910 用例通过；后续 Node 317 项通过、2 项平台跳过。
- `pnpm test:rust:pr` 通过：556 Library、35 CLI、309 slow integration，包含展示名迁移的绑定/触发器保留及失败回滚。
- 两渠道的隔离 Electron 登录验收及设置工作区验收通过，使用生产组件，检查连接菜单、二维码刷新、取消、保存保护、
  日夜主题和 200% 缩放。钉钉夹具同步从“管理连接 → 切换账号”进入，避免依赖已移除的旧按钮。
- 桥接验收一轮在输出成功断言后进程退出超时，未改动实现或时限，随后独立复跑通过。

本轮没有借用日常账号或启动真实 Runtime，也没有创建或发布 Bot。此前飞书真人扫码与真实保存的证据边界保持不变；
钉钉真人确认、组织选择、安全挑战和真实 SSO 后身份读取仍未验收，不能用本轮夹具替代这些证据。

## 待发送消息移回输入框

- Core 新增双 owner revision fence 的 `return_to_composer`；一次事务覆盖 Draft 并取消 Pending，旧发送与重复回执不能再次消费。
- Renderer 复用普通 Composer，删除独立编辑器、本地 Pending 导航快照和蓝色编辑状态；错误、加载与目标切换仍有 fence。
- 单聊保留已有窗口内正文草稿生命周期，事务回执携带无路径 Draft View 和正文；没有正文 autosave 或 schema 扩张。
- Rust 新测试分别由 Camp/Single Chat 的转移事务拥有，覆盖 CAS 拒绝、剩余 FIFO、重新入队、回放和发布竞争；旧编辑测试保留兼容 owner。
  该新转移涉及两个持久 owner，纯函数或既有 save/cancel 用例不能证明，使用已有隔离 SQLite fixture。
- 验证：`pnpm typecheck`、桌面构建、Rust format/check/clippy、`pnpm test:rust:pr`（555 Library + 35 CLI + 309 slow）通过。
  全量 Vitest 覆盖 174 文件 / 1790 用例；本机并发运行有进程/定时用例超时，相关 6 文件 / 55 用例串行复跑通过，
  其余 171 文件已通过。`pnpm test` 后续 Node 套件 317 通过、2 项 Windows 专属跳过；文档及 Skill 门禁通过。
- 隔离 Electron 使用生产 CampWorkspace / SingleChatPanel：覆盖已有输入覆盖、队列退回、焦点、无蓝色编辑行，
  以及保存失败保留脏文字、发布竞争拒绝、提交后读取失败重载、私聊丢失回执的同命令重放。
  双向离开竞态和重叠导航使用独立可幂等完成的引用计数 lease，取消一个导航不能释放另一个导航的保护。
  这些夹具不启动 Core、SQLite、Skill Library 或真实 Runtime；需求与规范双轴复核通过。
- 界面证据为合成数据：[公屏日间](../../assets/pending-input-return/camp-day.png)、
  [单聊夜间](../../assets/pending-input-return/single-chat-night.png)。
