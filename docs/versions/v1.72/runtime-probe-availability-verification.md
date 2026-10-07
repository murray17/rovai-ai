---
document_type: verification-record
version: v1.72
authority: implementation-evidence
last_updated: 2026-10-06
---

# Claude Code 模型发现与 Runtime 探测可用性验收

范围以用户于 2026-10-06 确认的最小实现为准。当前行为由
[Runtime Launch v48](../../contracts/runtime-launch-and-verification-v48.md#模型发现与探测容量)与
[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md#claude-code-原生模型目录)拥有。
分支 `rovai/runtime-probe-availability`，基线 `be63b5a3b98669036ca476b216cef5007acf99fb`。

## 实现

- 共享读取器删除历史累计限制，单帧默认 64 MiB，Core 环境变量可调。只保留当前帧，按需扩容；
  stderr 保持原有摘要和持续消费，超限／失败／超时／取消由现有 ManagedProcess 回收。
- Claude 优先 list_models，只有匹配请求的明确 unsupported 才回退 initialize，不增加缓存或重试。
  借用响应路由和原始 payload，跳过无关初始化元数据，保留模型 ID、别名及原生元数据。
- 正式 Claude 握手不再依赖目录成员校验；模型和 effort 原样传递，不能传递的选项明确拒绝。
  现有成员保存、冻结、默认选择和缓存保留机制继续复用；目录刷新保留安全失败原因。
- 同类隐藏上限证据：ACP、Codex 初始化／模型查询复用同一读取器；Codex 原生 config/read 还曾传入
  1 MiB 累计／256 KiB 单帧。调用点统一，其他文件、图片和独立 Runtime 输出边界未调整。

## 测试 owner 与准入

| Owner | 原先失败输入与覆盖 | 最小命令 |
| --- | --- | --- |
| runtime_probe_process 既有边界 owner | 300 KiB、1 MiB、4 MiB + 1、64 MiB - 1／等于／+ 1；多帧累计 5 MiB；UTF-8、CRLF 各分块；无换行无限源；配置增大／无效 | `cargo test -p rovai-core --lib runtime_probe_process::tests::` |
| health::claude_catalog_tests 既有进程 owner | 首选 list_models、明确 unsupported 回退、错 ID、认证拒绝不回退、双路径超时、EOF、坏 JSON、交互拒绝、大帧／大量 stderr、父子进程回收 | `cargo test -p rovai-core --lib --features extended-tests claude_catalog_prefers_list_models` |
| claude 正式启动既有进程 owner | 默认与显式配置、新建／恢复、Fast 各状态；initialize 缺目录／空目录／不同 ID 时仍准确传递模型、effort 和 Prompt，原生 529 仍报告 | `cargo test -p rovai-core --lib --features extended-tests nonzero_exit_with_empty_stderr` |
| claude_model_effort 新纯函数 owner | 无目录时未知键、非字符串／空／控制字符不得被静默丢弃；未来 effort 字符串保留 | `cargo test -p rovai-core --lib --features extended-tests model_options_must_be_transmittable` |
| agent_profile 既有配置 owner | 已有 Claude 配置在目录失败后仍可原样保存、冻结和 dispatch；不伪造健康证据 | `cargo test -p rovai-core --lib --features slow-tests discovered_entry_configures` |
| 既有 Renderer owners | 无目录保留 ID／选项并可保存、用户可选默认、缓存明确标记；目录错误不宣称 CLI 执行失败 | `pnpm exec vitest run apps/desktop/src/renderer/src/MemberRuntimeParameters.test.ts apps/desktop/src/renderer/src/RuntimeFailureNotice.test.ts` |

除选项传递前置校验的新纯函数 owner 外均扩展既有测试。新 owner 拥有独立的“不可传递输入不得静默丢弃”
合同，原目录校验退出后不能由旧枚举测试代替；不建立额外数据库／进程 fixture。
进程 fixture 必须证明 request_id、stdin/argv 和真实进程回收，纯解析测试不能替代。

## 环境证据

| 环境 | 状态与证据边界 |
| --- | --- |
| macOS arm64 / Claude Code 2.1.280 | Rovai 真实探测 smoke 通过，返回 5 个可选模型。独立无 Prompt 查询：直接 list_models 响应 1518 字节；initialize 响应 19102 字节。未知 subtype 明确返回 `Unsupported control request subtype: …`。 |
| macOS arm64 / Claude Code 2.1.206 | 从官方 npm 包解压至临时目录，独立无 Prompt list_models 成功（4 个模型，1165 字节响应）；不据此假定版本阈值。 |
| macOS arm64 / Claude Code 2.1.100 | 旧协议实测通过：list_models 明确返回 `Unsupported control request subtype: list_models`，以新 ID 回退 initialize 后得到 5 个模型（9623 字节响应）。同一临时入口的 Rovai 真实探测 smoke 也通过。 |
| macOS arm64 / Claude Code 2.1.0 | 无 Prompt list_models 在独立 15 秒观察期内没有匹配响应，主动结束并回收；未将超时视为不支持，也不声称该版本模型发现已通过。 |
| 旧协议受控进程 | 兼容回退、回退后拒绝／超时、错 request_id、超限和大初始化元数据均通过；受控进程测试不等于所有旧版本均实测。 |
| Windows x64 / Claude Code 2.1.289 | 未实测。本机是 macOS；跨平台读取器和 Windows 专属进程测试不能冒充该环境实机通过。 |

本次自动验收使用 task worktree 的独立依赖和 target，数据库与假 Runtime 使用临时 fixture；不启动日常 App/Core，
不改日常 userData、Skills 或原生配置。旧 CLI 仅从官方 npm 包解压至临时目录，禁用自动升级，保留用户实际环境；
不替换本机安装。没有真实付费任务证据，不宣称模型推理成功。

## 验证结果

- `cargo test --workspace`：454 passed、1 ignored；默认测试的既有 Migration fixture dead-code warnings 保留，未进行无关清理。
- `cargo check --workspace`、`cargo fmt --all --check`、`git diff --check`：通过。
- 读取器 owner：5 passed。扩展 `claude::tests::`：34 passed；`health::`：24 passed、3 个手动 smoke ignored。
- slow-tests 配置保存／冻结／派发 owner：1 passed，确认过滤命令实际执行该测试。
- `claude_catalog_real_runtime_smoke --ignored`：2.1.280 和 2.1.100 分别通过，各 1 项。
- `pnpm test`：通过；其中 Vitest 238 个文件、2603 项，最终 Node 组合 334 passed、2 个 Windows 专属项目 skipped。
- `pnpm typecheck`：通过。Impeccable detector 对本次错误标题组件未报告问题；未改布局或增加控件。
- `pnpm docs:test`、`pnpm docs:check`、指定基线的 `pnpm docs:check:ci`：通过。

Windows x64 / Claude Code 2.1.289 仍需该环境单独验收：大初始化响应、模型目录刷新失败后的保存／启动、
超时和取消的 Windows 进程树回收。这里的 macOS 结果不替代该验证，不声称 Windows 问题已经实机闭环。
