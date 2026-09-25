// 构建中文目录树（读 manifest + ref_index → <剧名>[<id>]\集\分镜NN_文本_shotID\vN_选中|历史_<media>\{视频,提示词,引用图,引用音频}）
// 用法: node build_tree_ws.js <workspaceKey>   （默认 ws1948）
// 幂等直写最终目录；旧目录改名 _trash_ 挪走（SMB 删除延迟），收尾尽力清理
const fs = require('fs'), path = require('path');
const BASE = 'Z:\\幻帧采集';
const key = process.argv[2] || 'ws1948';
const SRC = path.join(BASE, key);
function retry(fn, label) {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if ((e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'ENOTEMPTY' || e.code === 'EBUSY' || e.code === 'ENOENT') && i < 8) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (i + 1)); continue; }
      throw new Error(label + ': ' + e.code + ' ' + e.message);
    }
  }
}
// SMB 上 Node mkdirSync recursive 的中间祖先 stat 不可靠（父句柄延迟→持续 ENOENT）。
// 改为逐级单层 mkdir + ENOENT 轮询等待父可见，直到成功或超时。ESLint 规避：空 catch。
const w8 = new Int32Array(new SharedArrayBuffer(4));
function ensureDir(p) {
  const parts = path.resolve(p).split(path.sep).filter(Boolean);
  let cur = parts[0] + path.sep; // 'Z:\'
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
// 幂等复制：目标已存在且大小与源一致则跳过（避免覆盖被第三方进程占用的目标 → EBUSY，也省无谓 IO）；否则覆盖
function copy(s, d) {
  try {
    if (fs.existsSync(d) && fs.statSync(d).size === fs.statSync(s).size) return 'kept';
  } catch (e) { /* 落到下方覆盖 */ }
  return retry(() => fs.copyFileSync(s, d), 'copy ' + path.basename(d));
}
const writeTxt = (d, s) => retry(() => fs.writeFileSync(d, s, 'utf8'), 'write ' + path.basename(d));
const valid = f => fs.existsSync(f) && fs.statSync(f).size > 0;
function san(s){ return String(s||'').replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 30); }
// 归一化引用资产：优先 resolved_mentions，空则退回 mentions；rid/label 规则与 ref_dl 一致，保证 assetFile 命中
function normM(v){
  const src = (v.resolved_mentions && v.resolved_mentions.length) ? v.resolved_mentions : (v.mentions || []);
  return src.filter(m => m && m.url && m.resource_type === 'image').map(m => ({
    rid: m.resource_id != null ? String(m.resource_id) : (m.asset_id != null ? String(m.asset_id) : 'u_' + String(m.url).replace(/[^a-z0-9]/gi, '').slice(-16)),
    label: m.label || m.insertId || null, name: m.name || null, url: m.url
  }));
}
function normA(v){ // 音频同构（不占 image）
  const src = (v.resolved_mentions && v.resolved_mentions.length) ? v.resolved_mentions : (v.mentions || []);
  return src.filter(m => m && m.url && m.resource_type === 'audio').map(m => ({
    rid: m.resource_id != null ? String(m.resource_id) : (m.asset_id != null ? String(m.asset_id) : 'u_' + String(m.url).replace(/[^a-z0-9]/gi, '').slice(-16)),
    label: m.label || m.insertId || null, name: m.name || null, url: m.url
  }));
}
function extOf(url){ const p = String(url || '').split('?')[0]; const mm = /\.([a-z0-9]{2,5})$/i.exec(p); return mm ? '.' + mm[1].toLowerCase() : '.mp3'; }

const mf = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const refIdx = JSON.parse(fs.readFileSync(path.join(SRC, 'ref_index.json'), 'utf8'));
const assetFile = new Map(refIdx.map(a => [String(a.rid), path.join(SRC, a.file)]));
const wsId = String(mf.workspace_id || key.replace(/^ws/, ''));
// 不再整树 rename（SMB 句柄延迟会在 rename 后立即 mkdir 引发持续 ENOENT）。直接幂等写入目标路径，
// 同名已被 copyFileSync 覆盖；改名产生的旧文件残留对 diagnose(期望集为准) 无影响，P9 对账仍可靠。
const FINAL = path.join(BASE, san(mf.workspace_name) + '[' + wsId + ']');

let vCnt = 0, gCnt = 0, aCnt = 0, miss = [];
for (const ch of mf.chapters) {
  const chDir = path.join(FINAL, san(ch.chapter_name) || '未知集');
  for (const sh of ch.shots) {
    const txt = (sh.shot_text || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    const shDir = path.join(chDir, '分镜' + String(sh.shot_no).padStart(2, '0') + (txt ? '_' + san(txt) : '') + '_shot' + sh.shot_id);
    for (const v of sh.versions) {
      if (v.is_error || !v.file_url) continue;
      const media = String(v.media_id);
      const vNo = v.version_no != null ? v.version_no : 'x';
      const vD = path.join(shDir, 'v' + vNo + (v.is_selected ? '_选中' : '_历史') + '_' + media);
      mkdir(vD);
      const srcVid = path.join(SRC, 'raw', 'video', 'shot' + sh.shot_no + '_' + sh.shot_id, 'v' + vNo + '_' + media + '.mp4');
      if (valid(srcVid)) { copy(srcVid, path.join(vD, media + '_视频.mp4')); vCnt++; } else miss.push('视频 ' + media);
      const body = (v.prompt_used || '').trim() || '(提示词为空)';
      writeTxt(path.join(vD, media + '_提示词.txt'), body + '\n');
      const seen = new Map();
      for (const m of normM(v)) if (m.label) seen.set(m.label + '|' + m.rid, m);
      const refDir = path.join(vD, '引用图');
      for (const m of seen.values()) {
        const srcRef = assetFile.get(m.rid);
        if (srcRef && valid(srcRef)) { mkdir(refDir); copy(srcRef, path.join(refDir, m.label + '_' + san(m.name) + path.extname(srcRef))); gCnt++; }
        else miss.push('引用图 ' + m.label + ' rid=' + m.rid);
      }
      // 引用音频：扩展名以资产 URL 为准（mp3/wav…），不猜
      const seenA = new Map();
      for (const m of normA(v)) if (m.label) seenA.set(m.label + '|' + m.rid, m);
      for (const m of seenA.values()) {
        const srcA = assetFile.get(m.rid);
        const ext = extOf(m.url);
        if (srcA && valid(srcA)) { mkdir(path.join(vD, '引用音频')); copy(srcA, path.join(vD, '引用音频', m.label + '_' + san(m.name) + ext)); aCnt++; }
        else miss.push('引用音频 ' + m.label + ' rid=' + m.rid);
      }
    }
  }
}
console.log(`构建完成 视频=${vCnt} 引用图=${gCnt} 引用音频=${aCnt} 缺失=${miss.length} → ${FINAL}`);
if (miss.length) console.log(miss.slice(0, 10).join('\n'));
// 尽力清理历史 _trash_（SMB 可能拒绝，留着不碍事，下次再清）
const trashPrefix = san(mf.workspace_name) + '[' + wsId + ']_trash_';
for (const t of fs.readdirSync(BASE).filter(n => n.startsWith(trashPrefix))) {
  try { retry(() => fs.rmSync(path.join(BASE, t), { recursive: true, force: true }), 'rm trash'); console.log('已清理 ' + t); }
  catch (e) { console.log('暂留(下次再清): ' + t); }
}