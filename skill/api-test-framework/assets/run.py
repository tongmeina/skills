"""
测试入口脚本 — 一键执行并生成 Allure 报告
用法:
    python run.py
"""

import os
import time
import sys


def main():
    """主函数"""
    print("=" * 60)
    print("🚀 API 自动化测试框架")
    print("=" * 60)

    # 1. 执行 pytest
    exit_code = pytest_main()

    # 2. 等待 allure 数据写入完成
    print("\n⏳ 等待测试数据写入...")
    time.sleep(3)

    # 3. 生成 Allure 报告
    generate_report()

    return exit_code


def pytest_main() -> int:
    """
    执行 pytest 测试
    
    Returns:
        pytest 退出码 (0=全部通过, 非0=有失败)
    """
    import pytest
    print("\n📋 开始执行测试用例...\n")
    
    # 可自定义 pytest 参数
    result = pytest.main([
        "-vs",                    # 详细输出 + 显示打印内容
        "--alluredir=./temps",    # Allure 原始数据目录
        "--clean-alluredir",      # 清空旧数据
        "./testcases",            # 用例目录
        # 添加更多参数:
        # "--host=192.168.1.100", # 手动指定主机
        # "-m smoke",              # 只跑冒烟测试
    ])
    return result


def generate_report():
    """
    生成 Allure HTML 报告
    
    报告输出到 ./reports 目录
    需要提前安装 allure-commandline:
        Windows: scoop install allure
        macOS:   brew install allure
        Linux:   apt install allure
    """
    report_dir = "./reports"
    source_dir = "./temps"
    
    if not os.path.exists(source_dir):
        print(f"⚠️ 未找到测试数据目录: {source_dir}")
        return
    
    os.makedirs(report_dir, exist_ok=True)
    
    print(f"\n📊 正在生成 Allure 报告...")
    print(f"   数据源: {source_dir}")
    print(f"   输出至: {report_dir}")
    
    ret = os.system(f"allure generate {source_dir} -o {report_dir} --clean")
    
    if ret == 0:
        print("✅ 报告生成成功！")
        print(f"📂 打开报告: {os.path.abspath(report_dir)}/index.html")
        
        # 尝试自动打开浏览器（可选）
        # os.system(f"start {os.path.abspath(report_dir)}\\index.html")  # Windows
    else:
        print("❌ 报告生成失败，请确认 allure-commandline 已安装")


if __name__ == '__main__':
    sys.exit(main())
