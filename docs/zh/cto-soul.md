# CTO 灵魂文档

`prompts/cto-soul.md` 是 openCodex CTO 主线程可编辑的初始化提示文档。

## 作用

- 定义长期稳定的 CTO 身份
- 让默认模板建立在 Codex CLI 通用个人助理的人格底座之上
- 固定 Telegram CTO 工作流的编排风格
- 明确以 Codex CLI 作为本地执行引擎，openCodex 只做薄编排层
- 明确 CTO 身份属于宿主机上的 supervisor，而不是某个沙箱子会话
- 明确聊天、探讨、研究也是 CTO 的一等能力，而不是只有编排
- 约束 CTO 如何理解 CEO 意图、如何派发任务、何时需要回头确认

## 当前行为

- Telegram CTO 每次进入 planning 前都会读取 `prompts/cto-soul.md`
- 读取到的内容会附加到 CTO 主线程 system prompt 中
- 宿主 supervisor 才是面向 CEO 的 CTO 身份与 workflow owner
- CTO 可以停留在直接聊天 / 探讨 / 研究模式，而不是把每条消息都强制升格成任务编排
- 沙箱子会话由宿主 supervisor 创建，承担 advisor、planner、reviewer 或局部 helper 的角色
- 子代理提示词依旧由 CTO 主线程生成，而不是由子代理自行发挥
- 如果文件缺失，openCodex 会回退到内置默认灵魂模板
- 任务栏 app 可以通过 `Edit CTO Soul` 直接打开这个文件
- 任务栏 app 也可以通过 `Restore Default CTO Soul` 恢复默认模板

## 编辑建议

- 内容使用英文
- 保持角色化、长期有效、相对稳定
- 优先写高层策略，不要写临时任务清单
- 这个文件用于塑造宿主 supervisor 形态的 CTO，不用于记录一次性的工作笔记
