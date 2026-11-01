---
document_type: contract
name: Runtime Launch and Verification
version: v74
status: accepted
source_version: v1.72
last_updated: 2026-10-31
---

# Runtime Launch and Verification v74

继承 [v73](runtime-launch-and-verification-v73.md)。本版统一全部 Adapter 的模型目录兼容与执行边界，
替代历史合同中依据模型目录拒绝显式配置、要求 Ready 必须有目录默认项、以及自动过滤覆盖值的规则。

## 目录归一化

共享 Adapter 层按原生模型 ID 合并重复条目，保留原生 ID、显示名称、描述、元数据及可用选项。
同一参数合并去重选项；原生 current/default 值可补充枚举。空 ID、无效单条模型、参数或枚举只在该条
处理，不使其余有效目录失败。兼容处理适用于 ACP、Codex、Claude、Pi 和 Antigravity，不为 Copilot
的重复 `auto` 建立特殊分支。内部 Runtime Default sentinel 不作为可选原生模型。
单条模型的非对象元数据局部忽略，保留模型；重复条目的有效元数据仍参与合并，Adapter 补充字段不整体替换
已有有效元数据。

完整响应无法读取、没有可用目录或查询失败时，不推进目录成功时间，不清空已有有效目录、模型或参数。
沿用现有缓存身份与失效规则；同一身份下的健康检查即使没有目录也不覆盖有效目录。读取目录的成功
与原生 Session 可用分别判断，不凭目录缺少默认项或当前模型否定可用 Session。

## 明确配置由原生 Runtime 接受

模型目录只用于发现和选择，不是保存或执行的准入表。显式模型 ID 与已设置参数按原生协议传递；
不以目录缺失、未枚举 ID／参数／值或 setter 未回显目录阻断执行。不从目录补入默认值，也不按目录
删除用户覆盖值。Runtime Default 仍省略显式模型参数，内部 sentinel 不发送给原生 Runtime。

Adapter 保留原生协议必要的数据映射、真实 RPC/进程错误及原生执行结果；原生拒绝的配置不静默改为
其他模型或参数。Codex 将字符串 `reasoning_effort` 原样映射到 `effort`，不按目录枚举限制其值；
本轮不对未知键或异常类型增加启动拦截，无法表达的异常输入留待后续完善。
冻结配置中的 `serviceTier` 是系统费用审计字段，不参与用户模型参数判断，不作为原生发送来源。
Fast 沿用 `camp_fast → serviceTierForTurn`：开启传 `priority`，关闭传 `default`，未设置时省略；
默认模型与显式模型共用此路径，不向原生请求发送持久 `serviceTier`。
不同来源的模型按用户选定来源处理。健康或目录检查不增加模型调用、用户审批或
额外执行流程；单个 Provider／模型的目录补充异常只影响其自身信息。沿用既有错误记录，不新增日志。

## 用户界面

读取失败明确显示“尚未核对”，保留当前模型、参数及有效缓存；不把缺少目录证据显示为“不支持”或
“当前目录未提供”。保存的未枚举参数可更改或清除。同一 Runtime 内切换显式模型时保留显式覆盖值，
切换到 Runtime Default 则按用户选择清除覆盖值。异步目录更新只更新候选项，不改写草稿或已存配置。

## 本机配置的局部故障

`runtime_startup_setting` 按 Runtime 单独读取、解析和校验。无记录沿用自动发现；已有记录不可读取或格式无效时，返回该项的 `configuration.configurationError`，保留原始 JSON 与 revision。该项不产出默认发现候选、不读取默认原生凭据，其余 Runtime 正常加载。错误不进入新的数据库表或恢复队列。

Owner 设置入口仍返回损坏项的版本与明确错误，不能将默认外形的错误投影解释为有效空配置。显式重新选择程序或恢复自动发现时，以 `expectedRevision` 加 `programPath` edit 通过既有 CAS 替换；旧版本拒绝，不对坏 JSON 做字段合并。保存刷新现有 Runtime 状态，用户可在同一 Core 检查及使用修正项。

字段编辑遇到 revision 不符时返回既有 `status: conflict`、`latest` 和字段冲突；页面更新版本基线并保留草稿，用户解决冲突后可以继续保存。不能只返回“再次保存”错误而让页面一直持有旧版本；提交时的 CAS 仍保留。

通用环境变量单条不可解密时，管理入口返回 `commonEnvironment.error` 与原 revision；执行和检查保留该项不可用语义，不回退到其他账号。用户重新填写后沿用既有 revision 校验追加新版本，保留损坏旧记录；未修改的错误投影不得被提交为空值。原本不继承通用变量的独立队员仍按既有规则使用自身环境。

## ACP 冷恢复收尾

本次恢复调用链传递最终成功的原生 RPC 方法。成功 `session/resume` 在必要配置完成后，
通过已有精确 Session route、Host/Run/epoch owner 与 LoadingReplay 状态校验直接进入 Ready，
不等待历史重放 grace 或 quiet window；不能重新 bind Ready 覆盖错误状态。
成功 `session/load`，包括 resume 的 `-32601` 后降级 load，保留既有有界迟到历史隔离与收尾。
返回其他 Session ID、错误 route/owner、协议异常仍拒绝；当前输入 ACK、不重放和同 Host 复用边界保持。
实际方法仅在本次调用内传递，不新增协议字段、数据库字段或恢复状态。

## Grok cwd-only Session 参数

Grok 的 `session/new` 与 `session/resume` 都发送 `additionalDirectories=[]`；实际 `cwd` 保持原工作区。
`1.0.70` 原生端拒绝 new 的非空目录数组，空数组与省略字段均接受；采用空数组与现有 resume 一致。
本规则替代继承合同中要求 Grok new 发送附件根和 Run tmp 的规定，其他 Adapter 的目录参数保持。
新建时完整 Bootstrap 仍仅通过 `_meta.rules` 发送；恢复时不重新注入。原生配置、MCP Plugin、Session
身份及 Run tmp 环境绑定保持原语义；不新增重试、协议错误豁免或文件访问替代机制。附件与临时文件
可访问性须通过实际任务单独验证，不能由空 Session 创建成功推断。
