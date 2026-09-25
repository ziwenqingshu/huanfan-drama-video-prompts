const http = require('http');

function getJson(url) { return new Promise((ok, bad) => http.get(url, r => { let s=''; r.on('data', x=>s+=x); r.on('end',()=>ok(JSON.parse(s))); }).on('error',bad)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const pages = await getJson('http://127.0.0.1:9222/json/list');
  const page = pages.find(x => x.type === 'page' && String(x.url).includes('/steps/stepfive'));
  if (!page) throw Error('没有分镜工作台标签页');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0, chapterRequest, lastResponse, override;
  const pending = new Map();
  function send(method, params={}) { return new Promise((ok,bad)=>{ const n=++id; pending.set(n,{ok,bad}); ws.send(JSON.stringify({id:n,method,params})); }); }
  await new Promise((ok,bad)=>{ ws.onopen=ok; setTimeout(()=>bad(Error('CDP 超时')),8000); });
  ws.onmessage = async e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p=pending.get(m.id); pending.delete(m.id); return m.error?p.bad(Error(JSON.stringify(m.error))):p.ok(m.result); }
    if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/svtapi/chapter/list')) chapterRequest=m.params.requestId;
    if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/svtapi/chapter/list')) lastResponse=m.params.requestId;
    if (m.method === 'Fetch.requestPaused' && m.params.request.url.includes('/svtapi/chapter/list')) {
      await send('Fetch.continueRequest',{requestId:m.params.requestId,postData:override});
    }
  };
  await send('Network.enable');
  await send('Page.reload');
  await sleep(7000);
  if (!chapterRequest) throw Error('未捕获 chapter/list');
  await send('Fetch.enable',{patterns:[{urlPattern:'*svtapi/chapter/list*',requestStage:'Request'}]});
  override = Buffer.from(JSON.stringify({workspace_id:'5896',only_current_user_bound:false})).toString('base64');
  await send('Network.replayXHR',{requestId:chapterRequest});
  await sleep(4000);
  if (!lastResponse) throw Error('重放没有响应');
  const body = await send('Network.getResponseBody',{requestId:lastResponse});
  const result = JSON.parse(body.body);
  console.log(JSON.stringify({code:result.code,chapterCount:result.result&&result.result.chapter_count,returned:result.result&&result.result.chapter_list&&result.result.chapter_list.length}));
  await send('Fetch.disable'); ws.close();
})().catch(e=>{ console.error(e.message); process.exit(1); });
