---
document_type: version-decisions
version: v1.39
lifecycle: current
last_updated: 2026-09-03
---

# v1.39 决定

<a id="v1-39-d01"></a>
## V1.39-D01：Pi 使用独立 JSONL Host，Catalog identity 与平台资格分离

### 背景

Pi 0.84.4 提供 LF-delimited JSONL RPC 和官方 extension API，而不是 ACP。旧分支已远离当前 Fleet、取消和数据
合同；其他 Runtime 的平台 evidence 也不能证明 Pi。

### 决定

从当前 main 重新实现 `pi-jsonl-rpc-v1` 与独立 `runtime.pi` optional subsystem，不复用 ACP init/storage，也不
合并旧分支。Pi 可以进入编译时 Product Runtime closed set。最初决定在取得各平台 immutable qualification artifact
前全部 NotQualified；该平台开放部分已由 [V1.39-D06](#v1-39-d06) 取代，独立 transport 与证据不可继承边界仍有效。

### 后果与被拒绝方案

Core 缺少 Pi 时继续启动，只有 `runtime.pi` degraded。拒绝把 Pi 包装成 ACP或继承通用/Kimi/Grok platform
evidence；两者都会伪造 protocol/capability 或开放未经验证的产品路径。

<a id="v1-39-d02"></a>
## V1.39-D02：Pi 采用串行多 Session Resident Host，完整 locator 永远私有

### 背景

Pi 的一个 RPC 进程可以 `new_session` 和 `switch_session(exact path)`；把 Session、Bootstrap、Skills 或 MCP 放入
进程 key 会失去安全复用，使用 recent/partial ID 又会破坏 exact continuation。完整 session file 同时是用户原生
历史 locator，不应出现在公开诊断。

### 决定

Pi Host 策略为 `resident_multi_session`，同一 Host 一次只绑定一个 Run；并发使用独立 Host。Pi 在统一 Fleet 中用
canonical workspace + process digest 作为复用 identity，因此同 workspace、process-compatible 的不同 Camp/成员可
串行领取同一 Host；Fleet 另存当前独占 lease 的 Camp/member invalidation scope，并在每次领取时更新，Camp 删除或成员
移除仍会停止当前属于该 scope 的 Host。其他 Runtime 的 Camp/member-scoped identity 不变。Pi process digest 只包含
workspace、executable/fingerprint、protocol、managed extension、固定 managed permission boundary 与 process
compatibility。每次恢复实际调用
`switch_session(exact canonical file)`，再用 `get_state` 核对完整 session ID、file 和 cwd；失败停止 Host、记录
continuity lost，并最多创建一个 replacement。完整 locator 只在 Core 私有状态，公开面最多给不可逆 digest。

### 后果与被拒绝方案

Bootstrap/Skills/MCP/model 可以逐 Session 刷新，不要求重启进程；只有真正 quiescent Host 进入 LRU。workspace
Resident 使用独立 quota bucket，仍受 Fleet global quota、TTL 与 LRU 约束。拒绝把 Pi 永久绑定单 Session、模糊扫描
最近历史、丢失当前 Camp/member invalidation scope 或把 locator 放进 Activity/read model；这些方案分别浪费可验证的
上游能力，或破坏删除、身份和隐私边界。

<a id="v1-39-d03"></a>
## V1.39-D03：Bootstrap 使用 managed system prompt 与不可变原子 receipt

### 背景

启动参数固定 Bootstrap 会阻止同 Host 多 Session 复用；普通 first payload 会降低 Charter/Identity/Memory 的
指令层级。仅收到 Pi prompt response 也不能证明 extension 实际使用了当前 frozen Bootstrap、Skills、MCP 和 binding。

### 决定

采用已确认的[模型上下文 revision 1](model-context-change-pi-managed-system-prompt.md)：官方
`before_agent_start` 把完整 Bootstrap 追加到 Pi base system prompt。extension 在 provider request 前提交 closed、
nonce-bound receipt；Core 逐字段验证并在同一 SQLite 事务写入不可变 receipt、接受 Runtime Input Delivery。
Pi compaction 固定为 `native_system_prompt_preserved`，不加入 redelivery requirement/observer lease。

### 后果与被拒绝方案

每轮都能证明 exact high-authority bytes 和 Session capability，没有 receipt 就不接受输入。拒绝 `--append-system-prompt`
进程级固定、普通用户消息注入或只信 prompt ACK；它们分别阻止多 Session、降低权限层或缺少实际投递证据。

<a id="v1-39-d04"></a>
## V1.39-D04：Pi Skills/MCP 动态兼容追加，mutation 由 Core 管理

### 背景

Pi 没有内建 MCP，但官方 extension 可以动态注册 Tool、选择 active tools，并在 tool call 前阻塞。把“没有内建
MCP”解释为上游 Unsupported 会忽略正式扩展面；把 Server secret 写入 Pi 全局配置又会跨 Run 泄漏。

### 决定

Skill Library 继续以 `.pi/skills` 为 Rovai-owned target，每个 Session 重新 discovery 并把 exact catalog 写入
receipt。External MCP 使用 `AdditivePerRun / RovaiWins / CoreManaged`：Core 持有 stdio/Streamable HTTP、secret、
cancel 与进程树，extension 只暴露当前 Run 的 proxy tools；所有 mutation 与 bash/write/edit 共用 Durable Approval、
epoch/binding fence 和 effect evidence。未知 mutation/bridge failure fail closed。

### 后果与被拒绝方案

Host 无需因 Skill/MCP 更新重启，相邻 Session 又不会继承前一 Run exposure。拒绝标记 MCP Unsupported、写用户 Pi
配置或信任任意第三方 extension；前者错误收窄能力，后两者扩大秘密与代码执行边界。

<a id="v1-39-d05"></a>
## V1.39-D05：消息文件链接先证明存在，视觉类型不接管打开分类

### 背景

会话过去只凭 Markdown 语法和一组分散扩展名，把部分整体 inline-code 投影成可点击文件引用。于是 `config.toml`
这类真实短文件名无法链接，新增的音视频、Notebook、数据库等类型可能有图标却进不了识别；反过来，不存在的路径也
可能先显示为文件入口。会话链接与 Preview Tab 又分别维护扩展名到图标的映射，同一文件会因入口不同而显示不同类型。

一种方案是把扩展名、图标和 `preview/system` 打开策略都放进同一注册表。但现有 Main classifier 还结合大小、MIME、
内容与平台能力，静态扩展名表不能代替它；这样做会让 Renderer 的视觉决定静默改变安全和打开行为。

### 决定

完整 inline-code 先作为语法候选，通过 typed Preload 请求让 Core 复核 exact CampMessage 来源，再由 Main 按同一来源
工作目录执行路径解析、`realpath + stat`。只有最终落到现存普通文件的候选才显示图标并成为链接；不存在、目录或失败项
继续显示普通 inline-code。响应只返回消息中原始引用，不返回 canonical path 或任何文件能力，点击时重新执行完整打开校验。

建立唯一共享资源类型定义，只回答“是否为已知类型”和“显示哪个 `ResourceVisualKind`”。会话链接和普通文件 Tab
共用这份定义。Preview、系统应用或失败仍由 Main 既有 classifier 决定；存在性探测不调用 classifier，不支持预览的文件
不创建 Tab、handle 或 watcher。当前字段与边界由 [File Preview v4](../../contracts/file-preview-v4.md)、
[File Preview Architecture](../../architecture/file-preview.md)和[Camp 文件预览区](../../ui/components/file-preview.md)拥有。

### 后果与替代方案

- 短文件名不再靠同消息中的另一条长路径猜目录；它只按消息来源工作目录的 exact relative path 判断，绝对路径直接解析。
- 探测与点击使用同一 Core 来源映射，但探测时文件仍可能在点击前变化，因此点击重验不可省略。
- 拒绝“已知扩展名即链接”：它无法证明目标存在，会制造虚假可操作状态。
- 拒绝让资源注册表包含 `openStrategy`：它会复制并削弱 Main classifier 的大小、MIME、内容和平台判断。
- 拒绝让 Renderer 直接检查磁盘：它会越过 Preload/Main/Core 的来源权威并暴露宿主路径能力。

<a id="v1-39-d06"></a>
## V1.39-D06：Pi 三平台以可运行 Preview 开放，不伪造 Qualified 证据

### 背景

Pi 的 Adapter、无 Prompt Machine Ready、managed receipt、Skills/MCP、Action、Usage、Session 与本机 macOS arm64
行为 smoke 已可供主动测试，但完整 compaction、workspace/read-only、failure/retry、idle eviction、packaged lifecycle
以及 macOS x64/Windows x64 证据仍未闭合。既有三态 Platform Admission 只能在“完全阻断”和“宣称 qualified”之间
选择，无法诚实表达用户明确要求的实验性开放。

### 决定

Runtime Platform Admission 增加 `preview`：它允许 discovery、检查、Installation、Onboarding/Member 选择、Diagnostics
与 AgentRun，但必须保留阻止正式资格化的 reason，且 `evidenceRevision = null`。Pi 的 macOS arm64、macOS x64、
Windows x64 三行均改为 `preview / runtime_platform.qualification_evidence_missing`；Renderer 显示“实验性开放”，
真实 machine availability 与所有 Runtime/Dispatch blocker 继续独立生效。release 不再依赖 debug-only Pi qualification
override。Cursor 和其他 Runtime 的 admission 不变。

### 后果与被拒绝方案

- 用户可以在三个 shipped platform 主动选择和验证 Pi，但产品不得称其为 First-Class 或 qualified。
- 后续每个平台仍须生成独立 immutable qualification artifact，才能把该精确行升级为 `qualified`。
- 拒绝直接把 Pi 三行写成 `qualified`：这会伪造尚不存在的跨平台 Golden Flow 证据。
- 拒绝只在 Renderer 解禁下拉框：Core discovery、Installation 与 Dispatch 仍会阻断，形成不可执行的假入口。
- 拒绝继续使用 release 环境变量 override：隐藏开关不能成为可审计的产品准入合同。
