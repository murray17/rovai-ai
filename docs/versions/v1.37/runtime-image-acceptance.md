---
document_type: implementation-evidence
version: v1.37
authority: observed-runtime-image-results
status: partial
last_updated: 2026-08-31
---

# Runtime 图片补齐与本机验收

## 执行边界

使用 macOS arm64 本机已安装 CLI 与队员的 Runtime/模型/角色配置，在全新临时 Core data-dir、Skill Library、
MCP 配置和项目内创建隔离 Camp；仅只读查询日常队员配置，没有复制日常 SQLite、改写登录态或重启日常 App。
Copilot 没有对应的现有队员绑定，使用隔离队员副本与该 Runtime 原生默认配置；日常绑定未变。
真正调用了模型与图片工具，不将协议 fixture 或 assistant 的“成功”文字当作图片展示证据。

## 已观察到的结果

| Runtime / 本机构建 | 真实执行结果 | Rovai 图片结果 |
| --- | --- | --- |
| Codex 0.151.0 | 原生 imageGeneration 生成 PNG | 1 张，Core 入库和读取通过；inline 保存 Blob |
| Antigravity 1.1.22 | 原生 generate_image 生成 JPEG | 1 张，Core 入库和读取通过；稳定路径零拷贝 |
| Claude Code 2.1.236 | Read 返回 3 个结构化图片结果，模型端同时报告图片识别限制 | 3 张可读取；这证明结果接入，不证明所配模型的视觉理解成功 |
| OpenCode 1.18.20 | 真实读取图片，返回标准 ACP Image | 1 张，Core 入库和读取通过 |
| TRAE 0.120.52 | 真实读图；标准 content 为空，图片在 rawOutput.Output | 修复前 0 张，补齐后同队员配置复测 1 张，Core 入库和读取通过 |
| Copilot 1.0.79 | 真实 view_image；图片在 binaryResultsForLlm | 补齐后隔离 Core 1 张，入库和读取通过 |
| Qwen Code 0.22.3 | 模型能描述图片；ACP 只返回文字说明与 `Read image file: …` 字符串 | 未返回图片 bytes/结构化图片结果；不把文字路径或 rawInput 升格为图片来源 |
| CodeBuddy 2.133.1 | 本机 Read 将 PNG 按文本读，返回 UTF-8 错误 | 未取得图片结果，不宣称该配置读图成功 |
| Kimi Code 0.39.1 | 本机工具集未暴露 ReadMediaFile；Read 拒绝非文本 | 未取得图片结果，不改变 Runtime 模型/能力配置 |
| Grok Build 1.0.13 | 本机 read_file 对 PNG 返回 UTF-8 错误 | 未取得图片结果；标准 ACP 图片接收路径仍保留 |
| Kiro 2.20.1 | 本机所配模型在 Prompt 返回 `ACP error -32603: Internal error` | 上游运行失败，无图片；未以猜测原因或换模型掩盖失败 |
| Qoder 1.1.28 | 本机所配模型返回 `ACP error 500: unknown error (1000)` | 上游运行失败，无图片 |
| Cursor 2025.09.18-7ae6800 | 本机旧 CLI 不支持 ACP | 未运行图片 Prompt、未升级；非标准通知仍未取得真实成功 fixture |

这不是“十三 Runtime 都能原生生图”的承诺。通用 ACP 图片支持和每个 CLI/模型当前实际具备的图片工具是两层。
本轮只有 Codex 与 Antigravity 做了真正的原生生图；其他成功项是实际工具图片结果传递。

六种成功 Runtime 的 8 份 Core 图片读取结果，均在生产 `ImageGallery` 组件中完成 Chromium 真实解码、
缩略图显示与大图打开。每张图片使用独立 identity 重新挂载，核对对应图片名称并截图，避免缓存假阳性；
Antigravity 生成图已人工检查截图。Camp snapshot 不含图片 bytes，读取仍经过专用 Core 图片接口。

## 由实测决定的适配

- Antigravity stream-json 的完成事件确实没有结果路径。只读本子进程 loopback 的
  `GetCascadeTrajectorySteps`，以当前 conversation/step 对齐 `generateImage.generatedMedia`；
  不从 final、工具输入、transcript 文本或 brain 目录取得路径。请求/失败不改变模型 Context、Run 或账号状态。
- TRAE 仅读取该 Adapter 的 builtin `rawOutput.Output.{content,mime_type,file_path}`；Copilot 仅读取
  `rawOutput.binaryResultsForLlm[]` 的 Image。两者复用原 ACP 累积、稀疏终态及 Run/epoch fence。
- Claude 结构化 stdout 的图片帧不再受 2 MiB 文本日志上限误伤；帧预算有界，超大帧跳过后继续读取终态。
- 三份最小真实 wire shape 位于 `crates/rovai-core/tests/fixtures/runtime-images/`。
  Session/trajectory/tool identity、路径与图片内容均脱敏替换；没有提交 Prompt 全文、私有日志或凭据。

规范由 [Runtime Images v2](../../contracts/runtime-images-v2.md) 拥有；不改变既有平台准入、Session 兼容轴或渠道能力。

## 回归 owner

- 扩展 `agent_run_image::tests::adapters_accept_only_structured_results_not_paths_in_text_or_inputs`：
  三个 vendor fixture、跨 vendor 拒绝、精确 step/session、成功状态、空/同时存在的 inline/path、稀疏终态与去重。
  输入矩阵由纯解析 owner 承担，不增加 SQLite fixture。
- 新 `antigravity::tests::completed_image_step_queries_once_and_api_failure_does_not_fail_the_run`：
  本机受控 TCP 端点验证精确请求、一次查询、内部图片与公开 action 分离、重放和 API 失败继续完成；
  这是新 transport seam，不能由纯解析测试代替，不启动真实 Runtime。
- 新 `claude::tests::image_frame_larger_than_the_log_budget_preserves_the_terminal_result`：
  在真实 stdout framing 中喂入超过旧 2 MiB 上限的图片包并验证独立终态；原纯 JSON parser 测试不能覆盖该层。
- 现有隔离 Electron Gallery fixture 增加可选的真实 Core 读取结果输入，复用生产组件和真实 Chromium decode、
  lightbox；每份结果重新挂载，避免前一张图片缓存造成假阳性。默认离线测试不依赖本机 Runtime、图片或账号。

最小命令：`cargo test -p rovai-core --lib agent_run_image`、上述两个 Core binary test owner，及
`node --test scripts/lib/runtime-image-gallery.test.mjs`。

## 本轮最终验证

- `cargo test --workspace --quiet -- --test-threads=2`：687 项通过（lib 468 / CLI 32 / Core 187），
  4 项既有人工 Runtime smoke 保持 ignored。
- `cargo clippy --workspace --all-targets --features slow-tests -- -D warnings`、`cargo fmt --all --check` 通过。
- `pnpm typecheck`、`pnpm exec vitest run --maxWorkers=2`（132 文件 / 1280 项）、`pnpm build:desktop` 通过。
  首次默认并发运行出现既有 Core 启动重试计时测试超时，降低并发后完整重跑通过；未修改测试或放宽阈值。
- 隔离生产 Gallery 测试通过，包含上述 8 份真实 Core 图片结果、双主题、窄屏、解码失败与大图交互。
- `pnpm docs:test`（9 项）、`pnpm docs:check`、以
  `cda0585233b1a8957e5aada34335f879ecde7af8` 为显式 main base 的 `pnpm docs:check:ci`，以及
  `git diff --check` 通过；没有新增治理例外。

原生 Runtime 与验收 Electron 均已退出，日常 App/Core 未重启。代码尚未提交、推送、打包或安装；
没有将验收图片发送到飞书，也没有改变 DingTalk。
