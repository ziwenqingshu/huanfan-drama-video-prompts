// 仅重放 Chrome 已认证 XHR；不读取、输出或保存认证头、Cookie、令牌。
const fs = require('fs');
const path = require('path');
const http = require('http');
const { projectRoot, metadataDir, ensureDir, writeJsonAtomic } = require('./project_layout');
const INVENTORY = path.join(__dirname, '盘点_2026-09-10', 'inventory_full.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => http.get(url, res => { let body = ''; res.on('data', x => body += x); res.on('end', () => resolve(JSON.parse(body))); }).on('error', reject));
const listify = (value, keys) => Array.isArray(value) ? value : keys.find(k => Array.isArray(value && value[k])) ? value[keys.find(k => Array.isArray(value && value[k]))] : [];

async function fetchManifest(workspaceId, nameOverride) {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8')).list || [];
  const item = inventory.find(x => String(x.id) === String(workspaceId));
  const workspaceName = nameOverride || (item && item.name);
  if (!workspaceName) throw new Error(`盘点中找不到项目 ${workspaceId}；请用 --name 指定真实项目名`);
  const pages = await getJson('http://127.0.0.1:9222/json/list');
  const page = pages.find(x => x.type === 'page' && String(x.url).includes('aico.fantaframe.com'));
  if (!page) throw new Error('没有已登录的幻帧页面');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map(); const base = {}; let active = null;
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const waitFor = async (predicate, label) => { const until = Date.now() + 30000; while (Date.now() < until) { if (predicate()) return; await sleep(40); } throw new Error(`${label} 超时`); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; setTimeout(() => reject(new Error('CDP 连接超时')), 8000); });
  ws.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); return message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result); }
    const request = message.params && message.params.request;
    const response = message.params && message.params.response;
    const url = (request && request.url) || (response && response.url) || '';
    const route = url.includes('/svtapi/chapter/list') ? 'chapter' : url.includes('/svtapi/shot/list') ? 'shot' : null;
    if (message.method === 'Network.requestWillBeSent' && route) base[route] = message.params.requestId;
    if (message.method === 'Network.responseReceived' && active && route === active.route) active.responseId = message.params.requestId;
    if (message.method === 'Network.loadingFinished' && active && message.params.requestId === active.responseId) active.finished = true;
    if (message.method === 'Fetch.requestPaused' && active && route === active.route) await send('Fetch.continueRequest', { requestId: message.params.requestId, postData: active.postData });
  };
  async function refreshBase() {
    try { await send('Fetch.disable'); } catch {}
    base.chapter = null; base.shot = null;
    await send('Page.reload'); await sleep(6500);
    if (!base.chapter || !base.shot) throw new Error('页面未产生 chapter/shot 基础请求');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*svtapi/chapter/list*', requestStage: 'Request' }, { urlPattern: '*svtapi/shot/list*', requestStage: 'Request' }] });
  }
  async function call(route, payload) {
    active = { route, postData: Buffer.from(JSON.stringify(payload)).toString('base64'), responseId: null, finished: false };
    await send('Network.replayXHR', { requestId: base[route] });
    await waitFor(() => active.responseId && active.finished, route);
    const response = await send('Network.getResponseBody', { requestId: active.responseId });
    active = null;
    const body = JSON.parse(response.body);
    if (body.code !== 0) throw new Error(`${route} code=${body.code} ${body.message || ''}`);
    return body.result || {};
  }
  try {
    await send('Network.enable'); await refreshBase();
    const chapterResponse = await call('chapter', { workspace_id: String(workspaceId), only_current_user_bound: false });
    const chapterList = listify(chapterResponse, ['chapter_list', 'list', 'data']);
    if (chapterResponse.chapter_count != null && Number(chapterResponse.chapter_count) !== chapterList.length) throw new Error(`chapter_count 截断 ${chapterList.length}/${chapterResponse.chapter_count}`);
    const chapters = [];
    for (const chapter of chapterList) {
      const shotResponse = await call('shot', { workspace_id: String(workspaceId), chapter_id: String(chapter.chapter_id) });
      const shotList = listify(shotResponse, ['shot_list', 'list', 'slots']);
      if (shotResponse.shot_count != null && Number(shotResponse.shot_count) !== shotList.length) throw new Error(`chapter ${chapter.chapter_id} shot_count 截断 ${shotList.length}/${shotResponse.shot_count}`);
      chapters.push({ chapter_id: chapter.chapter_id, chapter_name: chapter.chapter_name, shots: shotList.map(shot => ({ shot_id: shot.shot_id, shot_no: shot.shot_no, shot_text: shot.shot_text, versions: listify(shot, ['video_versions']) })) });
    }
    const manifest = { schema: 2, workspace_id: Number(workspaceId), workspace_name: workspaceName, fetched_at: new Date().toISOString(), chapters };
    ensureDir(metadataDir(manifest));
    writeJsonAtomic(path.join(metadataDir(manifest), 'manifest.json'), manifest);
    console.log(JSON.stringify({ workspace: workspaceName, root: projectRoot(manifest), chapters: chapters.length, shots: chapters.reduce((n, c) => n + c.shots.length, 0), ready: chapters.flatMap(c => c.shots).flatMap(s => s.versions).filter(v => !v.is_error && v.file_url).length }));
    return manifest;
  } finally { try { await send('Fetch.disable'); } catch {} ws.close(); }
}

if (require.main === module) {
  const id = process.argv[2]; const nameAt = process.argv.indexOf('--name');
  if (!id) { console.error('用法: node fetch_manifest_replay.js <workspaceId> [--name 项目名]'); process.exit(2); }
  fetchManifest(id, nameAt >= 0 ? process.argv[nameAt + 1] : null).catch(e => { console.error(`错误: ${e.message}`); process.exit(1); });
}
module.exports = { fetchManifest };
