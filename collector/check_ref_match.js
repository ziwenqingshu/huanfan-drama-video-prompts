// 只读：以平台返回的资源标签为准，校验旧成品的 图N/音频N 文件是否齐全。
const fs = require('fs'), path = require('path');
const key = process.argv[2] || 'ws1948';
const SRC = path.join('Z:\\幻帧采集', key);
const mf = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const san = s => String(s || '').replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 30);
const BASE = path.join('Z:\\幻帧采集', san(mf.workspace_name) + '[' + (mf.workspace_id || key.replace(/^ws/, '')) + ']');
function dirOf(ch, sh, v) {
  const txt = String(sh.shot_text || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  return path.join(BASE, san(ch.chapter_name) || '未知集', '分镜' + String(sh.shot_no).padStart(2, '0') + (txt ? '_' + san(txt) : '') + '_shot' + sh.shot_id, 'v' + (v.version_no != null ? v.version_no : 'x') + (v.is_selected ? '_选中' : '_历史') + '_' + v.media_id);
}
function labels(v, type) {
  const source = v.resolved_mentions && v.resolved_mentions.length ? v.resolved_mentions : (v.mentions || []);
  return [...new Set(source.filter(m => m && m.resource_type === type && (m.label || m.insertId)).map(m => m.label || m.insertId))];
}
let expected = 0, bad = 0, textWarnings = 0;
for (const ch of mf.chapters) for (const sh of ch.shots) for (const v of sh.versions) {
  if (v.is_error || !v.file_url) continue;
  const dir = dirOf(ch, sh, v);
  let names = [];
  try { names = fs.readdirSync(dir).flatMap(d => /^引用(图|音频)$/.test(d) ? fs.readdirSync(path.join(dir, d)).map(f => `${d}/${f}`) : [d]); }
  catch { bad++; if (bad <= 5) console.log('版本目录缺失', ch.chapter_name, sh.shot_id, v.media_id); continue; }
  for (const [type, folder] of [['image', '引用图'], ['audio', '引用音频']]) for (const label of labels(v, type)) {
    expected++;
    if (!names.some(n => n.startsWith(`${folder}/${label}_`))) { bad++; if (bad <= 5) console.log('资源失配', ch.chapter_name, sh.shot_id, v.media_id, label); }
  }
  try {
    const text = fs.readFileSync(path.join(dir, `${v.media_id}_提示词.txt`), 'utf8');
    const known = new Set([...labels(v, 'image'), ...labels(v, 'audio')]);
    for (const m of text.matchAll(/(?:图|音频)\s*([0-9]+)/g)) if (!known.has(m[0].replace(/\s+/g, ''))) textWarnings++;
  } catch { bad++; }
}
console.log(`平台资源标签 ${expected} | 文件失配 ${bad} | 提示词未映射文本标记(仅警告) ${textWarnings}`);
process.exitCode = bad ? 1 : 0;
