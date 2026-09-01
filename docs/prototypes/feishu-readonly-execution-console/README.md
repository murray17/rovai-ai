# 飞书只读执行台 HTML 设计稿

状态：产品已确认并已落到生产页面；本目录只保留设计过程，不是当前合同权威。

打开 `index.html` 即可评审。页面上方的桌面/手机、日间/夜间、执行中/已完成切换器只用于比较方案，不属于产品界面；页面中的消息和执行记录均为合成数据。

本稿集中验证三件事：

- 网页内容结构是否足够接近 Rovai 当前生产执行台；
- 飞书侧触发者是否应统一显示为“你”；
- AgentRun、连续操作组和每个 Command 的折叠层级是否与生产执行台一致，并在手机端仍然容易操作。

对应结构、响应式规则与身份文案已落到 `ExecutionViewService` 的生产页面；当前语义由
[Feishu Channel v11](../../contracts/feishu-channel-v11.md) 与[渠道设置 UI](../../ui/components/channel-settings.md)拥有。
