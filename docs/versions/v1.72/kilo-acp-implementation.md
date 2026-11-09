---
document_type: implementation-record
version: v1.72
status: implemented-preview
last_updated: 2026-11-08
---

# Kilo 官方 ACP 实施与验证

User sequence 4 确认 [R1](model-context-change-kilo-acp.md)后，在 `rovai/kilo-acp` 实施。
worktree 为 `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-kilo-acp`，
编码基线为 `958784f6e17fc32d8b2753d7f14fd6122dceea9d`。
当前按 [D76](decisions.md#v1-72-d76)开放 macOS arm64 Preview；不声明 First-Class，其他平台保持 NotQualified。

本页保留 `1eef483cb` 的初轮实现与验收范围；后续原生语义修正、逐 Run Bootstrap 与 Steer 调查见[复核记录](kilo-acp-review-fixes.md)。

## 实现边界

- 独立 `kilo-cli` identity、`kilo` 发现与 `ROVAI_KILO_BIN`；使用官方 `kilo acp`，原生配置、认证和模型来源独立。
- 共享 ACP/Fleet/Session/Approval owner，一个 Binding 一个 resident Host；不新增进程池、插件或二次审批。
- Host 私有 instructions 文件保存每 Run 的完整 B，普通 ACP user 输入只有 P；更新文件不使原生 Session 失效。
- 权限原名原值 `allow / ask / deny`，默认 allow；保留用户工具及 Agent 规则，原生请求仍交现有审批 UI。
- 原生逐消息数值复用 SQLite reader，沿实际 Host 的冻结环境解析 Kilo data 根；cache/output/cost 按消息去重，
  ACP 最后一步和 Session 累计费用不重复计入 Run。沿用共享后台采样的部分观察语义，短 Run 可保持未知。
- 原生 Skills 来源接入共享扫描；外部 MCP 使用共享 projection 与 invalidation。没有复制项目 Skills 或全局配置。
- Settings、成员 Runtime、模型/权限、引导与监控目录增加 Kilo 和官方图标，沿现有视觉与控件。
- Migration 223 将 schema 172 升到 173，仅扩展 Runtime/Skill 闭集；不重写旧 Binding、Run 或输入。

规范见 [Launch v77](../../contracts/runtime-launch-and-verification-v77.md)，
原生上游与实施前矩阵见[研究记录](../../research/kilo-runtime/README.md)。

## 验证口径

真实官方 Kilo **7.8.27**、macOS arm64、Debug Core 与 bundled CLI，模型服务使用本地 OpenAI-compatible fixture 和假 token。
验收创建独立 Core data、Skill Library、MCP 文件、项目与 XDG 根；未升级本机日常 Kilo、启动或替换日常 App。
本地 Provider 只用来控制原生工具与模型请求，不把结果表述为付费模型、真实认证或 Renderer 点击验收。

[原生探针](../../../scripts/probe-kilo-runtime.mjs)覆盖原生工具输出、MCP、instructions 更新、实际 summary 与 exact resume。
[Core smoke](../../../scripts/smoke-kilo-runtime.mjs)通过生产配置、Thread、Run、审批和 CLI 入口验证；
每次使用系统临时目录下的新 root，显式 `ROVAI_KILO_BIN`，不进入默认测试套件。

```bash
ROVAI_KILO_BIN=/absolute/path/to/official/kilo node scripts/smoke-kilo-runtime.mjs
```

## Golden Flow 与未验证范围

| Flow | 本次证据 | 保留边界 |
| --- | --- | --- |
| First Run | 真实 Core 完整 B 在原生 system，普通 user 只有 P，bash 与公开 CLI send | 真实认证/付费模型未验收 |
| Warm Host | 相同 Host 与精确 native Session | 多成员并发/LRU 仍由共享 owner 覆盖，未完成 Kilo 目标场景 |
| Multi-Session / Concurrency | 策略为单 Binding Host；不启用跨 Binding 多 Session 复用 | Kilo 多 Host 并发未实测 |
| Cold Resume | Core 重启换新 Host，保留同一完整 nativeSessionId，Provider 收到旧历史 | crash/恢复失败矩阵未完整实测 |
| Context / Compaction | 原生手动压缩产生 summary，后继普通请求仍含 instructions | threshold/overflow/retry 未实测；Core 未重复该压缩场景 |
| Skill / MCP Projection | 原生 MCP 调用、同 Host 残留和新 Host 撤销已探测；产品复用共享投影 | Core 分配变更/重名、Skill 实读更新删除未完成真实验收 |
| Safety / Output | 原生 allow-once 写一次、deny 零写入，取消后无延迟文件且后继 Run 成功 | 迟到批准、全部输出大小/退出码未完整实测 |
| Monitoring | 原生消息 baseline/去重/cost 定向 owner；Core 部分采样读取实际逐调用计数 | 完整 Run 费用/全部 step 不作保证；未验证 Renderer |
| Failure / Cleanup | Core 正常 shutdown 与重启、取消工具收敛 | crash/协议错误/timeout/其他平台仍缺真实证据 |

上述未测项保留 NotObserved 或 DocumentationOnly；不以 Unsupported 规避资格门禁。

## 当前实施矩阵

证据状态指列出的具体子能力，不能扩大为整轴 First-Class。尚未实测的子项保持表中边界。

| 能力轴 | Rovai implementation | Runtime evidence 与边界 |
| --- | --- | --- |
| Auth / Provider / Model | Implemented：独立原生来源、默认/显式模型共享 ACP 设置 | Verified：本地 Provider/默认模型；NotObserved：真实认证与付费 Provider |
| Host / Fleet / LRU | Implemented：共享 Fleet，单 Binding Host | Verified：warm、Host 退役/重启；NotObserved：Kilo 多成员/LRU |
| Native Session / Continuation | Implemented：精确 ID 与共享恢复 | Verified：Core 重启原 ID/history；原生缺失 ID 拒绝；故障分支未完整验收 |
| Bootstrap / Context | Implemented：共享 B/P、managed system | Verified：实际模型 system 完整 B、普通 user 只有 P、warm/cold |
| Compaction continuity | Implemented：native_system_prompt_preserved | Verified：原生真实手动 summary 后 instructions；NotObserved：threshold/overflow |
| Skills | Implemented：共享索引与 Kilo 原址发现 | DocumentationOnly：官方来源；NotObserved：真实 Skill 实读/更新删除 |
| External MCP | Implemented：共享 projection 与 Host invalidation | Verified：原生 MCP 调用/撤销边界；NotObserved：Core 分配与同名 |
| Tool / Action / Command Output | Implemented：共享 ACP lifecycle/snapshot | Verified：原生 bash stdout/stderr snapshot、Core bash/write；完整输出矩阵未完成 |
| Narration / Final / Missing-Send | Implemented：共享 chunks/stopReason/send suppression | Verified：Core 无 send 的 final、已接收 CLI send 后无重复 final |
| Permission / Approval / Workspace | Implemented：原生规则与现有审批/fence | Verified：allow、ask/allow-once、deny、取消；迟到批准未实测 |
| Built-in rovai CLI | Implemented：共享 lease 与 bundled CLI | Verified：真实原生 bash 公共 send；完整 operation 集未逐项跑 |
| Usage / Cache / Cost | Implemented：原生逐消息 reader、共享 sampling | Verified：消息 baseline/去重/cost owner、Core 部分 token 计数；完整 Run 终态不补猜 |
| Retry / Queue / Cancel / Cleanup | Implemented：共享 accepted/epoch/process owner | Verified：取消无延迟副作用、后继输入、Core 正常退出；crash/timeout 未完整实测 |
| Ready / Version / Platform | Implemented：独立目录、机器检查与平台准入 | Verified：7.8.27 macOS arm64；其他平台 NotObserved/NotQualified |


## 本机结果

生产 Core smoke 七个 Run 中六个 succeeded、一个按指令 cancelled；完整 B 原字节、普通 P、
同 Host warm、Core 重启 exact cold、允许写入/拒绝零写入、取消无延迟文件、后继 Run 均通过。
原生 question 在首次/warm/cold 和权限替换后均不出现在实际模型工具集合。
Core 正常退出，两次进程所有权收敛，自有 Runtime Files 已清理，事后进程检查没有残留自有 Core/Kilo；
原始 fake Provider 请求和事件保存于 Thread 附件。Core 终态命令输出的 stdout 标记只出现一次，重复原生 snapshot 未重复追加。
[机器可读结果](../../research/kilo-runtime/core-smoke-7.8.27-macos-arm64.json)包含真实 Run/Host/Session identity、
完整 Bootstrap 字节数和部分 Usage 观察，不含用户凭据或日常数据。

共享采样每四秒刷新，smoke 保持工具后模型请求 8.5 秒以跨过采样 tick；
首次 Run 观察到 prompt input total 100、cache read 25、cache write 0、output 20。
它是至少一个原生调用的部分观察，不把 ACP 最后一步或短 Run 的未知值改成整 Run 完整统计。
早先 4.5 秒夹具未稳定捕获采样，延长的是测试服务等待，产品采样频率及终态不等待规则保持。

通过的门禁：`cargo test --workspace`、扩展 catalog migration/原生配置/Adapter/approval/native_usage owners、
`pnpm typecheck`、`TZ=UTC pnpm test`、`pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check`、
指定编码 base 的 `pnpm docs:check:ci`、Node 语法检查及 `git diff --check`。
前端 274 个文件、3190 项通过/2 项既有跳过；Node 377 项通过/2 项平台跳过。
完整 Rust workspace 484 项通过、1 项既有手动 smoke ignored；未安装或重启日常 App。
