const fs = require('fs'), path = require('path');
const BASE = 'Z:\\幻帧采集';
const key = process.argv[2] || 'ws1948';
const SRC = path.join(BASE, key);
const mf = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const refIdx = JSON.parse(fs.readFileSync(path.join(SRC, 'ref_index.json'), 'utf8'));
const assetFile = new Map(refIdx.map(a => [String(a.rid), path.join(SRC, a.file)]));
function san(s){ return String(s||'').replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 30); }
function normM(v, t){ // t='image'|'audio'；优先 resolved_mentions，空则退回 mentions
  const src = (v.resolved_mentions && v.resolved_mentions.length) ? v.resolved_mentions : (v.mentions || []);
  return src.filter(m => m && m.url && m.resource_type === t).map(m => ({
    rid: m.resource_id != null ? String(m.resource_id) : (m.asset_id != null ? String(m.asset_id) : 'u_' + String(m.url).replace(/[^a-z0-9]/gi, '').slice(-16)),
    label: m.label || m.insertId || null, name: m.name || null, url: m.url
  }));
}
function extA(url){ const p = String(url || '').split('?')[0]; const mm = /\.([a-z0-9]{2,5})$/i.exec(p); return '.' + (mm ? mm[1].toLowerCase() : 'mp3'); }
const wsId = String(mf.workspace_id || key.replace(/^ws/, ''));
const ROOT = path.join(BASE, san(mf.workspace_name) + '[' + wsId + ']');

const expected = new Set(); const collisions = [];
for (const ch of mf.chapters) for (const sh of ch.shots) for (const v of sh.versions) {
  if (v.is_error || !v.file_url) continue;
  const media = String(v.media_id);
  const vNo = v.version_no != null ? v.version_no : 'x';
  const txt = String(sh.shot_text || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  const vD = path.join(ROOT, san(ch.chapter_name) || '未知集', '分镜' + String(sh.shot_no).padStart(2, '0') + (txt ? '_' + san(txt) : '') + '_shot' + sh.shot_id, 'v' + vNo + (v.is_selected?'_选中':'_历史') + '_' + media);
  expected.add(path.join(vD, media + '_视频.mp4'));
  expected.add(path.join(vD, media + '_提示词.txt'));
  const seen = new Map();
  for (const m of normM(v, 'image')) if (m.label) seen.set(m.label+'|'+m.rid, m);
  const local = new Map();
  for (const m of seen.values()) {
    const rel = '引用图\\' + m.label + '_' + san(m.name) + path.extname(assetFile.get(m.rid) || '.png');
    if (local.has(rel) && local.get(rel) !== m.rid) collisions.push(`${vD}\n  ${rel}: rid${local.get(rel)} 与 rid${m.rid} 同名互撞`);
    local.set(rel, m.rid);
    expected.add(path.join(vD, rel));
  }
  for (const m of normM(v, 'audio')) if (m.label) expected.add(path.join(vD, '引用音频\\' + m.label + '_' + san(m.name) + extA(m.url)));
}
let missing = [];
for (const p of expected) if (!fs.existsSync(p)) missing.push(p);
console.log(`期望文件 ${expected.size}，缺失 ${missing.length}，同名互撞 ${collisions.length}`);
if (collisions.length) console.log('互撞明细:\n' + collisions.join('\n'));
if (missing.length) console.log('缺失明细(前10):\n' + missing.slice(0, 10).map(p => p.substring(ROOT.length + 1)).join('\n'));
