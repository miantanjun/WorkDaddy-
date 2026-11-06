/* 记忆检索评测集（LoCoMo 式四分类 + 负例）
 *
 * 为什么要有这个文件：
 *   前五个阶段的每一处改动都是「按设计推理」做的 —— 判断依据是纸面机制，不是实测效果。
 *   改完之后只有个案抽查（「查『排序』返回 3 条，看着对了」），
 *   而个案抽查挑的都是**改的时候心里惦记的那个词**，天然偏向新实现。
 *   所以需要一个固定题集：同一批问题、同一套判据，每次改动前后都跑，
 *   数字变好还是变坏一目了然，而且能挡住「修 A 弄坏 B」。
 *
 * ⚠️ 用例全部来自**本机真实会话**，不是编的。
 *    gold 字段 = 该问题的「正确答案所在行的 seq」（seq 在单个会话内唯一且稳定，
 *    比 id 更适合当锚点 —— id 会随重建索引变化，seq 不会）。
 *    多答案时数组；`minHit` 指定至少命中几个才算召回。
 *
 * 四类问题（对齐 LoCoMo 的分类思路）：
 *   single  —— 单跳：答案就在一条原文里，问法与原文措辞接近
 *   multi   —— 多跳：要两条以上拼起来（先 A 后 B，或 A 与 B 的对照）
 *   temporal—— 时序：问「什么时候 / 之前是什么 / 后来改成什么」
 *   open    —— 开放域：答案要靠归纳，措辞与原文差得远（最考语义）
 *   negative—— 库里根本没有：**答不出来才是对**（这类最能暴露「乱召回」）
 *
 * 判据只用「金标准行有没有进 Top-k」，不看模型生成的答案 ——
 * 检索质量与生成质量要分开量，混在一起就定位不到是哪一层坏了。
 */
'use strict';

const SID_WD = '8f92c3fc-ff73-4db1-b104-eb060127daaf';   // WorkDaddy 维护主会话
const SID_APP = '3a1eef3c-382c-4d17-95ae-7b29e230ae68';  // lang app + 云服务器
const SID_CAT = '96f77df6-452b-4c05-916f-92e30accd72b';  // 画册整理

const CASES = [
  /* ============ 单跳：答案在一条原文里，措辞接近 ============ */
  { id: 'S01', cat: 'single', sid: SID_CAT, k: 5,
    q: '已排序目录 合并之后有多少个产品位',
    gold: [748], why: '合并结果 247 个产品位 / 1514 个文件' },
  { id: 'S02', cat: 'single', sid: SID_CAT, k: 5,
    q: '拍摄 壁炉工具 批次的 MD5 重复率是多少',
    gold: [856], why: '3809 个文件，1215 个（31.9%）与已排序目录 MD5 相同' },
  { id: 'S03', cat: 'single', sid: SID_CAT, k: 5,
    q: '未处理目录 全部处理完之后一共多少个文件',
    gold: [943], why: '合计 6928 个文件' },
  { id: 'S04', cat: 'single', sid: SID_WD, k: 5,
    q: '反代网关 三个账号 按什么顺序扣积分',
    gold: [8210], why: 'prefer_expiring，最早到期优先 + 30m 会话粘性' },
  { id: 'S05', cat: 'single', sid: SID_WD, k: 5,
    q: '回归测试 42 套件 2999 断言 是哪一次',
    gold: [1172], why: '42 套件 / 2999 项断言全部通过' },
  { id: 'S06', cat: 'single', sid: SID_APP, k: 5,
    q: 'v1.4.0 的 APK 大小是多少字节',
    gold: [2569, 2571], why: '15,372,572 字节' },
  { id: 'S07', cat: 'single', sid: SID_APP, k: 5,
    q: '飞鸽短信 余额还有多少条',
    gold: [8423, 8427], why: '余额 = 9935 条' },
  { id: 'S08', cat: 'single', sid: SID_WD, k: 5,
    q: 'md 快速查看器 改了哪些文件',
    gold: [2616], why: 'inject.js 8 处 + daemon.js 新增 /api/md-export-html' },
  { id: 'S09', cat: 'single', sid: SID_CAT, k: 5,
    q: '45S1.png 判定成哪个型号',
    gold: [994], why: '型号判定 45-B，画册序号 59' },
  { id: 'S10', cat: 'single', sid: SID_WD, k: 5,
    q: '上游 1.2.7 真增量 新增几个文件 改动几个',
    gold: [5900], why: '新增 2 / 删除 0 / 改动 13' },

  /* ============ 换说法（仍算单跳，但措辞与原文差得远）============ */
  { id: 'P01', cat: 'single', sid: SID_WD, k: 5,
    q: '插件卡顿是哪个进程的锅',
    gold: [12228], why: 'daemon 的 --probe-client-running 递归派生自己，16 核打满' },
  { id: 'P02', cat: 'single', sid: SID_WD, k: 5,
    q: '新登录的账号为什么进不了网关的池子',
    gold: [13332], why: '账号文件只在安装/更新网关那一刻写一次' },
  { id: 'P03', cat: 'single', sid: SID_WD, k: 5,
    q: '用量看板会话排行显示未命名 怎么修的',
    gold: [3969, 3970], why: '复用插件会话页的任务对话名识别' },
  { id: 'P04', cat: 'single', sid: SID_APP, k: 5,
    q: '手机打开 app 一直转圈 什么原因',
    gold: [236], why: 'HTTPS 证书 9 月 11 号过期，卡在 TLS 握手' },
  { id: 'P05', cat: 'single', sid: SID_CAT, k: 5,
    q: '画册里那三个所谓空号 到底是怎么回事',
    gold: [2183], why: '字典覆盖了重复型号，13/110/288 都是正常产品' },
  { id: 'P06', cat: 'single', sid: SID_APP, k: 5,
    q: '旧的 apk 包能不能还原出源码',
    gold: [935], why: '能逆向，标准 uni-app 安卓包' },

  /* ============ 多跳：需要两条以上拼起来 ============ */
  { id: 'M01', cat: 'multi', sid: SID_CAT, k: 8,
    q: '已排序目录从 95 个涨到 247 个，中间合并了什么批次',
    gold: [425, 748], minHit: 2, why: '先 95 个改名（seq 425），再合并 172 套到 247（seq 748）' },
  { id: 'M02', cat: 'multi', sid: SID_CAT, k: 8,
    q: '画册产品清单里相邻组撞色的问题最后怎么解决的',
    gold: [263, 332], minHit: 2, why: '先出四方案对比（seq 263），再按组上色修撞色（seq 332）' },
  { id: 'M03', cat: 'multi', sid: SID_WD, k: 8,
    q: '卡顿问题从怀疑渲染层到定位到进程递归 结论怎么变的',
    gold: [11933, 12228], minHit: 2, why: '先推翻渲染层结论（seq 11933），再定位进程递归（seq 12228）' },
  { id: 'M04', cat: 'multi', sid: SID_APP, k: 8,
    q: 'lang app 的源码和服务器架构分别是什么技术栈',
    gold: [115, 405], minHit: 2, why: '服务器 Spring Boot 单体（seq 115）+ 三端技术栈（seq 405）' },
  { id: 'M05', cat: 'multi', sid: SID_CAT, k: 8,
    q: '画册没有的型号 和 有同编号但颜色不同的 各有多少个',
    gold: [425], why: '18 个颜色/配置不同 + 80 个画册完全没有' },

  /* ============ 时序：问「什么时候 / 之前 / 后来」============ */
  { id: 'T01', cat: 'temporal', sid: SID_WD, k: 8,
    q: 'token 速度功能最初为什么做 后来为什么又要拿掉',
    gold: [116, 1813], minHit: 2, why: '先评估能做（seq 116），后判不好用/不准（seq 1813）' },
  { id: 'T02', cat: 'temporal', sid: SID_WD, k: 8,
    q: '上游 1.2.9 到底吸纳了没有 中间怎么反复的',
    gold: [8442, 5900], why: '查证上游没删、本地也没吸纳（seq 8442）' },
  { id: 'T03', cat: 'temporal', sid: SID_WD, k: 8,
    q: '代码加速最后是哪两件事一起起作用才正常的',
    gold: [12356], why: '吸纳探测递归派生修复 + 客户端升级 5.8.2' },
  { id: 'T04', cat: 'temporal', sid: SID_APP, k: 8,
    q: '证书过期之后是怎么处理的',
    gold: [236, 272], minHit: 2, why: '先定位过期（seq 236），再上传替换（seq 272）' },
  { id: 'T05', cat: 'temporal', sid: SID_WD, k: 8,
    q: '1.2.15 的同步个性化功能最后到底接没接',
    gold: [13345, 13420], minHit: 1, why: '先讲清功能（seq 13345），后决定不吸纳（seq 13420）' },

  /* ============ 开放域：答案要归纳，措辞差得远 ============ */
  { id: 'O01', cat: 'open', sid: SID_APP, k: 8,
    q: '哪些任务适合交给团队做 哪些自己单干更划算',
    gold: [2815], why: '实测 token 账后修正结论：团队买的是独立验证' },
  { id: 'O02', cat: 'open', sid: SID_WD, k: 8,
    q: '为什么不能每次改一点就发版',
    gold: [4798], why: '攒多点再更新，不用每次 bump + 推 GitHub' },
  { id: 'O03', cat: 'open', sid: SID_CAT, k: 8,
    q: '人工复核为什么做成选择题和判断题文件',
    gold: [2622], why: '无法判断的做成选择题/判断题，做完实时保存发回' },
  { id: 'O04', cat: 'open', sid: SID_APP, k: 8,
    q: '这个 app 是给谁用的 为什么不做给客户装',
    gold: [652], why: '只装公司人员设备，主要用于向客户展示' },
  { id: 'O05', cat: 'open', sid: SID_WD, k: 8,
    q: '离线环境怎么验证面板布局',
    gold: [681], why: 'cdp-eval.py 在 .wd-analysis，用隔离 venv 的 python 调' },

  /* ============ 负例：库里没有，答不出来才对 ============ */
  { id: 'N01', cat: 'negative', sid: SID_WD, k: 5, q: 'Kubernetes 的 Pod 驱逐阈值怎么配', gold: [] },
  { id: 'N02', cat: 'negative', sid: SID_WD, k: 5, q: 'PodDisruptionBudget 怎么写', gold: [] },
  { id: 'N03', cat: 'negative', sid: SID_WD, k: 5, q: 'Redis 集群 slots 迁移怎么做', gold: [] },
  { id: 'N04', cat: 'negative', sid: SID_WD, k: 5, q: 'v3.0.0 版本的发布说明', gold: [] },
  { id: 'N05', cat: 'negative', sid: SID_CAT, k: 5, q: 'PostgreSQL 分区表怎么建', gold: [] },
  { id: 'N06', cat: 'negative', sid: SID_APP, k: 5, q: 'Nafeza ACID 申报流程', gold: [] },
  { id: 'N07', cat: 'negative', sid: SID_APP, k: 5, q: 'Server Actions 的缓存策略', gold: [] },
  { id: 'N08', cat: 'negative', sid: SID_WD, k: 5, q: 'YKW-SU-260713 尾款什么时候到账', gold: [] },
];

module.exports = { CASES, SID_WD, SID_APP, SID_CAT };
