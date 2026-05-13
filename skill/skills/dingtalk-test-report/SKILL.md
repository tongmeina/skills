---
name: dingtalk-test-report
description: 将测试报告写入钉钉文档并推送到群聊。自动读取本地测试报告文件，创建钉钉文档，并可通过钉钉机器人webhook推送消息。当用户提到写入钉钉文档、推送测试报告、钉钉机器人、群消息推送时使用此技能。
---

# 钉钉测试报告推送

## 固定配置

| 配置项 | 值 |
|--------|-----|
| webhook access_token | 6bf732946c8873abc98b35d2d82deb6e987a4cd687076549e0d79cddf3a3dbc2 |
| webhook secret | SEC2fa2956f6facd9270222bb93eb76460f3d564f72c4671528ea7cd14b2c7de888 |
| @手机号 | 13250703582（lunu） |
| 默认目标文件夹 | 测试报告 |

## 流程步骤

### 第一步：读取测试报告并写入钉钉文档

**1.1 读取本地测试报告**

读取Markdown文件，提取内容。

**正文规则（严格遵循）**：
- 过滤文档主标题（第一行 `# 标题`）
- 过滤报告生成时间（`> 报告生成时间`）
- **写入钉钉文档：完整正文（包含一、二、三全部内容），不要随意删减报告内容，原始数据是怎样的就怎样**
- **推送消息：仅摘录"一、测试结果"部分**
- **严格遵循此规则，不得自行删减、修改或概括报告内容**

**1.2 查询目标文件夹ID**

使用 `list_nodes` 工具列出用户的钉钉文档，查找目标文件夹：

```
list_nodes(folderId=null, pageSize=50)
```

匹配规则：
- 文件夹名称完全匹配（如"测试报告"）
- 找到后记录 `nodeId`（作为 folderId）

**1.3 写入钉钉文档**

使用 `create_document` 工具创建文档：

```
create_document(
  folderId="目标文件夹ID",
  name="文档标题（从报告标题提取，如'位置监控平台-国际化 测试报告 2026-04-26'）",
  markdown="报告正文内容（从一、测试结果开始）"
)
```

**内容过长处理**：分多次追加，每次调用 `update_document`：
```
update_document(
  mode="append",
  nodeId="刚创建的文档nodeId",
  markdown="剩余内容"
)
```

**1.4 记录文档nodeId**

创建成功后，记录返回的 `nodeId`，用于后续推送消息中的链接。

### 第二步：推送钉钉机器人消息

使用Python发送HTTP请求到webhook：

```python
import requests
import time
import hmac
import hashlib
import base64

access_token = "6bf732946c8873abc98b35d2d82deb6e987a4cd687076549e0d79cddf3a3dbc2"
secret = "SEC2fa2956f6facd9270222bb93eb76460f3d564f72c4671528ea7cd14b2c7de888"

timestamp = str(int(time.time() * 1000))
string_to_sign = timestamp + '\n' + secret
hmac_code = hmac.new(secret.encode('utf-8'), string_to_sign.encode('utf-8'), digestmod=hashlib.sha256).digest()
sign = base64.b64encode(hmac_code).decode('utf-8')

url = f'https://oapi.dingtalk.com/robot/send?access_token={access_token}&timestamp={timestamp}&sign={sign}'

data = {
    'msgtype': 'markdown',
    'markdown': {
        'title': '文档标题',
        'text': '## 文档标题\n\n### 一、测试结果\n\n[内容]\n\n### 附件\n\n完整测试报告：[链接](url)'
    },
    'at': {
        'atMobiles': ['13250703582'],
        'isAtAll': False
    }
}

r = requests.post(url, headers={'Content-Type': 'application/json'}, json=data)
print(r.text)
```

## 消息模板

```markdown
## 文档标题

### 一、测试结果

[从测试报告提取的测试结果内容]

### 附件

完整测试报告：https://alidocs.dingtalk.com/i/nodes/{nodeId}
```

## 钉钉MCP工具参考

| 工具 | 用途 |
|------|------|
| list_nodes | 查询文件夹ID |
| create_document | 创建文档 |
| update_document | 追加文档内容 |
| delete_document | 删除文档 |

## 注意事项

- 行距设置需手动在钉钉文档中调整（当前API不支持）
- 内容过长时分段追加避免JSON解析错误
- 机器人推送需要正确的签名算法
- 配置已写死，无需每次输入
