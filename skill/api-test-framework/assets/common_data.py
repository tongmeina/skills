"""
通用工具函数 — 时间戳、随机数据等
"""


def get_current_datetime(fmt: str = "%Y%m%d%H%M%S") -> str:
    """
    生成当前时间戳字符串
    
    常用于生成唯一标识（如分组名称、设备名称等避免重复）
    
    Args:
        fmt: 时间格式字符串，默认 YYYYMMDDHHmmss
    
    Returns:
        格式化后的时间字符串
        
    示例:
        >>> get_current_datetime()
        '20260126213000'
        >>> get_current_datetime("%H%M%S")
        '213000'
    """
    import datetime
    return datetime.datetime.now().strftime(fmt)


def generate_random_string(length: int = 8, charset: str = None) -> str:
    """
    生成指定长度的随机字符串
    
    Args:
        length: 字符串长度
        charset: 字符集，默认字母+数字
    
    Returns:
        随机字符串
    """
    import random
    import string
    if charset is None:
        charset = string.ascii_letters + string.digits
    return ''.join(random.choice(charset) for _ in range(length))


def generate_random_number(digits: int = 4, first_nonzero: bool = True) -> str:
    """
    生成指定位数的随机数字字符串
    
    Args:
        digits: 位数
        first_non_zero: 第一位是否不为0（如卡号场景）
    
    Returns:
        数字字符串
    """
    import random
    import string
    if first_nonzero and digits > 0:
        first = random.choice(string.digits[1:])  # 1-9
        rest = ''.join(random.choice(string.digits) for _ in range(digits - 1))
        return first + rest
    return ''.join(random.choice(string.digits) for _ in range(digits))
