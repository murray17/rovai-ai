---
document_type: interface-contract
contract: execution-evaluation
version: 4
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.58
last_updated: 2026-09-10
---

# Execution Evaluation v4

v4 继承 [v3](execution-evaluation-v3.md) 的任务质量、协作分项、证据、未知、历史保留与宿主边界，增加显式执行配置及受限 CLI Judge。产品上下文、普通用户数据、评分权重和权限不变。

## 预算与并行

`execution = { version: 1, maxParallelCases: 1|2, judgeSeconds: 240..600 }` 随计划、campaign 和报告冻结；省略时使用串行及 240 秒 Judge。并行单位是一个 Case × repetition，同一单位的基线与候选仍按冻结反序顺序执行。每个 Trial 使用独立 Core、数据库、Skill Library、MCP、工作区和证据目录。一个 worker 失败时等待其他已启动 worker 收口，才释放 campaign 锁。不能并行访问用户原工作区。

并行配置进入环境比较身份；不同并行度的耗时不直接比较。共享机器与模型服务仍可能产生资源竞争，因此并行只减少整套等待，不能声称模型本身变快。

Case 时间预算仍来自 sealed manifest。改变时间预算必须独立版本、重新准入并保留旧 Case；不得在运行中修改 deadline。Suite 2.2.0 将原十二项时间翻倍至 480／600 秒；题目、fixture、reference、verifier、Run/A2A 限额和评分保持。未启动项依旧留在计划分母。总预算须同时考虑合同、任务、Judge 与清理；当前定时宿主的 2700 秒及 Automation 一小时合同保持。

## CLI Judge

API Judge 继续使用原先的禁工具接口与固定 snapshot 要求。没有 API 凭据时可显式准备 `tool_disabled_cli` 适配器，用已登录的 Codex CLI 执行真实语义评价，不读取或复制认证内容。该适配器只准入诊断回归，不能作为 Formal Judge。

准备阶段冻结 CLI 二进制／版本、原模型目录声明、专用模型配置、关闭工具的 flags、可能残留的用户级 AGENTS 指令及本地运输探测摘要。探测向本地 HTTP fixture 发起请求，检查标准 tools 和 additional_tools 都为空，不调用模型；它是能力探测而非质量样本。实际调用使用相同配置、无工具、只读的空工作目录、忽略用户配置／插件／Skill 注入与独立临时会话；证据从 stdin 传入。所有配置漂移、非文本工具输出、超时与不完整结果均不产生有效 Judge 判定。

CLI 原生 `reasoningEffort: medium` 不冒充其未提供的 temperature、topP、seed 或输出 Token 上限。新 [Semantic Judge Configuration 1.1](schemas/semantic-judge-configuration-v1.1.schema.json) 记录实际参数；历史 1.0 配置和 schema 不改写。CLI 使用时间和输出字节上限。原 Process／Outcome 证据隔离、反序双副本、逐项引用校验、分歧为未知及有效输出不重试保持。

`modelVersionPolicy = catalog_bound_alias` 表示固定客户端、模型 ID 和目录声明；`snapshotDigest` 是声明摘要，不是模型权重。实际 CLI 无不可变服务端 snapshot 回执时保留 observedSnapshot=null，报告必须说明。可以展示真实逐项诊断，但固定 snapshot 不可证实的 Gate 增加证据缺口，不能因此放行。不得将同模型双副本称为独立模型共识。
