const fs = require('fs');
const path = require('path');
const { BASE, projectRoot, metadataDir, versionDir, videoPath, promptPath, refsPath, assetPath, promptText, uniqueMentions, assetExtensionIndex, isMp4, nonEmpty } = require('./project_layout');

function rootFor(arg) {
  if (arg && fs.existsSync(arg)) return path.resolve(arg);
  const suffix = `[${arg}]`;
  const found = fs.readdirSync(BASE, { withFileTypes: true }).filter(x => x.isDirectory() && x.name.endsWith(suffix)).map(x => path.join(BASE, x.name));
  if (found.length !== 1) throw new Error(`找不到唯一项目目录: ${arg}`);
  return found[0];
}
function verifyProject(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '_元数据', 'manifest.json'), 'utf8'));
  if (projectRoot(manifest) !== root) throw new Error('manifest 项目路径与实际目录不一致');
  const assetExts = assetExtensionIndex(manifest);
  const missing = [], wrong = [];
  let ready = 0, refs = 0;
  for (const chapter of manifest.chapters) for (const shot of chapter.shots) for (const version of shot.versions) {
    if (version.is_error || !version.file_url) continue;
    ready++;
    const dir = versionDir(manifest, chapter, shot, version);
    const video = videoPath(manifest, chapter, shot, version);
    if (!isMp4(video)) missing.push(`视频 ${version.media_id}`);
    const prompt = promptPath(manifest, chapter, shot, version);
    try { if (fs.readFileSync(prompt, 'utf8') !== promptText(version)) wrong.push(`提示词 ${version.media_id}`); } catch { missing.push(`提示词 ${version.media_id}`); }
    const mapFile = refsPath(manifest, chapter, shot, version);
    let map;
    try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch { missing.push(`引用映射 ${version.media_id}`); continue; }
    const expected = uniqueMentions(version);
    if (!Array.isArray(map.items) || map.items.length !== expected.length) wrong.push(`引用映射条数 ${version.media_id}`);
    const actual = new Map((map.items || []).map(x => [`${x.type}|${x.label}|${x.rid}`, x.asset]));
    for (const mention of expected) {
      refs++;
      const key = `${mention.type}|${mention.label}|${mention.rid}`;
      const expectedAsset = path.relative(dir, assetPath(manifest, mention, assetExts)).replace(/\\/g, '/');
      if (actual.get(key) !== expectedAsset) wrong.push(`引用映射 ${version.media_id}:${mention.label}`);
      if (!nonEmpty(assetPath(manifest, mention, assetExts))) missing.push(`引用素材 ${mention.rid}`);
    }
  }
  const stateFile = path.join(metadataDir(manifest), 'download_state.json');
  let failed = [];
  try { failed = Object.values(JSON.parse(fs.readFileSync(stateFile, 'utf8')).items || {}).filter(x => x.status === 'fail'); } catch { wrong.push('下载账本'); }
  const result = { workspace: manifest.workspace_name, workspace_id: manifest.workspace_id, ready, refs, missing, wrong, failed: failed.map(x => x.key), ok: !missing.length && !wrong.length && !failed.length };
  return result;
}
if (require.main === module) {
  try {
    const result = verifyProject(rootFor(process.argv[2]));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (e) { console.error(`错误: ${e.message}`); process.exit(2); }
}
module.exports = { verifyProject, rootFor };
