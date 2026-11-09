---
document_type: protocol-contract
contract: file-preview-v27
status: accepted
version: 27
source_version: v1.72
last_updated: 2026-11-07
---

# File Preview v27

继承 [v26](file-preview-v26.md)，沿用项目文件服务和普通文件的根内边界。
新增 `projectFileReferences.resolve` 的目标身份确认，不延长浏览 scope，也不把 rawReference 变为权限凭证。
文件树及项目文件预览在当前公开 Composer 可编辑时提供“引用到输入框”，共用 Host 确认与 Atom 插入函数。

历史文件打开可携带 `expectedPathAtSend`，它只与重新验证后的主机路径比较；不能覆盖来源或扩大权限。
每次激活项目文件都验证来源，不能仅凭缓存的预览标签绕过根变化。预览关闭、scope 释放及移除引用不删除文件。
完整恢复与失败语义见 [Project File Reference v1](project-file-reference-v1.md)。
