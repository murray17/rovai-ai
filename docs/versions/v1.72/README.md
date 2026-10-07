---
document_type: version-overview
version: v1.72
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-10-06
---

# Rovai-ai v1.72：Lark 独立渠道

## Cline Native Hub（2026-10-07）

User 消息 80 要求 Cline 新会话切换到已验证的 Native Hub。当前分支新增 `cline-hub-v1`，使用
用户所选官方 CLI 的独立认证 Hub，复用共享 Fleet、Binding、投递、审批、Builtin CLI 和监控结算。
原生 off/basic/agentic 从实际配置/默认传入，不加入自有压缩器；旧 ACP Binding 保留原后端。
仍为 macOS arm64 Preview。取舍见 [V1.72-D18](decisions.md#v1-72-d18)，精确上下文及兼容说明见
[Native Hub 输入说明](model-context-change-cline-native-hub.md)，验证范围见
[产品接入矩阵](../../research/cline-runtime/hub-adapter-implementation.md)。本次无 schema 迁移，
未改变 current_version；此前实验 shim、ACP 和 Hub 最小探针不替代产品验收。

## 并行实施：Command Code 与 Cline

合入主干 `b2c9c976` 后，Command Code 内部 headless transport 与 Cline 官方 ACP Host 适配当前
Usage v8 / Execution Metrics v7。真实 sub2api/gpt-6-sol 调用取得 input、output、cache read/write，
Cline 另有可选 reasoning；最新根调用输入独立投影 Context used。初轮窗口、比例和费用未知，
不增加指标定时器或输出测速。[真实数值、测试与层级边界](../../research/runtime-monitoring/command-cline-verification-2026-10-04.md)
区分 Core 传输/Host 证据与产品路径，两个 Runtime 都没有由此取得 First-Class。

随后 Cline 在隔离打包 App 中配置叮叮、芝士并完成四轮真实发送：首次、warm、第二名队员、App/Core
重启后的精确 cold 恢复；公开回帖来自 bundled CLI，17 次模型调用的 Usage 与 Context 已持久化，
执行面板可查看 toks 与已知 Context used。[开发包验收](../../research/cline-runtime/app-send-verification-2026-10-04.md)
记录原生未知字段、空闲关闭清理和仍未完成的能力矩阵；本轮不改变模型上下文方案。

文件复核修复 Cline 单文件读取/编辑的标准 location 映射，两名成员在更新开发包中真实读取、编辑、
读回，执行面板文件名与可点击预览均通过。Command Code 内部 Activity 保留原生 file_path，并为已选
Yolo 补齐 headless 写入所需的原生开关；当时只查询普通模型列表，未取得 BYOK 的窗口值。
[文件与上限证据](../../research/runtime-monitoring/command-cline-files-context-2026-10-04.md)区分 App 和内部传输。

编辑内容随后按 [File Change v7](../../contracts/runtime-file-change-observation-v7.md) 接入：Cline 成功 Update
补丁和 editor 替换保留为有明确来源标签的补丁片段，Command 可展开增删，Files Changed 保留按序统计；
Command Code 内部 normalizer 同步候选映射。真实两成员、多文件与连续改回、失败编辑、命令输出、零发送恢复
及能力发现复核见[差异验收](../../research/runtime-monitoring/command-cline-parity-2026-10-05.md)。

后续窗口补查在同一 Provider 的版本化模型目录取得精确 `gpt-6-sol` 默认窗口 272000、最大可选窗口 872000。
Cline observer v2 补齐原生模型配置快照与实际 Provider/模型匹配，沿现有 Session Gauge 展示窗口，
不修改 Bootstrap/Dynamic Context、费用合同或 Renderer 布局；配置和真实验收边界见
[窗口补采](../../research/runtime-monitoring/command-cline-context-window-2026-10-05.md)。

Cline 增加 closed Runtime/Skill identity、共享 Host 接线与 Migration 184，从 schema 133 升为 **134**，
macOS arm64 按 [V1.72-D13](decisions.md#v1-72-d13)开放开发 `Preview`，其余平台保持 `NotQualified`；
完整资格仍在实施。Command Code 随后接入官方 1.74.1 ACP 与共享 Fleet，Migration 185 升至 schema **135**，
也仅在 macOS arm64 开放 Preview。按 User 后续修复要求，Bootstrap 从旧候选 first_payload 改为受管
System Mod；[revision 5](model-context-change-command-code-acp.md)与 [V1.72-D15](decisions.md#v1-72-d15)
记录加载门禁、逐 Session 绑定与失败收敛。Cline 随后按 User 明确指示改为正常 System Rule，
不再以故意缺失插件的极端场景阻挡。冻结 B 逐 Session 绑定、user P 独立，见
[Cline System revision 2](model-context-change-cline-system.md)及 [V1.72-D17](decisions.md#v1-72-d17)。
共享 Core 的 Command 门禁与常驻接线已过；原生默认 BYOK 路径已解决先前额度阻碍，真实模型 A→B→A、
exact cold、手动/自动压缩后连续性及 App 文件/CLI/warm/重启验证通过。显式自定义模型切换仍被上游拒绝，
因此保留原生默认哨兵而不伪造目录。Cline ACP 未传 compaction 配置，真实探针未得到完成信号。完整 14 轴对照与实际验证见
[最新 Checklist](../../research/runtime-monitoring/command-cline-checklist-2026-10-05.md)。

后续真实强杀验收修复共享 ACP leader 退出观察、macOS 身份绑定的后代清理与 Core 启动 ledger 回收，
并将已交付输入丢失后的领域终态和公开投影对齐现行恢复合同。两 Runtime 的 Runtime/Core/App SIGKILL、
超过 75 秒无迟到写入、cleanup 后排队输入自动成功均通过。Command 官方 resume/load 会接受不存在历史，
已增加官方 session/list 精确 ID/cwd 门禁；有效 cold 的 Session/Binding/generation 保留通过。
范围、失败候选和平台限制见[故障恢复验收](../../research/runtime-monitoring/command-cline-fault-recovery-2026-10-05.md)
与 [V1.72-D16](decisions.md#v1-72-d16)，不改变两者 Preview 或未闭合的上游差异。

2026-10-06 追加完成 Command 原生私有 MCP 配置与 Cline System 新包真实验收：两者 first/warm/cold、
文件工具与显式 CLI 发送通过；MCP cwd、字面 env/headers、原生同名优先和更新/撤销边界通过。
同一服务器 Cline 的 stdio/HTTP 真正调用成功，Command 当前 BYOK deferred tools 仍只发现未调用。
完整 14 轴、9 Golden Flow 与剩余限制见[追加验收](../../research/runtime-monitoring/command-cline-native-system-2026-10-06.md)。

本切片更新 Runtime Catalog/Monitoring 架构、兼容性清单、研究矩阵、测试说明与当前决定导航。
活动目录加入 Cline 的保守 run_level 条目，复用既有 ACP typed kind，不改变 activity-v4 或旧 Runtime 解释。
既有 Usage/Execution Metrics 合同足以表达数值，无新字段合同、Renderer 布局或根 README 支持声明。

## 并行修复：HTML 内部诊断 CSP 归因

保留作品安全策略，预览器只将当前内部诊断请求的明确 CSP 拒绝转为中性诊断不可用，并停止该文档的无效重试。
作者脚本、资源和业务策略错误继续可见，页面交互与文档状态不受辅助诊断影响。范围见
[File Preview v21](../../contracts/file-preview-v21.md)；真实浏览器回归覆盖严格 CSP、混合错误、导航及既有断流恢复。
本地 `pnpm test:html-preview` 的 5 项浏览器／Electron 测试通过；严格 CSP 只出现一次内部拦截且作品问题数为零，
混合场景保留 4 项真实错误。TypeScript、完整 `pnpm test`、默认 feature Rust workspace、桌面构建及通用文档门禁通过。

## 并行交付：消息寻址与执行查询

User 于 2026-10-03 确认[方案 r2](model-context-change-thread-runs.md)和[完整提示词对照](thread-runs-prompt-comparison.md)，授权实现、PR 与合入 main。
本次补齐 thread read 正常条目的 addressing，新增 thread runs 的统一执行/排队查询；范围由
[Camp History v11](../../contracts/camp-history-v11.md)、[Thread Runs v1](../../contracts/thread-runs-v1.md)和
[Built-in Transport v35](../../contracts/builtin-tool-transport-v35.md)拥有。旧 Session 保留冻结 Bootstrap，Skill 沿原路径更新；无数据库迁移。

## 已实现：User 统一称呼

[上下文变更说明 r2](model-context-change-principal-user.md)与[完整前后对照](principal-user-context-comparison.md)
整理 Principal 改为 User、`--to-user` 与 `@User` 的已确认文本和兼容边界。旧 Native Session 保留原绑定及冻结
Bootstrap，尚无 Bootstrap 的公开执行统一使用当前公开模板；Skill 沿用随包原路径同步。
用户已于 2026-10-02 确认 r2、创建 PR 与合入 main，并免除上下文 Gate 模型评测。实现及本地兼容回归通过，准备 PR 合入；当前规范见 [User Naming v1](../../contracts/user-naming-v1.md)。

## 并行实施：Thread 统一命名

Principal 已确认 [Camp → Thread r2](model-context-change-thread-rename.md) 开始实施：公开范围使用 `threadId`，
回复链用 `--reply-chain`，兼容旧 Camp 输入，保留旧 Native Session 的绑定与 bootstrap，并沿用 Skill 原路径更新。
实现已完成，完整模型文本见[前后对照](thread-rename-comparison.md)；测试证据与真实任务 Gate 缺口见[验收记录](thread-rename-verification.md)。
main 原 Migration 178 / schema 128 只扩展新 Context 的准入；与指标分支合并后由 Migration 180 收口至 schema 130，兼容已安装指标 schema 128/129 与 main 的 Thread schema 128，不迁移 ID、目录或旧 Session。

前置：[v1.71](../v1.71/README.md)。本版把 Lark 从飞书 provider 下未接通的品牌选项，改为与飞书、钉钉并列的独立渠道。
飞书与 Lark 可以同时连接各自的开发者账号，同一队员可以同时拥有飞书 Bot 与 Lark Bot，两家的账号、Bot、会话和
失败互不影响。

## 目标与边界

- 新增 provider `lark`：独立 Host 身份、5 张与飞书结构等价的表、8 个领域命令类型、21 个 `channels.lark.*` 请求。
- 不复制飞书实现：Core 以 `ChannelProviderSpec` 参数化飞书领域逻辑，Main 以 Provider Profile 创建第二个渠道服务实例。
- 可信域、登录配置与 SDK 域按 provider 分离；飞书 provider 收窄为只接受飞书品牌，不再接受 `larksuite.com`。
- 三张在 CHECK 中写死 provider 值域的中立表重建，两个目录视图增加 Lark 分支；飞书与钉钉既有数据不改写。
- Renderer 增加 Lark 页签、会话来源前缀与未验收提示；自动化通知可以选择 Lark。
- Lark 话题派发沿用群 roster 新鲜度和成员存在性检查，刷新请求与 Bot 发布状态均按 provider 隔离。
- Lark 入站图片与文件复用共享持久下载队列，以独立 Host 完成请求结算，下载完成后作为 Source Ref 进入 Agent 输入；真实租户文件收发仍待验收。
- 不改变 Lark 绑定 Camp 的模型提示。绑定时不注入飞书文件交付提示；扩展该提示需要独立的核心模型上下文变更与二次确认。
- 不宣称支持 Lark。登录协议、控制台发布与客户端交互在真实 Lark 租户逐项验收前保持未验证。

字段与请求面见 [Lark Channel v1](../../contracts/lark-channel-v1.md)，飞书收窄见
[Feishu Channel v17](../../contracts/feishu-channel-v17.md)，组件与权威见[Lark 渠道架构](../../architecture/lark-channel.md)，
取舍理由见[版本决定](decisions.md)，实施切片与验收见[实施与验收](implementation-plan.md)。

## 当前状态

Principal 于 2026-09-24 确认方案 B：克隆表族并参数化飞书实现。S1 到 S5 已实施并通过自动化验收，状态为
`in_progress`；Lark 切片只剩 S6 真实租户逐项验收。本版最初以 v1.67 的编号，在基线 `ec290dc6` 上实施；上游随后发布了
v1.67 到 v1.71，并用掉 Migration 171 到 175。本版顺位为 v1.72；合并最新主线时，Migration 174 用于 public history claim，175 用于通知模型，Lark 迁移因此顺延为
Migration 176，数据合同为 v1.72 / schema 126。实施计划中的 S1 到 S4 记录保留原基线上的证据，每次改号后的门禁结果另行记录。

2026-09-27 在主线 `0f7b101a` 基础上补充 Lark 入站资源下载，扩展原有 Host 请求面和 Source Ref 准入；
既有飞书、钉钉附件流程不变。该补充的自动化验收与真实租户边界见[实施与验收](implementation-plan.md)。

未决事项：

- 真实 Lark 租户逐项验收：扫码连接和基础对话已由 Principal 手工跑通，逐项证据见[真实租户验收记录](lark-tenant-qualification.md)。
- Lark 绑定 Camp 是否也注入文件交付提示。需要 Principal 看过独立的模型上下文变更说明后二次确认，本版默认不注入。
- 编号：上游作者已在 Issue #523 确认独立 provider 的边界，并约定版本号顺位继承、合并冲突时再处理。#517 先合入并占用
  v1.70 与 Migration 173；随后 #549 使用 v1.71 与 Migration 175，本版使用 v1.72 与 Migration 176。

## 并行交付：钉钉出站增量

在当前主线的钉钉渠道上补齐 Agent 显式图片及平台文件消息出站，并改为按 HTTP 状态/传输错误类型判定
Outbox 重试。范围仅限 DingTalk Host 和其 Open API 适配器，Core 的 delivery schema、Camp 消息与 Lark
版本目标不变。当前行为由 [DingTalk Channel v14](../../contracts/dingtalk-channel-v14.md) 拥有；真实钉钉租户
上传与消息呈现尚未验收，网络响应丢失的重复投递风险在合同中单列。

钉钉入站真实租户验证发现平台返回 HTTP 签名图片链接，原 Host 的 HTTPS 限制导致消息无法准入；
本次按 [V1.72-D04](decisions.md#v1-72-d04) 使用原始签名链接，并在附件终态失败时撤回已发送的排队卡。
旧失败请求不会自动重跑，新消息仍需真实租户验收。

Principal 后续要求三种渠道在附件下载期间不另发状态卡；资源未就绪时不创建排队卡，
普通已就绪消息仍可发送排队确认，附件终态失败仍发送提示。
本机钉钉私聊的 `rovai send` 直接投递因缺少 App 范围内的收件用户 ID 返回 HTTP 400；
领取投影现从绑定会话的外部 Principal 补齐该 ID，旧失败投递不自动重放。

## 并行交付：侧栏读取与 Skills 发现

按 Principal 对会话切换卡顿的评审，侧栏改用按行、按组和摘要完整快照读取；Navigation Read v1 的
Migration 177 从 v1.72/schema 126 升到 schema 127，只在 camp 增加摘要字段，不新增业务表。
首次发布的用户消息推进排序，首次发布且未撤回的 Agent 消息推进未读回复；Run 终态本身不产生新回复标记。
同时，原生 Skills 发现由上下文缓存改为目录缓存，容量 128 个目录、TTL 300 秒；同目录在途扫描和一次 Camp
手动刷新均去重，不预热或增加异步订阅。取舍见 [V1.72-D02](decisions.md#v1-72-d02)，实现与验收记录见
[实施计划](implementation-plan.md)。

## 并行交付：执行指标

Context 当前按 [Execution Metrics v7](../../contracts/runtime-execution-metrics-v7.md) 与输入确认解绑；当前 Session 原生观测经既有低频 Flush 提交并通知可见面板。同一实际模型及有效配置允许复用已确认窗口，ZCode 增加模型调用结束/压缩事件触发的合并读取。没有新增数据库表、指标定时器或测速；同次 App 证据与限制见[上下文运行中可用性收口](../../research/runtime-monitoring/live-context-usability-2026-10-04.md)。

2026-10-03 的 [Execution Metrics v6](../../contracts/runtime-execution-metrics-v6.md) 首先修复 Claude 最新根调用输入桶齐全时发出 used-only；当时其他 Runtime 的确认/采样限制见[运行中 Context 复核](../../research/runtime-monitoring/live-context-verification-2026-10-03.md)。

2026-10-02 按用户要求移除指标专用 CLI 版本门槛，保留产品最低版本资格；补接 CodeBuddy 最新调用占用、Kiro 原生百分比、TRAE 本地 Usage 与 Antigravity 根 step Usage。OpenCode 1.18.32 真实恢复验证通过，失败占位零不再清空 Context。字段支持、未决项与原始到数据库读回证据见[原生格式兼容验收](../../research/runtime-monitoring/native-format-compatibility-2026-10-02.md)。本切片不改变 schema、模型上下文、测速退役结论或界面布局。

执行面板的可见范围读取、隐藏暂停、终态有限尾读与引用复用已收口；2026-10-01 时周期 Flush 只为终态迟到数据
增加落盘后失效提示，v7 扩展到运行中有效提交。生产 Renderer 的 500 Run 动态验收、最低层竞争和字段引用证据见
[读取生命周期验收](../../research/runtime-monitoring/execution-metrics-refresh-verification-2026-10-01.md)。

执行台分别呈现每 Run 原生四项用量与当前原生 Session 上下文。2026-10-02 按用户要求移除全部 Runtime 的输出测速，包括 Core 字符计数、临时接口、前端轮询与显示；思考内容仍隔离于公开 Evidence 和 Renderer。用量复用 Monitoring Run summary；Migration 178 增加当前 Session 上下文小投影，把 v1.72/schema 127 升至 schema 128；Migration 179 以原子增量升级现有 schema 128 至 129，保留当前上下文数据并独立承接原生比例，不从比例反推数量；Migration 180 在合入 Thread 命名后收口至 schema 130，保留两条已部署路径的业务数据和冻结证据。没有真实回包的 Runtime 字段维持未验证，不回填历史 Run 的结束上下文。字段与 UI 规则由 [Runtime Execution Metrics v7](../../contracts/runtime-execution-metrics-v7.md) 和 [Camp 会话工作区](../../ui/components/conversation-workspace.md#camp-执行过程) 拥有；最新用量、上下文和 App 核验见[原生边界验收](../../research/runtime-monitoring/native-boundaries-verification-2026-10-01.md)，早期[第二轮记录](../../research/runtime-monitoring/execution-metrics-verification-2026-09-29.md)和[v3 长回合验收](../../research/runtime-monitoring/observable-output-v3-verification-2026-09-30.md)保留各自范围。

## 并行交付：公开 Composer 队外 Mention

Active Camp 中的用户可以从 `@` 候选选择资料仍在的队外队员。正文保留每处提及；发送时按身份去重，先逐人加入
Camp，再走现有消息发送命令。任一加入失败则保留草稿并停止发送；已加入成员不会回滚。Pending Camp 首条输入
仍走原激活路径。实现边界见[Public Camp Composer](../../architecture/camp-composer-draft.md#发送)与
[结构化 Mention](../../ui/components/structured-mentions.md#member-typeahead)，取舍见
[V1.72-D05](decisions.md#v1-72-d05)。

## 并行交付：渠道网页执行台还原

飞书、Lark、钉钉共用的局域网只读执行台按已确认交互稿还原桌面执行面的 Run 卡头、状态图形、工具组、命令结果和
Markdown 正文；网页外壳保留 Camp 标题、触发消息、只读标记及默认折叠的执行历史。网页服务继续只返回现有公开
Snapshot 与 SSE，不增加私有 Evidence、文件差异、写操作或新数据权限。具体交互见[渠道设置 UI](../../ui/components/channel-settings.md#局域网执行台设置)，
构建和浏览器验收记录见[实施计划](implementation-plan.md#2026-09-28-渠道网页执行台还原)。真实渠道内嵌浏览器与租户验收仍独立进行。

## 并行交付：当前版本发布日期

“关于与更新”当前版本的发布日期改由随包、与版本号绑定的元数据提供。v0.4.0 的值对照正式 GitHub Release
发布时间写入；Desktop 与 Desktop 托管的 Web 页面均可离线展示。版本提升时，元数据与更新日志必须一起更新，
桌面构建在打包前拒绝旧版本号或无效日期。元数据缺失或与运行版本不符时仍明确显示日期未知，不借用构建时间或
新版候选日期。日期来源由 v6 引入，当前合同入口为继承其规则的 [App Update v7](../../contracts/app-update-v7.md)，验证见[实施计划](implementation-plan.md#2026-09-28-当前版本发布日期)。

v0.4.1 发布后补齐候选版本的日期兼容：macOS 合并清单保留日期字符串，Main 同时归一化更新器可能返回的
日期对象；真实 Provider 解析器覆盖生成端和消费端的回归。见[补充验证](implementation-plan.md#2026-09-29-候选版本发布日期兼容)。

## 并行交付：Claude Code 权限审批

Claude Code 保留 `--print` 结构化输出，增加 stream-json 输入与 stdio 权限处理。原生 request_id
与 tool_use_id 分别绑定审批回复和实际工具结果，复用 Action/Approval Dock。初始化成功才发送任务，
会话 idle 与末轮结果共同控制 stdin 关闭；取消与断线撤销请求。当前合同见
[Runtime Launch and Verification v46](../../contracts/runtime-launch-and-verification-v46.md)，取舍见
[V1.72-D06](decisions.md#v1-72-d06)。

审批选项补充原生建议的显式记忆：一次允许不保存规则，记忆由 Claude 保存选中的范围和 destination，
请求的 suppression 仍有效。Claude 使用 CLI 2.1.280 已核实的原生英文按钮文案，中英文界面一致；
历史两个旧中文 host 标签只作展示兼容。Dock 不额外显示配置文件说明，选项放得下一排时同行排列，不足时换行。
验证记录见[原生选项补充验收](implementation-plan.md#2026-09-30-claude-原生选项与规则记忆)和[审批选项展示收敛](implementation-plan.md#2026-09-30-审批选项展示收敛)。

## 并行交付：Agent 指令英文化

按 Principal 确认的 r5，将会进入 Agent 上下文的 9 项发布 Skill（30 份 Markdown）和三处系统／CLI
短文本改为简洁英文。完整原文、替换内容、确认记录及验证边界见
[模型上下文变更说明](model-context-change-agent-english.md)。实际用户内容和回复语言保持。
旧会话沿用冻结 Bootstrap 继续 resume，新会话首次生成英文索引；内置 Skill 沿用既有固定路径同步。
不提升会话兼容版本、不新增迁移。工具箱共用的说明原文随资源显示英文。

## 并行交付：Sidecar 行操作与未读提醒

按确认的 v3 交互稿实现项目/对话的右键、三点、键盘与长按共用菜单。行操作默认隐藏；对话的运行与未读
独立并列，悬浮后由最右侧三点替换，运行环沿用中性灰。项目创建入口复用 New Chat 图标，菜单增加系统目录
定位和复制路径。手动未读随本机偏好保存，真实查看水位保持；失败或缓存预览不清除提醒。
当前语义见[统一侧栏](../../ui/components/app-shell-navigation.md)、[Navigation Read v1](../../contracts/navigation-read-v1.md)
与[侧栏刷新](../../architecture/desktop-navigation-refresh.md)，验收见[实施记录](implementation-plan.md#2026-10-02-sidecar-v3-交互实现)。

## 并行交付：队员运行配置应用

按 User 确认的交互稿，在原队员设置中增加一次性的“应用到其他队员…”：中英文、Desktop 与 Mobile
复用同一组件和原有单队员命令，逐人检查版本、保留草稿并呈现部分失败与结果未知。源配置和已确认目标版本
冻结于用户审核的选择，不建立长期同步；不改新手训练、数据库、Host 请求面或模型上下文。
当前行为见[队员配置 UI 合同](../../ui/components/member-identity.md#应用运行配置到其他队员)，证据见
[实施记录](implementation-plan.md#2026-10-02-队员运行配置应用)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.71 冻结为 historical；本概览、[实施计划](implementation-plan.md)、[版本决定](decisions.md)与[版本索引](../README.md)建立唯一 current v1.72 |
| Decisions | 已更新 | [V1.72-D01](decisions.md#v1-72-d01)记录独立 Lark provider；[V1.72-D02](decisions.md#v1-72-d02)记录侧栏摘要与范围读取；[V1.72-D03](decisions.md#v1-72-d03)记录 Lark 入站附件复用与 Host 隔离；[V1.72-D04](decisions.md#v1-72-d04)记录钉钉签名链接与旧排队卡收口；[V1.72-D05](decisions.md#v1-72-d05)记录发送前邀请；[V1.72-D06](decisions.md#v1-72-d06)记录 Claude 原生双向审批，并新增 [V1.72-D07](decisions.md#v1-72-d07) 记录 Thread 命名及旧绑定兼容，均同步当前决定导航 |
| Contracts | 已更新 | 发布 [Lark Channel v1](../../contracts/lark-channel-v1.md)与 [Feishu Channel v17](../../contracts/feishu-channel-v17.md)，Feishu v16 降为历史；补充 [Navigation Read v1](../../contracts/navigation-read-v1.md)、[Skills Rebuild v2](../../contracts/skills-rebuild-v2.md)、[App Update v7](../../contracts/app-update-v7.md)（继承 v6 日期来源，增加双语发布与 Renderer 显示副本选择）、[Runtime Launch v46](../../contracts/runtime-launch-and-verification-v46.md)与钉钉出站 [DingTalk Channel v14](../../contracts/dingtalk-channel-v14.md)；Composer 邀请只组合现有成员加入与发送命令，不改变两者合同；公开命名由 [Thread Naming v1](../../contracts/thread-naming-v1.md) 覆盖，新上下文与工具输出分别为 [ContextManifest v32](../../contracts/context-manifest-evidence-v32.md) 和 [Built-in Transport v33](../../contracts/builtin-tool-transport-v33.md) |
| Architecture | 已更新 | 新增 [Lark 渠道架构](../../architecture/lark-channel.md)；[飞书渠道架构](../../architecture/feishu-channel.md)移除 `larksuite.com` 并改指 v17；[侧栏刷新](../../architecture/desktop-navigation-refresh.md)与[Skills 来源](../../architecture/skills.md)说明局部读取及目录缓存；[钉钉渠道架构](../../architecture/dingtalk-channel.md)补齐原生附件出站与重试边界；[Public Camp Composer](../../architecture/camp-composer-draft.md#发送)说明邀请与发布命令边界；[Desktop App Updates](../../architecture/desktop-app-updates.md)补齐随包发布日期来源；[架构导航](../../architecture/README.md) 明确 Thread 命名覆盖与稳定存储边界；[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md#claude-code-权限审批回调)说明 Claude 权限回调边界 |
| UI | 已更新 | [渠道设置](../../ui/components/channel-settings.md)增加 Lark 页签、品牌显示与未验收提示，并明确只读网页执行台的历史区、生产组件及重连呈现；[Camp 命名](../../contracts/channel-camp-naming-v1.md)和[统一侧栏](../../ui/components/app-shell-navigation.md)补齐 Lark 来源及范围刷新；[结构化 Mention](../../ui/components/structured-mentions.md#member-typeahead)和[会话工作区](../../ui/components/conversation-workspace.md#camp-composer)说明待邀请反馈；公开英文名称统一为 Thread，中文继续用对话，草稿和导航持久状态兼容旧字段 |
| Runtime Activity | 确认无需更新 | Canonical Activity、Adapter mapping 与 Registry 的事件语义保持；Thread 只更新公开范围字段及读取投影，原始证据先验摘要 |
| Runtime compatibility | 已更新 | Claude Code 使用 `--print` 双向 stream-json 与原生 ID 审批；真实 Runtime 与 Desktop 点击证据记录在[兼容性台账](../../runtime-compatibility.md)，平台资格不据此扩大。Agent 指令英文化保持 Binding 兼容轴，生效边界见[变更说明](model-context-change-agent-english.md)；Thread 更名保留 Charter compatibility 16 与 Antigravity 原绑定工具身份 |
| Documentation routing | 已更新 | 文档任务入口、合同索引、架构索引、当前决定导航与版本指针路由到 Lark v1、Feishu v17、Navigation Read v1、DingTalk v14 与 v1.72；版本内新增[Agent 指令变更说明](model-context-change-agent-english.md)及完整对照；新增 Thread r2、前后对照、验收记录及上述当前合同入口 |
| Root README | 确认无需更新 | Lark 未完成真实租户验收，按 Lark Channel v1 第 8 节不得在根 README 宣称支持 |

2026-10-01 的 Qoder／Grok／OpenCode Context 与 Copilot 重新核验见[字段与场景证据](../../research/runtime-monitoring/native-context-ratio-verification-2026-10-01.md)。schema 127 → 128 → 129 和已安装 schema 128 → 129 均有迁移 owner；179 失败时回滚字段、收据和 marker，旧数量保留且原生比例为空。

同日追加的[原生边界验收](../../research/runtime-monitoring/native-boundaries-verification-2026-10-01.md)补齐 Codex 真实压缩降值、四类健康冷恢复及 App 重开、Grok 同次思考速度 UI 和 OpenCode 显式有效窗口；Qoder 正缓存写只有明确标注的受控链路证据。默认 Provider 容量、真实正缓存写及异常恢复仍按记录保持未验证，不改变 schema 或字段合同。
## 并行交付：AI 优先添加队员

按 Principal 确认稿，名册只保留 AI/手动分段添加入口，列表直接拖拽排序并保留可调分隔线。
AI 创建使用一位可用协助者的普通草稿会话；三个起步提示可编辑，输入后出现窗口内侧栏草稿。
成功 `member.create` 产生静态入队回执，配置链接进入已有队员设置，右侧表单及离队资料行为保持。
Desktop/Mobile、中文/英文共用生产组件。

入队回执保存经认证的来源 Run，终态后按“最后回复 → 入队卡片 → Files Changed”展示；无公开回复时复用
Run 产物作者头。入队卡与文件卡共用桌面/窄列宽度、缩进和间距；旧回执保持可读，不按队员或时间猜测来源。

[Member Creation Flow v1](../../contracts/member-creation-flow-v1.md)拥有当前行为，
[V1.72-D09](decisions.md#v1-72-d09)记录取舍；原 main 的 Migration 180 将 schema 129 升为 130；与已安装指标分支整合后，当前 Migration 181/182 分别交付 User 投影与队员创建，该切片收口至 schema **132**；后续普通一键草稿修复由 Migration 183 升至 **133**。两条指标和 main 的已部署 128/129/130 来源只按完整结构与收据组合准入，原子收口且保留业务数据、既有收据时间和冻结证据。
[实施验收](implementation-plan.md#2026-10-02-ai-优先添加队员)区分自动化与真实模型/实体手机边界。
本切片不改变模型 Bootstrap、Tool Schema、上下文格式或发布 Skill。


2026-10-03 追加[五类原生来源验收](../../research/runtime-monitoring/native-source-completion-2026-10-03.md)：
Antigravity 四项与 Context、Qoder 数量、TRAE Context、Kiro 窗口已补接；仍区分原生缺失和未验证，
不把 null/null 一致当作字段完整。无 schema 迁移或测速恢复，比例数字统一一位小数。

## 并行交付：Run 内容块与 command 组分页

按 User 的 HTML 交互稿确认与 worktree/PR 合入要求，Run 主线按正文或完整折叠组分页；展开组按独立游标读取，
首次短内容自动补齐，失败保持内容并在原位重试。无新表、迁移、模型上下文或渠道公开数据变化。
当前合同为 [Run Process Detail Surface v43](../../contracts/run-process-detail-surface-v43.md)，理由见
[V1.72-D10](decisions.md#v1-72-d10)，实现与验证见[实施记录](implementation-plan.md#2026-10-02-run-内容块与-command-组分页)。
跨版本影响：Contract、读取架构、UI 和当前导航已同步；版本指针、Runtime 兼容、原始 Evidence、结果预算与根 README 无需变化。

## 并行交付：Windows 关闭选择与托盘

Windows 主窗口默认关闭时询问，可选择最小化到系统托盘或正常退出，并记住选择。通用设置可切换三种行为；
macOS/Web 不增加入口。托盘及第二次启动恢复原窗口，明确退出和更新重启继续现有受控退出。
[Windows Window Close v1](../../contracts/windows-window-close-v1.md)拥有字段与状态规则；
[实施验收](implementation-plan.md#2026-10-02-windows-关闭选择与托盘)记录自动化和真实 Windows 的证据边界。

## 并行修复：恢复普通一键新对话草稿

按 User 2026-10-03 的更正恢复问题出现前的交互：每次新建独立保存，同一项目可有多份草稿；非空输入进入侧栏，
切换、刷新、重建窗口和普通重启可恢复，失败发送保留输入，清空或成功发送后移除草稿状态。
内容沿用本机 store，Core 仅保留客户端 presence；Migration 183 将 schema 132 加性升级为 **133**。
[Pending Camp Activation v4](../../contracts/pending-camp-activation-v4.md)、[Composer Draft v16](../../contracts/camp-composer-draft-v16.md)
及对应 Architecture/UI/术语/导航已同步；理由见 [V1.72-D11](decisions.md#v1-72-d11)，证据见
[实施记录](implementation-plan.md#2026-10-03-普通一键新对话草稿恢复)。无模型上下文、发布 Skill、Runtime 兼容轴或根 README 变化。

2026-10-04 [上下文可用性收口](../../research/runtime-monitoring/live-context-usability-2026-10-04.md)
按 Execution Metrics v7 解除输入确认等待、复用有效实际模型窗口，并接入 ZCode 运行中事件触发读取。
旧轮次记录保留当时的限制；当前规则以 v7 为准。
