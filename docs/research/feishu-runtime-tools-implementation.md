# 飞书 Runtime 工具恢复实施说明

## 范围

在现有受认证 CLI 中增加 `rovai feishu` 工具族，不恢复独立 HTTP 模型，不增加 API 配置。不修改 SESSION_CHARTER、MEMBER_IDENTITY、Dynamic Context、ContextManifest、Profile/Formatter、冻结消息正文或共享 Skills。沿用已有 Bootstrap 中的 rovai --help 发现指引；工具清单、每项 help 和输入/输出合同一并更新。若实施需要改变上述核心模型上下文，必须先停止并按模型上下文治理取得二次确认。

## 冻结接线（实现者协作接口）

Core 新模块 channel_chat_tools.rs：
- pub fn execute(database: &mut Database, run: &AuthenticatedTeamToolRun, request_id: &str, operation: &str, input: &Value) -> anyhow::Result<Value>。
- pub fn migrate(database: &mut Database) -> anyhow::Result<()>；pub fn schema_matches(connection: &Connection) -> rusqlite::Result<bool>。
- pub fn definitions() -> Vec<Value>：提供下列闭集工具 inputSchema/outputSchema。CLI 目录引用此函数，不重复维护 schema。
- Host RPC channels.chat.tools.claim：{provider,appId,workerId,limit} -> [{requestId,leaseToken,query}]，只查询任务；settle：{provider,appId,workerId,requestId,leaseToken,contacts:[{openId,name,department?}],errorCode:null|permission_denied|unavailable|invalid_response} -> {settled:boolean}。不暴露在 Renderer allowlist。
- Host 只有在 Bot 已连接且已读取私有凭据时消费查询。结果至多20人，错误不得夹带 token/请求原文。
- ChatTurnSubmitCommand 增加 externalMessageId（生产Host必传），Core 从已经记账的 channel_chat_message 获取作者身份、Owner事实、正文和引用信息；不能由Agent自行提供Owner/appId/provider。mentions由入站记录保存，不信任模型伪造。

## CLI

所有返回使用统一闭集对象：{status, requestId, contacts, items, inputs, errorCode}。
- status: ready|queued|sent|failed|unknown|closed；requestId与errorCode可为null；其余为数组，空时[]。
- contacts: [{targetRef,name,department}]，department可为null。不返回凭据，不输出全量通讯录。
- items: [{itemId,question,status,requesterName,targetName}]。
- inputs: [{inputRef,authorName,isOwner}]。inputRef只允许本Run已认领的入站，不能跨Run/会话指定。

工具名与命令：
- feishu.status / rovai feishu status：{}；读取当前Bot范围和本Run输入引用，不给出所有Bot的配置。
- feishu.search / rovai feishu search：{query,inputRef?}；查询当前Bot权限范围联系人，返回queued/requestId；用result取得contacts。
- feishu.result / rovai feishu result：{requestId}；只读本Run请求，不盲目重发。
- feishu.forward / rovai feishu forward：{targetRef,text,inputRef?}；targetRef须来自当前输入的提及或本Run查人授权引用，禁止任意open_id。
- feishu.ask / rovai feishu ask：{targetRef,question,inputRef?}；targetRef='owner' 时服务端解析负责人；先原子建立事项再入队，最终结果sent/failed/unknown。
- feishu.items / rovai feishu items：{inputRef?}；只列当前请求者发起或等待当前作者回复的事项，不暴露其它人的事项。
- feishu.report / rovai feishu report：{itemId,text,inputRef?}；仅当前作者为事项被询问人、且引用关联或唯一等待事项时可回报；目的地为事项已冻结原会话；多事项且无引用不得猜。阶段/补充维持waiting，不自动关闭。
- feishu.close / rovai feishu close：{itemId,inputRef?}；仅该Bot Owner关闭其范围内事项。

多输入Run没有显式inputRef且不能确定唯一输入时，返回failed/errorCode=input_ambiguous，不取最新一条猜测。接收者同名不自行选择；模型须根据用户明确选择使用targetRef。工具help要求仅在用户委托发送/询问时使用写工具。

## 持久与安全

- 迁移211在两条迁移序列及正式Current准入都有登记；208/209/210已知旧布局经正式迁移，211收据有而布局缺损拒绝，保留旧业务数据。
- 入站externalMessageId到camp_message_id建立唯一持久映射；重复事件不重复创建Run。重启待回传通过持久映射恢复，不能仅靠Main内存Map。
- 当前Run/epoch、Bot成员、聊天开关、会话映射全部匹配才可执行。停止Run、关闭模式、变更Bot绑定后不接受新写操作，已领取发送结果按真实结果记账但不盲目补发。
- 请求ID+输入摘要持久幂等，重复同输入重放，不同输入拒绝。业务写事务原子创建事项与outbound，结果查询不产生副作用。
- 复用channel_chat_outbound；结果超时unknown不得盲目重发。租约结果匹配worker/attempt，过期发送不得无条件重领造成重复；provider有幂等键则传递。
- 不自动转发收到的所有聊天。代问回复由授权items/report工具关联，普通新请求不能被当成答复。关闭后的迟到回复不可恢复事项。
- 只发送文本。Host发送必须正确区分open_id/chat_id，不能忽略targetKind。

## 验证

CLI help发现和每项输入/输出schema；真实认证IPC或已有attested fixture证明工具可执行；假Host搜索、出站回执与代问闭环；跨Bot/Run/输入引用/任意target拒绝；并发、重试、重启、发送unknown、过期租约；旧库升级+正式Host读取。禁止真实联系人查询/消息外发/LLM调用，除非用户另行授权。

## 本地验证结果（2026-10-20）

- Core 全目标编译通过；CLI bin 33测试、工具投影29测试、工具目录9测试、聊天6测试通过。聊天测试使用实际Native Binding凭据认证后执行，覆盖请求身份、引用、代问回传、跨请求拒绝及事务回滚；没有实际调用模型。
- 正式Host隔离进程覆盖208/209/210旧布局升级、已有会话打开、成员/诊断读取、重复启动及损坏拒绝，4测试通过。
- Host与UI定向153测试通过；最终Host恢复113测试通过，联系人预算补充回归9测试通过。
- 全量Vitest最后一轮：2822通过、16跳过、1个daily评测用例5秒超时；该文件单独运行6测试通过。不宣称全量全绿。
- TypeScript、Rust格式、docs:test、docs:check及基于66f4a8e4d的docs:check:ci通过。
- 用户已确认0.4.19打包；真实飞书联系人/消息和实际模型闭环仍未运行，不混同本地模拟验收。

## 已知限制

这不等于飞书全量聊天历史、云文档或邮箱读取。仅恢复已授权Bot范围内的按姓名找人及显式受托沟通；平台无权限如实返回，不建议盲目申请全租户权限。CodeBuddy自身Shell审批仍按其权限语义处理，不改为bypass。
