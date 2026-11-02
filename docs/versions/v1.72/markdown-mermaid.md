---
document_type: implementation-plan
version: v1.72
authority: markdown-mermaid-implementation-and-acceptance
status: complete
last_updated: 2026-11-02
---

# Markdown Mermaid 审阅交付

范围来自 [#979](https://github.com/murray17/rovai-ai/issues/979) 及本轮确认：一次完成文档图表审阅，包含宽图、
长图、源码、复制、主题、失败回退和手动重试。消息、编辑、图片导出不作为本次完成门槛。
固定离线加载路径是内部验证顺序，不单独交付缺少阅读交互的基础版。

合并前硬门槛：与 `277b562f178c62b38a8f50dfe81282118566786f` 在同平台、架构、构建与签名配置下比较，
实际安装分发包和安装后的 App 文件逻辑大小均须净增不大于 0。本轮已重新构建并通过此门槛，精确字节数见下表；旧验收的约 16.6 MB 增量不能作为可接受结果。

当前行为归[架构](../../architecture/file-preview.md#markdown-图表渲染)与
[UI](../../ui/components/file-preview.md#markdown-图表阅读)。这是局部可逆实现，不新增 Version Decision、
Core 合同或数据库 Migration。

## 实现

- `DocumentMarkdown` 向 `SafeMarkdown` 注入稳定文档代码块组件；message 入口不引入文档渲染依赖。
- 执行控制台从轻量 context 消费预览能力，不再因 Provider 间接打包文件查看器、语法引擎与 Mermaid。
- `MarkdownMermaidBlock` 拥有请求序号、当前结果和用户视图偏好；候选图片先解码再提交。
- `mermaid-renderer` 统一串行、身份校验和整代重置；`mermaid-sandbox` 仅执行可信本地资源。
- 锁定 Mermaid 12.2.0 与 DOMPurify 3.4.17，使用 Vite 原生 asset URL 和动态 import。Desktop/Web 由一个多入口构建共享资源与公共模块。
  HTTP 加载 nonce 经典脚本；Desktop 读取同一资源后置入 nonce 页面壳。正式宿主 CSP 保持不变。
- `PreviewImage` 从原图片 Viewer 提取，复用缩放、尺寸和错误处理，溢出区域由可聚焦滚动容器承接。普通图片的位置保存/恢复使用实际滚动节点，
  同一图源的主题换图以稳定内容身份保留大图比例、尺寸与滚动位置。
- Desktop 只缓存成功读取的脚本文本；旧代未完成读取不会阻塞新请求。

## 验证

定向 Vitest 覆盖精确分发、源码保留、引擎串行、超限、加载失败重试、超时后结算当前及排队任务、伪造与迟到响应。
`pnpm test:markdown-mermaid` 使用同一生产组件的正式 Vite 构建，在 HTTP 浏览器与 Electron file 入口检查：
flowchart、graph、sequence、class、state、ER、中文、宽图、长图和坏图；大图键盘/滚动/焦点；源码选择保持、
复制与文件查找；图片解码失败、实例丢失后手动重试、过期候选及卸载 URL 回收。

HTTP 夹具沿用正式 Host CSP。网络验收使用可达的受控 HTTP 地址，包含图中图片、HTML、CSS、click、frontmatter 和 init 覆盖输入，
不使用网络 abort/断网替代产品边界。此夹具不启动 Core 或真实 Runtime。

### 正式入口与回归结果（2026-11-02，修订验收）

`pnpm accept:markdown-mermaid` 在本轮 DMG 经 `ditto` 复制出的 macOS arm64 ad-hoc App 中启动独立 userData/Skill 目录，
从真实项目目录打开同一篇混合文档；随后登录该安装包 Host 自带的 Web UI，重复文档与大图操作。
两端均有 8 张正常图和 1 张局部失败图，中文、源码切换及大图正常；Desktop 主题切换和文件监视刷新保留
源码选择。Desktop 实际读取 `Resources/web-ui/assets` 的三份脚本，Web 通过同一安装目录的 `/assets`
静态入口读取，未放宽 CSP 或增加资源服务。实际安装产物没有连接日常数据或启动模型 Run。这是 macOS Desktop 与 Chrome Web 验收，
不等同于 Windows/Linux 整机验收。

- 真实 Mermaid 专项：Web（正式 CSP）与 Electron file 两端通过；常见图种逐一检查 SVG 文本标签。
  恶意输入从引擎渲染到最终图片展示全程观察可达服务器，外部资源请求为 0。
- 新回归通过：普通 PNG 图片在 125% 缩放、横向 420px / 纵向 310px 滚动后重建预览，比例与位置恢复。
- 新回归通过：首次本地脚本读取持续等待，旧代超时后手动重试，实际再次读取并成功渲染。
- 新回归通过：宽图与长图的大图在主题换图后保留比例与滚动位置。
- 类型检查通过；Vitest 262 个文件、3058 项通过，2 项跳过。并行打包时两项文件 IO 测试超时，
  结束打包后定向及全量重跑均通过，未增加超时或放宽断言。
- 默认 Node 测试 365 项通过，2 项跳过；文档测试 10 项通过；Skill 与 Electron sandbox 能力门禁通过。
- `pnpm test:rust:pr` 本轮全量通过（484 项，1 项忽略）。
- 原代码复制浏览器回归通过。原文件布局浏览器回归在宽表格滚动断言失败；将 SafeMarkdown、FilePreviewPane、
  styles 与语言资源恢复为基线 `277b562f1` 后，同一测试仍在同一断言失败，记录为既有问题，未改动其断言。
- 文档版本及 Decision 治理门禁在包含本次变更的干净索引快照通过。本机被忽略的 `docs/prototypes/` 有历史
  断链，直接运行 `pnpm test` 会先在文档扫描处停止；保留这些本地文件，未为本功能增加检查例外。

### 安装体积：零净增已通过

以 `277b562f178c62b38a8f50dfe81282118566786f` 的干净源码归档重新构建基线，与本轮产物在同一台
macOS 26.6 / arm64、Node 26.12.1、pnpm 11.20.0、Electron 43.1.1、electron-builder 26.15.3 环境比较。
两份锁文件均冻结安装；Rust 源码和 Cargo.lock 未改变，使用同一次 Release arm64 构建的相同 sidecar 字节，
分别完成前端构建、组装、签名和分发包生成。两边均为 `identity=-` ad-hoc、hardened runtime，未公证；
压缩均为 electron-builder 默认 `normal`（DMG UDZO，ZIP Deflate），未用不同压缩或签名配置抵消增量。

| 项目 | 基线精确字节数 | 本轮精确字节数 | 差额 |
| --- | ---: | ---: | ---: |
| 实际 DMG | 157,619,877 B | 154,640,892 B | **−2,978,985 B** |
| 实际更新 ZIP | 157,667,231 B | 154,678,297 B | **−2,988,934 B** |
| 从各自 DMG 复制安装的 App | 410,944,692 B | 402,043,961 B | **−8,900,731 B** |

App 口径为逐个普通文件的逻辑 `st_size` 合计，不计目录块分配，不沿符号链接重复累加目标。
两份安装 App 均通过 `codesign --verify --deep --strict`。该表取代旧验收的目录型 App 估算，不跨口径相减。
分发包与 App 分别满足净增不大于 0；未以首屏或按需加载数字替代安装体积。

控制台现在只有 `execution.js`（996,943 B）和 `execution.css`（735,291 B）两个固定资源，无 document 脚本
或 worker 悬空引用。最终 ASAR 不包含 `out/renderer`；生产多入口构建在现有 `web-ui` 内共享公共依赖、样式和
可信离线资产，保留 `desktop.html` / `index.html` 两个入口。没有删除图种、中文、图片阅读或现有前端功能，
没有 CDN、首次下载或新资源协议。开发 HMR 仍沿用原入口。

| Mermaid 相关资源（均在 `Contents/Resources/web-ui/assets`） | 实际副本数 | 总字节数 |
| --- | ---: | ---: |
| `mermaid.min-CDSj-a4E.js`（完整引擎） | 1 | 5,494,801 B |
| `purify.min-B6fOEg_O.js` | 1 | 29,828 B |
| `mermaid-sandbox-entry-BWXONEOb.js` | 1 | 4,408 B |
| `mermaid-sandbox-CoPjuEoh.js`（异步加载模块） | 1 | 1,334 B |
| 合计 | 每项一份，Desktop/Web 共用 | **5,530,371 B** |

复现：两端冻结安装后 `pnpm build:desktop`，使用相同 Release sidecar，运行
`CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac dmg zip --arm64 --publish never -c.mac.identity=-`。
挂载各自 DMG 后用 `ditto` 复制 App，再按上述口径统计。验收运行
`pnpm test:markdown-mermaid`、`ROVAI_FILE_PREVIEW_CASE=image-reading pnpm test:file-preview-layout`、
`node scripts/accept-markdown-mermaid.mjs /absolute/path/to/installed/App.app`。
设置 `ROVAI_MERMAID_OUTPUT` 可保存截图、离线资源路径、真实 SVG 样例和 JSON 结果。

另提供独立离线 HTML 前后交互稿：以 `a40fe47f2` 为 UI 行为对照，复用安装产物的 DOM、CSS、主题 token 和
真实 SVG；演示源码、大图、主题、图片重建和重试，明确标注故障为模拟。它不参与构建或替代生产验收。
