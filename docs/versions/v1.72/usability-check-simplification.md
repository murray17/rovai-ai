---
document_type: implementation-record
version: v1.72
status: complete
last_updated: 2026-10-31
---

# 局部可用性检查精简

## 范围与工作区

User sequence 53 授权实施 sequence 45 的四项及后续确认的局部边界。基线为
`be7cac82fd878219102c053cafd8d87f22e12024`，分支 `rovai/usability-check-simplification`，
worktree `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-usability-check-simplification`。
Governance: none；Status: ready。四项独立提交；第四项单独验证。只推送工作分支，不创建 PR、合并或安装。
不增加 schema、恢复服务、持久协调状态或用户审批。

## 原路径附件显示名

删除 Source Ref、Main 登记加载、Composer 恢复 IPC 和 Desktop 目标解析中的 120 码点拒绝。
其余校验保持，名称与 sourcePath 不改写；真正创建文件的叶名称规则保持。
原登记仍存在时可按原 ID 恢复；旧版若已过滤并覆盖丢失登记，本项不重建该记录。

扩展既有 `local-composer-attachments`、`attachment-desktop`、Source Ref JSON 和 Single Chat owner，
无新增独立 Rust 测试函数。实际 125 字节 ASCII 文件名用于 prepare、同实例 restore、新实例 restore、
预览字节及打开／定位目标传递；Unicode 121 码点只验证显示元数据，不假设文件系统允许该叶名称。
原有错误归属、无效 ID、相对路径、源失效及类型检查保留。

修复前，Desktop 两项回归失败（新实例恢复 missing、目标解析拒绝）；Rust 单聊和 JSON owner
均因 `Source Attachment display name exceeds 120 characters` 失败。修复后 Desktop 两文件 20 项通过、2 项原有 Windows-only 跳过；
`local_attachment_source::` 5 项和 Single Chat owner 1 项通过；typecheck、fmt 与文档检查通过。
隔离 Desktop 的真实 prepare/restore/preview IPC 通过；正常退出并重开后仍 available，原 125 字符文件名、路径及 68 字节图片保持。打开／定位验证为既有 helper 的受控调用，未启动系统关联应用。

## ACP resume 的收尾等待

最终成功的 RPC 方法从原恢复循环传入现有收尾入口；只有 load 计算 grace/quiet 等待。
resume 复用同一处 owner、epoch、LoadingReplay 校验和 Ready 转换；错误状态不重新 bind。
`-32601` 降级后按实际 load 处理，同 Host 复用不改变。

扩展现有历史隔离及协议异常 owner。先仅传递方法、不改变旧等待行为，确定性首轮 poll 断言
失败为 `session/resume: Pending`；取消计时后该断言立即完成，load 首轮仍 pending。
同一用例覆盖 owner/epoch 错误、ProtocolViolated、错误 phase 和 route 缺失；原 RPC 夹具
追加 resume 降级 load，并继续验证 response 后迟到的 assistant/tool/usage 不进入当前 Run 或 ACK。
协议异常 owner 同时覆盖 resume/load 返回错误 Session ID 或非法协议。历史恢复 3 个 owner 通过。
原生模型设置 owner 与同 Host 复用 owner 各 1 项通过；文档检查通过。
真实 Hermes 0.22.4（原生提交 `4d04303818b61bf3aa09278af48356315515965b`）跨 Core 续聊已通过；两个真实任务 succeeded、正常 Core 退出 code 0，同 Thread/member/conversation/Native Session，不同 Host，并观察到实际 session/resume 成功、未调用 load。具体 IDs 与二进制摘要保存在隔离验收 JSON；固定等待的消除由上述确定性 poll 断言证明，不以模型耗时替代。

## 设置页原生 Skill 正文

目标路径先独立完成相对组件、逐段不跟随子链接、普通文件、canonical 根内及大小／文本检查。
菜单只提供有界候选：最多 512 文件、8 层、2048 个访问条目；目录及失败条目也消耗访问预算，
无关子树失败跳过。当前项与 SKILL.md 占用清单预算内的保留位置，无新缓存或后台扫描。

扩展原 `native_skill_file_preview_stays_inside_its_source_directory` owner。新增 513 个无关资源后，
修复前正常正文失败为 `Native Skill has too many files to preview`；修复后正文、选中资源和有界菜单通过。
同一 owner 另覆盖超深子树、Unix 不可读子树、目标自身缺失／目录／过大／二进制、非法组件及根内外链接。
读取深路径中的明确选中文件不依赖菜单是否列到它。未新增独立 Rust 测试函数。
`native_skills::` 默认 feature 的 5 项 owner 与文档检查通过。
设置页真实 Desktop 验收通过：513 个无关资源、10 层子树及 mode 000 子目录下，菜单保持 512 项，SKILL.md 正文可读、文件切换再返回正文正常；已检查截图。此项不改变智能体读取 Skill 的机制。

## 无关普通任务的 Mission 等待

派发复用已经验证的 canonical 项目路径，必须与实际 execution root 对应。无 Mission 且与现有记录中的
source/repository/common-dir/worktree/working-directory 和既有 token 派生 staging 均不相交时，提前返回。
复用原组件级路径关系和 Windows 普通／verbatim 表示比较；没有文件枚举或 Git 探测。
全部 workspace 状态参与判断；缺少验证、路径不规范或不能确认归属时继续原有等待。
Mission 生命周期锁、当前 Run/epoch、共享占用、未完成 Stop、owner、分支与 dirty 检查未变。

扩展既有 macOS `late_mission_preparation_cannot_erase_camp_deletion_cleanup_owner`，受控持锁并单次 poll：
修复前独立普通路径 Pending；修复后独立路径及仅名称前缀相同的兄弟目录 Ready。
ready/preparing/cleanup_pending 三态下，同 worktree、子目录、父目录、staging、Mission 自身均 Pending；
缺验证及不规范旧记录也保留等待。原真实 Git 的准备／Thread 删除清理 owner 竞争断言继续通过。
该项单独验收；不以前三项结果替代。不增加独立 Rust 测试函数。

并发复核补充：存在尚无 workspace plan 的 Mission 时，首次 Git 探测尚不能由现有路径记录证明无关，
因此保留等待（包含尚未启动的 Mission）。原 owner 中追加移除 plan 的受控快照断言，先失败为
`an unplanned Mission must retain lifecycle serialization`，再添加现有记录的缺项判断后通过。
这是第四项明确保留的边界，不增加目录扫描或协调机制来消除这类等待。

## 集成验证与剩余边界

macOS 已执行 `pnpm test`（259 个 Vitest 文件，3022 passed、2 个 Windows-only skip；后续 Node 365 passed、2 skip），
`pnpm typecheck`、`pnpm build:desktop`、`pnpm core:build:debug`、`pnpm test:rust:pr`（477 passed、1 个既有 ignored）、
`pnpm check:rust`、fmt、docs:test/docs:check 及以真实基线为 DOCS_BASE_REF 的 docs:check:ci。
Mission 缺 plan 边界补充后，默认 Rust 重新完成 477 passed、1 个既有 ignored；全目标 check、fmt、Core 构建及 docs 三项门禁重新通过。
定向扩展 owner 另外覆盖 Mission workspace 4 项、Camp deletion 3 项及共用路径判断的 attachment owner 1 项。

开发 Desktop 按 pnpm dev 正式启动器使用 `/private/tmp/rovai-usability-accept-gddlc70y/desktop`，
Core/Skill/MCP 均绑定该隔离目录；两次正常退出均得到 controlled shutdown completed、forcedSignal null。
真实 Runtime 使用该隔离根内独立 Hermes Home、Core data 与 managed-skill-library；复用现有 provider/model，
不改日常配置。协议观察器仅转发原始字节并记录封闭元数据；模型结果由实际公开 Send 与 Run 终态确认。

Grok 1.0.70 的真实验收尝试未通过：既有新会话请求在原生 `session/new` 返回 -32602，
原因是 `additionalDirectories is not supported: a session works only in its cwd`，尚未进入 resume。
未为完成本项而篡改原生 RPC 或扩大 Runtime 兼容修改；改用上面的 Hermes 完成真实续聊。

Windows 原生运行、日常安装路径、系统关联应用真实打开及完整全功能 Desktop 验收未执行。
本轮检查的是隔离 Desktop 的所改入口；没有用这些结果宣称原始用户数据库升级或全功能均已验收。
没有创建 PR、合并 main、安装或退出日常 App。工作分支保留供后续审查，不清理未合入的 worktree。

最终代码构建的 Hermes 真实续聊再次通过。Core 源码提交为 `a68a1daf45485e835124bfbbedc6c2cd3e7673fc`，
二进制 SHA-256 `f0ce79191e545380cb3ab37362925e51487568d22df95e5ba8ece5cfaadaee15`。该次之后只补充本验收记录，生产代码不变。
Thread `rvcamp_01m692tgm4f60v5x31sv865s0s`，member `agent_2`，conversation `d2cb4efa-ef11-4dfc-8ad2-c2b3f4cd7ac9`，
Native Session `local-d6b8ce5c282b426e44886b6e8c4c8d7bdd3f40adaabc477dbf9c2c19e860179b`；两次任务均 succeeded，Core 两次退出均 code 0 / signal null。
源码边界核对、受控回归与上述真实 Runtime／设置页验收分别保留证据；Windows 和安装路径继续标记未验证。
