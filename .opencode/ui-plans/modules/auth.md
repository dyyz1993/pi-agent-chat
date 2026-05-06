# 模块：auth/login（认证登录）

## 信息

- **URL**: http://localhost:5173
- **优先级**: P0
- **状态**: 已完成
- **测试时间**: 2026-05-05

## 测试用例

- [x] 用例1：无 token 时显示登录页
- [x] 用例2：默认 token 预填为 demo-test-token
- [x] 用例3：使用正确 token 登录成功进入主界面
- [x] 用例4：Token 持久化（刷新后自动恢复）
- [x] 用例5：错误 token 行为验证（发现 Bug）
- [x] 用例6：深色/浅色主题下登录页 UI 正常

## 执行记录

| 用例                | 状态 | 耗时 | Bug  | 备注                    |
| ------------------- | ---- | ---- | ---- | ----------------------- |
| 无 token 显示登录页 | PASS | -    | -    | 页面元素完整            |
| 默认 token 预填     | PASS | -    | -    | 值为 demo-test-token    |
| 正确 token 登录     | PASS | -    | -    | 约 5-8 秒连接           |
| Token 持久化        | PASS | -    | -    | localStorage 恢复正常   |
| 错误 token 行为     | FAIL | -    | #001 | 无限 spinner 无错误反馈 |
| 主题切换            | PASS | -    | -    | 深色/浅色均正常         |

## 发现的问题

- **Bug #001**: 错误 token 时无限 spinner，无错误反馈，错误 token 被保存到 localStorage
  - 严重程度：P1
  - 建议修复：添加超时检测、错误状态显示、延迟写 localStorage
