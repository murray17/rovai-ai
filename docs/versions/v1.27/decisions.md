---
document_type: version-decisions
version: v1.27
lifecycle: current
last_updated: 2026-08-23
---

# v1.27 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前行为规范由链接的 Architecture 与 Contract 拥有。

<a id="v1-27-d01"></a>
## V1.27-D01：Provider 凭据只进入私有进程配置，Kimi Session 采用 `new_only`

### 背景

Kimi Code 可以通过环境变量配置 OpenAI-compatible provider。用户要用 MiniMax Token Plan 做真实本地验收，
但把 token 写入仓库、数据库、命令行、日志或共享 `~/.kimi/config.toml` 都会扩大秘密暴露面。另一方面，
Kimi native resume 依赖同一 Kimi home。真实 Probe 已证明新进程复用同一 home 时 exact resume 成功并保留
上下文，而 Rovai 为每个 Host 创建新的隔离 home 后会稳定得到 `Unknown sessionId`。

### 决定

1. Rovai 只从权限收窄的外部 env 文件读取六个显式 `KIMI_MODEL_*` 键，并只注入 Kimi 子进程；
   `KIMI_MODEL_CAPABILITIES=thinking` 只声明能力，Rovai 不强制关闭 Kimi/MiniMax thinking；
2. 默认文件为 `~/.config/rovai/kimi-code.env`，可由 `ROVAI_KIMI_CONFIG` 覆盖；内容不进入数据库、Evidence、
   diagnostics、命令或 Git；未知、重复、空值和权限过宽都 fail closed；
3. 每个 Kimi Host 使用新的隔离 `KIMI_CODE_HOME`，Run terminal 后停止并清理；
4. 当前 continuation strategy 固定为 `new_only`，snapshot 不声明 `session.resume`；Rovai portable context 仍按
   既有合同送入新 Session；
5. Catalog identity 与平台资格分离。macOS arm64 虽通过基础 ACP 行为验收，但在完整 Built-in CLI matrix
   建立合格 evidence 前保持 `not_qualified / runtime_platform.builtin_transport_unqualified`；其他平台独立取证。

当前规范见 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)与
[Runtime Launch and Verification v20](../../contracts/runtime-launch-and-verification-v20.md)。

### 后果

- 用户原有 Kimi 配置和认证状态保持不变，密钥暴露面限制在私有文件与目标子进程；
- 每个 Run 有确定性隔离和清理，代价是暂不复用 Kimi native conversation；
- 未来要启用 resume 必须先设计稳定隔离 home/binding，并以新证据和合同版本准入；
- Catalog identity 与逐平台 qualification 继续分离。
- Product Runtime 普通路径不会启动 Kimi；直接真实模型诊断不改变准入状态。

### 被拒绝方案

- **把 token 存入成员 Runtime 参数或数据库：** 会把秘密带入持久投影、诊断和备份面；
- **复用或改写 `~/.kimi/config.toml`：** 会污染用户日常 Kimi 环境并破坏验收隔离；
- **通过命令行参数传 token：** 容易进入进程列表与命令 Evidence；
- **仅凭同一 home 的 `session/resume`/`session/load` 成功就声明产品 continuation：** 这会绕过当前每 Host
  私有 home 的隔离与 compatibility 边界；跨隔离 home 的真实结果仍是 `Unknown sessionId`。

<a id="v1-27-d02"></a>
## V1.27-D02：Kimi 使用稳定私有 Session home，并在新 Host 精确恢复原 Session

### 背景

D01 把 Kimi 原始 resume 能力与 Rovai 产品语义严格分离是正确的，但它选择的每 Host UUID home 同时删除了
Runtime 恢复 Session 所必需的本地状态。AgentRun terminal 后停止 Host 并不要求更换 Runtime 专用 home；
“新进程 + 人为换 home + resume 失败”也不是 Rovai 的实际产品需求。其他 Runtime 的 continuation 同样以
兼容逻辑会话和稳定原生状态为前提，不把刻意破坏状态目录作为必须支持的场景。

真实 Kimi `0.32.0` 已证明新进程复用同一 home 时 `session/resume` 与 `session/load` 都保持精确 Session ID。
修复后的产品级 fake Runtime 回归进一步证明：两个 AgentRun 使用不同 Host instance、相同私有 home，协议依次
执行 `session/new` 与 `session/resume`，Native Session ID 不变。

### 决定

1. D01 的 provider allowlist、secret 不落库、不改写用户 `~/.kimi/config.toml`、thinking 清洗和平台准入结论
   保持有效；本决定只替代 D01 第 3、4 项的 home/continuation 语义；
2. Kimi `KIMI_CODE_HOME` 使用 Rovai data-dir 下的稳定私有 Session home，scope 绑定 Camp、成员、Runtime
   installation 与 auth scope，并用 canonical digest 作为目录名；不改变进程通用 `HOME`；
3. AgentRun terminal 前仍停止 Kimi Host，但 Host shutdown 不删除该 Session home；不同 scope 不共享；
4. snapshot 保留 Runtime 实际声明的 `session.resume/load`。新 Host 优先 exact resume；只有 resume 不可用时
   才允许 load 进入既有 History Restore quarantine；不同 Session ID 或协议异常 fail closed；
5. 该修复不启用 warm Host、External MCP、Built-in transport、Usage/Cost 或 Compaction，也不改变任何平台
   `not_qualified` 结论；异步 command catalog 未成为产品 snapshot 不是 continuation 或启动硬阻断。

当前规范见 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)与
[Runtime Launch and Verification v21](../../contracts/runtime-launch-and-verification-v21.md)。

### 后果

- 同一兼容逻辑会话跨 Run/进程复用原 Native Session，不再因 Rovai 自己轮换 home 而丢失上下文；
- 进程生命周期仍是每 Run 回收，Session 生命周期与 Host 生命周期明确分离；
- 私有 home 会跨 Host 保留，需要后续定义无绑定 Session home 的有界垃圾回收；当前不能在单个 Host shutdown
  中删除；
- Built-in CLI 的 `0/15` 资格失败仍是 macOS arm64 唯一已确认硬阻断。

### 被拒绝方案

- **继续每 Host 新建并删除 home：** 会确定性破坏 Kimi 的原生 Session 恢复前提；
- **要求跨不同 home 恢复同一 Session：** 不是当前产品场景，也与 Kimi 的 Session 存储模型冲突；
- **为了 continuation 保留 warm Host：** 增加进程状态与清理复杂度，没有必要；冷 Host exact resume 已足够；
- **直接使用或改写用户 `~/.kimi`：** 会重新扩大配置污染与秘密边界，稳定 Rovai 私有 home 已能满足恢复。

<a id="v1-27-d03"></a>
## V1.27-D03：修正过期 Built-in fixture，并准入 Kimi macOS arm64

### 背景

D01、D02 把 Kimi macOS arm64 保持为未准入，是因为三次完整 Built-in 资格运行未取得 operation evidence。
对失败 fixture 的逐步诊断后来证明，Kimi 已启动 Shell 并执行 bundled 验收脚本；脚本在第一项 canonical
operation 前检查 legacy stdin 非法输入，却仍期待旧退出码 `1`。当前 CLI 合同对该输入返回结构化
`fix_input` 与退出码 `2`，与 direct-flag 非法输入一致。所谓“两次模型跳过 shell、`0/15`”因此是过期
fixture 提前退出造成的错误归因，不是 Kimi transport 行为。

把断言修正为 `2` 后，同一 `kimi 0.32.0` + MiniMax M3 安装完整通过十五项 operation，并产生 56 条
full-run evidence；三种输入模式、Gather capture、精确后继寻址、stale-version conflict、initial/resumed
lease fencing、logical conversation 与跨新 Host native Session continuation 全部通过。

### 决定

1. D01 第 5 项与 D02 第 5 项中关于 Kimi macOS arm64 平台未准入、Built-in transport 未启用的结论由本决定
   替代；provider、thinking、stable private home、cold exact resume、External MCP、Usage/Cost、Compaction 和
   warm Host 边界保持不变；
2. `kimi-code-cli × macos-arm64` 晋升为 `qualified`，evidence revision 绑定当前
   `docs/runtime-compatibility.md` 的 SHA-256 digest；macOS x64 与 Windows x64 仍为
   `not_qualified / runtime_platform.qualification_evidence_missing`；
3. Kimi capability snapshot 声明 Built-in transport；默认 Built-in CLI 与 `smoke:skills all` 资格集合包含
   Kimi。External MCP capability 仍不声明；
4. 异步 `available_commands_update` 已安全路由但尚未形成产品权威 catalog snapshot。它是独立功能空缺，
   不是启动、continuation、Built-in transport 或 macOS arm64 准入阻断；
5. 以后资格失败必须先保留并定位 Runtime 是否实际执行、脚本停止在哪个 contract assertion，再把 `0/N`
   归因给模型或 transport。

当前规范见 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)与
[Runtime Launch and Verification v21](../../contracts/runtime-launch-and-verification-v21.md)。

### 后果

- macOS arm64 普通产品路径可以 discovery、配置、Probe 和执行 Kimi；
- Built-in transport 不再是 Kimi 遗留阻断；默认资格 Smoke 会持续覆盖该 Runtime；
- macOS x64、Windows x64 仍需独立行为矩阵，不能从 arm64 外推；
- 保留 closed `runtime_platform.builtin_transport_unqualified` reason code，不代表当前 Kimi 行仍使用它。

### 被拒绝方案

- **维持旧未准入结论：** 已与修正后完整资格证据冲突；
- **只把 15/15 写入文档而不进入默认矩阵：** 会让未来回归不再覆盖刚建立的资格；
- **同时开启 External MCP 或 telemetry：** Built-in CLI 证据不证明这些独立能力轴；
- **把 macOS arm64 结果外推到 x64/Windows：** 违反逐 Adapter、逐平台资格合同。

<a id="v1-27-d04"></a>
## V1.27-D04：Kimi 使用全局私有 home、兼容 warm Host，并以标准 ACP 启用 External MCP

### 背景

D02 为了保存 Kimi Native Session，把私有 home 细分到 Camp、成员、Installation 和 auth scope。该分区并非
Kimi 的存储模型要求：Kimi 本来就在一个 home 内按 Session ID 管理多个会话，Rovai 的冻结 Runtime 与 Binding
compatibility 已决定某个逻辑会话能否恢复。多 scope 目录重复实现会话隔离，还产生无绑定目录的垃圾回收问题。

Kimi `0.32.0` 的原始 ACP Probe 已证明 `session/new.mcpServers` 可真实调用 stdio Server，但这还不足以建立
产品资格。本轮把标准 ACP Session 字段接入正式投影后，真实 Core 链路进一步通过 Assignment、AgentRun
Projection、ContextManifest 与 MiniMax M3 Tool call，同时验证 stdio、Streamable HTTP 和同名整项优先。

通用 ACP Host 已具备 compatibility-keyed warm LRU、quiescence 检查和同 Host 已知 Session 复用路径；Kimi
原始 Probe 也已证明同 Host 多 Session 无串话。产品级回归进一步证明正常完成后同一 Host/Session 可直接
续接，而显式停止后仍能从全局私有 home 在新 Host exact resume。继续逐 Run 停止只增加启动延迟，不再提供
额外隔离收益。

### 决定

1. 本决定替代 D02 第 2、3 项的 home scope；所有 Kimi Host 使用唯一
   `<data-dir>/runtime/kimi-code/home`，不改变通用 `HOME`，也不读写用户 `~/.kimi/config.toml`；
2. 物理 home 只负责保存 Kimi Native Session。Installation、auth、model、permission、workspace、MCP 与
   attachment 仍由 Frozen Runtime、Binding 和 Session compatibility 门禁决定，不从共享目录推导复用资格；
3. Kimi External MCP 为 `AdditivePerRun / RovaiWins`，通过 `session/new`、`session/resume` 或
   `session/load` 的标准 `mcpServers` 字段传入，不写用户级 Runtime 配置；支持 stdio 与 Streamable HTTP；
4. 本决定替代 D02 第 5 项和 D03 第 1 项的 warm Host 边界：正常完成后，只有健康、quiescent 且 Camp、成员和
   完整 Runtime compatibility key 一致的 Kimi Host 才进入 warm LRU；同 Host 已知 Session 直接复用，显式
   停止、淘汰或失效后仍走 cold exact resume；
5. D03 第 1、3 项中 External MCP Disabled 的结论由本决定替代。Usage/Cost、Compaction、macOS x64 和
   Windows x64 的边界不变；
6. 异步 command/config advertisement 继续安全路由为私有 metadata。当前产品没有消费它的需求，因此不维护
   产品权威 async catalog snapshot 是有意边界，不再作为遗留功能问题；
7. Cursor 保留 closed identity 和历史 reader，但当前没有真实产品资格，Settings Agent Runtime 目录默认隐藏。

当前规范见 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)与
[Runtime Launch and Verification v22](../../contracts/runtime-launch-and-verification-v22.md)。

### 后果

- Kimi 不再因 Rovai 人工分区生成多个 Session home，也没有 scoped-home 垃圾回收债务；
- 兼容后继 Run 避免重复进程启动和 initialize/resume；冷 Host exact resume 的 Session ID 与 fail-closed 语义不变；
- External MCP 使用 Run 冻结定义和既有 compatibility digest，不污染用户配置；
- 产品文档不再把未消费的异步 catalog 投影写成待实现问题；
- Cursor 仍可读取历史配置，但不会在 Runtime 设置目录制造“已经接入”的预期。

### 被拒绝方案

- **继续按 Camp/成员派生 home：** 与 Kimi 自己的多 Session 存储重复，并引入额外生命周期和 GC；
- **使用用户 `~/.kimi`：** 会污染日常配置并扩大 provider secret 与原生状态边界；
- **只保留原始 ACP MCP Probe：** 没有证明 Core Assignment、Manifest、同名策略或真实产品 Tool call；
- **把 MCP 写入 Kimi 用户级配置：** 不能保证只对当前 AgentRun 生效；
- **正常完成后仍逐 Run 停止 Host：** cold exact resume 能保持正确性，但会产生不必要的进程启动与握手延迟；
- **为当前未消费的 async catalog 建立产品 snapshot：** 没有用户表面或下游合同，增加状态机却不解决当前需求。

<a id="v1-27-d05"></a>
## V1.27-D05：Kimi 原生完成帧只在 idle ACP compatibility route 驱动 Compaction Observation

### 背景

早期 Probe 只看到普通 `agent_message_chunk`，因此把 Kimi Compaction 保持为 Disabled。后续对 Kimi `0.32.0`
安装包和官方 `main` 源码的交叉核对确认：native ACP Session 订阅内部 `compaction.started/completed/cancelled/blocked`，
并且仅在 `compaction.completed` 时把结果确定性格式化为一个固定四行完成帧。官方 E2E 同时证明手动 `/compact`
先结束 Prompt，再由后台 compaction 补发该完成帧；自动 compaction 使用相同完成路径。

ACP wire 没有暴露原始 event type 或 occurrence ID。直接匹配任意包含 `compact` 的 assistant 文本会误判；为了
获得内部事件而安装 Hook、修改用户配置或增加 side-channel 又会扩大 Runtime 隔离与秘密边界。另一个候选方案
是按一分钟窗口合并，但它无法区分短时间内两次真实完成事件。

### 决定

1. 本决定替代 D04 第 5 项中 Compaction 保持原边界的结论；Kimi Compaction policy 设为 `best_effort`，唯一 admission 为
   `kimi.acp.compaction.completed_text.v1 / completed`；
2. 只完整匹配官方四行格式及 en-US 非负整数，不接受前后缀、额外换行、宽泛关键词、started、cancelled 或
   blocked 文本；格式变化时 fail closed；
3. 完成帧只在 Kimi Prompt 已结束后的 Session metadata compatibility route，或 observer 仍绑定于同一 warm
   Host/Session 的正常 detached AgentRun route 准入。active Prompt 中的模型文本即使逐字相同也不产生
   observation；
4. started 不驱动 Context Epoch，也不用于完成态猜测；Kimi 官方每个内部 completed 事件发出一次 frame，Rovai
   使用现有 Host 单调 occurrence sequence，不增加一分钟抑制窗口；
5. detector 不安装 Hook、不修改用户 `KIMI_CODE_HOME/config.toml`、不增加 side-channel，也不使用 usage/token
   下降或历史长度 heuristic。

当前规范见 [Native Session Bootstrap Redelivery](../../architecture/native-session-bootstrap-redelivery.md)与
[Session 与 Bootstrap 不变量](../../architecture/foundational-invariants.md#context-session-bootstrap)。

### 后果

- 自动 compaction 和手动 `/compact` 收敛到同一个 Rovai authoritative Compaction Observation 入口；
- Kimi 官方完成格式若改变，detector 会停止产生 observation，但不会阻断 Runtime、Prompt 或 Session；
- observation 的权威性来自 Kimi-only idle route、官方精确 frame 与 Core Observer Lease 准入组合，不代表 ACP
  标准新增了结构化 `compaction_completed` event；
- Usage/Cost 监控仍保持 Disabled，与 Compaction detector 相互独立。

### 被拒绝方案

- **匹配包含 `compact` 的普通文本：** 无法区分模型回复和 lifecycle 输出；
- **一分钟内只记一次：** 会吞掉两次真实、合法的快速 compaction；
- **安装 Hook 或改写 Kimi 用户配置：** 没有必要，并扩大配置污染和生命周期复杂度；
- **使用 token/usage 下降补猜：** 不能证明完成边界，也违反现有 fail-closed 规则。

<a id="v1-27-d06"></a>
## V1.27-D06：正式 Kimi AgentRun 继承用户原生 Home，Probe 保持一次性隔离

### 背景

D01、D02 与 D04 逐步把 Kimi 从每 Host 临时 Home 收敛到全局 Rovai 私有 Home，解决了当时人为轮换目录导致的
resume 失败，却仍保留了一个未经产品需求证明的差异：正式 Kimi AgentRun 看不到用户日常 Kimi 的配置、认证和
原生 Session。对十二种 Product Runtime 的生产 launch path 复核后，Codex、Claude、Antigravity 及其余 ACP
Runtime 都默认继承用户原生状态根；个别 Runtime 使用临时 cwd、配置 overlay 或 Probe Home，但不把正式 state
Home 换成独立 Rovai 目录。

provider secret 的最小暴露由权限收窄的外部文件、严格 `KIMI_MODEL_*` allowlist 和 process-local 注入保证，
不要求同时隔离 Kimi state Home。继续使用全局私有 Home 会让用户已有 Kimi 配置与 Session 无法复用，也让
“尽量 warm reuse、冷 Host exact resume”的现有产品原则依赖 Rovai 自己维护第二套状态目录。

### 决定

1. 本决定替代 D04 第 1、2 项及“拒绝使用用户 `~/.kimi`”的结论；正式 Kimi AgentRun 不设置、删除或重写
   `HOME` / `KIMI_CODE_HOME`，父进程已设置时原样继承，未设置时由 Kimi 解析原生默认 Home；
2. Core 不复制、合并或改写用户 Kimi Home 内的配置、认证、Session、Skill 或日志。D01 的 provider 文件、
   allowlist、secret 不落库和 thinking 边界保持有效，process-local provider overlay 不构成 Home 隔离；
3. 显式 Deep Probe 继续使用 Probe-owned 临时 `KIMI_CODE_HOME`，不写正式 Binding，结束后清理。Probe 与 fixture
   的隔离不能进入正式 AgentRun，也不能替代产品 Home/continuation 验证；
4. D04 的 compatibility-keyed warm Host、同 Host 已知 Session 直接复用、停止/淘汰后的 exact resume、load-only
   replay quarantine、External MCP、Cursor 隐藏与 async catalog 边界保持有效。普通 resume Smoke 使用正常用户
   Home，不再把“新进程 + 人为不同 Home”列为必过产品场景；
5. v22 创建的 `<data-dir>/runtime/kimi-code/home` 不再用于新 Host，Core 不自动合并或删除其中数据。旧 Binding
   在用户原生 Home 不可见时按既有合同记录 continuity lost，并至多创建一个新 Session；
6. 当前字段级规范切换到 [Runtime Launch and Verification v23](../../contracts/runtime-launch-and-verification-v23.md)。

### 后果

- Rovai 内启动的 Kimi 与用户直接启动的 Kimi 使用同一原生配置、认证和 Session 状态根；
- warm Host 与 cold exact resume 的优先级不变，但不再依赖 Rovai 专属 state Home；
- provider key 仍只进入目标进程，External MCP 仍只进入当前 AgentRun，不写用户配置；
- 已有 v22 Native Session 可能在升级后的首次 continuation 中发生一次诚实的 continuity lost；旧目录保持可恢复，
  不由升级自动删除；
- 健康探针仍不会污染用户日常 Kimi Session。

### 被拒绝方案

- **继续使用唯一 Rovai 私有 Home：** 没有用户隔离需求，且与其他正式 Runtime 的默认行为不一致；
- **自动复制或合并旧私有 Home 到用户 Home：** 会修改用户配置/认证目录，冲突处理和回滚边界不明确；
- **只把用户配置软链接进私有 Home：** 形成部分共享、部分隔离的双重状态根，恢复和清理语义更难解释；
- **让 Probe 也使用用户 Home：** 会把一次性认证/Session 检查写入日常状态，降低测试隔离性。

<a id="v1-27-d07"></a>
## V1.27-D07：Kimi Active Prompt 以 exact lifecycle correlation 补齐 Compaction Observation

### 背景

D05 根据当时 E2E 解读，把 Kimi completion frame 限定在 Prompt 已结束后的 idle compatibility route。重新核对
Kimi `0.32.0` 安装包和官方 ACP adapter 后确认，自动 compaction 可以在 turn 执行期间发出
`compaction.started` 和 `compaction.completed`；ACP server 又把 started、completed、cancelled 与 blocked 都
降格为同形的 `agent_message_chunk`。现有 PromptActive 路由因此既漏掉真实 completed observation，也会把这些
本地 lifecycle 文本追加到 streamed agent text、Runtime final 和 Missing-Send candidate。

Kimi 的 blocked 实现只设置 `blockedByTurn`、发出事件并继续等待当前 compaction promise；只有 completed 和
cancelled settle 这次等待。把 blocked 当终态会提前清除 pending，使随后真实 completed 再次漏记。

### 决定

1. 本决定纠正并替代 D05 第 3、4 项关于 Active Prompt 与 started 的边界；D05 的 exact completed formatter、
   `best_effort` policy、idle/detached detector、无 Hook/用户配置/heuristic 和无一分钟抑制窗口结论保持有效；
2. `AcpActivePrompt` 保存 Kimi-only compact lifecycle：exact official started 建立 pending；blocked 在 pending 时
   只被消费且保持 pending；cancelled 清除 pending 但不产生 observation；completed 仅在 pending 时产生现有
   `CompactionObservation` 并清除 pending；
3. 相关 lifecycle frame 走 Session metadata 内部路由，不进入 streamed agent text、Runtime final 或
   Missing-Send。普通包含 `compact` 的文本和没有 pending 的 Active Prompt completed 继续作为普通 assistant
   output，不产生 observation；
4. PromptCompleted、Ready 与 detached warm-Host 的既有 exact completion detector 保留；本次只补齐生命周期
   与当前 Prompt 重叠的漏记，不改变现有 requested revision、prepare cutoff 或下一次 Runtime input 的 Bootstrap
   redelivery 机制；
5. ACP wire 没有 lifecycle source tag、occurrence ID 或 message provenance。因此 exact correlation 能排除单个
   completion 文本误判，却不能严格证明模型不会逐字生成 started→completed 整套 frame；能力继续明确标为
   `best_effort`，格式或 correlation 不满足时 fail closed，不补猜。

当前规范见 [Native Session Bootstrap Redelivery](../../architecture/native-session-bootstrap-redelivery.md)、
[Session 与 Bootstrap 不变量](../../architecture/foundational-invariants.md#context-session-bootstrap)与
[Runtime 接入 Checklist](../../development/runtime-integration-checklist.md#8-compaction-信号)。

### 后果

- 自动或手动 compaction 在 Active Prompt 内完成时会产生一次 observation，当前 AgentRun 正常继续；
- blocked 不再打断 pending correlation，后续 completed 仍能推进 durable requested revision；
- lifecycle 文本不会污染公开回答或 Missing-Send，redelivery 仍只发生在下一条尚未跨过 prepare cutoff 的输入；
- wire provenance 缺失造成的整套 frame 复现歧义被如实保留，不宣称结构化 ACP lifecycle 权威性。

### 被拒绝方案

- **blocked 清除 pending：** 与 Kimi 的等待实现冲突，会漏掉随后 completed；
- **Active Prompt 单独匹配 completed：** 模型输出同一四行文本时会产生更宽的误判；
- **一分钟内合并 observation：** 会吞掉两次真实快速 compaction，且不能解决 source provenance 缺失；
- **修改当前 Prompt 立即重投 Bootstrap：** 会破坏 prepare cutoff 与输入不重入边界，现有下一输入 redelivery
  已拥有正确时序。

<a id="v1-27-d08"></a>
## V1.27-D08：无可用 Runtime 时以无产品副作用终态结束首次训练

### 背景

First-run v1 把 Welcome、Member 与 Runtime 都定义为不可跳过的 mandatory gate，并只允许在成员 Runtime、
“初次集结”Camp 和 restore target 全部落盘后完成。该边界保证了正常配置不会产生半完成产品对象，却也让
一台没有安装、登录或通过平台准入的 Runtime 的电脑永久停在第三页：用户既不能执行 Agent，也不能进入
正常 App 查看设置和其他能力。

另一个方案是把扫描失败单独做成错误页并继续阻断，但“未安装”“未登录”“版本不支持”“平台未准入”和
“本轮检查没有可靠结果”对首次训练的可执行结论相同：都没有一个可以安全写入成员配置并开始 Run 的入口。
为了仅解除训练阻断，又不能用一个不可运行 Runtime 创建虚假的成员配置或 Camp。

### 决定

1. First-run 当前合同切换到 [v2](../../contracts/first-run-onboarding-v2.md)，Desktop `onboarding.json` 当前写入
   schema 2；合法 schema 1 状态确定性规范化，保留页、选择和 provisioning checkpoint；
2. schema 2 完成来源增加 `runtime_deferred`。该来源要求 `selectedMemberRole`、`memberAgentId` 和
   `quickChatCampId` 全部为 null；
3. Runtime 扫描结束且没有任何可直接继续的 Runtime，或本轮扫描失败/超时没有形成可靠可用结果时，Renderer
   使用同一空结果页，不建立独立“扫描失败”产品状态；用户可以重新扫描或选择“进入 Rovai”；
4. 延后配置只允许在 `in_progress(runtime)` 且 `provisioning = null` 时提交。它不调用成员、Runtime、Camp、
   Conversation、Message、Turn、Run 或 restorable-location mutation；
5. `runtime_deferred` 是训练终态，不是暂停。以后启动直接进入普通 App，Runtime 安装、登录与成员配置使用
   正常 Settings/成员工作区，不重新开启 onboarding；
6. 正常配置路径、冻结权限、幂等 checkpoint、“初次集结”和 Draft-only starter 语义保持不变；一旦
   provisioning 开始，不能切换到 deferred 路径。

当前规范见 [First-run Onboarding 架构](../../architecture/first-run-onboarding.md)、
[First-run Onboarding v2](../../contracts/first-run-onboarding-v2.md)与
[首次训练 UI](../../ui/components/first-run-onboarding.md)。

### 后果

- 没有 Runtime 的新用户可以进入正常 App，并在以后自行完成 Runtime 配置；
- 解除阻断不会制造一个不可运行成员、空壳“初次集结”或虚假的 Runtime readiness；
- `runtime_deferred` 没有 onboarding 第四页，普通 App 空状态与设置入口负责后续体验；
- 旧 schema 1 的未完成 provisioning 仍只能恢复原 saga，不能借升级绕过已发生的副作用；
- 完整桌面验收需要同时覆盖 configured 与 deferred 两种第三页终态。

### 被拒绝方案

- **继续强制安装 Runtime 才能进入 App：** 把缺少外部依赖变成永久产品导航阻断；
- **选择任意未验证 Runtime 并创建成员/Camp：** 会把不可执行状态伪装成已配置，破坏 Runtime fail-closed；
- **只在 React 内隐藏 onboarding：** 重启会恢复旧持久状态，不能真正解除卡死；
- **允许 provisioning 中途延后：** 可能留下已经创建的成员或配置，却把完成态声明为无产品身份；
- **新增独立扫描失败页：** 不改变用户可执行选择，只增加一个与零可用结果同义的产品状态。
