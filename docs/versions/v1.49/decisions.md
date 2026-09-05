---
document_type: version-decisions
version: v1.49
lifecycle: current
last_updated: 2026-09-05
---

# v1.49 决定

<a id="v1-49-d01"></a>
## V1.49-D01：正常退出先复用 Camp Leave Guard，再启动 Planned Shutdown

### 背景

最新 Composer 正文只存在于 Renderer 的 Lexical EditorState，低频 autosave 不保证用户触发退出时最后一次编辑已成为
Core Draft。Planned Shutdown 一旦开始便关闭新的业务 request、execution 和 writer admission，因此在
`runtime.state = shutting_down` 之后再保存既太晚，也会把 Draft persistence 错误地耦合进 AgentRun/Runtime 关闭协议。
React cleanup 与 `beforeunload` 同样不能可靠等待附件、Draft queue 和 exact revision persistence。

### 决定

保留 Main 的唯一 `AppQuitCoordinator` 和 Renderer 的唯一 `CampLeaveGuard`。Main 阻止首个正常或更新 quit，在服务
drain 与 `core.shutdown()` 前通过私有一次性响应通道请求 Renderer；Renderer 只对精确匹配当前 view/Camp 的注册调用
guard，成功后 `complete(true)`。附件准备、Lexical flush、Coordinator idle、Core revision 与 Pending 收尾继续内聚在
guard，Main 不理解 Draft。准备失败终止本次 quit、保留 App/Core 和 Composer，并让后续 quit 重试；只有成功响应才
进入既有 Planned Shutdown。

### 后果与被拒绝方案

- 正常退出建立 `latest EditorState persisted -> Core shutdown` 的明确 happens-before；clean Draft 仍可 no-op。
- `runtime.state = shutting_down` 和现有 overlay 仍只表示 Planned Shutdown，不新增准备 UI 或退出状态。
- Windows/Linux 主窗口 close 必须在 Renderer 销毁前进入 coordinator；macOS 关窗不退出语义保持不变。
- 拒绝 Main 直接保存 Draft：它没有 Lexical、附件队列或 Coordinator authority。
- 拒绝 localStorage、新 Draft Store、`beforeunload`、新 Shutdown Coordinator 或 Composer 状态机：现有 guard 已拥有完整
  可等待的保存边界。
- 拒绝 Draft 保存失败后继续取消 AgentRun：这会在用户仍留在 App 时不可逆地关闭 Core 业务准入。

<a id="v1-49-d02"></a>
## V1.49-D02：目标主机验收后正式准入 Pi 三个平台

### 背景

V1.39-D06 在缺少精确平台发布确认时把 Pi 的 macOS arm64、macOS x64 与 Windows x64 行开放为 `preview`，允许
真实 discovery、检查、成员选择和 AgentRun，但要求 UI 明示“实验性”。随后 Pi 的独立 JSONL Host、官方配置、
exact Session continuation、原生 Tool、Usage、Fleet、计划关闭与 Windows command shim/private storage 问题已逐步
收敛。2026-09-05，维护者确认 Pi 已在三个目标平台分别验证通过，没有发现阻止发布的问题，并明确要求三端移除
实验性披露、合入主线。

### 决定

1. `pi × macos-arm64`、`pi × macos-x64` 与 `pi × windows-x64` 从 `preview` 晋升为 `qualified`；每行
   `reasonCode = null`，并分别绑定 `macos-arm64-pi-v1`、`macos-x64-pi-v1`、`windows-x64-pi-v1` 的不可变
   SHA-256 evidence revision；
2. 三个平台进入普通 Runtime 展示，成员下拉不再追加“（实验性）”，Settings 不再显示“实验性开放”；Renderer
   继续保留通用 `preview` 状态的 disclosure，不能把本次 Pi 晋升变成删除平台状态；
3. 平台准入仍不制造机器状态。安装、最低版本、官方认证、模型、Native Session、capability、Deep Probe 与 Dispatch
   Preflight 继续按现有合同逐次检查并 fail closed；
4. Pi `>=0.84.4`、原生 ResourceLoader/Tool/permission、External MCP `Unsupported`、Web Search/Fast hidden、
   terminal assistant Usage 和未知 reasoning/cost 等既有能力边界不变；本决定不新增功能声明；
5. macOS 两个平台的晋升来源是维护者完成目标主机验收后的明确发布确认；本提交不冒充重跑私有模型 Session。
   Windows 的当前安装 Core 另完成真实 MiniMax-M3 回复、Host 重启 exact continuation、原生写入/Bash 与关闭验证；
6. 未来平台、低于最低版本或产生不兼容漂移的 Pi build 不得继承这三份 evidence，必须重新验证和单独裁决。

### 后果与被拒绝方案

- Pi 在三个 shipped platform 上均按正式 Product Runtime 展示，同时继续如实显示本机是否安装、登录和 Ready；
- 每个平台有自己的 evidence digest，不借用通用 macOS/Windows、Kimi、Grok 或另一个 Pi 平台的证据；
- 拒绝只删 Renderer 文案而保留 `preview`：这会违反 Core 单一准入真源并隐藏仍存在的实验状态；
- 拒绝用一份跨平台 digest 批量晋升：平台差异和发布确认将失去可审计边界；
- 拒绝借准入顺手开启 External MCP、Fast、Web Search、Approval 或 sandbox：本次没有这些独立能力证据。

当前规范见 [Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md)、
[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)与
[Runtime 兼容性清单](../../runtime-compatibility.md)。
