---
document_type: implementation-plan
version: v0.37
authority: implementation-status
status: complete
last_updated: 2026-08-04
---

# v0.37 实施与验收计划

## Checkpoint 1：权威与 schema

- [x] 接受 ADR-0103/0104，并标注 ADR-0018/0065/0088 的局部替代关系。
- [x] 冻结 v0.37 架构与 UI 合同，区分原型参考和 Arctic Dawn 生产权威。
- [x] 实现 duplicate-key rejecting schema v2、稳定 serverId、Assignment、CAS 与原子文件。
- [x] 文件缺失时原子创建 Context7、Playwright 两个 disabled/unassigned reviewed defaults；不实现生产 v1 migration。

## Checkpoint 2：Core API 与 Import

- [x] Create/Update 改为恰好一个 `mcpServers` JSON entry，删除 split form contract。
- [x] 实现隐藏 metadata、sensitive preservation marker、rename/delete identity tests。
- [x] 增加 Assignment 即时 mutation 与 high-risk first-effective acknowledgement。
- [x] Import 结果统一 disabled/unassigned；tool policy/OAuth/trust/sandbox/unknown field 阻止。

## Checkpoint 3：Renderer

- [x] 按 v4 reference 和 Arctic Dawn 实现 Hero、Config disclosure、member tofu 与 Server tofu。
- [x] 完成 Add/Edit、Import Preview、Delete、Playwright risk Dialog。
- [x] 覆盖 Loading、No Member、Invalid、Permission、Conflict、Submitting 与 Recovery。
- [x] 通过 1440×920、1040×700、焦点回归、200% 等效宽度与 reduced-motion 验收。

## Checkpoint 4：Runtime Projection

- [x] AgentRun 冻结 Projection Input；最终 Exposure 记录 canonical/runtime name mapping 与降级。
- [x] Unsupported external assignment 不再阻止基础 AgentRun，Team Gateway 保持独立。
- [x] 八 Adapter 使用 exact replace/strict/private alias 实现 Rovai same-name precedence。
- [x] Claude/Copilot 只设置必要最低版本，无上限；只对明确 MCP config rejection retry 一次。

## Checkpoint 5：测试与 Smoke

- [x] Core schema、atomic/CAS、sensitive、identity、Assignment、Import、projection tests 通过。
- [x] Renderer tests、typecheck、desktop build 与双尺寸真实 App 验收通过。
- [x] 八 Adapter 的 exact/private/alias 命令与 canonical/runtime mapping 结构测试通过。
- [x] Same-name native/Rovai marker 的八 Runtime 真实 AgentRun smoke 全部通过。
- [x] Context7、Playwright isolated 使用真实 MCP。
- [x] `cargo test --workspace`、clippy、format、`pnpm test` 与 `pnpm typecheck` 全部通过。

## Checkpoint 6：Runtime-group Skill delivery

- [x] 实现应用级 Skill Library、不可变 Revision、官方/本地/GitHub 导入和全局启停。
- [x] 实现九个 Delivery Group Assignment、Runtime 映射、成员派生视图与设置页控制。
- [x] 实现受管 symlink、shadowed/duplicate observation、活跃 Run 稳定与硬删除回收。
- [x] 九种 Product Runtime 均以私有 marker 完成真实原生 Skill discovery smoke。

## 实施说明

真实 Runtime/MCP Smoke 只在开发流程执行，不在设置页或用户启动路径增加 synthetic probe。
完成证据写回本文件后才允许把 v0.37 标记 complete。

### 2026-08-04 本机验收证据

- `scripts/capture-mcp.mjs`：真实 packaged Electron 完整操作链通过；1440×920、1040×700、
  520×700（200% 等效宽度）均无横向或 panel overflow，reduced-motion 生效。
- `scripts/smoke-mcp-projection.mjs`：Codex 0.146.0、Claude Code 2.1.212、OpenCode 1.18.10、
  Copilot 1.0.78、Kiro 2.15.1、Qoder 1.1.14、CodeBuddy 2.132.0、Qwen Code 0.21.1 均在同一
  AgentRun 中面对 Runtime 原生与 Rovai 投影的同名 `rovai_smoke`；八次工具结果均为
  `rovai-projection:*`，无 `runtime-native:*`。Copilot 同时验证 private runtime alias。
- `scripts/smoke-skills.mjs`：九种 Product Runtime 均从各自项目原生目录读取只存在于受管
  Skill Revision 的随机 marker；OpenCode 使用 MiMo V2.5 Free，Qoder、CodeBuddy、Qwen 使用
  DeepSeek V4 Flash。
- `scripts/smoke-mcp-presets.mjs`：Context7 3.2.5（2 tools）与
  `@playwright/mcp@0.0.78`（24 tools）真实 initialize/tools-list 通过。
