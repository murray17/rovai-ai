---
document_type: interface-contract
contract: camp-attachment
version: 10
status: accepted
authority: live-source-references-and-camp-owned-output
last_updated: 2026-09-23
---

# Camp Attachment v10

继承 [v9](camp-attachment-v9.md) 的用户 Source Ref 输入、owner 定位与弱持久性；新增 Agent 发布也统一为实际路径引用。
本合同替代 Agent Managed 导入、CLI 外部 snapshot 以及旧目录隐藏路径的当前规则，历史记录原位兼容。

## 新 Agent 发布

CLI 将 `send --file` 的实际路径交给 Core。Core 仅观察本次指定对象：绝对 UTF-8 路径、存在、可读、file/directory
及必要展示元数据；文件只读取有界 MIME 前缀，目录仅打开，不遍历内容。相对路径按当前 Run 工作目录解析。
复用 `LocalAttachmentSourceRef`，消息事务写入 `camp_message.source_attachments_json`；该列与旧受管关系表明确区分存储方式。
不填充旧摘要字段，不扫描 Camp 磁盘，不查询旧 publication 作为发布准入。

无论工作区、Run Temp、默认输出、外部路径或跨 Camp 来源，均不复制、移动、链接、staging、冻结或改变源权限。
同 Camp 再发已登记位置复用身份；同文件编辑、大小改变和替换保存不换身份。跨 Camp 各自登记引用，同享当前物理文件，
不去重内容、不做全局路径注册/引用计数/保活。目录保存其位置与内部层级，不为每个子文件创建身份。
既有内部命令提交、幂等和运输重试不变；无 allocate、外部 requestId 或跨 CLI 精确重放新承诺。失败从不回滚删除源文件。

Send 返回有序 `{attachmentId,path}[]`，无附件时 Agent 输出省略该字段。历史 read 返回可解析 path，包括工作区和外部 Agent 源。
附件列表继续查询记录；不能枚举默认输出目录代替。模型 `CURRENT_INPUT.attachments` 保持具体路径 string[]。
新 Agent 路径进入上下文不以当前可读性或首次内容为准入；缺失源由具体读取报告，不阻塞整个 Camp。
用户输入 Source Ref 的发布和 Run 前重检沿用 v9。

## 默认输出目录

统一入口 `storage_layout::camp_attachment_output_root` 沿用 Runtime storage 已确定的 instanceKey 和平台布局：

| 入口 | 默认生成目录 |
| --- | --- |
| macOS/Linux Desktop | `~/.rovai/instances/<instanceKey>/attachments/<campId>/` |
| Windows Desktop | `<CoreDataDir>/attachments/<campId>/` |
| Server | `<ServerDataDir>/instances/<instanceKey>/attachments/<campId>/` |

Host 准备普通可写目录，按用户正常创建规则生成文件，不 chmod 源、Core 根或旧文件；不强制 attachmentId 子目录。
默认输出是生成位置，不是导入目标、全部附件根或权限授予。现有 Runtime additional directories 接入该位置，仍受有效模式约束。
Run Facts 顶层仅给出 `attachmentOutputRoot`；不重复 Camp ID/scope、legacy 根或可变性教学。Run Temp 保持临时寿命。
Bootstrap 不新增流程；内容变化不参与会话兼容摘要。

## 读取与位置

预览、图像、下载、历史和 Agent 路径解析依据记录分流。Source Ref 每次读取当前内容，不比较首次大小/摘要；缓存标识只证明本次读取版本。
旧记录继续进入原定位和必要恢复，不迁移、重写历史或批量改权限。普通 Run 与新发布不依赖旧 View/receipt。
消息附件标签保持文件名；已解析本机位置支持完整路径悬停、绝对路径复制和文件管理器定位，包括隐藏和旧受管目录。
远程位置注明服务器，仅提供适用操作。路径元数据查询不读取全文；未取得位置不编造路径。
HTML 依赖按实际来源边界解析。刷新失败保留已加载内容并说明原因，切 Camp 保持现有热缓存/LRU，不加全 Camp 扫描。
细节见 [File Preview v15](file-preview-v15.md)。

## 文件归属与删除

飞书入站下载由 Host 暂存后，经 Core 写入本 Camp 默认输出目录的 `feishu/` 子目录，作为普通 Source Ref 发布。
这属于远端资源首次落地；不改变本地用户/Agent 现有路径不复制的规则。目录下未发布的中间文件同属 Camp，
删除走相同生命周期，不沿外部源引用清理。投递准入与重试见
[Channel Message Bridge v1](channel-message-bridge-v1.md#feishu-inbound-attachments)。

Camp 拥有自己的默认输出目录，包括未发布、已修改文件。删除 Camp 同时删除该目录及历史自有附件，外部引用仅删除记录。
不能沿 sourcePath 删除文件；别的 Camp 引用同文件不阻止拥有者删除，失效是接受的引用语义。
Run 回收、预览关闭/LRU 和单条消息删除不清理永久输出。不新增垃圾扫描、资产迁移或回收站。
原 Camp 删除生命周期先停止相关 Run/发布和释放句柄，再按精确自有目录清理；原持久 cleanup operation 记录失败并重试。
迟到结果不得重新创建 Camp。单次确认明确“会一并删除此对话保存的附件，包含已编辑内容。原始工作区文件和外部引用文件不受影响。”
该确认面向用户一律使用“对话”，不暴露 Camp 内部术语。

理由见 [V1.59-D08](../versions/v1.59/decisions.md#v1-59-d08)，模型字段见[已确认方案](../versions/v1.59/model-context-change-editable-attachments.md)。
