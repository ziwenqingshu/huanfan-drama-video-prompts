// 并行下载器 v3：修复 v2 的 4 个缺陷
// 1. 实时断点清单：每完成一条就即时更新 manifest_result.json（增量落账），崩溃后重跑可精确续点
// 2. hash 异步化：用 createReadStream 流式计算，不阻塞主线程事件循环；默认开启，可用 --nohash 关闭
// 3. ensureDir 逐级单层 mkdir：彻底避开 mkdirSync(recursive) 在 SMB 上的 ENOENT/EPERM
// 4. 失败实时登记：失败即写 dl_failed.json，不含"已存在"账目；结束时不再覆盖
// 用法: node dl_ws3.js <workspaceKey> [concurrency] [--nohash]
// 幂等：已存在且 ftyp 通过则跳过；失败自动重试2次；并发3默认可调1-6
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createHash } = require('crypto');
const BASE = 'Z:\\幻帧采集';

// SMB 上 mkdirSync(recursive) 的中间祖先 stat 不可靠，改逐级单层 mkdir + ENOENT 轮询
const w8 = new Int32Array(new SharedArrayBuffer(4));
function ensureDir(p) {
  const parts = path.resolve(p).split(path.sep).filter(Boolean);
  let cur = parts[0] + path.sep;
  for (const seg of parts.slice(1)) {
    cur = path.join(cur, seg);
    let ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      try { fs.mkdirSync(cur); ok = true; }
      catch (e) {
        if (e.code === 'EEXIST') ok = true;
        else if (e.code !== 'ENOENT') throw e;
        else Atomics.wait(w8, 0, 0, 500);
      }
    }
    if (!ok) throw new Error('ensureDir 超时: ' + cur);
  }
}

function isMp4(p) {
  try {
    const b = Buffer.alloc(12); const fd = fs.openSync(p, 'r');
    try { fs.readSync(fd, b, 0, 12, 0); } finally { fs.closeSync(fd); }
    return b.toString('latin1', 4, 8) === 'ftyp';
  } catch (e) { return false; }
}
// 异步流式 SHA-256，不阻塞主线程；大文件期间让 curl worker 仍可调度
function sha256Async(p) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', d => h.update(d));
    s.on('error', rej);
    s.on('end', () => res(h.digest('hex')));
  });
}
function curl(url, dest, timeoutMs) {
  return new Promise(res => {
    ensureDir(path.dirname(dest));
    const child = spawn('curl.exe', ['-L', '-s', '--fail', '-o', dest, '--max-time', String(Math.floor(timeoutMs / 1000)), url], { stdio: 'ignore' });
    const t = setTimeout(() => { try { child.kill(); } catch (e) {} }, timeoutMs + 5000);
    child.on('close', code => {
      clearTimeout(t);
      const ok = code === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0 && isMp4(dest);
      res(ok ? 'ok' : 'fail');
    });
    child.on('error', () => { clearTimeout(t); res('fail'); });
  });
}
function cleanName(s) { return String(s || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60); }
function writeJSON(p, obj) {
  // 静态写入：避免并发写同一文件冲突，每一瞬由单个调用方使用；SMB 瞬时错误重试3次
  const tmp = p + '.tmp';
  const data = JSON.stringify(obj, null, 1);
  for (let t = 0; t < 3; t++) {
    try {
      fs.writeFileSync(tmp, data, 'utf8');
      fs.renameSync(tmp, p);
      return true;
    } catch (e) {
      if (t === 2) { console.error('写文件失败(3次): ' + p + ' : ' + e.message); return false; }
      Atomics.wait(w8, 0, 0, 600);
    }
  }
}

async function main() {
  const key = process.argv[2];
  if (!key) { console.error('用法: node dl_ws3.js <workspaceKey> [concurrency] [--nohash]'); process.exit(1); }
  const CONC = Math.max(1, Math.min(6, parseInt(process.argv[3] || '3', 10)));
  const NOHASH = process.argv.includes('--nohash');
  const dir = path.join(BASE, key);
  const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

  const RESULT_FILE = path.join(dir, 'manifest_result.json');
  const FAIL_FILE = path.join(dir, 'dl_failed.json');
  // 若既往已有账本，先读入用于幂等续点（保留之前 ok/kept 记录）
  let ledger = [];
  if (fs.existsSync(RESULT_FILE)) {
    try { ledger = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8')); } catch (e) { ledger = []; }
    if (!Array.isArray(ledger)) ledger = [];
  }
  // 合并已存在(fytp)为 kept（不重复 hash），并收集待下
  const jobs = [];
  let skipped = 0;
  for (const ch of mf.chapters) for (const sh of ch.shots) {
    const shotDirOk = cleanName('shot' + sh.shot_no + '_' + sh.shot_id);
    for (const v of sh.versions) {
      if (v.is_error || !v.file_url) { skipped++; continue; }
      const vTag = cleanName('v' + (v.version_no != null ? v.version_no : 'x') + '_' + v.media_id);
      const dest = path.join(dir, 'raw', 'video', shotDirOk, vTag + '.mp4');
      jobs.push({ media_id: v.media_id, shot_id: sh.shot_id, version_no: v.version_no, url: v.file_url, dest });
    }
  }
  // 账本里已经是 ok/kept 的标记
  const beenOK = new Set();
  for (const r of ledger) if (r.status === 'ok' || r.status === 'kept') beenOK.add(r.dest_video);
  const pend = [];
  const keep = [];
  for (const j of jobs) {
    const already = beenOK.has(j.dest) || (fs.existsSync(j.dest) && fs.statSync(j.dest).size > 0 && isMp4(j.dest));
    (already ? keep : pend).push(j);
  }
  // keep 不动 hash（避免批量阻塞），只补为 kept 到账本
  for (const j of keep) {
    if (!ledger.some(r => r.dest_video === j.dest)) {
      ledger.push({ media_id: j.media_id, shot_id: j.shot_id, version_no: j.version_no, url: j.url, dest_video: j.dest, status: 'kept', sha256: null });
    }
  }

  console.log(`[${mf.workspace_name}] 待处理=${pend.length} 已存在跳过=${keep.length} 其他跳过=${skipped} 并发=${CONC} hash=${NOHASH?'关':'开'}`);

  let idx = 0, done = 0;
  const worker = async () => {
    for (;;) {
      const j = pend[idx++];
      if (!j) return;
      let status = 'fail';
      for (let attempt = 0; attempt < 3 && status !== 'ok'; attempt++) {
        if (attempt > 0 && fs.existsSync(j.dest)) { try { fs.unlinkSync(j.dest); } catch (e) {} }
        status = await curl(j.url, j.dest, 90000);
      }
      let hash = null, status2 = status;
      if (status !== 'fail' && !NOHASH) {
        try { hash = await sha256Async(j.dest); }
        catch (e) { status2 = 'hash_failed'; } // 哈希失败单独标记，不算下载成功
      }
      // 实时落账：先移除同 dest_video 的旧记录（含此前 fail 残留在重试成功后），再 push 新记录 → 账本唯一
      for (let i = ledger.length - 1; i >= 0; i--) if (ledger[i].dest_video === j.dest) ledger.splice(i, 1);
      ledger.push({ media_id: j.media_id, shot_id: j.shot_id, version_no: j.version_no, url: j.url, dest_video: j.dest, status: status2, sha256: hash });
      try { writeJSON(RESULT_FILE, ledger); } catch (e) { console.error('账本落盘失败(继续重试措施见下): ' + e.message); }
      // 失败即时写 dl_failed.json（含 hash_failed，保证可独立核实运行中失败）
      const curFailed = ledger.filter(r => r.status === 'fail' || r.status === 'hash_failed');
      if (curFailed.length) { try { writeJSON(FAIL_FILE, curFailed); } catch (e) {} }
      else if (fs.existsSync(FAIL_FILE)) { try { fs.unlinkSync(FAIL_FILE); } catch (e) {} }
      done++;
      if (done % 10 === 0 || done === pend.length || status2 !== 'ok') {
        console.log(`进度 ${done}/${pend.length} (ok=${ledger.filter(r => r.status === 'ok').length} keep=${ledger.filter(r => r.status === 'kept').length} fail=${ledger.filter(r => r.status === 'fail').length} hashfail=${ledger.filter(r => r.status === 'hash_failed').length})`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));

  const ok = ledger.filter(r => r.status === 'ok').length;
  const kept = ledger.filter(r => r.status === 'kept').length;
  const failed = ledger.filter(r => r.status === 'fail');
  const hashFailed = ledger.filter(r => r.status === 'hash_failed');
  console.log(`下载完成 [${mf.workspace_name}]: 新下=${ok} 已存在=${kept} 失败=${failed.length} 哈希失败=${hashFailed.length} 跳过=${skipped}`);
  if (failed.length || hashFailed.length) console.log('失败清单: ' + FAIL_FILE);
}
main().catch(e => { console.error('错误: ' + e.message); process.exit(1); });