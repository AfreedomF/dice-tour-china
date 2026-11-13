import http from 'node:http';
import {readFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomInt,createHash,scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {GameError,createRoom,newPlayer,publicRoom,applyAction} from './engine.js';
const scrypt=promisify(scryptCb);
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=x=>createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const invalid=(msg,status=400,code='BAD_REQUEST')=>{throw new GameError(msg,status,code);};
function nameOf(x){if(typeof x!=='string')invalid('请输入昵称');const n=x.trim();if(n.length<1||n.length>20||/[\x00-\x1f\x7f]/.test(n))invalid('昵称需为 1～20 个可见字符');return n;}
function passwordOf(x){if(x===undefined||x==='')return '';if(typeof x!=='string'||x.length>100)invalid('密码最长 100 字符');return x;}
async function readBody(req){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>8192)invalid('请求过大',400,'BODY_TOO_LARGE');chunks.push(c);}try{const obj=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!obj||typeof obj!=='object'||Array.isArray(obj))throw 0;return obj;}catch{invalid('需要有效 JSON 对象');}}
export async function createApp(options={}){
const dataDir=options.dataDir??process.env.DATA_DIR??path.join(ROOT,'data');const file=path.join(dataDir,'rooms.json');const now=options.now??Date.now;const ttl=options.ttl??24*60*60*1000;const maxRooms=options.maxRooms??200;
const origins=new Set(options.allowedOrigins??(process.env.ALLOWED_ORIGINS?.split(',').map(x=>x.trim()).filter(Boolean)??['http://127.0.0.1:39570','http://localhost:39570']));
await mkdir(dataDir,{recursive:true});let rooms=new Map();try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.format!==1||!Array.isArray(saved.rooms))throw new Error('Invalid persistence format');for(const r of saved.rooms){for(const p of r.players){p.lastSeen=0;p.online=false;}rooms.set(r.code,r);}}catch(e){if(e.code!=='ENOENT')throw e;}
async function save(){const temp=path.join(dataDir,`rooms.${randomBytes(6).toString('hex')}.tmp`);let handle;try{handle=await open(temp,'wx',0o600);await handle.writeFile(JSON.stringify({format:1,rooms:[...rooms.values()]}),'utf8');await handle.sync();await handle.close();handle=null;await rename(temp,file);}catch(e){if(handle)await handle.close();await unlink(temp).catch(()=>{});throw e;}}
let queue=Promise.resolve();function serialized(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}
async function transaction(fn){const snapshot=structuredClone([...rooms.entries()]);try{const result=await fn();await save();return result;}catch(e){rooms=new Map(snapshot);throw e;}}
const rates=new Map();function rate(req,kind){const key=`${req.socket.remoteAddress}:${kind}`;const time=now();let entry=rates.get(key);if(!entry||time-entry.at>60000){entry={at:time,count:0};rates.set(key,entry);}if(++entry.count>(kind==='get'?600:kind==='create'?20:180))invalid('请求过于频繁，请稍后再试',429,'RATE_LIMIT');if(rates.size>5000)for(const [k,v] of rates)if(time-v.at>60000)rates.delete(k);}
function auth(req,r){const header=req.headers.authorization;if(!header?.startsWith('Bearer ')||header.length>200)invalid('请提供登录凭证',401,'UNAUTHORIZED');const hash=digest(header.slice(7));const p=r.players.find(x=>equal(x.tokenHash,hash));if(!p)invalid('登录凭证无效',401,'UNAUTHORIZED');return p;}
function issue(p){const token=randomBytes(32).toString('base64url');p.tokenHash=digest(token);return token;}
function getRoom(code){const r=rooms.get(code);if(!r||now()-r.updatedAt>ttl)invalid('房间不存在或已过期',400,'ROOM_NOT_FOUND');return r;}
function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));}
const staticFiles=new Map([['/','web/index.html'],['/index.html','web/index.html'],['/app.js','web/app.js'],['/style.css','web/style.css'],['/game-ui.js','web/game-ui.js'],['/shared/content.js','shared/content.js'],['/vendor/react.js','web/vendor/react.js'],['/vendor/react-dom.js','web/vendor/react-dom.js']]);
const server=http.createServer(async(req,res)=>{
res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
try{
const origin=req.headers.origin;if(origin){const sameOrigin=origin===`http://${req.headers.host}`||origin===`https://${req.headers.host}`;if(!sameOrigin&&!origins.has(origin))invalid('不允许的来源',403,'ORIGIN_FORBIDDEN');res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
const url=new URL(req.url,'http://localhost');const pathname=url.pathname;
if(pathname==='/api/health'&&req.method==='GET'){json(res,200,{ok:true});return;}
if(pathname.startsWith('/api/')){
rate(req,req.method==='GET'?'get':pathname==='/api/rooms'?'create':'post');
const body=req.method==='POST'?await readBody(req):null;
await serialized(async()=>{
if(pathname==='/api/rooms'&&req.method==='POST'){
const result=await transaction(async()=>{for(const [k,r] of rooms)if(now()-r.updatedAt>ttl)rooms.delete(k);if(rooms.size>=maxRooms)invalid('房间已满，请稍后再试',429,'ROOM_LIMIT');if(![2,4].includes(body.capacity))invalid('房间仅支持 2 人或 4 人');const name=nameOf(body.name),password=passwordOf(body.password);let code;do{code=String(randomInt(100000,1000000));}while(rooms.has(code));const r=createRoom(code,body.capacity,name,now());if(password){const salt=randomBytes(16).toString('hex');r.passwordSalt=salt;r.passwordHash=(await scrypt(password,salt,32)).toString('hex');}const p=r.players[0],token=issue(p);rooms.set(code,r);return {token,playerId:p.id,room:publicRoom(r,p.id,now())};});json(res,200,result);return;
}
const match=/^\/api\/rooms\/([0-9]{6})(?:\/(join|action))?$/.exec(pathname);if(!match)invalid('接口不存在');const [,code,route]=match;const r=getRoom(code);
if(route==='join'&&req.method==='POST'){
const result=await transaction(async()=>{if(r.status!=='lobby'||r.players.length>=r.capacity)invalid('房间已满或已开始',409,'ROOM_UNAVAILABLE');const name=nameOf(body.name),password=passwordOf(body.password);if(r.passwordHash&&!equal((await scrypt(password,r.passwordSalt,32)).toString('hex'),r.passwordHash))invalid('房间密码错误',403,'WRONG_PASSWORD');if(r.players.some(p=>p.name===name))invalid('昵称已被使用');const p=newPlayer(name,now()),token=issue(p);r.players.push(p);r.version++;r.updatedAt=now();r.logs.push({text:`${name} 加入了房间`});return {token,playerId:p.id,room:publicRoom(r,p.id,now())};});json(res,200,result);return;
}
const p=auth(req,r);
if(!route&&req.method==='GET'){p.lastSeen=now();json(res,200,{room:publicRoom(r,p.id,now())});return;}
if(route==='action'&&req.method==='POST'){
if(typeof body.requestId!=='string'||body.requestId.length<1||body.requestId.length>100)invalid('需要 requestId（1～100 字符）');const fingerprint=digest(JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b)))));const old=r.receipts.find(x=>x.playerId===p.id&&x.id===body.requestId);if(old){if(old.fingerprint!==fingerprint)invalid('requestId 已被另一操作使用',409,'REQUEST_ID_REUSED');p.lastSeen=now();json(res,200,{room:publicRoom(r,p.id,now())});return;}
if(!Number.isSafeInteger(body.version)||body.version!==r.version)invalid('房间已更新，请刷新后重试',409,'STALE_VERSION');
const result=await transaction(async()=>{p.lastSeen=now();applyAction(r,p.id,body,{now:now(),...(options.rng?{rng:options.rng}:{})});r.receipts.push({playerId:p.id,id:body.requestId,fingerprint});r.receipts=r.receipts.slice(-1024);return {room:publicRoom(r,p.id,now())};});json(res,200,result);return;
}
invalid('不支持的请求方法');
});return;
}
if(req.method!=='GET'&&req.method!=='HEAD')invalid('不支持的请求方法');const relative=staticFiles.get(pathname);if(!relative)invalid('页面不存在');const absolute=path.resolve(ROOT,relative);if(!absolute.startsWith(ROOT+path.sep))invalid('路径无效',403);let content;try{content=await readFile(absolute);}catch(e){if(e.code==='ENOENT')invalid('静态文件尚未安装');throw e;}const ext=path.extname(absolute);res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});res.end(req.method==='HEAD'?undefined:content);
}catch(e){if(res.headersSent){res.end();return;}if(!(e instanceof GameError))console.error(e);json(res,e instanceof GameError?e.status:500,{error:e instanceof GameError?e.message:'服务器暂时无法处理请求',code:e instanceof GameError?e.code:'INTERNAL_ERROR'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
return {server,async close(){await queue;if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));},dataDir};
}
