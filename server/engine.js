import {randomInt,randomUUID} from '../shared/random.js';
import {BOARD,CARDS} from '../shared/content.js';
export const OFFLINE_MS=30_000;
export class GameError extends Error {constructor(message,status=400,code='INVALID_ACTION'){super(message);this.status=status;this.code=code;}}
const fail=(text,status=400,code)=>{throw new GameError(text,status,code);};
const log=(r,text)=>{r.logs.push({text});r.logs=r.logs.slice(-80);};
function playerName(name){if(typeof name!=='string')fail('请输入昵称');const value=name.trim();if(value.length<1||value.length>20||/[\x00-\x1f\x7f]/.test(value))fail('昵称需为 1～20 个可见字符');return value;}
export function newPlayer(name,now=Date.now()){name=playerName(name);return {id:randomUUID(),name,cash:10000,position:0,ready:false,online:true,bankrupt:false,stamps:[],cards:['precise','shield','discount'],lastSeen:now,effects:{},extraRolls:0,skipTurns:0};}
export function createRoom(code,capacity,name,now=Date.now()) {if(![2,4].includes(capacity))fail('房间仅支持 2 人或 4 人');const p=newPlayer(name,now);return {code,capacity,status:'lobby',version:1,hostId:p.id,round:0,maxRounds:20,turnPlayerId:null,phase:'roll',lastDice:null,lastMove:null,events:[],cardUsed:false,buildUsed:false,players:[p],properties:{},logs:[{text:`${p.name} 创建了房间`}],createdAt:now,updatedAt:now,receipts:[]};}
export function online(p,now=Date.now()){return now-p.lastSeen<=OFFLINE_MS;}
export function publicRoom(r,playerId,now=Date.now()) {return {code:r.code,capacity:r.capacity,status:r.status,version:r.version,hostId:r.hostId,round:r.round,maxRounds:r.maxRounds,turnPlayerId:r.turnPlayerId,phase:r.phase,lastDice:r.lastDice,lastMove:structuredClone(r.lastMove??null),events:structuredClone(r.events??[]),cardUsed:!!r.cardUsed,buildUsed:!!r.buildUsed,players:r.players.map(p=>({id:p.id,name:p.name,cash:p.cash,position:p.position,ready:p.ready,online:online(p,now),bankrupt:p.bankrupt,extraRolls:p.extraRolls??0,skipTurns:p.skipTurns??0,stamps:[...p.stamps],...(p.id===playerId?{cards:[...p.cards],effects:{...p.effects}}:{cardCount:p.cards.length})})),properties:structuredClone(r.properties),logs:structuredClone(r.logs),...(r.rankings?{rankings:structuredClone(r.rankings)}:{})};}
const mortgagePrincipal=t=>Math.floor(t.price/2);
const redemptionCost=t=>mortgagePrincipal(t)+Math.ceil(mortgagePrincipal(t)/10);
// Settlement basis: face-value land + full-cost buildings + cash, less the
// complete redemption obligation (principal + rounded-up 10% fee). Not resale value.
export function netWorth(r,p){return p.cash+Object.entries(r.properties).reduce((sum,[id,v])=>{if(v.ownerId!==p.id)return sum;const t=BOARD[Number(id)];return sum+t.price+v.level*t.upgradeCost-(v.mortgaged?redemptionCost(t):0);},0);}
function finish(r){r.status='finished';r.turnPlayerId=null;r.rankings=r.players.map(p=>({playerId:p.id,name:p.name,netWorth:netWorth(r,p),bankrupt:p.bankrupt,stamps:p.stamps.length})).sort((a,b)=>Number(a.bankrupt)-Number(b.bankrupt)||b.netWorth-a.netWorth);r.rankings.forEach((entry,i,list)=>{const prev=list[i-1];entry.rank=prev&&entry.bankrupt===prev.bankrupt&&entry.netWorth===prev.netWorth?prev.rank:i+1;});log(r,'旅程结束，按净资产结算排名（同资产同名次，破产者列后）');}
function next(r){const survivors=r.players.filter(p=>!p.bankrupt);if(survivors.length<=1){finish(r);return;}
const current=r.players.find(p=>p.id===r.turnPlayerId);
// Extra rolls belong to this turn: consume one credit, never the card allowance.
if(current&&!current.bankrupt&&(current.extraRolls??0)>0){current.extraRolls--;r.phase='roll';r.lastDice=null;r.buildUsed=false;return;}
let i=r.players.findIndex(p=>p.id===r.turnPlayerId);
// Include every pending skipped turn, so even restored all-skipping snapshots
// eventually select a player (or cross the final-round boundary).
const limit=r.players.length*2+r.players.reduce((sum,p)=>sum+(p.bankrupt?0:(p.skipTurns??0)),0);
for(let n=0;n<limit;n++){i++;if(i>=r.players.length){i=0;r.round++;}if(r.round>r.maxRounds){finish(r);return;}const candidate=r.players[i];if(candidate.bankrupt)continue;if((candidate.skipTurns??0)>0){candidate.skipTurns--;log(r,`${candidate.name} 暂停旅行，跳过本回合`);continue;}r.turnPlayerId=candidate.id;r.phase='roll';r.lastDice=null;r.cardUsed=false;r.buildUsed=false;return;}}
function bankrupt(r,p){p.bankrupt=true;p.cash=0;p.cards=[];p.effects={};for(const [id,v] of Object.entries(r.properties))if(v.ownerId===p.id)delete r.properties[id];log(r,`${p.name} 破产退场`);}
// Automatic debt resolution follows tile order: sell buildings at half cost,
// then mortgage once. A mortgaged deed has no further liquidation proceeds;
// paying principal a second time would create money. Bankruptcy returns deeds.
function pay(r,p,amount,recipient){if(p.cash<amount){for(const [id,v] of Object.entries(r.properties)){if(v.ownerId!==p.id)continue;const t=BOARD[+id];while(v.level>0&&p.cash<amount){v.level--;p.cash+=Math.floor(t.upgradeCost/2);log(r,`${p.name} 自动出售 ${t.name} 建筑偿债`);}if(p.cash<amount&&!v.mortgaged){v.mortgaged=true;p.cash+=mortgagePrincipal(t);log(r,`${p.name} 自动抵押 ${t.name} 偿债`);}if(p.cash>=amount)break;}}
const paid=Math.min(p.cash,amount);p.cash-=paid;if(recipient)recipient.cash+=paid;if(paid<amount)bankrupt(r,p);return paid;}
function checkFinish(r){if(r.players.filter(p=>!p.bankrupt).length<=1)finish(r);}
function land(r,p,rng){const t=BOARD[p.position];log(r,`${p.name} 到达 ${t.name}`);if(t.type==='property'){if(!p.stamps.includes(t.city))p.stamps.push(t.city);const v=r.properties[t.id];if(v&&v.ownerId!==p.id&&!v.mortgaged){const owner=r.players.find(x=>x.id===v.ownerId);let rent=t.baseRent*(1+v.level*2);const cityTiles=BOARD.filter(x=>x.city===t.city);if(cityTiles.every(x=>r.properties[x.id]?.ownerId===owner.id))rent*=2;if(p.effects.shield){delete p.effects.shield;log(r,`${p.name} 的免租卡抵挡了 ${rent} 元租金`);}else{const paid=pay(r,p,rent,owner);log(r,`${p.name} 向 ${owner.name} 支付租金 ${paid} 元${paid<rent?`（应付 ${rent} 元）`:''}`);}}}
else if(t.type==='event'){
const draw=rng(0,5),version=r.version+1;
const event={id:String(version),playerId:p.id,playerName:p.name,kind:['reward','fine','extra_roll','jail','return_start'][draw],title:'',message:'',version};
if(draw===0){event.title='城市奖励';event.amount=rng(5,11)*100;p.cash+=event.amount;event.message=`${p.name} 获得城市奖励 ${event.amount} 元`;}
else if(draw===1){event.title='旅行罚款';event.amount=rng(5,9)*100;event.paid=pay(r,p,event.amount);event.message=`${p.name} 支付旅行罚款 ${event.paid} 元${event.paid<event.amount?`（应付 ${event.amount} 元）`:''}`;}
else if(draw===2){event.title='再掷一次';p.extraRolls=(p.extraRolls??0)+1;event.message=`${p.name} 获得一次额外掷骰，结束本次停留后继续旅行`;}
else if(draw===3){event.title='坐牢轮空';p.skipTurns=1;event.message=`${p.name} 坐牢，下次轮到时跳过一个回合`;}
else{event.title='返回起点';p.position=0;r.phase='roll';event.message=`${p.name} 返回起点，不领取经过起点奖励，继续掷骰`;}
r.events=[...(r.events??[]),event].slice(-20);log(r,event.message);
}
else if(t.type==='station'){p.cash+=200;log(r,'高铁出行补贴 200 元');}
else if(t.type==='shop'){if(p.cards.length<12){p.cards.push(CARDS[rng(0,CARDS.length)].id);log(r,'旅行商店赠送一张旅行卡');}}
else if(t.type==='park'){p.cash+=300;log(r,'公园休憩获得 300 元');}
checkFinish(r);if(r.status==='playing'&&p.bankrupt)next(r);}
// Mutates the supplied room. Persistence/network callers must apply to a clone
// or use a transaction and discard on error (including exceptions from rng).
export function applyAction(r,playerId,a,{now=Date.now(),rng=randomInt}={}){
if(!a||typeof a!=='object'||Array.isArray(a)||typeof a.type!=='string')fail('需要有效操作');
const p=r.players.find(x=>x.id===playerId);if(!p)fail('你不在这个房间',403);if(r.status==='finished')fail('本局已经结束',409);
if(a.type==='surrender'){if(r.status!=='playing'||p.bankrupt)fail('当前不能认输');const wasTurn=r.turnPlayerId===p.id;bankrupt(r,p);checkFinish(r);if(r.status==='playing'&&wasTurn)next(r);}
else if(r.status==='lobby'){
if(a.type==='ready'){if(typeof a.ready!=='boolean')fail('ready 必须为布尔值');p.ready=a.ready;log(r,`${p.name} ${p.ready?'已准备':'取消准备'}`);}
else if(a.type==='start'){if(p.id!==r.hostId)fail('只有房主可以开始',403);if(r.players.length!==r.capacity||r.players.some(x=>!x.ready||!online(x,now)))fail('需要所有真人玩家到齐、在线并准备',409);r.status='playing';r.round=1;r.turnPlayerId=r.players[0].id;r.phase='roll';log(r,'旅程开始！');}
else fail('大厅中不支持此操作');
}else{
if(p.bankrupt)fail('已破产玩家不能操作',403);if(r.players.some(x=>!x.bankrupt&&!online(x,now)))fail('有玩家离线，游戏暂停；请等待重连或认输',409,'PLAYER_OFFLINE');
if(r.turnPlayerId!==p.id)fail('尚未轮到你',403,'NOT_YOUR_TURN');
if(a.type==='roll'){if(r.phase!=='roll')fail('当前不能掷骰',409);const steps=p.effects.precise??rng(1,p.effects.slow?4:7);delete p.effects.precise;delete p.effects.slow;r.lastDice=steps;const from=p.position,pos=from+steps;if(pos>=BOARD.length){p.cash+=1500;log(r,`${p.name} 经过起点，获得 1500 元`);}p.position=pos%BOARD.length;r.buildUsed=false;r.lastMove={id:r.version+1,playerId:p.id,from,landed:p.position,to:p.position,steps};r.phase='land';land(r,p,rng);r.lastMove.to=p.position;}
else if(a.type==='buy'||a.type==='upgrade'){if(r.phase!=='land')fail('只能在落地阶段购买或升级',409);if(r.buildUsed)fail('每次落地只能购买或升级一次',409);const t=BOARD[p.position];if(t.type!=='property')fail('这里不是地标');const v=r.properties[t.id];if(a.type==='buy'&&v)fail('此地标已经有主人');if(a.type==='upgrade'&&(!v||v.ownerId!==p.id||v.mortgaged||v.level>=3))fail('此地标不能升级');const price=Math.ceil((a.type==='buy'?t.price:t.upgradeCost)*(p.effects.discount?0.5:1));if(p.cash<price)fail('现金不足');p.cash-=price;r.buildUsed=true;delete p.effects.discount;if(a.type==='buy')r.properties[t.id]={ownerId:p.id,level:0,mortgaged:false};else v.level++;log(r,`${p.name} ${a.type==='buy'?'购买':'升级'} ${t.name}，花费 ${price} 元`);}
else if(a.type==='skip'){if(r.phase!=='land')fail('当前不能结束落地阶段',409);r.phase='end';}
else if(a.type==='end'){if(r.phase!=='end')fail('请先完成落地阶段',409);next(r);}
else if(a.type==='useCard'){if(r.phase!=='roll')fail('策略卡只能在掷骰前使用',409);if(r.cardUsed)fail('每回合只能使用一张策略卡',409);if(p.effects[a.cardId]!==undefined)fail('此卡效果仍待触发',409);if(!CARDS.some(c=>c.id===a.cardId)||!p.cards.includes(a.cardId))fail('没有这张卡');if(['precise','slow'].includes(a.cardId)&&r.phase!=='roll')fail('此卡只能在掷骰前使用');if(a.cardId==='precise'&&(!Number.isInteger(a.steps)||a.steps<1||a.steps>6))fail('精准骰子需要 steps:1～6');if(a.cardId==='precise'){p.effects.precise=a.steps;delete p.effects.slow;}else if(a.cardId==='slow'){p.effects.slow=true;delete p.effects.precise;}else if(a.cardId==='bonus')p.cash+=500;else p.effects[a.cardId]=true;p.cards.splice(p.cards.indexOf(a.cardId),1);r.cardUsed=true;log(r,`${p.name} 使用了 ${CARDS.find(c=>c.id===a.cardId).name}`);}
else if(['mortgage','redeem','sellLevel'].includes(a.type)){if(!Number.isInteger(a.tileId))fail('tileId 必须是整数');const t=BOARD[a.tileId],v=r.properties[a.tileId];if(!t||!v||v.ownerId!==p.id)fail('你不拥有此地标');if(a.type==='mortgage'){if(v.mortgaged||v.level)fail('请先出售所有建筑且不可重复抵押');v.mortgaged=true;p.cash+=Math.floor(t.price/2);}else if(a.type==='redeem'){const cost=redemptionCost(t);if(!v.mortgaged||p.cash<cost)fail('无法赎回或现金不足');p.cash-=cost;v.mortgaged=false;}else{if(v.level<=0)fail('没有可出售的建筑');v.level--;p.cash+=Math.floor(t.upgradeCost/2);}log(r,`${p.name} 对 ${t.name} 执行 ${a.type==='mortgage'?'抵押':a.type==='redeem'?'赎回':'出售建筑'}`);}
else fail('未知操作');
}
r.version++;r.updatedAt=now;return r;
}
