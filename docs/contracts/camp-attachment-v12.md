---
document_type: interface-contract
contract: camp-attachment
version: 12
status: accepted
authority: live-source-attachment-presentation
last_updated: 2026-10-30
---

# Camp Attachment v12

继承 [v11](camp-attachment-v11.md) 的显示名、原路径、owner 授权和文件生命周期规则。
本次仅为长粘贴附件增加有界展示信息，打开、读取、发送保护和删除资格保持原规则。

## 粘贴内容展示

`LocalAttachmentSourceRef` 与 `LocalAttachmentSourceView` 增加可选字符串 `pastedTextPreview`：

- 最多 160 个 Unicode 码点，仅用于文件卡片的第一行；不含控制字符或
  U+202A–U+202E、U+2066–U+2069。目录不得携带该字段。
- Main 在生成长粘贴文件时从已有 UTF-8 字节提取前缀，将连续空白与上述控制字符合并为空格，
  去掉首尾空格。按块解码、够长即停止，不另读文件或复制完整正文到草稿。
- 空字符串表示原内容没有可展示前缀，卡片显示“空白文本 / Whitespace only”。
- 有该字段时，第二行显示“粘贴内容 / Pasted text”；不可用错误仍优先展示。
  文本按纯文本转义，单行省略，原始 `displayName` 保留在预览、菜单和下载中。

字段沿用本机附件登记、草稿附件清单、最终发送快照及现有 owner 的 Source Ref JSON 保存。
Core 的无路径附件 View 透传该字段；模型的附件 History View 不新增该字段。
该展示信息不构成 Main 的生成来源或删除授权，不能据此删除外部文件。

## 兼容与边界

字段缺失或 `null` 的旧 Source Ref 保持可读，省略值不写入序列化结果。旧卡片继续显示原文件名，
不扫描或回填历史文件；外部文件入口不提取内容。无需数据库迁移、全文副本或新的附件登记系统。
内容前缀是生成时的展示快照，预览和 Runtime 读取仍访问原文件全文。

用户消息与 Composer 文件卡片最大宽度 224px，短名称按内容收窄；Agent 文件列表填满可用宽度，
上限 620px，窄容器内收缩。图片缩略图尺寸不变。
具体组件样式由[会话工作区](../ui/components/conversation-workspace.md)约束。

## 历史存储的故障范围

旧根标记、根物理身份变化、无关坏条目或不可读子目录不参与 Core ready 或普通 Run 准备。正常消息及无关附件继续可读，具体源无法访问时仅该内容报错。禁止通过全目录检查决定整条任务是否可用。

实例路径派生与重叠检查接受 Windows 普通驱动器路径及其 `\\?\` 前缀形式，不将这种表示差异判为错误实例；比较只处理路径本身，不访问附件树，也不要求根目录已经存在。
写入和删除仍核对具体目标的 owner、路径与当前对象；原文件及无法确认归属的历史目录保留。旧派生视图可在实际访问时重建，不启动全盘恢复，不用补写成功回执放行。

新 Runtime 输入只对最终选中的旧附件执行锁外原文件校验，并在冻结前复核对应记录；校验通过后可直接读取原 Authority 文件，不依赖旧派生目录及其清理完成。单个原文件不可用不取消其他附件，未选中的历史文件不进行预检。历史查询的位置投影只验证具体记录与受管路径，不读取文件正文；已冻结 Context 的路径和回执不改写。
