---
document_type: contract
contract: file-preview
version: 24
status: accepted
authority: desktop-file-preview-wire
source_version: v1.72
last_updated: 2026-11-01
---

# File Preview v24

继承 [v23](file-preview-v23.md) 的阅读、定位、候选刷新与来源解析，新增当前磁盘文本的手动保存。
Desktop 和 Web 使用同一 Rust Host 写入逻辑，历史证据、托管附件快照、分页或二进制保持只读。

## 场景接口

`FilePreviewApi` 新增可选 `readEditableFile({ handleId, expectedGeneration })` 和
`saveTextFile({ handleId, expectedGeneration, text, expectedVersion })`。旧适配未提供方法时继续只读。
两端先校验本窗口／Web editor 所有的预览句柄及 generation，再用已记录的业务 source 和真实路径调用
Core 内部 `filePreview.readEditable`／`filePreview.saveText`。Renderer 不传任意写路径。
Web 使用已认证 `/api/v1/files` action；这些内部方法不进入通用 Web operation allowlist。

返回值为 `{ ok: true, value: { key, text, version } }` 或 `{ ok: false, error: { code, message }, current? }`。
`key` 绑定当前 Host 的文件所在目录磁盘身份和 canonical 文件路径，在同一文件的原子替换前后保持；不承诺跨重建的永久身份。
入口及项目归属不参与区分当前文件。同一文件复用标签、草稿及撤销历史，历史快照与当前文件不合并。
`version` 包含原始字节摘要、文件磁盘身份与基本权限，不能由 size/mtime 代替。
`current` 只在可读取的冲突中提供同结构磁盘快照。错误为 `edit_unavailable`、`file_not_found`、
`source_not_authorized`、`file_too_large`、`edit_conflict`、`write_failed` 或 `save_unknown`。
传输层原有句柄／来源失败也保持失败，不转为成功。

## 编辑准入与保存

用户打开的、完整读取且可写的普通 UTF-8 文本均可编辑，不要求属于当前项目或先通过目录树打开。
目录、会话链接、项目外文件、Run 的 `open_current`、引用原文件的附件均解析到实际文件后使用同一流程。
普通文档 child 使用既有工作区来源表示相对或绝对目标；历史 Diff／证据、托管附件快照、硬链接及无法可靠回写的特殊格式保持只读。
正常点击和保存不新增授权目录、确认编辑、逐文件登记或来源能力标记。目录浏览范围不因此扩大。
原始读取、提交 UTF-8 字节与重建 BOM/换行后的输出都不超过 2 MiB。混合 LF/CRLF、独立 CR、NUL、无效 UTF-8
不开放编辑。编辑文本统一 LF，保存重建原有 UTF-8 BOM 和统一 LF/CRLF；保留基本权限，不格式化或补末尾换行。

Core 根据现有业务来源重验实际目标文件与句柄路径一致，项目目录来源继续检查工作副本代次，释放数据库锁后在 blocking pool 执行文件 I/O。
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
监听通知仅记录待核对状态，不直接显示“有更新”。同版本不重载正文；确有变化且无草稿时静默刷新，
有草稿时通过既有编辑读取核对版本后才显示外部修改。核对失败显示现有错误，不用更新标记代替。
自身保存确认版本及晚于保存返回的旧核对结果不触发更新提示；不增加 watcher、保存回声记录或延迟机制。
切换文件、Thread、源码／预览或隐藏面板不保存、不清草稿；不承诺应用崩溃或重启后的恢复。
编辑内容成功读取并建立文档后才记录已加载的句柄／版本；临时失败保留预览，现有错误位置提示读取失败和重试。
重试只重读当前文件，同一版本可再次请求。明确不支持编辑或超出大小限制继续只读，不显示临时读取错误。

代码／配置／普通文本直接编辑。Markdown/HTML 默认预览，源码切换在既有路径行，预览读取最后保存内容。
保存成功时若同一文件仍在刷新，为该文件记录一次待刷新；当前刷新结束后合并补刷最新磁盘内容。
这次保存后补刷不受较新未保存草稿阻挡，不替换草稿、光标或撤销历史；关闭或释放文件时清理标记。
补刷失败继续使用既有刷新错误处理，不自动反复重试、不增加保存队列。
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
同一 owner 覆盖跨入口标签／草稿复用、项目外文本和原文件附件链接的两端实际写回。
现有 `file_preview_authority` 的 open-current 用例同时验证当前文件写入与历史证据不变，不另建 Rust 测试入口。
