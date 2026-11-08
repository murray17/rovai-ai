---
document_type: implementation-plan
version: v1.72
status: verified
last_updated: 2026-11-08
---

# 项目目录引用实施与验收

模型输入范围由[已确认 R1](model-context-change-project-directory-reference.md)拥有；显示采用 User sequence 45/47。

| 字段 | 当前记录 |
| --- | --- |
| Work item | 项目文件/目录共同提及与候选显示收敛 |
| Worktree（实施期间） | `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-project-directory-references` |
| Branch | `rovai/project-directory-references` |
| Base | `e12d3eaf2d65182402e147405422acab11262306` |
| Governance | none；无主线先行要求；R1 由 User sequence 47 确认 |
| Status | implementation verified |
| Delivery | [PR #1031](https://github.com/murray17/rovai-ai/pull/1031)；合并、本机非终止安装与工作目录清理以 PR 和公共 Thread 的实际回执为准 |

## 实施范围

- 目录与文件共用 @ 候选，目录使用既有文件夹图标。根层无辅助路径，子层路径紧跟名称左排；桌面 480px。
- 四个 Tab 各自显示候选，手动选择保持；目录名在候选、草稿和历史中没有尾斜线。
- Host 校验目录身份/类型/根边界；发布由 Core 冻结类型和定位，模型正文的目录 URI 保留末尾 `/`。
- 草稿、剪贴板、恢复和历史保留类型；历史目录激活重新验证并定位当前文件树，不送入文件内容预览器。
- 协议和数据库准入升级，旧文件段不增字段、不重投影历史；不改 Charter。

## 冻结验证与测试归属

优先扩展现有 owner，不新增等价 Rust fixture 或平行测试函数：

| Owner | 修复前失败输入与通过条件 | 最低命令 |
| --- | --- | --- |
| camp_content 现有文件段 owner | directory 字段被拒；新增类型封闭解析、字节预算、文件原字节和目录 URI 编码矩阵 | `cargo test -p rovai-core --lib camp_content::` |
| project_files 现有临时目录 owner | 搜索过滤目录、open/resolve 拒目录；混合搜索、可读目录、类型互换、边界、链接和恢复矩阵通过 | `cargo test -p rovai-core --lib project_files::` |
| 既有消息事务/回执 owner | directory 首发被拒；失效留稿、Pending 无部分成功、commandId 重放不重解析通过 | `cargo test -p rovai-core --features slow-tests,extended-tests --lib project_file` |
| 既有 schema migration owner | 旧准入接受新字段会误读；schema 172 升级与旧 Core 拒收，历史不重写 | `cargo test -p rovai-core --lib project_file_reference` |
| Renderer 当前转换/候选/目录 store owners | 丢目录类型、混合 Tab、根层 ./、目录送文件预览；对应恢复及单面板路径通过 | 定向 Vitest 后 `pnpm typecheck` |
| 正式 Desktop/认证 Web UI | 临时项目中选择目录、仅目录发布、历史定位树、目录名无 /、480px 和手机抽屉 | 扩展 `scripts/accept-project-file-references.mjs` |

真实读取在实施前冻结以下任务，不验专属追问：

1. 同名目录：`src/auth/config` 与 `src/billing/config` 放不同随机值，仅引用一个目录，明确要求列出并读取其值。
2. 特殊路径：目录名含中文、空格、括号、`#`，明确要求读取其 marker 文件。
3. Mission 有效根：项目目录与 ready 工作树同名目录放不同随机值，仅读取有效工作树目标。

Codex 与 Claude 使用隔离 Native Home 和新 Thread；保留正式消息投影、RUN_INPUT 与实际工具读取证据。
通过条件是值精确对应被选目录、正文仅目录 URI、无自动目录文件注入。权限失败必须真实反馈。
旧文件确定性 owner 继续保留；不把离线稿或未执行的场景记作真实读取通过。

## 实际结果

### 已完成的定向检查

- `pnpm typecheck` 通过；文件显示、文档转换、可用性与目录 store 的定向 Vitest 通过，目录 store 现有 owner 另覆盖共用激活、迟到打开与传输失败（8 项）。
- 原 Core 内容 owner 16 项、项目文件临时目录 owner 3 项，以及原 Pending 原子事务 owner 的文件／目录参数矩阵通过。
  迁移复用原 owner，增加 schema 172 / migration 222 的 marker 回滚验证；旧夹具降级同步移除两代引用回执，未放宽生产准入。
- 正式 Desktop 与认证 Web 验收脚本通过 25 项，包括目录选择／发布／历史树定位、无显示尾斜线、四个独立 Tab、480px 对齐、根层无路径、
  旧文件复制恢复、中文输入法、异步发送屏障、失效留稿、触屏详情与 50 条候选的 44px 虚拟滚动。未调用真实模型。
- Host/Web HTTP、HTML 原文与预览、权限／Session 和连接恢复 4 项通过。原 HTML smoke 选择器更新到现有 CodeMirror 内容节点，不改变产品 HTML 行为。

### 真实目录读取

[读取证据](project-directory-reference-evidence.json)保留正式消息、冻结输入、输入摘要、选中／干扰随机值及 Core 工具证据。
Codex CLI 0.166.0 与 Claude Code 2.1.311 各完成同名目录、中文特殊路径和 Mission ready 工作树三个任务，六条读取全部通过；
另外两次正常 Mission 准备运行单独记录，不计入读取任务通过数量。每次使用独立 Thread 与隔离 Native Home；模型输入不含磁盘随机值。
两种 Runtime 均通过目录链接找到选中目标，未误读同名干扰目录。未新增文件全文、目录文件集合或专属追问规则。

### 完整门禁与交付

实施代码固定为 `3ef52b19c6c6d5bb722621440619b695abb33c9b`（含当时最新 main）；以下证据只对该代码及其后纯文档补记成立。

| 检查 | 实际结果 |
| --- | --- |
| `pnpm test` 全部步骤 | 通过；本地设置 `TZ=UTC`、Vitest 4 workers，273 个文件中 3171 通过／2 原有跳过；后续 Node owner 377 通过／2 平台跳过，文档／Skill／Electron 支持门禁均通过 |
| `cargo test --workspace --jobs 4 -- --test-threads=4` | 默认 workspace 484 通过／1 原有 ignored，零失败，doc-tests 通过 |
| `cargo test -p rovai-core --features extended-tests,slow-tests --lib <owner> --jobs 4` | camp_content 16、project_files 3、Pending 原子事务 1 全部通过 |
| `DOCS_BASE_REF=aa3aee51e pnpm docs:check:ci` | 通用版本、文档与决定门禁通过，无特例 |
| PR 初次 CI gate | TypeScript、默认并行 Vitest、文档、Rust fmt/check 全通过；最终文档补记继续接受同一 CI |
| `CARGO_BUILD_JOBS=4 pnpm package:mac:daily` | arm64 Release 构建、App/Host/CLI ad-hoc 签名及 Bundle ID 验证通过 |
| `node scripts/accept-project-file-references.mjs --packaged` | 打包正式界面与认证 Web 再次 25 项通过；[结构化证据](project-directory-reference-ui-evidence.json)保存实际检查项与 schema 172 记录，未启动模型 |

默认高并行的本地 JS 首轮发生既有 watcher／worker 时序超时；限制并行后全步骤通过，PR CI 的默认并行也通过。
测试修正只更新真实产品已有的预览选择器及协议／schema 预期，不降低断言或隐藏失败。
本次没有执行 Windows 真机安装、其他 Runtime 的新增目录任务或大项目响应时延基准；Windows/UNC 路径仅由确定性 URI owner 覆盖。

安装使用上述已验证产物；合并后核对 main 与该产物来源的产品代码一致。当前会话宿主保持运行，下一次从规范应用路径启动才加载新版本；
旧 App 保留为显式备份，不把磁盘安装表述为当前进程热升级。
