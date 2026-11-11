---
document_type: implementation-record
version: v1.72
status: implemented-preview
last_updated: 2026-11-10
---

# Kilo 逐模型推理选项接线

User sequence 43/44 要求接通其他模型的推理强度。基线为 `02629b36fa3b8e255bb0ff042bebb80695903aec`，
继续使用 `rovai/kilo-acp` worktree。此前[原生核对](kilo-auto-compaction-and-options.md#模型选项原生能力与当前目录范围)
已经证明官方 Kilo 可以返回其他模型的选项；本次补的是 Rovai 的目录发现，权限和模型输入保持。
当前可测试语义见 [Launch v83](../../contracts/runtime-launch-and-verification-v83.md)。

## 实现范围

- 完整目录请求沿用 MiniMax 的临时 ACP Session，逐个选择模型并读取它实际返回的选项；
  Kilo 使用 `effort`，MiniMax 保持 `thinkingEffort`。两者共用收集与投影，不再保留两段近似映射。
- 初始模型直接使用首次返回的选项和当前值，省去一次选择，也避免重新选择重设该默认值。
  其余模型结束后恢复临时 Session 的初始模型；不改用户全局默认、成员配置或执行 Session。
- 没有选项的模型保持空，原生拒绝选择或返回其他模型的候选保持未知；不套用其他模型档位，
  单个候选异常不会丢弃已经取得的有效目录。
- 普通健康检查不遍历。Kilo 接入 MiniMax 已有的完整目录成功时间和请求意图区分，
  防止只观察初始模型的健康结果覆盖完整选项。沿用既有失效、缓存与超时，无新表、管理器或私有队列。
- 队员设置和引导入口继续消费共同 `ModelDescriptor`，无需生产 Renderer 修改。
  显式选项的保存、冻结、未知值保留和原生 setter 沿已有规则。

## 验证与边界

扩展两个既有 Rust owners，新增 Rust 测试函数为零：

- `grouped_acp_models_keep_opaque_provider_routes_and_reject_empty_catalogs`：
  两个 Adapter 的独立档位、原模型默认、明确空选项及未知候选。修改前因其他模型选项为空失败，修改后通过。
- `minimax_check_and_catalog_keep_their_intent_and_complete_options`：
  MiniMax 2/8 模型与 Kilo 3 模型，真实私有 Core/DB/ACP 进程、检查与目录并发、恢复原模型、
  不可选候选、零生成，以及健康检查不覆盖完整目录和失效时间。
  首轮扩展暴露 Kilo 健康结果仍被标成完整目录，补齐既有完整性路径后通过。

现有生产 Core smoke 使用未补丁官方 **7.8.27**、macOS arm64、本地受控 Provider：

| 场景 | 实际结果 |
| --- | --- |
| 初始模型 | `local/local-model` 的 low/high，仍为原生默认 |
| 其他模型 | `local/local-other` 的 medium/max，没有复制前者档位 |
| 无 variants 模型 | `local/local-plain` 的 options 为空 |
| 完整目录 | 1,754 ms，Provider 生成请求 0 次；该时间仅为本夹具观察 |
| 执行其他模型 Max | 请求的模型及 temperature=0.9 与原生 variant=max 对应，冻结历史为 max |
| 执行无档位模型 | 原生使用 plain 模型，没有残留 variant，冻结历史无 effort |
| 原矩阵 | 32 个 Run：30 成功、2 主动取消；前台 task、输出预算、权限、无 Node MCP、文件、Steer、自动压缩和冷恢复继续通过 |
| 输入与清理 | 52 个普通模型请求逐字保留当时的完整 Bootstrap；Core 正常退出，本次 Runtime 文件清理成功 |

实际选择器集成测试使用生产组件，队员设置和引导两个入口分别选择模型 A/B，
验证 Low/High 与 Medium/Max、保存 `effort=max`、默认选项和无档位模型；两入口通过。
截图仅来自独立测试壳，不属于真实开发 App 的人工点击验收。
所有 Core、Skills、MCP、HOME 和 Runtime 数据使用新建隔离目录，日常配置与账户未使用。
结果见[白名单证据](../../research/kilo-runtime/model-options-7.8.27-macos-arm64.json)。

本次没有付费模型调用，不证明所有 Provider 的 variants 语义，也不扩大其他平台或版本资格。
模型和推理强度的选择方式已对齐共同 UI；协议、原生权限规则和平台资格仍有各自边界。

## 回归门禁与基线对照

默认 `cargo test --workspace` 为 **484 通过、1 忽略**；两个扩展 owners、平台证据 owner 5 项、
选择器集成、typecheck、Desktop build 及通用文档门禁通过。
`TZ=UTC pnpm test` 的 Renderer **3,193 通过、2 跳过**，Node **377 通过、2 跳过**。
首次使用本机 Honolulu 时区时，关于页的两个固定日期断言比预期早一天；未修改这些无关测试或页面。

扩展 `cargo test -p rovai-core --features slow-tests --lib catalog` 得到 **44 通过、6 失败、1 忽略**。
使用基线 `02629b36` 的独立源码及独立 APFS 构建目录逐项对照：

| 失败项 | 基线对照 |
| --- | --- |
| Codex `codex_catalog_waiters_share_refresh_without_satisfying_full_validation` | 同样断言进程数 1 与 2 不符 |
| Pi `pi_catalog_observations_are_independent_of_health_and_fenced_by_identity` | 同样得到 Ready，预期 StableFailure |
| 历史 v104/v105/v107 catalog migration | 同样在原 `group_key` CHECK 约束失败；本轮没有修改迁移代码 |
| Claude `claude_catalog_prefers_list_models_and_falls_back_only_when_unsupported` | 并行回归的 oversize 夹具找不到 `sleep/head/tr`；基线和本轮各自单跑均通过 |

前五项由改动前基线复现；上述广域回归没有宣称全绿。对照源码与独立构建目录已删除，
失败日志保留于本次私有诊断，公开证据只记录用例和结果。

## 权限的直白解释

权限控制读写文件、执行命令等工具活动是直接执行、询问还是拒绝。Kilo 成员设置改变默认规则，
原生具体规则继续生效：例如默认 allow，但 Kilo 配置明确 deny 某条删除命令，该命令仍拒绝。
短 config 回调只保持默认规则在具体规则之前，由 Kilo 自己判断，没有第二套 Core 权限求值器。
Claude 使用自己的 permission mode；Codex 使用 sandbox/approval 参数。目的相近，原生选项和优先级不同。
