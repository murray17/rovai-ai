---
document_type: version-overview
version: v1.72
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-10-24
---

# Rovai-ai v1.72：Lark 独立渠道

## Hermes Runtime（2026-10-23）

按 User 要求在独立 worktree 接入 Hermes，并切换到未修改的官方 ACP＋专用 Gateway；最低版本 0.22.4，
每 Run 冷恢复原 Session 并刷新 CLI lease，macOS arm64 为 Preview。
实现范围、真实模型验证、清单及与其他 Adapter 的差异见 [Hermes 记录](../../research/hermes-runtime/README.md)。
当前规范为 [Hermes Managed Runtime v1](../../contracts/hermes-managed-runtime-v1.md)，取舍见 [D59](decisions.md#v1-72-d59)。
首次普通 user 输入携带规则与压缩后下一输入补发已按 [R1](model-context-change-hermes-first-input.md) 确认，
当前实施与验证见 [Hermes 首次输入记录](hermes-first-input-implementation.md)，投递层取舍见 [D60](decisions.md#v1-72-d60)。
合入前补齐 Ready 分类、旧探测失效和普通 Rust 回归，并增加用户显式处理原生 unknown 的维护入口；
合同与边界见 [未知执行恢复](../../contracts/hermes-managed-runtime-v1.md#用户明确处理未知执行)，理由见 [D61](decisions.md#v1-72-d61)。
按 [D62](decisions.md#v1-72-d62) 使用当前选定 Hermes 恢复原 Home/profile/Session；安装与指纹变化不否定
恢复资格，历史恢复与新输入门禁分开，移除 Hermes 全局长锁。验证边界见 [实施记录](hermes-first-input-implementation.md)。

按 [D63](decisions.md#v1-72-d63) 进一步删除普通消息代理和逐轮双通道对账，改由共享 ACP 直接使用官方
终态、工具和取消。增强 Diff/参数/用量缺失保持未知，原生 reasoning 配置不由 Rovai 接管。
当前代码与回归边界见[简化实施记录](hermes-first-input-implementation.md#官方-acp-直连简化2026-10-24)。

影响范围：新增 Adapter/原生启动与 Renderer 目录项；Migration 214 将 schema 163 扩展至 164，215 将其扩展至 165；
Hermes 采用 user 层首次/更新/压缩恢复包装，完整 B 的接受证据与精确最终 Blob 进入既有输入账本；
B/P 内部 Formatter/Manifest/Profile 与其他 Adapter 不变；
文档路由与能力降级说明同步。无发布版本变更、既有会话 clean break、领域词汇变更或其他平台资格晋升。

当前受控官方入口已验证自动压缩、插话/取消、原生工具执行、并发、MCP 增改撤销与失败拒绝。图片运输已验证，
当前模型的识图准确性未通过；原生 `.env` 独有 Skills 路径变量的菜单索引仍有限制。具体准入不由 Ready 代替。

## 撤回消息两分钟重新编辑（2026-10-23）

按 User 确认，以客户端 localStorage 短期副本支持重新编辑，Core 保持撤回原文擦除。
正文及显式成员 @ 可回填；已有草稿先确认替换，默认队长显示前缀不带回。刷新不续期，
副本到期不删除已回填的普通草稿；↑↓ 保持原有本轮固定内容规则。
合同见 [Message Reedit v1](../../contracts/message-reedit-v1.md)，范围与验证见
[实施记录](implementation-plan.md#撤回消息两分钟重新编辑2026-10-23)。更新 Architecture、UI 和文档路由；
无 Core schema、命令协议、模型上下文或发布版本变化。局部可逆客户端功能，无需新增 Version Decision。

## 全界面分隔线快速松手（2026-10-23）

按 User 确认的第二版交互稿，把可折叠分隔线统一为“到最小值停住、继续内推 64px、松手收起”，
移除必须停留的门槛，普通调宽也使用松手的最终位置。覆盖导航、队员／团队名册、文件／执行 Sidecar、
回复详情、定时任务、底部执行面板；MCP、原生 Skills 与工具箱共用缩放、取消和最终位置提交，保留只调宽行为。
当前规则见 [DESIGN](../../../DESIGN.md) 与各 [UI 页面](../../ui/README.md)，
实施与验证见[分隔线实施记录](implementation-plan.md#全界面分隔线快速松手2026-10-23)。
不改变 Core、模型上下文、数据库 schema、偏好格式或发布版本。

## 三款新增主题（2026-10-22）

User 确认在独立 worktree 实施地平线、经典红与余烬，保留原有三项偏好并缩小六项主题卡片。
新增配色与明暗模式分离，消息、输入框与焦点行为继续使用生产实现，不带入原型专属交互。
后续按 User 反馈降低地平线的大面积暖色，执行台改用独立中性白，保留会话与侧栏的轻微暖感。
当前规则见[主题注册](../../ui/themes/README.md)，范围、验证与分支状态见[实施记录](theme-palettes-implementation.md)。
不改变模型上下文、Core schema 或发布版本。

## 对话与使命引用（2026-10-22）

按 User R6 与 sequence 16 授权实施公开 `@队员/对话/使命` 和紧凑 Skills。参考只定位来源；正式标题由
Core 首发事务捕获，正文沿既有 projector 输出链接，无 Context/Composer 版本兼容层、schema 迁移或自动摘要。
当前合同见 [Thread Reference v1](../../contracts/thread-reference-v1.md)，取舍见 [V1.72-D58](decisions.md#v1-72-d58)，
进度和验证见[实施记录](thread-reference-implementation.md)。更新 Contract、Architecture、UI 和导航；发布版本与 Runtime 平台资格不变。

## Team 管理（2026-10-18）

User 在 Team 设计 Thread sequence 29 确认开启 worktree 实施。当前范围为具名团队、General 的
Team/Custom 创建默认配置、简洁新对话选择和可选 Bootstrap 指引；旧配置不自动创建团队。
上下文边界与确认见 [R1](model-context-change-team-guidance.md)，分支、范围和结果见
[实施记录](team-management-implementation.md)。功能已在独立分支实现，单元测试、构建与五项真实模型
定向验证通过；通用 Gate 为 `degraded`（共有交付失败、一项耗时退化及语义证据不足），不标记为 Gate 通过。
2026-10-22 User 在 sequence 62 明确按 V10 收口并要求 PR 合入 main、本机安装；本次整合主线
schema 162，Team 顺延到 Migration 213 / schema 163，本地展示偏好 schema 7 保留跟随系统语言。
验证与交付记录见同一[实施记录](team-management-implementation.md#v10-收口与-main-整合2026-10-22)。

## 消息字面 HTML 与引用投影（2026-10-22）

聊天正文保留尖括号占位符和原始 HTML 文字，并在可信 Mention 替换前完成文本化。
更新日志、Markdown 文件与 Skill 阅读面显式保留隐藏策略；执行过程可见性判断和引用投影 v3 同步。
当前规则见[会话 UI](../../ui/components/conversation-workspace.md#原始-html-与字面文本)与
[引用合同](../../contracts/message-quotes-v1.md)，验证见[实施记录](implementation-plan.md#消息字面-html-与引用投影2026-10-22)。
同步引用 Architecture、Contract、更新日志 Contract 与 UI；无 schema/发布版本、模型上下文格式、
历史快照、Runtime Activity 或平台资格变化。沿已有投影版本处理兼容，无需新 Version Decision。

后续补齐[文件链接间距](../../ui/components/file-preview.md#会话内的文件链接)对 HTML 字面文字的识别，
并将 raw→text 改为原位替换、`drop` 复用 `skipHtml`；详见[跟进验收](implementation-plan.md#字面-html-间距与遍历收尾2026-10-22)。

## TRAE ACP 错误详情（2026-10-22）

TRAE CLI 0.209.1 使用字符串 `error.data`，原共享 Host 仅提取对象中的 `error.data.error`，
导致 Provider 配额详情丢失，只留下 `Internal error`。本次兼容两种字符串格式，保持统一清洗、
失败分类与输入防重放规则。合同见 [Runtime Launch v71](../../contracts/runtime-launch-and-verification-v71.md)，
证据与验证见[实施记录](implementation-plan.md#trae-acp-错误详情2026-10-22)。
同步 Contract、Architecture 与路由；不改变模型输入、数据库 schema、UI 或 Runtime 平台资格，不回填旧 Run。
属于既有白名单规则的局部兼容修复，无需新增 Version Decision。

## 原生后台执行限制（2026-10-21）

按 User 已确认的 33 词规则，为 Claude Code 复用已有私有 settings 与最终环境注入；
CodeBuddy 按 2026-10-22 的收敛要求只注入三个最终子进程变量，原生同名 settings 仍按 CLI 自身规则生效。
CodeBuddy 只更新 Host 策略摘要。普通／Single Chat 均覆盖，原生会话不迁移。
完整前后文本、确认记录、验证与 worktree 交接见[独立说明](model-context-change-native-background-policy.md)，
当前合同见 [Runtime Launch v70](../../contracts/runtime-launch-and-verification-v70.md)。按 User 最新指令只创建 PR，不合并。

本项更新当前 Contract、Architecture、Context revision 与文档路由；不改变数据库 schema、发布版本、UI、
Runtime Activity 或平台资格。属于局部启动策略，无需新增 Version Decision；正式模型质量 Gate 状态另记在独立说明。

## 智能体通用环境配置（2026-10-21）

按 User 确认的第三版交互稿接入 Runtime 通用变量、队员继承与原地只读预览，
保持已有进程与队员草稿。字段、加密、检查失效及 schema 161 升级由
[Runtime Launch v69](../../contracts/runtime-launch-and-verification-v69.md)拥有；
实施与验收见[通用环境配置记录](shared-environment-implementation.md)。不改变模型上下文或发布版本。

## 跟随系统界面语言（2026-10-21）

已确认的设置、训练营与 Web 登录入口增加“跟随系统”。General Preferences schema 6 分离偏好与显示结果；旧 schema 1–5 保留原语言，缺失配置才采用 system。桌面本地启动读取、浏览器作用域、响应顺序和异常恢复由 [Interface Language v2](../../contracts/interface-language-v2.md)拥有；创建资料语言由 [First-run Onboarding v7](../../contracts/first-run-onboarding-v7.md)固定。实现与验收见[实施记录](implementation-plan.md#跟随系统界面语言2026-10-21)。不改变 Core 数据库 schema 或发布版本。

## 操作提示精简（2026-10-21）

按 User 确认移除复制会话 ID／项目路径／附件路径、项目改名与移除、撤回、结束单聊、成员邀请／移出、
定时任务操作及 Web 附件下载交接的全局 Toast。包括手动任务跳过／未启动及成员收尾提示，不新增替代提示；
既有错误反馈、业务通知与数据更新继续保留。范围与验证见[实施记录](implementation-plan.md#操作提示精简2026-10-21)。
不改变模型上下文、数据库 schema 或发布版本。

User 于 2026-10-21 确认输入历史简化：首次 ↑ 从现有消息提取本轮固定内容，退出后释放；
移除专用查询、分页和跨会话缓存，保留草稿与键盘交互。范围与测试证据见
[输入历史实施记录](input-history-implementation.md)，当前协议见
[Input History v1](../../contracts/input-history-v1.md)。历史范围跟随现有消息数据，
不改变模型上下文、数据库 schema 或发布版本。

## 回复链只读详情（2026-10-21）

按 User 确认的 B 方案实现回复块入口、只读平铺详情、悬浮操作、活动执行条和窄窗口替换。
正式链读取沿单一 reply anchor，不把合批的其他输入合并入链；完整历史通过分页查询与当前 Thread 缓存提供。
合同见 [Thread Replies v1](../../contracts/thread-replies-v1.md)，实现与验证见
[回复详情实施记录](reply-details-implementation.md)。不改变模型上下文、数据库 schema 或发布版本。

## 紧凑文件卡片与粘贴内容前缀（2026-10-21）

用户文件卡片最大宽度调整为 224px，短文件名按内容收窄，图片缩略图尺寸不变。
按 User 后续要求，Agent 文件列表恢复 620px 上限，各行填满列表并随窄容器收缩。
新生成的长粘贴附件显示原文开头与“粘贴内容 / Pasted text”，草稿恢复和发送后保持。
仅存有界展示前缀，全文、原文件名、预览与移除规则保持；旧记录不扫描回填。
合同见 [Camp Attachment v12](../../contracts/camp-attachment-v12.md)，验证见
[实施记录](implementation-plan.md#紧凑文件卡片与粘贴内容前缀2026-10-21)。

## 原路径附件显示名（2026-10-21）

按 User 确认收窄 Source Ref 的历史文件名约束：包含时间冒号等字符的显示名原样保留，
仍检查非空、120 码点上限及控制字符，实际文件继续按原路径授权和读取。
渠道下载与历史受管附件的安全落盘名称处理保持原边界。当前合同见
[Camp Attachment v12](../../contracts/camp-attachment-v12.md)，验证见
[实施记录](implementation-plan.md#原路径附件显示名2026-10-21)。

## Web 长粘贴附件（2026-10-22）

补齐浏览器远程连接公屏的长粘贴、恢复与移除。Host 直接写入 Thread 输出目录，Core schema 162
保存生成归属及单向发送保护，草稿内容仍在浏览器。普通上传不变，不增加后台清理。
合同见 [Composer Draft v19](../../contracts/camp-composer-draft-v19.md) 和 [Host Web v9](../../contracts/host-web-v9.md)。
验证与测试归属见[实施记录](web-pasted-text-implementation.md)。

## 单次长文本粘贴转附件（2026-10-20）

Desktop 公屏单次普通文本粘贴超过 10,000 个码点时，生成完整 UTF-8 `.txt`。文件按 Thread 管理，
不进入系统临时目录；已有正文保留，失败先回填最新编辑器内容。普通弹窗零消息 Active 与一键 Pending
沿用各自生命周期。采用单向发送保护，移除先保存草稿再异步清理，发送成功先保存新草稿再释放登记。
必要恢复登记不受普通缓存裁剪，Pending 启动清理补齐输出目录；不增加预算预判、发送对账或垃圾回收器。
2026-10-21 修正内部纯正文复制：只有恢复后仍含实际 Mention／Skill Atom 才保留结构化粘贴优先级，
内部纯正文同样按单次 10,000 码点阈值处理。
当前规则见 [Composer Draft v19](../../contracts/camp-composer-draft-v19.md) 与
[Clipboard](../../ui/components/structured-mentions.md#clipboard)，取舍见 [V1.72-D53](decisions.md#v1-72-d53)，
实施及验证见[实施记录](implementation-plan.md#单次长文本粘贴转附件2026-10-20)。

## 会话执行条（2026-10-20）

按 User 确认的浅灰整行与无底停止图标实现，增加可点击运行时间，以独立转圈替换文字扫光。
连接和处理反馈分别从选定的三组中英文候选中独立随机抽取，允许重复；Renderer 临时保留同一 Run 的阶段选项，避免计时触发换句。执行条不再连接外观动态设置；
其余会话和执行台样式保持不变。边界见[会话工作区](../../ui/components/conversation-workspace.md#会话中的队员占位)，
实现与验证见[实施记录](implementation-plan.md#会话执行条2026-10-20)。

## Claude 执行结束后的失败收口（2026-10-20）

Claude one-shot worker 返回普通运输错误后，Core 复用 Runtime loss 结算，避免已绑定的 launch handoff
使 Run 永久停在运行中。原输入不可重放，旧执行清理确认后才领取下一条消息。范围与验证见
[实施记录](implementation-plan.md#claude-执行结束后的失败收口2026-10-20)，当前恢复边界见
[AgentRun Recovery](../../architecture/agent-run-recovery.md)。

## 执行入口与空状态（2026-10-20）

按 User 确认的交互稿移除执行入口的运行名单气泡，浮层标题栏统一承载既有位置菜单。
空记录只显示“暂无执行记录”，三个承载位置均可切回；未激活草稿保持隐藏执行控件。
范围与验收见[实施记录](implementation-plan.md#执行入口与空状态2026-10-20)。

## 四适配器原生问卷（2026-10-20）

Claude Code、Copilot、Qwen 正式启动禁用提问工具；Kimi 与 Qwen 的意外问卷在普通审批与自动允许之前取消，
沿用当前 Prompt/Run 观察、终态与真实用户后继消息。MiniMax 本机配置不修改。
合同见 [Runtime Launch v67](../../contracts/runtime-launch-and-verification-v67.md)，
实施范围、测试与原生证据见[验证记录](native-questionnaire-verification.md)。

后续按 User 授权补齐 ZCode `toolDenylist` 与 OpenCode V2 `question` 拒绝规则；
策略只更新对应 Host 兼容摘要，保留原会话。范围与验收见同一记录的
[ZCode/OpenCode 增量](native-questionnaire-verification.md#zcodeopencode-v2-禁用增量2026-10-20)。

## 主动停止后的会话蓝点（2026-10-19）

**已按 User 反馈撤回。** 主动停止 Run 不再新增侧栏蓝点，回复未读与显式标记未读保留。
当前行为见[侧栏规范](../../ui/components/app-shell-navigation.md)，回退范围与验证见
[实施记录](implementation-plan.md#主动停止后的会话蓝点2026-10-19)。

## 记忆工作区 R4（2026-10-19）

按 User 确认稿实现无蓝色的记忆工作区、压缩通知和编辑界面。保留副标题、三项摘要、审核入口和新增通知，
增加“全部”范围，移除容量展示与治理筛选，详情/版本逐级展开；新增与修订使用中性主按钮。
修复修订通知误报新建/共同范围，边界与验证见[实施记录](implementation-plan.md#记忆工作区-r42026-10-19)，
布局规范见[Memory surface brief](../../../apps/desktop/.impeccable/surfaces/memory-workspace.md)。

## Antigravity 长任务与工具收尾（2026-10-19）

取消早期适配器遗留的五分钟 print 总时限，识别原生“超时但返回部分成功”警告；父 Run 结束后缺少
回执的工具停止活动展示并保持结果未知。当前规则见 [Runtime Launch v64](../../contracts/runtime-launch-and-verification-v64.md#antigravity-整轮执行时限)
与[过程展示 v54](../../contracts/run-process-detail-surface-v54.md)，复现与验证见
[实施记录](implementation-plan.md#antigravity-长任务与工具收尾2026-10-19)。

## Composer 链接高亮稳定性（2026-10-19）

普通输入后立即维护已有链接的显示范围；位置仅存在编辑器内存中，完整 Markdown 识别仍合并到停顿后。
修改 URL 本身或无法可靠映射时只撤下受影响范围，操作前重新校验目标。
稳定语义见[会话工作区](../../ui/components/conversation-workspace.md)，
复现、性能样本和回归见[实施记录](implementation-plan.md#composer-链接高亮稳定性2026-10-19)。

## 文件预览自动刷新（2026-10-18）

当前可见文件默认随保存自动更新；后台文件重新显示时按需更新，分页以可见行号恢复，失败保留旧内容并停止通知重试。
调度集中在既有共享控制器与资源管理中，沿用候选替换、HTML 就绪条件与 Desktop/Web 通知接线。
当前合同为 [File Preview v23](../../contracts/file-preview-v23.md)，实现与验证见
[实施记录](implementation-plan.md#文件预览自动刷新2026-10-18)。无协议、持久化配置、依赖或设置页变化。

## 文件预览读取复用（2026-10-18）

按 User 确认的三项优化，Desktop 只复用句柄内最近一次行号定位；Web 候选完整分析一次，后续分页和定位按需读取；
自动刷新确认同版本后跳过正文和 HTML 准备。Web 接受同候选等大小、等修改时间改写可能无法识别的取舍，
其他读取的摘要校验保持。规范为 [File Preview v23](../../contracts/file-preview-v23.md) 与
[Host Web v9](../../contracts/host-web-v9.md)，计数与验收见[实施记录](implementation-plan.md#文件预览读取复用2026-10-18)。
更新现有 Contracts、Architecture、UI 和测试约定；局部可逆实现无需新增 Version Decision，其他领域和模型输入不变。

## 浏览器文件传输（2026-10-17）

按 User 确认方案实施单文件 30 MiB 上传、进度/取消与原结果核对，及独立授权的原生流式下载。
预览预算与下载分离，下载保留申请来源授权、准入 Session 校验和资源约束，不增加附件资产或保存期限。
2026-10-18 按 User seq27 收敛为准入后直接流式发送，取消持续重验及下载所见版本/尾块检查；不新增严格模式。
当前规范为 [Host Web v9](../../contracts/host-web-v9.md)，取舍见 [D52](decisions.md#v1-72-d52)。
实施及验收状态见[下载链路收尾记录](implementation-plan.md#文件下载准入后直接传输2026-10-18)。

本项保持 v1.72 生命周期；Contracts、Architecture、UI、Decisions、用户/部署文档及导航已更新。
Runtime Activity、Runtime compatibility 与 Root README 无需调整：没有模型输入、运行时资格或产品定位变更。

## 旧概念残留收口（2026-10-18）

按 User“开启 wt 统一修改”的要求，在 `rovai/legacy-concepts` 隔离分支收口当前入口的残留：
Benchmark 导入读取当前 Thread 结果，CLI 目录帮助与实时目录一致，新错误提示和操作指南使用 Thread/User，
当前文档修正历史读取、Automation 返回值与评测命令；退役未挂载的 Skill Library 页面，将 Electron 验收迁到
生产原生 Skills 和工具箱页面。实施范围、兼容边界与验证见[实施记录](implementation-plan.md#旧概念残留收口2026-10-18)。

本项沿用当前命名、History 和 Skills 合同，不新增 Version Decision 或数据库迁移。
旧输入别名、SQL/路径、`rvcamp_` ID、冻结上下文／Case 证据和历史 Library 恢复保持。
未改变 Bootstrap/Dynamic Context 模板、选择规则或版本；CLI help 仅纠正已实现的目录语义。

## 单聊固定事实精简（2026-10-18）

User 已确认 [R1](model-context-change-single-chat-facts.md)，删除新单聊的 `RUN_FACTS.singleChat`。
non-batch 使用 Formatter/Manifest 42、Facts 13，Profile 16 保持；Migration 208 / schema 158 保留旧冻结输入。
当前合同为 [Single Chat v9](../../contracts/single-chat-v9.md)，验证和交付记录追加在 R1。
同时记录官方 Skill 适用范围、公屏历史按需读取及重复 Guidance 的优化候选；这些候选不进入 R1 实施范围。

## 会话 Task 能力开关

R4 已按 User 确认在独立 worktree 实施。范围、完整模型输入前后对照、兼容和 worktree 记录见
[独立变更说明](model-context-change-task-capability.md)，界面依据见
[设计稿](../../research/task-capability-ui.md)。默认关闭实例级 Task 能力；Send 与会话执行解耦，
界面入口采用执行／队员／单聊／任务，数字快捷键一次性迁移为 1–4。
功能、隔离 App 验证与回归结果见[实施与验证记录](task-capability-implementation.md)。Task 草稿已补齐提交生命周期，关闭重开保留未决状态，原样重试复用命令身份，成功只清除对应输入版本。上一轮已修正普通 CLI 入口并完成同一真实 Run 中的切换与发送验证；固定候选的完整 Rust 扩展 workspace 为 1064 通过、0 失败、8 项既有原生人工检查忽略。原 campaign 两次尝试均在 Runtime 预检受阻；虽已修正预检误判并恢复 CLI Judge 无工具诊断，正式 Gate 仍为证据不足。

## MiniMax Code ACP（2026-10-16）

新增 `minimax-code-cli`，复用 ACP Host/Fleet、精确 Session、现有 Bootstrap、Steer、权限、
Skills/MCP、Built-in CLI 与数值 Usage。macOS arm64 为 Preview；2026-10-18 按 User seq43 的
[验收确认](../../../qualification/runtime-platform/macos-x64-minimax-code-v1.json)将 macOS Intel 提升为
Qualified；本次平台确认未重跑 Intel 模型会话。同日完成 Windows x64 的
[十四轴/九流程实测](../../research/minimax-code-runtime/windows-qualification-2026-10-18.md)，
修复私有 Bootstrap ACL、Usage cwd 匹配及 Skill 链接路径，Windows 单独绑定
[目标机证据](../../../qualification/runtime-platform/windows-x64-minimax-code-v1.json)进入 Qualified。
Linux x64 按下方独立记录晋升 Qualified；无 Fast。各平台证据不互相外推。
Migration 205 从 schema 154 升至 **155**，保留业务行、索引、触发器和既有 migration receipts。
当前行为由[Runtime 边界](../../architecture/runtime-catalog-boundaries.md#minimax-code-acp-实施边界)拥有；
[接入矩阵](../../research/minimax-code-runtime/README.md)分别记录脚本模型、真实模型与未验范围，
实现交付不等同 Checklist 的 First-Class 资格。没有更换 current_version 或宣布本版本完成。

User seq35/37 确认问卷采用取消、不代答。沿用现有原生 dismiss 与审批防代答，新增准确的
`runtime_questionnaire_unsupported` 公开提示，非空结束文字或已发送消息不掩盖未承接问卷。
不改原生配置、Host/Session 身份或模型上下文；后继新指令按原路径继续。

Linux 目标主机按维护者要求完成 14 轴验收，见[独立报告](../../research/minimax-code-runtime/linux-qualification-2026-10-18.md)
与[不可变证据](../../../qualification/runtime-platform/linux-x64-minimax-code-v1.json)。覆盖真实 Provider、
官方 CLI 控制服务、生产 20 Host/30 分钟 TTL、全部 30 个当前 CLI 操作及 Linux 浏览器；各类证据不混算。
修复纯工具调用和压缩换代的 Usage 漏采，沿用非阻塞、稀疏、部分统计，当前规则为
[Usage v11](../../contracts/runtime-usage-monitoring-v11.md)。macOS arm64 Preview 保持，Windows 的独立资格不由本轮继承，
Linux Server 三发行版 OS/ABI gate 独立。原生管理命令取消、相同请求重试及 plan/bypass 限制详列报告。
本项不增加 Migration、模型上下文字节或新的 current_version；当前 Architecture、Contract、兼容性、
Development Checklist 和文档导航同步，UI/Runtime Activity/Root README 规则不变，无新增高成本取舍决定。

## Web 断线统一恢复（2026-10-17）

按 User 确认的中性主题全屏遮罩实现 Web 断线恢复：页面与草稿保持挂载，统一暂停操作，
单一按钮核对并使用原 ID／原 payload 重试未知提交，明确失败结算原 Promise。
规则见 [Host Web v4](../../contracts/host-web-v4.md#web-断线恢复)与
[连接恢复 UI](../../ui/host-web-connection-recovery.md)，验证范围见[实施记录](implementation-plan.md#web-断线统一恢复2026-10-17)。
本项保持 v1.72，无新 Version Decision；Architecture、Contract、UI 与文档路由同步，
补齐 Core 核对入口的 Thread/Camp 名称兼容及刷新后公共草稿结算；无 wire shape、Runtime、模型上下文、
迁移或 Root README 变更。

## Send 文件引用与三渠道提示（2026-10-16）

按 User 消息 19 确认的 [R3](model-context-change-send-file-guidance.md)实施：普通引用优先 Markdown，
单行 Markdown 直接使用 `--body`；临时正文仅在发送成功后由创建它的 Agent 清理。
文件名标为示例，附件用于明确请求或渠道交付，Send reference 删除重复 Files 段。
飞书、Lark、钉钉的 active Thread binding 共用原有文件交付提示；Charter revision 23，
Binding compatibility 16 不变，既有 Bootstrap 保持冻结。当前规范见
[Send v27](../../contracts/camp-message-send-v27.md#agent-文件引用与发送教学)与
[Lark v1](../../contracts/lark-channel-v1.md)。验证与收口状态追加在 R3 的实施记录。

本项九范围复核：Version lifecycle 保持 v1.72；属于可逆教学调整，无新增 Version Decision；
Contracts、Architecture 与 Documentation routing 已同步上述选择条件和当前入口；
UI、Runtime Activity、Root README 无需更新；Runtime compatibility 保持旧 Binding，
只有新 Bootstrap 采用扩展后的渠道条件。

## Run Card 插话（2026-10-16）

按 User 确认的 v3 交互稿实现独立插话行，隔开 command 折叠并复用其行高、展开与键盘交互。
详情仅保留正文和原消息入口；Core 保存来源指针和稳定顺序，回执从原投递记录投影，模型输入保持。
当前合同见 [Delivery v18](../../contracts/message-delivery-v18.md#执行窗口中的输入标记)，界面见
[Run Card 插话](../../ui/components/conversation-workspace.md#run-card-中的插话)。

## 撤回智能体检测简化（2026-10-18）

按 User 要求整项撤回 PR #797，恢复原有“检查状态”文案、状态呈现及检测流程。
相关 Runtime、刷新和启动顺序改动一起撤回；后续其他功能保留。当前 Architecture、Contract、UI 和
设置页 brief 同步恢复，未新增表、迁移或替代机制。范围及测试退役依据见
[撤回记录](implementation-plan.md#撤回智能体检测简化2026-10-18)。

## 智能体已知版本保留（2026-10-15）

修复静态扫描的空版本遮蔽已保存版本，以及单项检查推进全局搜索代次后其他版本重新出现的问题。
同一安装的路径与程序指纹匹配时复用已知版本，空版本写入不清除同一程序的记录；程序改变后不借用旧版本。
设置与队员配置使用同一 Core 投影，启动不新增完整健康检查，版本读取失败不阻断普通执行。
当前边界见 [Runtime Launch v64](../../contracts/runtime-launch-and-verification-v64.md)。

## Claude 受管执行回执与启动期待插话（2026-10-15，User seq86、seq88）

Claude 的精确 UUID 回显可跨内部 result；可靠结束不被补充输入的未确认状态阻塞，输出结束后缺回执
单独保留未知、不自动重发。此规则替代下方 seq54–75 记录中的原前台阶段限制。
启动 Run 可以先接收待插话意图，初始输入接受后自动投递；缺失版本从实际冻结程序读取，失败仍可普通执行。
复用现有消息、Delivery、Builder／Formatter 和 RUN_INPUT，无迁移、新提示词或额外模型调用。
当前合同为 [Delivery v18](../../contracts/message-delivery-v18.md)，Pi／Kiro／ZCode 入队即确认接收；验证见[实施记录](implementation-plan.md#steer-入队回执与阻塞工具核验2026-10-15)。

## Desktop 快捷键设置（2026-10-15）

按已确认 v8 交互稿接入本机设置、23 项动作、实际侧键录制、发送组合与动态按钮提示。
普通状态无外框，悬浮/聚焦显示；macOS Control 与 Command 分开，Windows Win 组合继续不支持。
当前合同见 [Desktop Shortcuts v1](../../contracts/desktop-shortcuts-v1.md)与[快捷键 UI](../../ui/components/shortcut-settings.md)。
此变更不改变模型输入、Core 协议或日常数据；#668 保持开放，随发布验收处理。

## 消息回执对齐与 Claude 写入边界（2026-10-15，User seq74–75）

已确认交互稿落到生产组件：回执整组靠右，复制／撤回在左，显隐不改变位置；多人回执逐目标互斥计数，
混合处理中、普通失败和停止不会被已插话摘要掩盖。成功普通目标仍安静退出摘要，详情保留各自执行结果。
Claude 首次实际写入与准入检查同步；零字节 Pending 在取消／原轮结束后撤销，部分写入仍须原生回执且不能重发。
不增加持久状态或模型上下文，后台任务及 Session idle 保持。实现与验证见[实施记录](implementation-plan.md#消息回执对齐与-claude-写入边界2026-10-15)。

## Steer 停止、回执与交互修正（2026-10-15，User seq54–63）

Pi 用 Run 内的提交锁协调停止，清队列先于 abort，锁不等待消费或 Steer ACK；Claude 在前台 result
处结算待确认输入，迟到的同 Session 回显不能归入已经结束的原轮，后台任务／idle 结束逻辑保留。
两者只使用内存状态，不增加数据库字段或上下文。现有进程／writer 测试补入可复现的负向序列。
Composer 输入为空时保持普通按钮，有正文或附件后才按实际接收者计算插话选项；成功摘要恢复“已插话”，多人回执不丢计数，
领取后关闭撤回入口，历史记录只作正确投影。CodeBuddy 最低版本政策和 #762 已知风险不变。
按钮接收者来自编辑器实时状态，不等待延迟草稿保存；提交仍由最终正文和 Core 校验。

## Steer 合入前自检（2026-10-15，User seq47）

同步主线 `1681b99e`，通过 Migration 204／schema 154 收敛主线和分支的两种 203，
保留历史输入与接受证据。修复 Desktop 核对回执的精确白名单、继续发送及提交前编辑的逐目标路线，
Pi 图片插话复用普通输入的图片准备、能力检查和证据保存。模型文字、RUN_INPUT 结构与版本门槛保持。
等待中的活跃 Run 可准备 Steer，接收回执不解除原审批等待；普通首次输入保持原限制。
CodeBuddy #762 的原异常及证据缺口继续保留，更多旧协议兼容仍属后续扩展。
User seq49 补充存储自检：新输入沿用单份最终 Blob、空置退役快照列；新操作沿用主线格式 4，
不保存原生输入回显副本或 Steer 资格快照。分轴审查与合入前验证见[自检记录](../../research/runtime-monitoring/steer-release-review-2026-10-15.md)。

## Steer 版本复核与 CodeBuddy 新旧 ACP（2026-10-15）

按 User seq44、seq46，CodeBuddy 稳定版仅设 `>=2.109.1` 下限，不设大版本上限或推荐版本；优先专用 `session/steer`，
仅在方法明确不存在时使用旧并发 Prompt。ZCode 对 User 标注官方 App 3.12.2，内部保持捆绑内核检查。
Claude 2.1.83 是当前完整结束协议的边界；TRAE CN 0.207.1 补验当前 Core 的完整产品链路。
具体逐次结果见[版本复核报告](../../research/runtime-monitoring/steer-version-followup-2026-10-15.md)，
协议边界见 [Delivery v16](../../contracts/message-delivery-v16.md)。没有数据库、模型上下文或 UI 改动。

## 用户 Steer 合并与资格收口（2026-10-15）

按 User seq40 合入 main d6ae891f，收敛两种 Migration 199 来源至 203／schema 153，新 public Manifest 39。
最终同步 main 2d4c61af7 的日期标记与锚点作者读取，两项不改变 Steer 协议及模型上下文。
历史输入与接受证据保留；Core 统一活跃 Run 的版本、协议资格，UI 展示原因；加入 TRAE CN 产品路径，
回执统一为“运行时已接收”。当前合同见 [Manifest 39](../../contracts/context-manifest-evidence-v39.md)、
[Delivery v16](../../contracts/message-delivery-v16.md)，模型正文的紧邻对照见[合并报告](model-context-change-steer-merge.md)。
实现与验收见[合并后完整清单](../../research/runtime-monitoring/steer-hardening-2026-10-15.md)；
九种 Runtime 有本轮真实正例，CodeBuddy 原始异常在 #762 保留，不由原低版本报告推断合并后通过。

## 内置头像裁切坐标统一（2026-10-15）

按 User 消息 66，内置头像仅调整取景时使用 Agent 读到的 packaged icon，修复“看小图、改大图”。
首次修改保存为单文件受管头像；再次修改保持同一底图。读取输出、提示词、普通显示与旧上传头像保持。
当前边界见 [Member Avatar v4](../../contracts/member-avatar-v4.md)，验证见[实施记录](implementation-plan.md#内置头像裁切坐标统一2026-10-15)。

## 旧上传头像读取与修改的坐标统一（2026-10-15）

按 User 消息 61 确认的[源图与取景方案](model-context-change-legacy-avatar-source.md)，
Agent 对旧静态／GIF 上传头像返回源图与原取景；所有受管头像读取与修改共用坐标。
界面、渠道、内置头像、历史资产与保存边界保持；不迁移旧图片。
当前合同为 [Member Avatar v4](../../contracts/member-avatar-v4.md)和
[Transport v41](../../contracts/builtin-tool-transport-v41.md)，验证结果见独立说明。

## 成员头像读取统一（2026-10-14）

按 User 消息 53 确认的 [R3 完整对照](model-context-change-member-avatar-read.md)，
`member get` 统一为一个 avatar 对象，包含路径、状态和已保存的显示裁切；只物化一份头像，移除 portrait。
完整身份、四字段 list、旧资产取景与 Session 恢复保持。当前合同为
[Transport v41](../../contracts/builtin-tool-transport-v41.md)与[Member Avatar v4](../../contracts/member-avatar-v4.md)。
实现与 16 轮真实模型专项已完成；完整通用 Gate 仍受既有数据库断言阻塞，见独立说明与[验证索引](member-avatar-read-verification.json)。

## 队员头像简化（2026-10-14）

按 User 确认的 R8 与消息 27 实施：紧凑身份信息与会话卡、上传后裁切确认、默认折叠更多设定及预设。
新头像单文件保存，GIF 保留动画，旧 icon/source 兼容；渠道按发布意图冻结静态封面，Agent 素材要求同步简化。
当前边界见 [Member Avatar v4](../../contracts/member-avatar-v4.md)，验证见[实施记录](implementation-plan.md#队员头像简化2026-10-14)。

提示词按 User 消息 39 确认的 [R3](model-context-change-member-studio.md) 收口：按角色／外观线索选择头像方案，
工作准则与成长课题默认留空，CLI 导入限制与 Core 共源，用户说明使用“智能体／运行配置”。
Bootstrap、身份投影与数据不变，验证状态见该记录。

## 消息发送者统一（2026-10-14）

按 User 已确认的 [R2](model-context-change-message-senders.md) 已在独立 worktree 实施并通过自动化回归；R2 移除专用名称冻结，只在实际消息组装时取名。完整真实模型 Gate 待补。
公开输入、SHARED_THREAD、读取和搜索统一发送者与名称；内部身份、正文、Mention、渠道与旧恢复保持。
当前合同为 [Message Senders v1](../../contracts/message-senders-v1.md)、[History v14](../../contracts/camp-history-v14.md)
和 [Manifest v38](../../contracts/context-manifest-evidence-v38.md)。验证状态见 R2 实施记录。

## Pi 接收容量与连接失败原因（2026-10-14）

Pi 入站单帧从 4 MiB 提高到 64 MiB，出站与 stderr 保留各自预算；不压缩头像、不修改其他 Runtime。
读取层区分容量超限、协议损坏和连接读取失败，并沿既有 Runtime loss 事务保存公开原因；
accepted/unknown 输入不重放，Host 清理和单聊取消语义保持。精确边界见
[Runtime Launch v63](../../contracts/runtime-launch-and-verification-v63.md)，验证见
[实施记录](implementation-plan.md#pi-接收容量与连接失败原因2026-10-14)。

## 已实现：Bootstrap 领取预算一致性，语义 Gate 待补（2026-10-14）

按 User 确认的 [R1](model-context-change-bootstrap-claim-budget.md)，以本 Run 快照统一 FIFO 选批与实际组包，
覆盖 Memory 更新、同包补发与 Session 更换。新 public 36/13/9；历史与非 batch 保持。
真实 OpenCode 对照复现旧版同批超限，候选分成两个 Run 成功且保留 Session。
实施与验证见上述独立说明及 [验收索引](bootstrap-claim-budget-verification.json)；完整 12 Case Gate 未运行。

## 已实现：成员路由与专业职责扩容，语义 Gate 待补（2026-10-13）

[R4 逐项前后对照](model-context-change-member-routing.md)提出将专业职责上限扩为 10,000 个 Unicode
scalar value，从 `COLLABORATION_STATE` 和 Agent `member list` 移除职责，保留 `member get` 与
本人身份全文，并同步调整完整上下文容量、CLI help 和平台技能。旧原生会话正常 resume，冻结输入
保留。R4 保持每项前后对照，撤回 member-studio 用户原文处理与专业职责写法两段改动，
解释协作摘要切换和 Profile version 的并发控制用途，并补齐共享预算与各 Runtime 独立限制，
包括上一版漏列的 Cline 32 KiB Bootstrap 检查；延续 R2 的简洁 help 与 update 既有语义。
User 已在消息 `23b13d59-00b5-4c6c-a6f9-992b59fd32d6` 确认 R4 并要求开始编码。
实施在独立 worktree `rovai/member-routing-context` 中完成。自动化回归及 Codex、OpenCode、Pi 各三轮
真实首轮/热续接/冷续接通过；Cline 仍受现有平台准入限制。固定 Judge 配置缺失，12 Case 语义 Gate 未运行。
详见方案的实施记录与 [真实验收摘要](member-routing-verification.json)；发布另行执行。

## 空会话与队员移除（2026-10-13）

按 User 确认的同组件交互稿允许移出最后队员，并取消永久移除的 sole-member 阻止条件。
保留历史、工作区、草稿与既有执行/任务收口；空会话没有隐式接收者，邀请后恢复。
永久删除预览展示逐会话影响，失效接收者修复去掉指定长提示。
当前合同见 [Camp Membership v3](../../contracts/camp-membership-v3.md)，验证见[实施记录](implementation-plan.md#空会话与队员移除2026-10-13)。

## 会话切换读取回归修复（2026-10-13）

按 User 要求移除公开及单聊执行过程中的原生会话重建提示、对应 View 字段和事件历史查询，
恢复 Camp Open 不读取 `event_log` 的边界。原生恢复和审计事件保持，不新增数据库迁移。
当前合同见 [Runtime Launch v62](../../contracts/runtime-launch-and-verification-v62.md)，
验证见[实施记录](implementation-plan.md#会话切换读取回归修复2026-10-13)。

## 原生恢复真实 CLI 复测（2026-10-12）

15 类 Runtime 的隔离实测发现 CodeBuddy 空历史假恢复及四类结构化恢复拒绝未接入降级。
按 User 授权在 Adapter 内修复，保留 Warm 环境与输入防重，不放宽其余未知错误；
范围、逐 CLI 结果及限制见[验收记录](../../research/runtime-monitoring/native-session-resume-2026-10-12.md)，
当前合同为 [Runtime Launch v60](../../contracts/runtime-launch-and-verification-v60.md)。

## 内部实现减重（2026-10-12）

按 User 确认一次实施数据库准入、输入快照、工具结果、工具目录和命令结果五项精简。
模型输入与当前功能保持，取消重复证明摘要和中间副本；原结果查询、旧历史与原生恢复保留。
范围和直接授权见[变更说明](model-context-change-input-snapshot-simplification.md)，
实现与验证见[实施记录](implementation-plan.md#内部实现减重2026-10-12)，取舍见 [V1.72-D38](decisions.md#v1-72-d38)。

## 项目目录保存简化（2026-10-12）

未发布的 SQLite 目录登记实验按 User 要求完全撤回，建表、迁移、接口、业务自动登记与专属恢复代码退出。
目录清单改存现有客户端导航偏好 JSON，一次性旧项目补齐完成后不再执行兼容扫描。保持当前主线数据库
版本及受支持升级链，不迁移实验登记、不回退或改写日常数据库。当前合同见
[Navigation Read v1](../../contracts/navigation-read-v1.md#client-directory-preferences)，验收见[实施记录](implementation-plan.md#项目目录-json-保存2026-10-12)。

## Charter 与 Memory 入口精简（2026-10-12）

按 User 确认的 [R2 完整前后对照](model-context-change-charter-memory-concision.md)，精简公共和
Single Chat Charter，移除常驻命令目录、Core／Native Session 内部术语及重复解释，
Memory 入口改用完整 CLI 和按需读取教学。Charter revision 22 保持共享 Binding compatibility 16；
旧 Bootstrap 不改写，新 Binding 才使用新文案。发送成功说明保留在 send help，权限和动态 Context 不变。
本次也带入此前已完成的 Codex 专属提示删除；其独立兼容性影响见原说明。
实施与验证见[实施记录](implementation-plan.md#charter-与-memory-入口精简2026-10-12)。

## 删除 Codex 专属最终答复提示（2026-10-12）

按 User 明确要求删除 Codex 最终答复补充句、Adapter 追加分支及专属 binding compatibility 字段，
公共发送规则与 `--input-file` 教学保持。新 Codex Binding 使用共享 Charter，旧证据不重写；
精确前后文本、授权、兼容影响和验证见[上下文变更说明](model-context-change-remove-codex-final-answer-guidance.md)。

## 会话内队员占位（2026-10-11）

按 User 确认的 v12，在公开会话按每次 Run 的启动公开消息边界／自身公开回复锚点投影正在执行的队员：
原文按已有换行在单行内推进，运行中复用 RunCard 高亮；保留命令图标、Run 身份衔接、确认停止及中断重试。停止按钮默认中性色，悬浮变红。
复用现有 Evidence、精确 Run Stop 和独立续做命令；Core 从持久化续做 Delivery 派生受理事实，
切群／刷新后旧失败入口保持收起。单行预览首次读取失败可随更新／重连恢复，慢请求保留更新并补拉；
旧恢复记录与实时事件按版本合并，不覆盖新正文。排队不占位，不创建公开消息，不改变模型上下文或数据库结构。
2026-10-13 增补：共享高亮统一为 4.8 秒；执行行右键直达外观“减少动态效果”，
初始化与已受理的空内容按真实状态分别显示连接／处理文案。
同日修正：输入受理回执晚到时，共享执行行优先展示当前 Run、当前执行轮次的实际活动；
旧轮次记录仍不能掩盖新一轮连接。公开回复后、慢读取及远程恢复沿用相同规则。
独立执行行补齐头像／姓名卡片入口与可点击模型摘要，复用消息交互。Run 与公开消息共用冻结模型、
强度投影，不使用队员当前配置替代运行记录；同 Run 连续回复仍省略重复身份。
同日修正：新执行初始位置使用已冻结的启动公开消息边界；任何执行行都不拆开回复与附属产物组。
2026-10-18 增补：执行行使用 Run 输入 ID 显示原消息引用与批量来源，支持按需定位较早输入和返回执行位置。
复用现有引用及 Footer／动作样式，保持草稿、精确 Run 控制和迟到读取隔离；不新增 Core 数据或后台读取。
2026-10-21 调整：来源定位移除消息正文的粗描边和独立“返回执行位置”入口，统一使用会话已有的
“回到最新”向下按钮；保留定位后的 DOM 焦点及控件的键盘焦点反馈。
当前边界见 [Run Process Detail Surface v55](../../contracts/run-process-detail-surface-v55.md)，验证与交付见
[实施记录](implementation-plan.md#会话内队员占位)、[启动状态修正](implementation-plan.md#执行行误回到启动状态2026-10-13)
及[原消息引用](implementation-plan.md#执行行原消息引用2026-10-18)。

## Windows Web 凭据可用性（2026-10-11）

在已准入 Core 数据目录内，Windows `web-auth.json` 接受正常继承权限；只对新建的原子写入临时文件
尽力加固，不再以精确文件 ACL 模板阻断远程连接。保留目录/路径/内容检查、先落盘再更新状态与显式重置语义。
Host、HTTP 与 Desktop 使用脱敏的读取、保存、内容和路径错误；正常继承不产生修复流程或警告。
当前合同见 [Host Web v4](../../contracts/host-web-v4.md#windows-web-凭据可用性)，取舍见
[V1.72-D34](decisions.md#v1-72-d34)，验证与未测范围见[实施记录](implementation-plan.md#windows-web-凭据可用性2026-10-11)。

## 已实现：Send 正文文件输入

[已确认正文文件方案与模型上下文对照 r5](model-context-change-send-input-file.md)在同一 `--input-file`
入口支持正文文件，并保留符合现有 Send Schema 的完整 JSON 请求。文档包含 Bootstrap、Send help、
`cli-operations`、根 help 的精确前后文本及其他上下文入口审计；清理重复指导，不增加 TMP 目录教学，旧格式兼容只留在实现中。
User 消息 19 已授权独立 worktree 实施。当前合同为 [Built-in Tool Transport v37](../../contracts/builtin-tool-transport-v37.md)，
代码与确定性验证已完成；真实模型 Gate、旧 Session 连续发送和回滚实测尚未运行。
具体结果、测试准入与限制见[实施记录](implementation-plan.md#send-正文文件输入)。

## 队员运行环境（2026-10-11）

环境配置从 Agents 移至 Teammates，按队员实例与 Runtime 保存 Host 私有 JSON 覆盖。R4 紧凑双语编辑器
沿用保存/放弃，移除旧 Agents 编辑区域及活动环境层；旧值以只读归档在“需要处理的问题”提示手动迁移。
Migration 191 保留队员私有配置；方案 A 通过 193/schema 143 退役 192 引入的会话快照，不解密旧数据。
环境只在真正创建 CLI 时读取；Warm 及其工具子进程保持启动环境。保存不驱逐进程，旧会话正常尝试原生续接。
真实队员配置错误只失败对应任务，其他 Camp 继续领取；数据库整体故障仍上报。
实现与测试记录见[方案 A](implementation-plan.md#队员环境按进程启动读取2026-10-12)。
Pi、ZCode、Fleet 收窄到同一 Camp/队员/当前会话，保留各 Adapter 的恢复、停止与后台消息机制。
合同见 [Runtime Launch v60](../../contracts/runtime-launch-and-verification-v60.md)；
测试归属见[队员环境 owner](../../development/testing.md#队员运行环境-owner2026-10-11)。
可重复命令、实测结果和边界见[验收记录](../../research/member-runtime-environment-acceptance.md)。
真实 Claude Code 2.1.287 已用两个 loopback 接口、不同假凭据/模型及冲突原生设置验证并行路由。
其他 Runtime 不由这项测试推断 Provider 兼容性，Warm 与字面量子进程边界另由自动化测试覆盖。

## 并行交付：OpenCode V1/V2

按 User 的可用性优先、最小必要改动意见，单一 OpenCode Adapter 在配置冻结前识别所选程序，
分流原生权限、旧压缩插件与用量来源，复用既有 Host、Session、Bootstrap 和工具授权。
范围、必要决定与逐版本验证见 [OpenCode V1/V2 实施记录](opencode-v1-v2-implementation.md)。
V1 移除 Rovai 强加的 `--pure`，恢复现有压缩监听及原生用户插件加载；保留显式环境设置。
工具权限不是插件沙箱，修复前对照及开发构建验收分别记录，不用普通协作样本替代压缩连续性验证。
本机 V1 `1.18.32` 与 Brew V2 `2.0.25` 已完成真实开发版、协作、审批/取消、压缩补发与 MCP 回归。
V1 初始化单独保留 90 秒窗口，容纳原生冷启动依赖锁的 60 秒过期；不删除用户锁或重发任务。
不增加版本资格门禁或安装管理，不变更数据库 schema、版本指针或模型上下文格式。
Windows V1 已补齐原生压缩监听插件的安装路径，复用平台私有存储与现有 relay；跨平台配置回归
及验证边界见[Windows 安装修复](opencode-v1-v2-implementation.md#windows-v1-压缩监听安装2026-10-11)。

## Kimi 使用官方 Provider 配置（2026-10-10）

按 User 要求退役 Rovai 专属 `kimi-code.env`、`ROVAI_KIMI_CONFIG` 与模型变量注入。
正式运行、健康检查和模型目录探测由 Kimi 读取官方配置；旧文件不再影响启动或 Host 复用，
不自动迁移、覆盖配置或删除历史。当前合同为 [Runtime Launch v60](../../contracts/runtime-launch-and-verification-v60.md)，
理由见 [V1.72-D32](decisions.md#v1-72-d32)，验证记录见[实施计划](implementation-plan.md#2026-10-10-kimi-官方-provider-配置)。

## Claude Code / Codex 原生自动记忆（2026-10-10）

受管执行固定关闭 Runtime 原生自动记忆，保留 Rovai Memory、项目规则、原生持久化与原 ID Resume。
Claude 继续使用既有私有 settings 文件与子进程 env 双重覆盖，Fast 三态和 Bootstrap 不变；Codex 在 App-Server
启动时传入三个配置覆盖，仅修订 Host 进程兼容摘要，不使 Native Binding 换代。不修改用户原生配置或已有记忆，
不控制外部 Runtime，不热替换正在运行的旧 Core/Run，不新增检测门禁。
当前边界见[受管原生自动记忆](../../architecture/runtime-catalog-boundaries.md#受管执行的原生自动记忆)，
实测版本、测试与限制见[验收记录](../../research/native-auto-memory/verification-2026-10-10.md)。

## Pi 思考强度与目录观察（2026-10-10）

按 User 批复收紧为目录准入/提交/读取解耦、同模型续接避免重复选模、目录观察非破坏性使用。
复用表、Check Manager、临时探测 Host、整目录缓存和任务租约，不新增缓存、Provider 健康或默认值管理系统。
能力由 Core 解析为 thinking_level，既有控件与 Run 冻结历史消费；保存不依赖目录健康。
当前字段和执行顺序见 [Runtime Launch v55](../../contracts/runtime-launch-and-verification-v55.md)，
验证与边界见[实施计划](implementation-plan.md#2026-10-10-pi-目录观察与思考强度)。

## Cline / Command Code 保留 ACP，暂缓公开（2026-10-09，User 105）

停止 headless 候选并删除专属 Rust transport/activity、测试和 Python 探针；原始报告与脱敏证据保留，
复现代码改指向退役前提交。两个官方 ACP 实现及 System、权限、工具、恢复和共享进程能力继续保留。
Command Code 与 Cline 一样撤回 Preview，所有平台 NotQualified；设置、新手引导、队员/Skill 选择、
安装引导和监控筛选不再展示。旧身份、配置与公开历史不删除、不迁移，隐藏不改变旧 Run 事实。

Cline ACP 自动压缩仍未接通；Command ACP 自定义 BYOK 目录/切换、`acp --model` 启动选择及已测 BYOK
MCP 实际调用仍有缺口。精确版本、通过范围与未知项见[兼容性清单](../../runtime-compatibility.md)。
这是公开范围收敛，没有更换 Runtime 或新增后备链路；下文 Preview/headless 是实施历史。

2026-10-10 合流主干内部续做请求等后续修复；190/schema 140 兼容主干与 Preview 的同号旧收据，
保留用户历史与 ACP 身份，不改变上述隐藏范围。迁移与验证见[实施计划](implementation-plan.md#2026-10-10-两个隐藏-acp-与最新主干合流)。

## Cline 暂缓公开（2026-10-09）

User 99 因原生 ACP 自动 compaction 缺口要求暂不对外暴露 Cline。所有平台回到 NotQualified，
移除设置、新手引导、成员选择和安装引导入口；已存身份、配置与历史保持可读，官方 ACP 实现保留。
没有重新引入 Hub、版本或账号白名单。当前范围见 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md#cline-实施边界)，
理由见 [V1.72-D31](decisions.md#v1-72-d31)。下文 Cline Preview 与各轮成功均为此前实施证据。

Command Code 1.74.1/1.79.1 的 BYOK 默认 first/warm/cold 本轮真实通过，两种 ACP 显式模型选择均被
原生目录拒绝。OpenCode/Pi 以合成 Provider 完成切换与恢复对照；生产模型目录继续尊重原生广告，
未伪造显式支持。见[模型选择报告](../../research/command-code-runtime/model-selection-2026-10-09.md)。

## Cline 官方 ACP 与 Hub 退役（2026-10-08）

User 95 已替换此前 Hub 方向。Cline 唯一执行链为选中安装的 `cline --acp` 与共享 ACP Host/Fleet，
恢复原生不可变 System Rule、工具解码、审批、监控与 session/load 重放隔离。删除 Hub 代码、依赖、
专属登录 UI/IPC 和测试入口，保留 Pi 结算与通用进程回收。不恢复版本、账号白名单或强制 cold。
旧 Hub Binding 仅在新输入前按共享不兼容替换，公开数据及原生历史保留；不迁移或重放旧输入。
当前合同 [Runtime Launch v54](../../contracts/runtime-launch-and-verification-v54.md)，理由
[V1.72-D30](decisions.md#v1-72-d30)，[输入说明](model-context-change-cline-acp.md)。
实际结果见 [ACP 退役验收](../../research/cline-runtime/acp-retirement-2026-10-08.md)，旧 Hub 报告均为历史证据。
切换时保持 Preview，现已按上节撤回；ACP compact 缺口和实际安装的能力失败不宣称修复。后端切换本身不改 schema；主干合流迁移见下节，current_version 不变。

## 主干与 Preview 数据合流（2026-10-08）

当前 schema 为 **139**。Migration 184 / schema 134 在主干用于继续执行，在 Preview 用于 Cline catalog；
Migration 185 / schema 135 在主干用于结构化 Mission 描述，在 Preview 用于 Command Code catalog。
Classifier 按完整结构、收据及旧 classifier 识别来源，拒绝部分结构，不能只凭编号推断已具备能力。
Migration 186 将两边的 catalog 与继续执行结构汇合到 schema 136；Migration 187 保留主干已有的
Mission 描述 Atom，或为 Preview 回填原文字，统一到 schema 137。结构、收据与 marker 在同一事务提交。
随后主干 `c2281636` 的 Migration 186 / schema 136 已交付直接回复索引；该来源不具备 Preview catalog。
Classifier 按结构区分两种 186，先保留主干已有描述，再由 Migration 188 原子收敛 catalog 与索引到 schema 138。
既有 186 收据不改写，已存在的索引和结构化描述不重建；Preview/137 则只补索引。
旧业务行、冻结证据、结构化提及和继续执行授权不重建、不重投；失败一起回滚。既有迁移 owner 覆盖
两种 134、两种 135、136 来源和写入失败；下文旧编号仅描述当时分支状态。

主干 `81f8b1fc` 的 Migration 187/schema 137 已包含 Mention v33，Preview 的同编号只包含 Mission 描述。
合流保留两种完整格式来源与原 187 收据：先由 188 补齐 catalog/索引，再由 189/schema 139
为旧格式扩展 Mention 约束；已有 v33 只补收敛收据，不重建表或重算冻结记录。部分 v33 结构拒绝升级。

## 并行实施：Command Code 与 Cline

合入主干 `b2c9c976` 后，Command Code 内部 headless transport 与 Cline 官方 ACP Host 适配当前
Usage v8 / Execution Metrics v7。真实 sub2api/gpt-6-sol 调用取得 input、output、cache read/write，
Cline 另有可选 reasoning；最新根调用输入独立投影 Context used。初轮窗口、比例和费用未知，
不增加指标定时器或输出测速。[真实数值、测试与层级边界](../../research/runtime-monitoring/command-cline-verification-2026-10-04.md)
区分 Core 传输/Host 证据与产品路径，两个 Runtime 都没有由此取得 First-Class。

随后 Cline 在隔离打包 App 中配置叮叮、芝士并完成四轮真实发送：首次、warm、第二名队员、App/Core
重启后的精确 cold 恢复；公开回帖来自 bundled CLI，17 次模型调用的 Usage 与 Context 已持久化，
执行面板可查看 toks 与已知 Context used。[开发包验收](../../research/cline-runtime/app-send-verification-2026-10-04.md)
记录原生未知字段、空闲关闭清理和仍未完成的能力矩阵；本轮不改变模型上下文方案。

文件复核修复 Cline 单文件读取/编辑的标准 location 映射，两名成员在更新开发包中真实读取、编辑、
读回，执行面板文件名与可点击预览均通过。Command Code 内部 Activity 保留原生 file_path，并为已选
Yolo 补齐 headless 写入所需的原生开关；当时只查询普通模型列表，未取得 BYOK 的窗口值。
[文件与上限证据](../../research/runtime-monitoring/command-cline-files-context-2026-10-04.md)区分 App 和内部传输。

编辑内容随后按 [File Change v7](../../contracts/runtime-file-change-observation-v7.md) 接入：Cline 成功 Update
补丁和 editor 替换保留为有明确来源标签的补丁片段，Command 可展开增删，Files Changed 保留按序统计；
Command Code 内部 normalizer 同步候选映射。真实两成员、多文件与连续改回、失败编辑、命令输出、零发送恢复
及能力发现复核见[差异验收](../../research/runtime-monitoring/command-cline-parity-2026-10-05.md)。

后续窗口补查在同一 Provider 的版本化模型目录取得精确 `gpt-6-sol` 默认窗口 272000、最大可选窗口 872000。
Cline observer v2 补齐原生模型配置快照与实际 Provider/模型匹配，沿现有 Session Gauge 展示窗口，
不修改 Bootstrap/Dynamic Context、费用合同或 Renderer 布局；配置和真实验收边界见
[窗口补采](../../research/runtime-monitoring/command-cline-context-window-2026-10-05.md)。

Cline 增加 closed Runtime/Skill identity、共享 Host 接线与 Migration 184，从 schema 133 升为 **134**，
macOS arm64 按 [V1.72-D23](decisions.md#v1-72-d23)开放开发 `Preview`，其余平台保持 `NotQualified`；
完整资格仍在实施。Command Code 随后接入官方 1.74.1 ACP 与共享 Fleet，Migration 185 升至 schema **135**，
也仅在 macOS arm64 开放 Preview。按 User 后续修复要求，Bootstrap 从旧候选 first_payload 改为受管
System Mod；[revision 5](model-context-change-command-code-acp.md)与 [V1.72-D25](decisions.md#v1-72-d25)
记录加载门禁、逐 Session 绑定与失败收敛。Cline 随后按 User 明确指示改为正常 System Rule，
不再以故意缺失插件的极端场景阻挡。冻结 B 逐 Session 绑定、user P 独立，见
[Cline System revision 2](model-context-change-cline-system.md)及 [V1.72-D27](decisions.md#v1-72-d27)。
共享 Core 的 Command 门禁与常驻接线已过；原生默认 BYOK 路径已解决先前额度阻碍，真实模型 A→B→A、
exact cold、手动/自动压缩后连续性及 App 文件/CLI/warm/重启验证通过。显式自定义模型切换仍被上游拒绝，
因此保留原生默认哨兵而不伪造目录。Cline ACP 未传 compaction 配置，真实探针未得到完成信号。完整 14 轴对照与实际验证见
[最新 Checklist](../../research/runtime-monitoring/command-cline-checklist-2026-10-05.md)。

后续真实强杀验收修复共享 ACP leader 退出观察、macOS 身份绑定的后代清理与 Core 启动 ledger 回收，
并将已交付输入丢失后的领域终态和公开投影对齐现行恢复合同。两 Runtime 的 Runtime/Core/App SIGKILL、
超过 75 秒无迟到写入、cleanup 后排队输入自动成功均通过。Command 官方 resume/load 会接受不存在历史，
已增加官方 session/list 精确 ID/cwd 门禁；有效 cold 的 Session/Binding/generation 保留通过。
范围、失败候选和平台限制见[故障恢复验收](../../research/runtime-monitoring/command-cline-fault-recovery-2026-10-05.md)
与 [V1.72-D26](decisions.md#v1-72-d26)，不改变两者 Preview 或未闭合的上游差异。

2026-10-06 追加完成 Command 原生私有 MCP 配置与 Cline System 新包真实验收：两者 first/warm/cold、
文件工具与显式 CLI 发送通过；MCP cwd、字面 env/headers、原生同名优先和更新/撤销边界通过。
同一服务器 Cline 的 stdio/HTTP 真正调用成功，Command 当前 BYOK deferred tools 仍只发现未调用。
完整 14 轴、9 Golden Flow 与剩余限制见[追加验收](../../research/runtime-monitoring/command-cline-native-system-2026-10-06.md)。

本切片更新 Runtime Catalog/Monitoring 架构、兼容性清单、研究矩阵、测试说明与当前决定导航。
活动目录加入 Cline 的保守 run_level 条目，复用既有 ACP typed kind，不改变 activity-v4 或旧 Runtime 解释。
既有 Usage/Execution Metrics 合同足以表达数值，无新字段合同、Renderer 布局或根 README 支持声明。

## 普通执行默认无时间上限

新执行省略预算时沿用 schema 2 的无时限表示；显式有限时长不再统一截断到 24 小时，数量限制、溢出校验、
Automation 超时与恢复隔离保持。既有冻结预算不改写，预算等待继续按有效 deadline 工作。
范围与验收见[实施记录](implementation-plan.md#2026-10-08-取消普通执行默认-24-小时上限)。

## 移除 Core 全局 heartbeat

按 User 批复移除 legacy 500ms maintenance：Single Chat/non-batch、取消和 Runtime 授权响应由提交后通知推进；
Automation、预算和文本收尾按业务 deadline／实际失败退避等待。保留普通 Delivery 的单一 Scheduler 与原有
低频恢复，不新增持久队列或调度框架。原消费者、计时器和验证边界见[验收记录](heartbeat-removal-verification.md)。

## 续做操作退出公开消息

User 已授权停止发布新的续做公屏记录并合入、安装；最新范围见 [r3 输入／历史对照](model-context-change-quiet-continuation.md)。
续做不新增消息，Migration 188 / schema 138 仅调整内部队列来源及独立 FIFO 序号；
已生成的记录、原输入、现有锚点、清理与冻结证据保持。

## 并行实施：用户主动继续执行

User 已确认 [r2 输入对照](model-context-change-run-continuation.md) 并授权独立 worktree 实现、推送。
[AgentRun Continuation v3](../../contracts/agent-run-continuation-v3.md) 将新授权接入现有 waiting lane；
每次完整选择原业务输入，现有 builder 重建当前上下文，同一来源可多次独立执行。按钮为 24×24 纯图标，
原卡片状态不关联新 Run。Migration 184 / schema 134 增量保留旧证据；实现与验证见
[续做实施记录](run-continuation-implementation.md)。

Task 准入修正按 [Camp Message Send v25](../../contracts/camp-message-send-v25.md) 保留发送时明确关联，
提交和领取均检查全部原业务输入，不依赖 batch Run 的单值 `task_id`；提示词及 Schema 不变。
2026-10-08 按 User 可用性优先要求取消新会话确认，复用正常 Runtime 的兼容判断，允许投递前一次降级；
旧输入未知时在清理完成后自动选择新会话，工作区和提示词保持不变。
后续真实验收发现的进程树清理、ACP 启动结算、旧 Session 引用保留与投递前降级问题，
修复和逐 Adapter 验证见[续做可靠性验收](continuation-reliability-verification.md)。提示词保持不变。

## 并行实施：Member CLI

User 于 2026-10-06 确认[提示词与接口 r1](model-context-change-member-cli.md)，授权实施、PR 和合入 main。
仅新增 member list/get/update，保留 create；六个身份字段和同一复合头像资产由 Core 原子 PATCH。
复用创建记录授权、命令幂等、版本、Run tmp 和失效通知，无数据库迁移、Runtime 配置或成员关系扩权。
当前字段合同见 [Transport v36](../../contracts/builtin-tool-transport-v36.md)。确定性回归与真实任务 Gate 状态
记录在[实施计划](implementation-plan.md#member-cli-最小增量)。

## 并行修复：Claude Code 模型发现与 Runtime 探测可用性

按用户确认，删除 256 KiB 单行与 4 MiB 累计 stdout 探测门槛，改为默认 64 MiB、按需增长、可调的单帧容量。
Claude 优先 list_models，仅明确不支持才兼容 initialize，两者共享超时和进程回收。目录失败保留已有模型、
选项和缓存标识，不阻止原样保存／执行；保留原生默认选择，不纳入任意模型 ID 输入、能力缓存、复杂重试或资源调度。
正式握手与真实原生拒绝保持有效。规范见 [Runtime Launch v48](../../contracts/runtime-launch-and-verification-v48.md#模型发现与探测容量)，
实现与环境证据见[验收记录](runtime-probe-availability-verification.md)。本地完整前端／默认 Rust 回归通过，
Claude 2.1.280 专用查询与 2.1.100 旧协议回退分别实测通过；Windows 2.1.289 未实测，不推断通过。

## 已撤销：Claude Code 与 Codex 自定义 API 配置

User 于 2026-10-07 明确取消此功能。移除两种智能体的连接方式、登录状态、地址、Key 和自定义模型表单，
退出原生写回、目录生成及专用观察接口。程序路径、环境变量、显式检查和本地保存继续保留。
已有原生文件、凭据及模型目录保持原样，执行由原生 CLI 处理；只读快照兼容与输出脱敏保留。
模型选择回到原生目录，不增加推理强度 fallback。当前合同为 [Runtime Launch v53](../../contracts/runtime-launch-and-verification-v53.md)，
实现与验证见[实施计划](implementation-plan.md#2026-10-07-移除自定义-api-配置)。此前编辑器的验证仅为历史证据，
见[原验收记录](runtime-custom-api-verification.md)。

## 设置保存收窄为本地提交

按用户 2026-10-07 的说明，保存不再触发环境捕获、程序发现、模型元数据命令、账号查询、Host 重启或列表重载。
普通启动设置继续保留字段合并、CAS 及后继执行兼容性；原生连接编辑随后按 User 要求退出。环境捕获与发现文件校验不占保存提交锁；
旧检查发布仍重验代次。新边界由 [Runtime Launch v51](../../contracts/runtime-launch-and-verification-v51.md) 拥有，
界面按回执结束加载；后续移除范围由 v52 覆盖。实施与确定性验证记录在 [实施计划](implementation-plan.md)。
此项属于用户明确指定的可逆控制流调整，不新增高迁移成本的架构决定。

## 并行修复：HTML 内部诊断 CSP 归因

保留作品安全策略，预览器只将当前内部诊断请求的明确 CSP 拒绝转为中性诊断不可用，并停止该文档的无效重试。
作者脚本、资源和业务策略错误继续可见，页面交互与文档状态不受辅助诊断影响。范围见
[File Preview v21](../../contracts/file-preview-v21.md)；真实浏览器回归覆盖严格 CSP、混合错误、导航及既有断流恢复。
本地 `pnpm test:html-preview` 的 5 项浏览器／Electron 测试通过；严格 CSP 只出现一次内部拦截且作品问题数为零，
混合场景保留 4 项真实错误。TypeScript、完整 `pnpm test`、默认 feature Rust workspace、桌面构建及通用文档门禁通过。

## 并行交付：消息寻址与执行查询

User 于 2026-10-03 确认[方案 r2](model-context-change-thread-runs.md)和[完整提示词对照](thread-runs-prompt-comparison.md)，授权实现、PR 与合入 main。
本次补齐 thread read 正常条目的 addressing，新增 thread runs 的统一执行/排队查询；范围由
[Camp History v11](../../contracts/camp-history-v11.md)、[Thread Runs v1](../../contracts/thread-runs-v1.md)和
[Built-in Transport v35](../../contracts/builtin-tool-transport-v35.md)拥有。旧 Session 保留冻结 Bootstrap，Skill 沿原路径更新；无数据库迁移。

## 已实现：User 统一称呼

[上下文变更说明 r2](model-context-change-principal-user.md)与[完整前后对照](principal-user-context-comparison.md)
整理 Principal 改为 User、`--to-user` 与 `@User` 的已确认文本和兼容边界。旧 Native Session 保留原绑定及冻结
Bootstrap，尚无 Bootstrap 的公开执行统一使用当前公开模板；Skill 沿用随包原路径同步。
用户已于 2026-10-02 确认 r2、创建 PR 与合入 main，并免除上下文 Gate 模型评测。实现及本地兼容回归通过，准备 PR 合入；当前规范见 [User Naming v1](../../contracts/user-naming-v1.md)。

## 并行实施：Thread 统一命名

Principal 已确认 [Camp → Thread r2](model-context-change-thread-rename.md) 开始实施：公开范围使用 `threadId`，
回复链用 `--reply-chain`，兼容旧 Camp 输入，保留旧 Native Session 的绑定与 bootstrap，并沿用 Skill 原路径更新。
实现已完成，完整模型文本见[前后对照](thread-rename-comparison.md)；测试证据与真实任务 Gate 缺口见[验收记录](thread-rename-verification.md)。
main 原 Migration 178 / schema 128 只扩展新 Context 的准入；与指标分支合并后由 Migration 180 收口至 schema 130，兼容已安装指标 schema 128/129 与 main 的 Thread schema 128，不迁移 ID、目录或旧 Session。

前置：[v1.71](../v1.71/README.md)。本版把 Lark 从飞书 provider 下未接通的品牌选项，改为与飞书、钉钉并列的独立渠道。
飞书与 Lark 可以同时连接各自的开发者账号，同一队员可以同时拥有飞书 Bot 与 Lark Bot，两家的账号、Bot、会话和
失败互不影响。

## 目标与边界

- 新增 provider `lark`：独立 Host 身份、5 张与飞书结构等价的表、8 个领域命令类型、21 个 `channels.lark.*` 请求。
- 不复制飞书实现：Core 以 `ChannelProviderSpec` 参数化飞书领域逻辑，Main 以 Provider Profile 创建第二个渠道服务实例。
- 可信域、登录配置与 SDK 域按 provider 分离；飞书 provider 收窄为只接受飞书品牌，不再接受 `larksuite.com`。
- 三张在 CHECK 中写死 provider 值域的中立表重建，两个目录视图增加 Lark 分支；飞书与钉钉既有数据不改写。
- Renderer 增加 Lark 页签、会话来源前缀与未验收提示；自动化通知可以选择 Lark。
- Lark 话题派发沿用群 roster 新鲜度和成员存在性检查，刷新请求与 Bot 发布状态均按 provider 隔离。
- Lark 入站图片与文件复用共享持久下载队列，以独立 Host 完成请求结算，下载完成后作为 Source Ref 进入 Agent 输入；真实租户文件收发仍待验收。
- Lark 绑定 Thread 按已确认的 [Send R3](model-context-change-send-file-guidance.md)注入渠道文件交付提示，沿用飞书原文与冻结 Bootstrap 边界。
- 不宣称支持 Lark。登录协议、控制台发布与客户端交互在真实 Lark 租户逐项验收前保持未验证。

字段与请求面见 [Lark Channel v1](../../contracts/lark-channel-v1.md)，飞书收窄见
[Feishu Channel v17](../../contracts/feishu-channel-v17.md)，组件与权威见[Lark 渠道架构](../../architecture/lark-channel.md)，
取舍理由见[版本决定](decisions.md)，实施切片与验收见[实施与验收](implementation-plan.md)。

## 当前状态

Principal 于 2026-09-24 确认方案 B：克隆表族并参数化飞书实现。S1 到 S5 已实施并通过自动化验收，状态为
`in_progress`；Lark 切片只剩 S6 真实租户逐项验收。本版最初以 v1.67 的编号，在基线 `ec290dc6` 上实施；上游随后发布了
v1.67 到 v1.71，并用掉 Migration 171 到 175。本版顺位为 v1.72；合并最新主线时，Migration 174 用于 public history claim，175 用于通知模型，Lark 迁移因此顺延为
Migration 176，数据合同为 v1.72 / schema 126。实施计划中的 S1 到 S4 记录保留原基线上的证据，每次改号后的门禁结果另行记录。

2026-09-27 在主线 `0f7b101a` 基础上补充 Lark 入站资源下载，扩展原有 Host 请求面和 Source Ref 准入；
既有飞书、钉钉附件流程不变。该补充的自动化验收与真实租户边界见[实施与验收](implementation-plan.md)。

未决事项：

- 真实 Lark 租户逐项验收：扫码连接和基础对话已由 Principal 手工跑通，逐项证据见[真实租户验收记录](lark-tenant-qualification.md)。
- 编号：上游作者已在 Issue #523 确认独立 provider 的边界，并约定版本号顺位继承、合并冲突时再处理。#517 先合入并占用
  v1.70 与 Migration 173；随后 #549 使用 v1.71 与 Migration 175，本版使用 v1.72 与 Migration 176。

## 并行交付：钉钉出站增量

在当前主线的钉钉渠道上补齐 Agent 显式图片及平台文件消息出站，并改为按 HTTP 状态/传输错误类型判定
Outbox 重试。范围仅限 DingTalk Host 和其 Open API 适配器，Core 的 delivery schema、Camp 消息与 Lark
版本目标不变。当前行为由 [DingTalk Channel v14](../../contracts/dingtalk-channel-v14.md) 拥有；真实钉钉租户
上传与消息呈现尚未验收，网络响应丢失的重复投递风险在合同中单列。

钉钉入站真实租户验证发现平台返回 HTTP 签名图片链接，原 Host 的 HTTPS 限制导致消息无法准入；
本次按 [V1.72-D04](decisions.md#v1-72-d04) 使用原始签名链接，并在附件终态失败时撤回已发送的排队卡。
旧失败请求不会自动重跑，新消息仍需真实租户验收。

Principal 后续要求三种渠道在附件下载期间不另发状态卡；资源未就绪时不创建排队卡，
普通已就绪消息仍可发送排队确认，附件终态失败仍发送提示。
本机钉钉私聊的 `rovai send` 直接投递因缺少 App 范围内的收件用户 ID 返回 HTTP 400；
领取投影现从绑定会话的外部 Principal 补齐该 ID，旧失败投递不自动重放。

## 并行交付：侧栏读取与 Skills 发现

按 Principal 对会话切换卡顿的评审，侧栏改用按行、按组和摘要完整快照读取；Navigation Read v1 的
Migration 177 从 v1.72/schema 126 升到 schema 127，只在 camp 增加摘要字段，不新增业务表。
首次发布的用户消息推进排序，首次发布且未撤回的 Agent 消息推进未读回复；Run 终态本身不产生新回复标记。
同时，原生 Skills 发现由上下文缓存改为目录缓存，容量 128 个目录、TTL 300 秒；同目录在途扫描和一次 Camp
手动刷新均去重，不预热或增加异步订阅。取舍见 [V1.72-D02](decisions.md#v1-72-d02)，实现与验收记录见
[实施计划](implementation-plan.md)。

## 并行交付：执行指标

Context 当前按 [Execution Metrics v7](../../contracts/runtime-execution-metrics-v7.md) 与输入确认解绑；当前 Session 原生观测经既有低频 Flush 提交并通知可见面板。同一实际模型及有效配置允许复用已确认窗口，ZCode 增加模型调用结束/压缩事件触发的合并读取。没有新增数据库表、指标定时器或测速；同次 App 证据与限制见[上下文运行中可用性收口](../../research/runtime-monitoring/live-context-usability-2026-10-04.md)。

2026-10-03 的 [Execution Metrics v6](../../contracts/runtime-execution-metrics-v6.md) 首先修复 Claude 最新根调用输入桶齐全时发出 used-only；当时其他 Runtime 的确认/采样限制见[运行中 Context 复核](../../research/runtime-monitoring/live-context-verification-2026-10-03.md)。

2026-10-02 按用户要求移除指标专用 CLI 版本门槛，保留产品最低版本资格；补接 CodeBuddy 最新调用占用、Kiro 原生百分比、TRAE 本地 Usage 与 Antigravity 根 step Usage。OpenCode 1.18.32 真实恢复验证通过，失败占位零不再清空 Context。字段支持、未决项与原始到数据库读回证据见[原生格式兼容验收](../../research/runtime-monitoring/native-format-compatibility-2026-10-02.md)。本切片不改变 schema、模型上下文、测速退役结论或界面布局。

执行面板的可见范围读取、隐藏暂停、终态有限尾读与引用复用已收口；2026-10-01 时周期 Flush 只为终态迟到数据
增加落盘后失效提示，v7 扩展到运行中有效提交。生产 Renderer 的 500 Run 动态验收、最低层竞争和字段引用证据见
[读取生命周期验收](../../research/runtime-monitoring/execution-metrics-refresh-verification-2026-10-01.md)。

执行台分别呈现每 Run 原生四项用量与当前原生 Session 上下文。2026-10-02 按用户要求移除全部 Runtime 的输出测速，包括 Core 字符计数、临时接口、前端轮询与显示；思考内容仍隔离于公开 Evidence 和 Renderer。用量复用 Monitoring Run summary；Migration 178 增加当前 Session 上下文小投影，把 v1.72/schema 127 升至 schema 128；Migration 179 以原子增量升级现有 schema 128 至 129，保留当前上下文数据并独立承接原生比例，不从比例反推数量；Migration 180 在合入 Thread 命名后收口至 schema 130，保留两条已部署路径的业务数据和冻结证据。没有真实回包的 Runtime 字段维持未验证，不回填历史 Run 的结束上下文。字段与 UI 规则由 [Runtime Execution Metrics v7](../../contracts/runtime-execution-metrics-v7.md) 和 [Camp 会话工作区](../../ui/components/conversation-workspace.md#camp-执行过程) 拥有；最新用量、上下文和 App 核验见[原生边界验收](../../research/runtime-monitoring/native-boundaries-verification-2026-10-01.md)，早期[第二轮记录](../../research/runtime-monitoring/execution-metrics-verification-2026-09-29.md)和[v3 长回合验收](../../research/runtime-monitoring/observable-output-v3-verification-2026-09-30.md)保留各自范围。

## 并行交付：公开 Composer 队外 Mention

Active Camp 中的用户可以从 `@` 候选选择资料仍在的队外队员。正文保留每处提及；发送时按身份去重，先逐人加入
Camp，再走现有消息发送命令。任一加入失败则保留草稿并停止发送；已加入成员不会回滚。Pending Camp 首条输入
仍走原激活路径。实现边界见[Public Camp Composer](../../architecture/camp-composer-draft.md#发送)与
[结构化 Mention](../../ui/components/structured-mentions.md#member-typeahead)，取舍见
[V1.72-D05](decisions.md#v1-72-d05)。

## 并行交付：渠道网页执行台还原

飞书、Lark、钉钉共用的局域网只读执行台按已确认交互稿还原桌面执行面的 Run 卡头、状态图形、工具组、命令结果和
Markdown 正文；网页外壳保留 Camp 标题、触发消息、只读标记及默认折叠的执行历史。网页服务继续只返回现有公开
Snapshot 与 SSE，不增加私有 Evidence、文件差异、写操作或新数据权限。具体交互见[渠道设置 UI](../../ui/components/channel-settings.md#局域网执行台设置)，
构建和浏览器验收记录见[实施计划](implementation-plan.md#2026-09-28-渠道网页执行台还原)。真实渠道内嵌浏览器与租户验收仍独立进行。

## 并行交付：当前版本发布日期

“关于与更新”当前版本的发布日期改由随包、与版本号绑定的元数据提供。v0.4.0 的值对照正式 GitHub Release
发布时间写入；Desktop 与 Desktop 托管的 Web 页面均可离线展示。版本提升时，元数据与更新日志必须一起更新，
桌面构建在打包前拒绝旧版本号或无效日期。元数据缺失或与运行版本不符时仍明确显示日期未知，不借用构建时间或
新版候选日期。日期来源由 v6 引入，当前合同入口为继承其规则的 [App Update v7](../../contracts/app-update-v7.md)，验证见[实施计划](implementation-plan.md#2026-09-28-当前版本发布日期)。

v0.4.1 发布后补齐候选版本的日期兼容：macOS 合并清单保留日期字符串，Main 同时归一化更新器可能返回的
日期对象；真实 Provider 解析器覆盖生成端和消费端的回归。见[补充验证](implementation-plan.md#2026-09-29-候选版本发布日期兼容)。

## 并行交付：Claude Code 权限审批

Claude Code 保留 `--print` 结构化输出，增加 stream-json 输入与 stdio 权限处理。原生 request_id
与 tool_use_id 分别绑定审批回复和实际工具结果，复用 Action/Approval Dock。初始化成功才发送任务，
会话 idle 与末轮结果共同控制 stdin 关闭；取消与断线撤销请求。当前合同见
[Runtime Launch and Verification v49](../../contracts/runtime-launch-and-verification-v49.md)，取舍见
[V1.72-D06](decisions.md#v1-72-d06)。

审批选项补充原生建议的显式记忆：一次允许不保存规则，记忆由 Claude 保存选中的范围和 destination，
请求的 suppression 仍有效。Claude 使用 CLI 2.1.280 已核实的原生英文按钮文案，中英文界面一致；
历史两个旧中文 host 标签只作展示兼容。Dock 不额外显示配置文件说明，选项放得下一排时同行排列，不足时换行。
验证记录见[原生选项补充验收](implementation-plan.md#2026-09-30-claude-原生选项与规则记忆)和[审批选项展示收敛](implementation-plan.md#2026-09-30-审批选项展示收敛)。

## 并行交付：Agent 指令英文化

按 Principal 确认的 r5，将会进入 Agent 上下文的 9 项发布 Skill（30 份 Markdown）和三处系统／CLI
短文本改为简洁英文。完整原文、替换内容、确认记录及验证边界见
[模型上下文变更说明](model-context-change-agent-english.md)。实际用户内容和回复语言保持。
旧会话沿用冻结 Bootstrap 继续 resume，新会话首次生成英文索引；内置 Skill 沿用既有固定路径同步。
不提升会话兼容版本、不新增迁移。工具箱共用的说明原文随资源显示英文。

## 并行交付：Sidecar 行操作与未读提醒

按确认的 v3 交互稿实现项目/对话的右键、三点、键盘与长按共用菜单。行操作默认隐藏；对话的运行与未读
独立并列，悬浮后由最右侧三点替换，运行环沿用中性灰。项目创建入口复用 New Chat 图标，菜单增加系统目录
定位和复制路径。手动未读随本机偏好保存，真实查看水位保持；失败或缓存预览不清除提醒。
当前语义见[统一侧栏](../../ui/components/app-shell-navigation.md)、[Navigation Read v1](../../contracts/navigation-read-v1.md)
与[侧栏刷新](../../architecture/desktop-navigation-refresh.md)，验收见[实施记录](implementation-plan.md#2026-10-02-sidecar-v3-交互实现)。

## 并行交付：队员运行配置应用

按 User 确认的交互稿，在原队员设置中增加一次性的“应用到其他队员…”：中英文、Desktop 与 Mobile
复用同一组件和原有单队员命令，逐人检查版本、保留草稿并呈现部分失败与结果未知。源配置和已确认目标版本
冻结于用户审核的选择，不建立长期同步；不改新手训练、数据库、Host 请求面或模型上下文。
当前行为见[队员配置 UI 合同](../../ui/components/member-identity.md#应用运行配置到其他队员)，证据见
[实施记录](implementation-plan.md#2026-10-02-队员运行配置应用)。

## 训练营默认队员 Runtime 配置复制

2026-10-05：训练营配置成功时，将用户选定的 Runtime、完整模型参数及默认权限自动应用到其余未配置的
内置队员；首次会话仍只加入选中队员。复用现有 Core 单队员命令，Desktop schema 3 持久化逐人计划与恢复
检查点。已配置、已移除和并发修改的目标保留原状，已完成用户不补写；不新增 Core 表、模型上下文或训练页面。
当前字段与恢复边界见 [First-run Onboarding v6](../../contracts/first-run-onboarding-v6.md)，验证记录见实施计划。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.71 冻结为 historical；本概览、[实施计划](implementation-plan.md)、[版本决定](decisions.md)与[版本索引](../README.md)建立唯一 current v1.72 |
| Decisions | 已更新 | [V1.72-D01](decisions.md#v1-72-d01)记录独立 Lark provider；[V1.72-D02](decisions.md#v1-72-d02)记录侧栏摘要与范围读取；[V1.72-D03](decisions.md#v1-72-d03)记录 Lark 入站附件复用与 Host 隔离；[V1.72-D04](decisions.md#v1-72-d04)记录钉钉签名链接与旧排队卡收口；[V1.72-D05](decisions.md#v1-72-d05)记录发送前邀请；[V1.72-D06](decisions.md#v1-72-d06)记录 Claude 原生双向审批，并新增 [V1.72-D07](decisions.md#v1-72-d07) 记录 Thread 命名及旧绑定兼容，均同步当前决定导航 |
| Contracts | 已更新 | 新增 [First-run Onboarding v6](../../contracts/first-run-onboarding-v6.md)，以 Desktop schema 3 冻结逐人 Runtime 复制与恢复；发布 [Lark Channel v1](../../contracts/lark-channel-v1.md)与 [Feishu Channel v17](../../contracts/feishu-channel-v17.md)，Feishu v16 降为历史；补充 [Navigation Read v1](../../contracts/navigation-read-v1.md)、[Skills Rebuild v2](../../contracts/skills-rebuild-v2.md)、[App Update v7](../../contracts/app-update-v7.md)（继承 v6 日期来源，增加双语发布与 Renderer 显示副本选择）、[Runtime Launch v49](../../contracts/runtime-launch-and-verification-v49.md)与钉钉出站 [DingTalk Channel v14](../../contracts/dingtalk-channel-v14.md)；Composer 邀请只组合现有成员加入与发送命令，不改变两者合同；公开命名由 [Thread Naming v1](../../contracts/thread-naming-v1.md) 覆盖，新上下文与工具输出分别为 [ContextManifest v32](../../contracts/context-manifest-evidence-v32.md) 和 [Built-in Transport v33](../../contracts/builtin-tool-transport-v33.md)；新增 [Transport v41](../../contracts/builtin-tool-transport-v41.md) 与 [Member Avatar v4](../../contracts/member-avatar-v4.md)，统一 Agent 头像读取及内置取景坐标 |
| Architecture | 已更新 | 新增 [Lark 渠道架构](../../architecture/lark-channel.md)；[飞书渠道架构](../../architecture/feishu-channel.md)移除 `larksuite.com` 并改指 v17；[侧栏刷新](../../architecture/desktop-navigation-refresh.md)与[Skills 来源](../../architecture/skills.md)说明局部读取及目录缓存；[钉钉渠道架构](../../architecture/dingtalk-channel.md)补齐原生附件出站与重试边界；[Public Camp Composer](../../architecture/camp-composer-draft.md#发送)说明邀请与发布命令边界；[Desktop App Updates](../../architecture/desktop-app-updates.md)补齐随包发布日期来源；[架构导航](../../architecture/README.md) 明确 Thread 命名覆盖与稳定存储边界；[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md#claude-code-权限审批回调)说明 Claude 权限回调边界；[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)同步单头像物化与失败隔离 |
| UI | 已更新 | [渠道设置](../../ui/components/channel-settings.md)增加 Lark 页签、品牌显示与未验收提示，并明确只读网页执行台的历史区、生产组件及重连呈现；[Camp 命名](../../contracts/channel-camp-naming-v1.md)和[统一侧栏](../../ui/components/app-shell-navigation.md)补齐 Lark 来源及范围刷新；[结构化 Mention](../../ui/components/structured-mentions.md#member-typeahead)和[会话工作区](../../ui/components/conversation-workspace.md#camp-composer)说明待邀请反馈；公开英文名称统一为 Thread，中文继续用对话，草稿和导航持久状态兼容旧字段 |
| Runtime Activity | 确认无需更新 | Canonical Activity、Adapter mapping 与 Registry 的事件语义保持；Thread 只更新公开范围字段及读取投影，原始证据先验摘要 |
| Runtime compatibility | 已更新 | Claude Code 使用 `--print` 双向 stream-json 与原生 ID 审批；真实 Runtime 与 Desktop 点击证据记录在[兼容性台账](../../runtime-compatibility.md)，平台资格不据此扩大。Agent 指令英文化保持 Binding 兼容轴，生效边界见[变更说明](model-context-change-agent-english.md)；Thread 更名保留 Charter compatibility 16 与 Antigravity 原绑定工具身份 |
| Documentation routing | 已更新 | 文档任务入口、合同索引、架构索引、当前决定导航与版本指针路由到 Lark v1、Feishu v17、Navigation Read v1、DingTalk v14 与 v1.72；版本内新增[Agent 指令变更说明](model-context-change-agent-english.md)及完整对照；新增 Thread r2、前后对照、验收记录及上述当前合同入口；成员头像／CLI 当前入口切至 v2／v40，加入 [get R3 确认稿](model-context-change-member-avatar-read.md) |
| Root README | 确认无需更新 | Lark 未完成真实租户验收，按 Lark Channel v1 第 8 节不得在根 README 宣称支持 |

2026-10-01 的 Qoder／Grok／OpenCode Context 与 Copilot 重新核验见[字段与场景证据](../../research/runtime-monitoring/native-context-ratio-verification-2026-10-01.md)。schema 127 → 128 → 129 和已安装 schema 128 → 129 均有迁移 owner；179 失败时回滚字段、收据和 marker，旧数量保留且原生比例为空。

同日追加的[原生边界验收](../../research/runtime-monitoring/native-boundaries-verification-2026-10-01.md)补齐 Codex 真实压缩降值、四类健康冷恢复及 App 重开、Grok 同次思考速度 UI 和 OpenCode 显式有效窗口；Qoder 正缓存写只有明确标注的受控链路证据。默认 Provider 容量、真实正缓存写及异常恢复仍按记录保持未验证，不改变 schema 或字段合同。
## 并行交付：AI 优先添加队员

按 Principal 确认稿，名册只保留 AI/手动分段添加入口，列表直接拖拽排序并保留可调分隔线。
AI 创建使用一位可用协助者的普通草稿会话；三个起步提示可编辑，输入后出现窗口内侧栏草稿。
成功 `member.create` 产生静态入队回执，配置链接进入已有队员设置，右侧表单及离队资料行为保持。
Desktop/Mobile、中文/英文共用生产组件。

入队回执保存经认证的来源 Run，终态后按“最后回复 → 入队卡片 → Files Changed”展示；无公开回复时复用
Run 产物作者头。入队卡与文件卡共用桌面/窄列宽度、缩进和间距；旧回执保持可读，不按队员或时间猜测来源。

[Member Creation Flow v1](../../contracts/member-creation-flow-v1.md)拥有当前行为，
[V1.72-D09](decisions.md#v1-72-d09)记录取舍；原 main 的 Migration 180 将 schema 129 升为 130；与已安装指标分支整合后，当前 Migration 181/182 分别交付 User 投影与队员创建，该切片收口至 schema **132**；后续普通一键草稿修复由 Migration 183 升至 **133**。两条指标和 main 的已部署 128/129/130 来源只按完整结构与收据组合准入，原子收口且保留业务数据、既有收据时间和冻结证据。
[实施验收](implementation-plan.md#2026-10-02-ai-优先添加队员)区分自动化与真实模型/实体手机边界。
本切片不改变模型 Bootstrap、Tool Schema、上下文格式或发布 Skill。


2026-10-03 追加[五类原生来源验收](../../research/runtime-monitoring/native-source-completion-2026-10-03.md)：
Antigravity 四项与 Context、Qoder 数量、TRAE Context、Kiro 窗口已补接；仍区分原生缺失和未验证，
不把 null/null 一致当作字段完整。无 schema 迁移或测速恢复，比例数字统一一位小数。

## 并行交付：Run 内容块与 command 组分页

按 User 的 HTML 交互稿确认与 worktree/PR 合入要求，Run 主线按正文或完整折叠组分页；展开组按独立游标读取，
首次短内容自动补齐，失败保持内容并在原位重试。无新表、迁移、模型上下文或渠道公开数据变化。
当前合同为 [Run Process Detail Surface v46](../../contracts/run-process-detail-surface-v46.md)，理由见
[V1.72-D10](decisions.md#v1-72-d10)，实现与验证见[实施记录](implementation-plan.md#2026-10-02-run-内容块与-command-组分页)。
跨版本影响：Contract、读取架构、UI 和当前导航已同步；版本指针、Runtime 兼容、原始 Evidence、结果预算与根 README 无需变化。

## 并行交付：Windows 关闭选择与托盘

Windows 主窗口默认关闭时询问，可选择最小化到系统托盘或正常退出，并记住选择。通用设置可切换三种行为；
macOS/Web 不增加入口。托盘及第二次启动恢复原窗口，明确退出和更新重启继续现有受控退出。
[Windows Window Close v1](../../contracts/windows-window-close-v1.md)拥有字段与状态规则；
[实施验收](implementation-plan.md#2026-10-02-windows-关闭选择与托盘)记录自动化和真实 Windows 的证据边界。

## 并行修复：恢复普通一键新对话草稿

按 User 2026-10-03 的更正恢复问题出现前的交互：每次新建独立保存，同一项目可有多份草稿；非空输入进入侧栏，
切换、刷新、重建窗口和普通重启可恢复，失败发送保留输入，清空或成功发送后移除草稿状态。
内容沿用本机 store，Core 仅保留客户端 presence；Migration 183 将 schema 132 加性升级为 **133**。
[Pending Camp Activation v4](../../contracts/pending-camp-activation-v4.md)、[Composer Draft v16](../../contracts/camp-composer-draft-v16.md)
及对应 Architecture/UI/术语/导航已同步；理由见 [V1.72-D11](decisions.md#v1-72-d11)，证据见
[实施记录](implementation-plan.md#2026-10-03-普通一键新对话草稿恢复)。无模型上下文、发布 Skill、Runtime 兼容轴或根 README 变化。

2026-10-04 [上下文可用性收口](../../research/runtime-monitoring/live-context-usability-2026-10-04.md)
按 Execution Metrics v7 解除输入确认等待、复用有效实际模型窗口，并接入 ZCode 运行中事件触发读取。
旧轮次记录保留当时的限制；当前规则以 v7 为准。

## 并行交付：Runtime 安装发现与真实启动验证

启动和 rescan 只发现入口，安装展示“可用”，检查成功不追加说明；配置保存、Run 创建及派发不依赖历史 Ready。
协议、认证、显式模型/选项和权限在承载任务的 Host 内验证后发送正文；初始化及失败复用 Run 状态。
保留 Antigravity 和显式 Fast 最小兼容性检查，Fast 资格改为主动查询。
当前边界见 [Runtime Launch v49](../../contracts/runtime-launch-and-verification-v49.md)与
[Camp Member Fast v2](../../contracts/camp-member-fast-v2.md)，理由见 [V1.72-D12](decisions.md#v1-72-d12)。
不改变 schema、版本指针、权限默认、会话隔离、输入去重或模型上下文；不新增 LKG、健康快照或轮询。
验证记录见[实施记录](implementation-plan.md#2026-10-05-runtime-轻量启动)。


## 并行交付：Fast 偏好直接应用

User 于 2026-10-06 确认移除 Fast 专用资格链，沿用现有表、事务、三态及 Run 冻结。
Claude 直接传临时 settings，Codex 直接传单 Turn 档位；不再启动 Fast 版本、认证、schema 或元数据检查。
关闭值不被资格过滤，运行反馈只在对应 Run 中展示，不写回偏好。无迁移、资格管理器、兼容重启或 #642 链路重做。
当前规范见 [Camp Member Fast v3](../../contracts/camp-member-fast-v3.md)，理由见 [V1.72-D13](decisions.md#v1-72-d13)。
验证范围与限制见[实施记录](implementation-plan.md#2026-10-06-fast-偏好直接应用)。

后续收口保留 Thread 队员级存储与冻结，控件恢复二态；正常 Claude/Codex Host 初始化返回值补充
未覆盖时的显示初值，不解析原生配置、不启动额外探测，也不回写用户选择。
本轮验证见[二态与初始化值实施记录](implementation-plan.md#2026-10-06-fast-二态与初始化值)。


## 并行修复：Codex 失败 Host 回收

User 于 2026-10-06 授权在独立 worktree 实施并推送分支。Codex 仅原生 completed 有资格复用，失败进程沿既有清理门禁
和 worker 回收；初始化失败保留受管进程，冷恢复验证精确 Thread，未知投递沿既有 v6 轮换，正文不自动重放。
当前规范见 [Runtime Launch v49](../../contracts/runtime-launch-and-verification-v49.md)，改动与验证范围见
[实施记录](implementation-plan.md#2026-10-06-codex-host-失败恢复)。不改变数据库 schema、Runtime 容量策略或模型上下文。


## Run 思考反馈补充

当前思考反馈扩展遵循 [Run Process Detail Surface v46](../../contracts/run-process-detail-surface-v46.md)：
正文、计划和工具之后的根思考均可显示；活动工具与根思考并列，实际压缩、等待/取消/恢复和终态保留优先级。
Codex/Copilot 的合格原生短标题瞬时替换“思考中”；Claude 暂不接入短标题。实现与验证以任务分支测试和真实
Runtime Smoke 为证据，不从合同 accepted 状态推断所有 Provider 都能返回标题。


## 全会话用户消息导航

按 User 确认的范围，将左侧锚点改为完整用户消息目录，保留正文分页和现有外观。Core 只读取首条有效直接 reply 队员回复，
预览按需读取；锚点定位窗口独立且有界，分页入口与自动加载跟随正常连续区间。合同见
[Camp Open Projection v29](../../contracts/camp-open-projection-v29.md)，实现与验证见
[用户锚点验收](thread-user-anchors-verification.md)。这是局部读取正确性修复，不增加持久副本、全局缓存框架或时间线重构。

User 选定的 C 方案在悬浮／键盘预览中增加独立的 16px 回复队员头像与姓名行，下方继续保留三行摘要。
作者来自实际首条有效回复；旧 Host／缺失 Profile 保留原摘要。读取与样式规则分别归 v29 合同和
[会话 UI](../../ui/components/conversation-workspace.md#用户消息锚点)，验证追加到同一验收记录。

本轮以 `4563d23d` 为修正基线，修复缓存清窗和重同步可信状态，正文先显示再请求目录，格式化移出数据库锁，
消息提示在实际写入路径收集、提交后发送。主干最初的 Migration 186 / schema 136 仅增加直接回复组合索引，无历史回填；
本分支合流后由上节 Migration 188 / schema 138 保留该索引并收敛两种来源。

## 一键草稿邀请队外队员

User 于 2026-10-08 授权独立 worktree、PR 与 main 合入。Pending Composer 沿用待邀请交互，
首条 User inline 消息按 [Pending v5](../../contracts/pending-camp-activation-v5.md)和
[Send v26](../../contracts/camp-message-send-v26.md)原子加入、激活与投递；Active 保持逐人邀请。
无数据库或模型上下文格式变更。实施与验证见[实施计划](implementation-plan.md#一键草稿邀请队外队员)。


## 并行交付：使命描述提及队员

按 User 确认的交互稿与模型读取示例实现个人提及、保存时邀请队外成员和失败保留草稿。
[Mission v12](../../contracts/mission-v12.md)冻结结构与原子性，Migration 185 将 schema 134 升至 135；
模型 `mission get` 继续返回可读 description，不增加字段或修改 Bootstrap/Run Facts。
决定见 [V1.72-D18](decisions.md#v1-72-d18)，测试与交付证据见[实施记录](mission-member-mentions-implementation.md)。

## 消息 Mention 元数据统一

User 于 2026-10-09 确认[完整方案及补充边界 r1](model-context-change-message-mentions.md)。
仅公开 batch RUN_INPUT.messages 与 thread.read 正常条目改为 mentions；正文、作者、渠道和非 batch 保持。
新公开 Formatter/Manifest 33，Profile 10/Facts 9，旧 Run 和成功回执按原版本恢复，无 Session 轮换。
主干原 Migration 187/schema 137 只扩展现有格式约束；本分支合流后由 189/schema 139 保留或补齐。当前合同见 [Mention v1](../../contracts/message-mentions-v1.md)、
[ContextManifest v33](../../contracts/context-manifest-evidence-v33.md)、[History v12](../../contracts/camp-history-v12.md)。
状态与证据见[确认稿实施记录](model-context-change-message-mentions.md#实施与验证记录)。

## 异步执行收尾（2026-10-12）

正文定稿和 Usage 不再作为业务命令或 Run 终态的同步前置。Migration 194 发布 schema 144，保留
终态后的短期 Usage checkpoint。停止／继续复用既有授权与清理流程，不增加强制放行或自动重试。
范围、测试归属与验收状态见[实施记录](async-run-finalization.md)；当前统计合同为
[Usage v10](../../contracts/runtime-usage-monitoring-v10.md)。

## 同类 CLI 优先恢复原生会话（2026-10-12）

按 User 确认的可用性方案，历史配置和上下文摘要退出 Resume 资格；Adapter 的可靠恢复证据决定一次
新建降级，绑定成功前保留旧目标，输入接收/取消/执行代次保护不变。当前边界见
[Runtime Launch v60](../../contracts/runtime-launch-and-verification-v60.md)，实施与验收见
[实施记录](implementation-plan.md#同类-cli-优先恢复原生会话2026-10-12)。


## 移除会话队员重置入口（2026-10-13）

按 User 要求移除会话队员列表中 Desktop“…”菜单与 Mobile 按钮的“重置队员会话”，
同时清理专用确认弹窗、前端状态与不再适用的弹窗验收。其他队员操作和后端会话恢复保持。
边界见 [Runtime Launch v61](../../contracts/runtime-launch-and-verification-v61.md)。

## 执行记录存储精简（2026-10-14）

新操作组合预览去重与正常删除 Blob 回收登记见 [保存合同](../../contracts/execution-record-storage-v3.md)
及[实施记录](implementation-plan.md#执行记录存储精简组合预览与删除回收2026-10-14)。旧记录继续可读，日常实例不做历史清理。

新 Run 使用[实时会话目录](../../contracts/camp-history-v14.md)，停止写入开工目录快照；旧模式和消息正文边界保持。
验证见[实时目录实施记录](implementation-plan.md#执行记录存储精简实时会话目录2026-10-14)。

新操作自身承载活动元数据与按需 diff 展开，兼容旧活动读取；
独立验收与同负载测量见[第三项实施记录](implementation-plan.md#执行记录存储精简操作与活动统一保存2026-10-14)。

2026-10-15 继续精简新操作内部重复 diff、限定预览总量，并将进度摘要从结果正文中分离；旧格式原样兼容。
定向回归和同负载测量见[后续实施记录](implementation-plan.md#执行记录存储精简新操作正文与进度写入2026-10-15)。

## 2026-10-17 MiniMax 批复修复

共享 ACP 区分原生正常结束、有效公开发送和非空 final；问卷 permission fallback 在执行审批前取消。
MiniMax Usage 增加本轮消息身份限定的后台尾读，仍保持部分观测。字段与失败边界见
[Missing-Send v3](../../contracts/missing-send-recovery-publication-v3.md)和
[Usage v10](../../contracts/runtime-usage-monitoring-v10.md)。
0.6.12 官方 ACP 局部关闭 ask_user 的入口仍缺，未修改原生全局配置，不声称默认隐藏已交付。
Preview 的平台、CLI 子集、Skills/MCP 和并发资格边界不变。

## Send 输入文件退出文件变化卡片（2026-10-19）

按 User 确认方案，CLI 记录实际 `--input-file` 来源，复用本次 Send 执行记录；Core 在终态文件归约中排除
成功来源并重算统计，任意目录、多个来源与重启恢复共用现有机制。附件和原始操作保持，无表／列迁移或
模型上下文变更。当前规范为 [Transport v43](../../contracts/builtin-tool-transport-v43.md)与
[File Change v9](../../contracts/runtime-file-change-observation-v9.md)，验证见[实施计划](implementation-plan.md#send-输入文件退出文件变化卡片2026-10-19)。
本项为可逆的局部投影规则，不新增 Version Decision；同步当前合同、架构、UI 与导航，Runtime 原生映射和根 README 无需变化。

## App 退出中断提醒（2026-10-21）

当前实现 [Notification Episode v12](../../contracts/notification-episode-v12.md) 与
[Current User Attention v10](../../contracts/current-user-attention-v10.md)。Migration 210 / schema 160
在原 Migration 209 基础上关闭手动停止来源，保留历史事实和唯一 Disposition。
Cmd+Q 沿既有退出事务记录，强杀沿既有启动恢复确认；前台正式 Thread 展示后按观察边界确认。
User 进一步确认保留 App 运行期间的 Run 异常退出提醒，统一称“执行中断”，沿用已有 `execution_lost`。
删除 600ms 短亮、停止意图、精确准入描述及为中断添加的可见 Run 观察，普通执行进度不再触发通知读取。
多批结果独立接收，挂起批次不阻挡后续刷新。旧手动停止退出侧栏候选，不伪造已读。
复核修复排队确认遇到 reset、使命内容未挂载即确认、拉取中信号丢失与普通失败气泡可见来源误删；
不恢复短亮或逐 command 读取。具体场景与验证见下述实施记录。

取舍见 [V1.72-D55](decisions.md#v1-72-d55)，实施验证见[退出提醒验收](interruption-attention-validation.md)。

## 队员拼音检索（2026-10-23）

公屏、Pending 草稿与使命描述中的队员名字/角色增加拼音匹配，包含普通空格容错；
对话/使命标题及 Skill 保留原文检索，分类、身份、邀请和发送流程沿用既有机制。
当前规则见[结构化 Mention](../../ui/components/structured-mentions.md#member-typeahead)，
实现、分层验收及当前基线体积对照见[队员拼音检索验收](member-pinyin-search-validation.md)。
