---
document_type: protocol-contract
contract: project-file-reference-v2
status: accepted
version: 2
source_version: v1.72
last_updated: 2026-11-08
---

# Project File Reference v2

继承 [v1](project-file-reference-v1.md)。公开 Active／普通 Pending 支持当前有效根内的普通文件和目录；Desktop 与已认证 Web 使用同一 Host。
单聊、行范围和主动跨项目选择不在范围。条目是 live 路径引用，不是内容快照或附件。

## 数据与显示

ComposerDocument version 2 新增封闭 Atom：

```ts
{type:'project_file_reference', threadId:string, rawReference:string, labelFallback:string,targetKind?:'file'|'directory'}
```

targetKind 缺省为 file；新目录必须为 directory。未知枚举、null 和未知字段拒绝。文件发布继续省略默认类型，旧文件字节不变。
labelFallback 必填且保存完整项目相对路径，只用于显示，不能承担定位。rawReference 沿用
File Preview 的 Base64URL `[rootIdentity, relativePath]`，UTF-8 最长 16 KiB；不采用普通 ID 的 256 字节限制。
scopeId 只属于浏览生命周期，不进入文档。缺少字段、未知字段或私有 MIME 无效时使用既有纯文本回退。

正式段只由 Core 构造，不接受客户端发布字段：

```ts
{kind:'project_file_reference',threadId:string,rawReference:string,pathAtSend:string,labelAtSend:string,targetKind?:'file'|'directory'}
```

Thread 来自命令；pathAtSend 为验证后的规范主机绝对路径，labelAtSend 为完整合法相对路径。
正式段保存在既有 structured_content_json，不新增业务表，不批量改写历史。

候选采用类型图标、名称、父目录同一行连续左排；根层无父目录说明。目录采用 ProjectFolderIcon，名称无尾斜线。
桌面宽度 480px，受输入框与视口限制；四类 Tab 独立，不混合展示。完整路径进入可访问名称。输入框和历史默认显示现有文件类型图标与文件名；
同一草稿／消息内不同身份的同名文件逐级补最短可区分父目录；重复同一身份不构成冲突。
消歧是展示计算，历史依据发布标签，不根据当前改名解释原消息。完整路径可从焦点、触屏详情与预览获得。

## 来源与检索

有效根为 ready Mission 工作副本，否则为 Thread 绑定目录。候选读取不创建或准备工作副本。
独立候选 scope 只负责 resolve/list/search/cancelSearch/open/release，不挂载目录 store 的 watch/poll。
空文件查询只列根层；非空约 150ms 防抖，沿用 ignore、路径子串、100 条及遍历预算。partial 必须保留，
不能将不完整的零条结果表示为项目中不存在文件。手动类别固定；来源失败互不遮蔽。关闭、切对话、查询更新使旧结果失效。

选择候选后由 Host 创建根绑定引用；返回时复核 Thread、scope、查询代次和原触发节点范围再插入。
不自动预览、不加演示延时或装饰性加载动画。合成输入期间不搜索、插入或发送。预览由主动激活触发。
文件树／预览的“引用到输入框”共用目标确认与同一种 Atom，仅在当前公开 Composer 可编辑时提供。

## 发布

Core 首先回放既有 commandId 成功或拒绝，然后在短锁获取命令 Thread 业务绑定，在锁外解析文件。
验证 Atom Thread 相等、根代次／规范路径／根对象、相对路径边界、根内普通可读文件或可读取目录；根内文件符号链接可用，目录的任一链接分量拒绝。类型与选择时不符则拒绝。
相同身份与预期类型一致才去重，每条最多 32 个不同文件或目录，正文每次出现都保留。文件 I/O 不进入 SQL 事务。
提交事务再次复查回执与业务绑定，产生正式字段并原子发布消息和 Deliveries；Pending 邀请、激活也在原事务。
预检失败的拒绝回执仍先复查并发回执；Active 独立成员邀请不会因文件失败回滚。

错误 project_file_reference_unavailable 的 payload 包含 message、segmentIndex、kind、threadId、rawReference、reason。
reason 为 invalid_reference/thread_mismatch/root_unavailable/root_changed/file_missing/outside_root/not_regular_file/target_kind_changed/unreadable。
数量或实际字节预算超限为 camp_message.invalid_content，含出错位置。失败定位 Atom 并留完整草稿；网络失败不等于文件删除。

有效文件或目录本身构成实际输入，可单独或加成员、正文、附件发送；不参与成员路由。纯空白或只有成员仍为空。
同一 commandId 结果未知时继续核对或重放；确认成功后才清稿。重新编辑的新提交重新验证。

## 正文与预算

统一 projector 在原位置输出 `[转义后的完整相对路径](file:///编码后的规范绝对路径)`。
URI 使用平台路径 URI 库，集中处理空格、Unicode、括号、井号、反斜线及平台路径。
目录投影为 `[src/auth/](file:///project/src/auth/)`，标签与 URI 均有末尾 `/`；界面短标签不带该斜线。
模型通过既有文件工具按需读取；不展开目录或注入其文件集合，不加入 RUN_INPUT.files、不注入文件正文、不重复生成 SourceAttachment。
初始输入、Steer、历史读取使用发布字段；已冻结模型输入维持原始字节，无历史文件 I/O。

保留 4096 段与 1 MiB 预算。草稿每次文件出现累计 threadId/rawReference/labelFallback 的 UTF-8 字节；
正式段累计 threadId/rawReference/pathAtSend/labelAtSend；草稿和正式段的 directory 类型每次另计 9 字节，默认 file 为 0，TS/Rust 一致。
完整投影还受原 1 MiB 实际字节预算约束，包含转义、URI 编码和重复。
标签不套用普通标题的 500 scalar 截断。既有 Context 选择及截断预算不增加。

## 恢复与目标确认

projectFileReferences.resolve 是认证用户只读操作，输入为 `{threadId:目标,references:[{threadId:来源,rawReference,targetKind?:'file'|'directory'}]}`，最多32项。
返回既有 ok/value 或 ok:false/error 包装，value 按输入顺序逐项为：

- `{status:'available',reference:ProjectFileReferenceAtom}`。
- `{status:'needs_reselect',reason:'root_mismatch'|'source_unavailable'}`。
- `{status:'unavailable',reason:上述来源错误（thread_mismatch 除外）}`。

同对话确认来源；跨对话使用目标权限与有效根独立确认，同时确认来源绑定元数据及来源仍有效。
项目根需相同规范路径和实际根对象，Mission 还需同工作副本与代次；不同根种类不重绑。不能按文件名、项目名或相对路径猜选。
成功签发目标 Thread 引用；完成前旧身份不能发送。无法确认时保留原 Atom 与完整路径，提示重新选择／移除；不静默降文字或删除。
可用性独立于身份，刷新不产生 undo item，不逐键访问文件系统。重绑与原粘贴编辑合并恢复。

同对话私有复制、输入历史、本地保存、失败恢复保留文件及位置；内部整条消息复制携带结构化信息和可读文本。
外部文本提供名称与完整相对路径。撤回短期重编只回填完整相对路径文字。
选区复制使用可见文字；当前 quote_text 合同保存可见选文快照，不把 Markdown URI 包装写入选文，
也不按新的短标签或 URI 偏移重算旧快照。整条消息复制及模型正文继续使用各自的完整路径投影。

历史文件预览重新验证原来源并比较 expectedPathAtSend，变化时诚实不可用，不自动指向同名新根；不提供发送时内容快照。
历史目录激活通过 projectFiles.open 在当前 scope 中验证 rawReference、directory 类型和 expectedPathAtSend，
再展开祖先链并定位目录。只载入当前层与祖先，不递归展开子树；目录来源不传入文件内容预览器。
scope.rootId 必须匹配原引用，迟到响应不得跳到新 Thread 或新根。
移除、关闭或释放 scope 不删除文件或目录。兼容门禁与版本轴见 [Host Web v11](host-web-v11.md)及
[目录引用 R1](../versions/v1.72/model-context-change-project-directory-reference.md)。
