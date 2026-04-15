---
name: zentao-bug-summary
description: 从禅道拉取指定项目的缺陷列表并生成汇总报告。当用户提到禅道缺陷、Bug汇总、缺陷统计、缺陷报告、项目Bug时触发。
---

# 禅道缺陷汇总

## 脚本位置

统一脚本：`mcp/scripts/zentao-bugs-summary.mjs`（位于当前工作区）

## 使用方式

在终端执行，按需组合参数：

```bash
# 按项目名称（模糊匹配）
node mcp/scripts/zentao-bugs-summary.mjs --project-name "星联应急叫应平台"

# 按项目 ID
node mcp/scripts/zentao-bugs-summary.mjs --project-id 1216

# 只看某个创建者（中文姓名）
node mcp/scripts/zentao-bugs-summary.mjs --project-name "星联" --creator "童美娜"

# 排除已关闭
node mcp/scripts/zentao-bugs-summary.mjs --project-id 1216 --no-closed

# 多个创建者
node mcp/scripts/zentao-bugs-summary.mjs --project-id 1216 --creator "童美娜" --creator "林庆敏"

# 自定义输出目录
node mcp/scripts/zentao-bugs-summary.mjs --project-id 1216 --out-dir ./my-report
```

## 输出

脚本在 `mcp/output/` 下生成两个文件，命名规则：**`{禅道项目全名}-bugs-{YYYYMMDD}.json`**（`.md` 同基名），例如 `【磐钴】位置监控平台-国际化-bugs-20260411.json`。

| 文件 | 内容 |
|------|------|
| `…-bugs-YYYYMMDD.json` | 结构化数据 |
| `…-bugs-YYYYMMDD.md` | 按 **创建者 → 状态 → 优先级** 分组的中文 Markdown 报告，含统计 |

## 执行流程

1. 从 `~/.cursor/mcp.json` 的 `mcpServers.zentao.env` 读取禅道账号配置
2. 登录获取 Token → 按项目拉取全部 Bug（分页）→ 调用 users 接口自动映射账号到中文姓名
3. 按参数筛选 → 分组排序 → 写入 JSON + MD

## 前置条件

- `~/.cursor/mcp.json` 中已配置 `zentao` 的 `ZENTAO_URL`、`ZENTAO_ACCOUNT`、`ZENTAO_PASSWORD`
- Node.js 18+（需要原生 fetch）

## 常见问题

- **找不到项目**：用 `--project-name` 时关键词要在项目全名里能匹配到；不确定就用 `--project-id`
- **登录失败**：检查 `mcp.json` 中账号密码是否正确
- **Token 过期**：脚本自动处理 401 重新登录
