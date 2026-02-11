# Conventional Commits + Emoji 参考

## 目录

- 概览
- 格式
- Type 与 Emoji 对照表
- 主题行写作规则
- Body 写作指南（Full）
- Footer 写作指南（Full）
- Scope 指南
- 拆分提交策略
- 示例
- 常见错误

## 概览

- 所有 commit message 必须是英文。
- 每条 commit message 必须带 emoji，且 emoji 是主题行的一部分。
- 使用 Conventional Commits 规范：`<type>[scope]: <description>`。

## 格式

### Simple（默认）

```
<emoji> <type>[optional scope]: <description>
```

### Full

```
<emoji> <type>[optional scope]: <description>

<body>

<footer>
```

- 主题行与 body 之间必须空一行。
- body 与 footer 之间空一行。

## Type 与 Emoji 对照表

| Type | Emoji | 含义 | 使用场景 |
|------|-------|------|----------|
| feat | ✨ | 新功能 | 添加新功能 |
| fix | 🐛 | Bug 修复 | 修复问题 |
| docs | 📝 | 文档 | 仅文档变更 |
| style | 🎨 | 代码风格 | 格式化、空格、缺少分号等 |
| refactor | ♻️ | 代码重构 | 既不修复 bug 也不添加功能 |
| perf | ⚡️ | 性能优化 | 性能改进 |
| test | ✅ | 测试 | 添加缺失测试或修复测试 |
| chore | 🔧 | 维护 | 构建过程或工具变更 |
| ci | 👷 | CI/CD | CI 配置变更 |
| build | 📦 | 构建系统 | 影响构建系统的变更 |
| revert | ⏪ | 回滚 | 回滚之前的提交 |

## 主题行写作规则

- 使用祈使语气动词：`add`、`update`、`fix`、`remove`。
- 首字母大写，不要以句号结尾。
- 主题行尽量控制在 50 字符以内（最多 72）。
- 避免实现细节，用“做了什么/为什么”描述。
- 如无明确 scope，可省略 scope。

## Body 写作指南（Full）

- 解释“改了什么”和“为什么”，而不是“怎么实现”。
- 使用项目符号列出多条变更。
- 每行不超过 72 字符。
- 说明行为变化或风险点。

## Footer 写作指南（Full）

- **破坏性变更**：以 `BREAKING CHANGE:` 开头。
- **问题引用**：使用 `Closes:` / `Fixes:` / `Refs:`。
- **协作信息**：`Co-authored-by:` / `Reviewed-by:`。

## Scope 指南

- 使用仓库内稳定的模块名或目录名。
- 保持短小、名词化：`api`、`auth`、`ui`、`db`、`config`。
- 不确定时宁可省略 scope。

## 拆分提交策略

建议拆分提交的情况：

1. **混合类型**：同一提交包含 feat + fix。
2. **多个关注点**：不相关的模块同时修改。
3. **大范围改动**：跨越多个子系统且难以审查。
4. **文件模式混杂**：源码 + 文档 + 依赖更新混在一起。

## 示例

### Simple 示例

```
✨ feat(auth): Add JWT token validation
🐛 fix: Resolve memory leak in event handler
📝 docs: Update API endpoints documentation
♻️ refactor: Simplify authentication logic
⚡️ perf(db): Optimize query execution plan
🔧 chore: Update build dependencies
```

### Full 示例

```
✨ feat(auth): Add OAuth2 authentication flow

Add OAuth2 authentication supporting multiple providers.
Improve login security and reduce manual credential handling.

BREAKING CHANGE: /api/auth now requires client_id parameter
Closes: #456
```

## 常见错误

- 主题行不是英文或夹杂中文。
- 缺少 emoji 或 emoji 未放在主题行最前。
- 主题行使用过去式（e.g. "Added"）。
- 主题行太长或以句号结尾。
- 一个提交混入多个不相关变更。
