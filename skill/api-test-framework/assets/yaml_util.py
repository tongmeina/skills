"""
YAML 工具模块 — 测试数据读写 & 变量提取
"""

import os
import yaml
from pathlib import Path
from typing import Any, Optional


def read_yaml(file_path: str) -> Any:
    """
    读取 YAML 文件
    
    Args:
        file_path: YAML 文件路径（相对/绝对均可）
    
    Returns:
        解析后的 Python 对象 (dict/list)
    
    Raises:
        FileNotFoundError: 文件不存在
        yaml.YAMLError: YAML 格式错误
    """
    with open(file_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def write_yaml(data: Any, file_path: str = None):
    """
    写入数据到 YAML 文件（追加模式）
    
    用于测试执行过程中提取响应数据供后续用例使用
    
    Args:
        data: 要写入的数据（dict/list）
        file_path: 目标文件路径，默认 ./extract.yaml
    """
    if file_path is None:
        file_path = os.path.join(os.getcwd(), "./extract.yaml")
    with open(file_path, mode="a+", encoding="utf-8") as f:
        yaml.dump(data, stream=f, allow_unicode=True, default_flow_style=False)


def clear_yaml(file_path: str = None):
    """
    清空 YAML 文件内容
    
    通常在每个测试 session 开始前调用
    
    Args:
        file_path: 要清空的文件路径，默认 ./extract.yaml
    """
    if file_path is None:
        file_path = os.path.join(os.getcwd(), "./extract.yaml")
    with open(file_path, mode="w", encoding="utf-8") as f:
        f.truncate()
