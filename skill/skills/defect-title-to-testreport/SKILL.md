---
name: defect-title-to-testreport
description: 读取缺陷标题文件并按指定测试报告Excel模板生成报告。适用于“缺陷标题转测试报告”“根据缺陷列表生成测试报告”“testreport模板输出”等场景。
allowed-tools: Read, Write, Bash, Glob
---

# 缺陷标题转测试报告

根据指定测试报告模板（Excel），读取上传的缺陷标题文件，自动生成符合模板结构的测试报告。

## 快速开始

```bash
python scripts/generate_report.py \
  --defects "E:\path\defects.txt" \
  --template "E:\a项目汇总\PG综合服务平台\PG综合服务平台\testreport\星地多网融合调度指挥系统V3.1.12测试报告.xls" \
  --output "E:\path\测试报告_缺陷导入.xlsx"
```

## 使用说明

### 1. 输入文件

支持以下格式：
- `.txt`：每行一个缺陷标题
- `.csv`：包含标题列
- `.xlsx` / `.xls`：包含标题列

### 2. 模板读取规则

脚本会从模板中自动识别：
- 使用的 sheet（默认第一个，可用 `--sheet` 指定）
- 表头所在行（在前 20 行中自动识别）
- “缺陷标题”列（基于关键词自动匹配）

如自动识别失败，可显式传参：
```bash
--sheet "缺陷列表"
--title-col "缺陷标题"
--header-row 3
```

### 3. 输出规则

脚本会在表头下一行开始写入缺陷数据，并尽量保留模板格式：
- **标题列**：写入缺陷标题
- **序号/ID列**：自动递增填充
- **严重程度/优先级/状态列**：可用参数提供默认值

### 4. 默认值参数（可选）

```bash
--severity "中"
--priority "P2"
--status "未关闭"
```

## 脚本参数

```bash
python scripts/generate_report.py \
  --defects <缺陷标题文件> \
  --template <测试报告模板> \
  --output <输出文件> \
  --sheet <sheet名称> \
  --title-col <标题列名> \
  --header-row <表头行号> \
  --severity <默认严重程度> \
  --priority <默认优先级> \
  --status <默认状态>
```

## 依赖

如模板为 `.xls`，建议安装以下依赖：

```bash
pip install xlrd==1.2.0 xlwt xlutils
```

如模板为 `.xlsx`：

```bash
pip install openpyxl
```

若需同时兼容 `.xls` 与 `.xlsx`：

```bash
pip install openpyxl xlrd==1.2.0 xlwt xlutils
```

## 常见问题

- **Q：标题列找不到？**  
  A：用 `--title-col` 显式指定列名。

- **Q：模板中有多个sheet？**  
  A：用 `--sheet` 指定sheet名称。

- **Q：想保留模板格式？**  
  A：脚本会优先复制模板文件再写入数据，尽量保持原格式。

## 示例

见 `examples/defects.txt`。
