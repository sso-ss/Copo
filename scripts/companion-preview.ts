/** Sidecar-free visual harness for the real local companion bundles.
 * No credentials, tool configuration, or production gateway are accessed. */
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "../shell/dist/companion")
const bridge = `<script>
const callbacks = new Map(), listeners = new Map(); let nextId = 1;
let scenario = new URLSearchParams(location.search).get('scenario') || 'ready';
let generation = 0;
const enabled = new Map();
function fixture() {
  const working = scenario === 'working';
  const entry = {apiKeyId:'claude',status:working?'working':'finished',activeRequests:working?1:0,lastStartedAt:1,lastFinishedAt:working?null:2,lastStatusCode:200};
  const event = {generation:String(generation),eventId:2,requestId:'request',apiKeyId:'claude',status:'finished',timestamp:Date.now(),statusCode:200,activity:{...entry,activeRequests:0},removedApiKeyId:null};
  return {gateway:scenario==='welcome'?'sign-in-required':scenario==='upstream-error'?'upstream-error':'ready',account:scenario==='welcome'?null:{login:'octocat',host:'github.com',avatarUrl:null},
    availableToolIds:['claude-code','codex'],
    connections: scenario==='welcome'?[]:[
      {id:'claude-code',name:'Claude Code',apiKeyId:'claude',configured:true,shared:false,section:'apps'},
      {id:'codex',name:'Codex CLI and Desktop',apiKeyId:'codex',configured:true,shared:true,section:'apps'},
      {id:'key:custom',name:'Custom client',apiKeyId:'custom',configured:true,shared:true,section:'api-clients'}].map(c=>({...c,configured:enabled.get(c.id)??c.configured})),
    activity:{generation:String(generation),eventId:2,activity:scenario==='configured'?[]:[entry],activeRequests:[],recentEvents:scenario==='configured'?[]:[event]}};
}
function emit(event,payload) {for(const id of listeners.get(event)||[]) callbacks.get(id)?.({event,payload,id});}
window.__TAURI_INTERNALS__={transformCallback(fn){const id=nextId++; callbacks.set(id,fn); return id;},async invoke(command,args={}){
  if(command==='plugin:event|listen'){listeners.set(args.event,[...(listeners.get(args.event)||[]),args.handler]);return args.handler;}
  if(command==='companion_boot')return {state:'ready',locale:'en'};
  if(command==='companion_preferences')return {buddySize:'medium',appearance:'system'};
  if(command==='companion_data'){if(scenario==='unavailable')throw Error('offline');return fixture();}
  if(command==='companion_toggle'){enabled.set(args.id,args.enabled);emit('companion:stream',{kind:'refresh'});return;}
  if(command==='set_locale'){emit('companion:locale',args.tag);return;}
  if(command==='companion_action'&&args.action==='panel'){location.search='?panel&scenario='+scenario;return;}
  if(command==='companion_action'&&args.action==='sign-out'){scenario='welcome';generation++;emit('companion:stream',{kind:'refresh'});}
  document.getElementById('preview-status').textContent=command+' '+JSON.stringify(args);
}};
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
addEventListener('DOMContentLoaded',()=>{
const bar=document.createElement('aside');bar.id='preview-controls';
for(const name of ['welcome','configured','ready','working','unavailable','upstream-error']){const b=document.createElement('button');b.textContent=name;b.onclick=()=>{scenario=name;generation++;emit('companion:stream',{kind:'refresh'});};bar.append(b);}
const pet=document.createElement('a');pet.textContent=location.search.includes('panel')?'Pet':'Panel';pet.href=location.search.includes('panel')?'?scenario='+scenario:'?panel&scenario='+scenario;bar.append(pet);
const theme=document.createElement('button');theme.textContent='Theme';theme.onclick=()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';bar.append(theme);
const status=document.createElement('p');status.id='preview-status';bar.append(status);document.body.append(bar);
});
</script>`

Bun.serve({
  hostname: "127.0.0.1", port: 4748,
  async fetch(request) {
    const url = new URL(request.url)
    const path = resolve(root, `.${url.pathname === "/" ? "/index.html" : url.pathname}`)
    if (!path.startsWith(`${root}/`)) return new Response("Not found", { status: 404 })
    const file = Bun.file(path)
    if (!(await file.exists())) return new Response("Not found", { status: 404 })
    if (path.endsWith("index.html")) {
      const style = `<style>html{background:#bbc4ce}body{width:${url.searchParams.has("panel") ? "380px" : "160px"};height:${url.searchParams.has("panel") ? "510px" : "194px"};margin:80px auto}#preview-controls{position:fixed;top:12px;left:12px;display:flex;gap:8px;font:14px system-ui}#preview-status{position:fixed;bottom:0;left:16px}#panel{border-radius:12px;box-shadow:0 8px 32px #0003}</style>`
      return new Response((await file.text()).replace("</head>", `${style}${bridge}</head>`), { headers: { "content-type": "text/html" } })
    }
    return new Response(file)
  },
})
console.log(`Companion preview: http://127.0.0.1:4748/?panel (assets: ${join(root, "index.html")})`)
