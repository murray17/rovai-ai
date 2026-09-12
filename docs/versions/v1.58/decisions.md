---
document_type: version-decisions
version: v1.58
lifecycle: current
authority: decision-rationale
last_updated: 2026-09-11
---

# v1.58 版本决定

<a id="v1-58-d02"></a>
## V1.58-D02：结果声明读取独立来源材料，不扩大为完整过程评审

- 状态：accepted
- 日期：2026-09-11
- 当前权威：[Semantic Judge Views v10](../../contracts/semantic-judge-views-v10.md)、[双轨执行评测](../../architecture/execution-evaluation.md)

完成回复可能引用来源原文和长度。只给结果 Judge 产物会遗漏这类核验依据；给全部 Trace 会破坏过程隔离。选择把同一隔离 Camp 的派发前用户正文和根请求作为独立未可信材料，验证实际快照、派发身份、正文摘要、长度和冻结输入的存在性。来源保留边界、匿名引用和脱敏状态，不认证模型行为。

代价是来源预算不足时必须明确阻断这次评价，不能静默截断。来源类目前限于用户 Camp 消息；外部网页、文件附件和记忆正文仍需各自的授权、版本与来源合同，不能宣称任意声明都一定可核验。

<a id="v1-58-d01"></a>
## V1.58-D01：Host 准备有限元数据，分析 Agent 消费工作区报告

- 状态：accepted
- 日期：2026-09-10
- 当前权威：[Execution Evaluation v1](../../contracts/execution-evaluation-v1.md)、[User Automation v3](../../contracts/user-automation-v3.md)、[双轨执行评测](../../architecture/execution-evaluation.md)

每日分析需要跨 Run 统计，但受管 Agent 不拥有应用级用户身份。让它直接导出所有 Camp 数据，会穿过既有 User Automation OS denial 边界；新增数据库 provenance 和计数虽能提高覆盖，却要求所有执行入口、A2A 后代和迁移同时修改，超出首轮统计需要。

选择由 Main 在用户配置的范围内准备只读元数据与确定性报告，让现有 Automation 的 Agent 读取工作区中的有限输入。Core 不暴露正文查询或通用 SQL，统计与解释分别保留来源和状态。

代价是数据准备与分析可能先后失配，必须拒绝陈旧报告；旧记录不能完全识别 origin 或历史 build，Memory 计数也保持未知。该边界保留既有应用级身份与 Agent 身份隔离，未来补 provenance 时可以升级统计合同，不必给分析 Agent 开放用户控制面。

<a id="v1-58-d03"></a>
## V1.58-D03：先前交付保留引用语境，不扩大为过程评分

- 状态：accepted
- 日期：2026-09-11
- 当前权威：[Semantic Judge Views v11](../../contracts/semantic-judge-views-v11.md)、[Execution Evaluation v14](../../contracts/execution-evaluation-v14.md)

只保留最后一条 Lead 回复会把已发布报告的简短确认误当成交付缺失；把全部公开轨迹交给结果 Judge 则破坏结果与过程隔离。选择保留有序先前 Lead 交付作为引用语境，并限制其只能证明发布内容。后来的明确修订与最终产物优先，旧稿不增加新的声明评分样本。

代价是更多有界输入和完整性检查；超限明确失败。不能通过忽略发布声明、挑选最有利旧稿或用单份 Judge 替代失败副本来取得完整高分。评分执行故障单独分类，恢复只用于有限运输失败，任务失败继续扣分。

<a id="v1-58-d04"></a>
## V1.58-D04：声明佐证不足与事实未知分开

- 状态：accepted
- 日期：2026-09-11
- 当前权威：[Semantic Judge Views v12](../../contracts/semantic-judge-views-v12.md)

将所有未获得执行证明的声明视为未知，会让可观察的交付依据缺陷无法扣分；将其全部视为虚假则错误推断了历史事实。选择评价声明与交付依据的匹配程度，新增未充分佐证状态，保留评测器采集不足的未知。分数下降表示交付依据不足，不证明事件未发生。

代价是 Judge 必须区分交付问题与评测来源问题，仍可能产生真正未知；不能承诺任意输入一定得到完整总分。评分语义升级后统一重评，历史分数不直接连接。

<a id="v1-58-d05"></a>
## V1.58-D05：User Automation 采用 CLI 防误调用，移除 Runtime 外层沙箱

- 状态：accepted
- 日期：2026-09-11
- 当前权威：[User Automation v5](../../contracts/user-automation-v5.md)、[Managed Runtime Process v2](../../contracts/managed-runtime-process-v2.md)、[ACP Client Terminal v3](../../contracts/acp-client-terminal-v3.md)、[User Automation 架构](../../architecture/user-automation.md)

本机用户明确要求 Agent 不使用用户命令，但仅需防止正常执行中的误调用。V1.21-D03 为抵御同 UID
进程主动伪装而给所有 Runtime 添加文件沙箱，导致 macOS Runtime 内再次创建沙箱时出现
`sandbox_apply: Operation not permitted`，阻断正常开发与验收。

选择删除 protected-tree 配置、全局状态、启动包装与旧 deny 测试，保留 CLI 对 Run 标记的隐藏与拒绝。
用户 IPC 的实例认证、封闭命令及业务授权保持；Runtime 原生权限由 Runtime 实施。正常环境下的误调用
仍被拒绝，同 UID 进程主动清除标记或构造用户 IPC 不属于保证范围。旧版本的执行证据保留原样。

继续保留外层沙箱会保持较强文件隔离但延续已复现的兼容阻塞；新增进程身份隔离或专用执行代理超出
本次防误调用目标，因此不采用。本决定替代 V1.21-D03 的 OS denial 选择，不把协议身份分离宣称为
本机恶意进程安全边界，也不改变 Windows 平台准入或进程回收。

<a id="v1-58-d06"></a>
## V1.58-D06：Source Attachment 运行前重检后原样投影源路径

- 状态：accepted
- 日期：2026-09-11
- 当前权威：[Camp Attachment v9](../../contracts/camp-attachment-v9.md)、[Single Chat v4](../../contracts/single-chat-v4.md)、[Camp Attachments](../../architecture/camp-published-attachment-view.md)

Source Ref 已经把用户附件定义为弱持久 live reference，但 v8 又按 execution root 分流，把外部来源递归复制到
Run Temp。这使路径语义随位置改变、读取内容在 dispatch 时冻结，并让目录内部 symlink 或特殊节点在 Agent 尚未访问
前阻断整个附件，偏离“只引用源路径”的产品边界。

选择保留既有宿主侧 exists/readable/kind 重检及 `spawn_blocking`，成功后无条件把完全相同的 stored source path
交给 Context。`fs::metadata` 继续跟随顶层 symlink；目录只打开 `read_dir` 而不枚举子项。Core 不 canonicalize、
不比较 workspace、不复制、不创建 symlink，也不建立 Runtime preflight。宿主可读不保证 Runtime 可读；Agent 只有
在实际访问时才从原生文件工具获得 Runtime/OS 错误。

代价是外部绝对路径会对目标 Runtime、Agent 及潜在模型 Provider 可见，且既没有快照或只读保证，也可能受现有
Runtime 权限限制。该路径仍不进入 Renderer、公共消息或历史 View。既有 Source Refs 在后续 Run 直接采用新语义，
不迁移数据库或历史 ContextManifest；Prepared、Managed、Agent/CLI 与 legacy attachment 不变。

拒绝保留旧复制兼容、delivery mode、Runtime capability 分流、external read-root 授权、snapshot/config 开关及
materialize/upload fallback，因为它们会用新的策略系统替代本次删除，扩大 Source Attachment 的职责。


<a id="v1-58-d07"></a>
## V1.58-D07：交互 HTML 使用可撤销的不同源 HTTP 站点

- 状态：accepted
- 日期：2026-09-12
- 当前权威：[File Preview v12](../../contracts/file-preview-v12.md)、[File Preview Architecture](../../architecture/file-preview.md)、[Camp 文件预览区](../../ui/components/file-preview.md)

srcdoc 的不透明 origin 使 History 初始化抛出 SecurityError，且 query 子页面无法取得同一原稿。继续增加路径改写
或 History shim 不能恢复浏览器文档语义；迁移 Electron 专有 webview 会增加未来 WebUI/MobileUI 复用成本。

按用户确定方向保留 iframe，以已有文件能力生成不同源、可撤销 HTTP 站点。浏览器负责作者依赖、History 和子页面，
共享核心负责范围检查与响应，Desktop 仅适配本机能力及窗口生命周期。默认运行并尝试网络依赖，失败按浏览器规则
呈现，不增加信任或逐资源审批。

代价是实例服务、访问凭据、诊断和清理的复杂度，以及普通网络错误/CORS/证书限制仍可能导致作者页面失败。
不以放宽主应用同源、关闭 webSecurity、任意代理或覆盖作者 API 换取表面成功；脚本异常只报告，不伪装续跑。
