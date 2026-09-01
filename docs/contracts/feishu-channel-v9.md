---
document_type: protocol-contract
contract: feishu-channel-v9
authority: feishu-channel-execution-card-and-lan-readonly-view
status: accepted
version: 9
last_updated: 2026-09-01
---

# Feishu Channel v9 Contract

继承 [Feishu Channel v8](feishu-channel-v8.md) 的身份、项目/Quick Chat 绑定、入站、永久正文、附件和
Outbox 合同。本版只替换飞书 AgentRun 执行卡及新增的本机局域网只读执行台；钉钉格式与行为不变。

## 1. 执行卡是纯状态入口

每个飞书 AgentRun 仍只有一张临时 Card 2.0。执行中卡只显示
`<队员名> · 执行中`，终态只显示 `已完成 / 执行失败 / 已停止`；收起状态不显示当前正文、command、
进度、成功/失败数量或完整过程。三个入口的行为固定为：

| 入口 | Card 2.0 行为 | 权限 |
| --- | --- | --- |
| 显示最近输出／收起最近输出 | `callback` | Core 校验 callback 操作者是该 App 的 Owner |
| 打开执行台 | `open_url` 直接打开创建卡片时冻结的 URL | 不识别点击人，不做 Owner 校验 |
| 停止执行 | `callback` | Core 校验 Owner，并只取消 payload 中的 exact AgentRun |

终态不显示“停止执行”。服务在卡片首次创建时不可用，则该卡永远没有“打开执行台”；后续服务恢复不补按钮。
执行中到终态、按钮可用性变化，或“最近输出”已展开且公开窗口变化时才更新卡片。所有执行事件、callback、
终态更新和 recall 进入同一个 per-card 串行队列，旧 snapshot 不能覆盖新状态。

Main 为已发送卡保存进程内 `ExecutionCardPresentationState`：至少包含 AgentRun、外部消息、冻结 App、
`executionViewUrl | null` 与 `recentOutputVisible`。URL 只在首次 `send` 前生成；已有外部消息的
`update`、callback 后重绘或 Main 重启恢复不得重新签发。下一轮 root ChannelTurn 开始时沿用既有规则 recall
旧执行卡，并撤销 Main 中仍存在的对应只读 Token。

## 2. 固定 `open_url`

“打开执行台”必须直接使用 Card 2.0 `open_url`，不得改成 callback、中间跳转页或私聊投递。禁止引入
`execution_open`、点击时 `operatorOpenId` 校验、点击时签发 Grant、“链接已发送到私聊”、私聊幂等或重放链路。

卡片首次创建时，Main 仅在全局 `ExecutionViewService` 已 ready 时读取当时自动发现的私有局域网 IPv4 与用户配置
端口，创建一次 Token 并拼成：

```text
http://<private-ip>:<port>/execution/<focusRunId>#t=<token>
```

该 URL 是卡片不可变展示数据，运行中转终态继续原样复用。Main 不监听 IP 变化，不维护 address generation，
不扫描或批量修改旧卡，也不因端口、网卡或网络环境变化补发/修复链接。旧卡可能失效；只有之后新建的执行卡使用
新地址。Main 重启后不恢复旧卡的 presentation state 或 Token，也不修复旧链接。

## 3. 全局服务与端口设置

Rovai Desktop 最多启动一个 `ExecutionViewService`，所有 Camp、队员和 AgentRun 共用同一端口。配置是 Main 私有的
精确 schema：

```json
{ "schemaVersion": 1, "enabled": false, "port": 8765 }
```

默认关闭，默认端口 `8765`；用户只可显式设置 `1024..65535` 的整数。服务自动选择确定性的 RFC1918 IPv4，
不提供网卡选择、远端探测或设备矩阵。不能找到私有地址或端口被占用时服务不可用，新执行卡不显示打开入口；
不得漂移到 `8766` 或其他端口。修改已启用端口时先停止旧 listener，再按新配置尝试绑定；失败保持用户选择的端口和
不可用状态，不继续用旧端口发布新链接。

设置位于渠道页最底部的“局域网执行台”区域，默认折叠。页面必须显示真实服务状态和当前地址，并固定提示：

> 修改端口后，此前发送的执行台链接可能失效。

一期是用户主动开启、供 Owner 在受控局域网使用的 HTTP 只读能力；不承诺防御局域网主动中间人攻击，不是公网分享、
跨组织安全文件分享或通用远程访问方案。缺少 HTTPS 不阻塞本期能力。

## 4. 内存 Token 与不可扩张范围

Main 在创建卡片 URL 时生成至少 32 bytes 的高熵随机 Token，只保存其 SHA-256 hash 与冻结 scope：

```text
channelConversationId
targetAppId
campId
agentId
focusRunId
maxRunCreatedAt
```

渠道会话与 App 只证明 Token 来自哪张权威飞书卡；可见历史按同一 Camp、同一队员及时间上界选择，包含
`focusRunId`，不得包含之后的新 Run、其他 Camp 或其他队员。Main 每次读取都把完整冻结 scope 交给 Core，浏览器不能
提交、替换或扩大 scope。Core 重新校验 focus Run 的归属、时间、渠道/App、当前 Camp 与成员关系，再据此读取同
Camp/队员历史；Camp 删除、成员移除或数据清理后返回不可用，Main 随即撤销 Token。

Token 与明文只存在 Main 内存。关闭服务、recall 对应卡、Rovai 退出或重启均使其失效；不新增 Grant 数据库表、撤销表、
Owner binding revision、一次性消费状态机或持久 Capability 子系统。直接 `open_url` 的权限语义是：能够看到或获得链接、
能够访问 Rovai 所在局域网且 Token 仍有效的人，可以查看该只读投影；不得描述为“仅 Owner 可以打开”。

## 5. HTTP、实时流与公开投影

页面从 URL fragment 读取 Token 后立即移除 fragment，只把 Token 留在当前页面内存。页面加载顺序固定为：

1. `GET /api/execution/<focusRunId>/snapshot` 取得当前快照；
2. 使用 Fetch Streaming 连接 `/api/execution/<focusRunId>/events`；
3. Core `agent_run.*` event 经 Main 重新读取同 scope 投影，并以 SSE `snapshot / terminal / invalidated` 刷新页面；
4. `terminal` 后应用最终快照并停止实时跟随。

API 使用 `Authorization: Bearer <token>`，不使用 WebSocket。服务只接受绑定地址与端口的精确 Host，响应使用
`no-store`、`no-referrer`、禁止 frame、最小 Permissions Policy 与自包含 CSP。HTTP/SSE 失败只影响 Web 页面，
不得影响 AgentRun、最近输出 callback 或飞书终态消息。

Core 可返回 Run 状态、触发消息摘要、Agent 公开正文、安全 command、共享安全 public command result 与公开文件变化
投影。Main 继续复用共享 redactor/projector，禁止返回终端输入、写文件入口、继续对话、停止/审批操作、任意文件读取、
隐藏推理、完整工具输入、原始 patch、敏感环境变量、Cookie、Token 或未脱敏 detail。

Web 执行台遵循当前 Rovai 双主题，并同时适配桌面与手机。触发消息位于顶部，同一 Camp/队员的授权历史 Run 按时间连续
展示；所有 Run 正文和活动默认展开，不提供折叠、分页或写操作。选择某个 Run 只切换顶部触发消息摘要，不折叠执行内容。

## 6. 两个 Owner callback

“显示最近输出”callback 携带稳定 `agentRunId + visible`，不携带客户端 sequence。Core 以 callback 的冻结 App、
authoritative external message 与该 App 的 `operator_id/open_id` 校验 Owner，返回当前 snapshot sequence；Main 再读取
exact source 并原位更新卡片。展开窗口按真实顺序混排最多最后 30 个公开正文与安全 command，不显示 command result、
逐条成功/失败标记或分页。`recentOutputVisible` 只按 `externalMessageId` 存于 Main 内存；Main 重启默认收起，recall 删除。

“停止执行”callback 携带 exact `agentRunId`。Core 必须重新校验 Provider、ChannelConversation、冻结 App、外部消息、
Owner、Run 归属和当前可取消状态，并通过 `channels.executionConsole.agentRun.cancel` 只结算这一条 AgentRun。重复点击或已经
终态返回同一个幂等结果；Main 不直接调用 Runtime 或扩大为 CampTurn 取消。

## 7. 持久兼容

本版不新增 SQLite Migration。既有 `terminal_snapshot_json`、历史 delivery、已发送执行卡和 v8 永久正文/附件保持原样；
v9 不再为飞书执行卡提供旧终态分页 callback。已发送旧卡不批量回填或替换，钉钉继续使用原有纯文本执行投影。

## References

- [飞书渠道架构](../architecture/feishu-channel.md)
- [渠道 UI](../ui/components/channel-settings.md)
- [v1.37 实施计划](../versions/v1.37/implementation-plan.md)
- [V1.37-D04](../versions/v1.37/decisions.md#v1-37-d04)
