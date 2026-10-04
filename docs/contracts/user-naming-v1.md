---
document_type: protocol-contract
contract: user-naming-v1
authority: human-user-naming-and-frozen-projection
status: accepted
version: 1
last_updated: 2026-10-02
---

# User Naming v1

User 表示拥有 Thread 目标的人类用户。Agent 指令、CLI 帮助与新结构化用户投影统一使用 User。
本合同替代早期合同中 Principal 的主称呼和 `agent_v1` 作为唯一可读投影的限制；其他能力、身份与权限不变。

## 输入与投影

`--to-user` 是主 flag，`--to-principal` 是兼容别名；两者映射到同一个 `mentionUser`，同时传入时报重复参数。
`@User` 和 `@Principal` 大小写精确，均按现有行首／有效 mention cluster 语法指向 `CurrentUserMention(local_user)`。
两个人类保留名优先于同名队员；成员仍可用 `@agent_N` 或 `--to` 寻址。代码、转义、URL、未知名称中断、普通行中正文的排除规则不变。
重复 authored occurrences 保留位置，flag 不重复插入已有用户前缀；每条消息只创建一次原子通知。
PublicOnly 仍不创建 Agent Delivery，但保留人类注意力。User Composer、引用和 Runtime 自动输出不增加正文解析。

新 Agent read/search 和新准备上下文使用 `agent_v2`，将结构化用户提及显示为 `@User`；普通 Text 中的
`@Principal` 原样保留。搜索只在结构化用户提及的位置接受两种别名，支持混合查询；正文、排名位置与 snippet
均以返回的 `@User` 投影计算。查询和正文不作全局替换。Desktop/Web 昵称和渠道原生 Owner mention 不变。

## Session 与证据

新生成的 Charter revision 为 18；Native Binding compatibility 仍为 16，Bootstrap contract／formatter 仍为 v5／5。
所有公开执行共用一份当前 Bootstrap 生成模板，包括既有准入允许且尚未生成 Bootstrap 的旧 direct/a2a 执行。
Single Chat 使用专用模板。既有绑定总是优先读取冻结 Charter、平台 Skill section 与 Memory Entrypoint；
resume／压缩补发不改写这些字节，不改变 Session ID 或 generation。原有成员身份刷新继续有效。

已冻结 `agent_v1` 输入、Manifest、Delivery 和成功工具回执仍按原版本验证摘要并复用。
A2A Guidance 新证据为 3，历史 1／2 的原句与摘要继续有效；未知版本、缺失证据、摘要不符和 audience 混标拒绝。
普通 Formatter／Manifest 28、公开 32、Profile 7／10 与 Run Facts 6／9 均保持。
原 main 的 Migration 179 将 schema 128 升至 129。与已安装指标分支整合后，保留其既有 178/179/180 收据，当前 Migration 181 将 schema 130 升至 131，只把 context_manifest 的 audience CHECK 扩展为 `agent_v1 | agent_v2`；
复制时校验冻结证据不变，失败原子回滚，不改写原行或 Blob。

## Skill 更新

Core 启动与新 Run 准备继续通过既有 ManagedSkills 同步安装包拥有的文件，原路径与 Skill 名称、description、配置不变。
新版程序带来的正文和 references 可直接读取；已经进入 Session 历史的旧文字不会被替换。
不新增远程版本服务、上下文刷新消息或原生 Harness 热重载承诺。

完整文本见[已确认 r2](../versions/v1.72/model-context-change-principal-user.md)和[前后对照](../versions/v1.72/principal-user-context-comparison.md)。
