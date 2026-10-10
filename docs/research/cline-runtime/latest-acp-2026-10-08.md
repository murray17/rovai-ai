---
document_type: runtime-research
runtime: cline-cli
authority: research-evidence-only
status: verified-with-native-limitations
admission: preview
observed_version: 3.0.70
observed_platform: macos-arm64
last_updated: 2026-10-08
---

# Cline 3.0.70 升级、ACP 恢复与自动压缩核验

User 97 明确授权升级本机 Cline 后，官方 npm `latest` 和 GitHub 稳定发布均为
[CLI 3.0.70](https://github.com/cline/cline/releases/tag/cli-v3.0.70)。实际安装已升级，
账号与 BYOK 的打包 App first/warm/cold 共六轮全部成功。**ACP 原生恢复可用，
普通 ACP Session 的自动 compaction 启用缺口仍在。** 两项结论不互相替代。

## 安装与验收来源

- 原安装是 Homebrew 3.0.3；Homebrew 官方配方也仍为 3.0.3。本机 USTC tap 更新返回 404，
  因而另查官方配方 API 确认版本，未把镜像失败当作最新版结论。
- 执行 `brew unlink cline` 后，按官方 npm 安装方式运行 `npm install --global cline@3.0.70`。
  这是日常命令的正式升级，不是额外的测试 Runtime。旧 Homebrew keg 保留、未删除；未修改 shell 配置。
  Homebrew 更新过程把自身从 7.0.7 更新到 7.0.9，没有升级其他已安装 formula/cask。
- 当前命令 `/opt/homebrew/bin/cline` 指向 `/opt/homebrew/lib/node_modules/cline/bin/cline`；
  命令行和 ACP initialize 均报告 3.0.70。
- 平台二进制位于上述 npm 包的 `node_modules/@cline/cli-darwin-arm64/bin/cline`，SHA-256 为
  `3ae76234a92f4de4fe6f9bf22635ac656994b29af83ea6d5c144b7eeea5a9ae7`。
- 使用分支 `b6057966` 的既有产品夹具及最终执行代码 `9b8fa131` 的打包 App，
  经 Renderer/preload/Core 和正式 ACP Adapter 运行。每组 App/Core 数据、Skill Library、MCP、
  工作区和原生会话存储均独立；未安装、退出或重启日常 Rovai App。
- 账号直接引用已授权的日常原生 Provider 源，选中 openai-codex，未提供静态 API key；
  BYOK 使用此前授权的原 openai-compatible 来源。没有复制凭据、转换 token、重新登录或改换端点。

## 恢复结果

3.0.70 实际 initialize 广告 `loadSession: true`，没有广告 `session/resume`。
[原生 load 实现](https://github.com/cline/cline/blob/0322bc5d510000a33ef5eadc3b4c84df7fcef285/apps/cli/src/acp/acpAgent.ts#L243-L331)
由 Cline 自己读取并恢复 Session，随后按 ACP 协议重放历史通知。
Rovai 只发送 `session/load`，不再 get/messages 后向原生回灌完整历史。
这不是无历史通知的 resume：恢复期仍会收到 `session/update`，共享客户端将其与新一轮执行隔离。

| 真实路径 | 原生账号 | 原 BYOK |
| --- | --- | --- |
| first：创建后实际生成并提交公开发送 | 通过 | 通过 |
| warm：同 Host、同 Session 实际续接 | 通过 | 通过 |
| cold：关闭 Core/App，重启后新 Host load 并实际生成 | 通过 | 通过 |
| cold 后 Session / Binding / generation | 三者不变 | 三者不变 |
| 身份与早期记忆 marker | 正确 | 正确 |
| 每轮已提交的 builtin send | 恰好一次 | 恰好一次 |
| cold 重放隔离 | 旧 Usage/Diff 不变；新 Run 仅一个新工具操作，无旧审批或文件变化 | 同左 |
| App 公开回复读回、自有 Host 清理 | 通过 | 通过 |

两组原生 Provider 文件本轮均未变化；没有实际触发 token 刷新，不将其记为刷新通过。
早期记忆验证也不能替代任意长历史或压缩后恢复资格。
[结构化证据](evidence/latest-acp-2026-10-08.json)保留完整 Host/Session/Binding 关系、Run 计数、
数值 Usage 和清理结果；不保存 Provider 文件、凭据或完整模型上下文。

此前 [3.0.3 的 load 返回 -32601](acp-retirement-2026-10-08.md)仍是有效历史负例。
本轮通过的是新安装 3.0.70，不将升级后的结果倒算为旧版通过，也不新增最低版本门槛。

## 自动 compact：普通 CLI 有，ACP 尚未接通

固定核对官方发布提交 `0322bc5d510000a33ef5eadc3b4c84df7fcef285`，只阅读上游源码，
没有运行源码 checkout、SDK 或 shim，也没有修改已安装二进制。

1. 新版 `cline --help` 的 `--compaction` 默认值是 `agentic`；
   [普通 CLI 配置](https://github.com/cline/cline/blob/0322bc5d510000a33ef5eadc3b4c84df7fcef285/apps/cli/src/main.ts#L1035-L1056)
   调用原生 `buildCliCompactionConfig()`。这说明普通 CLI 入口提供原生自动压缩配置，
   本轮没有另做普通 CLI 长上下文触发验收。
2. [ACP 分支](https://github.com/cline/cline/blob/0322bc5d510000a33ef5eadc3b4c84df7fcef285/apps/cli/src/main.ts#L797-L806)
   提前进入 `runAcpMode()` 并返回，仅传 auto-approve；不会经过上面的配置构建。
3. [ACP buildConfig](https://github.com/cline/cline/blob/0322bc5d510000a33ef5eadc3b4c84df7fcef285/apps/cli/src/acp/acpAgent.ts#L761-L809)
   仍没有 `compaction`。该文件与已核对的 3.0.65–3.0.68 逐字节相同。
4. 下游 Bootstrap 未补默认启用值；
   [本地 Runtime](https://github.com/cline/cline/blob/0322bc5d510000a33ef5eadc3b4c84df7fcef285/sdk/packages/core/src/runtime/host/local-runtime-host.ts#L677-L683)
   将配置交给
   [压缩回调工厂](https://github.com/cline/cline/blob/0322bc5d510000a33ef5eadc3b4c84df7fcef285/sdk/packages/core/src/extensions/context/compaction.ts#L267-L293)，
   后者在 `enabled !== true` 时返回 `undefined`。

因此，**单纯升级到 3.0.70 并未修复 Rovai 所用 ACP 入口的自动压缩**。
这是固定发布源码的调用链结论，不是本轮重新制造 overflow 的结果；六轮短请求不算压缩验收。
原生 imported-history 的特殊处理、已有 compaction sidecar 的恢复投影不在这一普通新会话结论内。
不添加私有参数注入，不留下 Hub，不把普通模型总结或 `/compact` 文本当作原生压缩。

## 复核与边界

复用 [产品夹具](fixtures/acp_product_probe.mjs) 的 `--single-member` 默认 first/warm/cold 流程，
传入当前 `/opt/homebrew/bin/cline`、既有打包 App 和新的私有 root；账号组使用 `--native-account`。
没有 `--skip-cold`，没有重放结果未知的用户输入。两组均在成功后退出并清空自有临时 Host，
持久原生测试会话保留，用户凭据不清理。

本轮只更新实测记录及兼容证据摘要，没有改动 ACP 执行、认证、恢复或压缩代码。
兼容证据摘要 owner 测试通过（1 项）；文档治理测试 10 项、通用及 base-diff 文档门、
Rust 格式和 diff 检查通过。六个公开变更文件的实际凭据及私有端点匹配为零。
旧并行、审批、取消、MCP/Skill 与进程回收报告继续绑定各自实际安装，不外推为 3.0.70 全矩阵通过。
首次完整授权、真实刷新、外部并发刷新、真实长历史/overflow、压缩后恢复及其他平台仍未在本轮验证。
保持 macOS arm64 Preview；PR #662 不自动合并。
