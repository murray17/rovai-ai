---
document_type: runtime-research
runtime: cline-cli
authority: research-evidence-only
status: experimental-verification-complete
observed_version: 3.0.68
observed_platform: macos-arm64
last_updated: 2026-10-07
---

# Cline ACP 原生压缩启动 shim 实验

> **退役方案的历史证据**：User 95 已要求 Cline 唯一官方 ACP。本文的 Hub/shim 结果不属于当前能力矩阵；
> 复现脚本已从当前树删除，链接固定到退役前提交 `ada6f6c1`。原成功、失败与未验证记录保留。
> 当前实现和本机限制见 [ACP 退役验收](acp-retirement-2026-10-08.md)。


User 消息 `20469780-9f12-408e-bdf7-9b5a2e3aeb8c` 授权试验薄启动 shim。结果：在固定的
Cline CLI 3.0.68 / 官方 Core 0.0.90 / sub2api `gpt-6-sol` 场景，仅补启动
`config.compaction` 就能触发原生自动压缩；隔离 Rovai Core 的 Session、Binding、System Rule、
工具和冷恢复验证通过。该结果不构成生产切换或 First-Class 准入，生产仍调用官方 `cline --acp`。

完整数值、原生事件、Run 归属和摘要见[脱敏证据](acp-compaction-shim-2026-10-07.evidence.json)。
本轮未修改生产代码、最低版本、用户安装的 Cline、旧验收 Session 或日常 App，也未发布上游 PR。

User 74 后续要求只使用用户实际安装的 Runtime；[实际入口核验](installed-acp-entrypoint-2026-10-07.md)
未找到本机编译分发的安全注入入口。以下源码/SDK 实验不作为该安装的兼容接入通过证据。

## 固定来源与注入位置

固定官方 commit `241c1884a7461ef35f6c384a027a38e8d03b3b33`，CLI 3.0.68，npm 发布的
`@cline/{core,shared,agents,llms,sdk}` 均为 0.0.90，Bun 1.4.2。官方源码包 SHA-256：
`679dfc4085e0085061ba0ca4aa83716f0b6d29146856c3cb519672f3f248c256`；447 个 CLI 源文件逐一
与该包相同。完整依赖锁随 fixture 保留，发布二进制和 SDK 入口摘要在证据中。

[实验入口](https://github.com/murray17/rovai-ai/blob/ada6f6c16630872f21610a66cd842cd684545465/docs/research/cline-runtime/fixtures/compaction_acp_shim.mjs)加载未修改的官方 ACP 源码，在进程内拦截公开
`ClineCore.start` 方法，将官方 `AcpAgent.buildConfig()` 的原对象加上一个 `compaction` 字段。
这是固定版本实验用的原型方法拦截，不是 Cline 提供的稳定 ACP 扩展接口。保护检查要求 ACP client、
固定版本/源码摘要、原配置尚无 compaction，并断言其他配置字段保持同一值。独立启动日志只记录
配置选择，不伪装原生压缩事件。可执行文件 `--version` 明确标为实验 shim；ACP initialize
仍由未修改的上游实现返回 3.0.68。

配置直接复用官方
[启动设置解析](https://github.com/cline/cline/blob/241c1884a7461ef35f6c384a027a38e8d03b3b33/apps/cli/src/utils/startup-settings.ts)
和[CLI 压缩配置构造](https://github.com/cline/cline/blob/241c1884a7461ef35f6c384a027a38e8d03b3b33/apps/cli/src/utils/compaction-mode.ts)，
读取隔离 Home 的原生 global settings。四组各完成一次真实模型请求，实际传入值为：

| 原生设置 | 传给 Core 的配置 |
| --- | --- |
| 未设置 | `{ enabled: true }`；Core 默认策略为 agentic |
| basic | `{ enabled: true, strategy: "basic" }` |
| agentic | `{ enabled: true, strategy: "agentic" }` |
| 明确关闭 | `{ enabled: false }` |

未自行实现压缩、添加 message builder、修改模型窗口或实现重试。原生
[compaction pipeline](https://github.com/cline/cline/blob/241c1884a7461ef35f6c384a027a38e8d03b3b33/sdk/packages/core/src/extensions/context/compaction.ts)
拥有策略、状态和生命周期。四种设置的矩阵证明启动映射，不代表四种策略都做过长上下文测试。

引用方案中的生命周期图需要修正：官方 local runtime bootstrap 会先加载 Plugin，随后建立
compaction pipeline。关键限制是现有 Plugin 公共配置面不提供修改该 CoreSessionConfig 的接口，
不能仅用“Plugin 加载得晚”解释。该实验在 Core.start 边界注入，不依赖这一错误顺序假设。

## 同版本三组对照

每组新建隔离 Home/原生 Session，使用同一 Provider/model、相同 models.json（272,000 窗口）、
同一工作目录与 19 条相同输入。14 批长输入的 SHA-256 逐条相同。Core 保持其原生缓存与策略；
生成内容和 Provider cache usage 自然存在差异。

| 组别 | 第 10 批 input | 第 11 批 input | 第 14 批 input | 自动压缩 / sidecar |
| --- | ---: | ---: | ---: | --- |
| 官方发布二进制 `cline 3.0.68 --acp` | 212,696 | 233,813 | 296,758 | 0 / 无 |
| 官方 ACP 源码 + 官方 Core，不注入 | 212,703 | 233,820 | 296,765 | 0 / 无 |
| 相同源码、Core，仅注入原生设置 | 212,705 | 44,833 | 107,778 | 1 / 有 |

三组全部 19 轮正常完成。加入源码对照，是为了隔离发布二进制与源码启动/依赖解析的差异，
不能把这两种分发形式称为字节相同。两个源码组使用同一个已安装 Core 模块和依赖树。

shim 的第 11 批由生产只读 observer 收到 `auto_compaction started/completed`：原生估算
tokens `122,730 → 26,411`、messages `29 → 4`。这些是 Cline 原生估算，与表中的 Provider
`inputTokens` 口径不同，不能混加。`.compaction.json` 保存工作上下文投影，原始
`.messages.json` 保持追加；三组逐轮原消息 ID 前缀均与最终历史一致。

三组的 System/早期记忆、原生 Skill 文件读取、MCP 调用在压缩前后及 cold 均成功。
MCP receipt 由测试服务器在实际 `tools/call` 时随机生成，每阶段恰好一次，模型准确返回。
shim 压缩后的一次写文件请求收到 ACP `reject_once`，没有创建文件；cold 的允许请求继续生效。
每组正常退出后以新 PID `session/load` 同一完整原生 Session ID，再次完成能力检查。

## 隔离 Rovai 产品验证

使用此前验收包中未修改的 `rovai-core`，通过正常 Core 命令设置实验启动程序、成员和 Camp。
数据目录、原生 Home、Skill Library、MCP、workspace 与 Runtime Files Root 全部隔离。
没有手写 Binding 或修改数据库；SQLite 仅以只读模式采集证据。

最终验证共 11 个真实 AgentRun、32 次 root model 请求，全部 succeeded，每 Run 恰好一次
bundled CLI 公开发送，按 `sourceAgentRunId` 核验归属。以下值跨压缩与 Core 重启保持：

- Session：`1791350665146_i8tC-_cli`
- Binding：`5e8a2c85-34de-45a0-8825-8d1b226822bf`，generation `1`
- 模型：`gpt-6-sol`
- System SHA-256：`40ae33328c404dfb40a2b47f02bac69e966916bd06448b8b02d4c743d2a684de`

第 5 批同一 Run 中，实际模型 input `116,527 → 47,550`；两次 `beforeModel` 的工作消息
数 `35 → 8`。原生完成事件统计的是加入中间工具消息后的 `37 → 8`，估算 tokens
`68,435 → 29,274`。同一个 native Run ID 可关联到只读 trace、生产 observer 投影与持久记录。

Core 收到 3 次 display 通知，其中 started 为同一 evidence ID 的重复通知；数据库正确保存
2 条唯一生命周期记录，表示 1 次压缩，不能将通知数量当压缩次数。完成证据为
`native_terminal`、native method 为 `cline.plugin.compaction.v1`，与独立只读观察的数值一致。

32 次请求的身份标记均为 System 中一次、user 中零，System 摘要和全部 8 个工具名完全一致。
压缩后及 cold 的身份、早期记忆、Skill 文件内容和服务器 receipt 全部正确。cold 首次请求使用
28 条工作消息、92,909 input tokens；没有重新压缩，沿用已有 sidecar 投影。最终完整历史为
66 条，sidecar 为 8 条。两个 Core 进程均正常退出。

另保留先前 16 Run 的产品复测：全部成功，原生压缩 3 次、数据库 6 条唯一事件，同一 Binding
跨重启保持。它的临时 beforeModel 文件随 Host 清理，因此只用于补充持久事件/Session 证据，
System 请求级断言以最终 11 Run 的持久 trace 为准。

所有实验进程已退出，14 份临时 Provider 凭据副本已删除；原始 Cline 设置未修改。
原生历史与脱敏结果保留，重新运行须从原始设置重新准备独立 Home。

## 实验中修正的脚手架问题

- 初次 `createRequire.resolve` 不支持 Core 的 ESM-only 导出，初始化前退出，无模型请求；改用 Bun 的 import 解析。
- 初版 trace 文件以 `.mjs` 部署，被 Cline 只接受 `.js/.ts` 的 Plugin 发现忽略。生产 observer 仍正常工作；最终产品轮改用 `.js` 并将只读 trace 保存在 Host 清理范围外。
- 初次产品探针误以为 admission 同步返回 Run ID；该实例停在 queued，未生成。后续等待正常调度分配 Run。
- 另一探针用可能为 null 的 threadTurnId 汇总消息，误报两次发送；改为 sourceAgentRunId，原始数据库中两轮各一次发送。

上述中间结果保留在证据说明与隔离目录，未将脚手架失败记为产品失败或补写成通过。

## 复现与边界

[准备脚本](https://github.com/murray17/rovai-ai/blob/ada6f6c16630872f21610a66cd842cd684545465/docs/research/cline-runtime/fixtures/compaction_setup.py)只下载固定官方源代码及发布包，使用
[保留的依赖锁](https://github.com/murray17/rovai-ai/blob/ada6f6c16630872f21610a66cd842cd684545465/docs/research/cline-runtime/fixtures/compaction-dependencies/bun.lock)，不读取凭据、不发模型请求。
已在第二个全新目录重新安装，并完成一次真实 pilot。无需修改全局 Cline。

```sh
python3 docs/research/cline-runtime/fixtures/compaction_setup.py --root /absolute/new-experiment
python3 docs/research/cline-runtime/fixtures/compaction_acp_probe.py \
  --root /absolute/new-experiment --settings-source /absolute/private-cline/settings \
  --variant shim --rounds 14
```

同样以 `--variant stock`、`--variant source-control` 执行两组对照；目录已存在时拒绝覆盖。
设置映射使用 `--variant pilot --pilot --preference default|basic|off|agentic`，并分别指定唯一
`--case-name`。这些探针会向指定 Cline 原生 Provider 发真实请求。

[产品探针](https://github.com/murray17/rovai-ai/blob/ada6f6c16630872f21610a66cd842cd684545465/docs/research/cline-runtime/fixtures/compaction_product_probe.mjs)接受 `--root`、`--core`、`--settings-source`、
`--case-name`；它以单成员隔离 Camp 发真实请求，观察到原生压缩后再追加两批并完成 cold 验证。
[证据检查器](https://github.com/murray17/rovai-ai/blob/ada6f6c16630872f21610a66cd842cd684545465/docs/research/cline-runtime/fixtures/compaction_evidence.py)核验本轮保留的 case 矩阵并输出允许公开的字段，
不导出认证、Provider endpoint、完整 System 或原始模型历史。

本轮只验证自动阈值路径，未重做 overflow recovery + automatic retry、手动压缩、取消压缩、
多 Session 并发或其他平台。此前 `918,618` input / overflow 的负例属于 **3.0.65**，不能写成
本轮 3.0.68 的 A 组。原生 Skill 文件消费已验证，不外推全部自动发现/启停组合。

实验说明“启动配置遗漏”是该场景的阻断点。薄的是注入逻辑；部署仍须管理固定 CLI 源码、官方 SDK、
Bun、依赖锁和版本保护，并不等于已经具备一个稳定生产 adapter。优先推动上游补齐原生 ACP 配置；
若要采用 Rovai shim，须另行完成产品身份、打包升级和剩余故障矩阵的设计与准入。
