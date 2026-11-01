# 官方客户端错误码表（从本机 app.asar 解出的权威对照）

> 用途：判断上游返回的业务码到底是「账号坏了 / 额度用完了 / 模型不可用 / 我们发错了」，不再靠猜。
> 来源：本机 `D:\WorkBuddy\resources\app.asar` → `renderer/assets/contexts-*.js`（压缩变量 `Ajt` 附近的对象字面量）。
> 这是**官方决定给用户弹什么按钮**的依据，比任何第三方逆向文档权威。
> 取证时间：2026-11-02（客户端 5.8.3）。客户端升级后本表可能变化，复现方法见文末。

---

## 一、怎么读这张表

每一行是 `code → {actions:[...], feedback:bool}`：

- **`actions`** = 弹窗上给用户的按钮。空 `-` 表示**官方不给任何操作按钮**（用户什么都做不了）。
- **`feedback`** = 是否显示「反馈」按钮。`N` 表示官方连反馈渠道都不给 —— 通常意味着**这不是用户的错，也不是换个操作能解决的**。

动作代码含义（原文 `Ajt` 映射）：

| 动作 | 官方名 | 大白话 |
|---|---|---|
| `retry` | RETRY | 重试 |
| `checkNetwork` | — | 检查网络后再试 |
| `switchModel` | SWITCH_MODEL | **换模型** |
| `editInput` | EDIT_INPUT | **改输入**（提示词/参数不合法） |
| `newTask` | NEW_CONVERSATION | **新建会话**（这个会话救不回来了） |
| `relogin` | — | **重新登录**（凭证失效） |
| `reupload` | REUPLOAD | 重新上传附件 |
| `upgradeClient` | UPGRADE_CLIENT | 客户端太旧，去升级 |
| `purchase` | — | 去买 |
| `applyQuota` | — | 申请配额 |
| `feedback` | SUBMIT_FEEDBACK | 提交反馈 |
| `acknowledge` | ACKNOWLEDGE | 我知道了 |

---

## 二、全表（104 条）

> `6e3` / `1e4` 是 JS 压缩后的数字字面量，已还原为 `6000` / `10000`。

| code | 动作 | 允许反馈 | code | 动作 | 允许反馈 |
|---|---|---|---|---|---|
| `400` | retry | Y | `11101` | retry | Y |
| `401` | relogin | N | `11102` | switchModel,retry | Y |
| `402` | relogin | N | `11103` | switchModel,retry | Y |
| `404` | switchModel,retry | Y | `11110` | switchModel,retry | Y |
| `429` | retry | Y | `11115` | editInput | Y |
| `502` | checkNetwork,retry | Y | `11124` | switchModel | Y |
| `1001` | retry | Y | `11-128` | editInput | Y |
| `1002` | retry | Y | `11129` | retry | Y |
| `1003` | retry | Y | `11130` | retry | Y |
| `1004` | retry | Y | `11133` | switchModel,newTask | Y |
| `1005` | switchModel | Y | `11134` | switchModel,retry | Y |
| `2001` | retry | Y | `11135` | editInput | Y |
| `2002` | retry | Y | `11136` | switchModel | Y |
| `2003` | retry | Y | `11137` | retry | Y |
| `2004` | retry | Y | `11138` | **upgradeClient** | Y |
| `2005` | retry | Y | `11139` | reupload | Y |
| `2006` | retry | Y | **`11140`** | **—（无按钮）** | Y |
| `2007` | retry | Y | **`11141`** | switchModel | Y |
| `3001` | retry | Y | **`11145`** | **purchase** | **N** |
| `3002` | checkNetwork,retry | Y | `11148` | newTask | Y |
| `3003` | checkNetwork,retry | Y | `11149` | newTask | Y |
| **`3004`** | **relogin** | N | `11150` | retry | Y |
| `3005` | retry | Y | `11151` | newTask | Y |
| `3006` | retry | Y | `11152` | newTask | Y |
| `3007` | retry | Y | `11153` | retry | Y |
| `3008` | retry,switchModel | Y | `11154` | reupload | Y |
| `4001` | newTask | Y | `11155` | retry | Y |
| `4002` | newTask,retry | Y | `12654` | editInput | Y |
| `4003` | newTask | Y | **`14001`** | **—（无按钮）** | **N** |
| `4004` | newTask | Y | **`14002`** | **—（无按钮）** | **N** |
| `4010` | newTask | Y | **`14003`** | switchModel,retry | Y |
| `4012` | newTask | Y | **`14012`** | —（无按钮） | N |
| `4013` | retry | Y | **`14013`** | —（无按钮） | N |
| `6000` | retry | Y | **`14014`** | —（无按钮） | N |
| `6001` | retry | Y | **`14015`** | —（无按钮） | N |
| `6002` | retry | Y | **`14016`** | —（无按钮） | N |
| `6003` | retry | Y | **`14017`** | —（无按钮） | N |
| `6005` | retry | Y | **`14019`** | applyQuota | N |
| `6006` | retry | Y | `14405` | editInput,switchModel | Y |
| `6007` | retry | Y | | | |
| `6008` | retry | Y | | | |
| `10000`–`10021` | retry | Y | | | |
| `10101` | retry | Y | | | |
| `10102` | editInput | Y | | | |

---

## 三、`6004` 和 `14018` 去哪了？（重要）

这两个码**不在这张 action 表里**，因为它们被列进了另一个集合：

```js
Pjt = new Set(['6004', '14018'])   // isPreservedLegacyErrorCode
```

它们走**遗留路径**，按钮来自另一张表（`main/account.js` 的 `getCreditPurchaseActions()`）：

```js
{ 14018: { labelZh: '获取 Credits', labelEn: 'Get credits',    url: '.../profile/plan', showButton: true },
  6004:  { labelZh: '升级专业版',   labelEn: 'Upgrade to Pro',  url: '.../profile/plan', showButton: true },
  6005:  { labelZh: '升级专业版',   labelEn: 'Upgrade to Pro',  url: '.../profile/plan', showButton: true } }
```

⇒ **判读**：
- `14018` = **积分（Credits）用完**，去买
- `6004` / `6005` = **套餐额度用完**，去升级（`6005` 同时在 action 表里给 `retry`，即"等日切"）

这与 `DAILY_CODES = {6004, 6008}` 的"到期日重置"判读完全吻合。

---

## 四、官方还分了 5 个集合（比单码更有信息量）

```js
jjt = {14012,14013,14014,14015,14016,14017,14019}      // isHeadlineOnlyErrorCode：只显示标题，不给操作
Njt = {11145} ∪ jjt ∪ {14018}                          // resolveErrorBannerIconVariant：用「credits」图标
Pjt = {6004, 14018}                                    // isPreservedLegacyErrorCode：遗留额度码
Fjt = {14019, 11145}                                   // isInlineActionErrorCode：内联动作
Ljt = {11145}                                          // isErrorCodeHidden：整条码对用户隐藏
```

**结论**：
1. `Njt` 这一族官方统一用 **credits 图标** ⇒ **`14012`–`14019` 全都是「额度/账单」问题，不是「账号故障」**。
2. `11145` 是唯一被「隐藏」的码 ⇒ 官方最不想让用户看见的（"你要买"）。
3. `14012`–`14019` 全部 `feedback = N` ⇒ 官方认为**这些不是 bug，不该给反馈按钮**。

---

## 五、三方对照（官方 / MiraiHub / 本地 wb2api-go）

| 码 | 官方语义 | MiraiHub | 本地 Go | 一致性 | 建议 |
|---|---|---|---|---|---|
| `11140` | 无按钮、可反馈 | `account_fault` | `ErrAccountFault` | ✅ 一致 | 保持 |
| `11141` | switchModel | `model_behavior` | 部分覆盖 | ✅ 一致 | 保持（**别冷账号**） |
| `11145` | purchase、隐藏 | **无** | **无** | ⚠️ 都缺 | **补**：明确"需购买"信号 |
| `14003` | switchModel + retry | `model_rate`（线上实测） | **无** | ⚠️ 本地缺 | **补**：否则落 429 → `soft_rate` 会冷好号 |
| `14012`–`14016` | credits 族、无按钮 | 只覆盖 14012-14014 | **无** | ⚠️ 都缺 | **补**，至少别落 `client`（不可重试直透） |
| `14017` | credits 族、无按钮 | `account_fault` | `ErrAccountFault`（trial not activated） | 🟡 三方不矛盾 | 沿用，但**冷却按"额度"不按"账号故障"** |
| `14018` | 获取 Credits | `hard_credit` | `ErrHardCredit` | ✅ 一致 | 保持 |
| `14019` | applyQuota | 未覆盖 | **无** | ⚠️ 都缺 | 补：申请配额 |
| `14001` | 无按钮、**不给反馈**、**不在 credits 族** | `hard_credit` | 只在签到匹配里 | 🟡 存疑 | 改归"未知账号级"，只观察不动作 |
| `6004` | 升级专业版 | `model_rate`（日级只冷模型） | 上游墙钟 + 24h 有界退避 | ✅ 一致 | 保持（本地更细） |
| `6008` | retry（日级） | `model_rate` | **无** | ⚠️ 本地缺 | 补：按 `next_cn_midnight` 日切 |
| `402` | **relogin** | `session_dead` | `session_dead` | ✅ 一致 | 保持 |
| `3004` | **relogin** | `session_dead` | 需核对 | ✅ 一致 | 保持 |
| `404` | switchModel + retry | `not_found` | 不重试 | 🟡 冲突 | **保持本地**（模型不存在重试无意义） |
| `11-128` | editInput | `client`（不换号） | 覆盖 | ✅ 一致 | 保持 |

---

## 六、复用方法（客户端升级后怎么重取）

`wb_asar.py` 是 MiraiHub 仓库里那个 552 行的纯标准库 asar 读取器（零依赖，不装 Node）：

```python
import sys, re
sys.path.insert(0, r"D:\WorkDaddy\.wd-tmp\MiraiHub-x")
from wb_asar import Asar

a = Asar(r"D:\WorkBuddy\resources\app.asar")
t = a.read_file("renderer/assets/contexts-DgzzFjnf.js").decode("utf-8", "ignore")

i = t.find("11138:{actions:")            # 错误码表附近的锚点
print(t[i-8000:i+4000])                  # 全表
j = t.find("Ajt={SUBMIT_FEEDBACK")       # 动作映射 + 5 个集合
print(t[j:j+950])
```

⚠️ 文件名 `contexts-DgzzFjnf.js` 带内容哈希，客户端升级后会变。找不到时用：
`a.list_files()` 里筛 `renderer/assets/contexts-*.js`，或直接 `a.search(b"11138")` 定位。

另外 `cli/dist/lazy-lite-wb/4397.*.mjs` 里也有一份码字表，但那是**压缩后的整数数组**，没有语义，不要用它。
