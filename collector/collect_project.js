// 直接成品落盘：不建立 raw 视频层，不复制引用素材到版本目录。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ensureDir, writeJsonAtomic, writeTextAtomic, removeIfExists, projectRoot, metadataDir, versionDir, videoPath, promptPath, refsPath, assetPath, promptText, uniqueMentions, assetExtensionIndex, isMp4, nonEmpty } = require('./project_layout');
const { verifyProject, rootFor } = require('./verify_project');

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function curl(url, dest) {
  return new Promise(resolve => {
    ensureDir(path.dirname(dest));
    const part = `${dest}.part`; removeIfExists(part);
    const child = spawn('curl.exe', ['-L', '-s', '--fail', '--retry', '2', '--retry-all-errors', '--connect-timeout', '20', '--max-time', '300', '-o', part, url], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', code => {
      if (code !== 0 || !nonEmpty(part) || (path.extname(dest).toLowerCase() === '.mp4' && !isMp4(part))) return resolve(false);
      try { removeIfExists(dest); fs.renameSync(part, dest); resolve(true); } catch { resolve(false); }
    });
  });
}
async function pool(jobs, concurrency, fn) {
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { for (;;) { const job = jobs[index++]; if (!job) return; await fn(job); } }));
}
async function collect(root, concurrency = 3) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '_元数据', 'manifest.json'), 'utf8'));
  if (projectRoot(manifest) !== root) throw new Error('manifest 项目路径与实际目录不一致');
  const meta = metadataDir(manifest), stateFile = path.join(meta, 'download_state.json'), failFile = path.join(meta, 'failed.json'), completeFile = path.join(meta, 'COMPLETE.json');
  ensureDir(meta); removeIfExists(completeFile);
  const state = readJson(stateFile, { schema: 1, workspace_id: manifest.workspace_id, items: {} });
  if (!state.items || typeof state.items !== 'object') state.items = {};
  const saveState = () => { writeJsonAtomic(stateFile, state); const failed = Object.values(state.items).filter(x => x.status === 'fail'); if (failed.length) writeJsonAtomic(failFile, failed); else removeIfExists(failFile); };
  const assetExts = assetExtensionIndex(manifest), assets = new Map(), videos = [];
  for (const chapter of manifest.chapters) for (const shot of chapter.shots) for (const version of shot.versions) {
    if (version.is_error || !version.file_url) continue;
    videos.push({ key: `video:${version.media_id}`, url: version.file_url, dest: videoPath(manifest, chapter, shot, version), chapter, shot, version });
    for (const mention of uniqueMentions(version)) if (!assets.has(mention.rid)) assets.set(mention.rid, { ...mention, key: `asset:${mention.rid}`, dest: assetPath(manifest, mention, assetExts) });
  }
  const download = async job => {
    const valid = path.extname(job.dest).toLowerCase() === '.mp4' ? isMp4(job.dest) : nonEmpty(job.dest);
    if (valid) state.items[job.key] = { key: job.key, status: 'kept', dest: job.dest, bytes: fs.statSync(job.dest).size };
    else {
      const ok = await curl(job.url, job.dest);
      state.items[job.key] = { key: job.key, status: ok ? 'ok' : 'fail', dest: job.dest, bytes: ok ? fs.statSync(job.dest).size : null };
    }
    saveState();
  };
  console.log(`[${manifest.workspace_name}] 视频=${videos.length} 素材=${assets.size} 并发=${concurrency}`);
  await pool(videos, concurrency, download);
  await pool([...assets.values()], concurrency, download);
  for (const job of videos) {
    const dir = versionDir(manifest, job.chapter, job.shot, job.version);
    writeTextAtomic(promptPath(manifest, job.chapter, job.shot, job.version), promptText(job.version));
    const items = uniqueMentions(job.version).map(mention => ({ type: mention.type, label: mention.label, rid: mention.rid, asset: path.relative(dir, assetPath(manifest, mention, assetExts)).replace(/\\/g, '/') }));
    writeJsonAtomic(refsPath(manifest, job.chapter, job.shot, job.version), { schema: 1, items });
  }
  const result = verifyProject(root);
  console.log(JSON.stringify(result));
  if (!result.ok) { console.error('项目未完成：保留失败账本和 .part 文件供续跑'); process.exitCode = 1; return result; }
  writeJsonAtomic(completeFile, { schema: 1, completed_at: new Date().toISOString(), ready: result.ready, refs: result.refs });
  console.log(`完成 ${manifest.workspace_name} → ${root}`);
  return result;
}
if (require.main === module) {
  const arg = process.argv[2]; const concurrency = Math.max(1, Math.min(6, Number(process.argv[3] || 3)));
  if (!arg) { console.error('用法: node collect_project.js <项目目录或workspaceId> [并发数]'); process.exit(2); }
  collect(rootFor(arg), concurrency).catch(e => { console.error(`错误: ${e.message}`); process.exit(2); });
}
module.exports = { collect };
