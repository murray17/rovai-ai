---
document_type: runtime-research
authority: research-evidence-only
status: verified-with-limitations
last_updated: 2026-10-05
---

# Command Code / Cline 编辑 Diff 与能力差异复核

User 的 Thread 消息 `89e5c167-85c4-49d0-ba56-87bc0c0397ff` 要求补上编辑展开并对照其他 Runtime 查漏。
本轮沿任务分支 `rovai/mission/052`、基线 `d9579cf5`；沿用已保留的隔离开发包，不改变日常 App、
用户原生配置或模型上下文层级。此前 [路径与 Context 记录](command-cline-files-context-2026-10-04.md)
是修复前证据，不回写为已支持 Diff。

## 实现与来源边界

Cline 3.0.65 的 ACP `apply_patch` 成功结果只暴露成功和路径。执行器内部有 old/new 全文，却未通过 ACP 或
官方 Plugin hook 提供；旧文本还可能经过模糊匹配及 Unicode 规范化。复核 npm 3.0.68 的同名 executor 与
ACP session-updates 源码没有变化。因此使用 [File Change v7](../../contracts/runtime-file-change-observation-v7.md)
的 `reported_mutation`，显示成功补丁的增删片段、无虚构行号；没有读取磁盘快照或捕获 Git。

Cline 常规 `editor`（其他模型可选）也补齐了路径、typed failure 与非空 old_text/new_text 的替换片段。
创建、插入、移动/删除及未知语法保留回退，不把缺失内容当成空 Diff。两个 Runtime 都只在确认工具成功后生成候选。
单文件读取能点击文件名；原生批量 read_files 仍为一个合并的阅读操作，不猜测唯一文件路径。
Command Code 的 edit_file 原生输入同样可能模糊匹配，内部 normalizer 已保留相同来源语义；尚无 Product Adapter，
不能称 App 展开已通过。

官方来源：
[固定 Cline executor](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/sdk/packages/core/src/extensions/tools/executors/apply-patch.ts)、
[固定原生匹配器](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/sdk/packages/core/src/extensions/tools/executors/apply-patch-parser.ts)、
[Command Code Tools](https://commandcode.ai/docs/reference/tools)。

## 与其他 Runtime 的逐轴比较

| 用户可见能力 | 已有 Runtime 的来源 | Cline | Command Code |
| --- | --- | --- | --- |
| 文件名与预览 | 原生 typed path / locations | 单文件 read_files、apply_patch、editor；多文件补丁逐文件展示 | 原生 file_path 已映射内部 Activity；无 App dispatch |
| 编辑增删 | Codex/Pi/Zcode 提供原生 patch；ACP 可提供完整 before/after；Claude Edit 提供精确替换 | 成功补丁片段，明确区别于完整状态；Command 与 Files Changed 共用 Evidence | 内部 edit_file 生成成功补丁片段候选，未通过 Product admission |
| 多次编辑 | 完整状态连续链可归约净差异；片段保留历史 | reported mutation 按序累计，即使改回原文也保留两次操作 | 相同语义候选；无 AgentRun reducer 真实链路 |
| Tool 失败 / 空输出 | 原生 terminal 决定 Action，Run 成功不抹掉 Tool 失败 | typed success 决定文件失败；命令按每项 success 聚合 | 原生 tool_denied/errored/hook_blocked 与非零 Shell 独立归约 |
| Tokens / Context used | 每调用计数和最新根请求的上下文占用分开 | 私有官方 Plugin 数值四桶、可选 reasoning；根调用 gauge | 原生 model_request_end 四桶；根调用 gauge，已有真实 Core 对账 |
| Context 上限 / 比例 / Cost | 必须来自当前模型的可信原生字段 | 当前 sub2api 自定义模型未提供；未知 | 当前原生 wire 与 provider 目录未提供；未知 |
| 最终回答 / 零发送恢复 | 权威 final + 没有 accepted send 才恢复 | IfNoAcceptedSend 已实现；三轮没有调用发送工具的真实 Run 各恢复唯一公开回复 | 有权威 result，尚未连接 Product recovery |
| Session / Built-in | 精确绑定、cold resume、每 Run CLI lease | 已有两成员和 App/Core 重启真实证据；本轮继续验证新编辑 | 原生 UUID 恢复及受管 transport 已测；缺完整 Native Binding/Input Delivery |
| Skills / MCP | 当前 Skills 使用平台索引、队员工具箱与原生发现；MCP 按成员分配 | 两类 Skills 已区分；Cline 原生 Skill 及 Core 候选发现、MCP 分配/更新、相邻成员隔离与撤销实测 | 原生能力和双 Home fixture 存在；生产 MCP 接线尚未实现，Skills 也需按当前来源合同接线 |
| 压缩连续性 / 权限 / 平台 | 逐 Runtime 真实证据；不借其他 Adapter 的资格 | 官方手动 compact 未形成 ACP 完成信号；macOS arm64 Preview，未达 First-Class | 普通 Prompt bootstrap 已确认；压缩补发/权限/Product Catalog 等仍需闭合 |

## 验证

定向共享准入、文件归约、Cline profile、ACP 公共 seam、Command Code 生命周期与 Renderer 测试通过。
脱敏字段、Run ID、Diff、逐轮数值、公开回帖、源码和 bundle SHA-256 见
[真实证据 JSON](command-cline-parity-evidence-2026-10-05.json)。未复制密钥、Provider URL 或原生 transcript。

| 真实 App 用例 | AgentRun | 观察 |
| --- | --- | --- |
| 芝士单补丁改两文件 | `91ba0a8c-1e04-49c3-a5a6-ad9f352dc703` | 两条 Command 行各 +1/−1；Files Changed 两文件 +2/−2；stdout/stderr、非零命令保留 failed |
| 叮叮两次编辑后改回 | `7a709205-3121-423a-afa4-5d8948b737f1` | 两次 Command 分开；Review 两块按序 +2/−2；磁盘回原文，不伪造净差异 |
| 无工具原生 final | `96e7441d-baff-410c-b1a6-e27ade475c7a` | Tool Evidence 为零；Missing-Send 补一条、且只有一条公开回复 |
| MCP 首次分配 | `9ae076bf-bc37-4128-b500-4b38f5cfa380` | 目标成员真实调用一次；同时证明旧 Library 导入没有进入新 Run，Skill 部分为阴性试验 |
| 未分配队员＋失败编辑＋空输出 | `5648dc50-dedf-4dc3-9bca-2156edde65e0` | 无 MCP 调用；apply_patch 因不存在的行失败且无 Diff；独立 exit 0 为 succeeded，输出未知/空保留 null；无 send 仍恢复唯一回复 |
| 原生 Skill＋MCP 更新 | `73b2cfda-9273-46ab-becd-e9a7106dd134` | 原生 Skill tool 读取文件中的随机 marker；MCP 返回 updated 来源；真实公开回帖、Run succeeded |
| 撤销后同成员 | `2442094d-a0ef-4059-9bed-d1ebe8eecfd8` | 当前工具与原生 Skill 均消失，服务器累计调用仍为 2；无发送工具时唯一公开回复 |

各轮模型为真实 sub2api/gpt-6-sol，Cline 为 3.0.65。两名队员的 Command 摘要实际点击可展开原生增删，
独立文件预览入口保留；Review 显示“补丁片段”和两次操作；没有 hunk 行号、页面横向溢出或 Composer 草稿丢失。
完整 App/Core 重启前记录 19 个所属进程，退出后全部消失。重开后两张卡的 detail、统计、revision、文件 ID 完全相同，
两名成员原生 Session/Binding/generation 未改变。测试 MCP 和旧导入项已清理，原生测试 Skill 已移除。

本轮本地门禁：Rust workspace 455 passed / 2 ignored；Runtime Diff 20、文件归约 22、Cline profile 2、
Command Code 4 / 1 外部 smoke ignored、ACP 公共 seam 1；Renderer 四个定向文件初轮 209，追加 reported mutation
用例后 App/search 两文件 183；TypeScript、macOS arm64 打包及签名检查通过。文档通用门禁全部通过。
收尾另补 CRLF 多片段的整文件来源大小限制，启用 extended-tests 的 Runtime Diff 模块 17 项通过；真实发送构建与保留构建的
源码/bundle 指纹分别记录，保留构建重新校验历史读回，不把后续构建冒充原始发送构建。
真实 Command Code 另外完成一次同 UUID 原生 read/edit/read，final 为 COMMAND_EDIT40_OK，仍只属 CLI/内部层。

## 本次查出的文档漂移

Cline 旧矩阵把 Missing-Send 写为 NotImplemented，但代码已经启用；真实无工具 final 与包含工具但无 send 的
两轮均恢复一条公开消息。Skills 旧矩阵仍描述 legacy Library/group projection，而 main 的
[Skills v2](../../contracts/skills-rebuild-v2.md) 已明确新 Run 不消费它。本轮先调用旧 API 的阴性试验确实没有把
导入项投递给模型；这符合现行合同，不是 Cline 无法读 Skill。清理该测试导入后，改从原生 `.cline/skills` 验证，
Core 选择器能按规范路径发现并登记，两名 Cline 成员均属于该项目 Skill 的来源范围。原生 Skill 不进入 Rovai 工具箱索引。
旧 API 试验不计作通过，也不为恢复历史路径修改当前 Context 层级。

## 尚未由本轮关闭的差异

- 当前 BYOK 原生模型目录和 wire 没有可信窗口上限、比例、费用；保持未知，不能用模型名称估算。
- Cline 的新增/删除/移动、editor 插入或 replace-all 未作为片段准入；批量阅读保持合并操作。当前可用 editor
  替换映射由 fixture 覆盖，真实 GPT 模型选择的是 apply_patch。
- Skill 增删在本次由 MCP 配置变化引发的新 Host 中验证；不能据此声称没有 Host 重建时的原生 Skill 热刷新已通过。
- Cline 手动压缩完成信号、完整超量/网络恢复/并发权限/HTTP MCP 和其他平台仍未达 First-Class；Plugin Rule 提案未变。
- Command Code 的 Product Adapter、Native Binding/Input Delivery、当前 Skills/MCP、完整权限/恢复/压缩补发还未接完。
  本轮内部片段映射和真实 CLI 不能替代其 App 验收。
