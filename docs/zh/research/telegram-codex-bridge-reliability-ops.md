# telegram-codex-bridge 可靠性、可观测性与运维实践调研

- 调研对象仓库：`https://github.com/InDreamer/telegram-codex-bridge`
- 本地基线：`/tmp/telegram-codex-bridge`（HEAD: `bd66e09`）
- 调研时间：2026-03-23
- 调研范围：只读分析，不改上游代码

## What exists now（事实）

### 1) 错误处理与 fail-fast

- 启动前置检查较完整且偏 fail-fast：`probeReadiness` 会依次检查 Node 版本、目录可写、service manager、`codex` 命令可用、Codex 版本与能力、登录状态、Telegram token、app-server 可用性；任一关键项失败会直接返回非 ready 状态，`BridgeService.run()` 随后拒绝进入主循环。
- 状态库打开失败时会阻断启动：`BridgeStateStore.open` 对非 `ENOENT` 的打开错误直接失败，不做“自动重建覆盖”；同时落盘 `state-store-open-failure.json` 并记录分类（`integrity_failure` / `schema_failure` / `transient_open_failure`）。
- SQLite 打开路径包含 schema/migration 与 `PRAGMA integrity_check`，对 schema 不一致和完整性异常会硬失败。
- Telegram 发送链路有有限重试：消息/图片发送统一最多重试 2 次（延迟 750ms、2000ms），并支持 `retry_after` 感知；超过阈值后明确记 error 日志。
- 授权边界是强约束：未授权用户被拒绝并记录 `unauthorized telegram access rejected`，不会进入执行路径。

### 2) 日志、遥测与事件可追踪性

- 日志是结构化 JSON 行（`logger.ts`），包含 `ts/level/component/message` 和业务字段，默认同步镜像到 stdout/stderr。
- 日志分层较细：主桥接日志、bootstrap、app-server，以及 runtime card 三类表面日志（status/plan/error）分别落盘。
- runtime UI 有专门 trace sink：记录 `sessionId/chatId/threadId/turnId/surface/messageId`，有利于从 Telegram 卡片反查执行上下文。
- 每个 turn 还有 JSONL debug journal（按 `runtime/debug/<threadId>/<turnId>.jsonl`），单文件大小超过阈值会覆盖回写，避免无限增长。
- 具备基础运维诊断面：`ctb status`、`ctb doctor`，并输出 readiness 快照、pending notices、archive drift 等。

### 3) 中断后恢复 / 续航机制

- bridge 重启后会扫描“上次还在 running”的会话并统一标记失败，写 runtime notice（`bridge_restart_recovery`），并向 Telegram 发 recovery hub 提示人工恢复，而不是静默遗留脏状态。
- Telegram long polling offset 使用“临时文件 + rename”原子写；offset 文件损坏时会重命名为 `.corrupt.<ts>` 并从 0 恢复，避免崩溃卡死。
- app-server 子进程退出会触发桥接侧处理：清理 thread archive pending op、标记 active turn 异常并尝试一次自动重连；重连失败会把 readiness 置为 `app_server_unavailable`。
- thread archive 有显式 reconciler，能识别远端状态漂移并记录 drift/conflict 日志。

### 4) 配置/密钥/环境管理与安全边界

- 配置来源明确：`bridge.env` + 进程环境合并，bridge setting 以 `bridge.env` 为持久配置源；支持 Linux/macOS/Windows 差异路径。
- `TELEGRAM_BOT_TOKEN`、`VOICE_OPENAI_API_KEY` 等敏感值以明文写入 `bridge.env`（文件级保护依赖宿主机权限模型）。
- install/admin 面有跨平台 supervisor 集成（systemd user / launchd / Task Scheduler），并能在 `ctb doctor` 中透出状态。
- 运行模型是单用户高信任控制面（非多租户）：授权绑定后拒绝其他 Telegram 用户。

### 5) 测试/验证与发布卫生

- 自动化测试基线不低：`src/**/*.test.ts` 共 31 个测试文件，覆盖 config/process/readiness/install/state/store、Telegram API/poller、service 子协调器等关键模块。
- CI 覆盖 OS×Node 维度：`ubuntu-latest` + `windows-latest`，Node 24/25，执行 `check + test + build`。
- 诊断与发布后可用性检查依赖 `ctb doctor`/`ctb status`，具备一定“可运行性验收”能力。

## What is strong（强项）

1. 启动门禁扎实：readiness 检查链路长、失败即停，能在进入主循环前暴露关键环境问题。
2. 数据安全姿态正确：状态库异常默认“保留现场并阻断”，而不是自动重建掩盖问题。
3. 恢复策略务实：桥接重启、offset 损坏、app-server 退出都存在明确处理分支，不会 silent failure。
4. 可观测性结构化：JSON 日志 + runtime surface trace + per-turn debug journal，支持从“用户可见卡片”反查“执行事件”。
5. 运维工具闭环基本齐全：`status/doctor/start/stop/restart/update` 与 supervisor 集成，适合长期运行场景。
6. 测试和 CI 已覆盖核心运行路径，跨平台验证意识较强。

## What is fragile（脆弱点）

1. 日志与调试文件缺少统一保留策略：`bridge.log`、`app-server.log`、session-flow logs 无内建 rotate；turn journal虽限单文件大小，但目录级总量仍可持续膨胀。
2. 自动恢复力度偏保守：app-server 退出仅一次重连尝试；失败后停留在降级状态，缺少渐进退避重连与告警节流策略。
3. 失败分类可观测但运维分级动作不够：目前更多是写日志/状态，缺少“可机器消费的告警等级或事件码”。
4. Telegram 轮询失败统一 sleep 固定间隔重试，缺少指数退避/抖动与错误类型分层（例如网络抖动 vs 认证失效）。
5. 密钥管理安全性依赖本机文件权限：敏感值在 `bridge.env` 明文持久化，CLI 安装参数也容易落入 shell history 或进程参数痕迹。
6. 发布卫生仍偏基础：CI 只做类型、单测、构建；缺少集成 smoke、最小端到端回归、覆盖率门槛、依赖安全扫描/签名发布等硬闸。

## Concrete improvements for openCodex（可迁移改进，按优先级）

### P0（先做，直接降低线上风险）

1. 引入“状态存储故障标记 + 分类 + fail-fast”三件套
- 迁移点：借鉴 `state-store-open-failure.json` 模式，为 openCodex 的关键持久层建立 `stage + classification + recommended_action` 标准记录。
- 价值：避免“自动修复掩盖数据损坏”，出问题时保留证据并快速分诊。

2. 增加服务启动 readiness 门禁并阻断主循环
- 迁移点：把“版本/认证/外部依赖可用性/关键目录可写性”前置成统一探针，非健康状态拒绝进入长期循环。
- 价值：把故障从运行期前移到启动期，降低隐性故障时间窗。

3. 标准化重启恢复语义（running -> failed + recovery notice）
- 迁移点：对中断会话显式落盘失败原因与恢复提示，禁止 silent resume 或 silent discard。
- 价值：用户视角可解释，系统状态不漂移。

4. 将 Telegram/IM 投递链路抽成“有限重试 + rate-limit 感知”公共组件
- 迁移点：统一 `retry_after`、非可重试错误快速失败、重试次数上限、日志字段规范。
- 价值：减少消息层随机失败，避免无限重试拖垮服务。

### P1（第二批，提升运维效率与可观测深度）

1. 构建“统一事件字典”
- 做法：为关键事件定义 `event_code`（如 `APP_SERVER_EXIT`, `STATE_STORE_INTEGRITY_FAIL`, `DELIVERY_RETRY_SCHEDULED`）和严重级别。
- 价值：便于告警聚合、自动化处理和跨版本稳定分析。

2. 补齐日志生命周期管理
- 做法：落地日志滚动策略（按大小/按天）、保留天数、压缩与清理任务；debug journal 增加目录级 quota。
- 价值：避免磁盘被慢性打满导致次生故障。

3. 将一次性重连升级为“可控退避重连”
- 做法：app-server 不可用时采用指数退避 + 抖动 + 最大重试窗口，并输出状态事件。
- 价值：减少瞬时故障导致的长时间不可用。

4. 轮询错误分层处理
- 做法：把认证类错误、429、网络错误拆开策略；认证失败直接进入明显故障态并提示人工干预。
- 价值：减少无效重试和噪音日志。

### P2（第三批，发布与治理体系化）

1. 发布前健康闸扩展
- 做法：在现有 type/test/build 基础上增加最小 E2E smoke（启动 bridge -> mock/update -> 关键命令回路）。
- 价值：拦截“单测过但链路断”的回归。

2. 安全与依赖卫生
- 做法：增加依赖漏洞扫描、lockfile 变更审计、敏感配置检查（例如禁止示例中暴露真实 token）。
- 价值：降低供应链风险。

3. 运行手册标准化
- 做法：沉淀故障场景 SOP（state-store 失败、app-server 挂掉、telegram token 失效、offset 损坏）并配套命令清单。
- 价值：让一线排障从“专家经验”变成“可执行流程”。

## 对 openCodex 的落地建议（单一主方案）

建议采用“先硬门禁、再补观测、后扩发布闸”的单路线：

1. 第一阶段（P0）先把 readiness fail-fast + 存储故障分类 + 重启恢复语义落地。
2. 第二阶段（P1）补事件字典、日志保留和退避重连，把系统从“可跑”提升到“可运维”。
3. 第三阶段（P2）再补齐 E2E smoke 和安全闸，把发布质量收口到流程。

这样可以以最小改造先消除高风险盲区，再逐步增强长期稳定性和运维效率。
