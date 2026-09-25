# 幻帧采集器 v4

新项目唯一允许的链路：

```text
fetch_manifest_replay → collect_project → verify_project → COMPLETE.json
```

- `fetch_manifest_replay.js` 仅重放 Chrome 已认证请求，不读取令牌、Cookie 或认证头。
- `collect_project.js` 直接写入真实项目名目录；视频使用 `.part` 校验后原子改名；每条结果即时落账。
- `_引用素材` 按资源 ID 只保存一次；各版本的 `引用素材.json` 记录图/音频标签到相对路径的映射。
- `verify_project.js` 校验视频、提示词、素材映射、素材文件及失败账本；仅全绿才写 `_元数据/COMPLETE.json`。

目录结构：

```text
剧名[ID]/
  _元数据/{manifest.json,download_state.json,failed.json,COMPLETE.json}
  _引用素材/asset_<资源ID>.<ext>
  集/分镜/v版本_media/
    media_视频.mp4
    media_提示词.txt
    引用素材.json
```

`dl_ws3.js`、`ref_dl.js`、`build_tree_ws.js`、`repair_tree.js` 仅用于旧 raw 项目的救援，不得用于新项目。
