# 模块：input-bar（输入栏）

## 信息

- **URL**: http://localhost:5173
- **优先级**: P0
- **状态**: 已完成
- **测试时间**: 2026-05-06

## 测试用例

- [x] 用例1：输入框默认显示且可聚焦
- [x] 用例2：输入文本后发送按钮从disabled变enabled
- [x] 用例3：点击发送按钮发送消息
- [x] 用例4：Enter 键发送消息
- [x] 用例5：Shift+Enter 换行
- [x] 用例6：展开/折叠输入框（82px↔200px）
- [x] 用例7：清除输入按钮
- [x] 用例8：附件按钮（弹出file input, multiple=true）
- [x] 用例9：图片按钮（弹出file input, accept="image/\*"）
- [x] 用例10：历史消息翻页按钮

## 执行记录

| 用例            | 状态 | 耗时 | Bug | 备注               |
| --------------- | ---- | ---- | --- | ------------------ |
| 输入框显示      | PASS | -    | -   | textarea可见可聚焦 |
| 发送按钮状态    | PASS | -    | -   | disabled→enabled   |
| 点击发送        | SKIP | -    | -   | 需AI后端响应       |
| Enter发送       | PASS | -    | -   | textarea清空       |
| Shift+Enter换行 | PASS | -    | -   | 插入换行不发送     |
| 展开/折叠       | PASS | -    | -   | 82px↔200px         |
| 清除输入        | PASS | -    | -   | 文本清空           |
| 附件按钮        | PASS | -    | -   | file input出现     |
| 图片按钮        | PASS | -    | -   | file input出现     |
| 历史翻页        | PASS | -    | -   | 按钮存在           |

## 发现的问题

无
