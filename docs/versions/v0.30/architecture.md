---
document_type: version-architecture
version: v0.30
authority: version-implementation-design
design_status: frozen
implementation_status: complete
last_updated: 2026-08-01
---

# v0.30 Antigravity 受证明 Team Bridge 实施设计

> 跨版本规范以
> [ADR-0088](decisions.md#adr-0088) 为准。本文只把该决策
> 收敛为 v0.30 的 Antigravity 实施边界和验收口径；对应实现与验收已经完成。

## 1. 平台 Spike 结论

当前本机 `agy 1.1.9` 的帮助入口包含 Plugin 管理、sandbox 和
`--dangerously-skip-permissions`，但没有逐 Run MCP config、strict、disable-native 或
allowlist 参数。官方文档给出用户级 `~/.gemini/config/mcp_config.json`、工作区
`.agents/mcp_config.json`、Plugin `mcp_config.json` 和
`mcp(server/tool)` 权限语法；它们没有构成“本 Run 最终只包含调用方提供 MCP”的保证。

已有本机验证说明默认 Agent 在用户级 MCP 配置下可以完成真实 `tools/call`；临时工作区
配置在 headless `agy --print` 下没有稳定复现相同行为。该差异只支持“原生配置路径值得继续
验证”，不支持直接选择 workspace 写入，也不支持宣告 Plugin/全局/工作区同名项的优先级。

隔离 Spike 与真实模型验收已经证明：

1. 专属 Plugin 的安装、启用、更新、禁用和卸载行为；
2. `agy` 启动 MCP command 时的真实直接父子进程关系；
3. macOS 上 Core 能从 Unix Socket 内核信息取得 Bridge peer PID，并可靠读取双方启动时间、
   父 PID、可执行路径、fingerprint/code signature；Bridge 也能核对服务端 Core peer 和
   endpoint owner/type/mode；
4. `post_message` 在模型看到的工具目录、Schema 和权限匹配中保持原名，不被改成点号或其他
   alias；
5. `mcp(rovai_team/post_message)` 的窄 allow 在非交互模式真实生效，deny/ask 优先级和
   headless soft-deny 行为符合预期；
6. Plugin、用户级和工作区出现同名 `rovai_team` 时的实际启动结果；
7. `agy 1.1.9` 不会在 Bridge 崩溃后重启该 MCP 子进程；因此当前只允许同一 Bridge 进程
   重建 Core 连接，新 Bridge 进程不能在同一 Run 重领；
8. Antigravity MCP 调用能否提供或由可信协议字段导出跨传输重试稳定的 tool-call identity，
   使 reconnect/重放继续满足既有幂等合同。

后续 Runtime 或版本复核中任何一项关键证明失败，都应让 Antigravity 保持
`TeamGatewayAttachment::Unsupported`，而不是在实施中放宽父子关系、权限或配置所有权。

## 2. 冻结能力组合

| Runtime 路径 | External MCP | Team Gateway | Ambient isolation |
|---|---|---|---|
| 当前支持 strict/私有投影的 Adapter | `ExactPerRun` | `InjectedCredential` | `Exact` |
| v0.30 Antigravity 已实现 | `Unsupported` | `AttestedNativeBridge` | `PreservedUncontrolled` |
| Antigravity 证明或权限失败 | `Unsupported` | `Unsupported` | `PreservedUncontrolled` |

三项能力分别进入探测证据、AgentRun 冻结配置和诊断投影。它们不成为角色或 Lead 准入条件；
但发送一个带外部 MCP Assignment 的 Antigravity Run 必须以
`external_mcp_projection_unsupported` 失败，不能运行后再省略工具。

Antigravity 作为 A2A 接收者仍只依赖目标 Runtime 自身可执行，不依赖发送侧 Team Tool。
作为 A2A 发送者则必须冻结 `AttestedNativeBridge`、具备 `team.post_message` Capability，并
通过当前 Run 的逐调用授权。

Attachment mode、`post_message` Schema、Bridge protocol/build 和对应 Charter 进入 Native
Session compatibility key。启用/停用 attachment 或改变工具合同会为后续 Run 换绑兼容
Session，不热改旧 Session。当前 Run 的配置 ownership、permission 或进程 identity 一旦安全
失效，lease 立即撤销；修复只在重新探测后的新 Run/Binding 生效，不复活旧 generation。

## 3. 目标启动与调用流程

```text
Rovai Core
  ├─ reconcile credentialless rovai_team native config
  ├─ freeze Runtime executable identity + three MCP capabilities
  ├─ create AgentRun / Native Binding / Execution Epoch
  ├─ establish child launch barrier and register Run Claim
  └─ release agy child
          └─ agy directly starts trusted rovai-team-mcp-bridge
                  └─ connect stable per-user Core rendezvous
                         ├─ Bridge verifies Core peer identity
                         ├─ Core obtains Bridge kernel peer PID
                         ├─ Bridge executable identity
                         ├─ direct parent agy identity
                         ├─ Claim / Binding / Epoch / Capability
                         └─ issue one in-memory connection lease

model tools/list
  └─ bound lease => post_message
  └─ no valid lease => empty

model tools/call post_message
  └─ revalidate process + lease + current Run authority
       └─ map to canonical team.post_message command
       └─ execute existing Core transaction/idempotency path
```

Core 必须在 `agy` 能 exec 并启动 Bridge 之前完成 Claim 登记。实现可以使用受控 child launch
barrier；不能依赖“父进程通常来得及登记”的调度竞态。如果平台无法可靠建立 barrier，
Antigravity Team Tool 不进入 Ready。

## 4. 配置投影与所有权状态机

### 4.1 首选 Plugin

首选安装一个只由 Rovai 管理的全局 Antigravity Plugin。其 MCP 文档只含：

```json
{
  "mcpServers": {
    "rovai_team": {
      "command": "/absolute/path/to/rovai-core",
      "args": [
        "attested-team-mcp-bridge",
        "--rendezvous",
        "/absolute/os-user-temp/rovai-attested-team-<uid>/core.sock"
      ]
    }
  }
}
```

最终字段以当前 Antigravity schema 和本机 Plugin validate 结果为准；不得复制环境凭据，
也不得为了方便加入外部 MCP。Plugin manifest、Bridge 路径和签名要随当前 Rovai 安装原子
更新。Plugin 被用户禁用或内容 divergence 后，Rovai 只报告冲突，不强行重新启用或覆盖。
`rovai-team-mcp-bridge` 是专用 attested entrypoint，不复用“缺少环境凭据就切换模式”的旧
Connector 分支，也不接受 Binding secret 参数。

### 4.2 用户级 JSON fallback（本版本未激活）

专属 Plugin 已通过当前版本真实验证，因此产品实现没有进入本 fallback。若未来 Plugin 路径
失效，必须先按以下既有设计另行实现和验证，不能临时降级为普通 JSON 覆盖。只有 Plugin
路径经当前版本验证不可用，才允许合并
`~/.gemini/config/mcp_config.json`。一次 reconcile 的顺序固定为：

1. 取得 Rovai 专用进程间锁；
2. 读取原始字节、权限、文件 identity 和全文 digest；
3. 解析为可保留未知字段的 JSON document；解析失败立即结束，不创建替代空文件；
4. 扫描已知用户级、workspace 和 Plugin 来源的 `rovai_team`；
5. 根据 Core-owned、Agent 不可访问的 App-data ownership record 与 entry digest 判定
   absent / owned / conflict；
6. 只在 absent 或 owned 时生成最小结构变更；
7. 写同目录临时文件；临时权限不得比目标更宽。另写只含阶段、文件 identity 与
   before/after digest 的当前用户私有 crash journal，不复制 MCP 原文或 secret；
8. replace 前重新核对目标全文 digest 与 file identity；不一致即 CAS conflict；
9. 原子 replace、同步必要目录元数据、回读并校验全文和 entry digest；
10. 最后提交新的私有 ownership record，再清理 journal。

恢复时根据 journal 的 before/after digest 判断“尚未替换”“替换完成”或“外部已修改”；第三种
只报告冲突，绝不根据名称猜测并回滚。卸载执行同一流程，而且只有 entry digest 精确等于
最后写入值时才删除 `rovai_team`。

锁只能协调 Rovai 自身进程；Antigravity 或其他编辑器未必遵守。因此全文 CAS 与回读失败
必须是可见错误，产品文案不得把 fallback 描述成与所有第三方写入者强原子的事务。

## 5. Rendezvous、Claim 与 Lease

### 5.1 稳定 endpoint

当前 `InjectedCredential` Adapter 的临时 Socket、Binding credential 和恢复路径保持不变。
Core 另开一个只接受 `AttestedNativeBridge` handshake 的稳定 listener；credentialed Connector
不能在这里回退成进程证明，credentialless Bridge 也不能尝试旧 listener。两条入口验证成功后
才复用同一 Team Gateway command handler。

新 listener 在当前用户私有 Runtime 目录创建固定 endpoint，父目录为 `0700`，Socket 为当前
用户专用。确切平台路径由实现选择并进入路径安全测试；不得放入工作区、世界可写的裸文件名
或包含随机 Core PID 且 Bridge 无法发现的位置。

Core 启动时只清理自己能通过文件类型、owner、父目录和现存 owner-process 证明为 stale 的
endpoint。发现来源不明的同名路径时失败关闭，不能 unlink 后抢占。

Bridge 连接后先核对 endpoint owner/type/mode，并从内核取得服务端 peer PID，验证其可执行
identity 或平台 code-signing requirement 属于当前受信 Rovai Core。双向检查通过前不发送
MCP 参数或接受 lease；固定路径和相同 UID 都不是充分的 Core 身份。Core 不存在或不可信时，
Bridge 仍以空 `tools/list` 提供关闭状态，直接调用返回 `run_not_bound`，不得把连接失败变成
一个可绕过的本地工具实现。

### 5.2 Claim 状态

```text
Registered ──attest──> Leased ──request complete──> Reconnectable
     │                    │                              │
     ├─bootstrap expiry──> Expired                       ├─same Bridge attest──> Leased
     └─Run/Binding/Epoch invalid─────────────────────────┴──────────> Revoked
```

- `Registered` 只存在很短的 bootstrap window，且尚无工具权力。
- `Leased` 同时最多对应一条已证明连接。
- `Reconnectable` 只允许已经绑定的同一 Bridge process instance 在同一活跃 Run、同一 `agy`
  PID/start time、同一 Binding/Epoch 内重建 Core 连接。
- Bridge process crash 后 `agy 1.1.9` 不会重启它；不同 Bridge process 的重领失败关闭。
- `Expired` / `Revoked` 不可复活；新的 Run 必须建立新 Claim/generation。
- 配置 ownership divergence、用户撤回 permission 或冻结 identity 失效直接进入
  `Revoked`，即使进程仍存活也不能继续调用。

任何 PID 检查都必须和 process start time、可执行 identity 联合使用。Bridge 自报的 PID、
父 PID、Run ID 或 Binding 只可用于诊断比对，不能成为授权输入。

### 5.3 每次调用

`tools/list` 每次都重新确认连接、Claim、lease generation、父子进程和当前 Run 仍有效，
只有全部成立时返回 `post_message`。`tools/call` 还要重新确认：

- peer 和直接父进程仍是原来两个 process instance；
- Claim/lease generation 没有被替代；
- AgentRun 唯一、当前、`running` 且未取消；
- Native Binding/Generation 和 Execution Epoch 匹配；
- CampMember 仍 active，`team.post_message` Capability 和目标/循环/配额仍允许；
- MCP tool-call identity 合法且能进入既有幂等 command identity。

失败统一返回稳定、可诊断但不泄漏 Binding/Run 内部标识的错误。`run_not_bound`、
`attestation_failed`、`lease_revoked`、`permission_blocked` 和 `config_conflict` 必须可区分。
证明失败不创建 SQLite 审计事件；只允许写脱敏进程日志和更新 Runtime 健康证据。

## 6. 权限与 Charter

Antigravity MCP 权限按 `mcp(server/tool)` 匹配，所以 v0.30 只请求
`mcp(rovai_team/post_message)`。配置管理和权限管理是两个独立 consent：安装 Bridge 不等于
允许模型调用，用户允许工具也不等于允许 Rovai 接管一个已冲突的 MCP 条目。

优先实现受管窄 allow，但只有官方格式、优先级、用户撤回和 exact-digest ownership 都通过
Spike 才能写入。已有 deny/ask 或 divergence 时保持用户配置。用户主动选择
`dangerously_skip_permissions` 时可以沿用其 Runtime 选择，但 Rovai 不替用户开启，也不因
Team Tool 将只读模式自动升级为 bypass。

当前 Antigravity launcher 在只读模式会强制把 `dangerously_skip_permissions` 归一为关闭；
v0.30 不放宽这条安全规则。因此只读成员只有在窄 allow 已被实证并由用户同意时才能获得
发送侧 Team Tool，否则保持 `permission_blocked`，但普通只读 Run 仍可按原能力执行。

只有 attachment 与非交互权限都 ready 时，Antigravity 新 Session 的首次冻结输入才描述
`post_message`。不得把 Task/Memory 工具规则放入该 Runtime 的 Charter，也不得靠 prompt
声称工具存在。

## 7. 状态、审计与用户披露

Runtime 健康证据至少区分：

- Team Bridge 未安装；
- 配置同名冲突或 ownership divergence；
- Plugin 被禁用；
- 原生 permission 阻塞；
- 进程证明不受支持或失败；
- Team Gateway ready；
- ambient MCP preserved/uncontrolled；
- 外部 MCP Assignment unsupported。

用户可见主状态继续遵守 ADR-0083，只显示一个可操作结果；上述细节进入次级说明和诊断。
AgentRun 审计冻结三个能力值、配置策略、Bridge build identity 和证明结果摘要，但不记录
Socket session、Binding credential、原始环境或用户 MCP secret。

## 8. 验收矩阵

| 场景 | 预期 |
|---|---|
| Rovai 启动、Claim 有效、窄权限允许 | 模型只发现 `post_message`，真实调用产生一次规范 A2A 事务 |
| 普通终端直接启动 `agy` | Bridge 可以被拉起，但 `tools/list` 为空；调用为 `run_not_bound`，SQLite 零写入 |
| PID 被重用或启动时间不符 | 证明失败，不发 lease |
| Bridge 或 `agy` 可执行文件被替换 | identity/fingerprint 失败，Run 不获得 Team Tool |
| 固定 endpoint 被未知进程或另一 Core 占用 | Core 不抢占；Bridge 不信任对端，Team Tool 不 Ready |
| 同一 Claim 第二个 Bridge 并发连接 | 后来连接拒绝，不抢占当前 lease |
| 同一 Bridge 重建 Core 连接 | 同一 Run 可继续；每次连接重新证明并取得新 generation |
| Bridge process 崩溃 | `agy 1.1.9` 不重启它；当前 Run 失败关闭，不允许新进程重领 |
| Run 取消、终止、Binding 换代或 Core 重启 | 后续调用失败，领域零写入 |
| permission 撤回或受管配置 divergence | 活跃 lease 撤销；修复后仅新 Run/Binding 可重新领取 |
| 用户已有/修改 `rovai_team` | Rovai 不覆盖、不删除，状态为 config conflict |
| JSON malformed 或写入期间 CAS 变化 | 原文件保留，journal 可恢复，Team Tool 不 Ready |
| Plugin/workspace 同名 shadow | 启动前冲突；不得以单文件唯一键声称有效配置安全 |
| 默认 Ask 在 headless 被 soft-deny | 状态为 permission blocked，不声称 tools/call 可用 |
| 用户有外部 MCP Assignment | Antigravity Run 准入拒绝，不静默丢弃 Assignment |
| ambient 原生 MCP 同时存在 | 可以保留，但 UI/审计明确显示 `PreservedUncontrolled` |
| A2A 调用重放 | 沿用既有幂等结果，不产生重复消息或目标 Run |
| 现有 credentialed Adapter 回归 | 继续使用原 endpoint/credential；工具、恢复和错误语义不变 |

## 9. 实施完成定义

本版本只有在 Core/Adapter/Bridge/配置管理、合同测试、恶意与故障路径、打包签名检查以及
真实 Antigravity 模型 Smoke 全部通过后才能标记完成。至少需要两类真实 Smoke：

1. Rovai 启动的 Antigravity AgentRun 成功发现并调用 `post_message`，目标成员收到一次消息；
2. 相同用户配置下从普通终端启动 Antigravity，不能发现或调用 Team Tool，SQLite 前后
   digest 和领域计数保持不变。

仅 Plugin validate、MCP initialize、Bridge 启动日志、`tools/list` 或模拟 Core 响应都不足以
单独完成验收。

## References

- [Antigravity MCP Servers](https://antigravity.google/docs/mcp)
- [Antigravity Plugins](https://antigravity.google/docs/plugins)
- [Antigravity CLI Permissions](https://antigravity.google/docs/cli/permissions)
- [Antigravity CLI changelog](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md)
- [Runtime 兼容性清单](../../runtime-compatibility.md)
- [v0.30 实施门禁](implementation-plan.md)
