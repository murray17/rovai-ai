---
document_type: version-decisions
version: v0.87
lifecycle: historical
last_updated: 2026-08-18
---

# v0.87 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0192](#adr-0192) | Purpose-Scoped Runtime Launch and Execution-Deferred Verification | `accepted` |

<!-- legacy-adr:begin id=ADR-0192 source-file-sha256=1140fcea59e317b8a3ef9df805e485ee917695f81f950563c476c9ff3779b5cd -->
<a id="adr-0192"></a>

## ADR-0192: Purpose-Scoped Runtime Launch and Execution-Deferred Verification

迁移时原路径：`docs/adr/0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0192
title: Purpose-Scoped Runtime Launch and Execution-Deferred Verification
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.87
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0192 -->
<a id="adr-0192-context"></a>
### Context

第三方 CLI 的 metadata command 仍是任意产品代码执行，不能天然视为无副作用。TRAE CLI 的
`--version` 会进入通用初始化并可能访问 macOS 钥匙串；既有“无人值守时不启动”的保护仍允许设置页手动检查、
安装刷新、health probe 或 dispatch preflight 启动它。只修复某一个调用点会让后续调用链重新引入同类问题。

Rovai 同时必须诚实区分文件已安装与 Runtime 已登录、协议兼容和能力可用，并允许用户在不产生额外 Probe
进程的前提下实际运行 TRAE。现有 Ready-only 成员配置与后台主动检查规则没有表达这种 execution-deferred
验证方式。

<a id="adr-0192-decision"></a>
### Decision

1. 每次启动 Product Runtime 子进程都必须声明一个产品目的，并通过中央 launch policy。用户点击、后台任务、
   “诊断”或“自检”本身都不构成启动权限。
2. Adapter 可以收窄允许目的。TRAE 只允许真实 `AgentExecution`；discovery/version、availability、安装刷新、
   health probe 和 dispatch preflight 都必须只读取本地文件与进程内可解析的可信元数据。
3. 静态发现生成独立 `installed_unverified` 证据，只证明可执行路径与文件身份；它不得声明认证、协议、模型、
   Session 或 capability Ready。可信静态版本不存在时，版本保持 unknown。
4. TRAE 的未验证成员配置只允许 Runtime default model 与安全默认权限。它是 ADR-0127 Ready-only 保存条款的
   局部例外，但仍保持 Product Runtime、model policy 与 permissions 的一次原子保存；后台发现不得替用户创建配置。
5. 首次真实 AgentRun 启动唯一 TRAE Host。Core 必须从该进程已经完成的 initialize 与 Session response 生成
   capability snapshot，成功后继续在同一进程发送任务输入；失败只使用该进程已有错误与 stderr 分类，不得为
   replacement、version、Probe 或诊断再启动 TRAE。
6. 相同路径和 fingerprint 的后续静态扫描保留既有 Ready；身份漂移则撤销该信任并回到
   `installed_unverified`，由下一次真实 AgentRun 重新验证。
7. 其他 Runtime 保持现有主动检查策略；是否采用静态或 execution-deferred 验证由 Adapter launch policy 决定，
   不能从 TRAE 特例推导为全局禁止主动 Probe。

本决定局部覆盖 ADR-0066 的版本/Probe 后提交要求、ADR-0083 的统一后台主动检查与用户状态集合，以及
ADR-0127 的 Ready-only 成员保存条款；它不完整替代这些 ADR 的 Installation ownership、显式用户配置、
可操作状态或内部 resolved binding 边界。

<a id="adr-0192-consequences"></a>
### Consequences

- TRAE 设置页检查和后台刷新不再验证登录或能力，也不会为检查目的触发钥匙串 UI。
- 第一次真实任务承担验证延迟；失败可能直到此时才显示需要登录或不兼容。
- Core、Contracts 和 Renderer 需要长期支持“已安装但未验证”这一非 Ready 状态与 nullable version。
- 同一真实进程既是证据来源又是执行进程，避免 Probe 与任务之间的认证/版本竞态。
- launch purpose 成为新增调用链和 Adapter 审查的一部分；绕过中央 policy 属于架构违规。

<a id="adr-0192-rejected-alternatives"></a>
### Rejected Alternatives

- **只跳过 startup 的 `--version`。** 手动 check、refresh、health 与 preflight 仍会启动 TRAE。
- **把用户点击视为主动 Probe 授权。** 用户请求的是读取状态，不等于同意第三方 CLI 写凭据存储。
- **设置未公开的 keyring 环境变量或修改默认钥匙串。** 这依赖未冻结的上游实现并改动用户安全环境。
- **静态发现直接伪造成 Ready。** 文件存在不能证明登录、ACP shape、模型或权限 catalog。
- **任务前先 Probe，再启动正式 Host。** 会重复副作用，并让 Probe 证据与真正执行进程产生竞态。
- **完全不保存未验证 TRAE 配置。** 用户无法从设置进入唯一允许的真实验证路径，形成不可达状态。

<a id="adr-0192-references"></a>
### References

- [v0.87 version scope](README.md)
- [Runtime Launch and Verification v1](../../contracts/runtime-launch-and-verification-v1.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [ADR-0066: Managed Product Runtime Resolution](../v0.20/decisions.md#adr-0066)
- [ADR-0083: Background Runtime Checks](../v0.26/decisions.md#adr-0083)
- [ADR-0127: Atomic Member Runtime Configuration](../v0.43/decisions.md#adr-0127)
<!-- legacy-adr-body:end id=ADR-0192 -->
<!-- legacy-adr:end id=ADR-0192 -->
