---
document_type: runtime-research
runtime: cline-cli
authority: research-evidence-only
status: source-audited
last_updated: 2026-10-07
---

# Cline 新版本 ACP Compaction 配置核对

**结论：截至 2026-10-07 04:48 UTC，单纯升级最低 Cline 版本不能解决这处缺口。**
官方 npm `latest` 是 **3.0.68**；3.0.66、3.0.67、3.0.68 和本次固定的 `main`
均未向 `AcpAgent.buildConfig()` 补入 `compaction`，普通 ACP Session 的下游也没有
默认启用补偿。这是上游源码核对，未安装或运行这些新版本，不能替代真实 Runtime 验收。

本次回应 User 消息 `13c99703-c15d-4789-8023-04a0476f472e`。只读取官方 npm 元数据及
GitHub 固定提交文件；完整时间、提交、文件摘要和证据边界保存在
[证据 JSON](upstream-compaction-version-audit-2026-10-07.evidence.json)。

## 版本与固定来源

| 对象 | 固定提交 | `buildConfig().compaction` |
| --- | --- | --- |
| [3.0.65 基线](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/apps/cli/src/acp/acpAgent.ts#L761-L809) | `9131e36429314ea614491bf749678adbacb3d3cb` | 缺失 |
| [3.0.66](https://github.com/cline/cline/blob/20d70ceed8b749f9350bc8c573a81faaa236b289/apps/cli/src/acp/acpAgent.ts#L761-L809) | `20d70ceed8b749f9350bc8c573a81faaa236b289` | 缺失 |
| [3.0.67](https://github.com/cline/cline/blob/9087191126d43c4123965501d5c2e1b9bb4dca90/apps/cli/src/acp/acpAgent.ts#L761-L809) | `9087191126d43c4123965501d5c2e1b9bb4dca90` | 缺失 |
| [3.0.68，当前稳定版](https://github.com/cline/cline/blob/241c1884a7461ef35f6c384a027a38e8d03b3b33/apps/cli/src/acp/acpAgent.ts#L761-L809) | `241c1884a7461ef35f6c384a027a38e8d03b3b33` | 缺失 |
| [本次 `main`](https://github.com/cline/cline/blob/5dea21ab89f7d5a719a532a07f7d13db37a68bd8/apps/cli/src/acp/acpAgent.ts#L761-L809) | `5dea21ab89f7d5a719a532a07f7d13db37a68bd8` | 缺失 |

版本事实来自 [npm 官方 registry](https://registry.npmjs.org/cline)；稳定版发布信息见
[CLI v3.0.68](https://github.com/cline/cline/releases/tag/cli-v3.0.68)。npm 发布时间是
2026-10-02 04:43:12 UTC。另有 `nightly` 标签，但本次没有检查 nightly 发布制品；
`main` 源码结论只绑定上表提交，不视为 nightly 二进制验收。

五个固定提交的整个 `apps/cli/src/acp/acpAgent.ts` **逐字节相同**，SHA-256 均为
`39f68873abc43f80a858dbdbdfb7b6d3f3d29fb7fdf96157d229c7a71084a165`。
因此没有只凭 Release Notes 未提及修复而下结论。

## 调用链核对

以下行号固定在 3.0.68；证据 JSON 同时记录其他版本的文件摘要。

1. [`main.ts` 的 ACP 分支](https://github.com/cline/cline/blob/241c1884a7461ef35f6c384a027a38e8d03b3b33/apps/cli/src/main.ts#L818-L827)
   只传递明确的 auto-approve 选项，启动 ACP 后直接返回。普通 CLI 后面的
   `buildCliCompactionConfig(effectiveCompactionMode)` 配置构建不进入这条路径；
   仅添加普通 CLI 的 compaction 参数不能据此补上 ACP 配置。
2. [`ensureSessionManager()`](https://github.com/cline/cline/blob/241c1884a7461ef35f6c384a027a38e8d03b3b33/apps/cli/src/acp/acpAgent.ts#L689-L754)
   调用 `buildConfig()`，然后将配置展开传给 `sessionManager.start()`；没有增加 compaction。
3. [上游 Bootstrap](https://github.com/cline/cline/blob/241c1884a7461ef35f6c384a027a38e8d03b3b33/sdk/packages/core/src/services/local-runtime-bootstrap.ts#L526-L569)
   保留输入配置并补 Provider/System 等字段，没有补 `compaction.enabled`。
   [上游本地 Runtime](https://github.com/cline/cline/blob/241c1884a7461ef35f6c384a027a38e8d03b3b33/sdk/packages/core/src/runtime/host/local-runtime-host.ts#L677-L711)
   将这份配置传给 `createContextCompactionPrepareTurn()`。
4. [压缩回调工厂](https://github.com/cline/cline/blob/241c1884a7461ef35f6c384a027a38e8d03b3b33/sdk/packages/core/src/extensions/context/compaction.ts#L267-L298)
   在 `userCompaction.enabled !== true` 时直接返回 `undefined`。该文件在五个提交也完全相同，
   SHA-256 为 `50534c940f999797fbe5cacf821739ff99d81610e042aab9c9269ee15dedc696`。

据此，普通原生 ACP Session 的自动压缩/overflow recovery 回调仍缺少启用配置。
上游另有 imported-history 的一次性压缩和已有 compaction sidecar 的投影分支；本结论
不外推为所有历史来源、插件、入口或未来版本都不可能压缩。

## Rovai 后续判断

- 本轮不提高最低 Cline 版本，也不修改 Rovai Host、Runtime 配置或原生 Session。
- 仍需上游修复 ACP 的 compaction 配置传递。候选修复应复用现有 CLI 配置解析，明确默认值及
  `off/basic/agentic` 行为；这里只定位缺口，尚未提交上游 Issue/PR，也没有证明候选修复已通过。
- 上游发布修复后，先在隔离环境验证 threshold、overflow recovery 和首次/warm/cold 的 System
  连续性，再以实测通过的版本调整最低版本。仅源码出现字段不足以宣布完整 compaction 通过。
- 现有真实运行证据仍只覆盖 [3.0.65 零干预验收](native-compaction-2026-10-07.md)：
  最高成功 input 918,618，真实 overflow 后未压缩，cold 继续生成失败；分类仍为
  `native_compaction_not_observed`。本轮没有追加模型请求或改写该历史结论。
