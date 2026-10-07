---
document_type: contract
name: Runtime Launch and Verification
version: v50
status: accepted
source_version: v1.72
last_updated: 2026-10-07
---

# Runtime Launch and Verification v50

继承 [v49](runtime-launch-and-verification-v49.md) 的原生连接、执行、身份、并发、终态与恢复边界。
本版只改变 Claude Code / Codex 设置页已有静态 API Key 的读取回显与编辑，不新增凭据存储或身份探测。

## Owner 设置读取

`runtime.startup.get/observe/save` 的 Owner 编辑响应在 `credential.value` 返回当前实际来源中可读取的静态
API Key；没有可读取值时省略该字段。范围为现有原生 JSON/TOML 来源及已解析的静态环境引用。
这替代 v48“设置响应不回传原 Key、眼睛只显示本次输入”的限制。

原生来源选择不变：不读取或展示 OAuth、刷新令牌，不执行 `apiKeyHelper`／`auth.command` 取值，
不导出钥匙串、云厂商或其他原生托管凭据。Codex `auto` 的文件后备不冒充已选定的钥匙串凭据。
不可读取的来源保留已有状态与限制，不能用掩码冒充真实值。

返回值只用于本次设置会话内存，不进入启动配置、SQLite、浏览器存储、执行冻结、事件、诊断或 Debug。
`NativeCredential` 的 Debug 不输出值；执行快照继续只保存来源和摘要，保存并发仍比较 `credentialVersion`。

## 编辑行为

已有值直接填入 API Key 输入框，默认密码隐藏；眼睛显示／隐藏该输入框中的实际值。
查看、纯往返切换及未修改的保存保持 `{action:"keep"}`，不把读取值附带到写入请求。
改值后保存使用显式 `replace`；恢复原值取消修改。清空已读取的值后保存使用显式 `clear`，
沿用来源可清除限制；对无可读值的来源，清空新输入只取消替换，不删除不透明凭据。
放弃恢复原生读取值，保存成功后回显重新读取值；重新进入、保存或凭据修订变化后恢复隐藏状态。
保存失败保留草稿，外部冲突仍按摘要处理，不在冲突 before/after 中包含密钥。

不显示“已从原生配置读取，无需重新输入。”、“清除 API Key”或“撤销清除”控件。
具体视觉由[原生连接 UI](../ui/components/app-shell-navigation.md#原生连接设置)拥有。
