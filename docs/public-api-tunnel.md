# 公网中转：api.lyonn.fun:17443

> 让外地任何一台机器，用标准 OpenAI SDK 调用办公室这台电脑上的 WorkDaddy 反代网关。
> 落地时间：2026-10-30 · 状态：**已打通并验证**

---

## 一、对外地址

| 项目 | 值 |
|---|---|
| Base URL | `https://api.lyonn.fun:17443/v1` |
| 鉴权 | `Authorization: Bearer <FRP_TOKEN>` （**不写明文**；本机值见 `.wd-tmp/frp-dl/token.txt` 与 `frps.toml`，该目录已 gitignore） |
| 证书 | Let's Encrypt（YE1 中间证书），有效期至 **2027-01-27** |
| 协议 | TLS 1.3，正式证书，**不需要** `-k` / `verify=False` |

一个能跑的验证命令：

```bash
curl https://api.lyonn.fun:17443/v1/models \
  -H "Authorization: Bearer <上面的 key>"
```

Python SDK：

```python
from openai import OpenAI
client = OpenAI(base_url="https://api.lyonn.fun:17443/v1", api_key="<key>")
print(client.chat.completions.create(
    model="cn:deepseek-v4.1-flash",
    messages=[{"role": "user", "content": "hi"}],
).choices[0].message.content)
```

---

## 二、拓扑

```
 外地设备
   │  https://api.lyonn.fun:17443   （正式证书，TLS 1.3）
   ▼
 ┌──────────────────────────────────────────────┐
 │ 家宽公网 120.87.107.231（IP 会变，靠域名兜）   │
 │ XDR6088 / ImmortalWrt 24.10                  │
 │   frps :17000  控制通道（token 鉴权 + 隧道加密）│
 │   frps :17443  对外隧道端口                    │
 └──────────────────────────────────────────────┘
   │  反向隧道（办公室主动外连，无需端口映射）
   ▼
 ┌──────────────────────────────────────────────┐
 │ 办公室这台机器                                 │
 │   frpc.exe                                     │
 │      └─ https2http 插件：在这里终结 TLS         │
 │           ▼                                    │
 │   127.0.0.1:7863  WorkDaddy 反代网关（明文 HTTP）│
 └──────────────────────────────────────────────┘
```

**为什么 TLS 在办公室这侧终结**：家宽 80/443 被运营商封，证书只能走 DNS-01 签发（不占 80 端口）。
隧道内容另有 frp 的 `transport.tls.force` 再加密一层，所以整条链路没有明文裸露。

**为什么网关不搬去 NAS**：网关的 `auths/` 里 4 个账号是同一 refreshToken 的副本，
搬到 NAS 会和办公室侧互相作废登录态。所以只搬流量，不搬网关。

---

## 三、落地物清单

### 家里路由器（10.10.10.10 / 公网 120.87.107.231）

| 路径 | 说明 |
|---|---|
| `/opt/frp/frps` | frp 0.71.1 aarch64 服务端，18,481,314 B，md5 `e874b4ea20981b59b457e63970b05632` |
| `/opt/frp/frps.toml` | 服务端配置，563 B |
| `/opt/frp/frps.log` | 运行日志（保留 7 天） |
| `/etc/init.d/frps` | procd 自启脚本，已 `enable` |
| `/etc/firewall.wd-frp.sh` | **绕过 OpenClash 入站劫持**的幂等脚本（见下节，关键） |
| `/etc/rc.local` | 开机执行上面的脚本 |
| `/etc/crontabs/root` | `*/5 * * * * /etc/firewall.wd-frp.sh` 兜底（`fw4 reload` 会冲掉临时规则） |

uci 新增（只增不改）：
- `firewall.@rule[9]` = `Allow-frp-public`：`src=wan proto=tcp dest_port='17000 17443' target=ACCEPT`
- `firewall.@rule[10]` = `Allow-ZeroTier-Manage`：`src=wan src_ip=10.10.10.0/24 target=ACCEPT`

### 办公室这台 —— 运行目录（2026-10-30 起）

> ⚠️ 2026-10-30 隧道改由 `daemon.js` 托管，**运行目录已搬出 `.wd-tmp`**，详见第十节。
> `.wd-tmp\frp-dl\` 现在只剩「lego 续期工具 + 旧副本」，**不要再从这里启动 frpc**。

| 路径 | 说明 |
|---|---|
| `%APPDATA%\WorkDaddy\tunnel\frpc.exe` | 客户端。**TLS 终结靠它的 `https2http` 插件**，不需要额外 Node 进程 |
| `%APPDATA%\WorkDaddy\tunnel\frpc.toml` | 客户端配置（路径全部绝对硬编码） |
| `%APPDATA%\WorkDaddy\tunnel\certs\` | `api.lyonn.fun.crt` / `.key` / `.issuer.crt` —— **frpc 只读这里** |
| `%APPDATA%\WorkDaddy\tunnel\frpc.log` | 运行日志（`log.maxDays = 7`） |
| `D:\WorkDaddy\.wd-tmp\frp-dl\lego\` | 续期工具目录（`lego.exe` + 它自己那份证书），**别整个删掉** |
| `D:\WorkDaddy\.wd-tmp\frp-dl\renew-cert.cmd` | 续期脚本，跑完会**把新证书复制到上面 tunnel\certs\** 再让 daemon 重拉 |

自启：`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- ~~`WorkDaddyTunnel` → `start-tunnel.cmd`~~ **已于 2026-10-30 删除**（改由 daemon 随 WorkDaddy 启动，
  留着会跟面板开关抢管理权）
- `WorkDaddyCertRenew` → `renew-cert.cmd`（登录时检查一次，未到期秒退）

---

## 四、日常运维

**首选面板操作**（2026-10-30 起）：WorkBuddy 客户端 → 侧栏增强面板 → **API 网关** → 「公网隧道」那一行，
有「连接 / 断开 / 复制公网地址 / 隧道日志」四个动作，状态灯就是链路体检。

命令行（排查用）：

```powershell
$T = Get-Content "$env:APPDATA\WorkDaddy\.api-token" -Raw
$P = (Get-Content "$env:APPDATA\WorkDaddy\ui-port.json" -Raw | ConvertFrom-Json).port

# 状态
curl.exe -s -H "X-WorkDaddy-Token: $T" "http://127.0.0.1:$P/api/gateway/tunnel/status"
# 断开 / 连接
curl.exe -s -X POST -H "X-WorkDaddy-Token: $T" -H "content-type: application/json" -d "{}" "http://127.0.0.1:$P/api/gateway/tunnel/stop"
curl.exe -s -X POST -H "X-WorkDaddy-Token: $T" -H "content-type: application/json" -d "{}" "http://127.0.0.1:$P/api/gateway/tunnel/start"
# 日志尾部 60 行
curl.exe -s -H "X-WorkDaddy-Token: $T" "http://127.0.0.1:$P/api/gateway/tunnel/log"
```

看隧道有没有连上，最直接的三处：
- 面板那一行显示 `已连接 · api.lyonn.fun:17443 → 本机网关`（即 `connected: true`）
- 本地日志出现 `[api-tls] start proxy success`
- 路由器 `/opt/frp/frps.log` 出现 `tcp proxy listen port [17443]`

---

## 五、证书续期

`lego` v5 没有独立 `renew` 子命令，`run` 自带判断：剩余不足 1/3（90 天证书约剩 30 天）才真正重签，
没到期就秒退，所以可以频繁执行。

触发方式（三重）：
1. `renew-cert.cmd` 在每次登录时跑一次
2. 计划任务 `WorkDaddy-Cert-Renew`（每周一 03:00）
3. 手动：双击 `renew-cert.cmd`

⚠️ **两个坑，改脚本时别踩**：

- `--dns.propagation.disable-ans / disable-rns` 这两个开关在 lego **5.6.0 里只认环境变量**
  （`LEGO_DNS_PROPAGATION_DISABLE_ANS=1`），写命令行上会被静默忽略。
  不关掉的后果：lego 会去查 Cloudflare 递归 DNS（1.0.0.1）验证传播，国内基本必失败，
  而且失败信息看起来像"证书签不下来"，实际 TXT 早就写好了。
- 续期后必须**重启 frpc**，因为 `https2http` 插件只在启动时读一次证书。
  `renew-cert.cmd` 用文件时间戳比对，只有证书真变了才重启，避免无谓断线。
- ⚠️⚠️ **lego 签完写的不是 frpc 读的那份**（2026-10-30 修的缺陷）：
  lego 写 `D:\WorkDaddy\.wd-tmp\frp-dl\lego\certs\certificates\`，
  而 `%APPDATA%\WorkDaddy\tunnel\frpc.toml` 的 `crtPath/keyPath` 指向
  `%APPDATA%\WorkDaddy\tunnel\certs\`。**只杀进程不复制 ⇒ 重启后仍加载旧证书，到期当天 TLS 直接失败。**
  现在脚本里在 `taskkill` **之前** `copy /Y` 三个文件（`.crt` / `.key` / `.issuer.crt`），
  复制失败就 `exit /b 2` 且不重拉，避免"看起来续期成功其实没生效"。
- 重启动作现在交给 **daemon**：脚本只 `taskkill`，daemon 会在数秒内用新证书自动拉起
  （前提是 `wbs.tunnel.enabled = true`；用户主动点过「断开」就不会拉，这是预期行为）。

---

## 六、故障排查

| 现象 | 查什么 |
|---|---|
| 公网 `17443` 连接被拒 | 路由器 `netstat -lntp \| grep 17443`。没有监听 = frpc 没连上，看办公室 `frpc.log` |
| `17000` 通、`17443` 不通 | frps 活着但代理没注册：frpc 进程挂了，或 `client exit` 后被回收 |
| 整个域名都不通 | 家宽公网 IP 变了？`ping api.lyonn.fun` 与路由器 WAN IP 对一下（A 记录 TTL 600，最多 10 分钟生效） |
| 能连但立即断开 | 路由器上 `nft list chain inet fw4 dstnat \| grep 17443`，没有那行 `return` 就是被 OpenClash 劫持了，跑一次 `/etc/firewall.wd-frp.sh` |
| 证书报错 | `openssl x509 -in ...crt -noout -dates`；过期就跑 `renew-cert.cmd` |

### ⭐ 那个 bypass 规则为什么必须存在

OpenClash 的透明代理在 `inet fw4 dstnat` 链末尾无条件 `jump openclash`，链内 `redirect to :7892`
把**所有入站 TCP 也劫持了**。它的 bypass 只写了 `sport 17000/17443 return`——只挡出站，不挡入站。
所以外面连 17443 的包会被送进 Clash，表现为"端口没开"，而 `nft` 计数器显示包从未进入 `input_wan`。

修法就是插一条 `tcp dport { 17000, 17443 } return`。注意：
- nat base chain 里 **`accept` 不终止后续链**，只有 `return` 才行
- `/etc/nftables.d/*.nft` 会被包进 `table inet fw4`，但这个版本的 `chain-prepend` 目录**未被渲染**
- `fw4` 不会自动执行 script include（`main.uc` 的 `case "includes"` 只能由显式 `fw4 includes` 触发）
  ⇒ 只能挂 `rc.local` + cron 兜底
- ⚠️ **`fw4 reload` 会清空 OpenClash 动态注入的规则**（要 `openclash restart` 恢复）；
  反过来 OpenClash 重启**不会**清掉上面手工插的 `return` 规则

---

## 七、回滚

### 办公室侧（一条命令，彻底干净）

```powershell
Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name WorkDaddyTunnel,WorkDaddyCertRenew
Stop-Process -Name frpc -Force
# 目录可留可删，删了不影响 WorkDaddy 本体
```

### 路由器侧

```sh
# 1. 停服务 + 取消自启
/etc/init.d/frps stop
/etc/init.d/frps disable

# 2. 删兜底
sed -i '/wd-frp/d' /etc/rc.local
crontab -l | grep -v wd-frp | crontab -

# 3. 删防火墙放行规则（先确认索引，别删错）
uci show firewall | grep -E 'Allow-frp-public|Allow-ZeroTier-Manage'
uci delete firewall.@rule[10]
uci delete firewall.@rule[9]
uci commit firewall

# 4. 恢复防火墙 + 清 OpenClash 残留
cp /etc/config/firewall.bak-wdfrp /etc/config/firewall
fw4 reload && /etc/init.d/openclash restart

# 5. 删文件
rm -rf /opt/frp /etc/firewall.wd-frp.sh /etc/init.d/frps
```

备份原件：`/etc/config/firewall.bak-wdfrp`（6,341 B）、`/tmp/nft-backup-before-frp.txt`（130,133 B，重启后失效）。

---

## 八、安全待办

| 项目 | 说明 |
|---|---|
| 阿里云 AK/SK | 明文出现在对话里，**必须轮换**。建议建一个只授权 `AliyunDNSFullAccess` 限制到 `lyonn.fun` 的 RAM 子账号 |
| 路由器 root 密码 | 同样在对话里出现过，建议改 |
| frp token | **不落文档**。本机值见 `.wd-tmp/frp-dl/token.txt`（已 gitignore），路由器上一份在 `/opt/frp/frps.toml`。两边必须一致，泄露就换 |
| 网关 api key | 建议单独发一个只用于外网的 key，泄露只影响这一个 |

对外只开两个端口：`17000`（控制）和 `17443`（隧道），都在 `allowPorts` 白名单内，
`frps` 不会变成开放代理。

---

## 九、路由器接入面板（`/wd-api/`）

一个跑在路由器 uhttpd 上的单文件页面，把「哪个地址配哪个 key」这件事固定下来，不用再翻聊天记录。
纯静态 HTML + 一个 CGI，**没有额外进程、没有额外端口**。

### 打开

```
http://192.168.2.1/wd-api/?t=<令牌>
```

令牌 `dYBcl6D8ZQSw14MtEfqR`。第一次带 `?t=` 进去后会写进浏览器 localStorage 并从地址栏抹掉，
之后直接访问 `http://192.168.2.1/wd-api/` 即可。手机 / 平板各输一次。

> 页面里含 API Key，所以做了令牌校验：**Key 不出现在 HTML 源码里**，只在令牌正确时由 CGI 返回。
> 无令牌访问 `/cgi-bin/wd-portal` 只会拿到 `{"ok":false,"error":"unauthorized"}`。

### 页面上有什么

| 区块 | 内容 |
|---|---|
| 接入地址 | 外网（`https://api.lyonn.fun:17443/v1`）、内网（`https://192.168.2.1:17443/v1`）、ZeroTier（`https://10.10.10.10:17443/v1`）、本机（`http://127.0.0.1:7863/v1`），每个都能一键复制 |
| **150 号池网关** | ⭐ 2026-11-03 新增：同样的四个位置，路径多一个 `/uni`（`https://api.lyonn.fun:17443/uni/v1` 等）。**key 与上面不通用**，单独一块显示/复制 |
| API Key | 显示 / 隐藏 / 复制 / **复制全部**（Base URL + Key 两行，直接贴进配置文件） |
| 快速接入 | cURL / Python / Node.js / .env / 通用客户端 五套代码，随 Key 自动填充 |
| 运行状态 | 网关健康、隧道延迟、隧道客户端数、证书剩余天数、可用模型数、路由器负载、内存、累计流量（30 秒自动刷新） |
| 模型列表 | 展开后列出全部模型 id，点一下复制模型名 |
| 隧道日志 | 展开看 frps 最近 40 行日志（已过滤 admin API 噪音），排错不用开终端 |
| 连通性自测 | 点「自测」会经隧道真打一次对话，返回往返耗时和模型回复 |

右上角可切深浅色，选择会记住。

### ⚠️ 17443 现在有两个网关（2026-11-03）

家宽 frps 只放行 17443，而 frp 的 `https2http` 插件只做 TLS 终结、不做路径路由，
所以路径分流是在办公室那台机器上做的（`scripts/tunnel-ingress.js`，只监听 127.0.0.1:7867）：

```
公网 17443 → frps → frpc → 127.0.0.1:7867
                              ├─ /uni/...  → 7866  150 号池
                              └─ 其余      → 7863  自家反代
```

⚠️ **`/healthz` 必须对公网放行** —— 就是这个面板拿它探活的
（`https://127.0.0.1:17443/healthz`，CGI 里判 `gwCode===200 && healthy>0`）。
第一版把 `/healthz` 一并拦了，面板立刻显示「网关离线」。
它只回池子计数与模型数，没有账号明细/key，公网可见无风险。

⚠️ 但 `/panel/*` 与 `/admin/*` **必须拦**（7866 控制台免口令，里面有 150 个号明细）。

部署物里多一个变量：`/etc/wd-portal.env` 的 **`WD_KEY_UNI=`**（150 号池那把 key）。
CGI 的 `act=ping` 支持 `pool=uni`，自测时走 `/uni` 并自动改用这把 key。

### 部署物

| 路径 | 说明 |
|---|---|
| `/www/wd-api/index.html` | 页面本体（约 30 KB，单文件，无外部依赖） |
| `/www/cgi-bin/wd-portal` | CGI 数据接口（`755`，shell + curl + openssl） |
| `/etc/wd-portal.env` | `WD_KEY=...`，`600`，被 CGI source |
| `/etc/wd-portal.token` | 访问令牌，`600` |

CGI 支撑三种请求（都要带 `t=<令牌>`）：

| 请求 | 返回 |
|---|---|
| `/cgi-bin/wd-portal?t=...` | 汇总状态 JSON（含 key） |
| `...&act=models` | 原样透传网关 `/v1/models` |
| `...&act=log` | frps 最近 40 行日志 |
| `...&act=ping&m=<model>` | 经隧道打一次真实对话，用于自测 |

### 页面靠什么拿数据

路由器自己 `curl` 本机隧道口 —— 也就是说页面显示的健康度和延迟，是**真实走了 frps → frpc → 网关**这一段，
不是在浏览器里假装。所以它也是这条链路最直接的体检。

### 改页面 / 重新部署

源码在 `D:\WorkDaddy\.wd-tmp\wd-portal\`（`src/p1..p3.html` 三段合并成 `dist/index.html`，
`cgi/wd-portal` 是 CGI）。改完合并、校验 LF，再传上去：

```bash
cd /d/WorkDaddy/.wd-tmp/wd-portal && cat src/p1.html src/p2.html src/p3.html > dist/index.html
# 起个临时 HTTP 服务，让路由器 wget（必须同一次调用内完成，否则进程会被回收）
```

### 改令牌

```sh
head -c 400 /dev/urandom | tr -dc A-Za-z0-9 | head -c 20 > /etc/wd-portal.token
chmod 600 /etc/wd-portal.token
```

改完旧令牌立即失效，各设备重新带 `?t=` 进一次。

### 整个删掉

```sh
rm -rf /www/wd-api /www/cgi-bin/wd-portal /etc/wd-portal.env /etc/wd-portal.token
```

不碰 LuCI、不碰 uhttpd 配置、不碰防火墙，删干净无残留。

### 两个坑

- **`navigator.clipboard` 在 `http://` 下不可用**（非安全上下文）⇒ 页面里内置了
  `execCommand('copy')` 的降级路径，否则复制按钮会全废。
- **`grep -c` 数的是"匹配行数"**，而 `/v1/models` 是单行 JSON ⇒ 统计模型数必须
  `grep -o '"id"' | wc -l`，否则永远返回 1。

---

## 十、公网隧道由 daemon 托管（2026-10-30）

### 为什么改

2026-10-30 凌晨 `02:31`，办公室这台机器的 `frpc` 静默死掉，**从那一刻到次日 19:15 公网地址一直是死的**，
没有任何人知道。查下来三个原因叠在一起：`frpc` 从来没进过代码（`scripts/` 里 `frp` 命中 0 次）、
没有进程守护、也没有状态展示。旧的 `start-tunnel.cmd` 靠一个 cmd 窗口做 loop 重连 —— 窗口一关全死。

现在 `frpc` 和 `wb2api.exe` 一样，由 `daemon.js` 当子进程托管，面板里同一个卡片就能看到两段的状态。

### 为什么**不**编进 `wb2api-go`

- **版本绑架**：frp 是独立大项目，编进去等于网关升级要看 frp 版本脸色，现在换网关只是换个 exe。
- **故障域耦合**：任一崩了另一也受牵连，面板上只剩"全挂"，分不清哪段坏了。
- **没有收益**：两者之间就是一个 `127.0.0.1:7863` 的 HTTP 关系，同进程不多做任何事。

### 落地物（已脱离 `.wd-tmp`）

| 路径 | 说明 |
|---|---|
| `%APPDATA%\WorkDaddy\tunnel\frpc.exe` | frp 0.71.1 windows_amd64 |
| `%APPDATA%\WorkDaddy\tunnel\frpc.toml` | 全部路径**绝对且硬编码**（别用 `%APPDATA%` 变量） |
| `%APPDATA%\WorkDaddy\tunnel\certs\` | `api.lyonn.fun.crt` / `.key` / `.issuer.crt` |
| `%APPDATA%\WorkDaddy\tunnel\frpc.log` | frpc 自己写，`log.maxDays = 7` |

`frpc.toml` 里额外开了 admin API（只监听 `127.0.0.1:7400`，密码随机）——
**探活靠它而不是靠猜进程**：`/api/status` 会明确返回每个 proxy 的 `status: "running"`。

### 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/gateway/tunnel/status` | 完整状态（见下） |
| GET | `/api/gateway/tunnel/log` | 日志尾部 60 行（**已过滤 admin 探活噪音**） |
| POST | `/api/gateway/tunnel/start` | 连接隧道，并把 `autoStart` 置 true |
| POST | `/api/gateway/tunnel/stop` | 断开隧道，并把 `autoStart` 置 false |

鉴权同其它 daemon 接口：`X-WorkDaddy-Token` ← `%APPDATA%\WorkDaddy\.api-token`，
端口读 `ui-port.json`（**每次 daemon 重启可能变**）。

`status` 关键字段语义 —— 别把 `running` 当"通了"：

| 字段 | 含义 |
|---|---|
| `installed` | exe + toml 是否都在 |
| `running` | 进程在（自己的子进程 **或** 探活说活着） |
| `connected` | ⭐ **frps 那头 proxy 真的 running**，这才是"隧道通了" |
| `ownsProcess` | 是不是 daemon 自己 spawn 的（重启后接管的外部实例为 false） |
| `autoStart` | 用户是否启用了自动拉起 |
| `restartAttempts` | 本次故障累计重拉次数 |

### 面板位置

侧栏增强面板 → **API 网关** → 展开后第二行「公网隧道」：

```
公网隧道   已连接 · api.lyonn.fun:17443 → 本机网关   [断开隧道][复制公网地址][隧道日志]
```

这一行和上一行「反代为 OpenAI 接口」**状态各自独立拉取、独立渲染** —— 隧道坏了不该让网关卡片变灰，
反之亦然。这也是"两个进程分开托管"最直接的收益：一眼看出是哪一段断了。

### 自愈策略

- **非预期退出** → 退避重拉（3s 起，封顶 60s 一次），日志有 `进程退出 code=N` + `N 秒后重拉（第 k 次）`。
- **用户点「断开」** → 先写 `autoStart=false` 再杀进程 ⇒ 退出回调不会重拉，这是有意的。
- 状态**不落独立文件**，写在 `C:\Users\<用户>\.workbuddy\settings.json` 的 `wbs.tunnel.enabled` 里
  （和面板其它开关同一个 settings，随 daemon 启动读回）。已于 2026-10-30 实测确认为 `{"enabled":true}`。

### 已知行为（不是 bug）

**daemon 重启会把 frpc 一起带走。** 同一父进程被 `taskkill` 时子进程同命（Windows job 语义），
新 daemon 在 **0.5 秒内**把它重新拉起，公网中断实测 **≤ 3 秒**。
所以改完 `daemon.js` 要重载时不必担心隧道"断了要手工救"。

### 四个坑

- **`stdio` 必须全 `ignore`**：接管道的话父进程一死管道就断，子进程跟着退出 ——
  「重启后接管已有实例」的逻辑永远走不到。frpc 本来就自己写文件日志，不需要管道。
- **日志必须过滤 `http/middleware.go`**：探活每 5 秒写两条 `/api/status`，不清掉 60 行窗口里大半是噪音，
  真正有用的 `login to server success` / `start proxy success` 会被挤出去。
- **`stop` 后要立刻把 `tunnelChild` 置空**：`exit` 事件是异步的，不置空则 `tunnelStatus()` 仍判
  `exitCode === null`，响应体出现 `running:true + connected:false` 这种自相矛盾组合。
- **`taskkill /IM frpc.exe` 是最后手段**：只在"外部孤儿实例"分支用。本机 frpc 只服务这一条隧道，
  且 admin 密码唯一，风险可控 —— 但仍然优先按 PID 杀。

### 旧机制已收尾

- `HKCU\...\Run\WorkDaddyTunnel` **已删除**（那是"启动一次"不是"活着"，还会和 daemon 抢管理权）。
- `.wd-tmp\frp-dl\start-tunnel.cmd` 改成一段说明文字，**不再启动 frpc**（否则会跟 daemon 打架）。
- `.wd-tmp\frp-dl\renew-cert.cmd` 保留续期职责，但**补了关键一步**：
  lego 签完写的是 `.wd-tmp\...\lego\certs\`，而 frpc.toml 读 `%APPDATA%\WorkDaddy\tunnel\certs\`
  ⇒ 只杀进程不复制 = 重启后仍加载**旧证书**，到期当天 TLS 直接失败。现在先 `copy /Y` 三件套再杀进程。
  两个 `.cmd` 都已统一成 **CRLF**（纯 LF 的 `.cmd` 在 cmd.exe 里解析 `if (...)` 块不稳）。

### 回滚

```powershell
# 停隧道并取消自动启动
curl.exe -X POST -H "X-WorkDaddy-Token: <token>" http://127.0.0.1:<port>/api/gateway/tunnel/stop

# 彻底移除托管（改回手工跑）
#   1) ~/.workbuddy/settings.json 里删掉 wbs.tunnel（否则 daemon 启动仍会拉隧道）
#   2) daemon.js 里 tunnel* 函数与 /api/gateway/tunnel/* 路由移除
#   3) 手工起：%APPDATA%\WorkDaddy\tunnel\frpc.exe -c %APPDATA%\WorkDaddy\tunnel\frpc.toml
```

隧道本身（frps / 证书 / DNS / 端口）完全不受影响 —— 托管只是"谁来拉起进程"，不碰链路配置。


