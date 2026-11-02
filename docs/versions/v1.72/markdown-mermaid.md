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

当前行为归[架构](../../architecture/file-preview.md#markdown-图表渲染)与
[UI](../../ui/components/file-preview.md#markdown-图表阅读)。这是局部可逆实现，不新增 Version Decision、
Core 合同或数据库 Migration。

## 实现

- `SafeMarkdown` 稳定代码块身份，并仅分发 document Mermaid。
- `MarkdownMermaidBlock` 拥有请求序号、当前结果和用户视图偏好；候选图片先解码再提交。
- `mermaid-renderer` 统一串行、身份校验和整代重置；`mermaid-sandbox` 仅执行可信本地资源。
- 锁定 Mermaid 12.2.0 与 DOMPurify 3.4.17，使用 Vite 原生 asset URL 和动态 import，Desktop/Web 共用入口。
  HTTP 加载 nonce 经典脚本；Desktop 读取同一资源后置入 nonce 页面壳。正式宿主 CSP 保持不变。
- `PreviewImage` 从原图片 Viewer 提取，复用缩放、尺寸和错误处理，溢出区域由可聚焦滚动容器承接。

## 验证

定向 Vitest 覆盖精确分发、源码保留、引擎串行、超限、加载失败重试、超时后结算当前及排队任务、伪造与迟到响应。
`pnpm test:markdown-mermaid` 使用同一生产组件的正式 Vite 构建，在 HTTP 浏览器与 Electron file 入口检查：
flowchart、graph、sequence、class、state、ER、中文、宽图、长图和坏图；大图键盘/滚动/焦点；源码选择保持、
复制与文件查找；图片解码失败、实例丢失后手动重试、过期候选及卸载 URL 回收。

HTTP 夹具沿用正式 Host CSP。网络验收使用可达的受控 HTTP 地址，包含图中图片、HTML、CSS、click、frontmatter 和 init 覆盖输入，
不使用网络 abort/断网替代产品边界。此夹具不启动 Core 或真实 Runtime。

### 正式入口与回归结果（2026-11-02）

`pnpm accept:markdown-mermaid` 在 macOS arm64 ad-hoc 安装产物中启动独立 userData/Skill 目录，
从真实项目目录打开同一篇混合文档；随后登录该安装包 Host 自带的 Web UI，重复文档与大图操作。
两端均有 8 张正常图和 1 张局部失败图，中文、源码切换及大图正常；Desktop 主题切换和文件监视刷新保留
源码选择。实际安装产物没有连接日常数据或启动模型 Run。这是 macOS Desktop 与 Chrome Web 验收，
不等同于 Windows/Linux 整机验收。

- 真实 Mermaid 专项：Web（正式 CSP）与 Electron file 两端通过；常见图种逐一检查 SVG 文本标签。
  恶意输入从引擎渲染到最终图片展示全程观察可达服务器，外部资源请求为 0。
- 类型检查通过；Vitest 262 个文件、3058 项通过，2 项跳过。
- 默认 Node 测试 365 项通过，2 项跳过；文档测试 10 项通过；Skill 与 Electron sandbox 能力门禁通过。
- `pnpm test:rust:pr` 最终全量通过（484 项，1 项忽略）。初次进程回收测试失败，定向及全量复跑均通过。
- 原代码复制浏览器回归通过。原文件布局浏览器回归在宽表格滚动断言失败；将 SafeMarkdown、FilePreviewPane、
  styles 与语言资源恢复为基线 `277b562f1` 后，同一测试仍在同一断言失败，记录为既有问题，未改动其断言。
- 文档版本及 Decision 治理门禁在包含本次变更的干净索引快照通过。本机被忽略的 `docs/prototypes/` 有历史
  断链，直接运行 `pnpm test` 会先在文档扫描处停止；保留这些本地文件，未为本功能增加检查例外。

### 资源体积

首屏为 HTML 直接引用的 JS/CSS 未压缩字节合计，基线为 `277b562f1` 的本地构建；
异步资源为本地 Mermaid、DOMPurify、启动入口及加载模块。未出现 Mermaid 的文档与 message 模式不请求这些资源。

| 项目 | 改动前 | 改动后 | 增量 |
| --- | ---: | ---: | ---: |
| Desktop 首屏 | 9,325,030 B | 9,340,316 B | +15,286 B |
| Web 首屏 | 5,495,072 B | 5,503,068 B | +7,996 B |
| Desktop Mermaid 异步资源 | 0 B | 5,530,908 B | +5,530,908 B |
| Web Mermaid 异步资源 | 0 B | 5,530,299 B | +5,530,299 B |
| 本地目录型 App | 602,952,399 B | 619,578,783 B | +16,626,384 B |

App 使用改动前本地安装产物和本次完整重打包产物比较，包含打包元数据差异，是目录原始文件汇总，
不是 DMG 压缩增量。安装包包含 Desktop、Web 和执行控制台三份构建输出，因此按需加载不等于安装包减重。
执行控制台仍只使用 message 模式，不请求或执行图表资源。

可复现命令：`pnpm test:markdown-mermaid`、`pnpm package:mac`、`pnpm accept:markdown-mermaid`。
设置 `ROVAI_MERMAID_OUTPUT` 可保存两端文档、宽/长图、窄屏截图及 JSON 验收结果。
