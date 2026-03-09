# CTO 灵魂文档

`prompts/cto-soul.md` 是 openCodex CTO 主线程可编辑的初始化提示文档。

## 作用

- 定义长期稳定的 CTO 身份
- 固定 Telegram CTO 工作流的编排风格
- 明确以 Codex CLI 作为本地执行引擎，openCodex 只做薄编排层
- 约束 CTO 如何理解 CEO 意图、如何派发任务、何时需要回头确认

## 当前行为

- Telegram CTO 每次进入 planning 前都会读取 `prompts/cto-soul.md`
- 读取到的内容会附加到 CTO 主线程 system prompt 中
- 子代理提示词依旧由 CTO 主线程生成，而不是由子代理自行发挥
- 如果文件缺失，openCodex 会回退到内置默认灵魂模板
- 任务栏 app 可以通过 `Edit CTO Soul` 直接打开这个文件

## 编辑建议

- 内容使用英文
- 保持角色化、长期有效、相对稳定
- 优先写高层策略，不要写临时任务清单
- 这个文件用于塑造 CTO，不用于记录一次性的工作笔记
