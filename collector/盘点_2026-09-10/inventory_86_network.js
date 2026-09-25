// 只读盘点：重放浏览器已有 XHR，仅替换业务参数；不读取/记录认证信息，不下载媒体。
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = __dirname, OUT = path.join(ROOT, 'inventory_86_readonly.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function json(url) { return new Promise((ok,bad)=>http.get(url,r=>{let s='';r.on('data',x=>s+=x);r.on('end',()=>ok(JSON.parse(s)));}).on('error',bad)); }

(async () => {
  const limitArg = process.argv.find(x=>x.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice(8)) : Infinity;
  const allProjects = JSON.parse(fs.readFileSync(path.join(ROOT,'inventory_full.json'),'utf8')).list;
  const retryErrors = process.argv.includes('--retry-errors');
  const prior = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT,'utf8')) : {rows:[]};
  const rowMap = new Map((prior.rows||[]).map(x=>[String(x.id),x]));
  const projects = (retryErrors ? allProjects.filter(p=>{const x=rowMap.get(String(p.id));return x&&x.errors&&x.errors.length;}) : allProjects).slice(0,limit);
  const pages = await json('http://127.0.0.1:9222/json/list');
  const page = pages.find(x=>x.type==='page' && String(x.url).includes('/steps/stepfive'));
  if (!page) throw Error('没有分镜工作台标签页');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq=0, active=null; const pending=new Map(), base={};
  function send(method,params={}) { return new Promise((ok,bad)=>{const id=++seq;pending.set(id,{ok,bad});ws.send(JSON.stringify({id,method,params}));}); }
  async function wait(fn, label) { const until=Date.now()+30000; while(Date.now()<until){if(fn())return;await sleep(40);} throw Error(label+' 超时'); }
  await new Promise((ok,bad)=>{ws.onopen=ok;setTimeout(()=>bad(Error('CDP 连接超时')),8000);});
  ws.onmessage=async e=>{
    const m=JSON.parse(e.data);
    if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);return m.error?p.bad(Error(JSON.stringify(m.error))):p.ok(m.result);}
    const url=m.params&&m.params.request&&m.params.request.url || m.params&&m.params.response&&m.params.response.url || '';
    const route=url.includes('/svtapi/chapter/list')?'chapter':url.includes('/svtapi/shot/list')?'shot':null;
    if(m.method==='Network.requestWillBeSent'&&route) base[route]=m.params.requestId;
    if(m.method==='Network.responseReceived'&&active&&route===active.route) active.responseId=m.params.requestId;
    if(m.method==='Network.loadingFinished'&&active&&m.params.requestId===active.responseId) active.finished=true;
    if(m.method==='Fetch.requestPaused'&&active){const r=m.params.request.url.includes('/svtapi/chapter/list')?'chapter':m.params.request.url.includes('/svtapi/shot/list')?'shot':null;if(r===active.route) await send('Fetch.continueRequest',{requestId:m.params.requestId,postData:active.body});}
  };
  await send('Network.enable');
  async function refreshBase() {
    try { await send('Fetch.disable'); } catch {}
    base.chapter=null; base.shot=null; await send('Page.reload'); await sleep(6500);
    if(!base.chapter||!base.shot) throw Error('未捕获页面基础 chapter/shot 请求');
    await send('Fetch.enable',{patterns:[{urlPattern:'*svtapi/chapter/list*',requestStage:'Request'},{urlPattern:'*svtapi/shot/list*',requestStage:'Request'}]});
  }
  async function call(route, payload) {
    active={route,body:Buffer.from(JSON.stringify(payload)).toString('base64'),responseId:null,finished:false};
    await send('Network.replayXHR',{requestId:base[route]});
    await wait(()=>active.responseId&&active.finished,route);
    const r=await send('Network.getResponseBody',{requestId:active.responseId}); active=null;
    const out=JSON.parse(r.body); if(out.code!==0) throw Error(route+' code='+out.code+' '+(out.message||'')); return out.result||{};
  }
  const rows=[];
  try {
    for(let i=0;i<projects.length;i++){
      await refreshBase();
      const p=projects[i], row={id:p.id,name:p.name,chapters:0,shots:0,versions:0,ready:0,failed:0,pending:0,errors:[]};
      try {
        const cr=await call('chapter',{workspace_id:String(p.id),only_current_user_bound:false});
        const chapters=cr.chapter_list||[]; row.chapters=chapters.length;
        if(cr.chapter_count!=null&&cr.chapter_count!==chapters.length) row.errors.push(`chapter_count ${chapters.length}/${cr.chapter_count}`);
        for(const ch of chapters){
          try{
            const sr=await call('shot',{workspace_id:String(p.id),chapter_id:String(ch.chapter_id)});
            const shots=sr.shot_list||[]; row.shots+=shots.length;
            if(sr.shot_count!=null&&sr.shot_count!==shots.length) row.errors.push(`chapter ${ch.chapter_id} shot_count ${shots.length}/${sr.shot_count}`);
            for(const sh of shots) for(const v of (sh.video_versions||[])){ row.versions++; if(v.is_error===1)row.failed++; else if(v.file_url)row.ready++; else row.pending++; }
          }catch(e){row.errors.push(`chapter ${ch.chapter_id}: ${e.message}`);}
        }
      }catch(e){row.errors.push(e.message);}
      rowMap.set(String(row.id),row); rows.push(row);
      const merged=allProjects.map(p=>rowMap.get(String(p.id))).filter(Boolean);
      fs.writeFileSync(OUT,JSON.stringify({updated_at:new Date().toISOString(),total:allProjects.length,done:merged.length,rows:merged},null,1),'utf8');
      console.log(`${i+1}/${projects.length}\t${p.id}\t集${row.chapters}\t分镜${row.shots}\t版本${row.versions}\t可下${row.ready}\t失败${row.failed}\t待生成${row.pending}\t异常${row.errors.length}`);
    }
  } finally { try{await send('Fetch.disable');}catch{} ws.close(); }
  const merged=allProjects.map(p=>rowMap.get(String(p.id))).filter(Boolean);
  const sum=merged.reduce((a,x)=>{for(const k of ['chapters','shots','versions','ready','failed','pending'])a[k]+=x[k];a.errors+=x.errors.length;return a;},{chapters:0,shots:0,versions:0,ready:0,failed:0,pending:0,errors:0});
  fs.writeFileSync(OUT,JSON.stringify({updated_at:new Date().toISOString(),total:allProjects.length,done:merged.length,sum,rows:merged},null,1),'utf8');
  console.log('SUMMARY '+JSON.stringify(sum));
})().catch(e=>{console.error('FATAL '+e.message);process.exit(1);});
