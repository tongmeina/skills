# API 自动化测试框架 — 架构指南

## 框架总览

```
project-root/
├── conftest.py              # ⭐ 核心配置（Fixture / 钩子 / 日志）
├── pytest.ini               # pytest 运行配置
├── run.py                   # 一键执行入口
├── common/                  # 🔧 公共工具模块
│   ├── requests_util.py     # HTTP 请求封装 (BaseRequest)
│   ├── yaml_util.py         # YAML 数据读写工具
│   ├── ipconfig.py          # 动态 IP 获取
│   └── common_data.py       # 通用工具函数（时间/随机数）
├── testcases/               # 📋 测试用例目录
│   ├── test_login.py        # 登录测试
│   ├── test_group.py        # 分组 CRUD 测试
│   └── test_xxx.py          # 其他模块测试
├── yaml/                    # 📊 数据驱动文件
│   ├── test_login.yaml      # 登录用例数据
│   ├── test_group.yaml      # 分组用例数据
│   └── test_xxx.yaml
├── logs/                    # 📝 日志输出目录（自动生成）
├── temps/                   # Allure 原始数据（自动生成）
├── reports/                 # Allure HTML 报告（自动生成）
├── extract.yaml             # 跨用例变量存储（自动生成）
└── api/
    └── api-docs.customization  # OpenAPI/Swagger 接口文档
```

## 技术栈

| 组件 | 版本 | 用途 |
|------|------|------|
| Python | 3.8+ | 运行环境 |
| pytest | 7.0+ | 测试框架核心 |
| allure-pytest | 2.x | 测试报告 |
| requests | 2.x | HTTP 客户端 |
| jsonpath-ng | 1.x | 响应字段提取 |
| PyYAML | 6.x | 数据驱动文件解析 |

安装依赖:
```bash
pip install pytest allure-pytest requests jsonpath-ng pyyaml pytest-ordering
```

## 核心设计模式

### 模式一：Session 级 Fixture 链式依赖

```
pytest_configure → base_url → auth_token → auth_headers
                                         ↘ groupid1 → addr_ids
```

**原理**: 利用 pytest 的 fixture 依赖机制，实现"一次登录、全局复用"。整个 session 只调用一次登录接口，所有用例共享同一个 token。

**适用场景**: 
- 需要登录认证的 API 系统
- 前置数据创建（如分组、设备）需要被多个模块复用

### 模式二：YAML 数据驱动 + Parametrize

```python
# YAML 中定义多组测试数据
test_data = read_yaml("./yaml/test_xxx.yaml")["cases"]

# 通过 parametrize 自动展开为多条独立测试
@pytest.mark.parametrize("case", test_data)
def test_api(self, base_url, case):
    ...
```

**优势**:
- 测试代码与测试数据分离
- 新增用例只需编辑 YAML，无需改代码
- 支持正向/负向/边界用例统一管理

### 模式三：类属性共享跨步骤数据

```python
class TestGroupAPI:
    created_id = None  # 类变量，所有方法共享

    def test_create(self, ...):
        TestGroupAPI.created_id = jsonpath.parse(res.json())[0]

    def test_update(self, ...):  
        url = f".../{TestGroupAPI.created_id}"  # 使用上一步的 ID
```

**注意**: 使用 `@pytest.mark.parametrize` 时，同一类内的方法按定义顺序执行。如果需要严格顺序控制，使用 `@pytest.mark.run(order=N)` 标记。

### 模式四：Monkey Patch 全局请求日志

通过在 `conftest.py` 中使用 `autouse=True` 的 fixture，对 `requests.Session.request` 进行 monkey patch：
- **无需在每个用例中手动记录**
- 所有请求/响应自动附加到 Allure 报告
- 敏感信息自动脱敏

## Fixture 依赖关系图

```
base_url (session)
    │
    ├── auth_token (session) ← 依赖 base_url
    │       │
    │       └── auth_headers (session) ← 依赖 auth_token
    │
    ├── groupid1 (session) ← 依赖 base_url + auth_headers
    │       │
    │       └── addr_ids (session) ← 依赖 base_url + groupid1 + auth_headers
    │
    └── device_manager (session) ← 返回 GlobalData 实例
```

**使用规则**:
- 在测试函数参数中声明需要的 fixture，pytest 会自动按依赖顺序注入
- `base_url` 和 `auth_headers` 是最基础的，几乎所有用例都需要
- `groupid1`, `addr_ids` 等是业务级前置数据，按需引入

## 断言策略

### 标准模式

```python
code = jsonpath.JSONPath("$.code").parse(res.json())[0]

if code == 0:  # 业务成功
    assert code == case["expected"]["code"]
    # 可选：提取返回数据供后续使用
    extracted = jsonpath.JSONPath("$.data.id").parse(res.json())[0]
else:  # 业务失败
    assert code == case["expected"]["code"]
    assert case["expected"]["error_msg"] == res.json()["msg"]
```

### 推荐断言层级

| 层级 | 断言内容 | 说明 |
|------|---------|------|
| L1 | `status_code == 200` | HTTP 层（通常不需要显式断言） |
| L2 | `code == expected_code` | **必做** - 业务状态码 |
| L3 | `msg == error_msg` | 失败场景的错误消息匹配 |
| L4 | `data.xxx == expected_value` | 关键数据字段的精确校验 |

## 敏感信息处理

框架内置三层脱敏：

1. **conftest.py** `sanitize_data()`: Allure 报告中的请求/响应体自动过滤 password/token/auth 等字段
2. **BaseRequest._safe_headers()**: 请求日志中 Authorization 截断显示、其他敏感头完全隐藏
3. **YAML 文件**: 密码建议使用 MD5/hash 存储明文，或从环境变量读取

## 日志体系

| 日志器名称 | 用途 | 输出文件 |
|-----------|------|---------|
| `test_case` | 用例执行结果（通过/失败/跳过） | test_case.log |
| `http_request` | HTTP 请求/响应详情 | http_request.log |
| 错误日志单独分离为 `_error.log` 后缀 | | |

## 动态数据生成策略

| 场景 | 方法 | 示例 |
|------|------|------|
| 唯一名/标题 | 时间戳 | `get_current_datetime()` → "20260426213000" |
| 随机卡号/编号 | 随机数字 | `generate_random_number(4)` → "3847" |
| 随机字符串 | 随机字符 | `generate_random_string(8)` → "aK9xM2pQ" |
| 唯一坐标点 | LocationGenerator | GCJ02→WGS84→Hex 坐标 |

## 常见问题 FAQ

**Q: 如何指定不同的测试主机？**
```bash
python -m pytest --host=192.168.1.100
# 或修改 conftest.py 中的默认端口 config.test_port = 8080
```

**Q: 如何只运行某个模块的用例？**
```bash
python -m pytest testcases/test_group.py -vs
# 或使用标记: python -m pytest -m smoke
```

**Q: 如何调试单个用例？**
```bash
python -m pytest testcases/test_group.py::TestGroupAPI::test_addgroup -vs --capture=no -k "分组添加成功"
```

**Q: extract.yaml 的作用？**
用于跨模块共享提取的数据（如 A 模块创建的资源 ID 给 B 模块使用）。每个 session 开始时由 `clear_yaml()` 清空。

**Q: 如何新增一个 API 模块的测试？**
1. 在 `yaml/` 下新建 `test_xxx.yaml` 编写测试数据
2. 在 `testcases/` 下新建 `test_xxx.py` 编写测试逻辑
3. 如需前置数据，在 `conftest.py` 添加对应 fixture
