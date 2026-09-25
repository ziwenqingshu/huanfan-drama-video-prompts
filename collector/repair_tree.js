const fs = require('fs'), path = require('path');
const BASE = 'Z:\\幻帧采集';
const key = process.argv[2] || 'ws1948';
const SRC = path.join(BASE, key);
const mf = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const refIdx = JSON.parse(fs.readFileSync(path.join(SRC, 'ref_index.json'), 'utf8'));
const assetFile = new Map(refIdx.map(a => [String(a.rid), path.join(SRC, a.file)]));
function san(s){ return String(s||'').replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 30); }
const wsId = String(mf.workspace_id || key.replace(/^ws/, ''));
const ROOT = path.join(BASE, san(mf.workspace_name) + '[' + wsId + ']');
function retry(fn, label) {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if ((e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'ENOTEMPTY' || e.code === 'EBUSY' || e.code === 'ENOENT') && i < 8) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (i + 1)); continue; }
      throw new Error(label + ': ' + e.code + ' ' + e.message);
    }
  }
}
const w8 = new Int32Array(new SharedArrayBuffer(4));
function ensureDir(p) {
  const parts = path.resolve(p).split(path.sep).filter(Boolean);
  let cur = parts[0] + path.sep;
  for (const seg of parts.slice(1)) {
    cur = path.join(cur, seg);
    let ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      try { fs.mkdirSync(cur); ok = true; }
      catch (e) { if (e.code === 'EEXIST') { ok = true; } else if (e.code !== 'ENOENT') { throw e; } else { Atomics.wait(w8, 0, 0, 500); } }
    }
    if (!ok) throw new Error('ensureDir 超时: ' + cur);
  }
}
const mkdir = ensureDir;
const copy = (s, d) => retry(() => fs.copyFileSync(s, d), 'copy ' + path.basename(d));
function normM(v, t){
  const src = (v.resolved_mentions && v.resolved_mentions.length) ? v.resolved_mentions : (v.mentions || []);
  return src.filter(m => m && m.url && m.resource_type === t).map(m => ({
    rid: m.resource_id != null ? String(m.resource_id) : (m.asset_id != null ? String(m.asset_id) : 'u_' + String(m.url).replace(/[^a-z0-9]/gi, '').slice(-16)),
    label: m.label || m.insertId || null, name: m.name || null, url: m.url
  }));
}
function extA(url){ const p = String(url || '').split('?')[0]; const mm = /\.([a-z0-9]{2,5})$/i.exec(p); return '.' + (mm ? mm[1].toLowerCase() : 'mp3'); }

let fixed = 0;
for (const ch of mf.chapters) for (const sh of ch.shots) for (const v of sh.versions) {
  if (v.is_error || !v.file_url) continue;
  const media = String(v.media_id);
  const vNo = v.version_no != null ? v.version_no : 'x';
  const txt = String(sh.shot_text || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  const vD = path.join(ROOT, san(ch.chapter_name) || '未知集', '分镜' + String(sh.shot_no).padStart(2, '0') + (txt ? '_' + san(txt) : '') + '_shot' + sh.shot_id, 'v' + vNo + (v.is_selected?'_选中':'_历史') + '_' + media);
  // 视频
  const dstV = path.join(vD, media + '_视频.mp4');
  if (!fs.existsSync(dstV)) { mkdir(vD); copy(path.join(SRC, 'raw', 'video', 'shot' + sh.shot_no + '_' + sh.shot_id, 'v' + vNo + '_' + media + '.mp4'), dstV); fixed++; }
  // 提示词
  const dstT = path.join(vD, media + '_提示词.txt');
  if (!fs.existsSync(dstT)) { mkdir(vD); retry(() => fs.writeFileSync(dstT, ((v.prompt_used || '').trim() || '(提示词为空)') + '\n', 'utf8'), 'write txt'); fixed++; }
  // 引用图
  const seen = new Map();
  for (const m of normM(v, 'image')) if (m.label) seen.set(m.label+'|'+m.rid, m);
  for (const m of seen.values()) {
    const srcRef = assetFile.get(m.rid);
    const rel = '引用图\\' + m.label + '_' + san(m.name) + path.extname(srcRef || '.png');
    const dstR = path.join(vD, rel);
    if (!fs.existsSync(dstR) && srcRef && fs.existsSync(srcRef)) { mkdir(path.dirname(dstR)); copy(srcRef, dstR); fixed++; }
  }
  // 引用音频
  const seenA = new Map();
  for (const m of normM(v, 'audio')) if (m.label) seenA.set(m.label+'|'+m.rid, m);
  for (const m of seenA.values()) {
    const srcA = assetFile.get(m.rid);
    const rel = '引用音频\\' + m.label + '_' + san(m.name) + extA(m.url);
    const dstA = path.join(vD, rel);
    if (!fs.existsSync(dstA) && srcA && fs.existsSync(srcA)) { mkdir(path.dirname(dstA)); copy(srcA, dstA); fixed++; }
  }
}
console.log('补建文件数: ' + fixed);
