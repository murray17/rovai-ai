---
document_type: implementation-proposal
version: v1.72
authority: implementation-proposal
status: proposed
revision: 3
last_updated: 2026-11-23
---

# macOS 应用内 ZIP 增量更新提案 R3

**建议推进实现。默认启用的条件是客户端遇到异常分段能立即转为全量，且两种 Mac 的签名升级验收通过。** v0.5.14 → v0.5.15 在当前网络上少传约 76% 的 ZIP 数据，实际快了 3.7 至 7.3 秒。每版只增加两份分块索引（blockmap），用户从 DMG 安装或在 App 中点更新即可。以下判断基于锁定的 `electron-updater 6.8.9`。[逐次实测记录](evidence/macos-zip-differential-update-2026-11-23.json)

## GitHub 实际请求数与耗时

2026-11-23 在同一台 Apple Silicon Mac 上，用 Electron 43.1.1 的网络栈访问两个版本的官方 Release。GitHub 和资产域名均走用户现有系统代理，同会话的出口探测为美国。两个版本的公开 ZIP 均按各自清单校验。历史标签缺少公开的 ZIP 索引，因此从原 ZIP 本地生成索引，ZIP 的每个分段都从真实 GitHub 下载。[v0.5.14 发布资产](https://github.com/murray17/rovai-ai/releases/expanded_assets/v0.5.14) · [v0.5.15 发布资产](https://github.com/murray17/rovai-ai/releases/expanded_assets/v0.5.15)

| 目标 ZIP 架构 | 变化块 → 合并后分段 GET | 增量 ZIP 流量 | 全量 ZIP 流量 | 增量耗时 | 全量耗时 | 节省时间 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Apple Silicon | 1,717 → 118 | 37.37 MB | 157.71 MB | 24.9 秒 | 28.6 秒 | 3.7 秒（13%） |
| Intel | 1,849 → 111 | 39.70 MB | 163.34 MB | 23.7 秒 | 31.0 秒 | 7.3 秒（24%） |

使用实际的 `GitHubProvider`、`GenericDifferentialDownloader` 和 `ElectronHttpExecutor`。四次传输依次执行，每种组合各一次。计时包含下载、写盘和更新器的 SHA-512 校验，均通过。表中 MB 为十进制，分段次数只算 ZIP 的数据请求，每次增量另有一次 GitHub 重定向。两个架构的每一段都返回正确的 `206` 和 `Content-Range`。计时未覆盖索引的网络传输、安装与重启，Intel 一行测的是 Intel 发布包在这台机器上的下载。[实测顺序、字节及摘要](evidence/macos-zip-differential-update-2026-11-23.json)

GitHub 使用串行单段请求，每完成 100 段暂停 1 秒。两组分段首字节耗时的中位数分别约 144 和 146 毫秒。粗略地看，假定带宽等条件相同，Apple Silicon 每个额外分段多等约 32 毫秒，就可能抵消这次 3.7 秒的优势。这个样本支持节省流量，对其他线路或版本组合的耗时仍需单独判断。[GitHub 下载配置](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.9/packages/electron-updater/src/providers/GitHubProvider.ts) · [串行下载实现](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.9/packages/electron-updater/src/differentialDownloader/DifferentialDownloader.ts)

## 签名下载地址的有效期

两个增量样本均在首个请求重定向后复用同一个 CDN 地址。收到重定向时，URL 的 `se` 分别剩 **53.8 和 57.5 分钟**。评审另观察到 39 分钟，剩余时间随请求变化。本次公网传输均在有效期内结束。另用本机夹具验证了中途拒绝的情形。前两段成功传输 43,463 字节，第三段返回 403。更新器随后重新请求原始 Release 入口，取得整包并通过摘要校验。已下载的两段计入实际流量。[重定向观测与 403 夹具](evidence/macos-zip-differential-update-2026-11-23.json)

## 回退时沿用现有进度条

Windows 已由 NSIS 更新器在增量失败时自动下载完整 EXE。Windows 与 macOS 共用关于页，Main 收到 `download-progress` 后更新已传字节、总量和百分比。关于页按这些数值显示普通进度条，切换到全量属于同一次下载。[NSIS 回退逻辑](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.9/packages/electron-updater/src/NsisUpdater.ts) · [Main 进度处理](../../../apps/desktop/src/main/app-updates.ts) · [关于页](../../../apps/desktop/src/renderer/src/AboutUpdatesSettings.tsx)

macOS 沿用相同行为。新装用户缺少旧 ZIP 时直接走全量。增量途中回退时，关于页收到下一条全量进度后，按整包的总量显示，百分比可能回落。用户只需点一次下载。若整包下载或校验也失败，沿用现有失败状态和重试入口。[MacUpdater 的完整 ZIP 路径](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.9/packages/electron-updater/src/MacUpdater.ts)

## 索引与旧 ZIP 缓存错配

macOS 复用的旧 ZIP 通常位于 `~/Library/Caches/rovai-ai-updater/update.zip`。新索引成功获取后会先写入待更新目录，完成下载时再提升为 `current.blockmap`。若新索引获取失败、全量 ZIP 成功，旧索引可能留在缓存。远端后来恢复也无法直接修正已留在本机的索引。[AppUpdater 缓存顺序](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.9/packages/electron-updater/src/AppUpdater.ts)

用三版本夹具验证了两种结果。第一次升级缺新索引后，ZIP 已是 B 版，索引仍是 A 版。随后一次升级复用的字节刚好有效，传了 74,389 字节便通过校验。另一次因复用了错误字节，先传 41,621 字节，再回退到 524,410 字节的完整包。两次最终都得到了正确 ZIP 和目标索引。额外流量取决于实际复用的内容以及后续索引能否成功取得。首版可接受这一成本，保留连续升级回归用例。[缓存与三版本测试结果](evidence/macos-zip-differential-update-2026-11-23.json)

## 代理忽略 Range 的流量成本

R1 只记录了最终回退成功，漏记了回退前的字节。R2 用大小为 **524,410 字节**的 ZIP 补测。正常差分计划需要 4 段、共 74,389 字节。服务端对 4 段均返回 `200` 和完整文件，原版更新器读入 2,097,640 字节，摘要失败后又下载一次全量。合计 **2,622,050 字节，恰好是完整包的 5 倍**。SHA-512 拦住了错误的 ZIP，流量与临时磁盘写入已经发生。[响应与进度记录](evidence/macos-zip-differential-update-2026-11-23.json) · [上游分段处理](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.9/packages/electron-updater/src/differentialDownloader/DifferentialDownloader.ts)

建议在锁定依赖的串行 Range 分支补上响应检查。收到头时要求状态为 `206`，核对 `Content-Range` 的起止和目标文件总长。若有 `Content-Length`，须与请求长度相同。读正文时也设置该段的字节上限，并验证最终实收长度。异常时立即中止当前请求、停止后续分段，关闭增量写入后，从稳定 URL 发起一次完整下载。完整下载正常接受 `200`。保留现有最终 SHA-512 与 macOS 签名校验。项目已有按版本维护 pnpm 补丁的机制，共享下载逻辑的回归应覆盖 Windows NSIS。[依赖补丁配置](../../../pnpm-workspace.yaml)

## 发布范围与首个获益版本

- **从下一个草稿发布。** 设首个同时带客户端保护和两份索引的版本为 N。签名构建、产物汇总和草稿传输白名单及其 `manifest.files` 显式收集 `Rovai-AI-<version>-<arch>.zip.blockmap`（arm64、x64），核对它们与最终 ZIP 的对应关系、大小、SHA-256，并加入新版本的 `SHA256SUMS.txt`。macOS 仍发布两个完整 ZIP、两个 DMG 和合并后的 `latest-mac.yml`。索引由 ZIP URL 派生，清单中保留两个 ZIP 的大小和 SHA-512。历史 v0.5.15 的公开清单还列有两个 DMG，MacUpdater 会选 ZIP。按该版资产和大小估算，每版增加 2 个附件，共约 0.34 MB。[构建工作流](../../../.github/workflows/macos-signed-build.yml) · [仅接收草稿的传输工作流](../../../.github/workflows/release-asset-transfer.yml) · [历史发布清单](https://github.com/murray17/rovai-ai/releases/download/v0.5.15/latest-mac.yml)
- **现有用户升级到 N。** 保持 v0.5.15 的公开资产原样。普通老用户缺少旧索引，或缺少旧 ZIP 缓存，此次会下载完整 ZIP。缺旧索引发生在分段传输开始前，只产生索引请求开销。已有旧 ZIP 且成功取得 N 索引时，本次全量成功后会缓存 N 的 ZIP 与索引。
- **常规收益从 N → N+1 开始。** 下载行为由发起升级的旧 App 决定。已在 App 内下载过 N 且保有匹配 ZIP 的用户，可用本地或 N 的公开索引走增量。DMG 新装、清理缓存或手动迁移签名的用户，首次应用内升级通常走全量。v0.0.1、截至 v0.4.0 的临时自签名版和本地 ad-hoc 版，首次迁移到 Developer ID 正式版仍须从 DMG 替换 App 并保留用户数据。[现行分发与签名迁移说明](../../development/packaging.md#主动检查更新发布集合)
- 本提案聚焦 macOS 应用内更新。发布说明里的安装入口可独立评审。Windows 继续使用现有 EXE 更新，Linux 的独立 Server 和其他 Server 发行包沿用原整包流程。

## 放行验收

1. **限制回退成本。** 对响应 200、错误的 206 区间、短包、超长正文和中途 403 记录请求数、实际接收字节与文件写入量。异常段须在头部或字节上限处中止，后续分段数为零，整包只发起一次。另验证正常 206、缺索引、用户取消，以及全量下载失败或 SHA-512 错误时的重试与安装状态。
2. **回退与缓存。** 验证增量失败后同一次操作自动完成整包下载，关于页可进入“安装并重启”。回退时允许进度按整包重新计算。连续升级覆盖旧索引配新 ZIP，最终交接的文件须匹配官方摘要。
3. **签名安装与公开可达。** 在隔离候选通道，使用同一 Apple Team ID 的正式签名包，在 Apple Silicon 与 Intel 上分别完成增量、直接全量、回退全量三条安装重启路径，并验证旧用户数据可读。另验 DMG 新装后的首次应用内升级。草稿阶段用发布凭据检查完整资产。公开后匿名读取两份索引并核对两个 ZIP 的真实 Range 响应。公网试验覆盖 ZIP 下载与校验，本机兼容夹具替代了原生安装交接。签名升级仍待此项验收。[macOS 发布验证入口](../../../scripts/verify-macos-release.mjs)
