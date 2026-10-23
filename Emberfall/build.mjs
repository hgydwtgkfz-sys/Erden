import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=relative=>readFile(path.join(root,relative),'utf8');
const files=['index.html','styles.css','game-core.js','renderer.js','app.js','phone/index.html'];
const source=Object.fromEntries(await Promise.all(files.map(async name=>[name,await read('public/'+name)])));
let standalone=source['index.html'].replace('<link rel="stylesheet" href="styles.css">',()=>'<style>\n'+source['styles.css']+'\n</style>');
for(const name of ['game-core.js','renderer.js','app.js'])standalone=standalone.replace('<script src="'+name+'"></script>',()=>'<script>\n'+source[name].replace(/<\/script/gi,'<\\/script')+'\n</script>');
if(/<(?:script|link)\b[^>]*(?:src|href)=["'](?:https?:|\/\/|styles\.css|game-core|renderer|app\.js)/i.test(standalone))throw new Error('Standalone still has an external dependency');
await writeFile(path.join(root,'Emberfall.html'),standalone);
await writeFile(path.join(root,'public/Emberfall.html'),standalone);

// The Worker ESM entry embeds the exact checked frontend. The final build keeps
// the Sites Worker artifact shape: dist/server/index.js + dist/.openai/hosting.json.
const service=(await read('server/rooms.mjs')).replace(/^import '\.\.\/public\/game-core\.js';\s*/, '');
const assets=files.map(name=>['/'+name,source[name],name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8']);
assets.push(['/Emberfall.html',standalone,'text/html; charset=utf-8']);
const worker=source['game-core.js']+'\n'+service+'\n'+
`const assets=new Map(${JSON.stringify(assets)}.map(([url,body,type])=>[url,{body,type}]));
const services=new WeakMap();
const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/')){
    if(!env.DB)return Response.json({error:'storage_unavailable',message:'Сетевая игра пока недоступна: база комнат не подключена.'},{status:503,headers:{...security,'Cache-Control':'no-store'}});
    let service=services.get(env.DB);if(!service){service=makeRoomService({store:new D1RoomStore(env.DB)});services.set(env.DB,service);}
    return service.fetch(request);
  }
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:security});
  const pathname=url.pathname==='/'?'/index.html':url.pathname==='/phone'||url.pathname==='/phone/'?'/phone/index.html':url.pathname;
  const asset=assets.get(pathname);if(!asset)return new Response('Not found',{status:404,headers:security});
  return new Response(request.method==='HEAD'?null:asset.body,{headers:{...security,'Content-Type':asset.type,'Cache-Control':'no-cache',...(pathname==='/Emberfall.html'?{'Content-Disposition':'attachment; filename="Emberfall.html"'}:{})}});
}};
`;
await mkdir(path.join(root,'worker'),{recursive:true});
await mkdir(path.join(root,'dist/server'),{recursive:true});
await mkdir(path.join(root,'dist/.openai'),{recursive:true});
await writeFile(path.join(root,'worker/index.js'),worker);
await writeFile(path.join(root,'dist/server/index.js'),worker);
await writeFile(path.join(root,'worker/package.json'),'{"type":"module"}\n');
await writeFile(path.join(root,'dist/server/package.json'),'{"type":"module"}\n');
await copyFile(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));
console.log('Built offline Emberfall.html ('+Buffer.byteLength(standalone)+' bytes) and Worker ESM ('+Buffer.byteLength(worker)+' bytes).');
