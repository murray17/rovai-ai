---
document_type: contract
contract: file-preview
version: 8
status: accepted
authority: desktop-file-preview-wire
last_updated: 2026-09-06
---

# File Preview v8

## 相对 v7 的变化

完整继承 [v7](file-preview-v7.md) 的窗口内 Camp 会话恢复、无原生副作用 restore wire、Renderer/Main generation
fence 与失败呈现，也继承更早版本的来源校验、具体文件能力、Viewer、watcher 和资源释放边界。本版本只让经项目文件
预览打开的合格 `child_of_handle` 在成功结果中取得自己的可重验工作区来源，使它返回 Camp 后不再依赖父文件 handle。

不新增 Core 方法、IPC channel、持久化、文件来源类型或授权范围；App 重启后仍不恢复文件 Tab。

## 成功结果中的独立恢复来源

`ResolvedFilePreview` 增加一个可选字段：

```ts
interface ResolvedFilePreview {
  // v7 fields unchanged
  restoreRequest?: RestoreFilePreviewRequest
}
```

Main 仅在以下条件全部成立时返回该字段：

1. 当前打开请求为 `child_of_handle`，且父 handle 仍通过既有 Camp、窗口、generation、文档目录与子文件后缀校验；
2. 子文件已由既有 open 流程成功解析、规范化并分类为可在应用内预览的普通文件；
3. Main 通过既有 Camp/workspace authority 独立取得当前目录 Camp 的 `camp_workspace` 根，而不是复用父 handle 的
   capability root、显示路径或 Renderer 提供的目录；
4. 子文件 canonical path 位于该 workspace 根内，且能无歧义地编码为相对根的文件引用；
5. 在发布结果和注册 handle 前，当前窗口仍绑定同一 Camp binding generation。

满足条件时字段固定为：

```ts
{
  kind: 'camp_workspace',
  campId: currentCampId,
  rawReference: workspaceRootRelativeReference
}
```

`rawReference` 以当前 Camp workspace root 为基准，不以父 Markdown／HTML／Patch 文件所在目录为基准；它不得包含绝对
路径、query、fragment、选区 target、换行或 NUL。路径分段必须采用既有文件引用 parser 可逆接受的编码，且再次相对
解析后得到同一个 canonical path。不能形成这种引用时，Main 省略字段，但既有成功预览结果仍然有效。

`restoreRequest` 是 locator，不是授权或已读取事实。Renderer 后续调用 `restore` 时仍必须按 v7 对当前 Camp binding、
workspace authority、canonical path、文件类型和副作用边界完整重验；文件被删除、移出 workspace 或改为不可预览类型
时返回既有公开错误。

以下结果必须省略 `restoreRequest`：

- `authorized_root`、外部文件或临时目录中的 child；
- 无法独立取得当前目录 Camp workspace authority 的 child；
- 目录、系统应用格式、不可预览类型，或没有完成既有成功打开流程的请求；
- `message_reference`、`camp_workspace`、`attachment`、`run_evidence` 等原有业务来源。它们继续保留自己的 source
  request，不因本字段被统一改写。

Main 不建立父子恢复链，也不延长父 handle、Root Grant、HTML token、asset token 或 watcher 的生命周期。父文件关闭、
释放、删除或内容变化不影响已经签发的 child `restoreRequest`；后续恢复只由 child 的独立 workspace locator 决定。

## Renderer 安装、快照与去重

Renderer 在成功安装 `ResolvedFilePreview` 时按以下优先级决定文件 Tab 的可重验 source：

1. Main 返回的 `file.restoreRequest`；
2. 当前打开请求本身属于 v7 的可重验 business source；
3. 同一 Tab 已保存的稳定 business source；
4. 仅供当前能力周期使用的原始临时请求。

因此，后续从同一预览文档再次打开临时 child，不能覆盖该 Tab 已取得的稳定 workspace source。窗口快照仍只保存 v7
允许的 `RestoreFilePreviewRequest` 与安全呈现；没有合格 `restoreRequest` 的临时 child 仍写成 `sourceRequest = null`，
返回 Camp 后进入 `unavailable`。

Tab 去重同时使用 Main `previewKey` 与稳定 source key。对于 Main 已确认的 `project_relative` 呈现，稳定 key 以
`campId + displayPath` 表示同一个当前项目文件；因此同一文件从消息引用、工作区引用或合格 child 打开时，可复用冷
Tab 的既有稳定 ID。该 key 只用于 Renderer 会话匹配，不能替代 Main 校验，也不改变
`message_reference`／`attachment`／`run_evidence` 的 source 语义。

## Camp 切换、失败与副作用

Camp 切换顺序、惰性恢复、A→B→A 双 generation fence、restore closed set 和资源清理全部遵循 v7。独立 child source
只允许进入既有 `camp_workspace` restore 路径；不得触发 reveal、系统应用启动、确认框、目录选择器、Root Grant 或
其他原生效果。

### 失败呈现

完整继承 [v7 的失败呈现](file-preview-v7.md#失败呈现)。尤其是恢复目标不存在时，正文区域只显示居中的 32px 通用
文件轮廓和一句 `找不到这个文件`；不显示路径、尺寸、标题、卡片、边框、按钮、错误详情或内部能力名称。

## 验收不变量

- 在 workspace 根文件打开 `docs/README.md`，再通过相对链接打开 `./design.md`，子文件的恢复引用必须是
  `docs/design.md`；释放或删除父文件后，Camp A→B→A 仍可恢复子文件；
- A→B→C 链中的每个合格子文件都直接取得自己的 workspace source，不保存父链；
- 同一项目文件从不同业务入口或 child 入口打开时，冷 Tab 复用同一稳定 ID，后来的临时请求不覆盖稳定 source；
- 目标被删除后恢复返回 `file_not_found` 并使用既有单句失败呈现；
- 外部／临时 child、Root Grant child、系统应用格式及 A→B→A 的旧 generation 不获得字段、权限或原生副作用。
