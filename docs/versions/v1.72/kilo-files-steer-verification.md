---
document_type: implementation-record
version: v1.72
status: implemented-preview
last_updated: 2026-11-09
---

# Kilo 原生前台策略、文件工具与 Steer

User sequence 14/15 要求检查类似 Claude 的子代理禁用方式、使用 sub2api 打开开发版验证文件操作，
接通具备原生基础的 Steer，并简化接入。继续使用原 `rovai/kilo-acp` worktree。
该阶段规范为 [Launch v80](../../contracts/runtime-launch-and-verification-v80.md)；后续边界与当前入口见[收尾记录](kilo-boundary-fixes.md)。

## 实现取舍与复杂度复核

| 关注点 | 与现有 Runtime 对齐及必要差异 |
| --- | --- |
| 子代理 | Claude 当前使用 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`，只禁后台。Kilo 固定原生 `KILO_EXPERIMENTAL_BACKGROUND_SUBAGENTS=false`，保留前台 task；没有全面禁用子代理或改写模型 schema |
| Steer | 普通 `session/prompt` 复用已有 CodeBuddy 传输分支；Hermes 原多请求状态改名为共享 `AcpPromptProgress`，Kilo 共用终态汇合，不复制队列或管理器 |
| 提交顺序 | 共用输入账本、Formatter、Run/epoch/Prompt 与 CLI lease。共享 scheduler 按 Run 串行等待完整回执；没有为追求并发修改其他 Runtime 调度 |
| 文件结果 | 约 25 行 Kilo 元数据映射读取 write/edit 的 filediff 和 apply_patch 的 files；解析、路径及预算共用 MiniMax 现有 native patch normalizer，Renderer 无 Runtime 分支 |
| write 类型 | 共用 OpenCode 的 Boolean exists 映射；已有空文件是 update，不读取磁盘猜测 |
| 配置保序回调 | 保留。只在 inline 中设置 wildcard 无法保住原生多来源合并后的具体规则顺序，已由真实 CLI 复现；回调不接收工具请求、不求值权限、不读取 B/P |
| Host 与 MCP | 保留单 Binding Host 和真实变更后的既有 invalidation。官方 backend 按 directory 缓存 MCP，同 Host 空列表无法撤销旧工具；不另建池或 Session |
| 取消 | 增加最多 2 秒等待现有 route 的 prompt 终态，然后沿共享进程清理。针对实际取消后继挂起，不删除 Kilo 私有锁或快照文件 |

没有新增 SHA256、审批层、私有历史、配置镜像、进程池、压缩 observer、classifier 或数据库迁移。
B/P、Formatter、Manifest、Bootstrap 与投递证据版本保持，不加入模型输入文案。

## 验证与发现

官方 Kilo 7.8.27、macOS arm64。受控探针沿原 `probe-kilo-runtime.mjs` 扩展，
已实际完成 write→read→edit（中文/空格路径）、后台拒绝、前台子代理，以及既有 MCP/压缩/冷恢复场景。
task 仍可见，background 参数不在 schema；显式 true 被拒且没有 child Session，前台调用创建一个 child。
本轮原生探针为 `rovai-kilo-native-TFjjH0`，两个自有 Host 已清理。

真实开发通道使用 `pnpm dev`，独立 userData、Skill Library、MCP、HOME/XDG 与项目。
仅将本机已选 sub2api Provider 放入私有 Kilo 验收配置，密钥不进入证据、仓库或公开消息。
模型为 `sub2api/gpt-6.1-sol`，未操作日常 App 或数据。
模型验收完成后已移除隔离配置副本的密钥，保留 App 供查看；在该夹具再次调用模型需补回凭据。

首次真实 Run 实际完成 write 新建、覆盖与已有空文件写入及 read 回读；GPT 原生没有 edit，使用 apply_patch。
同 Run 的 UI 插话已被原生接受，后续文件修改及公共发送完成，只有一个根 Run，投递记录为 start/steer accepted。
首次界面暴露 write 缺少增删详情、apply_patch 缺少路径投影，按实际原生结果补齐，原始失败展示保留。

开发 fixture `rovai-kilo-dev-kfa734zr`，Thread `rvcamp_01m707gmx5eyh8c279m54ppwwa`：

| 真实 Run | 结果 |
| --- | --- |
| `cc9ad511-da62-4b4f-8289-91205aeb7389` | succeeded；start/steer 均 accepted；初版 UI 缺少 patch 文件和增删详情，失败状态未重写 |
| `f5410bfc-8028-46eb-92f3-bcd34ad6222f` | succeeded；修复后的新建/覆盖 write 和 apply_patch、read 回读通过；Files Changed 为 3 文件、3 操作、+5/−3 |

第二轮 `复测 新建.txt` 为 add +2/−0，`覆盖.txt` 为 update +2/−2，`待编辑.txt` 为 update +1/−1。
在 App 展开后者，红绿 hunk 只替换状态行，标题与保留行仍在；持久化 projection 同样记录这三项。
开发 App 保留在该差异详情，原有 composer 草稿保持。该 UI 验收的二进制早于最后的取消等待补丁；
取消补丁由下述新构建 Core 独立验证，不将它表述成真实模型 UI 取消验收。
最后重新通过 `pnpm dev` 构建并启动包含取消补丁的开发版，重开同一持久化差异，3 文件 +5/−3 及原草稿保持。

### Core Steer 与取消恢复

`smoke-kilo-runtime.mjs` 继续使用生产 Core、官方 CLI 与本地受控 Provider。
最终 fixture `rovai-kilo-core-qfKSUE`：**19 个 Run：17 个 succeeded、2 个主动 cancelled**。
首次/warm/cold、权限保序/审批、MCP A→B→A、Bootstrap、输出快照及部分数值采样继续通过。

- 首轮模型流保持运行时提交一条更正，原生先入库，模型随后收到该更正；同根 Run 等待原请求和补充请求结束。
  Steer 账本 accepted 一条，后继普通消息成功。
- 补充 prompt 已入库、尚未得到回执时取消，根 Run 为 cancelled，补充为 delivery_unknown，未自动重放；
  下一条普通输入 succeeded。另一个已有普通取消场景同样通过且没有延迟文件副作用。
- 账本最终为 19 条 start accepted、一条 steer accepted、一条 steer delivery_unknown。
  原生支持多个在途请求，但生产 scheduler 本轮仍只串行派发，不能把传输 owner 的多 RPC 测试当作用户输入并行验收。

原失败 fixture `rovai-kilo-core-vFLt8n`、`rovai-kilo-core-hqvv4M` 和 `rovai-kilo-core-FZGzmX` 保留：
待回执 Steer 取消后，紧接的普通输入停在原生 `Initializing snapshot…`，尚未到 Provider。
将夹具改为 Git 项目仍复现，排除了仅由非 Git 根目录扫描引起的解释。
沿现有取消顺序，通知成功后等待当前 route 离开 PromptActive，再进入既有进程清理，最终整套通过。
这个结果支持收尾顺序修复；不宣称已穷尽原生快照内部原因或所有取消时序。

[白名单机器证据](../../research/kilo-runtime/files-steer-7.8.27-macos-arm64.json)
只发布版本、case、账本、文件计数与 Run 关联；真实模型请求、原生数据库与凭据不作为公开附件。

## 测试归属

扩展已有 active-input receipt、frozen Run admission、原生配置、write exists、事件归一化和 native patch owners；
新增 Rust 测试函数为零。旧 Hermes 1.0.0 期望与现有 major=0 门禁不一致，仅修正断言为 VersionUnverified，
没有放宽 Hermes 生产门槛。
active-input owner 同时验证取消不会在原生终态前立即返回、补充结果未知及两种 RPC 返回顺序。

相关 extended owners、`pnpm typecheck`、`TZ=UTC pnpm test`（前端 3190、Node 377 通过，分别 2 项 skip）、
`pnpm build:desktop`、`pnpm dev` 的全链 Debug/Desktop 构建和真实 App、Node 语法与 format/diff 检查通过。
取消等待补丁后的 `cargo test --workspace` 为 484 passed、1 项既有 ignored；
最终 active-input extended owner 通过。`pnpm docs:test` 10 项通过、`pnpm docs:check` 及
`DOCS_BASE_REF=958784f6e17fc32d8b2753d7f14fd6122dceea9d pnpm docs:check:ci` 通过。

## 适用边界与官方依据

仍为 macOS arm64 Preview。只有官方 7.8.27 被本次实际执行；7.x 的实现门槛不是所有 7.x 已验收的声明。
真实模型只覆盖 sub2api/gpt-6.1-sol；edit 单独由受控模型触发，未伪称 GPT 使用过 edit。
不扩大到其他平台、完整 Skills 矩阵、自动/overflow 压缩或全部结束竞态。
apply_patch 的 move 类型保持原生文本展示，本次未实现或验收 rename 投影。

- [原生 task 与后台开关](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/tool/task.ts)。
- [模型工具选择](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/tool/registry.ts)、[ACP 工具投影](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/tool.ts)。
- [write 结果](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/tool/write.ts)、[edit 结果](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/tool/edit.ts)。
- [apply_patch 结果](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/tool/apply_patch.ts)。
- [ACP service](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/service.ts)、[原生快照](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/snapshot/index.ts)。
