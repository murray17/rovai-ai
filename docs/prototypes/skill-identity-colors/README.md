# Skill 身份色与列表可读性 HTML 原型

这是一次性的 Skill 设置页设计稿，沿用生产 Renderer 的 Neutral Porcelain + Steel 壳层与
现有八种身份色。它只用于确认视觉层级和交互，不连接 Core，也不会修改真实 Skill。

直接打开 [`index.html`](./index.html) 即可预览，或在项目根目录运行：

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs/prototypes/skill-identity-colors
```

然后访问 `http://127.0.0.1:4173/`。

可交互内容：

- 搜索 Skill；
- 切换本地文件夹 / GitHub 添加方式；
- 使用无文字 Steel Switch 切换示例状态；
- 打开投递范围菜单；
- 展开详情查看已从列表首层移入的来源与 Revision；
- 打开右下角“8 色映射”，核对 UUID → FNV-1a → `% 8` 的颜色结果。

原型中的 UUID 是为了展示八种色系而准备的固定样例。生产实现必须读取真实不可变
`skill.id`，不得按 Skill 名称硬编码颜色。
