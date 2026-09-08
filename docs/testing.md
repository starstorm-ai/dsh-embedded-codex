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
pnpm exec vitest run tests/loader-composition.spec.ts tests/profile-composition.spec.ts
pnpm exec vitest run tests/projection.spec.ts
pnpm exec vitest run tests/compatibility.spec.ts
```

Runtime fixture 使用内存 Session 与 JSON-RPC stream，不绑定端口、时钟或真实子进程。投影测试使用固定 DSH 的 Chat 和 Trajectory builder，断言用户消息、工具过程和最终答案的 turn/step 顺序。

## 真实账号检查

真实 Codex 验证是人工流程：

```powershell
pnpm exec codex login
pnpm dev
```

`pnpm dev` 使用稳定本地链接；第一次注册后，后续插件修改只重新构建，不再安装 Codex。需要验证真实 tarball 时先执行 `pnpm dev:install`，再执行 `pnpm dev:web`。自动化测试同时覆盖“第二次开发链接必须跳过安装”和全新 Profile 的真实 tarball 安装。

在 Web 中创建新 Session 并选择 `Codex 模式`，检查模型列表、reasoning effort、文本和图片、工具、审批、request-user-input、token、取消、重启恢复和 fork。最后切回标准预设，确认普通 DSH Runtime 不受影响。

不要在共享 CI 或没有明确配额授权的无人值守环境中运行真实账号检查。
