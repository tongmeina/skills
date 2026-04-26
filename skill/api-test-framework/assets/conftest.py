"""
pytest 全局配置文件 — API 自动化测试框架
功能:
  1. 动态 base_url 配置（支持命令行 --host 参数）
  2. Session 级 Fixture 链式依赖（登录 → token → headers）
  3. Allure 全局请求/响应自动记录（monkey patch）
  4. 敏感信息自动脱敏
  5. 测试执行日志记录
"""

from common.ipconfig import get_local_ips
import jsonpath
from common.yaml_util import clear_yaml
from common.requests_util import BaseRequest
import json
import allure
import requests
from urllib.parse import urlparse, parse_qs, parse_qsl
import pytest
from logs import get_logger
import traceback


# ============================================================
# 日志系统
# ============================================================

_test_logger = get_logger(name="test_case", log_level="INFO")


# ============================================================
# 全局数据管理（可选，按需使用）
# ============================================================

class GlobalData:
    """全局测试数据存储类，用于跨用例共享数据"""

    def __init__(self):
        self.devices = []
        self._store = {}

    def add_device(self, device_info):
        """添加设备信息"""
        self.devices.append(device_info)
        print(f"✅ 添加设备: {device_info}")
        print(f"   当前设备总数: {len(self.devices)}")

    def set(self, key, value):
        """存储任意键值对"""
        self._store[key] = value

    def get(self, key, default=None):
        """获取键值对"""
        return self._store.get(key, default)

global_data = GlobalData()


# ============================================================
# 命令行参数 & Base URL 配置
# ============================================================

def pytest_addoption(parser):
    parser.addoption(
        "--host",
        action="store",
        default=None,
        help="手动指定测试主机IP"
    )

def pytest_configure(config):
    """
    配置动态 base_url
    优先级: 命令行 --host > 自动获取本机 IP
    """
    ip = config.getoption("--host") or get_local_ips()[0]
    port = getattr(config, 'test_port', 9004)  # 默认端口，可在项目配置覆盖
    base_url = f"http://{ip}:{port}"
    config.dyn_base_url = base_url
    print(f"\n\033[92m[配置] base_url: {base_url}\033[0m", flush=True)


@pytest.fixture(scope="session")
def base_url(pytestconfig):
    """提供动态生成的 base_url fixture"""
    url = pytestconfig.dyn_base_url
    print(f"\n\033[94m[Fixture] base_url: {url}\033[0m", flush=True)
    return url


# ============================================================
# 认证 Fixtures（按需修改登录逻辑）
# ============================================================

@pytest.fixture(scope="session")
def auth_token(base_url):
    """
    获取并返回全局 token
    ⚠️ 根据实际项目的登录接口修改此处
    """
    # === 项目定制区域开始 ===
    login_url = f"{base_url}/api/login"          # 修改为实际登录地址
    payload = {
        "username": "{{ADMIN_USER}}",            # 从环境变量或配置读取
        "password": "{{ADMIN_PASS}}"
    }
    # === 项目定制区域结束 ===

    res = BaseRequest().send_request(method="post", url=login_url, params=payload)
    print(res.json())
    
    # 提取 token（根据实际响应结构修改 jsonpath）
    token = jsonpath.JSONPath("{{TOKEN_PATH}}").parse(res.json())[0]
    if not token:
        pytest.fail("登录失败，无法获取token")
    return token


@pytest.fixture(scope="session")
def auth_headers(auth_token):
    """使用全局 token 生成请求头（按需添加其他 header）"""
    return {
        "Authorization": f"{auth_token}",
        # "Content-Type": "application/json",  # 按需启用
    }


# ============================================================
# 数据清理
# ============================================================

@pytest.fixture(scope="session", autouse=True)
def clear_data_per_session():
    """每个 session 开始前清空 extract.yaml"""
    clear_yaml()
    yield
    # session 结束后不清除，允许同模块内共享数据


# ============================================================
# 敏感信息脱敏工具函数
# ============================================================

def sanitize_data(data):
    """过滤敏感信息（密码/token/密钥等）"""
    if isinstance(data, dict):
        return {
            k: "******"
            if any(s in k.lower() for s in ['pass', 'token', 'auth', 'secret', 'key'])
            else v
            for k, v in data.items()
        }
    return data


def parse_query_params(url, params_kwarg):
    """合并 URL 查询参数和 params 参数"""
    url_parsed = urlparse(url)
    url_params = dict(parse_qsl(url_parsed.query))
    if params_kwarg:
        if isinstance(params_kwarg, dict):
            url_params.update(params_kwarg)
        elif isinstance(params_kwarg, str):
            url_params.update(dict(parse_qsl(params_kwarg)))
    return sanitize_data(url_params)


def extract_body(kwargs):
    """
    分步提取请求体，返回 {"type": "json/form/binary/raw", "data": ...}
    """
    if 'json' in kwargs:
        return {"type": "json", "data": sanitize_data(kwargs['json'])}
    if 'data' not in kwargs:
        return None

    data = kwargs['data']
    if isinstance(data, dict):
        return {"type": "form", "data": sanitize_data(data)}
    if isinstance(data, (str, bytes)):
        try:
            if isinstance(data, bytes):
                data = data.decode('utf-8')
            try:
                parsed = json.loads(data)
                return {"type": "json", "data": sanitize_data(parsed)}
            except json.JSONDecodeError:
                pass
            if 'application/x-www-form-urlencoded' in kwargs.get('headers', {}).get('Content-Type', ''):
                parsed = dict(parse_qsl(data))
                return {"type": "form", "data": sanitize_data(parsed)}
        except (UnicodeDecodeError, ValueError):
            pass
        return {"type": "raw", "data": str(data)[:1000]}
    if 'files' in kwargs:
        return {"type": "binary", "data": f"File upload: {list(kwargs['files'].keys())}"}
    return {"type": "raw", "data": str(data)[:1000]}


# ============================================================
# 全局设备管理器 Fixture
# ============================================================

@pytest.fixture(scope="session")
def device_manager():
    """提供全局设备数据管理器的 fixture"""
    return global_data


# ============================================================
# Allure 自动请求/响应记录（Monkey Patch）
# ============================================================

@pytest.fixture(autouse=True)
def log_all_requests_and_responses():
    """全局自动记录所有 HTTP 请求和响应到 Allure 报告"""
    original_request = requests.Session.request

    def wrapped_request(session, method, url, **kwargs):
        # --- 记录请求 ---
        query_params = parse_query_params(url, kwargs.get('params'))
        request_info = {
            "method": method.upper(),
            "url": url,
            "query_params": query_params,
            "headers": sanitize_data(kwargs.get('headers', {})),
            "body": extract_body(kwargs),
        }
        allure.attach(
            json.dumps(request_info, indent=2, ensure_ascii=False),
            name="Request",
            attachment_type=allure.attachment_type.JSON
        )

        # --- 发送请求 ---
        response = original_request(session, method, url, **kwargs)

        # --- 记录响应 ---
        try:
            resp_body = response.json()
            body_type = "json"
            body_data = sanitize_data(resp_body)
        except ValueError:
            resp_body = response.text[:10000]
            body_type = "text"
            body_data = resp_body

        response_info = {
            "status": response.status_code,
            "headers": sanitize_data(dict(response.headers)),
            "body": {"type": body_type, "data": body_data},
            "time_ms": response.elapsed.total_seconds() * 1000,
        }
        allure.attach(
            json.dumps(response_info, indent=2, ensure_ascii=False),
            name="Response",
            attachment_type=allure.attachment_type.JSON
        )

        return response

    requests.Session.request = wrapped_request
    yield
    requests.Session.request = original_request


# ============================================================
# 测试执行日志钩子
# ============================================================

@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """捕获测试结果并记录日志"""
    outcome = yield
    rep = outcome.get_result()

    test_name = item.name
    test_file = item.fspath.basename if hasattr(item, 'fspath') else 'unknown'
    test_class = item.cls.__name__ if item.cls else 'None'

    if rep.when == "setup":
        _test_logger.info(f"{'='*60}")
        _test_logger.info(f"测试开始 | 文件: {test_file} | 类: {test_class} | 用例: {test_name}")
        _test_logger.info(f"{'='*60}")

    if rep.when == "call":
        if rep.outcome == "passed":
            _test_logger.info(f"✅ 通过 | {test_file} | {test_class} | {test_name}")
        elif rep.outcome == "failed":
            _test_logger.error(f"❌ 失败 | {test_file} | {test_class} | {test_name}")
            if rep.longrepr:
                _test_logger.error(f"原因: {rep.longrepr}")
            if call.excinfo:
                exc_type = call.excinfo.type.__name__ if call.excinfo.type else "Unknown"
                exc_value = str(call.excinfo.value) if call.excinfo.value else "Unknown"
                _test_logger.error(f"异常: {exc_type} | {exc_value}")
                try:
                    tb_str = str(call.excinfo.getrepr())
                    _test_logger.error(f"堆栈:\n{tb_str}")
                except Exception as e:
                    _test_logger.error(f"获取堆栈失败: {e}")
            _test_logger.error(f"{'='*60}")
        elif rep.outcome == "skipped":
            _test_logger.warning(f"⏭️ 跳过 | {test_file} | {test_class} | {test_name}")

    if rep.when == "teardown":
        _test_logger.info(f"🔚 结束 | {test_file} | {test_class} | {test_name}")
        _test_logger.info(f"{'='*60}")

    return rep
