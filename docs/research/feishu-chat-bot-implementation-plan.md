---
document_type: implementation-plan
authority: implementation-input-only
status: pre-implementation
revision: 3
last_updated: 2026-10-20
---

# 飞书聊天 Bot 实施计划

## 1. 基线与范围

- 唯一需求基线：[飞书聊天 Bot PRD v3](feishu-chat-bot-prd.md)。本计划只说明怎么实现，不新增需求；"不做"的内容以 PRD 第 10 节为准。
- 代码核查基线：`c69a97fb`。当前版本以 `docs/versions/README.md` 的指针为准，开始编码时重新核对；不预先占用迁移号或合同版本。
- 本计划未授权以下操作：编码、暂存、提交、推送、发送飞书消息、调用真实模型。

### 模型上下文治理

工作 Bot 不做任何改动。聊天 Bot 走新的独立路径，不使用 Native Session Bootstrap，也不使用 AgentRun Dynamic Context，所以按 [模型上下文变更治理](../development/model-context-change-governance.md) 不触发二次确认。

每个步骤完成时做一次影响核查：如果实际 diff 改动了工作 Agent 的 Bootstrap、Dynamic Context、工具或 formatter，就停下来，按原规则补变更说明并取得确认。

## 2. 总体结构

| 层 | 职责 | 不做 |
| --- | --- | --- |
| Renderer / Preload | 在现有 Bot 行内提供开关、聊天模型、资料文件夹设置；使用专用的窄 IPC | 不执行模型请求；不提供通用文件读取；不回显已保存的密钥 |
| Electron Main | 复用飞书连接和发送器；新增聊天服务、模型 HTTP 客户端、通讯录查询、资料读取 | 不调用编程 CLI；不把聊天消息转成工作任务 |
| Rust Core | 判断模式与准入；持久化聊天配置、会话消息、沟通事项和出站消息；校验动作 | 不信任模型自称的身份或权限 |

**分流规则**：入站消息在 Core 准入阶段按 Bot 模式分流。

- 工作 Bot：走现有 `admit_external_channel_message → Delivery → AgentRun` 链路，逻辑不变。
- 聊天 Bot：所有消息（包括 Owner 的消息）都进入聊天服务，不进入上面的工作链路。

## 3. 现有代码落点

行号会随代码变化，实施时重新定位。

| 位置 | 用途 | 限制 |
| --- | --- | --- |
| `apps/desktop/src/renderer/src/ChannelSettings.tsx` | 在现有 Bot 行内增加设置项 | 不新增 Tab 或管理台 |
| `apps/desktop/src/preload/index.ts`、`apps/desktop/src/main/index.ts` | 成对新增 channels IPC；文件夹选择沿用 `dialog.showOpenDialog` 的写法 | 密钥不进入 snapshot |
| `apps/desktop/src/main/channel-settings.ts` 入站处理（`owner.verify` 附近，约 1611 行） | 聊天 Bot 跳过"非 Owner 拒绝"，改为把消息转给聊天服务；工作 Bot 保持原逻辑 | 不把 owner.verify 改成恒定成功 |
| `channel-settings.ts` 约 1749 行的 `replyToMessageId` | 已经解析了引用消息 ID，直接用于答复关联 | 不用模型看到的引用摘要做关联凭证 |
| `crates/rovai-core/src/channel.rs` `observe_inbound` / `classify_and_record_feishu_owner` | 按模式分流；聊天 Bot 记录非 Owner 身份 | 不把同事身份合并成 canonical Owner |
| `apps/desktop/src/main/feishu-member-bot-provisioner.ts` 的 `MEMBER_BOT_MANIFEST_REQUIREMENTS.scopes` 与配置收敛流程 | 聊天 Bot 增加通讯录读取应用权限；工作 Bot 保持原权限 | 只为聊天 Bot 添加；不在切回工作 Bot 时主动撤销 |
| `crates/rovai-core/src/automation.rs` 中 Owner 通知的 claim/settle 和地址解析 | 参考其实现，用于"向 Owner 确认"的私聊发送 | 不伪造 AutomationRun |
| `apps/desktop/src/main/feishu-agent-output-card.ts` 中的稳定 UUID 分片 | 复用发送幂等的思路 | 聊天回复只发普通文字，不发卡片 |
| `apps/desktop/src/main/channel-credential-store.ts` | 参考 SQLite 私有存储的写法，保存模型凭据 | 不新建 keychain 或第二个数据库 |
| `crates/rovai-core/src/command.rs` DomainCommandGateway | 业务 mutation 复用命令幂等 | 不给轮询加持久回执 |

## 4. 关键设计

### 4.1 模型适配

- 只做一条 OpenAI-compatible Chat Completions 适配路径。Provider、endpoint、model、credential 都来自配置。
- 模型输出普通文字，或以下封闭动作之一：`reply`、`find_person`、`forward`、`ask`、`ask_owner`、`search_materials`、`close_item`。Core 校验后再执行。动作参数无效时，停止该动作并反馈错误，不猜测执行。
- 一轮对话中的动作循环有次数上限。工具结果不赋予新的权限。
- 用本地 HTTP stub 测试协议；真实 Provider 需要另行授权后再验证。

### 4.2 通讯录搜索

- 聊天 Bot 发布或从工作 Bot 切换时，在 Bot 应用权限中加入通讯录读取权限并发布；工作 Bot 不加入。
- Main 使用聊天 Bot 的应用身份查询，按姓名查找同事，只返回候选人的姓名和必要的部门信息供澄清使用。具体接口在步骤 0 中确认。
- 权限审批未通过、未发布生效或目标不在通讯录范围内时，只暂停按姓名找人；@、找 Owner 和已对话联系人照常。
- 结果只用于当前这次找人，不同步、不缓存整份通讯录，不向模型返回列表。
- 外部联系人只能从"已与该 Bot 对话过的身份"中匹配。

### 4.3 资料读取

- 选择文件夹时使用原生选择器，Core 保存目录引用和 Bot 绑定关系。
- 每次检索都实时扫描 `.md` 和 `.txt` 文件（包括子目录），用简单的关键词或片段检索，不建向量索引。不跟随符号链接和 junction，不读取目录以外的路径。
- 上限集中写在一个常量里：单个文件 1 MiB；每个目录 1,000 个支持的文件；每次请求带入的资料片段最多 24 KiB。超出时告知"资料不完整"。
- 资料片段不写入会话摘要。构建下一轮上下文时，删去之前资料答复中的片段内容，只保留"已回答过"这一事实。
- 出站消息领取发送前，检查绑定关系是否仍然存在；已解绑的资料答复直接丢弃。

### 4.4 持久化（只保存必需的事实）

| 事实 | 内容 |
| --- | --- |
| Bot 聊天配置 | Bot、Owner、开关、模型配置和凭据引用、资料目录引用 |
| 共享目录登记 | 目录路径和状态；多个 Bot 引用同一条登记 |
| 会话消息 | provider、App、会话、作者、正文、引用消息 ID、去重键、处理水位 |
| 沟通事项 | 请求者、回复目的地、被询问人、问题、询问消息 ID、已汇报水位、状态（等待 / 已汇报 / 已结束 / 暂停） |
| 出站消息 | 收件人、正文、来源、幂等键、lease、结果（成功 / 失败 / 未知）、外部消息 ID |

- 模型调用过程不持久化。重启后，对于已接收但还没回复的消息，按水位重新处理一次；出站消息靠幂等键防止重复发送。
- 复用现有的外部身份表和 Owner 映射。新的聊天表与 Camp/Delivery 分开，不为了复用 `channel_delivery` 而伪造 binding。
- 新的聊天入站消息按"接收 App + provider message ID"去重。

### 4.5 入站处理顺序（聊天 Bot）

1. 平台事件去重，识别 provider、App、会话、作者，以及引用消息 ID。
2. 群消息没有 @ Bot 的，忽略。
3. 答复关联（PRD F5）：先识别是否为新请求；新请求不进入待回复事项。不是新请求时，再看是否引用了已知询问消息；如果没有引用，再看这个人当前是否只有一件等待中的事项；如果有多件，请他澄清。关联成功后进入事项处理；否则当作普通聊天。
4. 事项处理：冻结本轮水位，让模型从新消息中提取与事项相关的部分，生成阶段汇报或补充汇报；与事项无关的部分作为普通聊天单独回复。
5. 普通聊天交给模型，模型提出的动作经 Core 校验后执行。

### 4.6 模式切换

- 一个 Bot 只能处于一种模式；切换只修改当前 Bot。
- 关闭开关（切换为聊天 Bot）前，检查聊天模型是否已配置，并提示该 Bot 将不再处理 Owner 的本地工作请求。
- 切换为聊天 Bot 时补加通讯录读取应用权限并重新发布；权限生效前不提供按姓名搜索。
- 切回工作 Bot 时不再使用通讯录权限，首期不主动撤销。
- 切换为工作 Bot 时：取消尚未发出的聊天出站消息；把未结束的沟通事项标为"暂停"；停止受理非 Owner 的消息。
- 切换回聊天 Bot 时：暂停的事项恢复为"等待"；已取消的消息不补发。
- 聊天 Bot 不读取、不复用该 Bot 原有的 Camp 工作会话。

## 5. 分步实施

### 步骤 0：平台确认（需要授权）

**对应 PRD**：4.2、A10。

- 使用测试 Bot 和隔离的数据目录，手动确认以下几点：同事能私聊、聊天 Bot 通讯录应用权限及其范围、模式切换补权限后的生效情况、实际搜索接口、外部联系人首次建联的流程、群内 @ 收消息、引用回复能拿到 parent id。
- 把结论记在本文第 8 节；如果平台不支持某一项，就报告阻塞，不擅自删减功能。

### 步骤 1：模式、配置与持久化骨架

**对应 PRD**：3.1、4；A01。

- 新增 Core 聊天模块，以及配置和存储表；在 `application.rs`、`db.rs` 中接入。迁移只做新增，旧 Bot 默认开关为打开。
- 实现准入分流和模式切换规则（4.6）。
- **完成标准**：工作 Bot 原有的 Owner 测试全部不变并通过；在聊天 Bot fixture 中，非 Owner 和 Owner 的消息都被分到聊天路径。

### 步骤 2：设置界面

**对应 PRD**：4、4.1；A01。

- 在 `ChannelSettings.tsx` 的 Bot 行内增加开关、模型配置和文件夹绑定，沿用 `DESIGN.md` 和渠道 UI 合同的样式。
- 密钥通过专用接口写入；界面上只显示"已保存"。
- **完成标准**：未配置模型时不能关闭开关；没有文件夹也能保存配置。

### 步骤 3：聊天服务与文字投递

**对应 PRD**：5、8、9；A08、A09。

- 新增 `channel-chat-service.ts` 和 `chat-model-client.ts`，挂到现有 Host 生命周期上，不新开一条飞书长连接。
- 回复原会话时只发普通文字，不发运行卡。出站走持久投递，并用幂等键防重。
- 每个会话同一时刻只做一次推理，全局设并发上限；模型调用超时 60 秒。
- **完成标准**：外部消息不进入 `AgentRun`；群聊和私聊都回到正确的会话；没有运行卡。

### 步骤 4：资料问答

**对应 PRD**：F1、7；A02。

- 新增 `shared-chat-materials.ts`，按 4.3 实现。
- **完成标准**：只回答相关内容并注明出处；文件更新、删除、解绑都能立即生效；目录外路径、链接跳转、文档里的指令各有一个反例测试通过。

### 步骤 5：通信闭环

**对应 PRD**：F2–F5；A03–A07。

- 实现找人（@、聊天 Bot 通讯录搜索、已对话过的身份、同名澄清）、转发、代问、向 Owner 确认、新请求优先的答复关联、阶段汇报和补充汇报、结束事项。
- 外部联系人必须先与 Bot 建立单聊；未建联时给出提示，不发送。
- 发送结果为"未知"时，回复"暂时无法确认是否发出，请勿重复发送"。
- **完成标准**：A→B→A、A→Owner→A、Owner→B→Owner 三条闭环都能走通；群里发起的回到原群。

### 步骤 6：收口

- 只补真正受影响部分的回归测试；同步实际改动到的当前合同（见第 7 节）。
- 在授权后做真实飞书和模型的 Smoke 测试；PRD 中 A01–A10 每项都写明结果，没测或没通过的如实标出。

## 6. 验证

| 归属 | 覆盖 | 方式 |
| --- | --- | --- |
| Core 聊天模块 | A01、A05–A08 | SQLite fixture；规则用表驱动测试。旧的 `channel.rs` Owner 用例保留，不修改 |
| 模型客户端 | 动作解析、超时、错误 | 本地 HTTP stub |
| 资料模块 | A02 | 临时目录 |
| 通讯录与发送 | A04、A05 | 扩展现有的 channel-settings 测试和发送器测试；恢复相关场景只在负责持久投递的那一层完整测试 |
| Renderer | 配置 | 扩展 `ChannelSettings.test.ts` |
| 真实平台 | A10 | 授权后使用测试 Bot |

```sh
# 每一步只跑和改动相关的测试
pnpm exec vitest run <相关测试文件>
cargo test -p rovai-core --lib <相关模块>::tests::
pnpm typecheck

# 收口时统一跑一次完整测试
pnpm test
cargo test --workspace
pnpm build
pnpm docs:test && pnpm docs:check
```

做真实运行前，先阅读 `docs/development/local-workflow.md`，使用独立的 data-dir 和测试 Bot，并用 `pnpm dev` 启动。

## 7. 文档与依赖

- 新增一份"飞书聊天 Bot"合同，写清模式、准入、动作、事项状态和存储。
- 现有合同只在实际改变了行为的地方补充说明：Feishu Channel 里的准入分流、渠道设置 UI 新增的设置项。其余合同不改。
- 新依赖：只有现有库确实无法满足时才加；资料检索不引入知识库类依赖。
- 迁移只做新增；不提供破坏性的回退。

## 8. 当前状态

| 项目 | 状态 |
| --- | --- |
| PRD | v3，本地文件，需求基线未改 |
| 本计划 | v3 |
| 步骤 0 平台确认 | 未执行；需要真实测试 Bot 与租户授权 |
| 步骤 1–5 实现 | 已完成（2026-10-20） |
| 合同 | 新增 [Feishu Chat Bot v1](../contracts/feishu-chat-bot-v1.md)，并登记合同索引 |
| 自动化验证 | 通过；见第 9 节 |
| 真实平台 Smoke | 未执行；A10 未验收 |

## 9. 实施结果与验收记录

### 9.1 实现落点

- Core：crates/rovai-core/src/channel_chat.rs，Migration 205 新增 6 张聊天专用表；channels.chat.* 方法与 application.rs 分发；FeishuMemberBotView.chat 供设置页与准入读取。工作 Bot 的 Camp、Delivery、AgentRun 链路未改动。
- Main：channel-chat-service.ts（动作循环、答复关联、阶段汇报）、chat-model-client.ts（OpenAI-compatible 单适配器）、shared-chat-materials.ts（实时只读检索）、feishu-contact-search.ts（按姓名实时查询）。channel-settings.ts 在 owner.verify 之后按模式分流；聊天模式跳过 roster 与全部工作准入。
- Renderer / Preload：Bot 行内新增“聊天设置”入口，弹窗包含模式开关、模型服务商／模型／地址／密钥、资料文件夹；密钥只写入不回显。IPC 仅新增三个窄接口。

### 9.2 自动化验收

| 验收点 | 结果 | 证据 |
| --- | --- | --- |
| A01 模式开关 | 通过（模拟） | Core：chat_mode_requires_a_configured_model_and_pauses_open_items；Main：非 Owner 消息进入聊天且不调用 inbound.observe |
| A02 资料问答 | 通过（模拟） | 临时目录测试：递归扫描、出处日期、更新／删除立即生效、无效 UTF-8 拒绝；目录外链接不跟随 |
| A03 向 Owner 确认 | 通过（模拟） | 服务测试：向 Owner 发出询问并建立事项，答复目的地为原会话 |
| A04 找人 | 通过（真实平台） | 为「星洛」加入 contact:user.base:readonly、contact:department.base:readonly、contact:contact:readonly_as_app、contact:contact.base:readonly 与 application.contacts_range:write，并将通讯录权限范围设为 all；实时部门通讯录回退按姓名查到 Owner。权限被拒时仍如实提示 |
| A05 转发 | 通过（模拟） | 服务测试：直接发送、注明受委托、回执成功／失败／未知三分支 |
| A06 代问 | 通过（真实平台） | 两个已发布 Bot 在测试群完成 A→B 询问、A 引用回复、B 阶段汇报“关于「项目进度如何？」的回复：…”，发起来源为群 |
| A07 答复关联 | 通过（模拟 + 真实平台） | 真实群内引用回复关联到事项并回传；单事项直接关联（含询问 ID 尚未落库的早到引用）、多事项澄清、新请求优先、阶段汇报前缀由表驱动测试覆盖 |
| A08 重复与恢复 | 通过（真实进程） | 真实 Core 进程重启 E2E：聊天模式与等待事项保留、pending 出站只重领一次、已结算消息不重发、切回工作暂停事项并取消待发、再切回恢复事项且不补发已取消消息 |
| A09 外部展示 | 通过（构造） | 聊天路径只调用文字发送，不生成卡片或控制台入口 |
| A10 真实平台 | 通过（真实平台） | 真实 WebSocket 收到并处理人类账号私聊 im.message.receive_v1（om_x100b625fdebb48b0cfe981b0879093d，Owner ou_fbc…，内容“已回复”，已自动答复）与测试群内 @；普通回复、资料答复、转发、按姓名查找、真实模型、打包首启与 NSIS 安装包全量校验均通过。外部联系人首次建联需外部租户用户主动发起，未执行 |

### 9.3 未完成与限制

- 通讯录读取权限由用户在飞书开放平台为聊天 Bot 申请并重新发布；设置页已给出提示。权限未生效时只暂停按姓名找人。
- 外部联系人只能在对方先与 Bot 建立单聊后发送；发送失败会如实回报，不假称成功。
- 真实飞书：已确认 Bot 长连接、人类账号私聊入站（Owner ou_fbc…，消息 om_x100b625f…）、测试群内 @、出站投递、按姓名查找（权限范围设为 all 后查到 Owner）与真实模型回复（gpt-5.6-sol，2.8 秒）。外部联系人首次建联未执行。
- 真实进程重启 E2E 通过（A08）。
- 真实代问闭环通过（A06/A07）：星洛向海琴烟发出询问，海琴烟引用回复，星洛把阶段汇报发回原群。
- 发布产物：NSIS 安装包 dist/Rovai-AI-0.5.0-x64.exe 构建完成，verify-windows-release 全量通过（安装器配置、latest.yml／blockmap、四个二进制、CLI 合约、Packaged Core 隔离 data-root 与 health.check）。此前 dir 包的 app-update.yml 缺口由 NSIS 产物闭合。安装包尚未上传到公开 Release。
- 模拟通过不等于真实验收通过。
- Core RPC Smoke（2026-10-20）：以临时私有数据目录启动实际 rovai-host，确认 Migration 205、默认工作模式、无密钥时拒绝切换、保存密钥后进入聊天模式、重复入站不重复、出站入队／领取／结算可用。
- 全量 vitest：242 个文件通过；7 个既有文件因本机 Windows 符号链接权限（EPERM）失败，与本功能无关。cargo test -p rovai-core --lib：461 个通过；7 个既有 mission_workspace／ACP／存储用例因本机权限与 Git 配置失败。
