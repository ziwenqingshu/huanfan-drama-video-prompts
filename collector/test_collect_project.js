const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const root = fs.mkdtempSync(path.join(__dirname, '_test_v4-'));
process.env.FANTAFRAME_ROOT = root;
const layout = require('./project_layout');
const { collect } = require('./collect_project');
const { verifyProject } = require('./verify_project');

async function main() {
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  const video = path.join(source, 'video.mp4'); const bytes = Buffer.alloc(32); bytes.write('ftyp', 4); fs.writeFileSync(video, bytes);
  const image = path.join(source, 'image.png'); fs.writeFileSync(image, Buffer.from([1, 2, 3]));
  const manifest = { schema: 2, workspace_id: 999001, workspace_name: 'v4 test', chapters: [{ chapter_id: 1, chapter_name: '第1集', shots: [{ shot_id: 2, shot_no: 1, shot_text: 'test', versions: [{ media_id: 3, version_no: 1, is_selected: 1, file_url: pathToFileURL(video).href, prompt_used: 'hello 图1', resolved_mentions: [{ resource_id: 4, resource_type: 'image', label: '图1', name: 'x', url: pathToFileURL(image).href }] }] }] }] };
  const project = layout.projectRoot(manifest); layout.ensureDir(layout.metadataDir(manifest)); layout.writeJsonAtomic(path.join(layout.metadataDir(manifest), 'manifest.json'), manifest);
  const first = await collect(project, 1); assert.equal(first.ok, true);
  const second = await collect(project, 1); assert.equal(second.ok, true);
  const state = JSON.parse(fs.readFileSync(path.join(layout.metadataDir(manifest), 'download_state.json'), 'utf8'));
  assert.equal(Object.values(state.items).filter(x => x.status === 'kept').length, 2);
  assert.equal(verifyProject(project).ok, true);
  const failedManifest = { ...manifest, workspace_id: 999002, workspace_name: 'v4 failed test', chapters: [{ ...manifest.chapters[0], shots: [{ ...manifest.chapters[0].shots[0], versions: [{ ...manifest.chapters[0].shots[0].versions[0], file_url: pathToFileURL(path.join(source, 'missing.mp4')).href }] }] }] };
  const failedProject = layout.projectRoot(failedManifest); layout.ensureDir(layout.metadataDir(failedManifest)); layout.writeJsonAtomic(path.join(layout.metadataDir(failedManifest), 'manifest.json'), failedManifest);
  const failed = await collect(failedProject, 1); assert.equal(failed.ok, false);
  assert.equal(fs.existsSync(path.join(layout.metadataDir(failedManifest), 'COMPLETE.json')), false);
  process.exitCode = 0;
  console.log('collect_project ok');
}
main().finally(() => fs.rmSync(root, { recursive: true, force: true })).catch(e => { console.error(e.stack); process.exit(1); });
