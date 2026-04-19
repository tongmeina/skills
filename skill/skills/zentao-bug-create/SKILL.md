---
name: zentao-bug-create
description: 将整理好的缺陷标题与描述通过禅道 REST API 创建为 Bug。当用户要把 Bug 单写入禅道、创建缺陷、同步到应急叫应平台项目、或提到 zentao-bug-create 脚本时触发。
---

# 禅道创建缺陷

## 脚本

`mcp/scripts/zentao-bug-create.mjs`（与 `zentao-bugs-summary.mjs` 共用 `mcp.json` 里禅道账号）。

## 要点

- 禅道创建接口使用 **产品 ID**：`POST /api.php/v1/products/{id}/bugs`（接口层不能省略产品）。
- 仅 `--project-name` 时：脚本先读项目详情，再 **`GET /projects/{id}/bugs`**（与 `zentao-bugs-summary.mjs` 同源）从已有缺陷推断 **product**，无需手填产品 ID（无历史缺陷时仍可能失败，需 `--product-id`）。
- 「项目」通过请求体字段 **project** 关联；若已给 `--product-id`，可再加 `--project-name` / `--project-id` 写入所属项目。
- 若不知产品 ID，可先执行 `node mcp/scripts/zentao-bug-create.mjs --list-products <关键词>`。
- 必填：`--title`，以及 `--steps` 或 `--steps-file`（缺陷描述全文）。
- 可选：`--severity`、`--pri`、`--type`（如 `codeerror` / `others`）、`--opened-build trunk`、`--execution <迭代ID>`、`--dry-run`。
- 可选：`--attach <本地路径>`（可多次）创建成功后上传到该缺陷（`POST /api.php/v2/files`，建议禅道 v22+）。
- 正文 HTML：`steps-file` 中多条列表请用 `1、` `2、` 连续行，脚本会生成 `<ol>`；空行过多会已由脚本合并，避免禅道里异常大空白。

## 示例

```bash
node mcp/scripts/zentao-bug-create.mjs ^
  --project-name "星联应急叫应平台" ^
  --title "【求救群聊】会话内停留时头像在线状态不实时更新" ^
  --steps-file ./bug-steps.md
```

首次建议加 `--dry-run` 确认请求体，再去掉后正式创建。
