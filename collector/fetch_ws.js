// 兼容入口：已改为浏览器请求重放，不读取浏览器认证信息。
const { fetchManifest } = require('./fetch_manifest_replay');
const id = process.argv[2];
if (!id) { console.error('用法: node fetch_ws.js <workspaceId> [--name 项目名]'); process.exit(2); }
const at = process.argv.indexOf('--name');
fetchManifest(id, at >= 0 ? process.argv[at + 1] : null).catch(e => { console.error(`错误: ${e.message}`); process.exit(1); });
