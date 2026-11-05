---
document_type: contract
name: Native Interactions
version: v1
status: accepted
source_version: v1.72
last_updated: 2026-11-05
---

# Native Interactions v1

Pi 的原生对话通过同一运行的 RPC 回答，不进入执行审批、普通聊天或新 Run。
首批只接 Pi `confirm / select / input / editor`；其他 Runtime 的问卷策略和运行收尾保持现有合同。
界面由[会话待处理区](../ui/components/conversation-workspace.md)拥有。

## 请求与展示

`threads.open`、`threads.enter`、`threads.snapshot` 和 `singleChat.get` 返回 `nativeInteractions`。
列表来自当前 PiRuntime 内存；数据库投影本身不恢复原生等待。公屏只包含公屏当前可见 Run，私聊只包含对应
conversation 的 Run；已结束或请求停止的 Run 不提供可提交卡片。
私聊数据库变更回包省略该字段，表示它不拥有 Runtime 状态；不能把遗漏当作空列表清理问答草稿。

每项包含 `id`（Core 生成的不透明标识）、`agentRunId`、`executionEpoch`、`questions[]`、`canSkip`、
`createdAt`、`expiresAt` 和 `status`。时间为 Core 的 Unix 毫秒；`expiresAt` 可为 null。Pi 每项只有一题。
问题包含 `id / kind / title / description / options / placeholder / prefill / multiline`；选项包含稳定 `id` 与原始
`label`。Host、Session、原生 ID 和答案编码留在 Core，不由 Renderer 构造原生 JSON。

| Pi 方法 | kind | 用户回答 | 原生响应字段 |
|---|---|---|---|
| confirm | confirm | 是／否 | confirmed: true／false |
| select | select | 点击原生选项标识 | value: 对应原始字符串 |
| input | input，multiline=false | 原始文本 | value |
| editor | input，multiline=true | 原始文本，保留 prefill | value |
| 四类的跳过 | canSkip=true | skip | cancelled: true |

标题、说明、选项和顺序、预填、换行与空白原样保留。空文本不等于跳过；否只表示显式回答 false。
不根据 `Type something.` 等文案增加能力或替插件构造下一题。select 回传原始选项后，只有真实 input
到达才显示文本问题；插件的多选文本也保持原文。`notify / setStatus / setWidget / setTitle / set_editor_text`
沿用原路径，不进入等待列表；不借此覆盖 Composer 草稿。

## 提交与归属

Desktop/Web 提交 `nativeInteractions.respond`，参数为：

```json
{
  "commandId": "original-client-command-id",
  "threadId": "thread-id",
  "agentRunId": "run-id",
  "executionEpoch": 1,
  "interactionId": "opaque-interaction-id",
  "answer": {"kind": "select", "optionId": "option-id"}
}
```

`answer` 是封闭联合：`confirm + confirmed:boolean`、`select + optionId:string`、`input + value:string`
或 `skip`。字段和原生方法必须匹配；选择标识必须属于该题。无任意原生 JSON 入口。
Core 检查 Thread/Run、执行 epoch、停止与终态、Host/Session owner、请求标识和期限，再在原 Runtime
的局部提交锁中完成写入。同一请求只能写入一次；并发或重复提交返回原有处理状态及 alreadyHandled 标记，界面显示“请求已处理”，不发送第二个答案。
成功后只保留本轮去重所需的原生 ID/状态等最小标记，清除问题正文；不新增数据库表、答案聊天消息或回答日志。

登记请求后事件读取继续。用户等待不结束运行，也不阻塞其他 Runtime 消息或停止入口。
Pi 原生回复没有 ACK；写入 JSONL（含换行及 flush）成功即返回 `sent` 或 `skipped`。
这只表示已发送，不表示插件采纳或任务成功。跳过的界面反馈是“已跳过，未提交回答”，不承诺后续继续。

## 期限、失败与恢复

Pi confirm/select/input 的原生 timeout 自原生读流接收时记录一次；editor 没有 timeout。
Core/Renderer 不生成默认期限、不延长或重置期限，不替 Pi 发送超时答案。过期请求移出待处理和数量，
Core 保留 `expired` 标记以拒绝迟到回答。已经开始并取得成功结果的提交不被前端时钟覆盖。

| 返回状态 | 含义 |
|---|---|
| sent / skipped | 原请求已完成原生通道写入；重复查询可返回同一状态 |
| failed | 已确认在写入之前失败，请求仍有效；保留草稿，原按钮可再次操作 |
| unknown | 写入/flush 出错，无法证明 Pi 收到或未收到；保留草稿并禁用再次提交 |
| expired / unavailable | 期限已过、请求不存在或运行不再有效；移除卡片，不重试 |

`commands.reconcile` 对该 operation 只查询当前 Runtime 标记，不写数据库、不回复 Pi。仍 pending 时返回
unknown receipt；已发送、跳过、过期、失效或原生写入未知时返回对应状态。前端连接中断沿用全局恢复与原命令
核对，不增加自动发送、原生 ACK、后台重试或答案重放。Core/Runtime 重启后旧等待失效，不恢复可作答的旧卡片。

停止先禁止新的用户回答，释放仍有效的原生对话等待，再等待 abort；原有 Host 清理负责退出失败边界。
系统清理使用取消回包，但不记录成用户主动跳过。Pi confirm 的取消向扩展返回 false 是原生接口限制，
Rovai 不宣称第三方扩展能够区分取消和否。

Pi 没有答案 ACK，也不为扩展自行触发的 AbortSignal 取消发送独立失效事件。Core 只依据收到的原生期限、
所属 Run/Host 生命周期和自身写入状态清理请求，不按后续文字或无关工具事件猜测题目已失效。
该原生边界不能用“已发送”宣称插件仍在等待或已经采纳答案。
