---
document_type: version-overview
version: v0.98
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: true
last_updated: 2026-08-17
---

# Rovai-ai v0.98：结构化 Skill 文件链接

> 当前状态：开发者已在实现前确认
> [核心模型上下文变更 revision 1](model-context-change.md)；Core、Renderer、Migration、测试、隔离打包
> 验收与 `/Applications/Rovai AI.app` 安装验收均已完成。实现与发布证据见
> [实施计划](implementation-plan.md#实施结果)。
>
> 前置版本：[v0.97 持久首次训练与“初次集结”](../v0.97/README.md)
>
> 后继版本：[v0.99 最小 Runtime Usage Metering](../v0.99/README.md)

## 版本目标

把用户从 Composer Skill Picker 选择的 Skill 保存为稳定结构化身份，同时保持用户可见正文
`/skill-name` 原样不变。发送事务为每个 Direct AgentRun 冻结选择资格；Runtime 启动前，Core 只把发送时
有资格、start time 仍可用且已由严格 SkillProjection preflight 证明为 ready 的投影文件，作为同级
`CURRENT_INPUT.skills[{name,path}]` 提供给模型。

合法无路径时静默省略对应 entry；没有 entry 时省略整个字段。SkillProjection 的 `error`、`stale`、
Revision/content digest 或 ownership 完整性错误仍阻止 Runtime launch。本版 Skill 传输不改变
Runtime Adapter transport、正文、附件或 accepted-input ACK；同期 ACP 缺陷修正则独立收紧
Session replay 隔离与 Prompt response-only ACK。

## 已确认产品语义

- Picker 产生 `SkillMention(skillId,nameAtSend)`；手写、粘贴和旧 Draft 中的 `/name` 永远保持 Text；
- 正文持续显示并发送 `/name`，结构化身份不替换、不展开、不删除 Marker；
- 发送时按每个 Direct Run 冻结 Skill active/enabled/name/Runtime Group Assignment 资格；发送时无资格，
  后来启用也不能回溯获得路径；
- start time 再核对当前 Library desired state，并与全量 verified `SkillExposureSnapshot` 相交；
- `skills` 位于 `CURRENT_INPUT` 对象内，与 `message`、`attachments` 同级；entry 只暴露 name 与绝对
  `SKILL.md` 文件路径；
- Draft 期间被禁用且发送时仍禁用时，正文照常发送，模型不获得 Skill 文件链接；
- 合法缺席静默省略，投影完整性错误继续全量 fail closed；
- 文件指针不证明 Runtime 或模型读取、理解或执行了 Skill。

## 交付范围

### Structured Content 与 Composer

- closed union 新增 `skill_mention { skillId, nameAtSend }`，复用 canonical Skill name 校验；
- Composer Picker 插入原子 Skill token 和普通尾随空格，保留 keyboard、IME、selection、Draft、Mention 与
  Attachment 行为；
- body projection、timeline 与 Current Input 统一把 token 渲染为 `/nameAtSend`；不反解析普通 Slash 文本。

### 发送时冻结与 start-time 解析

- Direct user send 在与 AgentRun 同一事务保存 `SkillSelectionSnapshot v1` 与 canonical digest；
- A2A/Gather 延迟物化 Run 保存 versioned empty snapshot，不扫描正文；
- `CurrentInputSkillResolver` 以选择快照、start-time Library view、prepared Exposure 与冻结 Group
  precedence 为小 Interface，隐藏去重、资格、路径和 omission 规则；
- Resolver 只读，不拥有 projection filesystem side effect；Reconciler 仍是唯一投影写入权威。

### Model Context 与 Evidence

- AgentRun Context Formatter 升至 v18，按现有 canonical object-key 顺序序列化可选 `skills`；
- ContextManifest Evidence 升至 v16，新增 selection snapshot 引用与完整 included/omitted resolution；
- exact rendered payload blob/digest 继续证明最终 Dynamic Context 字节，Runtime Input Delivery 继续独立
  证明 accepted ACK；
- Context Delivery Profile v3、Bootstrap v3/Formatter v3、其余 Dynamic Context section 与预算不变。

### Clean break

- Data Contract 升至 v0.98、projection schema 46、Migration 91；
- 保留 Camp、Message、Structured Content、附件、Task、终态执行与监控业务历史；
- 清除不兼容的 Manifest、冻结输入、Bootstrap/Binding/Session 与非终态技术状态；
- 不回填旧 Slash Text、不读取 Formatter v17/Manifest v15、不 dual write。

### 同期 ACP 会话续接缺陷修正

- 统一 ACP continuation 为同 Host 直接复用、冷 Host `session/resume`、否则 `session/new`；
- TRAE 加入 Fleet LRU，正常 AgentRun 续接不再使用会重放历史的 `session/load`；
- legacy load 进入 `LoadingReplay` 隔离，事件必须通过 Host/Run/epoch/Session/Prompt/Delivery fence
  才能产生业务副作用；
- ACP v1 只有匹配 `session/prompt` request ID 的 response 可以结算 input ACK。

### 同期 Runtime 检查架构修正

- 启动和重扫只建立 path、权限、fingerprint 与无副作用的有界 one-shot 身份证据；非 TRAE 只有命令成功、
  输出未超限且识别到基础身份才写入 `light_ready`，不自动启动 ACP、Session、认证或模型枚举；
- `core ready` 先于后台 discovery，Runtime 深检只由单 Runtime“检查可用性”或首次真实 AgentRun 发起；
- Runtime Check Manager 统一拥有 attempt/task/deadline、每 Runtime 单飞、全局并发二和所有终态 finalize；
- 版本、ACP、Codex initialize/model/schema 等短命进程统一使用固定输出容量、truncation、整进程组清理和
  bounded reader/child wait；
- fingerprint/search generation 变化只替换静态证据并 fence 旧 attempt，不触发后台深检。

### 同期 Runtime command output 修正

- 通用 ACP 解析标准嵌套 Content Text block；Terminal 只表示展示边界，`rawOutput` 仅在 Content 缺席时
  从 `stdout`、`stderr`、`output`、`text` 顶层白名单安全回退；
- Claude stream parser 使用原生 tool-use ID 关联 partial/full `tool_use` 与 `tool_result`，把 Bash、Read、
  Edit、Write 等映射为既有 Activity，并仅从 Bash 对应公开结果投影 command output；
- Antigravity 只有在健康证据声明 `output.stream_json` 时启用结构化 NDJSON，旧版继续诚实保持
  run-level 展示；两条路径都不从私有日志、workspace diff 或最终回答猜测内部 command；
- 三类 Runtime 都复用既有 Execution Evidence、脱敏、大小限制与 Renderer 投影，不新增公开 wire 字段
  或 Provider-specific Renderer 分支。

## 明确不做

- 不内联 Skill 文件内容，不创建 Provider-specific Skill input item；
- 不把 Skill path 当成 Attachment、权限、Runtime load receipt 或模型理解证明；
- 不从普通文本、粘贴内容、旧 Draft 或旧消息推断 `SkillMention`；
- 不把 start-time ready Exposure 当成发送时资格，也不让发送时资格绕过当前 disable/unassign/delete；
- 不缩窄或放宽全量 SkillProjection 完整性 preflight；
- 不创建 per-Run Skill 文件副本，不改变 active-Run projection protection；
- Skill 链接本身不改变 Session Charter、Profile budget、历史选择、A2A/Gather input、Runtime Adapter
  transport 或 ACK；ACP ACK 收紧仅属于上述同期缺陷修正。

## 验收边界

- Picker/handwritten/paste/Draft/undo/delete/IME 与 malformed closed-shape 自动测试通过；
- 发送时五类 ineligible、每 Run Group 差异、重复 Marker 去重、事务 rollback 与 retry/recovery 不重算通过；
- start-time disable/unassign/delete/rename/shadowed/pending-removal 静默省略，ready path 指向
  `entryPath/SKILL.md`，任意全量完整性错误仍 fail closed；
- `CURRENT_INPUT.skills` 同级 shape、canonical bytes、零 entry 省略、多接收者差异与 Evidence tamper
  测试通过；
- Migration 91 的历史保留、技术状态收口、foreign-key 与 reopen 门禁通过；
- Rust、TypeScript、Renderer、Node、文档、fmt、Clippy 与 diff 门禁通过；
- 打包 App 使用隔离 userData 完成真实 Picker -> send -> Context evidence smoke；最终安装并只从
  `/Applications/Rovai AI.app` 启动验收。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.97 冻结为 historical；本概览、[实施计划](implementation-plan.md)、[确认说明](model-context-change.md)、版本索引与前后链接建立唯一 current v0.98。 |
| ADR | 已更新 | [ADR-0203](../../adr/0203-structured-current-input-skill-links.md)冻结结构化 Skill 选择边界；[ADR-0204](../../adr/0204-on-demand-runtime-deep-verification.md)冻结 light discovery、显式/首次执行深检、manager-owned attempt 与受限 Probe process。 |
| Contracts | 已更新 | [Current Input Skill Links v1](../../contracts/current-input-skill-links-v1.md)与 [ContextManifest Evidence v16](../../contracts/context-manifest-evidence-v16.md)定义 Skill wire/Evidence；[Runtime Launch and Verification v3](../../contracts/runtime-launch-and-verification-v3.md)继承 ACP continuation 并新增 light discovery、按需深检、attempt manager 与 Probe process owner。 |
| Architecture | 已更新 | [Structured Current Input Skill Links](../../architecture/structured-current-input-skill-links.md)与 [Skill Projection Reconciliation](../../architecture/skill-projection-reconciliation.md)定义 Skill Module seam；[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)与 [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)记录 TRAE LRU 与 ACP 输入隔离。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)把 Picker 从普通 Text 改为结构化 token，同时保持现有 Composer 视觉、键盘和正文 Marker。 |
| Runtime Activity | 已更新 | Skill 文件指针仍不产生 Tool/Activity；同期 command output 修正更新 [Runtime Activity Registry](../../runtime-activity/registry.md)，不新增 kind 或公开 wire 字段。 |
| Runtime compatibility | 已更新 | Skill 指针不改变 Runtime 资格；同期登记补充 TRAE warm/cold Session、replay/ACK 边界，以及 ACP、Claude、AGY 原生 command-output 能力与旧版回退证据。 |
| Documentation routing | 已更新 | 文档导航、ADR CURRENT/HISTORY、Contract/Architecture 索引和领域词汇加入结构化 Current Input Skill 入口。 |
| Root README | 确认无需更新 | 项目定位、公开支持范围和常青能力没有因一个模型输入字段扩展而改变；版本状态仍由唯一 current 入口拥有。 |

## References

- [实施与验收计划](implementation-plan.md)
- [核心模型上下文变更 revision 1](model-context-change.md)
- [ADR-0203](../../adr/0203-structured-current-input-skill-links.md)
- [Current Input Skill Links v1](../../contracts/current-input-skill-links-v1.md)
- [ContextManifest Evidence v16](../../contracts/context-manifest-evidence-v16.md)
- [Runtime Launch and Verification v3](../../contracts/runtime-launch-and-verification-v3.md)
- [Structured Current Input Skill Links 架构](../../architecture/structured-current-input-skill-links.md)
- [Skill Projection Reconciliation](../../architecture/skill-projection-reconciliation.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
