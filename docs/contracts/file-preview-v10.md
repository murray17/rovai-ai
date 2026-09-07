---
document_type: contract
contract: file-preview
version: 10
status: accepted
authority: desktop-file-preview-wire
source_version: v1.55
last_updated: 2026-09-07
---

# File Preview v10

## 相对 v9 的变化

完整继承 [v9](file-preview-v9.md) 的显式 Markdown 文件入口、来源校验、具体文件能力、项目内子文件独立
恢复来源、成功后提交、Files Changed 预览路由、Viewer、watcher 和资源释放边界。本版本只调整成功打开后的
路径呈现与既有路径操作：项目根文件和项目外普通文件也显示路径，同名 Tab 使用最短唯一目录后缀，复制入口
统一复制经重验的绝对路径。

不新增文件来源、Root Grant、持久化、读写权限或普通文本自动链接识别。

## 成功路径投影

`FilePreviewPathPresentation` 增加 `external`：

```ts
type FilePreviewPathPresentation =
  | 'project_relative'
  | 'external'
  | 'file_name_only'

interface ResolvedFilePreview {
  // v8 fields unchanged
  displayPath: string
  pathPresentation: FilePreviewPathPresentation
}
```

Main 只在既有打开流程已将目标解析为 canonical 普通文件、完成文件身份和 classifier 校验后签发呈现：

- canonical 文件仍在当前 Camp 项目根内时，`project_relative` 的 `displayPath` 是以 canonical 项目根为
  基准的相对路径；项目根文件仍返回文件名，不降级为隐藏路径的类型；
- 项目外普通文件使用 `external`。canonical 文件在 canonical 用户主目录内时，`displayPath` 使用
  `~/` 加相对主目录的路径；其他位置直接使用 canonical 绝对路径；
- `attachment` 继续使用 `file_name_only` 和 authority 给出的安全显示名。无论 source 暂时位于项目内外，
  Renderer 都不接收或反推 source、Managed storage、legacy storage 或 OS Temp 路径。

`displayPath` 是成功时的可见呈现值，不是文件权限或后续系统操作的输入。Renderer 不从字符串形态
判断项目归属，不把外部路径改写成项目相对路径，也不用它扩大 handle 的 capability root。

## 文件入口与解析基准

消息中只有显式 Markdown link destination 产生文件入口。是否显示入口不依赖 stat、read 或项目 containment；
inline-code、代码块和普通正文仍不扫描、不猜测、不自动转换路径。点击后继续执行 Core 精确消息来源
验证和 Main 打开流程；支持预览的文件进入文件 Tab，系统格式交给默认应用，目录交给系统文件管理器。

相对引用只按已冻结的来源上下文解析：

- CampMessage 使用来源 AgentRun 的绝对 `executionRoot`；没有来源 Run 时，使用该消息所属 directory
  Camp 的项目目录；
- Markdown、HTML 或 Patch 预览中的相对文件链接使用当前文档的 canonical 所在目录；
- 绝对路径、Home 相对路径和 file URI 按自身位置解析，不因 Renderer 当前选中项目变化而改写。

缺少必要来源上下文时返回既有公开失败；不扫描其他目录、不搜索同名文件、不拼接候选目标。Camp 切换
继续通过 v8 的 source request、binding generation 和 restore 管道重验原文件。

## Renderer 呈现与系统操作

成功且 ready 的 `project_relative | external` 普通文件始终在 Tabs 下显示一行路径。路径行使用相同的排版、
颜色和交互，不增加“项目外”、“当前项目”、Badge 或状态颜色。可见文本使用路径分隔符；空间不足时
从目录中部省略，优先保留末尾目录和文件名，不产生水平滚动。整行通过 `title`、可访问名和
hover/focus tooltip 提供未省略的 `displayPath`。

路径行是既有 `revealInFolder` 的可聚焦入口；点击或键盘激活后，Main 根据当前 handle 重验 canonical 文件并
交给 Finder／文件资源管理器。右键菜单继续拥有默认应用、显示所在位置和复制操作；项目内外普通文件的可见复制
入口名为 `复制完整路径`，固定调用 `copyPath({ format: 'absolute' })`，剪贴板得到重验后的 canonical 绝对路径，
不复制 `~/`、省略文本、项目相对路径或单独文件名。只有安全名称的 Attachment 保留 `复制文件名` 和 display
格式，Main 拒绝对 `file_name_only` handle 的 absolute 请求。

同类 Tab 中的同名普通文件从 `displayPath` 末尾开始逐级增加目录，直到得到当前同名组内的最短唯一名称。
可用路径后缀仍无法区分时，使用完整安全显示值；只有文件名的 Attachment 或仍无法区分的项使用
`文件名 · 1/2` 序号。File Change 和普通文件不互相扩展名称。

`opening | missing | unavailable | error` 仍隐藏路径行；失败不移除原始链接或 Tab shell。

## 权限与资源边界

显示项目外文件的 `displayPath`、调用 reveal 或复制绝对路径，都只使用该 handle 已经授予的单文件能力。
它们不创建或持久化 Root Grant，不授权父目录，不更改 Camp 项目、会话工作目录、Runtime 读写根或 Agent 权限。
重新加载、系统打开、reveal 和复制绝对路径均重验同一来源和当前文件身份；移动、删除、失权或身份变化
返回既有公开失败，不自动选择父目录。

## 验收不变量

- 项目内 `src/components/Button.tsx` 显示项目相对路径，项目根 `README.md` 也显示路径行；
- 项目外主目录文件显示 `~/Desktop/report.html`，其他文件显示 canonical 绝对路径；symlink 显示实际
  打开的 canonical 目标；
- 路径行在长路径和窄窗口下无水平溢出，hover/focus 可读完整值，鼠标与键盘激活均调用当前
  handle 的 reveal；
- 右键“复制完整路径”对项目内外普通文件都复制 canonical 绝对路径；
- `~/Desktop/report.html` 和 `~/Downloads/report.html` 的同名 Tab 分别显示 `Desktop/report.html` 与
  `Downloads/report.html`；重复后缀继续向上补足目录；
- Attachment 仍只显示和复制 authority 给出的安全文件名，absolute 复制请求失败，不显示或复制内部存储路径；
- 显式 Markdown 文件入口在点击前不读取、不检查存在性；点击失败保留原文件引用；
- 项目切换不改变历史消息的解析基准，缺少来源上下文不搜索其他目录或同名文件；
- 项目外文件的打开、路径显示、reveal 和复制不新增父目录授权、工作目录变更或 Agent 读写能力。

## References

- [File Preview v9](file-preview-v9.md)
- [File Preview Architecture](../architecture/file-preview.md)
- [Camp 文件预览区](../ui/components/file-preview.md)
