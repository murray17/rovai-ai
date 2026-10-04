---
document_type: runtime-research
authority: research-evidence-only
observed_platform: macos-arm64
last_updated: 2026-10-05
---

# Command Code / Cline：文件名、编辑与 Context 上限复核

按 User 消息 `8d1f48b1-365c-4db4-ab8b-7ce829acee3a`，继续核对原生字段、真实文件副作用与
产品投影。此前开发包中的叮叮、芝士都使用 Cline；Command Code 另以独立 Home 的真实原生 CLI
验证，仍没有 Product AgentRun/App 资格。本轮不改变模型上下文投递、原生配置的容量或准入等级。

## 原生证据与缺陷

两者的真实工具事件都有目标路径，之前未完整映射到对应公开字段。

| Runtime | 读取来源 | 编辑来源 | 实际缺陷与修复 |
| --- | --- | --- | --- |
| Cline 3.0.65 ACP | `rawInput.files[0].path` | `rawInput.input` 中原生 `*** Update File:` / `*** Add File:` 头 | 旧 profile 把读取路径补到 `filepath`，但共享 ACP 的 read completion 只接受 `locations`；编辑只补 kind。现在同 ToolCall 配对成功 typed result 后投影唯一 `locations`，沿既有 File Operation 合同入库展示 |
| Command Code 1.66.0 NDJSON | `read_file.input.file_path` | `edit_file.input.file_path`，以及 `old_string/new_string` | 旧 normalizer 只保留 kind，丢弃路径。内部 transport 现保留独立 `filePath`，不把文件正文或替换内容放进普通 input/output；这不是 Command App 展示证据 |

Cline 的 ACP `completed` 可能包裹 `success: false`，因此 read/apply_patch 和既有 command 一样核对
原生 Boolean。失败或缺少确认不会生成成功文件操作。只在成功后补路径，不让开始事件的候选路径
被稀疏终态误继承。单文件补丁头来自原生输入语法，不从最终回复或截断 title 猜文件。
多文件、移动、删除、缺少严格补丁边界的输入保持通用工具展示；本次没有发明完整 before/after Diff
或增删行数。既有 `activity-v4` 分类、操作 ID 和历史投影规则不变，不回填旧记录。

Command Code 的真实编辑还发现独立的 headless gate：仅传 `--permission-mode yolo` 会返回
`tool_hook_blocked`，提示需要 `--yolo`，文件保持原样；顶层 `result.success` 不代表工具成功。
为已经选择 Yolo 的运行补齐原生 `--yolo` 后，原生 edit_file 成功，读回 `answer = "after"`，
`keep = 37` 不变。DontAsk 不添加该开关，也没有修改任何原生全局权限配置。

## 上下文上限

不能把本次未知解释为这两个 Runtime 永远不可能提供窗口。

- Command Code 的本次 `model_request_start/end`、终态 usage 只有已观察到的消费桶，没有窗口或比例。
- Cline 的[原生 ModelInfo](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/sdk/packages/shared/src/llms/model-info.ts)
  支持可选 `contextWindow`；但本次 `gpt-6-sol` 原生 models catalog 与 provider 配置没有填写。
  [afterModel 的模型身份](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/sdk/packages/core/src/runtime/config/agent-runtime-config-builder.ts)
  只提供 id/provider/family，不包含容量，不能认为已自动采集模型目录。
- 同一已授权 sub2api endpoint 的 `/models` 返回 200、17 项；没有 `gpt-6-sol` 的精确模型元数据。
- Cline 的[压缩输入预算回退](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/sdk/packages/core/src/extensions/context/compaction-shared.ts)
  是内部策略，不等于服务端总窗口，不能拿它或模型名字补一个分母。

因此当前实际模型的 Context used 可采集，window/ratio 继续 `null`。未来读取明确原生窗口时，仍须按
[Execution Metrics v7](../../contracts/runtime-execution-metrics-v7.md)核对实际模型、绑定与生效配置。

## 验证 owner

扩展既有 Cline observer/profile owner，覆盖读取、单文件更新/新增、中文空格、失败/缺字段、伪补丁头、
多文件、移动和删除回退；扩展共享 ACP completion owner 证明稀疏终态传递 read/write 路径且不伪造 Diff；
Command Activity owner 保留开始/结束文件路径和私有正文排除，transport owner 区分 Yolo 与 DontAsk argv。
没有新增独立 Rust 测试或数据库 fixture。

## 更新开发包后的真实发送

沿用此前的独立 Application/userData、官方完整 Cline 安装与两名成员配置。受控退出旧验收 App，
替换新构建后以相同隔离入口启动；日常 App 和全局 CLI 不变，Composer 原有草稿保留。
通过普通 `thread.messages.send` 分别触发原生 read_files → apply_patch → read_files，最后使用
bundled CLI 公开回帖。没有用 Shell 代替读取/编辑，也没有以模型口头描述代替文件检查。

| 成员 / AgentRun | 实际文件与结果 | 持久化与界面 |
| --- | --- | --- |
| 芝士 / `b0873386-3d0f-45e7-ae60-ebe989a62881` | `文件名验收37/芝士 edit.ts`；answer 从 before 改为 after，keep 保持 37；一条 `CHEESE_FILE37_OK` 回帖 | succeeded；3 条 typed read/write/read；文件变更 1 文件/1 操作；三行准确文件名，可点击预览修改后内容 |
| 叮叮 / `29de2abf-5373-4865-bb47-b4e115ca26d6` | `文件名验收37/叮叮 edit.ts`；同样只改 answer，keep 保持 37；一条 `DING_FILE37_OK` 回帖 | succeeded；3 条 typed read/write/read；文件变更 1 文件/1 操作；三行准确文件名，可点击预览修改后内容 |

两轮文件操作均来自持久化 `executionEvidence.runtimeFileOperation` schema 2，文件变更为
`operation_only`，不声称存在 Diff 或增删行数。芝士本轮 input 43,886 / output 474、最新 Context used
9,165；叮叮 input 29,856 / output 545、最新 Context used 6,355。两者 window/ratio 都为空。
脱敏原生字段、结果、App 投影、UI 文本和构建哈希见
[机器可读证据](command-cline-files-context-evidence-2026-10-04.json)；不包含认证配置或私有原始日志。

验证通过：

- `cargo test --workspace`：455 passed，2 个真实 Runtime Smoke 按默认配置 ignored。
- `cargo test -p rovai-core --features extended-tests --lib acp::tests::`：66 passed，1 ignored。
- Cline profile/observer owner：2 passed；Command Code owner：4 passed，1 ignored；共享 completion seam：1 passed。
- `pnpm package:mac:unsigned` 完成，构建产物和保留的验收 App 均通过 `codesign --verify --deep --strict`。
- 另行执行上述真实原生 CLI 与 App 模型验证，不以 ignored 单元测试充当真实验收。

本轮仍只证明当前版本、macOS arm64、当前模型与单文件路径。多文件/移动/删除保持回退，历史执行
记录不重投影；Cline Preview 与 Command Code 尚无 Product Adapter 的边界不变。

## Command Diff 与模型读取能力（2026-10-05）

User 消息 `77d69209-8b66-4b36-a429-a064a0b038c1` 指出的编辑行不能展开 `+ / −` 仍然成立。
上面的验收只完成文件名和副作用，没有完成 Command Diff，不应把 path-only 成功描述成编辑能力全量通过。

| 层次 | 实际证据 | 当前结论 |
| --- | --- | --- |
| Cline 编辑输入 | 同 ToolCall 的 `rawInput.input` 含 `-export const answer = "before";`、`+export const answer = "after";` | 模型发出了补丁，Rovai 也收到了原生输入；不是无法读取 `+ / −` |
| Cline 编辑终态 | `rawOutput = {query: "apply_patch", result: "Successfully applied patch…路径", success: true}` | 没有 ACP Diff content、oldText/newText、structuredPatch 或增删统计；本次仍只有路径操作 |
| Command Code 编辑 | input 有 file_path/old_string/new_string；同 ID 的 tool_completed 只给出替换成功和新内容 snippet | 具备研究 exact mutation 的原料；当前 staged normalizer 尚未建立独立 Diff 来源准入，Product App 也不存在 |
| 模型读取实际差异 | 独立保存已知修改前 fixture，通过原生命令对比真实修改后文件 | 属于普通命令输出验证；不会倒灌为原编辑 Activity 的 Diff Evidence |

Cline 固定版本的[官方 apply_patch executor](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/sdk/packages/core/src/extensions/tools/executors/apply-patch.ts)
在执行内部计算 oldContent/newContent，但 ACP 当前只取得最终字符串结果；解析器支持 fuzz，原始补丁的
删除文字不一定逐字等于实际删除内容。官方 `computePatchChanges` 是再次读取文件的预览 API，不是绑定已执行
ToolCall 的不可变终态，因此也不能拿它事后重建这次修改。

现有 [File Change 合同](../../contracts/runtime-file-change-observation-v1.md#8-negative-boundaries)
明确排除从 apply_patch input 或当前文件补造 Diff。读取/编辑的 path 修复没有修改该合同，也没有把输入 patch
伪装成完整 before/after。要开放编辑行内 Diff，需要补齐可验证的原生结果来源及其准入规则；本轮未完成该能力。

已额外使用真实模型完成只读验证：芝士 Run `76653ce9-73e4-439e-9c14-60d20ca9d1e7`、叮叮 Run
`86d54c99-da3f-492e-96b3-4f8ec2257568` 都用原生 run_commands 读取 `git diff --no-index` 的实际输出，
正确公开回帖删除 `export const answer = "before";`、新增 `export const answer = "after";`、计数 `+1/-1`。
Command Code 在上述真实编辑的同一原生 Session 里也用 shell_command 取得相同结果并返回
`COMMAND_DIFF38_OK`。对比使用独立保存的已知修改前 fixture 与真实修改后文件；这些是验收命令，
产品代码没有加入 Git 扫描、before/after capture 或对旧编辑记录的补造。原生输出与回帖已追加到上述脱敏 JSON。
