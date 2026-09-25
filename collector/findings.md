# findings.md

## 2026-09-10 — v4 真实媒体下载试点
- `JJJ测试[2266]` 是当前最小的全正常项目：1 集、2 分镜、2 个 ready 版本、0 个平台失败。
- `node collector\\run_all.js 2266` 完成安全枚举、直接成品下载与校验；成品根为 `Z:\\幻帧采集\\JJJ测试[2266]`，未建立 `ws2266` 或 raw 缓存层。
- 校验结果：2 个 MP4、8 条引用素材映射，`missing/wrong/failed=[]`；`_元数据\\COMPLETE.json` 存在，`failed.json` 不存在。
- 物理成品约 12.6 MB：MP4 7,288,815 bytes、PNG 5,726,278 bytes、MP3 165,561 bytes、提示词 TXT 1,164 bytes、JSON 24,803 bytes。

## 2026-09-10 — 下载前项目筛选与历史目录处理
- 技术盘点的 86 项中：46 个 `可采集`、16 个平台失败率≥20%、14 个无分镜、10 个有分镜无版本。后 40 个不进入下载队列。
- 从 46 个可采集项目中按名称剔除测试、demo、渠道、海报、广告、人设、学生练习、宣传、API、自由节点和明显人名项目后，剩 36 个；其中 29 个 ready 版本≥50，作为主剧候选，另 7 个小项目待人工确认。该规则只能筛技术完整度和项目用途，不能证明剧情质量。
- NAS 历史目录只读检查：`二期测试人设[6828]`、`侯攀[7572]`、`眼镜店广告[1948]` 是旧中文成品树，保留且不重下；它们不具 v4 COMPLETE 标记，后续若要纳入统一报表再做一次只读归档校验。`JJJ测试[2266]` 是已验证 v4 成品。`Star Goddess Returns[1762]` 未见 COMPLETE，且 `ws1762` raw 目录仍存在；在 Trae 完成并对账前，二者都不得移动或删除。

## 2026-09-10 — 服务器加速可行性（只读预检）
- 通过现有 `agent1-server` SSH 配置完成只读预检：远端为普通 `agent1` 用户（无 sudo）、4 vCPU、根卷可用 439 GiB，已安装 curl。
- 用 20 MB 丢弃式 Cloudflare 测速，远端公网下行约 1,008,234 B/s（约 1.0 MB/s）。这不是 FantaFrame CDN 的正式基准，但已不足以支持“服务器必然更快”的前提；本机已观察到 3 路下载约 0.8–1.0 视频/秒，按 4.72 MiB/视频折算约 3.8–4.7 MB/s。
- 服务器不能安全代替本机做平台 API 枚举：本机 Chrome 保持已登录状态，认证信息不可复制到服务器。即使服务器能下载媒体，落 NAS 仍多一段服务器→NAS 传输。结论：不用服务器做下载器；可在本机直写 NAS，并用服务器做独立的只读校验/报告任务。

## 2026-09-10 — 3 路真实基线与引用扩展名修复
- 以 `新B线 仿真人 Scarred, Crowned, Unbroken （加冕不朽）[5896]` 做正式中型基线。实时平台枚举为 63 集、385 分镜、136 ready 版本（旧盘点的 124 已过时）。默认 3 路下载完成 136 个 MP4 和 90 个去重引用素材。
- 发现并修复 v4 根因：同一 `resource_id` 跨版本出现不同 URL 扩展名时，下载器按首次 URL 落盘而校验/映射按后续 URL 推导路径，导致已存在 `asset_109396.png` 被误报缺失。新增 `assetExtensionIndex(manifest)`，以清单首次出现的扩展名为该资源唯一扩展名，下载、映射、校验共用；不扫描 NAS、不重下文件。
- 修复后先有 3 条旧引用映射扩展名不一致；重跑同项目仅复用已下载的 136 视频和 90 素材并重写映射，校验为 ready=136、refs=904、missing/wrong/failed 全空，已写 COMPLETE。

## 2026-09-10 — 4 路渐进并发验证
- 用户要求不直接开高并发。先完成 3 路正式基线后，仅上调一档到 4 路，以 `B类 仿真人《I Saved a Mermaid—Then She Claimed Me》（施救人鱼，被她认领）[1756]` 验证。
- 实时枚举为 60 集、69 分镜、80 ready；4 路下载和校验结果为视频 80、引用映射 339、missing/wrong/failed 全空，COMPLETE 已存在。
- 决策：后续固定单项目 4 路，不启动多个 runner，不再继续加并发；实际收益会在下一个较大项目中记录，但可靠性门槛已通过。

## 2026-09-10 — 审查意见复核
- 5896 COMPLETE 不是假成功：实时 manifest 为 63 集、385 分镜、136 个 ready 版本；成品正好 136 MP4，账本为 kept=226（136 视频+90 素材），COMPLETE 写于 14:08。`verify_project` 对每个 ready 版本检查 MP4 ftyp、提示词精确文本、引用映射、集中素材非空及失败账本，结果均空。63 集不等于每集/分镜必然有视频版本。
- `run_report.json` 的 5896 `collected:false` 是首次运行在映射扩展名 bug 前留下的批次尝试记录；随后手动复跑成功不会回写旧批次报告。它不能用作项目完成状态，COMPLETE 才是门槛。已修 `run_all.js`：今后失败会记录并打印 `fetch` 或 `collect` 阶段及退出码。
- JJJ测试的 `_引用素材\\Thumbs.db` 已确认真实存在，大小 16,896 bytes；它由 Windows 资源管理器产生，不是采集器输出。环境策略拒绝删除该二进制文件，未尝试绕过；不影响校验或后续采集。
- ws1762 不可直接称为安全可删：旧最终树没有 COMPLETE，raw 账本仍记录 1 条缺失媒体。用户若接受该缺口，仍应先完成一次能返回结果的最终只读对账并在中文成品写入接受记录，再删除 raw；当前对账扫描超过 30 秒未返回，未重复运行。

## 2026-09-10 — 迁移到另一台 PC 的可行性
- 当前无 collector node/curl 进程，处于安全的项目间迁移窗口。
- v4 新链路的可迁移部分是 Node 标准库脚本和非敏感项目清单；`project_layout.js` 支持 `FANTAFRAME_ROOT`，无需使用本机盘符 Z。旧 raw/构建脚本硬编码 Z，不应迁移或执行。
- 新执行机必须自行具备 Windows Node、curl.exe、可写 NAS 路径，并启动独立 Chrome 调试实例且由用户在该机登录。不得复制 Chrome profile、Cookie、令牌、私钥或旧 URL 清单；每个待抓项目在新机实时安全枚举。
- 迁移不复制媒体：NAS 是唯一成品源。控制权在项目边界切换；两台 PC 不得同时处理同一 workspace 或共享 run_report。

## 2026-09-10 全链路效率+健壮性复审（只读结论记录）
- 现场已从下载转入 `build_tree_ws.js ws1762`；build 会对 raw 中每个视频/引用素材做 `copyFileSync` 到成品树，是第二次完整 NAS 媒体写入。
- `run_all.js` 当前不可用于全量：调用已不存在的 `dl_ws.js`；`--all` 读取已移位的根目录 `inventory_full.json`；每步硬超时 600000ms，不适合已实测超过 10 分钟的大项目。
- `dl_ws3.js` 仍有致命状态错误：失败/hash_failed 结束不设非零退出码；`writeJSON()` 返回 false 未被检查；旧账本标记 ok 可以在目标文件已丢失时直接跳过。
- `dl_ws3.js` 直写最终 `.mp4` 而非 `.part`；最后一次失败的部分 MP4 可留存，重跑又只看 `ftyp`，存在把截断文件当 kept 的风险。
- `diagnose_tree.js` 只校验路径存在，不校验非零、源/目字节数或 hash；在此门槛下删 raw 不安全。
- ws1762 build 结束后现场复核：`manifest_result.json`=403 kept+1328 ok+1 fail，`dl_failed.json` 仍有 1 条，与“0 失败”汇报不符。
- 现有 `diagnose_tree.js ws1762` 报期望 14185/缺失 1510；`check_ref_match.js` 因缺失提示词文件直接 ENOENT 退出。已定位 build 是“先压缩空白再截 30”，diagnose/repair 是“先截 30 再压缩空白”，长分镜文本会生成不同目录，导致大量假缺失。
- 按 build 的真实路径规则重算：1732 个可下载版本中，raw/成品各真缺 1 个视频（media_id 183128），已有视频源目字节数不符=0；提示词缺失/内容不符=0；10721 个引用成品缺失/字节数不符=0。因此旧 diagnose 的 1510 中有 1509 个是假缺失，1 个是真缺失。
- 引用素材冗余实测：381 个唯一素材=1.364 GiB，在版本目录中复制 10721 份=逻辑 41.713 GiB，放大 30.59 倍。视频约 7.975 GiB，现成品逻辑体积约 49.7 GiB；素材集中存一份后约 9.34 GiB，节省约 81%。
- raw 整目录不能直接删：`manifest.json`/`manifest_result.json`/`ref_index.json`/`dl_failed.json` 都在其中；删后会同时丢失枚举源、断点账本、引用映射和失败证据，未来无法复核/修复。
- 当前本机物理网卡实时协商仍为 100 Mbps，Z: SMB 映射正常；服务器空闲 439 GiB 且有 rsync。若把当前膨胀成品镜像到服务器，容量和传输时间都会被引用复制主导。
- v4 实现：`project_layout.js` 是新唯一路径/原子写入实现；`fetch_manifest_replay.js` 仅用 CDP Network 重放且不读取认证；`collect_project.js` 直写成品树、资源集中、断点实时落账；`verify_project.js` 作为 COMPLETE 的唯一门槛；`run_all.js` 只调用 v4。
- v4 离线测试已验证：首次下载、第二次 kept 断点、素材映射、COMPLETE 创建均通过；不存在的媒体会生成 fail 账本、返回非完整结果且不会生成 COMPLETE。测试临时目录自清理。
- 真实枚举试点：`fetch_manifest_replay.js 1762` 成功经 Chrome 重放读取 Star Goddess Returns，结果 79 集/613 分镜/1732 可下载版本，已仅写入 `Star Goddess Returns[1762]\\_元数据\\manifest.json`。不读取认证信息，不下载媒体。
- 旧成品工具修复：build/repair/diagnose/check_ref_match 已统一“压缩空白后截 30”的路径规则。ws1762 复测 diagnose 仅缺 1 个真视频；10721 个平台资源标签对应文件全部齐全。提示词中 15 个未映射的图文本标记为平台源数据警告，不再误报为本地失配。

## 鉴权
- API 基址 `https://aico.fantaframe.com/svtapi/`；鉴权头 `authorization: Bearer <token>`，token 在 `localStorage['app-user'].token`
- fetch `credentials:'include'`；令牌只存 Chrome 内存，绝不进脚本输出/文件

## 接口
| 端点 | 参数 | 返回 |
|---|---|---|
| `/workspace/list` | `{page_number,page_size:100}` | 一次全量 86 项目（勿用 project/list → 404） |
| `/chapter/list` | `{workspace_id, only_current_user_bound}` | `result.chapter_list[]` |
| `/shot/list` | `{workspace_id, chapter_id}` | `result.shot_list[]`，**内含 `video_versions[]` 全带出**，免逐个拉 |

## video_versions[] 关键字段
`media_id, version_no, file_url(失败版=video_errro.mp4), thumbnail_url, is_error, is_selected, model_name, ratio, duration, prompt_used(实际提交模型), prompt_show, full_prompt, show_prompt(前端展示), mentions[], resolved_mentions[](引用图), created_at`

## 引用图 resolved_mentions[]
`[{url, name, label(图1/图2...), resource_id, resource_type:'image'}]`
- url 为 CDN `fantaframeultra.tos-volces / .tos-cn-shanghai.volces.com` 真实图，无鉴权可下
- **跨版本复用资产** → 按 resource_id 去重存中心库，避免重复

## 落盘格式（最终·用户确认版）NAS `Z:\幻帧采集\<剧中文名>[<ws_id>]\`
```
<集名>\
  分镜NN_<文本30字>_shot<id>\
    v<no>_选中|_历史_<media_id>\
      <media_id>_视频.mp4
      <media_id>_提示词.txt      仅 prompt_used（实际提交版）原文，无附加内容
      引用图\图<N>_<资产名>.<ext>  ← 文件名首段与提示词"图N"一致
```
- 命名核心：提示词引用(图N) = 引用图文件名首段，文件名自解释，无需对照表
- 两套提示词来源（用户拍板只留前者）：prompt_used=真正提交给模型的；prompt_show/@{C}=前端展示渲染，弃用（试点 41/41 版本 prompt_used 全非空）
- manifest.json 随项目根落盘，作机器可读备份（含 prompt_show 等全字段，将来要用可回溯）
- 平台偶发 resolved_mentions 重复条目 → 按 label|rid 去重
- 代号有 C(角色)/SC(场景) 两类；图N 编号是版本内的，跨版本不同资产
- 引用不止图片：audio 资产是真 mp3（ID3 头，URL 即扩展名依据），提示词以"音频N"引用（独立编号序列，不占图N）；试点 263 图 + 7 音频。下载若按固定扩展名会存错（之前 77KB "png" 实为 mp3）——扩展名永远取 URL

## 版本源与接口事实（P7-2 对账，2026-09-10）
- `/svtapi/zh/shot/video_slot/list`（POST {workspace_id, shot_id, chapter_id, episode_no:0}）与 shot/list 内嵌 video_versions **完全一致**（双向集合空差，count_field 吻合）。注意响应含 `detail` 嵌套副本（内含 selected_video/playable_video/video_versions 又一份）——粗数数组会把同 media_id 数两遍（26 vs 11 的假差异就是这么来的），对账必须用集合
- 昨日"168004/167516 消失"之谜关闭：manifest（API 源）一直有这两版，是 DOM 历史列表显示不全，API 完整
- workspace/list result：{list,total(=86),pagesize,pagenumber,total_page,...}，单页 100 覆盖全部；chapter/list 有 chapter_count、shot/list 有 shot_count —— fetch_ws 已带"返回数<声明数→⚠截断告警"
- 版本对象 `size` 字段是**分辨率**（"2560x1440"）不是字节数！文件完整性靠 curl 退出码（非零=中断/HTTP错）+ mp4 ftyp 魔数 + SHA-256 指纹，别拿 size 比字节
- slot 版本对象比 shot/list 多出的字段：out_trade_no/task_id/model_key/is_starred_video(收藏)/style_*/source_image_media_id/gen_param_name/model_resolution 等——将来要收藏标记或任务号，从这个接口取

## 关键教训
- 模板字符串（反引号）内 `\?`/`\1` 等属**非法转义**，JS 会静默丢弃反斜杠 → 正则注入后变 `(?:? )` 炸成 SyntaxError。模板里要写正则就改用 `split('?')[0]` 或转义为 `\\?`
- Node `fs.mkdirSync(recursive:true)` 在 SMB/NAS 上**中间祖先 stat 不可靠**：rename 旧目录后立即建同名深层目录会持续 ENOENT（数分钟，非瞬时）且重试再多次也不稳定——Node 元数据缓存与 Windows 内核/SMB 不一致。根治：`ensureDir()` 逐级单层 mkdir + ENOENT 轮询等待父可见（每级 ≤40×500ms）。build/repair 已用
- SMB 目录树不要整树 `rename→重建` 做"刷新"：改名后旧句柄未释放，立即可写子目录类操作被随机 ENOENT 击中。改"直接幂等覆盖写入最终路径"，建子目录仅 ensureDir、同名文件 copyFileSync 覆盖，残留垃圾文件交给后续清理（diagnose 以期望集为准，多余文件不影响对账）
- 只读对账工具应独立存活：audit_manifest.js(pre-run 边界体检)、check_ref_match.js(提示词图N/音频N↔文件名一致性，P6 验收逻辑防回归)、probe_err_shape/probe_ok_shape(探测信封)——均幂等只读可复跑
- 模板字符串内 Edit 必须匹配真实缩进（否则静默不生效）
- CDP 强杀连接→页面渲染进程死锁→重启 Chrome 实例（保 `.chrome-cdp-profile` 登录态）
- promise map 存/解构字段名不一致会 TypeError
- 导航页面会触发 `save_prompt_batch`，但只读账号被服务端拒写，数据零改动
- NAS(SMB) 元数据操作偶发 EPERM/ENOTEMPTY：mkdir/copy/rename/rm 全部带退避重试；不要硬删旧目录，改名挪走最后清理；构建先落 staging 再 rename 就位
- **SMB 事故教训（差点丢数据）**：① 目录 rename 可能持续 EPERM 数分钟（句柄未释放）；② PS Move-Item 在 SMB 上可能退化成逐文件复制，中断时报错但已复制大半；③ 此时 Remove-Item 源目录=毁掉未复制部分。铁律：**删源前必须按期望清单对账数量**。定点补建用 repair_tree.js（幂等，只补缺失）
- 一次重构丢 path.join(SRC) 导致相对路径全 miss——重构后必须抽查产物计数
- PS5.1：New-Item 无 -LiteralPath；方括号路径一律 -LiteralPath
