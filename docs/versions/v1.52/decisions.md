---
document_type: version-decisions
version: v1.52
lifecycle: current
last_updated: 2026-09-06
---

# v1.52 决定

<a id="v1-52-d01"></a>
## V1.52-D01：合格预览子文件投影为独立 workspace locator

### 背景

v1.51 的窗口快照刻意拒绝 `child_of_handle`，因为该请求依赖父文件的短期 handle；离开 Camp 会释放父能力，返回后既
无法安全重放，也不能用旧 handle 越过当前授权。可是 Markdown、HTML 与 Patch 中打开的项目内文件本身通常仍是当前
Camp workspace 的普通文件。让它永久依赖父 handle，会使用户在 Camp 切换后失去正在阅读的子文件；保留父能力或建立
父子恢复链，又会延长临时权限、扩大资源生命周期并让多层链接的失败与清理相互耦合。

### 决定

Main 仅在既有 `child_of_handle` 打开成功后，使用当前目录 Camp 的既有 workspace authority 独立解析 workspace 根。
若子文件 canonical path 位于该根内，Main 把它编码为相对根的 `camp_workspace` `RestoreFilePreviewRequest`，随成功
`ResolvedFilePreview` 返回。该字段只是后续重验 locator，不是授权；恢复仍完整经过当前 Camp binding、workspace
authority、canonical path 与文件分类校验。

Renderer 安装结果时优先采用 Main 返回的稳定 source，并用 Main `previewKey` 与已确认的项目相对 source key 复用同一
文件 Tab。临时 child 后续再次打开同一 Tab 时不得覆盖稳定 source。父文件关闭、释放或删除不影响已经形成的独立
locator；多层链接的每一层都直接投影到 workspace root，不保存父链。

### 后果与被拒绝方案

- 项目内子文件可以随窗口内 Camp session 恢复；目标删除或移出 workspace 后按当前事实失败，不使用旧内容。
- 外部、临时和 Root Grant child 继续不可恢复；获取 workspace authority 失败只省略字段，不把已成功的当前预览改成
  失败，也不扩大父能力。
- 消息引用、附件和 Run Evidence 保持原 source 语义；稳定项目 key 只用于 Renderer Tab 匹配，不能替代 Main 授权。
- 拒绝保留父 handle 或序列化父链：它会延长临时能力并让恢复依赖父文件仍存在。
- 拒绝以父 capability root、父显示路径或 Renderer 目录计算引用：这些都不是当前 Camp workspace 权威。
- 拒绝把所有成功结果改写为 `camp_workspace`：附件、消息与 Evidence 各自拥有不同身份和当前性语义。
- 拒绝新增 Core 方法、来源类型或专用 IPC：既有 workspace authority 与 restore closed set 已能表达所需边界。

当前规范见 [File Preview v8](../../contracts/file-preview-v8.md)、
[File Preview Architecture](../../architecture/file-preview.md)与[Camp 文件预览区](../../ui/components/file-preview.md)。

<a id="v1-52-d02"></a>
## V1.52-D02：正文按消息块定稿，维护空调用在源头收敛

流式文本的运输粒度不应成为历史粒度。逐 delta 写入放大 Evidence 行数，而仅保留最后 final answer 又会
丢失工具之间的过程正文。因此每个正文块保留独立身份和首次位置，优先采用原生 item 完成结果；无可靠
完成结果时在 Core 聚合到明确连续边界。短暂占位允许定稿更新，工具事实继续 append-only；读取叠加当前
未定稿正文以保持切换/重进运行中 Camp 的完整性。

拒绝仅在数据库入口丢弃 delta、只保留 Run 最后一段、重复保存累计正文及完成正文，以及按 UI 隐藏状态
删除已有 reasoning 历史。取消、失败和正常退出保存已收到正文，但不承诺强制杀进程或断电后恢复未落盘
片段。历史不自动重写；单次离线聚合必须显式授权、备份并验证未改变工具、顺序、内容和引用。

维护写放大优先减少明确的空调用，不用统一日志策略削弱命令保证：有效 Lead 的新 enter 不提交 reconcile，
可见通知不因全局游标推进重复确认。Roster 的 observed-at/generation 仍参与新鲜度与待投递授权；只复用
仍有效的已有短期缓存，不按成员列表相同跳过更新。已执行命令继续保留原结果回放、审计和恢复职责。

当前规范见 [正文块 Evidence](../../contracts/run-process-detail-surface-v30.md#text-block-evidence)、
[Camp Open](../../contracts/camp-open-projection-v15.md)、[通知合同](../../contracts/notification-episode-v5.md)与
[Evidence 不变量](../../architecture/foundational-invariants.md#evidence-usage)。
