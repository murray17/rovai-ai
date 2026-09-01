---
document_type: version-decisions
version: v1.37
lifecycle: current
last_updated: 2026-09-01
---

# v1.37 决定

<a id="v1-37-d01"></a>
## V1.37-D01：Runtime 图片采用结构化来源与混合生命周期，不升级为文件发布

### 背景

稳定 Runtime 图片路径可直接使用，但本机 Run 临时目录必然清理；有些 Runtime 同时返回 bytes 与 path。
把所有图片转成消息附件会混淆中间结果和显式交付，并把本机可视化带到飞书；把所有路径复制或新增目录授权
又会显著扩大实现和交互。用户明确要求可用性优先、最小验证及不限制目录/符号链接。

### 决定

只接收已适配的结构化结果。稳定路径引用原文件，inline bytes 始终保存，仅 Run 临时路径为生命周期保存到
现有 Blob。普通文件检查与真实解码构成最小读取链；失败局部降级。图片拥有独立 Run 元数据，不自动产生
CampMessage/Attachment/渠道投递。当前规范由 [Runtime 图片架构](../../architecture/runtime-images.md)与
[Runtime Images v3](../../contracts/runtime-images-v3.md) 拥有。

### 后果与替代方案

- 保留零拷贝意味着稳定文件修改/删除会改变或失去预览，这是接受的取舍，不承诺历史 bytes 不变。
- 拒绝路径一律优先：会丢失已有 inline bytes，且临时文件清理后不可恢复。
- 拒绝全部复制：稳定文件无需额外副本；拒绝全不保存：Run 临时结果会必然丢失。
- 拒绝自动 Attachment/文件预览授权框架：图片观察不是交付，扩大领域状态与交互不解决本次问题。

<a id="v1-37-d02"></a>
## V1.37-D02：取消以业务事务为终态边界，Runtime 清理独立且有界

### 背景

实际半取消由 Input 回调推进 Run version 后，旧 cancellation ACK 被 version fence 拒绝引起。重试又以相同
command ID 携带新版本 payload，永久触发幂等冲突。单纯放宽版本或更换重试 ID 仍让会话可用性依赖失联 Runtime。

### 决定

取消事务直接结算业务 Run、义务和受影响 Turn；Runtime 使用既有 active/launch permit 和受管进程后台清理。
新增最小发送 timestamp 区分尚未发送与可能接受，未知结果保留为终态失败并禁止重发。成员离队完全保留既有
定向 cutover 集合，单 Run/离队不关闭整轮渠道；整轮取消抑制重试并允许下一渠道请求推进。

当前权威为 [Cancellation Settlement v1](../../contracts/cancellation-settlement-v1.md)及其专属合同；
模型上下文边界已按[revision 1](model-context-change-cancellation.md)确认。

### 后果与替代方案

- 外部效果未知仍须核对；业务终态不证明进程退出或回滚。同 Conversation 清理无法确认时，新 Run 有界失败，
  牺牲该次自动启动以避免旧新执行重叠。
- 拒绝继续修补异步 ACK：无法消除失联进程对业务完成的依赖，也保留重复领域命令的冲突面。
- 拒绝新增通用依赖图、额外 Input 状态协议或每 Run 工作目录隔离：现有持久关联足以界定离队范围，发送前一个
  条件更新足以界定未知证据；扩大模型不能消除本次根因。

<a id="v1-37-d03"></a>
## V1.37-D03：Agent 目标教学收敛到 `--to`，inline alias 只扩展连续有效前缀

### 背景

旧 parser 只识别逻辑行首的一个 exact display-name alias，导致自然生成的 `@惠 @响子` 只投递首位队员；
同时把完整 alias grammar 写入 Agent `body` help 会与稳定 canonical `--to agent_N` 入口竞争。把 cluster 内
未知 token 升级成新错误又会收紧旧行为，使原本可发布的正文被整体拒绝。

### 决定

Agent `body` help 只保留 payload 说明，canonical `--to` 是唯一推荐目标 authoring 入口。Core 继续把 inline
addressing 当兼容与运维兜底：从逻辑行首连续解析由空白分隔的有效 canonical/exact active-member mention，
保留 occurrence 顺序并按 canonical ID 去重 Delivery。第一个未知、歧义或普通文本终止 cluster；相关
display-name lookalike 保持 Text 且不新增发送拒绝，后续 canonical token 延续既有 mid-line 语义。既有
malformed canonical token 与全部 recipient admission 保持不变。

### 后果与替代方案

- 同一行可稳定表达多个现有队员，同时不把 alias 变成公开 Agent authoring 接口；catalog digest 按既有 Binding
  compatibility 轮换，不增加 wire、schema shape、数据库迁移或 Session Charter revision。
- 拒绝继续“一行一个 alias”：它把普通多 mention 截断成部分投递。拒绝任意 mid-line alias：会把叙述文本误当
  调度。拒绝 invalid-tail 原子失败：这是旧行为没有的新严格度，无法为兼容兜底带来相称收益。
- 当前规范由 [Camp Message Send v18](../../contracts/camp-message-send-v18.md)、[Public A2A Message Delivery](../../architecture/public-a2a-message-delivery.md)
  与[确认 revision 3](model-context-change-multi-mention-cluster.md)共同拥有。

<a id="v1-37-d04"></a>
## V1.37-D04：飞书执行卡使用固定直达 URL，局域网执行台以链接持有能力授权

### 背景

把执行过程继续塞进群卡会重复 Rovai 执行台、频繁改卡并受卡片预算限制；把“打开执行台”改成 callback、Owner 私聊与
点击时签发又会引入外部身份、私聊幂等和地址刷新状态机。Card 2.0 的纯 `open_url` 无法在点击时先向 Rovai 请求最新地址，
而一期明确只服务受控局域网内主动开启的只读查看，不承诺抵抗局域网主动中间人。

### 决定

飞书执行卡只保留状态和三个入口：最近输出与 exact-run 停止继续做 Owner callback；打开执行台使用创建卡片时冻结的
`open_url`，不识别点击人。Desktop Main 运行一个全局 LAN HTTP/SSE 服务，按用户固定端口签发内存随机 Token，scope 只允许
同渠道/App/Camp/队员中 focus Run 及其之前历史。IP 或端口变化不更新旧卡；Main 重启不恢复 Token。链接、局域网可达性和
有效 Token 共同构成只读查看能力，不把它描述成 Owner-only。

当前字段和错误由 [Feishu Channel v10](../../contracts/feishu-channel-v10.md) 拥有，组件边界与 UX 分别由
[飞书渠道架构](../../architecture/feishu-channel.md)和[渠道设置](../../ui/components/channel-settings.md)拥有。

### 后果与替代方案

- 旧卡在 IP、端口或网络变化后可能失效，后续新卡才使用新地址；这是避免 address generation、批量卡片迁移和私聊恢复的
  明确代价。
- 获得链接且能进入局域网的人可以查看冻结 scope；HTTP 不能为主动攻击者提供保密保证，因此 Token 只减少偶然发现和
  越权扩张，不把能力包装成 HTTPS 或飞书身份认证。
- 拒绝继续把完整 timeline 放在卡片：它增加解释层、折叠/分页与持续更新复杂度。拒绝动态 callback/私聊：它违背直接打开
  的产品行为，并没有解决 HTTP 主动攻击。拒绝每 Run 端口或冲突漂移：旧卡与运行时地址将变得不可预测。
