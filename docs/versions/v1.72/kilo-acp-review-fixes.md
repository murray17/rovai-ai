---
document_type: implementation-record
version: v1.72
status: implemented-preview
last_updated: 2026-11-09
---

# Kilo ACP 复核修正与 Steer 调查

在原 `rovai/kilo-acp` worktree 修正提交 `1eef483cb` 的语义漏项，不另建执行框架。
User sequence 7 提供源码审查，sequence 8 追加 Steer 可行性问题；每项均对照官方 7.8.27 固定源码与现有 owner。
本轮复核当时规范为 [Launch v79](../../contracts/runtime-launch-and-verification-v79.md)，理由见 [D78](decisions.md#v1-72-d78)。
本记录保留复核时点；后续 [Launch v80](../../contracts/runtime-launch-and-verification-v80.md) 已接通 Core Steer，
真实 sub2api 开发 App 和取消恢复结果见[后续实施记录](kilo-files-steer-verification.md)。
B/P 及其冻结、预算、formatter、证据版本保持已确认 R1；没有新增 SHA256、压缩观察器或进程池。

## 修正范围

| 项目 | 实现与验证归属 |
| --- | --- |
| 原生权限顺序 | Kilo 局部 ordered JSON 树保留嵌套 pattern/Agent 顺序；不改变全 workspace serde_json 行为 |
| 多来源 wildcard / KILO_PERMISSION | 原生 config 回调在最终合并后放置产品默认值，保留所有具体规则及顺序；Core 不求值原生规则 |
| Host 退役 | MCP mutation 的 affected-members invalidation 与同 Binding 不兼容 Host 退役接通 Kilo；共享 Fleet owner 扩展 Kilo |
| MCP cwd | 从 Command Code 提取现有 argv launcher，Kilo 不走 Command Code 专用 placeholder 转义 |
| effort | 当前模型实际广告的 `effort` 进入模型目录与表单，并以原 ID 保存、交付原生 setter |
| DB 路径 | 实际 Host 冻结环境解析 `KILO_DB` 绝对/相对路径，`:memory:` 保持磁盘观察未知 |
| Skills 来源 | 默认 XDG、额外 KILO_CONFIG_DIR、Home `.kilo`/`.kilocode` 同时发现；包含 skill 与 skills |
| 认证 | 非生成 initialize/session-new 不证明凭据有效，Kilo authentication 保持 unknown |
| 元数据/图标 | capability 与实际 managed-system 路由一致；带不透明底色的官方 SVG 用 img 展示 |
| Smoke 隔离/Bootstrap | probe 与 Core smoke 共用 OS 基础变量 allowlist，并使用全新 HOME/XDG；逐普通模型请求核对当时 Host 文件的完整 B |

没有重构已运行的 migration；没有证据表明当前迁移丢数据，模板重复不值得在本次扩大范围。

## 为什么需要最终原生 config 回调

实测官方 CLI：全局文件只有 bash 具体规则，inline 新增 wildcard 后，原生合并结果的 wildcard 排在 bash 之后。
因此只修 JSON 保序，或只把 inline 的 wildcard 放在开头，仍不能保住文件中的 deny。

一个无依赖的短 config 回调复用 Kilo 官方插件入口，在原生所有配置及用户回调完成后只调整两项：
产品默认 wildcard 位于具体规则之前，question 为 deny。它不接收工具请求、不做审批、不观察压缩、不读取 B/P。
其余配置继续由原生 loader、原生 Agent 与原生权限求值器拥有，避免复制 loader 或在 Core 重做规则求值。
回调文件与 Bootstrap 文件共用现有 Host 私有目录及清理 owner。

原生来源见 [config 合并](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/config/config.ts)、
[原生 config 回调](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/plugin/index.ts)及
[权限顺序](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/permission/index.ts)。

## Steer 结论

[原生实测](../../research/kilo-runtime/steer-7.8.27.md)证明，同 Session 的第二个普通 prompt 能在首个模型请求未结束时入库，
并被后续模型实际看到；两个 RPC 各有自己的终态。这支持接续式 Steer 的进一步实施。
当前 Core 仍不开放 Kilo active-input；须先接通同一 Run 的 pending RPC 收口、取消、unknown 不重放与终态竞态，
不能只把 Kilo 加入支持列表。该研究不改变当前普通队列语义。


## 实际结果

官方 Kilo 7.8.27、macOS arm64、生产 Debug Core、全新 HOME/XDG 与本地 Provider：

- **15 个 Run：14 个 succeeded、1 个主动 cancelled。** 全套也在含空格的 HOME/data/Skills/MCP 路径通过，配置回调使用标准 file URL。 首次、warm、Core 重启 exact cold 的 Session 保持；
  14 个成功 Run 按各自的当前 Message ID 关联真实模型请求，完整 B 与当时 Host 文件逐字一致。
- 全局文件、inline、Agent 三组重叠 allow/deny 均真实尝试了对应命令，deny 生效且无文件副作用。
  继承 KILO_PERMISSION wildcard allow 时，成员保存 ask 仍发出原生审批，保存 deny 时 write 不可见；允许/拒绝/取消后继保持。
- 原生 assistant 元数据记录所选 `effort=high`。非生成完整目录探测的 authentication 为 unknown，
  capability 标记为 managed-system；显式 authentication-required 错误仍保持原状态。
- 自定义相对 `KILO_DB=custom.db` 实际产生并被 Core reader 观察；缺省、绝对和 :memory: 解析由同一配置 owner 覆盖。
  采样依旧允许 partial，夹具保持早期生成及后继生成以跨过 baseline/后台 tick，不改变产品采样或终态规则。
- MCP 显式 cwd 与 Node 进程实际 cwd 一致。A → B 的 idle 子进程退出；B → A 的 busy 子进程在正常收口后退出；
  新 A Host ID 与旧 A/B 不同，原 Session ID 保持。所有自有进程事后检查为空，Runtime Files 已清理。
- 继承配置 canary 没有进入任何 fixture 模型请求。隔离 HOME 与 Core Runtime Files Root 一致，
  不依赖运行者的 Kilo 配置或认证。原始 Provider 请求、事件、stderr 和日志保存于 Thread 附件。

[Core 机器证据](../../research/kilo-runtime/core-review-7.8.27-macos-arm64.json)与
[Steer 原生证据](../../research/kilo-runtime/steer-7.8.27-macos-arm64.json)分别记账。
原生探针还复跑了手动 compaction、MCP、warm instructions 和 exact resume。

Rust 配置、模型、Skills、Fleet、cwd、native_usage 原 owner 的定向回归通过；不新增 Rust 测试函数。
`pnpm typecheck`、`TZ=UTC pnpm test`（前端 3190、Node 377 通过）、`pnpm build:desktop`、
文档单测/普通/指定 base 的治理门禁、Node 语法与 diff/format 检查通过；最终 `cargo test --workspace`：484 项通过、1 项既有手动 smoke ignored。

仍为 macOS arm64 Preview。未完成真实付费认证/模型、其他平台、Core 自动/overflow 压缩、Skills 完整实读与删除矩阵，
也未开放 Core Steer；不能把本次已闭合子场景扩大为 First-Class。
