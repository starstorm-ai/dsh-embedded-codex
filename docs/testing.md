---
description: "dsh-embedded-codex 的自动测试、打包验证和真实账号检查。"
kind: "guide"
---

# 测试

## 完整自动检查

```powershell
pnpm test
```

这是 CI 和本地提交前唯一需要记忆的测试命令，依次执行：

1. `pnpm build` 准备插件依赖闭包与发布产物，另行准备 CLI/Loader 集成依赖，均不构建 Desktop。
2. 全部 Vitest。
3. oxlint。
4. Markdown 链接、代码块和基础格式检查。
5. 生成真实 tarball，在 `.tmp/packed-smoke-home` 中完成插件安装、Profile 组合和卸载。
6. 验证声明式 preset、六个 replacement、可写的 Agent Preset 默认值、原版 Conversation UI 与默认 Agent Loop 的组合。
7. 在 tgz 安装目录分别编译 Host 和 Client 消费者，使用独立 NodeNext 配置及 `skipLibCheck: false`，验证所有类型入口无需仓库别名或源码目录。DSH 的 Host/Client Context 属于不同运行环境，分别检查。

自动测试使用 fake App Server，不读取 ChatGPT 认证文件、不启动真实 Codex turn，也不消耗账户配额。

## 调试单个测试

不为每个测试文件维护 package script，直接把文件传给 Vitest：

```powershell
pnpm exec vitest run tests/runtime.spec.ts
pnpm exec vitest run tests/permissions.spec.ts tests/permission-provider.spec.ts
pnpm exec vitest run tests/permission-ui.spec.ts tests/desktop.spec.ts
pnpm exec vitest run tests/loader-composition.spec.ts tests/profile-composition.spec.ts
pnpm exec vitest run tests/config-editor-replacement.spec.ts
pnpm exec vitest run tests/projection.spec.ts
pnpm exec vitest run tests/compatibility.spec.ts
pnpm exec vitest run tests/upstream-build.spec.ts tests/desktop.spec.ts
```

Runtime fixture 使用内存 Session 与 JSON-RPC stream，不绑定端口、时钟或真实子进程。投影测试使用固定 DSH 的 Chat 和 Trajectory builder，断言用户消息、工具过程和最终答案的 turn/step 顺序。

## 行为与故障边界

| 范围 | 必须保留的验证 |
|---|---|
| Loader 与作用域 | `loader-composition.spec.ts` 在真实 Cordis 插件作用域创建 Controller，Codex → standard → Codex → minimal → Codex 连续切换，真实 JSONL 持久化 |
| Session 协调 | `session-coordinator.spec.ts` 检查按 Session 排队、模型精确恢复、清理失败不创建第二个写入者及聚合错误；Loader 检查持有旧 Agent 的并发调用和 admission |
| 原生绑定 | `native-binding.spec.ts` 与 Runtime 用例检查首轮无 Assistant 取消后的恢复、精确 fork 前缀、损坏日志、重复通知、写入失败禁止发送及提交未知禁止重发 |
| 输入生命周期 | `runtime.spec.ts` 检查 pre-step 改写、伴随消息、reject、空 decision、steering 和 request series，禁止未经展开的插件引用泄漏给模型 |
| 图片与事件 | 已有 Host attachment 使用 `localImage`，新增 image block 使用 data URL；投影测试检查 turn/step、工具 call/result 和最终答案顺序 |
| 权限映射 | `permissions.spec.ts` 固定三模式完整字段及非法输入；`permission-provider.spec.ts` 检查两张表、只读迁移、同元组 Auto-review 保留和活动 turn guard |
| 权限集成 | `permission-ui.spec.ts` 检查 Session 选项优先及原版 Conversation UI；Runtime 检查 thread/turn 字段、服务端回写约束和审批字段过滤 |
| 缓存 | `build-cache.spec.ts` 检查并发、中断后的锁恢复、失败、产物缺失、tgz 损坏和安装修复 |
| 前置构建 | `upstream-build.spec.ts` 用真实 TypeScript 编译验证 Host 先生成 Remote 声明、Client 随后编译、缺失产物恢复，以及不编译 Desktop |
| Desktop 命令 | `desktop.spec.ts` 检查命令矩阵、默认 Electron 入口、参数透传和独立构建边界 |
| 发布声明 | 真实安装后的 Host/Client 消费者分别通过 `skipLibCheck: false`；不依赖仓库别名、生成源码或本地 Remote 副本 |

Cordis 根 Context 会绕过部分依赖注入约束，直接 `new Controller(rootCtx)` 的测试不能代替插件作用域测试。`agentPresets` 的嵌套注入回归必须保持；仅靠源码包含某段字符串的检查，也不能证明实际切换成功。

## Desktop 成品检查

Desktop 使用 `pnpm build:desktop`、`pnpm dev:verify` 和对应平台的 `package:desktop:*:dir` 另行验证。`pnpm test` 的 tgz/Loader 检查不包含完整 Electron App 打包。构建前后 `git -C upstream/deepseek-harness status --short` 应为空；日常插件变更应复用 Desktop private checkout/build。

package 的自动检查会使用成品自带的 command，在隔离 `desktop` Profile 中依次执行：

1. 验证 DSH 版本及 production dependencies。
2. 安装真实插件 tgz，并检查 Profile 注册与 list。
3. 启动 packaged Host，认证并加载 frontend。
4. 调用界面使用的 `session/create` 和 `agentPresets/select` Remote 接口，完成 Codex 与 standard/minimal 往返切换；重新取得 Session 时断言 ID 和 preset 均正确。
5. 正常停止 Host、卸载插件，确认 manifest 与 module tree 均已移除，并清理测试 Profile。

该检查不发送模型输入，不能替代 GUI 和真实账号测试。任何一步失败都会阻止交付；manifest 的 `deliverySmoke.presetSwitchingReady` 仅在切换通过后写为 `true`。目标命令、unsigned 配置与数据隔离路径见 [Desktop 指南](desktop.md)；已运行与未验证的范围见[兼容性](compatibility.md)。

## 真实账号检查

真实 Codex 验证是人工流程：

```powershell
codex login
pnpm dev
```

`pnpm dev` 使用隔离 Desktop Profile 和真实插件 tgz。需要验证用户 Profile 时，先启动 Desktop 一次、完全退出，再执行 `pnpm desktop:install-plugin`。Web 验证只通过显式 `pnpm dev:web` 进行。

在 Desktop 中验证：

1. 新建空白 Session，在 Embedded Codex 和普通 preset 之间往返，确认输入、模型选择和权限表可用；发送第一轮后再尝试切换 Agent Preset，应明确拒绝。
2. 在 Codex Session 检查 Ask / Auto-review / Full access。Ask 的联网和工作区外请求进入审批；Auto-review 不扩大边界；Full access 保留风险确认。活动 turn 中权限切换被拒绝，空闲时修改影响下一新 turn。
3. 验证模型、reasoning effort、文本、图片、工具、用户问题与 token 展示，分别拒绝和取消审批。
4. 首轮无输出即取消、重启恢复、按历史边界 fork；精确权限模式和原生绑定应保留，不重复执行提交结果未知的输入。
5. 隐藏窗口时任务继续；quit/update 清理 App Server；原生进程异常退出后的恢复可诊断。检查未登录、登录过期和默认配置下 API-key-only 登录的拒绝路径。
6. 另建标准 Session，确认使用标准 Runtime 和权限表。已有模型 turn 的 Codex Session 不能通过切 preset 转为标准 Session。

发布候选在 Windows x64、macOS x64 和 macOS arm64 的目标机分别执行打包、GUI 首次启动和重启、一轮真实 Codex 任务。正式签名、安装器升级、外置插件在升级后的保留，以及自动更新服务单独验证；unsigned 目录冒烟不覆盖这些能力。记录实际版本、平台、命令和结果，未运行的项目明确标注。

不要在共享 CI 或没有明确配额授权的无人值守环境中运行真实账号检查。
