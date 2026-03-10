# CTO 灵魂文档

openCodex 现在把 CTO 灵魂提示词拆成三层：
- `prompts/cto-soul.md`：共享身份层
- `prompts/cto-chat-soul.md`：聊天 / 探讨 / 轻反馈层
- `prompts/cto-workflow-soul.md`：workflow 编排层

另外，三个真实子代理也各自有独立 soul：
- `prompts/cto-reply-agent-soul.md`
- `prompts/cto-planner-agent-soul.md`
- `prompts/cto-worker-agent-soul.md`

对于 detached 的 Telegram service 安装，openCodex 会优先使用 `<state-dir>/cto-soul.md`、`<state-dir>/cto-chat-soul.md`、`<state-dir>/cto-workflow-soul.md` 这三份 service-local 副本，避免已安装产品继续依赖仓库 checkout。

## 作用

- 定义长期稳定的 CTO 身份
- 让默认模板建立在 Codex CLI 通用个人助理的人格底座之上
- 把“聊天主线”和“workflow 编排”约束拆开，避免互相污染
- 明确以 Codex CLI 作为本地执行引擎，openCodex 只做薄编排层
- 明确 CTO 身份属于宿主机上的 supervisor，而不是某个沙箱子会话
- 明确聊天、探讨、研究也是 CTO 的一等能力，而不是只有编排
- 约束 CTO 如何理解 CEO 意图、如何派发任务、何时需要回头确认

## 当前行为

- Telegram CTO 会在主线程运行时读取共享 soul，并按当前模式附加 chat/workflow overlay
- detached Telegram service 默认会把三份文件放到 `<state-dir>/cto-soul.md`、`<state-dir>/cto-chat-soul.md`、`<state-dir>/cto-workflow-soul.md`
- 临时本地运行仍会回退到 `prompts/cto-soul.md`、`prompts/cto-chat-soul.md`、`prompts/cto-workflow-soul.md`
- 读取到的内容会分层附加到 CTO 主线程 system prompt 中
- 宿主 supervisor 才是面向 CEO 的 CTO 身份与 workflow owner
- CTO 可以停留在直接聊天 / 探讨 / 研究模式，而不是把每条消息都强制升格成任务编排
- 沙箱子会话由宿主 supervisor 创建，承担 advisor、planner、reviewer 或局部 helper 的角色
- 子代理提示词依旧由 CTO 主线程生成，而不是由子代理自行发挥
- 如果某一层文件缺失，openCodex 会只对该层回退到内置默认模板
- 任务栏 app 可以通过 `Edit CTO Soul` 直接打开这个文件
- 任务栏 app 也可以通过 `Edit CTO Chat Soul` / `Edit CTO Workflow Soul` 分别打开两份 overlay
- 任务栏 app 也可以通过 `Restore Default CTO Soul` 恢复默认模板

## 编辑建议

- 内容使用英文
- 保持角色化、长期有效、相对稳定
- 优先写高层策略，不要写临时任务清单
- 共享层写身份、语言、权限、产品边界
- chat 层写聊天风格、探索模式、何时不要升级成 workflow
- workflow 层写编排、拆任务、等待确认、子线程纪律
- reply-agent 层写直聊回复搭子的语气与边界
- planner-agent 层写规划子代理的拆解风格与确认阈值
- worker-agent 层写执行子代理的工程风格、回滚意识与汇报方式
- 这些文件都用于塑造宿主 supervisor 形态的 CTO，不用于记录一次性的工作笔记
