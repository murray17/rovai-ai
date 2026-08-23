---
document_type: user-guide
authority: installation-guide
last_updated: 2026-08-23
---

# 安装指南

Rovai AI 可以通过桌面安装包使用，也可以从源码启动开发版本。

普通用户建议使用桌面安装包；准备参与开发、调试或验证最新代码时，再选择从源码运行。

## 桌面安装包

前往 [GitHub Releases](https://github.com/murray17/rovai-ai/releases)，下载与你的设备匹配的安装包。

| 平台 | 选择的安装包 | 安装方式 |
|---|---|---|
| macOS · Apple Silicon | 文件名标记为 `arm64` 的 `.dmg` | 打开 DMG，将 Rovai AI 拖入 `Applications` |
| macOS · Intel | 文件名标记为 `x64` 的 `.dmg` | 打开 DMG，将 Rovai AI 拖入 `Applications` |
| Windows · x64 Preview — unsigned | Release 中提供的 Windows x64 `.exe` | 运行当前用户安装程序并按照向导完成安装 |

每个 Release 实际提供哪些平台，以该版本页面中的下载文件为准。
Windows x64 Preview 当前未签名，SmartScreen 可能显示“未知发布者”；请只从 Rovai AI 官方 GitHub Release
下载安装包。Windows Preview 当前只有 Claude Code 完成 Runtime 平台准入，其他目录项在各自证据完整前显示
“Windows 尚未验证不可检查”。Windows 安装向导会显示安装目录选择页；默认使用当前用户目录，也可以改为其他
当前用户可写目录。该 Preview 安装器不会请求管理员权限，因此不要选择需要管理员写入权限的系统目录。

## 第一次启动

第一次打开 Rovai AI 时，会依次完成一次简短的初次训练：

1. **开始旅程**<br>
   进入首次设置流程。

2. **选择第一位队员**<br>
   从内置队员中选择一位伙伴。之后仍然可以继续招募和编辑其他队员。

3. **选择 Agent Runtime**<br>
   Rovai 会检查本机已经安装的 Runtime。选择一个可用 Runtime，并在模型目录已经可用时选择模型。

4. **进入「初次集结」**<br>
   设置完成后，会进入第一个真实会话。你可以直接修改建议提示，然后发送第一条消息。

首次训练不会替你安装 Agent Runtime，也不会接管对应产品的账号。准备使用某个 Runtime 前，需要先按它自己的官方方式完成安装和登录。

## 准备 Agent Runtime

你不需要安装全部 Runtime，只需要准备实际要使用的一个或几个。

当前支持范围见：[Agent Runtime 兼容性清单](../runtime-compatibility.md)。

建议按以下顺序准备：

1. 根据 Runtime 的官方文档完成安装；
2. 在终端中直接启动该 Runtime，完成登录或认证；
3. 打开 Rovai 的 Agent Runtime 设置页；
4. 重新扫描或执行「检查可用性」；
5. 状态显示为「可用」后，再把它分配给队员。

### 常见状态

| 状态 | 说明 | 建议操作 |
|---|---|---|
| 可用 | 已找到并完成基本身份检查，可以选择和尝试运行 | 分配给队员，开始第一个任务 |
| 需要登录 | Runtime 已安装，但上游认证尚未完成 | 在原生 Runtime 中完成登录，再回到 Rovai 检查 |
| 未安装 | 没有找到对应可执行程序 | 按该 Runtime 的官方文档安装 |
| 需要处理 | 版本、环境或启动检查存在问题 | 打开详情，根据提示处理后重新检查 |
| 暂时未知 | 当前证据不足，不能确认是否可用 | 重新扫描，或执行一次显式可用性检查 |
| Windows 尚未验证不可检查 | 该 Runtime 尚未完成独立 Windows x64 资格，不是安装、登录或扫描故障 | 改用已准入的 Claude Code，或等待该 Runtime 完成 Windows 资格 |

模型目录和完整能力可能要在显式检查或第一次真实任务前确认。只看到 Runtime 已安装，并不等于所有模型和权限能力都已经准备完成。

## 从源码运行

当前已记录和验证的开发环境包括 macOS 14 及以上的 Apple Silicon，以及 Windows 10 Pro 22H2 native x64。
Windows 11、Windows ARM64 和 x86 不在当前实机资格结论内。

### 环境要求

- Node.js 24 或更高版本；
- pnpm；
- Rust 与 Cargo；
- Git；
- 至少一个已经安装并完成认证的 Agent Runtime（仅在实际运行 Agent 任务时需要）。

检查基础工具：

```bash
node --version
pnpm --version
rustc --version
cargo --version
git --version
```

### 启动开发版本

```bash
git clone https://github.com/murray17/rovai-ai.git
cd rovai-ai

pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 会构建 Debug 版 Rovai Core 和 bundled `rovai` CLI，并使用隔离的数据目录启动桌面应用。

更完整的开发准备和隔离规则见：

- [开发环境与依赖](../development/environment.md)
- [本地开发与 App 隔离流程](../development/local-workflow.md)
- [开发者指南](../development/README.md)

## 常见问题

### Runtime 已安装，但 Rovai 没有找到

先在普通终端中确认该 Runtime 可以启动，并且当前用户可以访问它。然后回到 Agent Runtime 设置页重新扫描。

如果 Runtime 只安装在自定义路径，优先修复当前用户的安装或 PATH。开发调试时也可以使用仓库文档中列出的 Runtime 路径覆盖环境变量，但不要把本机路径写入仓库或截图。

### Runtime 显示需要登录

直接打开该 Runtime，按照它自己的登录流程完成认证。Rovai 不保存或代管上游 Runtime 的登录凭据。

### Runtime 可用，但还没有模型列表

执行一次「检查可用性」，或让该 Runtime 运行第一个真实任务。部分 Runtime 只有建立原生 Session 后才会返回完整模型与能力目录。

### `pnpm dev` 启动失败

依次检查：

```bash
node --version
pnpm install --frozen-lockfile
pnpm typecheck
```

涉及 Rust 构建时，再检查：

```bash
cargo check --workspace --all-targets
```

更多问题见：[常见问题排查](../development/troubleshooting.md)。
