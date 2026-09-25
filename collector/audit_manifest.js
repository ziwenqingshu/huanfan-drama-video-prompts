// 只读审计：对已有 manifest.json 检查全量前的边界假设是否成立
// 用法: node audit_manifest.js <workspaceKey>
const fs = require('fs'), path = require('path');
const BASE = 'Z:\\幻帧采集';
const key = process.argv[2] || 'ws1948';
const mf = JSON.parse(fs.readFileSync(path.join(BASE, key, 'manifest.json'), 'utf8'));

const st = {
  versions: 0, ok_versions: 0, error_versions: 0, no_url_not_error: 0,
  version_no_null: 0, shot_no_null: 0, shot_no_zero: 0,
  mentions_fallback: 0, both_empty: 0,
  resolved_type_null: 0, resolved_label_null: 0, resolved_no_name: 0,
  err_url_with_query: 0, err_url_other: 0,
  url_query_params: new Set(), prompt_used_empty: 0,
  chapter_name_dup: 0, chapter_name_null: 0, dup_media_id: 0,
  audio_mentions: 0, type_other: 0
};
const mediaSeen = new Set();
const chNames = new Map();
for (const ch of mf.chapters) {
  if (!ch.chapter_name) st.chapter_name_null++;
  const k = String(ch.chapter_name || '');
  chNames.set(k, (chNames.get(k) || 0) + 1);
  for (const sh of ch.shots) {
    if (sh.shot_no == null) st.shot_no_null++;
    if (sh.shot_no === 0) st.shot_no_zero++;
    for (const v of sh.versions) {
      st.versions++;
      if (v.version_no == null) st.version_no_null++;
      if (mediaSeen.has(v.media_id)) st.dup_media_id++;
      mediaSeen.add(v.media_id);
      if (v.is_error) st.error_versions++;
      else if (v.file_url) st.ok_versions++;
      else st.no_url_not_error++; // 生成中/无url非失败 → 会被静默跳过
      if (!v.file_url && !v.is_error) { /* counted */ }
      if (v.is_error && v.file_url) { st.err_url_other++; } // fetch 已置 null，理论不出现
      if (v.file_url && v.file_url.includes('?')) st.url_query_params.add(v.file_url.split('?')[1].split('&').map(p => p.split('=')[0]).sort().join(','));
      if (!v.prompt_used) st.prompt_used_empty++;
      const rm = v.resolved_mentions || [], mn = v.mentions || [];
      if (!rm.length && mn.length) st.mentions_fallback++;
      if (!rm.length && !mn.length) st.both_empty++;
      for (const m of rm) {
        if (m.resource_type === 'audio') st.audio_mentions++;
        else if (m.resource_type !== 'image') st.type_other++;
        if (!m.resource_type) st.resolved_type_null++;
        if (!m.label) st.resolved_label_null++;
        if (!m.name) st.resolved_no_name++;
      }
    }
  }
}
for (const [n, c] of chNames) if (c > 1 && n) st.chapter_name_dup += c - 1;
console.log(JSON.stringify({
  ...st, url_query_params: [...st.url_query_params],
  ws_name: mf.workspace_name, ws_total: mf.ws_total
}, null, 1));
