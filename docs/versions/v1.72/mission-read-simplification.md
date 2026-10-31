---
document_type: implementation-record
version: v1.72
status: in_progress
last_updated: 2026-11-01
---

# Mission 详情与复用校验精简

## 范围

User sequence 63 授权实施 sequence 61 的两项局部精简。开工远端 main 为
`b3c9522d3bd63a6aea631cb0f71792e37650e664`，仍存在两条重复读取路径。
分支 `rovai/mission-read-simplification`；独立 worktree
`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-mission-read-simplification`。
Governance: none；Status: in progress。只推送工作分支，不创建 PR、不合并、不安装或重启日常 App。
本轮不改变 schema、用户数据、原文件、真实 Git index、分支、工作区归属或 Mission 锁范围。
局部动态只读行为见 [Mission v14](../../contracts/mission-v14.md)；没有新增 Version Decision、
持久缓存、恢复服务、账本、队列或协调机制。

## 单文件 Diff

删除详情中的 `prepare_diff_snapshot` 和 `same_view` 全清单／checkout 相等门槛。已有
`viewId → fileId → raw_paths` 关联先验证 workspace ID、路径与 generation，再核对当前 Git
注册、owner 和固定 base。私有 index 只对选中存在的叶路径准备 intent-to-add；删除路径跳过
这一步，重命名保留两个可信路径但不把已消失的旧名传给 `git add`。一次限定路径的 Git 调用
同时返回 raw、numstat、patch，详情不混用旧行数、binary 或模式。选中项无法对应时继续显式刷新。
文件变目录不递归展开；中间链接、非法路径组件不进入读取。既有 Gitlink 语义保持。

Renderer 仅将详情标题栏、图标、复制路径和统计改为 `fileDiff.file`；列表总计、缓存、
请求合并、迟到响应隔离和显式刷新保持。列表读取仍执行原来的三组 Git 操作。
普通详情从全清单准备加 patch 的四次 Git 调用，减少为身份观察、选中路径准备、目标 Diff 三次；
没有无路径限定的 add 或全仓 raw/numstat。删除项可以省去 add。每次详情仍复制真实 index，
split index 时还复制 shared index；完成即回收，不宣称消除所有写入、永久泄漏或速度百分比。

回归归属保持在已有 `mission_workspace` 两个 Diff owner 中，未新增独立 Rust 测试函数。
修复前新增“列 A/B 后只改 B、首次读 A”断言实测失败：`mission.changes_refresh_required`。
修复后该 owner 验证当前统计、删除、未跟踪、重命名及配对失效、binary→text、文件变目录、
generation 变化、无差异目标、split index、真实 index 字节不变，以及详情命令路径范围。
另一个 owner 扩展冲突与稀疏检出的详情读取，保留 assume-unchanged 与冲突 index 不变断言。

隔离 Electron 的现有 Mission board 用例新增“详情 +1/−1、清单总计 +43/−20”断言。
修复前详情仍显示清单 +2/−1，断言失败；修复后目标用例通过。原先 smoke 中“只切换分支就
拒绝旧 view”的断言，按 v14 替换为同一 workspace/generation/目标仍可对固定 base 读取；
没有删除 workspace 替换保护。该 smoke 还新增无关文件变化及预览前后 index／文件字节比较。

## 验证进度

- `cargo test -p rovai-core --lib mission_workspace::tests`：4 项通过（无额外 feature）。
- Mission board 目标 Electron 用例通过；完整用例、默认仓库门禁及真实 Core/Runtime 验收在第二项完成后统一记录。
- `pnpm typecheck`、`pnpm docs:check` 通过。
- Windows、完整 Desktop 的真实 Core 联动和安装路径尚未执行；隔离 Renderer 受控接口验收不等同于这些结果。

第二项准备／删除竞争验证和最终交付信息待补充。本记录不把源码确认、受控测试和真实 Runtime 结果合并为全部通过。
