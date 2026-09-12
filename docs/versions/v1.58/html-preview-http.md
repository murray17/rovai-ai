---
document_type: implementation-report
version: v1.58
lifecycle: current
authority: implementation-evidence
status: completed
last_updated: 2026-09-13
---

# HTML HTTP 预览实现与验证

本增量按用户确定的正式链路改造执行，工作分支 `rovai/html-preview-http`，起点 main
`decdedda72de8feadfa3380f3e9d02c07374cf4c`。范围为 HTML、必要的共享接口、桌面文件能力适配与诊断 UI，
不改其他文件类型或作者文件。提交前同步至 main `cc91ec0d1`，两处版本文档追加冲突保留双方记录。当前规范见 [File Preview v12](../../contracts/file-preview-v12.md)。

## 实现

- `packages/html-preview` 提供独立 loopback HTTP 实例、cookie capability、范围检查、静态响应、原稿位置映射和
  浏览器通道；不导入 Electron。不同实例拥有不同 origin，权限检查独立于端口和 URL 随机性。
- Main 复用 FilePreviewService 的来源、handle、Camp binding、generation、version 与窗口生命周期；旧 HTML
  srcdoc wrapper 退出，Markdown 原协议保留。正常浏览器依赖与子 iframe 无资源重写或 History 修补。
- 正式 Provider/Pane 使用 descriptor；错误详情不覆盖已显示内容。源码模式沿用原有只读读取、分页与查找。
  新通道验证 source/origin/实例/generation/挑战/文档身份，同源真实子 frame 逐级转发诊断。

## 先失败、再验证

最小 History 与 query canvas 样本首先通过旧正式 Provider/Pane + Main service 运行，分别出现 History SecurityError
和内部 `file:...index.html?canvas=1` 加载失败。它们是两个独立业务断言，未用一个 load 事件替代二者。
迁移后检查实际正文、内部 Canvas ready、主题回执，并独立检查诊断连接。

原始交互稿逐字复制到隔离临时资源目录后验收，不修改磁盘原稿或 History API：

| 样本 | SHA-256 | 已观察结果 |
| --- | --- | --- |
| 原始 Runtime 启动稿 | `099d6f1c741df8839ea960d4f986fd86cf5e0adc0c29f303f197581a5aa36b69` | `#view` 实际渲染运行时列表、2 个子块、`#runtimes`，History 保持 native |
| 渠道连接稿 | `0014254c7dfabd8bfac80909cace65357e9ec376e2e756d2f1bffe04cd34f8ec` | query 子页实际渲染渠道与 Bot 内容；外层真实主题按钮使内层 day → night；可见画布约 974 × 622，截图复核完整页面 |

下载目录中的 Runtime 文件已变化（摘要 `a0922560d633bd3cd6d0a497707d9f39de229d3b7dd2ed2f3eff3fb5f0b7cafc`）；
它的通过不作为原始故障稿的唯一证据。最终原始附件使用上表摘要单独复验。

资源集验证 CSS/@import/url、根相对图片、经典脚本、import map、ESM、import()、JSON fetch；独立 HTTP 依赖的脚本、
样式、JSON、字体及外部 iframe 成功加载，无 CORS 头的请求仍被浏览器拒绝。8 个内部 frame 均完成各自 JSON 请求，
诊断采用每根页面单一流，避免占满 HTTP/1 连接槽。故障集验证缺失
CSS/图片的 HTTP 404、同步异常、Promise rejection、同源子页面异常与已渲染正文同时存在；原稿位置显示为
`errors.html:3` 与 `child-error.html:1`，未显示注入后伪位置。重复资源错误归并为同一项。外部脚本一直 pending 时，文档与诊断状态独立，12 秒后显示“尚未完成加载”并保留正文。
源码逐字匹配磁盘文本，切回页面保留临时交互状态；刷新换代及旧站点撤销、Tab 关闭撤销均有正式组件断言。

普通 Chrome 使用独立 profile、HTTP 宿主页和同一个共享服务及 HostChannel；从生产查找桥获得 History 正文、
内部画布正文和 module/dynamic/JSON/classic 结果，三页诊断均为空。无 Electron、Preload 或 Core 依赖。

## 验证命令与证据边界

自动入口：

```bash
pnpm test:html-preview
pnpm test:file-preview-layout
pnpm test:file-reference-navigation
pnpm test:desktop-bridge
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=decdedda72de8feadfa3380f3e9d02c07374cf4c pnpm docs:check:ci
```

`ROVAI_HTML_HISTORY_SAMPLE`、`ROVAI_HTML_CANVAS_SAMPLE` 为可选的原始文件验收路径。测试先复制到临时资源目录并
打印摘要；默认回归不依赖本机原稿。`ROVAI_KEEP_HTML_PREVIEW_FIXTURE=1` 保留隔离 userData、截图和资源，
`ROVAI_TEST_CHROME` 可指定普通 Chrome 可执行路径。Chrome 缺失时明确标记该项未执行。

Electron 和 Chrome 均使用临时绝对 userData/profile，未连接日常 Core、SQLite、Runtime 或 Skill Library；
本次是代码与隔离生产组件验证，不宣称日常已安装 App 被升级，也不据固定等待或模拟业务通过宣称真实性能 SLA。
HTTP 共享单元测试另验证 cookie/Host/来源/跨实例拒绝、query、MIME、304、range、缺失资源、SPA 静态边界、
编码与 symlink、关闭端口和上下文撤销。Main 与 HostChannel 测试独立覆盖代际、旧消息及窗口生命周期。


## 本地检查结果

已通过 TypeScript、184 个 Vitest 文件/1919 项测试、完整 `pnpm test`（其 Node 子集 317 通过、2 项平台专属跳过）、
桌面构建、桌面 contextBridge、文件链接导航与文件预览布局回归。文档单测、治理及固定 base 检查通过；Clippy 通过。
最终正式 HTML 回归包括两份原稿、HTTP/CORS/字体/外部 frame、8 个内部 frame、pending 脚本超时、源码原文、
History 导航、刷新代际、真实导航 404 与关闭撤销；普通 Chrome 验证也通过。Rust PR 套件和远端 CI 结果以 PR 记录为准。
