// 引用资产下载（图+音频）：聚合 manifest 去重 → raw/ref 中心库 + ref_index.json（含 SHA-256）
// 用法: node ref_dl.js <workspaceKey>
// 幂等：已存在非空文件跳过；resolved_mentions 为空时退回 mentions 兜底（asset_id/insert_id 字段名不同）
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const BASE = 'Z:\\幻帧采集';

function sha256(p) { const h = createHash('sha256'); h.update(fs.readFileSync(p)); return h.digest('hex'); }
function curl(url, dest, timeoutMs) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return 'kept';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    execFileSync('curl.exe', ['-L', '-s', '--fail', '-o', dest, '--max-time', String(Math.floor((timeoutMs || 60000) / 1000)), url], { stdio: 'ignore' });
  } catch (e) {}
  return (fs.existsSync(dest) && fs.statSync(dest).size > 0) ? 'ok' : 'fail';
}
function cleanName(s){ return String(s||'').replace(/[\\/:*?"<>\r\n|]/g, '_').trim().slice(0,50) || 'unnamed'; }
function extOf(url){ // 扩展名永远以 URL 为准（此前音频被存成 .png 的事故根源）
  const p = String(url || '').split('?')[0];
  const m = /\.([a-z0-9]{2,5})$/i.exec(p);
  return m ? m[1].toLowerCase() : 'bin';
}
function normMentions(v) {
  const src = (v.resolved_mentions && v.resolved_mentions.length) ? v.resolved_mentions : (v.mentions || []);
  return src.filter(m => m && m.url).map(m => ({
    type: m.resource_type || null,
    rid: m.resource_id != null ? String(m.resource_id) : (m.asset_id != null ? String(m.asset_id) : 'u_' + String(m.url).replace(/[^a-z0-9]/gi, '').slice(-16)),
    label: m.label || m.insertId || null,
    name: m.name || null, url: m.url
  }));
}

async function main() {
  const key = process.argv[2];
  if (!key) { console.error('用法: node ref_dl.js <workspaceKey>'); process.exit(1); }
  const dir = path.join(BASE, key);
  const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const assets = new Map();
  let fallbackUsed = 0;
  for (const ch of mf.chapters) for (const sh of ch.shots) for (const v of sh.versions) {
    if (!(v.resolved_mentions && v.resolved_mentions.length) && (v.mentions && v.mentions.length)) fallbackUsed++;
    for (const m of normMentions(v)) {
      if (!assets.has(m.rid)) assets.set(m.rid, { rid: m.rid, name: m.name || cleanName(m.url), url: m.url, type: m.type, labels: new Set() });
      if (m.label) assets.get(m.rid).labels.add(m.label);
    }
  }
  const refDir = path.join(dir, 'raw', 'ref');
  fs.mkdirSync(refDir, { recursive: true });
  const arr = [...assets.values()];
  console.log('去重后引用资产: ' + arr.length + (fallbackUsed ? `（${fallbackUsed} 个版本走 mentions 兜底）` : ''));
  const assetList = [];
  let ok = 0, kept = 0, fail = 0, i = 0;
  for (const a of arr) {
    i++;
    const fname = 'asset_' + a.rid + '__' + cleanName(a.name) + '.' + extOf(a.url);
    const dest = path.join(refDir, fname);
    const status = curl(a.url, dest, 300000);
    if (status === 'fail') fail++; else if (status === 'kept') kept++; else ok++;
    assetList.push({ rid: a.rid, name: a.name, type: a.type, file: status !== 'fail' ? ('raw\\ref\\' + fname) : null,
      sha256: status !== 'fail' ? sha256(dest) : null, url: a.url, labels: [...a.labels] });
    if (i % 10 === 0 || i === arr.length) console.error(`引用资产 ${i}/${arr.length} (新下${ok} 跳过${kept} 失败${fail})`);
  }
  fs.writeFileSync(path.join(dir, 'ref_index.json'), JSON.stringify(assetList, null, 1), 'utf8');
  console.log(`引用资产完成: 新下=${ok} 已存在=${kept} 失败=${fail}`);
  if (fail) { console.error('失败资产: ' + assetList.filter(a => !a.file).map(a => a.rid).join(', ')); process.exit(1); }
}
main().catch(e => { console.error('错误: ' + e.message); process.exit(1); });