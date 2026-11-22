---
document_type: protocol-contract
contract: message-delivery
version: 20
status: accepted
authority: public-message-delivery-route-reconciliation
source_version: v1.72
last_updated: 2026-11-22
---

# Message Delivery v20

继承 [Message Delivery v19](message-delivery-v19.md) 的路由、编辑与投递语义。

公开投递新增可选布尔字段 `canReconcile`。Core 只对用户的插话计算资格。该插话的原 Run 和执行轮有
`delivery_unknown` 输入记录、冻结的适配器为 `codex-cli`、同轮初始输入记录含原生 turn 标识时，字段为 true。
其他情况为 false。旧 Host 缺少该字段时界面按 false 处理。无需数据迁移。

核对允许读取终态 Run 的迟到证据。Host 已释放或原 turn 中仍无接受证据时，命令返回未确认。
核对复用既有命令和原输入，只有获得接受证据才更新回执。收件人详情在有 Run 时提供“查看执行”，有核对资格时同时提供“核对结果”。

插话绑定后按 `dispatchPhase` 展示投递进度。`materialized` 为“待发送”，`attempting` 为“发送中”；
接受回执为“已收到”。退回普通队列后使用“排队中”。展示边界见 [Run Process Detail Surface v60](run-process-detail-surface-v60.md)。
