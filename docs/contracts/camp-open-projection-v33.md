---
document_type: protocol-contract
contract: camp-open-projection-v33
status: accepted
version: 33
source_version: v1.72
last_updated: 2026-11-14
---

# Camp Open Projection v33

继承 [v32](camp-open-projection-v32.md)。

structured content 保留目录 targetKind 与 Core 冻结路径/标签。旧文件缺省 file，旧消息和冻结输入不重写。
历史目录激活重新核对原根、当前目录类型和 pathAtSend 后定位文件树；不尝试读取为文件，不提供目录内容快照。
Renderer 显示不带 / 的短目录名，复制与模型投影继续由发布字段生成。
完整语义见 [项目引用 v2](project-file-reference-v2.md)。

## 模型记录缺失的呈现

继承 v28 的 `runtimeModel` 投影与旧 Host 兼容不变：整个字段为 null 或缺省表示没有记录；有效记录中的 `modelId: null` 表示智能体默认。
缺失记录的 Renderer 呈现以当前[会话 UI 规范](../ui/components/conversation-workspace.md#thread-队员管理)为准：隐藏摘要、箭头和浮层入口，
覆盖继承链中的“模型未记录”占位行为；不补写历史快照或改变读取协议。
