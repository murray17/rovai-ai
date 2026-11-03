---
document_type: model-context-change
version: v1.72
change_id: identity-guidance-3000
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: User
confirmed_at: 2026-11-03T11:30:14Z
authority: confirmed-model-input-change-statement
implementation_baseline: 117a9281dd2adfbb847f6630c5bea809716205af
implementation_status: implemented
last_updated: 2026-11-03
---

# 工作准则与成长课题 3,000 字符实施方案 R1

## 二次确认

来源为 Thread `rvcamp_01m6ds2wjqf2hvfvqfa6yzpwbz` 的 sequence 22～24。
User 在 sequence 24（`d97d4e7c-9a1c-4f01-8902-e3a0a7a3a812`）要求“那你看看开启wt”。
完整 R1 已在 sequence 25 提交，sequence 27 再次说明范围；User 在 sequence 28
（`92cbb97f-71be-4ee4-84f7-9fdb8da10e62`）明确要求“开始执行”，确认实施本 revision。
按[上下文治理](../../development/model-context-change-governance.md#二次确认门槛)登记确认；上述时间为登记时间，非消息发送时间。

- Work item：将 `workingPrinciples`、`growthTopic` 各从 300 放宽至 3,000 字符。
- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-identity-guidance-3000`。
- Branch：`rovai/identity-guidance-3000`。
- Base：`origin/main`，`117a9281dd2adfbb847f6630c5bea809716205af`。
- Governance commit：`fa53dbed9`，本文件及确认记录先独立提交，不要求另行先合入主线。
- Status：`ready`，已按 R1 实现并验证，保留同一 worktree 供后续交付。

## 变更前

Bootstrap 的身份段由 Core 读取并序列化，完整 shape 如下，示例中的空值不表示省略规则：

```text
[MEMBER_IDENTITY]
{
  "name": "队员名称",
  "teamRole": "团队角色",
  "professionalResponsibilities": "专业职责正文",
  "personalityTraits": ["性格标签"],
  "workingPrinciples": "工作准则正文",
  "growthTopic": "成长课题正文"
}
[/MEMBER_IDENTITY]
```

| 入口 | 工作准则与成长课题当前规则 |
| --- | --- |
| Core 创建、更新、已存身份读取校验 | 各字符串经现有 Rust `str::trim()` 后按 `.chars().count()` 计数，最多 300 |
| Renderer 校验与保存命令 | 各字符串经现有 JS `trim()` 后按 `Array.from(value).length` 计数，最多 300；计数器分母 300 |
| create/update 工具及 CLI | 派生 schema 各为 `type: string, maxLength: 300`；这两个字段没有 schema 前规范化，先校验原始字符串长度，再进入 Core |
| 空值 | create 省略默认空串；update 省略保留；空串清空；null 继续拒绝 |

现有 Core 与 JS 的首尾空白集合并非完全相同，工具 schema 也不会先 trim 这两个字段。
例如原始输入超过上限但 trim 后未超限，工具仍可能在 schema 层拒绝；这是既有行为。
本轮不宣称这些入口的首尾空白语义完全一致，不借扩容改写既有身份或读取校验。
内部换行、缩进、引号、反斜杠及现有规则允许的控制字符保持原样。

## 变更后

身份段的字段、顺序、类型、空字段输出和序列化方式与上方完整 shape 相同，只扩大这两个字段的合法长度：

| 项目 | R1 目标 |
| --- | --- |
| `workingPrinciples` | 300 → **3,000 Unicode scalar**，各入口沿用上表原有 trim／校验顺序 |
| `growthTopic` | 300 → **3,000 Unicode scalar**，各入口沿用上表原有 trim／校验顺序 |
| 中文超限提示 | “工作准则最多 3,000 个字符。”／“成长课题最多 3,000 个字符。” |
| 英文超限提示 | “Working principles allow up to 3,000 characters.”／“Growth focus allows up to 3,000 characters.” |
| 界面计数器 | 沿用现有计数与数字格式化组件，两个分母改为 3,000 |
| 超限保存 | 沿用现有校验失败路径，保留完整未保存草稿；不截断输入，不开始后续头像提交 |
| 其余身份字段 | 名称、角色、专业职责 30,000、性格标签的规则全部保持 |

用字段专属常量承载两个上限；工具 schema 引用 Core 常量，Renderer 校验与计数器引用各自共用常量。
不新增通用字段框架或规范化抽象。旧合法文本的保存结果、身份 JSON 字节和摘要均不因上限变大而变化。

## 明确不变

- 相关 Bootstrap 正文上限仍为 **262,144 字节**，默认执行包仍为 **262,144 字节**；显式配置不变。
- 公开 claim 冻结快照、按实际序列化字节和封装预留的算法不变；旧分派的 128 KiB 固定预留不变。
- 两字段从各 300 填满到各 3,000，合计最多增加 5,400 scalar；普通汉字约增加 16,200 UTF-8 字节，
  控制字符的 JSON 转义还会膨胀。准入仍检查实际完整序列化结果，不按字符数估计能否投递。
- 合法保存不保证任意职责、两字段、团队指引、记忆与当前输入组合都能执行。组合超限沿用现有明确错误，
  保留已保存资料和已提交消息，不截断或摘要必需内容。固定团队指引需精简后新建对话重新提交。
- 保存身份不新增补发、自动重启或 Session 重建；新执行、续聊、补发和恢复沿用各 Runtime 当前生效规则。
- 既有 Charter、Platform Skills、Team Guidance、Memory Entrypoint 以及全部 Dynamic Context section 保持。
- 历史 Bootstrap、Binding、Manifest、Runtime Input Delivery、冻结输入及摘要不重新选择、不回填、不重写。

## 最小改动清单

| 项目／当前缺口 | 拟修改入口 | 验证方式与对应失败路径 |
| --- | --- | --- |
| Core 两字段硬编码 300 | `agent_profile.rs` 常量及 `normalize_member_identity` | 扩展既有身份 owner：3,000 可存可读，3,001 拒绝且无部分写入；保持旧资料与空白规则 |
| 工具 schema 两处独立 300 | `member_studio.rs::member_create_input_schema`，核对 update 派生与 CLI 消费 | 扩展现有 schema／CLI owner；防止界面已放宽而工具仍拒绝 301～3,000；保留缺省、null、原始长度校验顺序 |
| 前端校验与计数器仍为 300 | `member-identity-draft.ts`、`MemberIdentityEditor.tsx`、`locales/en.json` | 扩展既有 draft/save owner；中文、四字节字符、组合字符、错误定位、草稿保留与头像未提交；无原生 maxlength |
| 创建指引及现行说明仍描述 300 | `skills/member-studio/references/identity-generation.md`、当前工具合同与身份 UI 合同、发布说明、版本概览 | 文档、Skill 与发布说明门禁；只改两个限额和直接对应文案，不新增创建步骤 |
| 长两字段尚未覆盖到完整组包 | `context.rs` 已有 Bootstrap／冻结／组合预算测试 | 在既有 owner 增加长两字段夹具；比较完整 JSON 字节／摘要，验证可容纳时完整、不容纳时准入拒绝及历史冻结恢复 |

`member_tool.rs` 和 CLI 当前从创建 schema 派生字段；仅发现独立旧限额或文案时修改，不为表格列出入口而重写它们。
不新增数据库迁移、适配器运输协议、预算或调度框架；不复制前次职责扩容的整套真实运行矩阵。

## 版本、数据与兼容

| 版本轴 | 决定与依据 |
| --- | --- |
| Bootstrap v6／formatter 6 | 保持；同一字段的输入准入放宽，shape、排序、编码与摘要算法不变 |
| Public Profile 15、Manifest／Formatter 43；non-batch Profile 16、Manifest／Formatter 44 | 保持；选择、预算、组包、封装与冻结机制不变 |
| Charter 26、Binding compatibility 16、redelivery envelope／formatter 2 | 保持；未修改注入文案、绑定兼容性或补发条件 |
| Transport／CLI 45、IPC 3、Envelope 2、AgentOutput 15 | 保持；只是现有字段 maxLength 放宽，形状、命令、授权与幂等不变；CLI/Core 配套交付 |
| 数据库 | 两字段继续原 TEXT 存储；无迁移、无重写或恢复动作 |

新版接受已有不超过 300 的资料；保存超过 300 后，旧 Core 的旧校验可能拒绝读取该身份，旧 CLI 也可能拒绝写入。
不承诺降级后的双向兼容。冻结历史不依赖用户编辑后重新解释；设置变更不保证旧执行重试即可恢复。
若实施发现必须改变上述语义，先修订本文件并重新确认，不把额外变化带入 R1。

## 验证计划

仅扩展已有 owner，不新增独立测试体系；Rust 测试准入按[测试治理](../../development/testing.md#rust-测试准入与退役门槛)。

1. 两字段各 3,000／3,001 scalar，中文、emoji、组合字符、内部格式、空串、现有首尾空白语义。
   工具／CLI 额外验证原始输入超过 maxLength 但 trim 后未超限仍保持原拒绝顺序。
2. 创建、更新、读取；超限时完整草稿和旧存储不变，其他身份字段及后续头像提交未被部分执行。
3. 扩展 `bootstrap_formatter_has_fixed_three_section_and_identity_field_order` 的长字段与转义样本；
   复用既有新会话／冻结恢复 owner，验证完整字段字节与摘要，不靠模型复述。
4. 30,000 字职责 + 两个 3,000 字字段 + 团队指引 + 非空记忆 + 动态输入；按实际完整包字节分别覆盖正常准入和明确超限。
   使用现有确定性夹具与预算覆盖配置，不改任何生产预算；确认未新增编辑触发的补发。
5. Rust 默认 workspace、上述受影响 owner 的定向命令、前端 draft/save、TypeScript、文档与 Skill 检查。
   不运行通用 12 Case 模型矩阵，不新增全 Runtime／模型评测或付费真实模型调用。

实现阶段最小命令（有 feature 的测试须先 `-- --list` 确认实际发现，0 tests 不算通过）：

```bash
pnpm test:rust:pr
cargo test -p rovai-core --features slow-tests --lib bootstrap_formatter_has_fixed_three_section_and_identity_field_order
pnpm exec vitest run apps/desktop/src/renderer/src/member-identity-draft.test.ts apps/desktop/src/renderer/src/member-identity-save.test.ts
pnpm typecheck
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=117a9281dd2adfbb847f6630c5bea809716205af pnpm docs:check:ci
pnpm skills:check
```

## 实施与验证记录

已完成两个字段的 Core／Renderer 专属常量、工具派生 schema、计数器、双语错误及创建指引更新。
CLI 不含这两个字段的独立旧限额，生产逻辑无需修改；原 UTF-8 文件输入测试验证两字段及 schema 顺序。
`context.rs` 仅扩展既有测试，生产 Bootstrap、预算、选批和恢复路径均未修改。没有数据库迁移或版本轴递增。

| 检查 | 实际结果 |
| --- | --- |
| 默认 Rust workspace | 484 通过、0 失败、1 个原有 opt-in 忽略；含 Core 边界、工具 schema 和 CLI 输入检查 |
| 受影响 slow-tests owner | 4 项通过：创建／更新／重开读取及超限原子性；格式与转义；组合预算准入／拒绝；替换绑定保留 claim 冻结字段 |
| Renderer 单元检查 | draft/save 两文件 8 项通过；TypeScript 检查通过 |
| 隔离编辑器字段场景 | 复用现有 helper 和 `disclosure, save failure and retry preserve draft values` 块单独执行通过；验证两个计数器、无 maxlength 截断、3,001 拒绝、折叠／失败保留及成功重试 |
| 完整编辑器夹具 | 在既有 Runtime 菜单数量检查处停止，未执行到字段场景；不宣称完整夹具通过，不将运行时菜单修复带入本次范围 |
| 工程与文档 | rustfmt、差异空白检查、文档门禁与 diff-aware 检查通过；文档测试 10 项、Skill 测试 3 项及 Skill 检查通过 |

没有新增独立 Rust 测试函数；原字段边界 owner 改名为 `member_identity_uses_field_specific_unicode_scalar_limits`，
保留职责和其他字段的原有断言，增加两字段输入矩阵。其他存储、组包及 UI 断言均扩展已有 owner。
临时 Electron 控制器只为绕开完整夹具尚未进入本次字段场景的执行障碍，复用原 helper 与完整字段检查块；
不改断言标准，不作为新增测试框架。其首轮完整夹具失败、独立执行日志和截图均保留。

机器可读结果、命令、源码摘要及原始验收目录见[验证证据](evidence/identity-guidance-3000-2026-11-03.json)。
本轮未调用真实模型，未运行通用模型矩阵；模型上下文证明来自确定性完整字节及恢复比较。
下一版本发布说明已登记在版本概览，未改写已发布 v0.5.6 的发布记录。
按用户现行偏好，完成后提交并推送任务分支，PR 由用户后续明确要求时创建；保留 worktree。
