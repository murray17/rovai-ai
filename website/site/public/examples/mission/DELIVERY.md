# Orbit 下载交付验收记录

当前页面提供三个平台的 `.txt` 教程演示文件。页面和 README 均说明它们不是 Orbit 安装包。

| 平台 | 实际演示文件 |
| --- | --- |
| Apple Silicon（macOS） | `downloads/orbit-apple-silicon.txt` |
| Intel Mac（macOS） | `downloads/orbit-intel.txt` |
| Windows x64 | `downloads/orbit-windows-x64.txt` |

## 已执行的检查

- 读取当前 `index.html`，核对三个平台名称、下载链接、文件名和教程文件说明。
- 运行 `node verify.mjs`，结果通过。脚本检查 HTML 基本标记与标签嵌套、页面仅有一个 `main` 和一个 `h1`、样式表引用、非安装包说明、键盘焦点样式、响应式网格、三条链接的标签与 `download` 属性、目标文件存在及其非安装程序说明。
- 同一脚本计算页脚文字与页面背景的最低对比度为 **4.71:1**，达到脚本要求的 4.5:1。
- 检查本次启动的 `python3 -m http.server 8765` 进程，已无运行实例。

## 尚未完成的浏览器测试

- 在桌面和手机视口检查实际排版及是否出现横向滚动。
- 用键盘逐一聚焦三个下载链接，检查焦点显示和顺序。
- 在浏览器中点击三个链接，确认实际保存的文件名和内容。

本次未执行浏览器交互测试。
