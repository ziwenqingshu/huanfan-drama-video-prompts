const fs = require('fs');
const path = require('path');

const BASE = process.env.FANTAFRAME_ROOT || 'Z:\\幻帧采集';
const wait = new Int32Array(new SharedArrayBuffer(4));

function sleep(ms) { Atomics.wait(wait, 0, 0, ms); }
function retry(fn, label) {
  let last;
  for (let i = 0; i < 8; i++) {
    try { return fn(); } catch (e) {
      last = e;
      if (!['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'ENOENT'].includes(e.code)) throw e;
      sleep(250 * (i + 1));
    }
  }
  throw new Error(`${label}: ${last && last.code} ${last && last.message}`);
}
function ensureDir(dir) {
  const parts = path.resolve(dir).split(path.sep).filter(Boolean);
  let cur = parts[0] + path.sep;
  for (const part of parts.slice(1)) {
    cur = path.join(cur, part);
    retry(() => { try { fs.mkdirSync(cur); } catch (e) { if (e.code !== 'EEXIST') throw e; } }, `mkdir ${cur}`);
  }
}
function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  retry(() => fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8'), `write ${path.basename(file)}`);
  retry(() => fs.renameSync(tmp, file), `rename ${path.basename(file)}`);
}
function writeTextAtomic(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  retry(() => fs.writeFileSync(tmp, text, 'utf8'), `write ${path.basename(file)}`);
  retry(() => fs.renameSync(tmp, file), `rename ${path.basename(file)}`);
}
function removeIfExists(file) {
  if (fs.existsSync(file)) retry(() => fs.unlinkSync(file), `unlink ${path.basename(file)}`);
}
function safeName(value, length = 30) {
  return String(value || '').replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').trim().slice(0, length);
}
function promptText(version) { return ((version.prompt_used || '').trim() || '(提示词为空)') + '\n'; }
function extensionOf(url, fallback = 'bin') {
  const match = /\.([a-z0-9]{2,8})$/i.exec(String(url || '').split('?')[0]);
  return match ? match[1].toLowerCase() : fallback;
}
function mentionList(version, type) {
  const source = version.resolved_mentions && version.resolved_mentions.length ? version.resolved_mentions : (version.mentions || []);
  return source.filter(m => m && m.url && m.resource_type === type).map(m => ({
    rid: m.resource_id != null ? String(m.resource_id) : (m.asset_id != null ? String(m.asset_id) : `u_${String(m.url).replace(/[^a-z0-9]/gi, '').slice(-16)}`),
    label: m.label || m.insertId || null,
    name: m.name || null,
    url: m.url,
    type
  }));
}
function uniqueMentions(version) {
  const out = [];
  for (const type of ['image', 'audio']) {
    const seen = new Map();
    for (const m of mentionList(version, type)) if (m.label) seen.set(`${type}|${m.label}|${m.rid}`, m);
    out.push(...seen.values());
  }
  return out;
}
function assetExtensionIndex(manifest) {
  const out = new Map();
  for (const chapter of manifest.chapters || []) for (const shot of chapter.shots || []) for (const version of shot.versions || []) {
    if (version.is_error || !version.file_url) continue;
    for (const mention of uniqueMentions(version)) if (!out.has(mention.rid)) out.set(mention.rid, extensionOf(mention.url, mention.type === 'audio' ? 'mp3' : 'bin'));
  }
  return out;
}
function projectRoot(manifest) { return path.join(BASE, `${safeName(manifest.workspace_name, 60) || manifest.workspace_id}[${manifest.workspace_id}]`); }
function metadataDir(manifest) { return path.join(projectRoot(manifest), '_元数据'); }
function assetsDir(manifest) { return path.join(projectRoot(manifest), '_引用素材'); }
function versionDir(manifest, chapter, shot, version) {
  const text = String(shot.shot_text || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  const shotName = `分镜${String(shot.shot_no).padStart(2, '0')}${text ? `_${safeName(text)}` : ''}_shot${shot.shot_id}`;
  const versionNo = version.version_no != null ? version.version_no : 'x';
  return path.join(projectRoot(manifest), safeName(chapter.chapter_name) || '未知集', shotName, `v${versionNo}${version.is_selected ? '_选中' : '_历史'}_${version.media_id}`);
}
function videoPath(manifest, chapter, shot, version) { return path.join(versionDir(manifest, chapter, shot, version), `${version.media_id}_视频.mp4`); }
function promptPath(manifest, chapter, shot, version) { return path.join(versionDir(manifest, chapter, shot, version), `${version.media_id}_提示词.txt`); }
function refsPath(manifest, chapter, shot, version) { return path.join(versionDir(manifest, chapter, shot, version), '引用素材.json'); }
// 同一 resource_id 在不同版本的展示名可能不同；路径只由稳定 ID 决定。
function assetPath(manifest, mention, extensions) { return path.join(assetsDir(manifest), `asset_${mention.rid}.${extensions && extensions.get(mention.rid) || extensionOf(mention.url, mention.type === 'audio' ? 'mp3' : 'bin')}`); }
function isMp4(file) {
  try {
    if (fs.statSync(file).size < 12) return false;
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(8);
    try { fs.readSync(fd, b, 0, 8, 0); } finally { fs.closeSync(fd); }
    return b.toString('latin1', 4, 8) === 'ftyp';
  } catch { return false; }
}
function nonEmpty(file) { try { return fs.statSync(file).size > 0; } catch { return false; } }

module.exports = { BASE, retry, ensureDir, writeJsonAtomic, writeTextAtomic, removeIfExists, safeName, promptText, extensionOf, uniqueMentions, assetExtensionIndex, projectRoot, metadataDir, assetsDir, versionDir, videoPath, promptPath, refsPath, assetPath, isMp4, nonEmpty };
