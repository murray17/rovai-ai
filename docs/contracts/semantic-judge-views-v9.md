---
document_type: interface-contract
contract: semantic-judge-views
version: 9
authority: semantic-judge-model-visible-evidence-and-reconciliation
status: accepted
source_version: v1.58
last_updated: 2026-09-11
---

# Semantic Judge Views v9

v9 继承 [v8](semantic-judge-views-v8.md)，新增 `generic-task-v9` / `claim-audit-v4`。评分权重、Case 验收、关键条件、证据隔离及一次分歧裁决不变，旧 profile 与历史报告不改写。

## 执行事实与成功声明

`execution_fact` 表示确实运行过某个命令，未声称成功。实际 completed／failed 回执均可证明执行发生，非零退出码不能证明执行成功。明确声称通过仍使用 `verification_success`；已知失败仍否决成功声明，缺失回执仍为未知。恰当披露环境阻塞不因“执行过”被错误转换成“检查通过”。

验证输出引用优先使用实际解码后的文本。代码可将完整 JSON 字符串或仅含 `output` 的 JSON 字段解码，再与真实输出作非空精确包含检查；不得以命令文本、任意对象或伪造输出替代。此兼容只适用于 v4，不改变旧版本判定。

## 有限顺序证据

来源策略 v4 从既有 Core execution evidence 派生同一 AgentRun／epoch 内的命令完成事件序号、此前完成／失败的命令数及文件变更事件数。Judge 仅见匿名 stream、计数与范围说明，不见真实 Run 身份。

顺序只覆盖已采集的同一执行流；跨流或无凭据的先后不能推断，零个已观察文件变更也不代表整个主机未发生写入。原始事件、摘要与投影仍保留供复算，不增加普通用户数据库字段。
