# Doctor 命令

## 目的

`opencodex doctor` 用于检查本机是否已准备好运行基于 Codex CLI 的 openCodex 工作流。
它是辅助命令，不是主要干活入口。

## 检查清单

第一版会检查：

- Codex CLI 是否可用
- Codex CLI 版本是否满足最低要求（`>= 0.116.0`）
- Codex 登录状态
- 通过 `codex mcp list --json` 检查 MCP 可见性
- 当前是否处于 Git 工作区
- `~/.codex/config.toml` 是否存在
- 当前 openCodex launcher 是源码 checkout 还是独立安装入口
- 已安装的 Telegram service 是否仍绑定在源码 checkout 上

## 输出结构

该命令会产出：

- 一份归一化 session summary
- 一组结构化 checks 列表
- 一份保存下来的 `doctor-report.json` artifact

每个 check 包含：

- `name`
- `status`
- `required`
- `details`

## 退出行为

- 当所有必需检查都通过时，退出码为 `0`
- 当任一必需检查失败时，退出码为 `1`
- warning 不会让命令失败

## 非目标

第一版不做：

- 默认修改用户环境
- 自动修复环境问题
- 替代真实的 `run` 工作流
