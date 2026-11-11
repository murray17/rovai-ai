---
document_type: implementation-record
version: v1.72
status: implemented-preview
last_updated: 2026-11-09
---

# Kilo ACP 边界自检与收尾

User sequence 19 要求复查 `2e8abb455a4e8d4f79fcfc30a74b8c6c53e2b4ad`，重点为隐式 Node 依赖和重复文件处理。
在原 `rovai/kilo-acp` worktree 修正以下已确认问题；该阶段规范为 [Launch v81](../../contracts/runtime-launch-and-verification-v81.md)，
取舍见 [D80](decisions.md#v1-72-d80)。没有重构接入框架。后续成功 Steer 复用与当前入口见[复用记录](kilo-steer-reuse.md)。

## 确认的问题与最小修正

| 问题 | 实际影响与修正 |
| --- | --- |
| 隐式 Node | 只有独立 Kilo 和 Python MCP 时，不同 cwd 被额外包装为裸 `node`，导致原本可运行的 MCP 失效。共享 helper 改用已有 bundled `rovai` 绝对路径的私有 cwd 执行模式，删除 `cwd.cjs`；Kilo 与 Command Code 一起修正 |
| 重复文件投影 | 重复构造/覆盖同一个 JSON candidate，不是第二次创建或写入用户文件。但 delete 可能生成 schema 不接受的 write/delete 候选。保留共同结果，仅缺失时为单文件 add/update 补 fallback；delete 留在 Diff |
| pure 跳过回调 | 执行准备固定 `KILO_PURE=false`，保证必需的原生 config 回调不因继承 pure 被主动跳过。目录探测保持原环境；不另建权限求值器 |
| 取消阶段冲突 | 旧 Core interrupt 1 秒会截断原生内部 2 秒等待，flush 1.5 秒也可能已过期。Core 统一 interrupt 2 秒、flush 2.5 秒、总计非 Windows 3 秒/Windows 5 秒，ACP 接收同一个绝对 deadline |
| 相对路径 Diff | 删除 Kilo 原始字符串等值判断，改在现有共享路径准入中按 execution root 核对两个来源；有效相对路径通过，真实不同路径拒绝 |
| effort 展示 | 补齐 Kilo `effort`；同类自检发现 Command Code `effort` 与 MiniMax `thinkingEffort` 也遗漏，一起补齐 Rust 历史与 TS 展示映射。TS 两个入口共用小纯函数；历史仍用冻结 Run 配置 |

cwd launcher 不建立 IPC，不要求 Agent lease，也不发布新 Agent 命令；只继承 stdio、环境与逐项 argv。
Unix 直接 exec，无额外常驻进程；Windows 保留无控制台启动与原退出码传播。失败只写 stderr，保持 MCP stdout 干净。
MCP 自身若配置为 Node 程序仍需其声明的 Node；本次移除的是 Rovai 擅自引入的依赖。

保留局部递归有序配置、8 行原生 config 回调、Host 私有 instructions、单 Binding Host、共享多 RPC 收口、
Steer 后 Host 退役及现有 numeric reader。没有新增 SHA256 校验、加载握手、审批、服务、队列、数据库迁移或文件 schema。
原生权限标量会在上游配置解码时转成 wildcard 对象，不为推测的输入形状增加冗余 guard。

## 先失败再通过的证据

原配置、冻结模型 metadata 和事件归一化 owners 在修复前分别复现 pure 未覆盖、effort 读错键、相对路径 Diff 丢失。
生产 cleanup 的原 owner 增加模拟 ACP：收到 cancel 后 1.75 秒才写 settled 标记并返回终态。
旧代码在标记前回收进程，修正后等待标记、flush 完成并忘记 Runtime，仍在原 3 秒总预算内。
该 1.75 秒是可控协议时序，不冒充官方 Kilo 必定在该时刻返回。

原二进制的严格 Core 对照 `rovai-kilo-core-wbcX8W` 将 Runtime PATH 限制为无 Node 的系统目录，
使用绝对 Python MCP 与不同 cwd：前七个普通 Run 成功，到首次 MCP Run 失败。
wire 代码明确使用裸 Node，结合 PATH 无 Node 与修正后的同场景通过支持该依赖判断；
没有声称失败日志包含其未记录的 ENOENT。

新构建生产 Core/CLI 与官方 Kilo **7.8.27** 在 `rovai-kilo-boundary 空格-_ny85zj1` 完整重跑原 smoke：
**19 个 Run，17 个 succeeded、2 个主动 cancelled**。loopback 受控 Provider、假 token，独立 data/Skills/MCP/HOME/XDG 和项目，未使用日常数据。

- Core 继承 `KILO_PURE=true`；原生文件/inline/Agent 具体权限、ask 允许/拒绝和保存的 deny 行为通过，不能只以 Session 创建推断回调成功。
- Runtime PATH 无 Node，Python MCP 子进程确认也找不到 Node；不同 cwd 与相同 cwd 均成功。bundled CLI 位于中文/空格根下，包含空格、中文、shell 字面量和空字符串的 argv 保持。
- MCP A→B→A、idle/busy 旧 Host 退役及恢复继续通过，没有新建 MCP 管理器。
- 模型传入相对 `allowed.txt`，原生返回绝对文件路径；持久化 Files Changed 为一个 add，+1/−0。单文件 delete 的无效候选由原事件 owner 和共享 schema 验证不存在。
- 冻结 Run 的 Kilo `effort=high` 投影为 `reasoningEffort=high`；首次/warm/cold、Bootstrap、输出快照、采样和 CLI 继续通过。
- 普通取消、Steer accepted、待回执 Steer 取消为 unknown、不自动重发及两个普通后继继续通过；本轮私有 Runtime 文件完成清理。

[白名单证据](../../research/kilo-runtime/boundaries-7.8.27-macos-arm64.json)只保存版本、case、Run 关联及结果。
本轮未重新调用 sub2api 付费模型；此前真实模型文件与插话记录仍见[原阶段验收](kilo-files-steer-verification.md)，不改写为本轮结果。

## 验证归属与门禁

扩展既有配置、模型 metadata、ACP 事件、native patch、MCP wire、active-input 和 cleanup owners，新增 Rust 测试函数为零。
相对/绝对/点段路径、真实不匹配、单文件 add/delete、failed/in-progress/truncated 及共同投影保留分别在这些 owners 中验证。

最终 `cargo test --workspace` 为 **484 passed、1 项既有 ignored**；配置、事件归一化、MCP wire、冻结模型、
active-input extended owners 与 1.75 秒 cleanup slow owner 通过。`pnpm typecheck`、`TZ=UTC pnpm test`
（前端 3193 passed/2 skipped；Node 377 passed/2 skipped）、`pnpm build:desktop`、`pnpm dev` 构建和窗口核对通过。
`pnpm docs:test` 10 项、`pnpm docs:check`、
`DOCS_BASE_REF=958784f6e17fc32d8b2753d7f14fd6122dceea9d pnpm docs:check:ci`、
Cargo format、Node syntax 和 `git diff --check` 通过。

首次 workspace 为 437 passed、1 failed、1 ignored；唯一失败为上一提交修改
`runtime-compatibility.md` 后未同步已有证据 revision 常量，非本轮运行逻辑失败。更新同一记录时同步已有常量，
没有添加任何校验机制或 Kilo evidence hash。

私有 launcher 另用实际生产 CLI 验证相对 executable、逐项参数、stdin/stdout/stderr 与退出码 7；
无效 cwd 和缺少参数均只有 stderr，没有污染 stdout。未增加常驻 wrapper 或新的 Rust 测试函数。

Desktop build 后通过 `pnpm dev` 重新构建并启动原隔离 fixture，原 Thread、3 文件 +5/−3、
`待编辑.txt` 的持久化 Diff 与 composer 草稿 `on` 均保持，未发送新模型请求。

## 适用边界

只实跑 macOS arm64 和官方 7.8.27；Windows launcher 分支仅源码/编译配置复核，没有 Windows 真机结论。
Command Code 共用 helper 的 wire owner 通过，本轮未启动真实 Command Code。完整 Skills、自动/overflow 压缩、
rename 投影与全部取消竞态仍未由本轮证明；成功 Steer 后的 Host 复用优化不在范围内。

官方固定源码依据：[pure flags](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/effect/runtime-flags.ts)、
[plugin loader](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/plugin/index.ts)、
[write 路径](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/tool/write.ts)、
[ACP locations](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/tool.ts)。
