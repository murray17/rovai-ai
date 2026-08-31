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
