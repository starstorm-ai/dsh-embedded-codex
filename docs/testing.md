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
6. 比较打包后的 `Codex 模式` preset 与 UTF-8 源文件，防止乱码或旧包缓存回归。

自动测试使用 fake App Server，不读取 ChatGPT 认证文件、不启动真实 Codex turn，也不消耗账户配额。

## 调试单个测试

不为每个测试文件维护 package script，直接把文件传给 Vitest：

```powershell
pnpm exec vitest run tests/runtime.spec.ts
pnpm exec vitest run tests/permissions.spec.ts tests/permission-provider.spec.ts
pnpm exec vitest run tests/permission-ui-overrides.spec.ts
pnpm exec vitest run tests/loader-composition.spec.ts tests/profile-composition.spec.ts
pnpm exec vitest run tests/projection.spec.ts
pnpm exec vitest run tests/compatibility.spec.ts
```

Runtime fixture 使用内存 Session 与 JSON-RPC stream，不绑定端口、时钟或真实子进程。投影测试使用固定 DSH 的 Chat 和 Trajectory builder，断言用户消息、工具过程和最终答案的 turn/step 顺序。

`tests/runtime.spec.ts` 还固定了输入准备兼容边界：`agent/pre-step` 的文本改写与伴随消息必须同时进入 Session 和 `turn/start`/`turn/steer`，新增 image block 必须转换为 data URL，已有 Host attachment 路径仍使用 `localImage`。测试也覆盖首轮 `reject`、空 decision、steering 改写、series 标记与 steering 拒绝，防止插件引用未经展开就发送给 Codex。

权限测试分四层：`tests/permissions.spec.ts` 固定三种 Codex 模式的纯映射和 fail-closed 输入；`tests/permission-provider.spec.ts` 固定标准/Codex 两张表、Agent preset 迁移、Auto-review 同元组保留与活动 turn guard；`tests/permission-ui-overrides.spec.ts` 固定中英文文案、DSH 图标别名、popup 说明和三 factory 装配顺序；`tests/runtime.spec.ts` 断言 thread 与每个 turn 的 JSON-RPC 字段、逐轮切换、服务端回写校验和权限审批字段过滤。

## 真实账号检查

真实 Codex 验证是人工流程：

```powershell
pnpm exec codex login
pnpm dev
```

`pnpm dev` 使用稳定本地链接；第一次注册后，后续插件修改只重新构建，不再安装 Codex。需要验证真实 tarball 时先执行 `pnpm dev:install`，再执行 `pnpm dev:web`。自动化测试同时覆盖“第二次开发链接必须跳过安装”和全新 Profile 的真实 tarball 安装。

在 Web 中创建新 Session 并选择 `Codex 模式`，中文 locale 下检查“请批准 / 帮我批准 / 完全权限”，英文 locale 下检查 “Ask for approval / Approve for me / Full access”；composer 选择器的三项均应显示 DSH 盾牌图标，前两项的 `/permission` popup 说明和 composer tooltip 也应随 locale 改变。Ask 的联网和工作区外访问应进入 DSH 用户审批；Auto-review 应显示原生自动审核且不扩大 workspace/network 边界；Full access 应在风险确认后不再产生沙盒越界审批。每次切换从下一新 turn 生效，活动 turn 中切换应被拒绝，重启恢复和 fork 应保留精确模式。随后检查模型列表、reasoning effort、文本和图片、工具、request-user-input、token 与取消。安装 Context Picker 时，再分别发送文件选区与剪贴板图片：聊天气泡保持简短标签，Session 的模型表面不含原始 `dsh-context:` URI，并出现 `source.kind: context-picker` 的伴随消息；模型能读到选区位置/文本和图片内容。最后切回标准预设，确认普通 DSH Runtime 仍显示原权限表且行为不受影响。

不要在共享 CI 或没有明确配额授权的无人值守环境中运行真实账号检查。
