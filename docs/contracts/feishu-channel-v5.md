---
document_type: protocol-contract
contract: feishu-channel-v5
authority: feishu-channel-project-binding-admission-delivery
status: accepted
version: 5
last_updated: 2026-08-30
---

# Feishu Channel v5 Contract

本合同继承 [Feishu Channel v4](feishu-channel-v4.md) 的账号、发布、Owner、项目、admission、roster、Outbox、
900ms quiet window、不可变 sealed snapshot、无状态分页授权和 Migration 125。秘密边界仍由
[Channel Storage v2](channel-storage-v2.md) 拥有。本次仅替换终态容器、细化内容预算和 callback 失败响应；
不改变模型上下文、永久正文/附件、下一轮 recall 或钉钉呈现，也不增加数据库 Migration。

## 1. 终态双层原生折叠

执行中保持普通 Card JSON 2.0，不使用折叠容器；封存后保持队员、真实终态和稳定用时，body 结构为：

```text
用时
collapsible_panel：执行过程 · N 条
  TextBlock
  collapsible_panel：安全 command + 真实状态
    markdown：唯一结果框
  TextBlock
  collapsible_panel：安全 command + 真实状态
    markdown：唯一结果框
  页码与上一页/下一页（多页时）
```

外层只有一个原生 `collapsible_panel`，`N` 是完整 sealed timeline 的 command 数，不是当前页数量；没有 command 时
标题为“执行过程”。首次终态投递外层 `expanded=false`。任何合法翻页（包括返回第 1 页）均把外层设为
`expanded=true`，每条 command 仍为 `expanded=false`。正文与 command 保留原始 timeline 顺序，公开正文去重，
不挪到外层之外或复制到每一页。永久 Markdown 消息仍独立投递，不受执行卡折叠影响。

两层展开/收起都由飞书客户端本地完成，不附 callback，不保存折叠状态。仅页码按钮触发
`execution_console_page`；沿用 v4 的 action、agentRunId、snapshotSequence、pageIndex payload。

## 2. 有界内容与分页

每个 TextBlock 不超过 10 行：短文本全部展示，长文本为前 9 行和一行准确的截断提示。
每个 command header 沿用完整安全命令/flags/参数/路径，不重新命名或缩写命令。展开后仍只有一个 Markdown
结果框，无“指令／状态／输出”等二级标题；apply_patch 仅优先展示结构化文件增删行。

结果先完成 v4 的全 Run 敏感值过滤与结构化 envelope/patch 排除，再选择最多 20 行：长结果为前 9 行、
一行截断提示和后 10 行。二进制或明显 base64/data URI 结果显示不可展示提示，不把编码内容发送到飞书。
极长单行仍受 512 UTF-8 bytes 约束；所选结果全文另受 4,096 UTF-8 bytes 限制，必要时在保留所选首尾行的
前提下缩短行内容并标明截断。不得拆坏 Unicode 字符或重新带回已过滤的敏感值。

每页同时受三个预算约束，任何一个先达到就换页：

- 最多 15 个 CommandBlock；
- 最多 50 个 body elements，递归计入外层面板、内层面板、Markdown、页码、按钮及 column/column_set；
- 序列化后整张卡的 UTF-8 JSON 最多 24,000 bytes，包含 header、容器、按钮和 callback payload。

沿用 v4 的 block 不拆分、文字与紧随首条 command 尽量同页、超大不可拆 command 的诚实提示、单页无按钮及
首尾页省略无效方向规则。预算只作用于飞书，钉钉纯文本分页不变。

## 3. 分页应答与在线边界

正式卡继续先经 Core 校验可信 Owner、冻结 App、authoritative external message、terminal_sealed 和 exact sequence，
再读取 sealed source、校验实际页面范围并更新原卡一次。成功 callback 只返回空对象，不发送成功 Toast、
response card 或第二次 patch；不写 Core view state、不生成 nonce、不排 Outbox、不触发 pump。

SDK 必须校验卡片更新的飞书业务码，只有明确 `code=0` 才表示成功；HTTP Promise resolve 不等于业务成功。
分页去重使用飞书 envelope 的 event ID 区分每次点击：下一页、上一页、再下一页是三个独立动作，同一 event
重投才去重。旧无 event ID envelope 保留 SDK 的保守 action-key 去重，不从 payload 伪造新的事件身份。

Main 翻页处理器从进入起保留最多 2.5 秒，为飞书 3 秒 callback 窗口留出传输余量。授权或读取超时后不启动
迟到 patch；已发出的网络请求不能保证撤回，超时只报告结果未确认，不自动重试或补偿更新。错误应答使用
固定安全 Toast，诊断只保留允许的 reason 和数值型飞书业务码，不输出原始 provider message 或 credential。

- 回调连接仍可响应，但 Core 不可用：提示检查本机 Rovai 状态；
- 读取或更新超过窗口：提示翻页响应超时、稍后重试；
- 飞书业务失败或网络请求失败：提示执行记录暂时无法翻页；
- Rovai 已退出、设备断网或 WebSocket 已关闭：本地程序无法发送自定义 Toast，由飞书处理连接/超时错误。

不承诺完全离线时出现某条 Rovai 自定义文案，也不为此引入常驻云端服务。已在客户端加载的两层原生折叠
不需要 Rovai 在线；只有跨页需要在线 callback 和卡片更新 API。

## 4. 预览与兼容

显式本机预览与正式卡使用同一个渲染器、预算、首次关闭/翻页展开选项、更新业务码校验和错误响应。
预览只向该 Bot 已冻结的 Owner 发送，使用现有连接；不另开竞争 WebSocket，不创建虚假的 Core Run 或修改日用
SQLite。预览的有界不可变页只在 Main 内存保存，进程退出或预览过期后，旧测试卡翻页提示重新发起预览。
正式 sealed 卡则继续从持久 snapshot 恢复，不使用预览内存作为事实源。

已发出的旧 sealed 卡不在启动时批量回填。新投递、合法重试和合法翻页使用 v5；App ID、message ID、sequence、
封存内容及下一轮根 CampTurn 的撤回语义保持不变，不更新已经发布的飞书应用资料。

## References

- [飞书渠道架构](../architecture/feishu-channel.md)
- [飞书官方折叠面板](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/containers/collapsible-panel)
- [飞书官方卡片回传交互](https://open.feishu.cn/document/feishu-cards/card-callback-communication)
- [飞书官方卡片回调处理](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/handle-card-callbacks)
- [v1.33 实施计划](../versions/v1.33/implementation-plan.md)
