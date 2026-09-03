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
合并旧分支。Pi 可以进入编译时 Product Runtime closed set，但 macOS arm64、macOS x64、Windows x64 在取得各自
Pi immutable qualification artifact 前全部 NotQualified；debug-only 本机 override 不能进入 release。

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
