---
document_type: acceptance-record
version: v0.95
authority: version-acceptance-evidence
status: complete
last_updated: 2026-08-16
---

# v0.95 协作 Skill 场景 Dry Run

本记录用角色、可信输入和消息拓扑审阅精简后的协作协议，不通过搜索固定句子判定 Agent 行为。它不替代
Core 的 Message Delivery、Gather、accepted 和 reply-relation 测试，也不声称运行了真实模型 Smoke。

## Review Duo

| 场景 | 可信事实 | 预期推进 | 结果 |
| --- | --- | --- | --- |
| 正常四消息 | 用户直接触发发起者；固定搭档在场；四条消息携带同一 immutable range | request → public Spec → direct Standards return → public final report | 通过 |
| 范围不一致 | 当前搭档直接回复，但结果 range 与请求不同 | 结果不进入最终报告，不推进 | 通过 |
| 意外收件人 | public 结果有 Agent recipient，或定向结果包含非预期 recipient | 当前消息无效，不推进 | 通过 |
| 更换搭档 | 原搭档明确不可用或 Delivery 失败后向新搭档发送同一范围 | 只接受新搭档对新请求的直接回复；旧结果只作补充 | 通过 |
| 完成后迟到 | 同一范围已经发布最终报告 | 迟到或重复结果只作补充，不再发布报告 | 通过 |

发起者请求 accepted 后仍在同一响应中独立完成 Spec；搭档在未看到发起者结论时独立完成自己的轴。结果长度、
finding 格式和 partial 降级由 `references/findings.md` 唯一拥有。

## Grill Duo

| 场景 | 可信事实 | 预期推进 | 结果 |
| --- | --- | --- | --- |
| 正常一轮 | 1–4 个前提已确认且相互独立的问题；固定搭档直接回复 | 一条复核请求 → 一条逐题建议 → 一条用户问题 | 通过 |
| 部分回答 | 用户只回答 `Q1`，`Q2`–`Q3` 未回答 | 关闭 `Q1`；保留其它编号、问题和已有建议；本轮保持开放 | 通过 |
| 单题变化 | 用户改变 `Q2` 的选项或约束 | 只重新复核 `Q2`；其它题和建议不变 | 通过 |
| 旧轮建议 | 回复来自旧邀请、失效邀请或非当前搭档 | 只作补充，不能推进、回退或重开 | 通过 |
| 开放轮次新增问题 | 当前轮仍有未关闭问题 | 新问题等待当前轮关闭后进入下一轮 | 通过 |
| 文档版部分回答 | 用户只确认部分术语或决定 | 只维护确认部分；搭档不修改文档 | 通过 |

普通版与文档版都只使用三种普通 Send，不使用 Gather。每次发送必须 accepted 后结束当前响应；发送异常
进入 CLI recovery，不由 Skill 自行构造重试。

## Campfire

| 场景 | 可信事实 | 预期推进 | 结果 |
| --- | --- | --- | --- |
| 用户请求主持人 | 用户直接触发当前 Default Lead；至少两位可参与成员 | 一次第一轮 Gather，接受后结束 Lead Run | 通过 |
| 用户广播 | 当前 Agent 不是 Default Lead，且用户同时触达 Lead 或多人 | 普通成员不发表观点、不调用 A2A | 通过 |
| 用户只触达普通成员 | 用户要求多人讨论，但触发者不是 Default Lead | 不启动、不代发请求；告知需由 Default Lead 直接发起 | 通过 |
| 第一轮无关键分歧 | Completion 有至少两份有效观点 | 直接发布唯一纪要，不创建回应 Gather | 通过 |
| 第一轮有关键分歧 | Completion 有一个会改变结论的分歧，原发起者仍是 Default Lead | 一次邀请 1–2 人的定向回应 Gather；完成后发布纪要 | 通过 |
| 主持权变化 | 第一轮完成时原发起者已不是 Default Lead | 原发起者直接综合并发布纪要，不再创建 Gather，也不改由新 Lead 处理 | 通过 |
| 截断或缺失 | Completion 标记截断、失败、取消或无完整结论 | 缺失内容保持未知；不足两份时发布部分纪要或终止 | 通过 |
| 用户停止或立即总结 | 用户在讨论中给出更新指令 | 停止旧讨论，或只使用已形成观点发布部分纪要 | 通过 |
| 纪要后迟到 | 唯一纪要已经 accepted | 迟到观点不重开、不更新纪要 | 通过 |

成员只处理触发当前 AgentRun 的正式请求，并向可信请求发送者返回一条完整结果。Gather 的 capture、
current generation、Barrier、Completion FIFO 和 mandatory Current Input 继续由 Core/Contract 测试拥有。

## 结论

- 精简没有改变 Review Duo 四消息、Grill Duo 开放轮次或 Campfire 最多两轮 Gather。
- 删除 Campfire 的普通成员代发入口后，只有用户直接请求当前 Default Lead 能启动新讨论。
- 迟到、错误 sender、范围不一致、意外 recipient、部分回答、单题失效和主持权变化均有明确不推进路径。
- 本次没有运行真实 Runtime/model Smoke；上线前如需验证模型遵循率，使用隔离 Camp 执行这些相同场景。
