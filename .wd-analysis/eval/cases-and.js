/* 第五批题：**AND 路短查询配对题**（short-query pairs for the AND branch）
 *
 * ── 为什么必须新造这一批 ──────────────────────────────────────
 * 前四批 126 道正例题里，**125 道走 OR，只有 1 道走 AND**（实测 probe-and-route.js）。
 * 而产品的检索有两条完全不同的排序路径：
 *   · OR 路：以「覆盖率」定名次 ⇒ rel 是离散整数名次，并列判定用「原始分相等」
 *   · AND 路：rel 是连续 bm25 ⇒ 并列判定用「全池全距 × REL_TIE」
 * 两条路用的是**不同的并列判据、不同的量纲**。只测 OR，等于排序改动只验了一半。
 *
 * 更麻烦的是：真实使用里**短查询几乎必然走 AND**。
 * AND 的触发条件是「查询的每一个 bigram 都在索引里」，词越少越容易满足。
 * 而评测集的查询普遍 10~20 个 bigram（长、措辞完整），几乎必然有词不在索引里 ⇒ 降级 OR。
 * ⇒ 评测集与真实使用**恰好相反**：真实用户敲「插件卡顿」「反代积分」，评测在问长句。
 *
 * ── 这批题怎么来的 ──────────────────────────────────────────
 * **gold 不重新标注，直接沿用源题的 gold**。这是本批最重要的一条设计约束：
 *   gold 的正确性已由 126 道长查询题反复验证（人眼核过原文）。
 *   若为短查询重新找 gold，「路由差异」就会和「题目差异」混在一起，分数变化无法归因。
 *   ⇒ 同一 sid、同一 gold、同一 k，**只把 q 缩短** ⇒ 唯一自变量就是路由。
 *
 * 短查询的构造规则（四条，逐条都排除了一个坑）：
 *   ① 全部 bigram 必须都在 gold 原文里 ⇒ **gold 必然进候选池**
 *      ⇒ 这样 Top-k 命中与否只取决于排序，而不是取决于能不能召回。
 *      第一版用的是「长查询里最稀有的 bigram」，结果 AND 之后只剩 3~5 条，
 *      182/414 条连 3 条都不到 —— 池子太小，根本没有「组」，也就没有排序可测。
 *   ② bigram 按 df **降序**取（高频词）。理由同①：稀有词区分子答案但不产生大池子。
 *   ③ 至少一个 bigram 含中文 —— 否则会生成「1 2」「0 v1」这种纯数字查询，
 *      df 上万、池子两百条，看着像好题，实际是「所有带 1 和 2 的段落」。
 *   ④ 剔除虚词 bigram（「什么 为什」「面板 那个」这类），题面才像真实查询。
 *
 * ── 怎么读这批题的分数 ─────────────────────────────────────
 * ⚠️⚠️⚠️ **MRR 绝对值不能当「AND 路召回率」引用**。
 *   因为 gold 是用「词法重叠」构造出来的（短查询的词全部取自 gold 行），
 *   它天然偏向「词法强相关」的行，不代表语义正确性。
 *   本批题的正确用法是**相对比较**：
 *     · 改动前后 MRR 的差（同一批题、同一 gold）
 *     · 逐题胜/负计数 + 配对符号检验（不要只看均值，n=50 时 2~3pp 完全在噪声里）
 *     · 纯机制指标（组数、最大组占比、第 1 名是否被换掉），它们与 gold 无关
 *   ⇒ 基线：MRR 22.45% / R@1=5 / R@5=18 / R@10=28（probe-and-sens2.js）。
 *     其中 miss 的名次分布很散（11~40 名 19 道、>40 名 4 道），
 *     ⇒ 说明这是「排序区分力弱」而不是「差一点」，用它做 A/B 是灵敏的：
 *       换位开关一动，50 道里 38 道名次就变。
 *
 * ── 题集已实测出的两条结论（2026-11-05）────────────────────
 *   ① AND 路的 REL_TIE=0.12 落在**平台的上边缘**：
 *      0.02 → 22.57% / 0.05 → 22.64% / 0.08 → 22.55% / 0.12 → 22.45%（现状）
 *      0.20 → 20.81% / 0.30 → 19.87%（14 胜 29 负，符号检验 p=0.032，显著变坏）
 *      ⇒ 0.12 是安全的，再往上调（0.2+）会显著变差。**不动产品值。**
 *   ② AND 池 bm25 全距极差 2.56×（p10=4.29 / p50=8.09 / p90=10.99）
 *      ⇒ REL_TIE=0.12 换算成绝对阈值为 0.51~1.32 分，随池子漂移 2.56 倍。
 *      这就是工作区记忆里「分母取全池全距 ⇒ 会漂移」那一条的量化。
 */
'use strict';

const AND_CASES = [
  { id: "AND-CR01", cat: "coref", src: "CR01",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "面板 最后",
    gold: [26854], minHit: 1, bg: 2, pool: 27,
    why: "源 CR01｜标签栏 flex-grow 拉成 610px 黑条 → 改 grid 5 列" },
  { id: "AND-CR05", cat: "coref", src: "CR05",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "账号 三个",
    gold: [8210], minHit: 1, bg: 2, pool: 45,
    why: "源 CR05｜prefer_expiring 最早到期优先 + 30m 粘性" },
  { id: "AND-CR06", cat: "coref", src: "CR06",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "自己 探测",
    gold: [12228], minHit: 1, bg: 2, pool: 15,
    why: "源 CR06｜--probe-client-running 递归派生，16 核打满" },
  { id: "AND-CX01", cat: "cross", src: "CX01",
    sid: "3a1eef3c-382c-4d17-95ae-7b29e230ae68", k: 8, q: "证书 到期",
    gold: [236], minHit: 1, bg: 2, pool: 25,
    why: "源 CX01｜9 月 11 号过期，App 卡在 TLS 握手" },
  { id: "AND-CX03", cat: "cross", src: "CX03",
    sid: "3a1eef3c-382c-4d17-95ae-7b29e230ae68", k: 8, q: "源码 完整",
    gold: [935], minHit: 1, bg: 2, pool: 37,
    why: "源 CX03｜能逆向，标准 uni-app 包，app-service.js 445KB" },
  { id: "AND-CX09", cat: "cross", src: "CX09",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "md 文档",
    gold: [2616], minHit: 1, bg: 2, pool: 25,
    why: "源 CX09｜md 快速查看器落地（inject.js 8 处 + daemon 新端点）" },
  { id: "AND-M01", cat: "multi", src: "M01",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "目录 排序",
    gold: [425, 748], minHit: 1, bg: 2, pool: 54,
    why: "源 M01｜先 95 个改名（seq 425），再合并 172 套到 247（seq 748）" },
  { id: "AND-M02", cat: "multi", src: "M02",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "画册 清单",
    gold: [263, 332], minHit: 1, bg: 2, pool: 43,
    why: "源 M02｜先出四方案对比（seq 263），再按组上色修撞色（seq 332）" },
  { id: "AND-M03", cat: "multi", src: "M03",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "问题 渲染",
    gold: [11933, 12228], minHit: 1, bg: 2, pool: 34,
    why: "源 M03｜先推翻渲染层结论（seq 11933），再定位进程递归（seq 12228）" },
  { id: "AND-M04", cat: "multi", src: "M04",
    sid: "3a1eef3c-382c-4d17-95ae-7b29e230ae68", k: 8, q: "lang 源码",
    gold: [115, 405], minHit: 1, bg: 2, pool: 28,
    why: "源 M04｜服务器 Spring Boot 单体（seq 115）+ 三端技术栈（seq 405）" },
  { id: "AND-M05", cat: "multi", src: "M05",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "画册 型号",
    gold: [425], minHit: 1, bg: 2, pool: 64,
    why: "源 M05｜18 个颜色/配置不同 + 80 个画册完全没有" },
  { id: "AND-MC02", cat: "multi", src: "MC02",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "画册 覆盖",
    gold: [934, 1357], minHit: 1, bg: 2, pool: 24,
    why: "源 MC02｜934：61.3%→76.0%（250→310）；1357：76.0%→76.5%（310→311）" },
  { id: "AND-MC03", cat: "multi", src: "MC03",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "排序 已排",
    gold: [729, 934], minHit: 1, bg: 2, pool: 41,
    why: "源 MC03｜729：172 位/199 文件 + 82 型号/89 文件；934：add 780 / new 1988" },
  { id: "AND-MC06", cat: "multi", src: "MC06",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "文件 结论",
    gold: [5380, 5472], minHit: 1, bg: 2, pool: 16,
    why: "源 MC06｜5380：换英文短名+PPT重存才通；5472：改成 ASCII 短名后 14/14 全解出，上轮判断作废" },
  { id: "AND-MC07", cat: "multi", src: "MC07",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "文件 型号",
    gold: [3663, 5801], minHit: 1, bg: 2, pool: 60,
    why: "源 MC07｜3663：空夹 62→49；5801：有实拍 343→356、小图 66→53" },
  { id: "AND-MC08", cat: "multi", src: "MC08",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "文件 件夹",
    gold: [425, 748], minHit: 1, bg: 2, pool: 50,
    why: "源 MC08｜425：95 个改名、序号 1–132；748：合并后 247 产品位" },
  { id: "AND-NC05", cat: "numeric", src: "NC05",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "文件 重复",
    gold: [934], minHit: 1, bg: 2, pool: 27,
    why: "源 NC05｜add 780 / dup 54 / new 1988；已排序 248→308 目录，1673→2498 文件" },
  { id: "AND-NC09", cat: "numeric", src: "NC09",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "型号 归档",
    gold: [1357], minHit: 1, bg: 2, pool: 20,
    why: "源 NC09｜100 簇 / 132 张图 → 38 个型号；MD5 重复 37；剩 241 认不出" },
  { id: "AND-NC10", cat: "numeric", src: "NC10",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "目录 型号",
    gold: [2118], minHit: 1, bg: 2, pool: 46,
    why: "源 NC10｜已排序 330 夹/329 款，服务器 102 夹/22 新增，合并 351 款 = 86.7%，差 54 款" },
  { id: "AND-NC12", cat: "numeric", src: "NC12",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "目录 处理",
    gold: [2142], minHit: 1, bg: 2, pool: 37,
    why: "源 NC12｜11,984 张 / 66 GB / 15 个批次目录 + 141 个顶层散图" },
  { id: "AND-NU02", cat: "numeric", src: "NU02",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "会话 记录",
    gold: [27338], minHit: 1, bg: 2, pool: 47,
    why: "源 NU02｜5187 条里 140 条" },
  { id: "AND-NU05", cat: "numeric", src: "NU05",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "面板 标签",
    gold: [26854], minHit: 1, bg: 2, pool: 23,
    why: "源 NU05｜10 个标签只放得下 9 个，每个 63px；改 grid 后 123px" },
  { id: "AND-NU06", cat: "numeric", src: "NU06",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "需要 网关",
    gold: [21513], minHit: 1, bg: 2, pool: 38,
    why: "源 NU06｜daemon.js 只有 11 行挂载点" },
  { id: "AND-NU07", cat: "numeric", src: "NU07",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "账号 同步",
    gold: [13332], minHit: 1, bg: 2, pool: 48,
    why: "源 NU07｜网关池 3 → 4" },
  { id: "AND-NU09", cat: "numeric", src: "NU09",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "画册 产品",
    gold: [2231], minHit: 1, bg: 2, pool: 55,
    why: "源 NU09｜406 个唯一型号（旧库 387）" },
  { id: "AND-NU14", cat: "numeric", src: "NU14",
    sid: "3a1eef3c-382c-4d17-95ae-7b29e230ae68", k: 8, q: "v1 4 字节",
    gold: [2569, 2571], minHit: 1, bg: 3, pool: 44,
    why: "源 NU14｜15,372,572 字节" },
  { id: "AND-O03", cat: "open", src: "O03",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "文件 判断",
    gold: [2622], minHit: 1, bg: 2, pool: 18,
    why: "源 O03｜无法判断的做成选择题/判断题，做完实时保存发回" },
  { id: "AND-O04", cat: "open", src: "O04",
    sid: "3a1eef3c-382c-4d17-95ae-7b29e230ae68", k: 8, q: "app 客户",
    gold: [652], minHit: 1, bg: 2, pool: 37,
    why: "源 O04｜只装公司人员设备，主要用于向客户展示" },
  { id: "AND-P03", cat: "single", src: "P03",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 5, q: "会话 显示",
    gold: [3969, 3970], minHit: 1, bg: 2, pool: 46,
    why: "源 P03｜复用插件会话页的任务对话名识别" },
  { id: "AND-P04", cat: "single", src: "P04",
    sid: "3a1eef3c-382c-4d17-95ae-7b29e230ae68", k: 5, q: "app 一直",
    gold: [236], minHit: 1, bg: 2, pool: 35,
    why: "源 P04｜HTTPS 证书 9 月 11 号过期，卡在 TLS 握手" },
  { id: "AND-P05", cat: "single", src: "P05",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 5, q: "画册 三个",
    gold: [2183], minHit: 1, bg: 2, pool: 19,
    why: "源 P05｜字典覆盖了重复型号，13/110/288 都是正常产品" },
  { id: "AND-P06", cat: "single", src: "P06",
    sid: "3a1eef3c-382c-4d17-95ae-7b29e230ae68", k: 5, q: "apk 源码",
    gold: [935], minHit: 1, bg: 2, pool: 38,
    why: "源 P06｜能逆向，标准 uni-app 安卓包" },
  { id: "AND-S01", cat: "single", src: "S01",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 5, q: "目录 产品",
    gold: [748], minHit: 1, bg: 2, pool: 40,
    why: "源 S01｜合并结果 247 个产品位 / 1514 个文件" },
  { id: "AND-S03", cat: "single", src: "S03",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 5, q: "文件 目录",
    gold: [943], minHit: 1, bg: 2, pool: 52,
    why: "源 S03｜合计 6928 个文件" },
  { id: "AND-S04", cat: "single", src: "S04",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 5, q: "账号 网关",
    gold: [8210], minHit: 1, bg: 2, pool: 57,
    why: "源 S04｜prefer_expiring，最早到期优先 + 30m 会话粘性" },
  { id: "AND-S05", cat: "single", src: "S05",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 5, q: "回归 套件",
    gold: [1172], minHit: 1, bg: 2, pool: 106,
    why: "源 S05｜42 套件 / 2999 项断言全部通过" },
  { id: "AND-S06", cat: "single", src: "S06",
    sid: "3a1eef3c-382c-4d17-95ae-7b29e230ae68", k: 5, q: "v1 4 的",
    gold: [2569, 2571], minHit: 1, bg: 3, pool: 48,
    why: "源 S06｜15,372,572 字节" },
  { id: "AND-S08", cat: "single", src: "S08",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 5, q: "md 文件",
    gold: [2616], minHit: 1, bg: 2, pool: 60,
    why: "源 S08｜inject.js 8 处 + daemon.js 新增 /api/md-export-html" },
  { id: "AND-S09", cat: "single", src: "S09",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 5, q: "png 型号",
    gold: [994], minHit: 1, bg: 2, pool: 26,
    why: "源 S09｜型号判定 45-B，画册序号 59" },
  { id: "AND-S10", cat: "single", src: "S10",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 5, q: "2 文件",
    gold: [5900], minHit: 1, bg: 2, pool: 127,
    why: "源 S10｜新增 2 / 删除 0 / 改动 13" },
  { id: "AND-T01", cat: "temporal", src: "T01",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "token 功能",
    gold: [116, 1813], minHit: 1, bg: 2, pool: 25,
    why: "源 T01｜先评估能做（seq 116），后判不好用/不准（seq 1813）" },
  { id: "AND-T02", cat: "temporal", src: "T02",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "2 9 上游",
    gold: [8442, 5900], minHit: 1, bg: 3, pool: 44,
    why: "源 T02｜查证上游没删、本地也没吸纳（seq 8442）" },
  { id: "AND-T05", cat: "temporal", src: "T05",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "2 15 同步",
    gold: [13345, 13420], minHit: 1, bg: 3, pool: 17,
    why: "源 T05｜先讲清功能（seq 13345），后决定不吸纳（seq 13420）" },
  { id: "AND-TC04", cat: "temporal", src: "TC04",
    sid: "96f77df6-452b-4c05-916f-92e30accd72b", k: 8, q: "型号 排序",
    gold: [2156], minHit: 1, bg: 2, pool: 45,
    why: "源 TC04｜330 型号夹 / 392 有型号 / 228 无型号图 / 102 服务器 / 11,984 未处理" },
  { id: "AND-TP01", cat: "temporal", src: "TP01",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "断言 回归",
    gold: [116], minHit: 1, bg: 2, pool: 102,
    why: "源 TP01｜最早基线 41 套件 / 2885 断言（报告开头引用的历史值）" },
  { id: "AND-TP03", cat: "temporal", src: "TP03",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "回归 全量",
    gold: [27338], minHit: 1, bg: 2, pool: 76,
    why: "源 TP03｜88 个套件（最新）" },
  { id: "AND-TP07", cat: "temporal", src: "TP07",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "网关 反代",
    gold: [17872], minHit: 1, bg: 2, pool: 34,
    why: "源 TP07｜gateway-v1.13.0-panel-wd2" },
  { id: "AND-TP08", cat: "temporal", src: "TP08",
    sid: "8f92c3fc-ff73-4db1-b104-eb060127daaf", k: 8, q: "面板 网关",
    gold: [20867], minHit: 1, bg: 2, pool: 57,
    why: "源 TP08｜1.13.1-panel-wd9（11-02 那次改造时）" },
  { id: "AND-TP10", cat: "temporal", src: "TP10",
    sid: "3a1eef3c-382c-4d17-95ae-7b29e230ae68", k: 8, q: "第一 交付",
    gold: [1474], minHit: 1, bg: 2, pool: 22,
    why: "源 TP10｜15,679,367 B（v1.0.1 首交付）" },
  { id: "AND-TP12", cat: "temporal", src: "TP12",
    sid: "3a1eef3c-382c-4d17-95ae-7b29e230ae68", k: 8, q: "iOS 第一",
    gold: [1474], minHit: 1, bg: 2, pool: 26,
    why: "源 TP12｜首版交付记录" },
];

/* 分组统计：按源题类别，方便单独看「哪一类在 AND 路上最弱」 */
function andStats(list) {
  const out = {};
  for (const c of list) out[c.cat] = (out[c.cat] || 0) + 1;
  return out;
}

module.exports = { AND_CASES, andStats };

if (require.main === module) {
  const pools = AND_CASES.map((c) => c.pool).sort((a, b) => a - b);
  const q = (p) => pools[Math.min(pools.length - 1, Math.floor(pools.length * p))];
  console.log('AND 路配对题 ' + AND_CASES.length + ' 道：' + JSON.stringify(andStats(AND_CASES)));
  console.log('  池子 p10=' + q(0.1) + ' p50=' + q(0.5) + ' p90=' + q(0.9) + ' max=' + pools[pools.length - 1]);
  console.log('  bigram 个数：' + JSON.stringify(AND_CASES.reduce((a, c) => {
    a[c.bg] = (a[c.bg] || 0) + 1; return a;
  }, {})));
  const ids = new Set();
  for (const c of AND_CASES) {
    if (ids.has(c.id)) throw new Error('id 重复: ' + c.id);
    ids.add(c.id);
  }
  console.log('  id 唯一性检查通过');
}
