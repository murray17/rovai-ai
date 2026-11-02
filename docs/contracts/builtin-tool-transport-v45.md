---
document_type: protocol-contract
contract: builtin-tool-transport-v45
authority: builtin-tool-transport
status: accepted
version: 45
source_version: v1.72
last_updated: 2026-10-29
---

# Built-in Tool Transport v45

继承 [v44](builtin-tool-transport-v44.md) 的输入、IPC、权限、幂等与完整投递规则。
Transport/CLI 45、capability builtin_cli.transport.v45、Agent Output 15；IPC 3、Envelope 2 保持。

所有消息读取输出的可选 quotes 项只含 kind=message_excerpt、text；不含 source 或 author。
按 [History v17](camp-history-v17.md) 与 [Message Quotes v2](message-quotes-v2.md) 读取已保存文字，
取消被引用来源过滤。CLI/Core 配套发布，沿用现有版本门；不新增命令或参数。
历史冻结输出、Envelope、receipt 和摘要不回填。

## 飞书沟通工具（本仓保留的 8 项，不改变 v44/v45 wire）

本仓在 Windows 分支保有一组当前聊天 Run 范围的飞书工具；它们不新增 Renderer 通用权限，不改 v44 的 Thread read 分页与 v45 的 quotes 输出。

发现与身份：`rovai --help` 列出 `rovai feishu status|search|result|forward|ask|items|report|close`，每项 exact help 来自同一闭集 schema。沿用现有 process token、lease、Run/epoch 认证；CLI 不接受模型传入的 Bot appId、provider、Owner 或任意 open_id。Core 从当前 Run 实际认领的入站消息定位 Bot、会话及请求者，缺失或失效的绑定拒绝执行。既有 Bootstrap 中的 `rovai --help` 指引继续负责发现，Runtime 原生 Shell 审批不因新增工具被自动批准。

操作输入：

| operation | CLI action | 输入 |
| --- | --- | --- |
| feishu.status | status | {} |
| feishu.search | search | {query, inputRef?} |
| feishu.result | result | {requestId} |
| feishu.forward | forward | {targetRef, text, inputRef?} |
| feishu.ask | ask | {targetRef, question, inputRef?} |
| feishu.items | items | {inputRef?} |
| feishu.report | report | {itemId, text, inputRef?} |
| feishu.close | close | {itemId, inputRef?} |

`inputRef` 只能引用本 Run 已认领的外部输入；省略时必须能确定唯一输入，批次歧义返回错误，不能取最新一条猜测请求者。`targetRef` 是 Core 从本 Run 联系人查询结果或该输入的明确提及生成的受限引用，不得把可猜的姓名或裸 open_id 当作授权；`ask` 的 `targetRef=owner` 是唯一特殊值，由 Core 解析当前 Bot 负责人，无负责人身份时明确失败。发送及代问仅用于当前用户明确委托的沟通，不支持批量群发或无关自动转发。

完整结果：所有结果都是闭集对象，空集合保留空数组，不静默截断。

```json
{
  "status": "ready",
  "requestId": null,
  "contacts": [{"targetRef": "opaque-target", "name": "display-name", "department": null}],
  "items": [{"itemId": "opaque-item", "question": "text", "status": "waiting", "requesterName": "display-name", "targetName": "display-name"}],
  "inputs": [{"inputRef": "opaque-input", "authorName": "display-name", "isOwner": false}],
  "errorCode": null
}
```

`status` 为 ready|queued|sent|failed|unknown|closed；联系人候选至多 20 项，事项与输入至多 100 项，超过明确失败。CLI 对 failed 返回退出码 2、unknown 返回 3，其余返回 0；queued 的 0 只证明受理。拒绝给出安全业务码，不把 SDK 原始响应、appSecret、access token 或凭据路径放进错误结果。

幂等与 Host 边界：认证 lease 的内存 replay 不能替代业务持久幂等；相同 Run/epoch/输入/操作及规范化参数复用同一效果，复用请求 ID 更换参数拒绝。结果查询只读，不能触发发送或重建事项。飞书凭据只留在现有渠道 Host，Core 持久化查人请求，Host 在所绑定 Bot 权限内执行并按 worker/lease 结算；工具写操作复用现有出站队列。被询问人的报告只能回到已冻结原会话，只有当前 Bot Owner 可以关闭事项，关闭后的迟到回复不可重开。

执行证据：新增操作接入现有证据投影，输入只保留授权引用和正文长度/摘要，结果只记录状态、请求引用及集合计数，不复制联系人姓名、询问正文、回复正文或 SDK 原始错误。

验证边界：须覆盖 CLI help/输入输出 schema、受认证调用、Host 查询与回执、权限拒绝、歧义、跨范围调用、重复请求、重启及 unknown 不重发；真实飞书账号/联系人和真实模型调用须另行授权。
