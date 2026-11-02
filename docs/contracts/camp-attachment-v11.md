---
document_type: interface-contract
contract: camp-attachment
version: 11
status: accepted
authority: live-source-attachment-display-names
last_updated: 2026-10-31
---

# Camp Attachment v11

继承 [v10](camp-attachment-v10.md) 的原路径引用、owner 授权、默认输出与新旧记录读取规则。
本次只收窄 Source Ref 的显示名检查，不改变字段、附件身份、路径权限或文件生命周期。

## 显示名与实际路径

`LocalAttachmentSourceRef.displayName` 是展示文本，不是生成文件的安全路径分量。Desktop 本地准备、
草稿恢复、直接发布及 Core/Agent 原路径登记保留通过检查的原始显示名，包括冒号、前后空格、
点号与 Unicode 字符；不要求它等于旧的安全文件名清洗结果。

显示名必须同时满足：

- 去掉 Unicode 首尾空白后非空；此判断不改写存储值；
- 不含 Unicode 控制字符，或 U+202A–U+202E、U+2066–U+2069 双向文本控制字符。

不满足时拒绝该引用；这些检查在 Source Ref 读写和 Core 观察入口一致执行。已通过检查的名称不做
替换、截断或 trim。原始位置始终来自 `sourcePath`；打开、预览与 Runtime 读取不拼接显示名。
显示名不设 120 码点上限；文件名是否可创建由真正落盘入口及文件系统处理。
UUID、绝对 UTF-8 路径、重复 ID、目录元数据以及源文件存在、可读和 kind 检查保持原有边界。

## 真正落盘的文件名

渠道入站下载、历史受管附件和仍需创建副本的入口继续在自己的落盘边界生成并验证安全文件名。
共享 `normalize_display_name` 的文件名清洗规则保留；Source Ref 显示名的放宽不授予路径穿越、
任意目的路径、符号链接或新的读取权限。

## 兼容与恢复

现有已清洗的 Source Ref 保持原记录，不迁移或重写历史。Desktop 已保存的原始显示名可在原有
恢复与发送链路重新使用；附件 ID 和实际路径保持不变。Core、Desktop 与 Web 继续使用原 JSON
shape、owner 定位和恢复机制，不增加迁移、名称别名或第二套附件身份。
