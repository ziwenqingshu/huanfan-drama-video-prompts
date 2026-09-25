const assert = require('assert');
const layout = require('./project_layout');
const manifest = { workspace_id: 1, workspace_name: '测试 项目' };
const chapter = { chapter_name: '第1集' }, shot = { shot_id: 9, shot_no: 2, shot_text: 'a   b' }, version = { media_id: 3, version_no: null, is_selected: true, prompt_used: '' };
assert.match(layout.versionDir(manifest, chapter, shot, version), /分镜02_a b_shot9\\vx_选中_3$/);
assert.equal(layout.promptText(version), '(提示词为空)\n');
assert.equal(layout.extensionOf('https://x/a.MP3?sig=1'), 'mp3');
assert.match(layout.assetPath(manifest, { rid: '99', url: 'https://x/a.jpg', type: 'image' }, new Map([['99', 'png']])), /asset_99\.png$/);
console.log('project_layout ok');
