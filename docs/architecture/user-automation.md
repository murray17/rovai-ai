---
document_type: architecture
architecture: user-automation
authority: desktop-user-automation-component-boundaries
status: accepted
last_updated: 2026-08-21
---

# User Automation Architecture

本文说明普通用户终端自动化与 Runtime Diagnostic Trial 的长期组件边界。字段、命令、错误和 bundle 以
[User Automation v1](../contracts/user-automation-v1.md)为准；决定理由见
[v1.21 决策](../versions/v1.21/decisions.md)。

## 进程结构

```text
Rovai Desktop
├── Electron Main
│   ├── UserAutomationServer        当前用户私有 socket / credential
│   ├── closed operation dispatcher
│   └── Core client + Renderer navigation
└── rovai-core                      领域写入、Read Model、预算与执行权威

rovai app ...                       每次命令一个短进程
    └── User Automation IPC ──────> Electron Main

Agent Runtime
    └── rovai send/... ───────────> process-private Agent CLI IPC ──> Core Built-in Router
```

一个 binary 降低安装和命令认知成本；namespace 之后的调用身份和能力完全分离。Electron Main 是 User
Automation 的唯一 owner，因为它同时拥有 Desktop 生命周期、Renderer window/navigation 与 Core client。
Core 不监听第二个用户 socket，也不拥有 Trial 编排；独立 daemon 会制造第二个 App 生命周期和 credential
owner，因此 V1 不采用。

## 组件职责

| 组件 | 拥有 | 不拥有 |
| --- | --- | --- |
| `rovai app` CLI | 参数/文件读取、context discovery、IPC、Trial journal/编排、双 cursor wait、安全 bundle | 领域授权、Core credential、Runtime launch、AgentRun terminal 推断 |
| Electron Main server | endpoint 生命周期、用户 credential、closed dispatch、错误脱敏、Camp window navigation | 任意 Core invoke、Trial/Benchmark entity、Runtime output 替代公共消息 |
| Core | Camp/Message/AgentRun mutation、预算、terminal、Evidence、公共消息、诊断安全投影 | CLI journal、Trial 生命周期、自动打开 Desktop |
| Renderer | 复用既有 Camp activation 呈现目标 Camp | endpoint、credential、路径、Core method 选择 |
| Runtime Adapter | 既有 Run 执行和 Evidence 生产 | Trial 资格、导出格式、User Automation transport |

## 调用与故障边界

Main dispatcher 将每个 public operation 映射到固定 Core method/组合，不透传 method name。读写都经过既有
Core service；Main 不直接访问 SQLite。`camp send` 使用 Composer revision 与正式 send，从而继承成员、预算、
附件、pending 和执行准入。当前合同无法解释的新状态必须失败并要求升级，不能以 convenience path 绕过。

IPC 断开不能证明 mutation 未发生。CLI 的 mutation command ID 在首次 Core 写之前进入 durable journal；失败
时返回已知 identity 并引导用户用 read command 复核。V1 不自动重试无法证明 outcome 的 mutation。read/watch
可从已确认 cursor 重连。

## 诊断而非评测

Diagnostic Trial 只回答“这个已配置成员 Runtime 能否在当前产品路径上接受并完成这一个隔离任务，以及 Core
记录了什么”。它不拥有 case catalog、replica、judge、score、comparison、qualification 或 publication。
现有 Benchmark/Qualification 架构不能消费 Trial bundle 后将其自动提升为正式结果；需要正式评测时仍使用其
独立 admission、protocol 与 evidence chain。

Core 的安全诊断投影把 frozen facts、公开输出与派生摘要组合成 allowlist view。Main 和 CLI 不读取 raw Runtime
payload 后再做黑名单脱敏；这样新私有字段不会因调用方忘记删除而进入终端或 bundle。公共结果必须来自
CampMessage publication seam，Evidence 只说明观察事实，不替代消息、Task outcome 或 terminal authority。

## Desktop 生命周期

Server 只随已运行 Desktop 存在，启动后写新 instance context，受控关闭先停止接收新 automation，再进入既有
Core drain。异常遗留 context 在下一次连接时按 PID/socket/instance 失败为 `app_not_running`，不会启动 App 或
连接其他用户实例。`camp open` 在 Core existence check 后复用现有 window/activation flow，不创建第二套
Renderer route state。

## 平台与演进

V1 的产品资格仅覆盖 macOS Unix Socket。Windows 必须在受保护 Named Pipe ACL、实例发现、安装 CLI 与真实
host acceptance 完成后独立准入，不能将 Unix 权限语义机械映射。未来添加 operation 时必须同时更新 closed
dispatcher、Contract、CLI help、错误/安全测试与版本影响记录；不得先加入 generic invoke 再依靠文档约束。
