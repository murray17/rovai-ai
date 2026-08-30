---
document_type: version-decisions
version: v1.33
lifecycle: current
last_updated: 2026-08-30
---

# v1.33 决策记录

<a id="v1-33-d01"></a>
## V1.33-D01：私有下一轮准入复用消息内核，编辑仅保存占用

### 背景

用户希望在当前执行结束前继续提交工作，也要求队列中的旧内容不能在编辑时意外发送。
把全部工作放在 Renderer 会丢失顺序和恢复边界；引入持久 working copy、附件归属和重试平台则超过
本次连续消息功能需要的范围。

### 决定

Core 保存私有 Pending 和一个 Camp 编辑占用。只有显式保存才提交编辑内容；异常退出保留占用，
由用户重新编辑或放弃。随机 token 与 Pending revision 拒绝旧请求，不使用心跳或自动解锁。
发布复用现有 SQLite 消息内核，成功结果与 Pending 同事务保存。失败后暂停，由用户显式继续。

按用户在实现期间确认的交互，Composer Stop 完全停止当前执行后自动发出一个队首，后续仍按轮
执行；不要求再点击继续，也不增加单步队列模式。取消命令持久恢复 auto，已有非终态检查负责等待
Run/Delivery 完全结束。编辑仅从独立小铅笔按钮进入，行背景与正文没有编辑点击行为。

规范由 [Pending Camp Input v1](../../contracts/pending-camp-input-v1.md)、
[Camp Composer Draft v6](../../contracts/camp-composer-draft-v6.md) 与
[Composer 架构](../../architecture/camp-composer-draft.md) 拥有。

### 后果

未保存的全部编辑可能随窗口退出丢失，但 canonical 内容不会因此自动发出。
V1 不支持 Pending 附件，普通附件 Draft 必须等队列恢复空闲后发送。
已公开消息的 Runtime 失败不退回 Pending，避免重复执行。

### 被拒绝方案

- Renderer 本地队列：无法跨重启保留用户提交，无法保护 Core 并发准入；
- 第二套持久 Composer 与附件 Bundle：增加独立自动保存、文件生命周期与恢复系统；
- 超时自动解除编辑占用：无法证明窗口中不存在未同步修改；
- 单独发布 worker 和自动重试：本地单 Core 的短事务足以保证唯一发布，用户希望失败后自行决定。
