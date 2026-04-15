---
name: zentao-bug-create
description: 将整理好的缺陷标题与描述通过禅道 REST API 创建为 Bug。当用户要把 Bug 单写入禅道、创建缺陷、同步到应急叫应平台项目、或提到 zentao-bug-create 脚本时触发。
---

# 禅道创建缺陷

## 脚本

`mcp/scripts/zentao-bug-create.mjs`（与 `zentao-bugs-summary.mjs` 共用 `mcp.json` 里禅道账号）。

## 要点

- 禅道创建接口使用 **产品 ID**：`POST /api.php/v1/products/{id}/bugs`。
- 汇总脚本按 **项目** 拉缺陷；若不知产品 ID，可先执行  
  `node mcp/scripts/zentao-bug-create.mjs --list-products 应急`  
  或用 `--project-name` 让脚本从项目详情里解析产品（若服务端返回了 `product` 等字段）。
- 必填：`--title`，以及 `--steps` 或 `--steps-file`（缺陷描述全文）。
- 可选：`--severity`、`--pri`、`--type`（如 `codeerror` / `others`）、`--opened-build trunk`、`--execution <迭代ID>`、`--dry-run`。

## 示例

```bash
node mcp/scripts/zentao-bug-create.mjs ^
  --project-name "星联应急叫应平台" ^
  --title "【求救群聊】会话内停留时头像在线状态不实时更新" ^
  --steps-file ./bug-steps.md
```

首次建议加 `--dry-run` 确认请求体，再去掉后正式创建。
