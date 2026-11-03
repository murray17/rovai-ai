---
document_type: model-context-change
version: v1.72
change_id: native-skills-availability
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: User
confirmed_at: 2026-11-02
authority: confirmed-model-input-change-statement
implementation_baseline: bd7858afeac1a7b7ada84e1bc27b89bff2668a26
implementation_status: implemented
last_updated: 2026-11-03
---

# 原生 Skills 可用性修复 R1

## 二次确认

Thread `rvcamp_01m6dsw0yeeqraqnbghz1a9xhy` sequence 7 提出完整修复方案，sequence 8
说明名称、多入口登记、正文边界及输入选择影响。User 在 sequence 9
（`baf4d10f-2dec-4870-95a3-fa7aceeac52d`）逐项收敛这些边界并明确要求“按最小方案实施”。
本 R1 收录该次已经说明并获准的范围，不追溯声称 User 阅读过本文件，不增添审批或投递机制。

## 变更前

部分可读原生文档因缺少 frontmatter、坏 YAML、空名称或字段类型异常无法成为有效引用；
原生名称还可能在后续流程被受管命名格式限制拒绝。显式选择无法解析时，原消息仍发送，
但新生成的输入省略该文档的链接；没有其他有效链接时省略整个 `skills` 字段。

## 变更后

这些文档可以被发现和显式选择，并通过现有 `skills[{name,path}]` 机制进入新生成的消息输入。
前后均只有以下可选字段结构（其他消息字段保持原样）：

```json
{"skills":[{"name":"native_skill","path":"/absolute/canonical-parent/SKILL.md"}]}
```

`name` 仍为该消息冻结的 `nameAtSend`；`path` 仍为现有来源验证后的文件路径。
只包含这条消息显式选择且重验可用的文档，按原顺序去重；没有有效链接时省略 `skills`，
不输出空数组或 null。只放宽原生文档元数据接受规则，不改变字段结构。

统一宽松解析：有效非空字符串名称优先，否则取 canonical 文件所属目录名；描述缺省取正文首个
非空行。无头时全文为正文；有闭合分隔符时从其后取正文，即使 YAML 无效；未闭合时保留原文、
描述为空。识别 UTF-8 BOM，源码原样保留；NUL/非 UTF-8 仍不是普通文本 Skill。
无头、缺字段、空字段不报警；类型错误只回退该字段，坏 YAML 和未闭合头记录可恢复诊断。
受管严格校验不变。多入口候选去重后使用同一结果登记，不建立别名。

## 明确不变

- 不自动选择或注入 Skill；不把诊断或回退说明加入模型输入。
- Bootstrap、Runtime 启动、权限、工具、输入预算及所有 formatter/profile/manifest 版本轴不变。
- 来源身份、路径访问规则和变更名称后的失效/刷新处理不变，不绑定同名文件或阻塞整条消息。
- 已冻结 Selection、Resolution、Manifest、nameAtSend 和恢复证据不重写、不回填、不重新解释。
  已准备输入继续用原有冻结材料恢复，不用新解析规则重新生成历史输入。
- 没有数据迁移或解析版本轴；缓存仍按 canonical 目录共享，容量、过期、扫描预算不变。
  1 MiB 只限制预览，不限制发现和显式选择。
- 当前来源与字段合同见 [Skills Rebuild v2](../../contracts/skills-rebuild-v2.md)，
  投递与恢复边界见 [Skills 架构](../../architecture/skills.md)。

## 验证与通过标准

扩展现有原生发现、来源预览、消息选择 owner 与 `pnpm test:capability-workspace`：
可读纯文档、缺字段、坏 YAML、多行描述，以及多入口聚合→登记→选择→重验一致；
路径真实错误可定位、512 条目不误报而 513 截断、失败不丢弃成功项；修复后刷新清除诊断、
迟到响应不覆盖当前结果、阅读/源码边界一致。保留受管严格校验与路径访问负例。
只使用隔离夹具，不以这些证据宣称 Harness 已加载文档或模型已读取正文。

## 实施与验证记录

Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-native-skills-availability`；
分支：`rovai/native-skills-availability`；基线见 Front Matter。当前状态 ready，改动已实现并通过下列验证。
原工作区尚未提交的 DocumentMarkdown 替换不在此分支改写。


本次扩展现有 Rust 测试，没有新增测试函数或数据库／Runtime 夹具：原生发现 owner 覆盖宽松解析、
真实读取错误与 512/513 边界；引用登记 owner 复用隔离数据库验证多入口聚合、登记、选择、重验及
名称变更后冻结证据仍可恢复；共享目录 owner 验证异常缓存与刷新清除。消息／Composer、预览访问
和受管 frontmatter owner 保留原负例并补充原生兼容输入。坏 YAML 从原来被拒绝改为保留的断言
随已确认合同更新，其余安全与事务回滚用例保留。

验证（macOS arm64，2026-11-02）：

- `pnpm typecheck`：通过。
- `pnpm test`：通过；Vitest 261 文件、3052 通过、2 项既有跳过；后续 Node 回归 365 通过、2 项平台跳过。
  其中包含通用文档门禁与治理单测。
- `pnpm test:rust:pr`：通过；默认 workspace 合计 484 通过、1 项既有忽略。
- `cargo test -p rovai-core --features extended-tests --lib native_skills::`：6 通过。
- `cargo test -p rovai-core --features extended-tests --lib skill_preview_requires_exact_registered_native_source_and_active_camp`：1 通过。
- `pnpm test:capability-workspace`：通过；生产组件验证诊断分类／复制／关联、修复后刷新、Runtime 切换
  的迟到列表、原有迟到正文、阅读／源码与 BOM／空头／坏 YAML／未闭合头，以及原有工具箱和 MCP 操作。
  截图已复核日间展开诊断与夜间 200% 缩放；只启动临时 userData 下的 Electron，不运行 Core 或模型。
- `DOCS_BASE_REF=bd7858afeac1a7b7ada84e1bc27b89bff2668a26 pnpm docs:check:ci`：通过。

没有 Migration、解析版本轴、别名系统或新的加载状态。未执行真实模型或 Windows/Linux 整机验收；
上述夹具证明文件候选与输入链接链路，不宣称 Harness 已加载或模型已阅读。

## 输入触发遗漏修复（2026-11-03）

User 在同一 Thread sequence 11（`280b6adc-2b60-4abc-84bc-b815ec3891e9`）指出下划线和中文名称
在输入触发层仍被拒绝，并明确授权必要修复。既有 Electron 输入夹具复现 `/Native_` 使菜单关闭；
直接构造 Atom 的名称测试没有覆盖此入口。

修复前：这些名称虽能通过候选过滤及引用校验，按名称输入时却无法保持 Skill 查询；位于前 50 项
之外、也无可用英文查询片段的中文候选缺少搜索入口。
修复后：`SKILL_TRIGGER` 接受 Unicode 字母、数字、下划线与连字符；`/Native_Name` 和 `/中文`
可筛选后显式选择，含空格名称可按片段检索。保持原触发边界、128 字符查询窗口和筛选后 50 项展示上限。
这是 R1 显式选择链路的遗漏修复，沿用已确认的输入结构与冻结规则，没有新的模型输入语义或版本轴。

回归从空输入框通过真实 `Input.insertText` 输入 `/`，确认第 51 项不在初始 50 项中，再逐段输入
`Native`、`_`、`Name` 或 `中`、`文`，确认菜单持续打开、候选正确，Enter 选择后保留原 `skillId`
和 `nameAtSend`，且不会误发送。单元回归同时覆盖 Unicode 数字、连字符和 URL／路径／词尾拒绝边界。

补丁验证（macOS arm64，2026-11-03）：`pnpm typecheck` 通过；trigger、document、skill-picker
三份定向单测共 16 项通过；`pnpm test:composer-input` 三项集成测试通过，其中真实 Composer
覆盖 47 个场景。先在旧触发规则上确认新增回归失败，再验证修复通过。`pnpm docs:test`、
`pnpm docs:check`、以 `eca61454f1f32212f852688d87695884771a8139` 为基线的 `pnpm docs:check:ci`
通过。补丁仅改一行生产规则；未改动原工作区的 DocumentMarkdown 工作。
