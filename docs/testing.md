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

1. `pnpm build`，确保 DSH 前置产物和插件产物完整。
2. 全部 Vitest。
3. oxlint。
4. Markdown 链接、代码块和基础格式检查。
5. 生成真实 tarball，在 `.tmp/packed-smoke-home` 中完成插件安装、Profile 组合和卸载。
6. 验证声明式 preset、六个 replacement、可写的 Agent Preset 默认值、原版 Conversation UI 与默认 Agent Loop 的组合。

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
```

Runtime fixture 使用内存 Session 与 JSON-RPC stream，不绑定端口、时钟或真实子进程。投影测试使用固定 DSH 的 Chat 和 Trajectory builder，断言用户消息、工具过程和最终答案的 turn/step 顺序。

`tests/runtime.spec.ts` 还固定了输入准备兼容边界：`agent/pre-step` 的文本改写与伴随消息必须同时进入 Session 和 `turn/start`/`turn/steer`，新增 image block 必须转换为 data URL，已有 Host attachment 路径仍使用 `localImage`。测试也覆盖首轮 `reject`、空 decision、steering 改写、series 标记与 steering 拒绝，防止插件引用未经展开就发送给 Codex。

权限测试分四层：`tests/permissions.spec.ts` 固定三种 Codex 模式的纯映射和 fail-closed 输入；`tests/permission-provider.spec.ts` 固定标准/Codex 两张表、Agent preset 迁移、Auto-review 同元组保留与活动 turn guard；`tests/permission-ui.spec.ts` 固定 Session 选项优先、process catalog fallback 和原版 Conversation UI 边界；`tests/runtime.spec.ts` 断言 thread 与每个 turn 的 JSON-RPC 字段、逐轮切换、服务端回写校验和权限审批字段过滤。`tests/desktop.spec.ts` 固定完整命令矩阵、Electron 默认入口和参数透传。

## 真实账号检查

真实 Codex 验证是人工流程：

```powershell
codex login
pnpm dev
```

`pnpm dev` 使用隔离 Desktop Profile 和真实插件 tgz。需要验证用户 Profile 时，先启动 Desktop 一次、完全退出，再执行 `pnpm desktop:install-plugin`。Web 验证只通过显式 `pnpm dev:web` 进行。

在 Desktop 中创建新 Session 并选择 `Embedded Codex`，检查 Ask for approval / Approve for me / Full access 三项。Ask 的联网和工作区外访问应进入 DSH 用户审批；Auto-review 不得扩大 workspace/network 边界；Full access 应先显示风险确认。每次切换从下一新 turn 生效，活动 turn 中切换应被拒绝，重启恢复和 fork 应保留精确模式。随后检查模型列表、reasoning effort、文本和图片、工具、request-user-input、token、隐藏窗口继续运行、quit/update 清理与 Codex 进程异常恢复。最后切回标准预设，确认普通 DSH Runtime 仍显示标准权限表。

发布候选还必须在 Windows x64、macOS x64 和 macOS arm64 发布机分别运行显式 `package:desktop:*`；日常先跑 `:dir`。脚本会用 packaged Desktop command 在隔离的 `desktop` Profile 执行 add/list，启动 packaged Host 并加载 frontend，正常退出后再执行 remove/list；任一步失败都会使打包失败。检查 `dist/desktop/<target>` 同时包含真实客户端制品、插件 tgz 与一致的 `integration-manifest.json`，并手工完成 GUI 首次启动、重新启动和一轮真实 Codex 任务。Windows unsigned 测试产物只允许出现在 `dist/desktop/unsigned/win-x64`。

不要在共享 CI 或没有明确配额授权的无人值守环境中运行真实账号检查。
