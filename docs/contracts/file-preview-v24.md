---
document_type: contract
contract: file-preview
version: 24
status: accepted
authority: desktop-file-preview-wire
source_version: v1.72
last_updated: 2026-10-29
---

# File Preview v24

继承 [v23](file-preview-v23.md) 的阅读、定位、候选刷新与来源准入，新增当前项目文本的手动保存。
Desktop 和 Web 使用同一 Rust Host 写入逻辑，不更改历史证据、附件资产、分页或二进制阅读能力。

## 场景接口

`FilePreviewApi` 新增可选 `readEditableFile({ handleId, expectedGeneration })` 和
`saveTextFile({ handleId, expectedGeneration, text, expectedVersion })`。旧适配未提供方法时继续只读。
两端先校验本窗口／Web editor 所有的预览句柄及 generation，再用已记录的业务 source、真实路径和根目录调用
Core 内部 `filePreview.readEditable`／`filePreview.saveText`。Renderer 不传任意写路径。
Web 使用已认证 `/api/v1/files` action；这些内部方法不进入通用 Web operation allowlist。

返回值为 `{ ok: true, value: { key, text, version } }` 或 `{ ok: false, error: { code, message }, current? }`。
`key` 绑定当前 Host 的根目录磁盘身份和文件路径，在同一文件的原子替换前后保持；不承诺跨重建的永久身份。
`version` 包含原始字节摘要、文件磁盘身份与基本权限，不能由 size/mtime 代替。
`current` 只在可读取的冲突中提供同结构磁盘快照。错误为 `edit_unavailable`、`file_not_found`、
`source_not_authorized`、`file_too_large`、`edit_conflict`、`write_failed` 或 `save_unknown`。
传输层原有句柄／来源失败也保持失败，不转为成功。

## 编辑准入与保存

首版准入完整读取、当前工作区范围内、可写的普通 UTF-8 文本，来源为 `camp_workspace` 或
已授权的 `message_reference`；可独立恢复的项目内 child 使用既有工作区来源。历史 Run 来源、托管附件、
符号目标范围之外、硬链接及无法可靠回写的特殊格式保持只读。
原始读取、提交 UTF-8 字节与重建 BOM/换行后的输出都不超过 2 MiB。混合 LF/CRLF、独立 CR、NUL、无效 UTF-8
不开放编辑。编辑文本统一 LF，保存重建原有 UTF-8 BOM 和统一 LF/CRLF；保留基本权限，不格式化或补末尾换行。

Core 根据现有业务来源重验实际根目录和文件路径，释放数据库锁后在 blocking pool 执行文件 I/O。
同一路径的 Host 请求串行：读取当前版本、比较 expectedVersion、写同目录临时文件、再检查路径和版本、替换原文件、
返回确认的新版本。已删除文件或失效目录不自动创建，不回退到别处同名文件。临时文件在失败时回收。
这是乐观检查加原子替换，不承诺外部进程强互斥、全部 metadata 保真或跨重启保存事务。

冲突覆盖仍调用同一接口，使用用户处理冲突时观察到的磁盘 version；再次变化必须再次冲突。
替换后无法确认内容则返回 `save_unknown`。客户端网络错误同样按结果未知保留草稿，禁止自动重写。
重读内容与提交快照相同则确认成功；仍与保存前基线相同则保留草稿，采用当前版本恢复手动重试，不弹冲突；
两者都不相同才进入冲突。明确覆盖时，核对基线是用户当时观察到的磁盘快照，不是更早的保存文本。
Web 的 files JSON 请求额度覆盖 2 MiB 文本的 JSON 转义开销，实际内容仍由 Host 检查 2 MiB 上限。

## 窗口编辑状态与用户操作

窗口内以 Host key 复用 draft、savedText、version、saving、error、冲突／结果未知快照及 CodeMirror 状态。
`draft !== savedText` 为未保存判据。一次仅一个保存请求；提交 A 后继续输入 B，成功只确认 A，保留 B 和撤销历史。
普通预览刷新、缓存回收与自写监听事件不能淘汰未保存内容。沿用现有窗口预算，容量不足明确提示先保存或关闭。
切换文件、Thread、源码／预览或隐藏面板不保存、不清草稿；不承诺应用崩溃或重启后的恢复。
编辑内容成功读取并建立文档后才记录已加载的句柄／版本；临时失败保留预览，现有错误位置提示读取失败和重试。
重试只重读当前文件，同一版本可再次请求。明确不支持编辑或超出大小限制继续只读，不显示临时读取错误。

代码／配置／普通文本直接编辑。Markdown/HTML 默认预览，源码切换在既有路径行，预览读取最后保存内容。
标签用未保存圆点；路径行只在有修改时提供保存图标。`save-file` 默认 Mod+S，复用快捷键配置，只处理当前文件区域，
聊天输入不由此动作消费。没有保存成功弹窗。

关闭未保存文件或应用退出使用现有对话框：保存／不保存／取消。保存失败或保存期间出现新修改不关闭；
浏览器离开使用 beforeunload 提醒，用户取消时不能释放编辑资源。冲突对话框仅取消、放弃并重读、明确覆盖。
可选 `onConnectionRestored` 仅通知窗口核对未知保存结果，不拥有自动保存或新恢复队列。

## 验收所有者

共享 Host 写入：`crates/rovai-core/src/file_edit.rs` 的临时文件测试覆盖格式、权限、摘要冲突、删除及并发。
客户端竞态与保留：`file-edit-store.test.ts`；原有预览资源测试继续覆盖回收和候选提交。
真实 Desktop 文件准入 → Host → 磁盘及 Web HTTP → 同 Host → 磁盘由既有 `host-web.test.mjs` 所有，
新增 `host-web-file-edit.mjs` 只扩展该隔离夹具；不启动模型或读取日常数据。
该 owner 同时覆盖保存请求在 Host 准入前等待期间的真实外部修改，以及生产保存回调触发 HTML 候选刷新，
核验 Desktop 预览 HTTP 字节和 Web 的 Host 文档／预览生成结果；不把传输等待试验描述成跨进程互斥证明。
