# Rovai 使命板

本板只收录尚未开始的长期任务。评级表示它对 Rovai 的长期价值，不代表开发顺序或工作量；任务进入具体版本后，由 `docs/versions/` 接管实施与验收。

## 未开始清单

| 评级 | 任务 | 任务介绍 |
| --- | --- | --- |
| **S** | [渠道里长出来的队员](#channel-members) | 让飞书、钉钉、Telegram 等渠道 Bot 成为长期队员的外部化身，而不是另一套 Agent。 |
| **A** | [Agent Runtime 前线](#runtime-frontier) | 持续接入并验证 Grok Build、Cursor Agent 等新的 Agent Runtime。 |
| **A** | [平台远征：Linux 与 Windows ARM64](#platform-expedition) | 建立 Linux 与 Windows ARM64 的完整桌面、Core 和 Runtime 资格。 |
| **A** | [Runtime 资格实验室](#runtime-qualification-lab) | 把 Runtime、Provider、平台和能力验证变成可重复的证据矩阵。 |
| **A（暂定）** | [能力包（待讨论）](#capability-packs) | 把 Skill、MCP、权限与工作方式组合成可审阅、可复用的能力单元。 |
| **A** | [外部工作源连接](#external-work-sources) | 连接 GitHub、GitLab、Linear、Jira 等真实工作项与 Rovai Task。 |
| **B** | [营地阅览室](#camp-reading-room) | 在 Rovai 内直接预览 Office、Markdown、PDF 等工作文件。 |
| **C** | [Camp 地图与队员生活](#camp-map-and-life) | 用真实共同经历丰富 Camp 地图和队员之间的轻量互动。 |
| **S** | [记忆离线捕获](#offline-memory-capture) | 把记忆形成移出当前回复链路，在后台可靠捕获、提炼和审阅。 |

---

<a id="channel-members"></a>
## 渠道里长出来的队员

**评级：S**

### 任务介绍

Rovai 已经拥有长期队员。连接飞书、钉钉、Telegram 等渠道时，不应重新创建一套匿名 Bot 或渠道 Agent；渠道 Bot 应当从现有队员身上长出来。

同一个队员可以同时出现在 Rovai Camp 和外部群聊中，但它的身份、记忆、Runtime、权限和责任仍由 Rovai 统一管理。

### 第一阶段

- 选择一个渠道完成垂直切片：文本、Mention、回复、附件、失败重试和主动通知。
- 定义队员、渠道 Bot、群、线程、Principal 与 Camp 的稳定映射。
- 区分最终回答、进度消息、审批请求和系统通知。
- 将外部消息接入现有 Message Delivery、AgentRun、Approval 和 Evidence 链路。

### 完成标志

- 用户可以从队员页面启用或关闭该队员的渠道入口。
- 同一队员跨渠道保持同一身份与长期记忆。
- 渠道重试、重复 Webhook 和断线恢复不会重复触发任务。
- 渠道凭据不进入 Agent 上下文、公开消息或普通 Evidence。

### 边界

- 渠道 Bot 不是新的队员。
- 渠道线程不自动等于 Camp，映射必须显式且可解释。
- 外部渠道不能绕过 Rovai 的寻址、审批和权限边界。

---

<a id="runtime-frontier"></a>
## Agent Runtime 前线

**评级：A**

### 任务介绍

持续接入新的 Agent Runtime，让长期队员能够使用不断变化的模型、工具和原生能力，同时保持 Rovai 的身份、权限、Evidence 与恢复边界。

近期候选包括：

- **Cursor Agent**：完成产品接入、真实行为矩阵和平台资格收口。
- **Grok Build**：预研启动协议、Session、流式事件、Tool、Approval、MCP、Skill、压缩和 BYOK。
- 后续新的 ACP Runtime、开放 CLI Harness 和本地模型 Agent。

### 每个 Runtime 至少要回答

- 如何发现、启动、停止和恢复；
- 模型、权限、Session 和原生身份如何工作；
- Tool、Approval、Cancel、Final 与 Missing-Send 如何投影；
- Skill、MCP、Compaction 和 Built-in transport 能否可靠接入；
- 哪些平台与 Provider 已有真实资格证据；
- 哪些能力只能使用 Runtime 原生配置，不能由 Rovai 隔离投影。

### 完成标志

新 Runtime 只有在版本、平台、Provider 和关键能力矩阵均有明确证据后，才进入普通产品路径。

---

<a id="platform-expedition"></a>
## 平台远征：Linux 与 Windows ARM64

**评级：A**

### 任务介绍

让 Rovai 从现有桌面资格继续扩展到 Linux 与 Windows ARM64，并分别建立真实构建、安装、运行和 Runtime 兼容证据，而不是从其他平台外推。

### Linux

- 桌面打包、安装、升级与卸载。
- XDG 数据目录、文件权限、通知、托盘和窗口行为。
- Shell、PTY、进程树、信号、路径与权限差异。
- x64 与 ARM64 分开验证。

### Windows ARM64

- Electron、Node、Rust 与安装器的 ARM64 构建链。
- 原生 ARM64、x64 模拟运行和 Runtime 子进程架构识别。
- PowerShell、Windows argv、Job Object、终止与清理行为。
- 各 Runtime 是否提供原生 ARM64，还是只能通过兼容层运行。

### 完成标志

- 对应平台有可安装产物和自动升级路径。
- Core、SQLite、附件、Git、受管进程和恢复矩阵通过。
- 每个 Runtime 独立标记 `qualified / not_qualified`，不按平台家族推断。

---

<a id="runtime-qualification-lab"></a>
## Runtime 资格实验室

**评级：A**

### 任务介绍

把 Runtime 验收收敛成可重复运行、可比较结果、可保存 Evidence 的资格实验室，降低持续接入和版本升级的维护成本。

### 第一阶段

- 统一测试启动、Session、Tool、Approval、Cancel、Final、MCP、Skill、Compaction 和 Built-in transport。
- 区分：
  - `runtime-qualified`：Runtime 壳、协议和工具行为通过；
  - `provider-qualified`：Runtime 与指定 Provider、账号和模型链路通过。
- 日常集成测试可使用 BYOK 或兼容后端；发布资格仍保留官方 Provider 验证。
- 自动生成机器报告、失败定位和用户可读的兼容性摘要。

### 完成标志

- Runtime 升级后能快速发现协议漂移。
- 失败可以定位到 Runtime、Provider、模型、fixture、平台或 Rovai Adapter。
- macOS、Linux、Windows 及不同 CPU 架构都拥有独立证据行。

---

<a id="capability-packs"></a>
## 能力包（待讨论）

**评级：A（暂定）**

### 任务介绍

把一组协作能力组合成可审阅、可复用、可版本化的能力包。一个能力包可能包含：

- Skill；
- MCP Server 引用；
- Runtime 权限建议；
- 工作原则或操作规程；
- 支持的 Runtime 与最低版本；
- 安装前需要向用户说明的文件、网络和外部系统访问范围。

### 待讨论的问题

- 能力包应该绑定队员、团队、Camp、Task，还是允许多种作用域？
- 能力包是静态模板，还是可以随 Task 生成一次性投影？
- 凭据只引用还是允许声明所需凭据类型？
- 更新时如何避免静默改变正在执行的 AgentRun？
- 能力包是否允许导入、导出和社区分发？
- 与现有 Skill Library、MCP Library、成员权限之间谁拥有最终权威？

### 最小可行形态

先实现一个只包含 Skill、MCP 引用和权限摘要的只读能力包，在应用前展示完整 diff，并只投影 Runtime 当前真正支持的部分。

---

<a id="external-work-sources"></a>
## 外部工作源连接

**评级：A**

### 任务介绍

连接 GitHub Issues / Pull Requests、GitLab、Linear、Jira 等工作源，让真实工作项可以进入 Rovai Camp 与 Task，并由长期队员持续调查、执行、复核和交付。

### 第一阶段

- 选择一个工作源完成单一垂直切片。
- 从外部工作项创建或关联 Rovai Task。
- 同步标题、正文、状态、负责人、评论和关键链接。
- 将 Webhook、轮询、重试和去重纳入耐久 Delivery。
- 让交付结果可以回写外部系统，但写回必须显式授权。

### 必须先明确

- 外部 Issue 与 Rovai Task 谁拥有状态权威；
- 一个外部工作项能否跨多个 Camp；
- 冲突、重开、删除和权限变化如何处理；
- 哪些内容只保存引用，哪些内容需要冻结快照以保证可重现；
- 外部评论是否会直接触发 AgentRun，还是先进入待处理责任。

### 完成标志

第一版只需完成一个工作源，但必须具备稳定映射、幂等同步、权限边界和失败恢复。

---

<a id="camp-reading-room"></a>
## 营地阅览室

**评级：B**

### 任务介绍

让用户无需离开 Rovai，就能在 Camp、附件、工作区和 Evidence 中预览常见工作文件。

首批格式建议：

- Markdown、纯文本和代码；
- PDF；
- Word、Excel、PowerPoint；
- 常见图片与结构化数据文件。

### 第一阶段

- 在统一预览容器中提供目录、页码、搜索、复制和下载原文件。
- Markdown 使用安全渲染，并支持代码块、表格、任务列表和内部锚点。
- Office 文件优先采用本地只读转换或受控渲染，不把内容静默上传到第三方。
- 大文件、损坏文件、密码保护文件和不支持格式有明确降级。
- 预览与编辑严格分离；预览不会修改源文件。

### 后续方向

- 将文件中的标题、批注、表格和幻灯片页作为可引用上下文。
- 在 Agent 回答和 Task 中生成指向具体页、节、单元格或幻灯片的引用。
- 对两个版本的文档提供有界差异视图。

### 完成标志

用户可以从 Camp 或工作区打开文件、快速理解内容，并把明确位置交给队员继续工作，而不需要频繁切换外部应用。

---

<a id="camp-map-and-life"></a>
## Camp 地图与队员生活

**评级：C**

### 任务介绍

在不干扰专业工作的前提下，让 Camp 地图、地点和队员之间出现少量可选互动，使共同经历在视觉上留下痕迹。

### 可以探索

- 队员根据当前真实任务出现在调查、评审、交付或记忆地点。
- 完成使命后在地图中留下可回看的纪念物或记录。
- 队员在任务间进行简短复盘、休息或轻量互动。
- 与真实协作经历相关的小型收藏、成就或小游戏。

### 边界

- 不增加完成工作所需步骤。
- 不用虚构数值替代真实能力、关系、健康或执行状态。
- 不让随机动画制造“队员正在工作”的假象。
- 所有生活化内容都应可关闭，并建立在真实共同经历之上。

---

<a id="offline-memory-capture"></a>
## 记忆离线捕获

**评级：S**

### 任务介绍

把记忆形成从当前公开回复和 AgentRun 主链路中移出。Camp、Task 或 AgentRun 产生值得记住的经历后，Rovai 先保存可追踪的记忆候选，再在后台空闲时提炼、去重并提交审阅。

这里的“离线”指**脱离当前交互主链路异步处理**，不要求当前 Camp 保持打开，也不阻塞队员的最终回答。

### 第一阶段

- 建立耐久的 Memory Capture Job，引用来源 CampMessage、Task、AgentRun 和 Evidence ID。
- 在应用空闲或合适 Runtime 可用时执行有界提炼。
- 区分项目事实、个人经验、关系记忆和团队惯例。
- 生成提案而不是直接改写长期记忆，继续由用户审阅、修改、合并或拒绝。
- 支持失败重试、去重、取消、预算限制和应用重启恢复。

### 完成标志

- 最终回答不再等待记忆提炼完成。
- 应用关闭或 Runtime 暂时不可用时，候选不会丢失。
- 同一经历不会因重试生成多份重复记忆。
- 每条记忆都能追溯到原始消息、任务或 Evidence。
- 私有推理、凭据和不应长期保留的原始内容不会进入记忆。
