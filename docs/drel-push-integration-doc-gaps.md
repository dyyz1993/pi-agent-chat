# Drel 站点文档缺口清单 —— 2026-09-10 复核（官方文档已发布后）

> 官方文档已上线：总览 https://drel.app/docs/ · Push API /docs/push/ · 容器 /docs/container/ · 离线包 /docs/offline/ · 版本 /docs/versions/
> 本文件是 2026-09-10 缺口清单（25 条）的复核结果：逐条标注官方答复，仅保留真正还缺的项。
> **纪律：后续集成一律以这五份公开文档为准；不再对生产推送端点做探测式推断，不依赖未文档化字段。**

## 复核总览

| 组                     | 原条目         | 已答复 | 部分/仍缺         | 设计上不公开（非缺口） |
| ---------------------- | -------------- | ------ | ----------------- | ---------------------- |
| A 推送 API（10）       | A1-A6, A9, A10 | 8      | A7, A8            | —                      |
| B 容器（8）            | B1-B5, B6-B8   | 5      | B3, B7/B8(可接受) | —                      |
| C 命名应用/离线包（4） | C1-C4          | —      | C2, C3, C4        | C1                     |
| D 版本管理（3）        | D1             | 1      | D2, D3            | —                      |

**P0 全部关闭。** 对集成的阻塞项为零。

## 逐条复核（引用官方原文为证）

### A. 推送 API（/docs/push/）

| #                       | 状态          | 官方答复                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 POST 路径+schema     | ✅ 已答复     | 三种形态：`GET /<key>/<title>/<body>`；Bark 兼容 `POST /<key>`（form/JSON，key 在 path）；结构化 `POST /push`（JSON，`deviceKey` 在 body）。**官方稳定写法是 camelCase `deviceKey`**；服务端同时兼容 legacy `device_key`（旧调用不会立刻失效）。新代码统一用 `deviceKey`，skill 里的 `device_key` 视为 legacy 写法，迁移时顺手改，不按"已失效"处理                                                                                                                                                                                                                              |
| A2 参数表+Bark 兼容矩阵 | ✅ 已答复     | Stable fields 表覆盖：title/body/subtitle、url、mode/display（normal/modal/immersive，full/fullscreen 是 immersive 别名）、appId/route/params、group/threadId、badge、sound、icon/image、markdown/contentType/verificationCode/qrPayload、copy/autoCopy/isArchive/id/revision/delete。`volume` 被明确排除（critical-alert、call-like 展示同样排除）；Bark 的 `level` 未列入 stable fields。**准确定性：level/volume 属于"不在承诺的稳定跨端契约内"，不是"服务端必然不支持"** —— 不依赖其展示效果即可；新 DrelChannel 默认不发送，旧 Bark 适配层是否保留这两个参数按兼容策略处理 |
| A3 URL 长度上限         | ✅ 按承诺答复 | 不发布数字 SLA；要求"keep URLs concise and URL-encode"。集成侧按最小化 URL 设计                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A4 频控                 | ✅ 按承诺答复 | 不发布数字；调用方处理 4xx/429/5xx + 指数退避 + 幂等/revision 策略，避免自动重复重试                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A5 响应格式             | ✅ 已答复     | 成功 `{"code":200,"attempted":1,"accepted":1,"expired":0,"message":"…"}`；错误 `{"error":{"message":"…"}}`。**accepted ≠ displayed**（仅表示 relay 接受了 APNs 投递）；字段计数可能变化，只读 status 不解析 prose                                                                                                                                                                                                                                                                                                                                                               |
| A6 key 轮换             | ✅ 已答复     | Drel Settings 里 Reset push address；旧地址必须视为失效；发送方全量更新                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A7 多设备 fan-out       | ⚠️ 仍缺       | discovery 页说"one Drel installation"，push 文档未写多台 iPhone 的方案（每台一地址？广播组？）。v1 单设备够用，多设备前需要问                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A8 可达性/Inbox 保留    | ⚠️ 部分       | accepted≠displayed 已写明；inbox 行为字段（isArchive/id/revision/delete）已列出；但**保留时长、错过通知补看边界**未写                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A9 加密推送             | ✅ 边界已答复 | 官方明示：**非端到端加密，推送地址是 bearer capability**，不得在 title/body/route/URL 放凭证或隐私内容。加密推送时间表仍未给（self-host 页保持 PLANNED），但隐私边界已足够做设计决策                                                                                                                                                                                                                                                                                                                                                                                            |
| A10 官方服务数据保留    | ✅ 指路已给   | "processes the request in order to deliver it"+ 指向 Privacy/Terms 页                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### B. Web 容器（/docs/container/）

| #                       | 状态              | 官方答复                                                                                                                                                                                                                                                         |
| ----------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 证书/ATS             | ✅ 已答复         | "**Use a publicly trusted HTTPS certificate. The Store container does not promise support for HTTP or self-signed TLS.**" → 真证书域名是硬前提，自签/http 方案正式出局                                                                                           |
| B2 localStorage 语义    | ✅ 已答复         | origin storage 可用但**不构成持久账号或授权保障**，用户/iOS/卸载可清；Reset push address 不清除 web origin 数据 → "首次登录后免 token"设计作废                                                                                                                   |
| B3 Drel 前台收推送行为  | ⚠️ 仍缺           | 未写（banner/静默/Inbox 行为）。防抖策略按最保守假设（前台也响铃）设计                                                                                                                                                                                           |
| B4 推送打开时页面上下文 | ✅ 已答复         | Drel 保留目标 URL 及其 query string，**不追加**凭证、device token 或"来自推送"标记；不得把 URL 参数/referrer/UA 当授权证明                                                                                                                                       |
| B5 DrelRuntime 全集     | ✅ 已答复         | 完整对象：`runtime`、`isOfflinePackage`、`presentation`、`screen{width,height,dpr}`、`viewport{width,height,scale}`、`containerVersion:1`、`offlinePackageVersion:1`、`bridgeVersion:0`；UA 含版本化 Drel product token；须 feature-detect、缺失时按普通网页降级 |
| B6 外链 handoff         | ✅ 已答复（否定） | popups/downloads/**external-app handoff**/background 均不得未经真机测试就依赖，须提供普通 web 降级 → 点通知落在 Drel 容器内是唯一可靠模型                                                                                                                        |
| B7 标准 API 行为矩阵    | ⚠️ 部分           | 给了原则（iOS/WKWebView/权限设置管辖 + feature-detect）和风险清单（popup/download/camera/photo/handoff/background），未逐 API 列表。按"真机逐项测 + 普通降级"处理即可                                                                                            |
| B8 页面生命周期         | ⚠️ 部分           | 要求按 refresh/relaunch/断网/普通浏览器都有安全路径来设计。足够指导实现                                                                                                                                                                                          |

### C. 命名应用 / 离线包（/docs/offline/）

| #                       | 状态            | 官方答复                                                                                                                                                                                                              |
| ----------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 签名流程             | 🔒 设计上不公开 | "Only an operator-approved, signed app registration can authorize a package. There is intentionally no public 'self-sign any website' shortcut." → 走 operator 流程，不是文档缺口；将来真要做命名应用时直接联系运营方 |
| C2 完整契约文档         | ⚠️ 部分         | 站点页覆盖信任链/生命周期/PWA 兼容；逐字段完整契约仍在 skill 内（官方指路 skill）。可接受                                                                                                                             |
| C3 appId+route 前置条件 | ⚠️ 部分         | route 必须匹配 registered app contract；注册是 operator-approved；推送可路由到已注册 app 但不能静默安装。v1 不用，够用                                                                                                |
| C4 更新可用信号         | ⚠️ 仍缺         | 有 `revision` 字段但未定义"有新版本可用"的官方信号机制。v2 关心                                                                                                                                                       |

### D. 版本与兼容（/docs/versions/）

| #                     | 状态            | 官方答复                                                                                                                                  |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| D1 变更政策           | ✅ 已答复       | minor 加可选字段、必须容忍未知/缺失字段；stable 字段不静默重定义；breaking 必须新版本化契约或弃用期；未文档化端点/别名/实验字段无任何承诺 |
| D2 skill↔app 版本历史 | ⚠️ 仍缺（低优） | 当前契约表有（app 1.4.x / container 1 / offline 1 / bridge 0），历史对照没有                                                              |
| D3 self-host 进度入口 | ⚠️ 仍缺（低优） | 独立 self-host 文档有，进度追踪没有                                                                                                       |

## 对 pi-agent-chat 集成方案的三处修订（官方边界导致；2026-09-10 二次修订）

1. **鉴权：URL 只带非敏感事件/资源 ID，鉴权在页面侧完成（ticket 方案已否决）**。一次性 ticket 放 `?t=` 本质仍是 URL bearer credential，与官方"不得在 URL 放凭证"边界直接冲突，不作数。最终形态：推送 URL 为 `https://<域名>/?session=<sessionId>`（sessionId 是非敏感资源 ID）；页面鉴权走三条路径之一——已有服务端会话 Cookie（gateway 已有 `fs_token` cookie 机制，`file-handlers.ts:22`，可扩展为全站会话）、WebAuthn、或**重新登录（v1 兜底，`LoginPage.tsx` 已存在）**。本地存储丢失时由用户重新认证恢复身份，不靠 URL 恢复。
   - **硬边界（不可省略）**：`sessionId` 只用于定位资源，**绝不能作为授权凭据**。服务端必须依据当前登录会话校验"当前用户是否有权读取该 session/项目"；仅凭 URL 中的 sessionId 不得返回任何内容——否则只是把 ticket 换了名字。**审批类页面从推送打开后，还必须重新校验请求状态**（pending 是否仍有效、是否已被处理），不得因"从推送进来"就信任其时效。现状核查：gateway 目前是共享 token 模型（`TOKEN_USERS` 映射用户名），**尚无按用户 × session 归属的授权校验**，这是会话鉴权工作项的一部分，不是推送路径独有的改造。
   - **`fs_token` 只作实现参考，不直接扩大权限范围**。全站会话落地必须具备：`Secure`、`HttpOnly`、合适的 `SameSite`；明确的 Cookie 作用域；过期、轮换、退出/撤销机制；写操作 CSRF 防护；每个请求按"当前用户 + 项目/session 归属"做授权判断。
2. **推送正文脱敏规则**（不变）。title/body 只放非敏感内容（如"Agent 已完成 · <项目名> · 用时 N 分"）；不放 LLM 输出摘要、不放错误堆栈——旧 message-bridge Bark 通道把 assistant 全文推进通知的做法在 Drel 通道上不合规。
3. **可靠性与分组按文档字段实现**（不变，字段措辞修正）。幂等用 `id`/`revision`；429/5xx 指数退避、不自动重试轰打；会话分组用 `threadId=<sessionId>`（iOS 通知堆叠）；归档用 `isArchive`；展示用默认 `mode=normal`。成功响应只读 `code/attempted/accepted`，不解析 message 文案。`level`/`volume` 不在稳定契约内：新通道不依赖、默认不发送；legacy Bark 适配层保留与否按兼容策略定，不按"服务端不支持"论断。

## 场景修正与 Presence 抑制设计（2026-09-10 三次修订）

**场景修正（语音转写错误澄清）**：原"4 个 APP"实为"**Drel 这个 APP**"。三场景更正为：① 在 **Drel 容器内**打开页面使用；② 在**普通浏览器**打开使用；③ 会话执行完。多 app fan-out（原 A7 关联顾虑）对本项目**不成立**，撤销该决策项。

**容器识别（场景①/② 的区分；2026-09-10 四次修订：按用户决定以 UA 为准）**：

- **服务端读 WS 握手请求的 User-Agent**（`ws-handler.ts` upgrade 处已有该 header）——UA 含版本化 Drel product token（app/build/容器/bridge 版本，官方文档化），匹配即 `surface: 'drel'`，否则 `'browser'`。UA 仅用于通知行为选择（非鉴权场景），符合官方"UA 不作授权证明"边界。`window.DrelRuntime` 为客户端侧可选补充；Bridge 识别路径不存在（bridgeVersion=0）。
- 配套事实：gateway 已有 30s ping/pong 心跳（`ws-handler.ts:223`，no-pong 判死）——但注意这只能证明"**连接活着**"（浏览器协议层自动回 pong，与页面 JS 无关），不能证明"**用户在看**"。

**Presence 抑制设计（"活跃不推、后台推"——2026-09-10 五次修订：由确定结论降级为两级实现前提）**：

- **必须先承认的语义差距**："连接活着"≠"用户在看"。桌面浏览器后台标签页会一直保持连接并自动 pong；现有前端**没有**可见性上报能力。所以：
  - **粗粒度版（纯服务端可实现）**：该 session 存在任一活跃连接（last-pong 新鲜，~60s 超时）→ 抑制推送。代价是已知误抑制：桌面挂页时手机永远收不到通知。
  - **正确版（需改前端）**：页面经 WS 上报 `{visibilityState, 当前聚焦 sessionId}` + 心跳，服务端只在"心跳新鲜且 visibility=visible 且聚焦本 session"时抑制，并需处理心跳恢复/状态重建。**这是一个真实的前端改动项，不是零改动**——"正在看就不推"的承诺以它落地为前提。
- v1 建议：先上粗粒度版 + 页内 toast；正确版作为同切片小改动或 fast-follow。**未落地前，对外表述只能是"连接级防打扰"，不能是"正在看就不推"**。
- **消息内容差异**：技术可行（服务端按 presence 选文案），v1 从简——活跃 → 完全不推（页内 toast 承担提示），不活跃 → 按脱敏模板推送；差异化文案留 v2。
- 已知边界：按设备定向推送需 per-client 设备注册，留 v2。**Drel 前台收推送形式（B3）与收件箱保留时长（A8）仍是待验证项，关键流程不得以其为前提**。

## 定位降级与依赖边界（2026-09-10 五次修订）

以下内容从"确定结论"调整为"需验证/实现前提"：

1. **离线包移出 v1 依赖链**。Drel 离线包注册是 operator 门控的签名流程，**不是开放的自助签名**——pi 的 v1 不得依赖它。直接打开 `https://<域名>/?session=<id>`（普通 HTTPS 页面）就是 v1 的完整打开路径，不依赖任何安装动作。
2. **离线启动若将来做，优先走官方 `appId + route + params` 契约**。"通知 URL 的任意 query 是否原样映射到本地离线页面"**未经真机/模拟器验证，不得承诺**——验证通过后才允许写进方案。
3. **原生缓存/预加载无公开路线承诺**。当前性能方案只以三样为准：网页 HTTP 缓存、数据快照恢复（复用现有 render-cache / fetchInitialState 缓存机制）、（将来）已验证的离线静态包。不得假设 Drel 提供原生缓存能力。
4. **B3（Drel 前台收推送形式）、A8（收件箱保留时长）为待验证项**：关键流程（推送是否可达、点了能否打开）不得建立在它们之上；它们只影响体验细节（横幅样式、错过补看）。

## 仍开放的问题（不阻塞 v1）

- A7 多设备 fan-out；A8 Inbox 保留时长；B3 Drel 前台收推送的展示行为；C4 更新可用信号机制；新增：离线 query 映射真机验证（见上节第 2 条）。
- 待用户确认（2026-09-10 五次修订后）：~~4 个 APP~~（已澄清为 Drel vs 浏览器，撤销）；**防抖策略**——presence 抑制已降级为两级（连接级纯服务端先行 / 可见性级需前端小改动），待定先只上连接级还是两级同切片；**推送入口主机**（shanbox proxy vs replay；B1 已确认必须真证书域名）。

## 实施顺序（2026-09-10 五次修订，含用户"先替换 message-bridge"指示）

**① Bridge server DrelChannel（路径 B，最先做）**：新增 `channels/drel.py` + manager 注册 + `.env` 加 `DREL_KEY`/注释 `BARK_KEY`（秒回滚）+ 文案；不依赖 pi-chat 证书域名（控制台证书已验证公网可信）。
**② 真证书域名 + 会话鉴权体系（独立 slice，路径 A 的前置）**：shanbox proxy 域名；全站会话（Secure/HttpOnly/SameSite/轮换撤销/CSRF）+ 按"用户 × 项目/session 归属"授权 + 审批页打开后重校验状态。
**②.5 推送开关（用户 2026-09-10 追加）**：SettingsPanel 新增“推送通知”区块（总开关默认开 + 说明文案）；存 `<PI_APP_CONFIG_DIR>/config.json`（app 级偏好，符合路径规范）；服务端 agent_end 推送前读取——关=永不推，开=再过 presence 抑制。v2 再考虑按项目开关/免打扰时段。
**③ server 端 agent_end DrelChannel（路径 A）**：agent_end hook + 开关检查（见 ②.5）+ presence 抑制（先连接级，可见性级视排期）+ 脱敏模板 + `threadId` 分组 + 幂等退避。
**④ 三场景真机验收**（锁屏/后台/前台点开；离线包不在验收范围，已移出 v1 依赖链）。
