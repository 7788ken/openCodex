# Session 模型

## 目的

本文定义 openCodex 第一版的 session 与 summary 模型。
该模型刻意保持精简、易于实现。
它需要同时适配 `run`、`review` 和 `doctor`，而不是为每个命令单独设计存储格式。

## 设计目标

1. 为第一阶段命令保持一套共享结构。
2. 保留足够的元数据用于审计和历史记录。
3. 提供同时适合人类和机器消费的稳定 summary 结构。
4. MVP 只保留最小字段，把高级追踪能力后置。

## Status 枚举

session status 应使用以下值：

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`
- `partial`

### 状态含义

- `completed` 表示命令成功完成。
- `failed` 表示命令以错误结束。
- `partial` 表示命令结束了，但请求结果并不完整。
- `cancelled` 表示 session 在完成前被停止。

## Session Metadata

每个 session 都应保存以下顶层字段。

### MVP 必需字段

- `session_id`
- `command`
- `status`
- `created_at`
- `updated_at`
- `working_directory`
- `codex_cli_version`
- `input`
- `summary`
- `artifacts`

### 字段说明

- `session_id` — openCodex session 的本地唯一标识。
- `command` — `run`、`review` 或 `doctor` 之一。
- `status` — 当前或最终的 session 状态。
- `created_at` — session 创建时间戳。
- `updated_at` — 最近一次更新时间戳。
- `working_directory` — 执行发生的仓库或本地目录。
- `codex_cli_version` — 本次 session 使用的 Codex CLI 版本。
- `input` — 归一化后的用户或系统输入。
- `summary` — 归一化后的结果摘要。
- `artifacts` — 指向本地结果文件的结构化引用。

### MVP 后置字段

- `parent_session_id`
- `profile`
- `approval_mode`
- `sandbox_mode`
- `tags`
- `operator`
- `duration_ms`
- `resume_token`

这些字段后续会有价值，但不应阻塞第一版实现。

## Input 结构

`input` 对象应保持精简。

### MVP 必需字段

- `prompt`
- `arguments`

### 字段说明

- `prompt` — 主任务或指令文本。
- `arguments` — 归一化后的命令选项键值数据。

### 命令适配说明

- `run` 应保存任务 prompt 和 wrapper flags。
- `review` 应保存 review 目标，例如 `uncommitted`、`base` 或 `commit`。
- `doctor` 应保存请求的检查范围（如有）。

## Summary 结构

`summary` 对象是主要的稳定输出契约。
它既要便于人阅读，也要利于自动化消费。

### MVP 必需字段

- `title`
- `result`
- `status`
- `highlights`
- `next_steps`

### 字段说明

- `title` — 一行结果标题。
- `result` — 简短结果说明段落。
- `status` — 为方便消费而复制的最终状态。
- `highlights` — 关键发现、变更或检查项列表。
- `next_steps` — 建议的后续动作列表。

### 可选字段

- `risks`
- `validation`
- `changed_files`
- `findings`

这些字段在可用时建议填写，但模型不应强制每个命令都产出它们。

## Artifacts

`artifacts` 字段应为结构化记录列表。
每个 artifact 表示 session 产出或引用的一个本地文件。

### MVP Artifact 字段

- `type`
- `path`
- `description`

### 建议的 Artifact 类型

- `last_message`
- `jsonl_events`
- `output_schema`
- `review_report`
- `doctor_report`
- `log`

## 最小存储布局

MVP 使用简单的本地目录布局即可。

```text
.opencodex/
└── sessions/
    └── <session_id>/
        ├── session.json
        ├── events.jsonl
        ├── last-message.txt
        └── artifacts/
```

### 存储规则

- `session.json` 保存归一化后的 session 对象。
- `events.jsonl` 在可用时保存原始机器可读事件流。
- `last-message.txt` 在可用时保存最终 assistant message。
- `artifacts/` 保存报告或导出结果等额外文件。

## 命令兼容说明

### `run`

- 通常会产出 `events.jsonl`、`last-message.txt` 和一份归一化 summary。

### `review`

- 通常会产出归一化 summary，以及 review findings 或 report artifacts。

### `doctor`

- 通常会产出归一化 summary，以及结构化的环境检查结果。

## MVP 边界

第一版实现不应要求：

- 实时事件流状态机，
- 跨设备同步，
- 多用户归属模型，
- 远程 artifact 存储，
- 除基础元数据保留之外的 session resume 能力。

## 建议

第一版应围绕单个 `session.json` 契约和一个小型 artifact 目录来实现。
这样既容易落地，也为后续 session history、resume 和 gateway 功能留下空间。
