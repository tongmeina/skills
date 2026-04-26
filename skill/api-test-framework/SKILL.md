---
name: api-test-framework
description: |
  API 接口自动化测试框架搭建技能。基于 pytest + allure + yaml 数据驱动 + jsonpath 断言的成熟模式，
  支持一键初始化项目结构、生成标准模板代码、快速编写 CRUD 测试用例。
  适用于需要从零搭建或迁移接口自动化测试项目的场景。
  
  触发词：搭建测试框架、API 自动化、接口测试框架、pytest 框架、新建测试项目、
  测试脚手架、conftest 配置、数据驱动测试、allure 报告、BaseRequest 封装、
  编写测试用例、CRUD 接口测试、fixture 链式依赖、yaml 参数化
---

# API 自动化测试框架 — 快速搭建技能

## 技能概述

本技能封装了一套**生产级**的 Python API 接口自动化测试框架模式，源自实际项目验证。新项目只需：
1. 复制模板文件 → 2. 修改配置项 → 3. 编写用例，即可完成框架搭建。

## 使用场景

- **全新项目**: 从零搭建 API 自动化测试框架
- **框架迁移**: 将现有脚本化测试升级为框架化测试
- **模块扩展**: 在已有框架中快速新增 API 模块测试
- **规范统一**: 团队内统一测试代码风格和断言模式

## 快速开始：三步搭建

### 第一步：复制模板到目标项目

将 `assets/` 目录下的所有文件复制到目标项目根目录：

```
assets/
├── conftest.py            → 项目根目录 / (核心配置)
├── requests_util.py       → common/     (HTTP 封装)
├── yaml_util.py           → common/     (YAML 工具)
├── ipconfig.py            → common/     (IP 获取)
├── common_data.py         → common/     (通用工具)
├── pytest.ini             → 项目根目录 / (pytest 配置)
├── run.py                 → 项目根目录 / (执行入口)
├── test_case_template.py  → testcases/  (参考模板)
└── test_data_template.yaml→ yaml/       (数据模板)
```

创建必要的目录结构：

```
mkdir testcases yaml logs common
```

### 第二步：修改 conftest.py 的配置项（必须）

在 `conftest.py` 中搜索 `{{ }}` 占位符并替换为实际值：

| 占位符 | 说明 | 示例 |
|--------|------|------|
| `{{ADMIN_USER}}` | 登录用户名 | `"admin"` |
| `{{ADMIN_PASS}}` | 登录密码 | `"123456"` 或 MD5 哈希 |
| `{{TOKEN_PATH}}` | token 提取路径 | `"$.data.token"` |
| `/api/login` | 实际登录地址 | `"/api/monitor/web-user/login"` |
| `9004` | 服务端口 | `8080` |

### 第三步：安装依赖

```bash
pip install pytest allure-pytest requests jsonpath-ng pyyaml pytest-ordering
```

安装 Allure 命令行工具（用于生成 HTML 报告）：
```bash
# Windows (scoop)
scoop install allure

# macOS (brew)
brew install allure

# Linux (apt)
sudo apt install allure
```

### 第四步：运行验证

```bash
python run.py
```

成功后会在 `./reports/index.html` 生成 Allure 可视化报告。

## 编写新模块测试用例的标准流程

当用户要求"给 XXX 接口写测试"时，按以下步骤操作：

### Step 1: 分析接口文档

获取接口的以下信息：
- URL 路径和方法 (GET/POST/PUT/DELETE)
- 请求参数（必填/选填/类型）
- 响应结构（特别是 code/msg/data 字段）
- 是否需要认证（token/header）
- 业务依赖关系（是否需要前置数据如分组ID等）

### Step 2: 创建 YAML 测试数据文件

参考 `assets/test_data_template.yaml`，在 `yaml/test_xxx.yaml` 中编写：

```yaml
xxx_cases:
  # 正向用例
  - name: "正常创建"
    field1: "有效值"
    expected:
      code: 0
  
  # 负向用例
  - name: "必填项为空"
    field1: ""
    expected:
      code: 1001
      error_msg: "字段不能为空"
  
  # 边界用例
  - name: "超长输入"
    field1: "{{超长字符串}}"
    expected:
      code: 1001
```

**YAML 编写原则**：
1. 正向 + 负向 + 边界，至少各一条
2. expected 必须包含 code
3. 失败场景额外包含 error_msg 用于精确匹配

### Step 3: 创建测试用例 Python 文件

参考 `assets/test_case_template.py`，在 `testcases/test_xxx.py` 中编写：

```python
import jsonpath
import pytest
from common.requests_util import BaseRequest
from common.yaml_util import read_yaml
from common.common_data import get_current_datetime, generate_random_number

class TestXxxAPI:
    test_data = read_yaml("./yaml/test_xxx.yaml")["xxx_cases"]
    
    @pytest.mark.parametrize("case", test_data)
    def test_xxx(self, base_url, auth_headers, case):
        url = f"{base_url}/api/xxx"
        
        # 动态数据处理
        if "唯一性约束" in case.get(name, ""):
            case["unique_field"] = get_current_datetime()
        
        payload = { ... }
        res = BaseRequest().send_request(method="post", url=url, json=payload, headers=auth_headers)
        code = jsonpath.JSONPath("$.code").parse(res.json())[0]
        
        if code == 0:
            assert code == case["expected"]["code"]
        else:
            assert code == case["expected"]["code"]
            assert case["expected"]["error_msg"] == res.json()["msg"]
```

### Step 4: 如需新增 Fixture（跨模块共享数据）

如果新模块需要其他模块的前置数据（如设备 ID），在 `conftest.py` 中添加 session 级 fixture：

```python
@pytest.fixture(scope="session")
def xxx_id(base_url, auth_headers):
    """获取全局 xxx id"""
    url = f"{base_url}/api/xxx/create"
    payload = {"name": f"自动创建_{get_current_datetime()}"}
    res = BaseRequest().send_request(method="post", url=url, json=payload, headers=auth_headers)
    return jsonpath.JSONPath("$.data.id").parse(res.json())[0]
```

然后在需要的测试函数签名中声明该 fixture 即可。

## 核心组件速查

### BaseRequest.send_request() 参数说明

| 参数 | 类型 | 必须 | 说明 |
|------|------|------|------|
| method | str | ✅ | GET/POST/PUT/DELETE/PATCH |
| url | str | ✅ | 完整请求 URL |
| headers | dict | ❌ | 请求头（通常传 auth_headers） |
| params | dict | ❌ | 查询参数 (?key=value) |
| data | dict/str | ❌ | 表单数据 / raw body |
| json | dict | ❌ | JSON 请求体（自动设置 Content-Type） |
| files | dict | ❌ | 文件上传 |
| timeout | int | ❌ | 超时秒数（默认 30） |
| case_name | str | ❌ | 用例名称（用于日志标记） |
| log_level | str | ❌ | 日志级别: full/simple/off |

### 常用 jsonpath 表达式

| 表达式 | 含义 |
|--------|------|
| `$.code` | 顶层业务状态码 |
| `$.data.token` | 嵌套提取 token |
| `$.data.id` | 提取资源 ID |
| `$.data.list[*].name` | 列表中所有元素的 name 字段 |
| `$.data.total` | 分页总数 |

### GlobalData 全局存储使用

```python
# 在任意测试中存入数据
device_manager.add_device({"addr": "1001", "type": "PD22"})

# 在另一个测试中读取
for device in device_manager.devices:
    print(device["addr"])
```

## 注意事项与最佳实践

1. **不要硬编码密码和敏感信息** — 使用环境变量或配置文件
2. **每个测试方法应独立可运行** — 不依赖特定执行顺序（除非显式使用 order 标记）
3. **YAML 中保持用例顺序一致** — parametrize 按 YAML 定义顺序展开
4. **动态生成的数据要真正唯一** — 时间戳精度不够时追加随机数
5. **清理策略按需选择** — 默认不清除 extract.yaml 以支持跨模块数据传递；如需隔离可在 teardown 中 clear_yaml()
6. **Allure monkey patch 可能影响性能** — 大量并发时可考虑关闭 autouse
