"""
测试用例模板 — CRUD 接口完整示例
展示框架的标准使用模式：数据驱动 + Fixture 注入 + jsonpath 断言 + 变量提取
"""

import jsonpath
import pytest
from common.requests_util import BaseRequest
from common.yaml_util import read_yaml, write_yaml
from common.common_data import get_current_datetime, generate_random_number


class Test{{Module}}API:
    """
    {{模块名}} 接口测试类
    
    编写规范:
    1. 类名以 Test_ 开头，继承无特殊要求
    2. 测试方法以 test_ 开开，使用 @pytest.mark.parametrize 数据驱动
    3. 通过 conftest 的 fixture 注入 base_url, auth_headers 等
    4. 断言统一使用 jsonpath 提取响应字段后 assert
    """

    # ==================== 类变量：共享数据 ====================

    # 存储创建接口返回的 ID，供后续编辑/删除使用
    created_id = None

    # 从 YAML 文件加载测试数据
    test_data = read_yaml("./yaml/test_{{module}}.yaml")["{{case_key}}"]

    # ==================== 创建接口 ====================

    @pytest.mark.parametrize("case", test_data[0:3])
    def test_create(self, base_url: str, auth_headers: dict, case: dict):
        """
        创建 {{资源}}
        
        Args:
            base_url: 全局基础 URL fixture
            auth_headers: 认证请求头 fixture  
            case: 单条测试数据（来自 YAML）
        """
        url = f"{base_url}/api/{{resource_path}}"
        
        # 动态数据生成（避免重复导致冲突）
        if case.get("name") in ["创建成功"]:
            case["unique_field"] = get_current_datetime()
            # 或者: case["addr"] = generate_random_number(4)

        payload = {
            "field1": case["field1"],
            "field2": case["field2"],
            # ... 根据实际接口补充
        }

        res = BaseRequest().send_request(
            method="post",
            url=url,
            json=payload,
            headers=auth_headers,
            case_name=case.get("name", "未知用例"),
        )

        # 提取业务状态码
        code = jsonpath.JSONPath("$.code").parse(res.json())[0]

        if code == 0:
            # ✅ 成功：提取返回的 ID 供后续用例使用
            Test{{Module}}API.created_id = jsonpath.JSONPath("$.data.id").parse(res.json())[0]
            print(f"📌 创建成功，ID={Test{{Module}}API.created_id}")
            assert code == case["expected"]["code"]
            
            # 可选：将提取的数据写入 extract.yaml 供其他模块使用
            write_yaml({"created_id": Test{{Module}}API.created_id})

        else:
            # ❌ 失败：断言错误码和错误信息
            assert code == case["expected"]["code"]
            assert case["expected"]["error_msg"] == res.json()["msg"]

    # ==================== 编辑/更新接口 ====================

    @pytest.mark.parametrize("case", test_data[3:5])
    def test_update(self, base_url: str, auth_headers: dict, case: dict):
        """更新 {{资源}}"""
        url = f"{base_url}/api/{{resource_path}}/{Test{{Module}}API.created_id}"

        # 使用创建步骤保存的真实 ID
        if case.get("name") == "更新成功":
            case.update({"id": Test{{Module}}API.created_id})
            case["update_field"] = "已编辑_" + get_current_datetime()

        payload = {"field": case.get("update_field")}
        
        res = BaseRequest().send_request(
            method="put",
            url=url,
            params=payload,     # 或 json=payload
            headers=auth_headers,
        )
        code = jsonpath.JSONPath("$.code").parse(res.json())[0]

        if code == 0:
            assert code == case["expected"]["code"]
        else:
            assert code == case["expected"]["code"]
            assert case["expected"]["error_msg"] == res.json()["msg"]

    # ==================== 删除接口 ====================

    @pytest.mark.parametrize("case", test_data[5:8])
    def test_delete(self, base_url: str, auth_headers: dict, case: dict):
        """删除 {{资源}}"""
        url = f"{base_url}/api/{{resource_path}}/{Test{{Module}}API.created_id}"

        if case.get("name") == "删除成功":
            case["id"] = Test{{Module}}API.created_id

        payload = {"id": case.get("id")}
        
        res = BaseRequest().send_request(
            method="delete",
            url=url,
            params=payload,
            headers=auth_headers,
        )
        code = jsonpath.JSONPath("$.code").parse(res.json())[0]

        if code == 0:
            assert code == case["expected"]["code"]
        else:
            assert code == case["expected"]["code"]
            assert case["expected"]["error_msg"] == res.json()["msg"]

    # ==================== 查询/列表接口 ====================

    @pytest.mark.parametrize("case", test_data[8:])
    def test_query(self, base_url: str, auth_headers: dict, case: dict):
        """查询 {{资源}} 列表"""
        url = f"{base_url}/api/{{resource_path}}"
        
        res = BaseRequest().send_request(
            method="get",
            url=url,
            headers=auth_headers,
            params={"page": case.get("page", 1), "size": case.get("size", 10)},
        )
        code = jsonpath.JSONPath("$.code").parse(res.json())[0]
        total = jsonpath.JSONPath("$.data.total").parse(res.json())
        
        assert code == case["expected"]["code"]
        # 可选断言列表数量
        if case.get("expected_total"):
            assert total and total[0] >= 0
