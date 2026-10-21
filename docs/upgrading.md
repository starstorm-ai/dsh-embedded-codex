---
description: "升级固定 DSH submodule、兼容 provider 和 Codex App Server 协议。"
kind: "guide"
---

# 升级

DSH 与 Codex 分开升级。两者都会改变 provider 或 App Server 接口，必须分别审查和测试。

## 升级 DeepSeek Harness

1. 在 `upstream/deepseek-harness` checkout 目标官方 commit。
2. 在父仓库执行 `git add upstream/deepseek-harness`，让 gitlink 成为新的唯一基线。
3. 确认 `agent`、`agent-preset-registry`、`config-editor`、`permission`、`session-controller` 与 `ui-permission` 的 Profile id、package 名称和职责没有发生意外变化，并确认 `ui-conversation` 保持原版启用。
4. 更新 `compat/manifest.json` 的 DSH package 版本与 provider/源码/产物声明；`src/compat/generated-manifest.ts` 由构建生成，不能手工维护第二份清单。
5. 从新基线重新制作并审查 `compat/patches/*.patch`，遵循[兼容性文档](compatibility.md)的目标登记、单文件和 `+` 编码规则。旧 patch 无法应用时，按新 API 重做接入点；不要复制旧 provider 全文覆盖新版本行为。
6. 执行 `pnpm test`。
7. 执行目标 Desktop 的目录打包，检查实际成品 Host 的 preset 切换；再运行真实账号检查，验证恢复、fork、权限、取消、退出及客户端 `removed → added`。
8. 同步支持矩阵、README、第三方声明和验证范围。交付 manifest 由脚本生成，不手工维护第二份运行基线。

构建只取父仓库 index stage 0 gitlink，拒绝冲突和参考 submodule 的 tracked 修改；新基线自动使插件前置、集成前置和 Desktop 缓存失效。Desktop 使用 `.tmp/desktop-source` 的私有副本，审查 `compat/desktop-build.json` 和对应精确转换能否继续应用。不得通过修改参考源码或共享 pnpm store 修复构建。

重点审查服务注入声明、SessionPersistence 生命周期和 preset 组合接口。嵌套可选服务从其注入作用域获取；仅在根 Context 运行测试会漏掉 Cordis 注入错误。新的 DSH 事件必须先确认持久化 catalog 接受该事件，单独扩展 TypeScript 事件类型不代表可落盘。客户端声明检查须使用包外依赖和上游公开 Remote 扩展。

## 升级 Codex

1. 将 `package.json` 的 `@openai/codex` 改为准确版本。
2. 临时设置 `CI=true` 执行 `pnpm install` 更新 `pnpm-lock.yaml`，完成后恢复原环境；方式见 [README](../README.md)。DSH workspace 的 Lefthook 安装器无需接管用户 hooks。
3. 运行维护脚本生成协议：

   ```powershell
   pnpm exec tsx scripts/maintenance/update-protocol.mts
   ```

4. 审查全部 `protocol/` diff，更新 App Server 字段验证、通知映射、请求映射和 fake server fixture。
5. 检查 Windows 原生 executable 和其他平台 package wrapper 的解析，确认 Electron 子进程环境、optional native package、关闭与异常恢复行为。
6. 执行 `pnpm test`、真实账号检查及目标平台 Desktop 资格检查，同步第三方声明和[兼容矩阵](compatibility.md)。

协议生成器直接读取已安装 `@openai/codex` 的 package manifest，不维护第二份 Codex 版本，也不使用 `PATH` 中的 Codex。

## 发布前检查

```powershell
pnpm test
pnpm pack:plugin
pnpm package:desktop:win:x64:dir
```

确认 tarball 不包含 `upstream/`、`compat/generated/`、`.tmp/`、认证文件或日志；确认 Desktop 交付目录包含客户端、tgz 和版本/hash 一致的 manifest。候选发布还要在 macOS x64/arm64 运行对应显式脚本。

Desktop package 命令会重复完成其所需的完整门禁，可直接作为目标平台的发布验证入口。打包配置、unsigned 目录检查和外置插件安装见 [Desktop 指南](desktop.md)。检查 `deliverySmoke.presetSwitchingReady`，并单独记录真实账号、签名、安装器和更新验证结果。

不要在 DSH 安装目录应用源码 patch，也不要提交 `compat/generated/`。发布产物必须由 submodule、可审查 patch 和本仓库源码重建。
