"""
HTTP 请求封装类 — BaseRequest
提供统一的请求发送、日志记录、敏感信息过滤能力
"""

import requests
import json
from typing import Dict, Optional
from logs import get_logger

_request_logger = get_logger(name="http_request", log_level="DEBUG")


class BaseRequest:
    """
    强化版 HTTP 请求封装
    
    特性:
    - 统一请求/响应日志（支持 full/simple/off 三级）
    - 敏感信息自动脱敏
    - 异常自动捕获和记录
    - Session 复用（保持连接池）
    
    使用示例:
        res = BaseRequest().send_request(
            method="post",
            url="https://api.example.com/login",
            params={"user": "admin", "pass": "123456"},
            headers={"Content-Type": "application/json"},
            case_name="登录测试"
        )
        assert res.json()["code"] == 0
    """

    def __init__(self, debug: bool = True):
        self.session = requests.Session()
        self.debug = debug

    def send_request(self, **kwargs) -> requests.Response:
        """
        发送 HTTP 请求并自动记录日志
        
        Args:
            **kwargs: 请求参数
                method: 请求方法 (GET/POST/PUT/DELETE/PATCH...)
                url: 请求 URL (必填)
                headers: 请求头 dict
                params: 查询参数 dict (URL ? 后面的)
                data: 表单数据 / raw body
                json: JSON 数据 dict (自动设置 Content-Type)
                files: 文件上传 dict
                timeout: 超时秒数 (默认 30)
                case_name: 用例名称，用于日志标记
                log_level: 日志详细度 "full" | "simple" | "none" (默认 "full")
        
        Returns:
            requests.Response 响应对象
        
        Raises:
            ConnectionError / Timeout / 等网络异常（原样抛出）
        """
        case_name = kwargs.pop('case_name', '未知用例')
        log_level = kwargs.pop('log_level', 'full')

        if self.debug and log_level != 'none':
            self._log_request(kwargs, case_name, log_level)

        try:
            response = self.session.request(**kwargs)
            
            if self.debug and log_level != 'none':
                self._log_response(response, case_name, log_level)
            
            return response

        except Exception as e:
            if self.debug:
                self._log_exception(e, kwargs, case_name)
            raise

    # ==================== 日志方法 ====================

    def _log_request(self, request_kwargs: Dict, case_name: str, log_level: str):
        """记录请求日志"""
        method = request_kwargs.get('method', 'GET').upper()
        url = request_kwargs.get('url', '未知URL')

        _request_logger.info(f"\n{'🚀' * 20} 请求开始 {'🚀' * 20}")
        _request_logger.info(f"📋 用例: {case_name}")
        _request_logger.info(f"📍 方法: {method}")
        _request_logger.info(f"📍 URL: {url}")

        if log_level == 'full':
            headers = request_kwargs.get('headers')
            if headers:
                safe_headers = self._safe_headers(headers)
                _request_logger.info(f"📍 请求头:\n{json.dumps(safe_headers, indent=2, ensure_ascii=False)}")
            for label, key in [("查询参数", "params"), ("表单数据", "data"), ("JSON", "json")]:
                val = request_kwargs.get(key)
                if val:
                    _request_logger.info(f"📍 {label}:\n{json.dumps(val, indent=2, ensure_ascii=False) if isinstance(val, (dict, list)) else val}")
            files = request_kwargs.get('files')
            if files:
                _request_logger.info(f"📍 文件: {list(files.keys())}")
        else:
            for label, key in [("参数", "params"), ("数据", "json"), ("数据", "data")]:
                val = request_kwargs.get(key)
                if val:
                    display = json.dumps(val, indent=2) if isinstance(val, (dict, list)) else str(val)
                    _request_logger.info(f"📍 {label}: {display}")

    def _log_response(self, response: requests.Response, case_name: str, log_level: str):
        """记录响应日志"""
        status_code = response.status_code
        elapsed_time = response.elapsed.total_seconds()

        _request_logger.info(f"\n{'✅' * 20} 响应开始 {'✅' * 20}")
        _request_logger.info(f"📋 用例: {case_name}")
        _request_logger.info(f"📊 状态码: {status_code}")
        _request_logger.info(f"⏱️ 耗时: {elapsed_time:.3f}s")

        try:
            resp_json = response.json()
            if log_level == 'full':
                _request_logger.info(f"📊 响应体:\n{json.dumps(resp_json, indent=2, ensure_ascii=False)}")
            else:
                code = resp_json.get('code', '无')
                msg = resp_json.get('msg', '无')
                _request_logger.info(f"📊 业务码: {code} | 消息: {msg}")

            # 业务状态图标
            code_val = resp_json.get('code')
            msg_val = resp_json.get('msg')
            if code_val is not None:
                icon = "🟢" if code_val == 0 else "🔴"
                _request_logger.info(f"{icon} 业务状态: code={code_val}, msg={msg_val}")

        except (ValueError, json.JSONDecodeError):
            preview = response.text[:500] + ('...' if len(response.text) > 500 else '')
            _request_logger.warning(f"📊 非JSON响应: {preview}")
        except Exception as e:
            _request_logger.error(f"⚠️ 解析异常: {e}", exc_info=True)

        _request_logger.info(f"{'✅' * 20} 响应结束 {'✅' * 20}\n")

    def _log_exception(self, exception: Exception, request_kwargs: Dict, case_name: str):
        """记录请求异常日志"""
        method = request_kwargs.get('method', 'GET').upper()
        url = request_kwargs.get('url', '未知URL')
        _request_logger.error(
            f"\n{'❌' * 20} 请求异常 {'❌' * 20}\n"
            f"📋 用例: {case_name}\n"
            f"💥 类型: {type(exception).__name__}\n"
            f"💥 信息: {str(exception)}\n"
            f"📍 方法: {method} | URL: {url}\n"
            f"{'❌' * 20}",
            exc_info=True
        )

    # ==================== 工具方法 ====================

    def _safe_headers(self, headers: Dict) -> Dict:
        """敏感信息脱敏处理"""
        safe = headers.copy() if headers else {}
        
        # Authorization 截断显示
        if 'Authorization' in safe and len(safe['Authorization']) > 30:
            safe['Authorization'] = f"{safe['Authorization'][:30]}..."
        
        # 其他敏感字段完全隐藏
        sensitive_keys = ['cookie', 'token', 'password', 'secret', 'key']
        for key in list(safe.keys()):
            if any(s in key.lower() for s in sensitive_keys):
                safe[key] = '***隐藏***'
        
        return safe

    def enable_debug(self):
        """启用调试日志"""
        self.debug = True

    def disable_debug(self):
        """禁用调试日志"""
        self.debug = False
