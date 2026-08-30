---
document_type: version-decisions
version: v1.32
lifecycle: current
last_updated: 2026-08-30
---

# v1.32 决策记录

<a id="v1-32-d01"></a>
## V1.32-D01：由 CLI 私有快照外部附件，保持 Core 读取边界

### 背景

不同 Runtime 使用自己的产物目录。让 Agent 每次先遇到发送错误，再把文件复制到 Run tmp 并重发，
重复消耗调用和模型上下文。直接扩大 Core 文件读取范围则会把来源读取权限交给 Core 进程。

### 决定

`rovai` CLI 在首次 IPC 前以自己的进程权限快照外部源，并把路径改写到当前 lease 的 Run tmp。
CLI 与 Core 共用文件安全检查、内容复制和 digest；Core 的独立授权、Managed v2 ingest 与原子提交不变。

当前规范由 [Camp Attachment v7](../../contracts/camp-attachment-v7.md)、
[Built-in Tool Transport v21](../../contracts/builtin-tool-transport-v21.md)和
[附件架构](../../architecture/camp-published-attachment-view.md)拥有。

### 后果

- 同一条 CLI 命令即可发送已存在的 Runtime 文件，无 Runtime 专属目录白名单；
- 外部来源增加一次私有复制，workspace/Run tmp 内文件不增加复制；
- 必须管理请求快照的失败回滚、未知结果保留和只读树清理；
- read-only mode 继续只防止意外修改，不承诺恶意同 UID 进程隔离。

### 被拒绝方案

- **Core 接收任意绝对路径：** 把读取能力转移到 Core，并扩大权限边界；
- **为各 Runtime 维护专属目录白名单：** 依赖易变化的第三方目录布局，仍遗漏自定义产物目录；
- **继续要求 Agent 手工复制：** 保留每次先失败再修正的交互成本；
- **先向 Core 发送、失败后自动复制并重发：** 无谓保留第一次失败，并复杂化请求结果与重试身份。
