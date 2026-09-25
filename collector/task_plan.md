# task_plan.md — 幻帧剧作 视频+提示词 采集

## Goal
采集 aico.fantaframe.com 全部项目的剧作生成视频 + 提示词 + 引用图。账号只读。落盘 NAS `Z:\幻帧采集\`。

## Phases
- [x] P1–P4 鉴权/接口/Chrome调试实例/项目枚举打通
- [x] P6 试点 ws1948 全链路：枚举→下载→中文目录树→图名一致（41 视频+192 引用图，零缺失）
- [x] P6b 提示词统一为单一版本：仅 prompt_used（实际提交版）
- [x] P6c 引用分流：image→引用图\图N_名.扩展名；audio→引用音频\音频N_名.mp3（扩展名以资产 URL 为准，不猜）。试点已验证：音频为真 mp3(ID3头)，提示词引用(音频N)=文件名首段
- [x] P7 全量前修复（全部完成，试点回放验证通过）：
  1. dl_ws.js：幂等续跑（已存在+mp4魔数→跳过）、curl --fail+退出码防截断、SHA-256 全落账、失败→dl_failed.json+非零退出
  2. 版本源对账：shot/list 内嵌 video_versions ≡ /svtapi/zh/shot/video_slot/list（双向集合核对一致，count_field 吻合）——系统性漏版风险排除
  3. ref_dl.js：扩展名一律取 URL、resolved_mentions 空→mentions 兜底(asset_id/insert_id)、SHA-256、幂等
  4. workspace/list 翻页循环+total 校验（实测 total=86=list_len 单页）；chapter/list 读 chapter_count、shot/list 读 shot_count，不足即 ⚠ 告警
- [x] P8 预备：fetch_ws/eval_page 动态获取 CDP page id；fetch_ws 分章枚举+单章重试×1（解决大项目单次 evaluate 超时，ws1874 教训）；树脚本参数化；build_tree 直写 FINAL+_trash_ 挪移
- [x] P7.5 全面审计+修复（2026-09-10 傍晚，已完成并试点回放通过 274/274）：
  - 致命① 平台错误信封=HTTP200+{code:1,result:null}，post() 不查 code → 鉴权失效静默空清单。已修：post() 内 `j.code===0` 守卫（fetch_ws/inventory_run 全部 post 副本），成功信封 code=0 已实证
  - 致命② exprWsInfo match=null 静默空跑。已修：wsTotal>0 且 !match → 抛 __err
  - 高③ mentions 兜底链路断在树端。已修：build/diagnose/repair 各加 normM(v,t) 与 ref_dl 同 rid 规则；ref_dl 字段 `insert_id`→`insertId` 修正；新增 check_ref_match.js 验证提示词图N/音频N↔文件名 0 失配
  - 高④ version_no=null 路径不一致（vx vs vnull）。已修：dl/build/repair 统一 `v.version_no!=null?:'x'`
  - 高⑤ 提示词空值兜底 prompt_show 违反决策。已修：空→`(提示词为空)`
  - 中⑥ build/repair 的 writeFileSync 加 SMB 重试；中⑦ 音频扩展名改 extOf 正则（去 new URL）；中⑧ 下载超时 90s→300s
  - 额外加固：ensureDir 逐级单层 mkdir+ENOENT 轮询（根治 Node mkdirSync recursive 在 SMB 的持续 ENOENT）；repair 的 retry 加 ENOENT；inventory_run 守卫
  - 试点回放：fetch 53 版本→dl 41 跳 0 失败→ref 22 跳→build 41视频+186图+6音频 缺失0→diagnose 274/274 零缺失零互撞→提示词引用 图219/音频6 与文件 0 失配
- [ ] P8 全量 86 项目：run_all.js 编排（fetch→dl→ref→build→diagnose 逐项目循环，断点续跑）。**等用户批准开跑**
- [x] P8a 只读全量盘点：86/86 项目通过 CDP Network 响应重放完成；1,976 集、14,879 分镜、31,784 版本、28,360 可下载、3,424 平台失败、0 待生成、0 接口盘点异常。结果：inventory_86_readonly.json / inventory_86_report.csv / inventory_86_report.md。
- [x] P8b 效率+健壮性只读复审：现有全量编排不可开跑；ws1762 实测 1 个真视频缺失，旧 diagnose 另有 1509 个路径生成假缺失。381 个唯一引用素材 1.364 GiB 被复制为 10,721 份/41.713 GiB，是首要冗余。
- [x] P8c 全量前收敛：代码、离线全链路测试、真实项目安全枚举与真实媒体下载试点均完成。`JJJ测试[2266]`（1 集/2 分镜/2 正常版本/0 平台失败）已直写 NAS，新 v4 链路校验为视频 2、素材映射 8、缺失/错误/下载失败均为 0，已写 COMPLETE。新链路为安全请求重放→直接成品下载→统一校验；取消 raw 视频层和引用素材物理复制，使用 `.part`→验证→rename、实时原子账本、非零失败退出。1762 仅安全枚举 manifest，未删 raw。
- [ ] P9 校验：哈希抽查、清单对账、漏采报告

## Decisions
- 提示词只留 prompt_used；文件名 图N_资产名 与其严格对应；展示版(@{C})不留（manifest.json 仍存全字段可回溯）
- CDP 旧脚本 collect_all.js 废弃禁跑，全量重写
- SMB 全操作带退避重试；不硬删旧目录，改名挪走最后清理
- 全量下载在 P8c 修复及新试点通过前保持停止；不再以旧 P7.5 “全部完成”作为开跑依据。
- 待用户拍板：失败版元数据是否归档 `_生成失败`；D 盘旧试点与根目录第二套规划文件的清理

## 已证伪路线（勿再投入）
- DOM 点分镜切换卡片
- 无网络捕获能力的沙箱浏览器调 API
