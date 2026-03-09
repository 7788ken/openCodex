# Profile 策略

## 目的

openCodex profile 是架在 Codex CLI 之上的一层小型策略映射。
这层策略故意保持精简和可预期。

## 当前可用 Profiles

### `safe`

- approval: `never`
- sandbox: `read-only`
- reasoning effort: `medium`

这个 profile 适合仓库巡检、review 和低风险分析场景。

### `balanced`

- approval: `never`
- `run` 使用 `workspace-write`
- `review` 使用 `read-only`
- reasoning effort: `medium`

这个 profile 是默认值。
它让 `run` 仍可用于本地实际工作，同时让 `review` 保持只读。

### `full-access`

- approval: `never`
- sandbox: `danger-full-access`
- reasoning effort: `medium`

这个 profile 适合同机任务，需要更完整本地访问权限的场景。
它也是 Telegram CTO 通道和菜单栏服务控制的默认模式。

## 项目级默认值

仓库可以通过 `opencodex.config.json` 声明项目级默认 profile。
openCodex 会先在有效工作目录里查找该文件，再继续向上查找父目录。

```json
{
  "default_profile": "balanced",
  "commands": {
    "run": { "profile": "balanced" },
    "review": { "profile": "safe" }
  }
}
```

### 解析优先级

- CLI 显式 `--profile`
- `commands.<command>.profile`
- `default_profile`
- 内建默认值：`balanced`

## 当前范围

当前版本的 profile 目前应用于：

- `opencodex run`
- `opencodex review`
- Telegram CTO 委托执行
- Telegram `launchd` 服务与菜单栏控制

## 非目标

当前版本暂不提供：

- 用户自定义 profile 定义
- 更复杂的 approval 策略组合
- 细粒度的工具级权限白名单
