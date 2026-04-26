"""
动态 IP 获取工具 — 自动发现本机 IP 作为 base_url 主机地址
适用于内网部署的 API 服务测试环境
"""

import socket


def get_local_ips() -> list[str]:
    """
    获取本机所有 IPv4 地址（排除回环 127.x.x.x）
    
    返回值按顺序排列，通常第一个是主要网卡地址。
    如果获取失败，返回 ["127.0.0.1"] 兜底。
    
    Returns:
        IPv4 地址列表，如 ["192.168.1.100"]
    
    使用示例:
        >>> ips = get_local_ips()
        >>> base_url = f"http://{ips[0]}:9004"
        >>> print(base_url)
        'http://192.168.1.100:9004'
    """
    ips = []
    try:
        hostname = socket.gethostname()
        all_ips = socket.gethostbyname_ex(hostname)[2]
        ips = [ip for ip in all_ips if not ip.startswith("127.") and '.' in ip]
    except Exception as e:
        print(f"⚠️ 获取本机IP失败: {e}")
    return ips if ips else ["127.0.0.1"]
