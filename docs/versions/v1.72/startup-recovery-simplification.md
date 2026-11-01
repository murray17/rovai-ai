---
document_type: implementation-record
version: v1.72
status: in_progress
last_updated: 2026-10-29
---

# 历史进程恢复减重

## 范围与故障

User 确认以老用户原会话继续工作为终点。独立 worktree 分支 `rovai/startup-recovery-availability`，
基线 `95c5f5f98019dc53cefef9abb64adc56b4be5798`；不修改主 checkout，无数据库格式、版本指针或发布版本变化。
交付前纳入 `5a229a599`（PR #953 模型目录兼容与原生执行），保留其全部代码与文档；本次 PR 仍只承载历史恢复减重。

前代 PID 被系统进程复用时，libproc 权限错误经 ManagedProcess 整批 `?` 传播到 `authority_recovery_failed`；
Adapter 初始化还会重复执行同一清理。Fleet 构造与 Stop 确认同样带全局历史回收。旧任务的 cleanup ACK 缺失则
继续阻挡工作区准备、消息领取、共享 execution root 和 dispatch，产生“窗口已开但不能工作”的第二层故障。

## 实现取舍

- `run_core` ready 后唯一 `spawn_blocking` 调用，共用三秒预算；每条最多 250ms、最多 16 条诊断、每条 512 字符。
  相同诊断去重，清理/跳过按记录计数，未扫描项不计为已清理。不持数据库锁，不在 RPC 循环等待，不进入 optional maintenance 或 Adapter 重试。
- ManagedProcess 与 Fleet 历史入口逐条容错。未知身份、权限/I/O/格式错误保持未清理；原进程已消失或 PID 复用不误杀新进程。
  当前 Core 生命周期身份/Fleet generation 排除新任务进程，正常停止原语保持真实。
- Fleet 构造不碰历史目录，实际写新所有权时才准备存储；当前 Stop 不调用历史 sweep。
- 四处门禁共用现有 launch/Fleet/one-shot 所有权快照，精确匹配 Run/epoch。历史未知不阻断；当前仍持有的终态执行
  若请求过清理且缺 ACK，继续只阻挡关联任务。当前清理 worker 不重试前代未知项，不批量补 ACK。
- 当前执行从数据库 claim 起登记：claim 与现有 generation-local 登记共用数据库锁，覆盖领取后、启动前的 Stop。
  终态回调统一核对该 Run/epoch 的待收尾请求；缺 ACK 时保留原登记，实际收尾落库后再释放。
  ACP/Pi/Codex 异常退出先提交 Runtime loss，再决定释放；不因 Adapter/Fleet handle 消失就丢掉本次收尾责任。
- 数据库打开、迁移、业务恢复保持各自错误。旧输入无自动重投，无新服务、表、持久队列或账本体系。

## 回归归属

扩展既有 Rust 测试，不新增测试函数。Delivery queue 的原门禁 owner 同时覆盖缺 ACK 的历史/当前执行、epoch 不匹配、
共享目录和 Mission workspace；Continuation owner 显式提供当前执行身份。macOS 既有 PID/ledger owner 扩展为
EPERM、损坏混批、格式/权限异常、不可读目录、不能删除、零预算和当前进程保留；Fleet receipt owner 验证构造/Stop
不触发历史 sweep，显式维护才逐条处理。原子数据库/内核身份断言不能由静态文本检查替代。
Windows 既有 owner storage 测试同步改为“构造不阻断、实际新任务写入失败、历史诊断保留”；
原生 Windows 2022 的既有 `windows-runtime` CI 矩阵已通过，包含全 targets、ManagedProcess、Fleet、迁移与中断恢复、
实例互斥、数据目录、附件、Skill、Named Pipe 和 MCP 权限检查。验证提交为 `214adc50f65d925ec2f6a31d7daa9e67b3b86a3b`，
此后 Rust 变动仅格式调整；[运行记录](https://github.com/murray17/rovai-ai/actions/runs/40891321117)。这不是 Windows 桌面实机验收。

既有 `scripts/smoke-stop-continue.mjs --historical-startup` 扩展真实 Core + 合成 ACP 路径：先产生并停止执行，关闭 Core，
只撤去旧 ACK 并加入脱敏坏记录、8192 条损坏文件与 32768 条已消失的生命周期身份。原 Thread/member/Runtime/输入保留；
重开读原会话、清理预算耗尽前收到新 native prompt 并继续成功；再次功能重试后历史清理只运行一次，旧 ACK 和异常文件不变。
隔离现场保留供复核；它不替代真实 Runtime 或安装 App 验收。

评审发现当前任务异常退出会在写入清理请求前删除登记，导致过滤后的 worker 永久跳过它，Mission worktree 仍被占用。
同一脚本的 `--unexpected-exit` 在修改前实测因等待 ACK 超时失败；此处修复的是当前任务生命周期，不扩大历史清理范围。
既有 Core `runtime_cleanup_dispatch_is_non_blocking_and_deduplicated` owner 增加 Stop 已提交但 cleanup worker 尚未运行的
无 handle 窗口，以及真实 ACK 后登记释放断言；没有新增 Rust 测试函数。脚本同时扩展 `--stop-during-launch` 和
`--unexpected-exit --pi`，均通过公开请求观察同会话后继执行，并显式固定及核对合成 Runtime 路径，防止回退到本机安装。

## 验收状态

| 检查 | 结果 |
| --- | --- |
| `cargo check --workspace` | 通过 |
| `pnpm test:rust:pr` | 477 通过，1 项原有手动 Runtime 用例 ignored |
| Delivery 扩展 owner | 28 通过；下述 2 项原有失败在基线复现 |
| macOS PID/ledger、Fleet receipt | 均通过，覆盖异常混批、精确当前所有权与零预算 |
| 历史故障端到端 | 通过；会话读取 93ms，总预算耗尽后保留余项，新 native prompt 在后台清理结束前开始并成功 |
| 未修改基线对照 | 同一脱敏脚本在基线重开时返回 `authority_recovery_failed`，修改后通过 |
| 当前停止/正常退出/重开 | 合成 ACP 通过，正常退出 68ms，已收正文可读且未重放旧输入 |
| 通用文档治理三项 | 通过 |
| 合并当前主线后的默认 Rust 门禁 | 再次通过，477 通过、1 项原有 ignored |
| arm64 打包与签名 | `pnpm package:mac:daily` 通过，隔离运行通过 |
| P2：ACP/Pi 异常退出后收尾 | 均通过；ACK 分别在 113ms / 112ms 落库，同 Conversation/member/Runtime/installation 后继成功，无数据库修补 |
| P2：Host 初始化途中 Stop | 通过；123ms 取得 ACK，旧输入未发送，用户显式继续后唯一新 prompt 成功 |
| P2：无 handle 的当前收尾归属 | 扩展原 Core owner 通过；登记保留至真实 ACK，重复扫描不重复收尾 |
| P2：历史故障与正常退出重开 | 再次通过；历史会话读取 90ms、预算耗尽仍可继续；正常退出 40ms，未重投旧输入 |
| 原生 Windows 既有矩阵 | Windows full 通过，未跳过或关闭现有步骤 |
| P2 PR CI | `0107c0872` 通过；包含格式门禁及本次变更所需检查 |

`pnpm dev` 在独立目录真实启动 Desktop、Host 与 Codex。首次执行 `printf STARTUP_DEV_OK` 成功发布回执；
第二次 `sleep 120` 在命令实际运行时通过 UI Stop，SQLite 记录真实 ACK。正常退出该开发实例后，只移除该 ACK，
加入异常文件和 8192 条坏记录，再重开同一开发会话。第三次 `printf STARTUP_REOPEN_OK` 成功发布回执。
三次 Run 的 Conversation、agent_1 和 codex-cli 相同；原 cancelled Run 的 ACK 仍为空，8194 个已取摘要文件均未改变。
重开日志 Core ready 120ms、会话进入往返约 12ms；页面和输入持续可操作。未把旧已停止任务自动续投。

开发现场保留于 `/tmp/rovai-startup-dev.iu5eiu/`，含隔离 DB、故障摘要与 `development-acceptance.json`；
大批量回归现场 `rovai-stop-continue-UYhQkW` 的 `acceptance.json` 保留 cleanup 计数、预算和读取耗时。
这些均是本次合成或开发验收数据，不包含日常原会话副本。

打包产物由代码提交 `7e02f3fd5a2b1dc5b3a1d9557f7b489d3d41a5d8` 构建，App/Host 均为 0.5.3、arm64、ad-hoc 签名。
显式隔离参数下复用同一测试会话，真实 Codex 第四次 Run 成功发布 `STARTUP_PACKAGE_OK`；正常退出后再次核对旧 ACK 仍为空、
8194 个文件摘要不变，证据保存在同目录 `packaged-acceptance.json`。Core ready 60ms、会话进入往返约 5ms。
这证明打包产物可用，尚不替代 `/Applications` 安装路径与日常原会话验收。

以下是上一轮构建核对；P2 生命周期修复后须重新构建与验收，旧产物不再作为待安装候选。

| 构建核对 | 当前日常安装（未替换） | P2 修复前的隔离产物 |
| --- | --- | --- |
| App version/build | 0.5.3 / 0.5.3 | 0.5.3 / 0.5.3 |
| 内置 Host（含 Core）SHA-256 | `c76fd766bb97cf8de13603699e869f3df82e7cb808fa21cecdeded61e0eee5e2` | `c9c1a4aee0ea75a69ea1fa93cc2b2c72cc95efce8e8320ea9e9faad5678113a9` |
| 内置 CLI SHA-256 | `c7bf102f59af988439b4ea7ced964058b84b1a6485a68004e909fdd01eb2caf2` | `daae4bc84c0aa8fc6605d6ab34132cd0e024fa69c0cae5b60c244a62a4d5d0df` |

P2 修复后的 arm64 产物从 `b1ae65996` 的生产代码重新构建，App/Host 仍为 0.5.3，ad-hoc 签名校验通过。
Host SHA-256 为 `a69ce9d48c2e0e1583bf3f0678db89320bb1123c5bb7748dd729a15d75027c80`，
CLI 为 `35bbe7e12caaa9e1f854bd21edd5d4792cf004ce1f147894d53c5410bec6fc3e`。
复用上述开发现场，UI 上真实 Codex 新任务 `STARTUP_P2_PACKAGE_OK` 成功；随后运行 `sleep 120` 并明确 Stop，
当前 Run 在约 99ms 后取得 ACK；新输入 `STARTUP_P2_AFTER_STOP_OK` 再次成功。7 次 Run 的 Conversation、
agent_1、Runtime 和 installation 相同；历史取消 Run 的 ACK 仍为空，8194 个文件摘要不变。正常退出并重开后，
7 次 Run 和原消息仍可读，没有新增自动重放的 Run；再次正常退出，两次进程退出码均为 0。
证据在 `p2-packaged-acceptance.json`，日常安装的两个二进制摘要仍与上表相同。

P2 默认 Rust 门禁首次在并行打包时出现 `runtime_probe_stdout_cleanup_timed_out`，该测试原有清理窗口为 500ms。
未修改探针实现或放宽断言；单独复核通过，随后完整 `pnpm test:rust:pr` 重跑 477 通过、1 项原有 ignored。
原 Claude/native-failure Core owners 同步使用当前所有权快照验证门禁，避免空快照的历史场景测试入口误代当前执行。

扩展 Delivery 全组的 `steer_admission_uses_the_frozen_run_and_rejects_stale_or_unknown_capability`（Hermes 1.0.0 预期）
和 `legacy_steer_upgrade_keeps_accepted_unknown_and_unfinished_sources`（迁移冻结行比较）在未修改的基线归档上同样失败。
可选启动矩阵中的 skills `.staging` 故障也在基线同样得到 ready 而非预期 degraded；其余四项通过。
这些既有测试问题未通过改生产行为、移除测试或新增例外掩盖，不计为本次通过项。

## 安装路径验收与剩余边界

User sequence 13 授权正常退出；重开后的 sequence 15 要求继续。原退出完成，但退出窗口没有制作日常数据库副本。
2026-10-29 通过 `pnpm install:mac:daily` 把 P2 已验收候选安装到 `/Applications/Rovai AI.app`，
旧包保存在 `/Applications/Rovai AI.backup-before-startup-recovery-20261029-2307.app`。
安装门完成源、暂存与目标的签名/架构检查；安装后的 Host/CLI SHA-256 与上文 P2 候选完全一致。
当前日常 App/Host 进程保持运行，仍是此前加载的旧构建；磁盘安装不表示它们已热升级。

从规范安装路径启动显式隔离实例，复用 `/tmp/rovai-startup-dev.iu5eiu/user-data` 与其独立 Skill Library：
真实 Codex 发布 `STARTUP_INSTALLED_OK`，执行 `sleep 120` 期间停止后约 59ms 取得真实 ACK，随后
`STARTUP_INSTALLED_AFTER_STOP_OK` 成功。正常退出并从相同安装路径重开后，原记录可读且无新增自动重放，
`STARTUP_INSTALLED_REOPEN_OK` 再次成功。同一 Conversation、agent_1 与 Runtime installation 保持一致；
两次会话 snapshot 请求分别为 34ms 和 16ms。原 8194 个故障文件、额外保留文件及旧 ACK 空值均未改变。
两次隔离 App 均正常退出。证据为该目录的 `installed-acceptance.json` 与 `installed-path.png`。

安装路径与停止/重开验收已通过，但这仍是先前的开发现场，不能替代日常原会话。
最终剩余：创建日常原会话隔离副本，保留异常记录与缺失历史 ACK，验证原队员/原 Runtime 及共享目录的新任务。
日常数据尚未复制，在线 SQLite Backup API 的流程例外未获确认。User 在 sequence 19 明确要求
将 PR 合入 main 并安装本机，按该指令先完成合入与安装；原会话副本验收仍记为未执行，不列为通过项。


## 历史 ACK 在资源入口的残留判断（2026-10-29）

合并前复核发现 Mission 清理可用性/命令、会话删除目标与最终检查仍按全量历史缺 ACK 判断占用，
排队提示也沿用旧推断。它们是既有入口未同步新规则，不是本轮异常退出修复引入的回归；新会话在 App
崩溃、强制退出或断电后同样可能产生这类历史记录。

清理入口和请求检查复用当前 Run/epoch 的共享占用规则；其他会话使用同一 execution root 时仍受约束。
删除只停止本次 Core 持有的精确执行，并在业务提交前再次获取当前快照；Warm/Starting 的 Fleet fence 保持。
前代 ACK/进程回执缺失不单独阻断操作，不补写 ACK。Renderer 按当前公开执行和 Core waitCondition 显示
排队，不再从历史 ACK 空值生成“等待上次执行清理完成”。无新表、恢复机制或 wire 字段。

扩展既有三个 Rust owners，覆盖历史缺 ACK 可清理、当前同 Run/epoch 与共享目录仍阻断、epoch 不匹配
不阻断，以及删除事务回滚/重试。三项均通过，未新增 Rust test 函数。Renderer 现有测试扩展后 185 项通过，
`pnpm typecheck` 通过。完整 `pnpm test:rust:pr` 再次通过：477 passed、1 项原有 ignored。

`node scripts/smoke-stop-continue.mjs --historical-startup --historical-mission` 通过：在独立 Git 项目中正常停止，
关闭 Core 后仅撤去旧 ACK 并保留异常文件；重开同 Mission/Conversation/member/Runtime，后继任务成功。
旧 ACK 仍为空时 `cleanupAvailable=true`，真实清理命令完成 Worktree/分支双检查点，工作目录已移除；
随后删除该会话，业务聚合和受管资源 journal 均完成。历史会话读取 183ms；大批量旧账本耗尽共享清理预算时
后继 prompt 已启动。现场 `rovai-stop-continue-aa2PyZ/acceptance.json` 保留本次结果。

上一节已安装产物不包含这三处修正，已由 `c144e691c` 的最新候选替代。`pnpm package:mac:daily` 通过，
App/Host 仍为 0.5.3、arm64、ad-hoc 签名；最终提升应核对此候选，不复用上一节旧包。

| 最终候选文件 | SHA-256 |
| --- | --- |
| 内置 Host | `dc379920eeaa3ee6e6c5aaf983cbdfc61da4ebd3128212a33b7eddde56653e90` |
| 内置 CLI | `606e2d8463f5f8e4dc61cdfb06ad4560a8fa8a41013e0450e9f759d8b6789f02` |
| Renderer/主进程 app.asar | `07c3d009b6468faca7486c6c658440be8e0e3488e8a5c3c1f98ca0f7946f27b8` |

同一隔离现场的真实 Codex 发布 `STARTUP_FINAL_OK`，实际运行 `sleep 120` 时停止，约 261ms 观测到真实 ACK；
`STARTUP_FINAL_AFTER_STOP_OK` 成功，正常退出重开后 `STARTUP_FINAL_REOPEN_OK` 也成功。三次成功执行的原生证据
均已核对；Conversation、agent_1 和 Runtime installation 保持一致，没有自动重放。8195 个检查文件与旧 ACK 空值
保持原样，两次 App 均正常退出。`final-packaged-acceptance.json`、`final-packaged-path.png` 和
`final-build-manifest.json` 保存在 `/tmp/rovai-startup-dev.iu5eiu/`。

`c144e691c` 的 [PR CI](https://github.com/murray17/rovai-ai/actions/runs/40903096698) 与
[原生 Windows 全目标编译](https://github.com/murray17/rovai-ai/actions/runs/40903113000) 通过。
前述 Windows Runtime 矩阵仍属于生命周期修复提交；本次资源入口修正没有重复运行全矩阵，不能记为最新提交的全矩阵通过。
日常原会话副本验收仍未执行，安装和隔离验收不改变这个边界。
