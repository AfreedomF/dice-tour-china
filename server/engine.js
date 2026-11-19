import {randomInt,randomUUID} from '../shared/random.js';
import {BOARD,CARDS} from '../shared/content.js';
export const OFFLINE_MS=30_000;
export class GameError extends Error {constructor(message,status=400,code='INVALID_ACTION'){super(message);this.status=status;this.code=code;}}
const fail=(text,status=400,code)=>{throw new GameError(text,status,code);};
const log=(r,text)=>{r.logs.push({text});r.logs=r.logs.slice(-80);};
function playerName(name){if(typeof name!=='string')fail('请输入昵称');const value=name.trim();if(value.length<1||value.length>20||/[\x00-\x1f\x7f]/.test(value))fail('昵称需为 1～20 个可见字符');return value;}
export function newPlayer(name,now=Date.now()){name=playerName(name);return {id:randomUUID(),name,cash:15000,position:0,ready:false,online:true,bankrupt:false,stamps:[],cards:['precise','shield','discount'],lastSeen:now,effects:{},extraRolls:0,skipTurns:0};}
function shuffledBoard(rng){const board=structuredClone(BOARD);for(let i=board.length-1;i>1;i--){const j=rng(1,i+1);[board[i],board[j]]=[board[j],board[i]];}return board.map((tile,id)=>({...tile,sourceId:tile.id,id}));}
export function createRoom(code,capacity,name,now=Date.now(),{rng=randomInt}={}) {if(![2,4].includes(capacity))fail('房间仅支持 2 人或 4 人');const p=newPlayer(name,now);return {code,capacity,status:'lobby',version:1,hostId:p.id,round:0,maxRounds:null,board:shuffledBoard(rng),turnPlayerId:null,phase:'roll',debt:null,lastDice:null,lastMove:null,events:[],cardUsed:false,buildUsed:false,players:[p],properties:{},logs:[{text:`${p.name} 创建了房间`}],createdAt:now,updatedAt:now,receipts:[]};}
export function online(p,now=Date.now()){return now-p.lastSeen<=OFFLINE_MS;}
export function publicRoom(r,playerId,now=Date.now()) {return {code:r.code,capacity:r.capacity,status:r.status,version:r.version,hostId:r.hostId,round:r.round,maxRounds:null,board:structuredClone(r.board??BOARD),turnPlayerId:r.turnPlayerId,phase:r.phase,debt:structuredClone(r.debt??null),lastDice:r.lastDice,lastMove:structuredClone(r.lastMove??null),events:structuredClone(r.events??[]),cardUsed:!!r.cardUsed,buildUsed:!!r.buildUsed,players:r.players.map(p=>({id:p.id,name:p.name,cash:p.cash,netWorth:netWorth(r,p),position:p.position,ready:p.ready,online:online(p,now),bankrupt:p.bankrupt,extraRolls:p.extraRolls??0,skipTurns:p.skipTurns??0,stamps:[...p.stamps],...(p.id===playerId?{cards:[...p.cards],effects:{...p.effects}}:{cardCount:p.cards.length})})),properties:structuredClone(r.properties),logs:structuredClone(r.logs),...(r.rankings?{rankings:structuredClone(r.rankings)}:{})};}
const liquidationValue=(t,v)=>v.mortgaged?0:Math.floor((t.price+v.level*t.upgradeCost)/2);
// Cash plus each deed's actual liquidation proceeds, rounded per property.
// Legacy mortgaged deeds cannot yield more cash and carry no redemption debt.
export function netWorth(r,p){return p.cash+Object.entries(r.properties).reduce((sum,[id,v])=>v.ownerId===p.id?sum+liquidationValue((r.board??BOARD)[Number(id)],v):sum,0);}
function finish(r){if(r.debt){r.debt=null;r.phase='land';}r.status='finished';r.turnPlayerId=null;r.rankings=r.players.map(p=>({playerId:p.id,name:p.name,netWorth:netWorth(r,p),bankrupt:p.bankrupt,stamps:p.stamps.length})).sort((a,b)=>Number(a.bankrupt)-Number(b.bankrupt)||b.netWorth-a.netWorth);r.rankings.forEach((entry,i,list)=>{const prev=list[i-1];entry.rank=prev&&entry.bankrupt===prev.bankrupt&&entry.netWorth===prev.netWorth?prev.rank:i+1;});log(r,'旅程结束，按净资产结算排名（同资产同名次，破产者列后）');}
function next(r){const survivors=r.players.filter(p=>!p.bankrupt);if(survivors.length<=1){finish(r);return;}
const current=r.players.find(p=>p.id===r.turnPlayerId);
// Extra rolls belong to this turn: consume one credit, never the card allowance.
if(current&&!current.bankrupt&&(current.extraRolls??0)>0){current.extraRolls--;r.phase='roll';r.lastDice=null;r.buildUsed=false;return;}
let i=r.players.findIndex(p=>p.id===r.turnPlayerId);
// Include every pending skipped turn, so even restored all-skipping snapshots
// eventually select a player; rounds are counters, never a game limit.
const limit=r.players.length*2+r.players.reduce((sum,p)=>sum+(p.bankrupt?0:(p.skipTurns??0)),0);
for(let n=0;n<limit;n++){i++;if(i>=r.players.length){i=0;r.round++;}const candidate=r.players[i];if(candidate.bankrupt)continue;if((candidate.skipTurns??0)>0){candidate.skipTurns--;log(r,`${candidate.name} 暂停旅行，跳过本回合`);continue;}r.turnPlayerId=candidate.id;r.phase='roll';r.lastDice=null;r.cardUsed=false;r.buildUsed=false;return;}}
function bankrupt(r,p){p.bankrupt=true;p.cash=0;p.cards=[];p.effects={};for(const [id,v] of Object.entries(r.properties))if(v.ownerId===p.id)delete r.properties[id];log(r,`${p.name} 破产退场`);}
function creditor(r,id){return r.players.find(p=>p.id===id&&!p.bankrupt);}
function transfer(r,p,amount,recipientId){const paid=Math.min(p.cash,amount);p.cash-=paid;const recipient=creditor(r,recipientId);if(recipient)recipient.cash+=paid;return paid;}
function settleDebt(r,p){const debt=r.debt;if(!debt||debt.playerId!==p.id)fail('你没有待偿债务',409);if(p.cash<debt.amount)fail('现金不足，请先变现房产或宣布破产',409);const paid=transfer(r,p,debt.amount,debt.recipientId);r.debt=null;r.phase=debt.resumePhase;log(r,`${p.name} 偿清${debt.reason??'债务'} ${paid} 元`);}
function autoSettle(r,p){if(r.debt?.playerId===p.id&&p.cash>=r.debt.amount)settleDebt(r,p);}
function abandonDebt(r,p){const debt=r.debt;if(debt?.playerId===p.id){const paid=transfer(r,p,debt.amount,debt.recipientId);log(r,`${p.name} 退场前实付${debt.reason??'债务'} ${paid} 元（应付 ${debt.amount} 元）`);r.debt=null;r.phase=debt.resumePhase;}bankrupt(r,p);checkFinish(r);if(r.status==='playing')next(r);}
function pay(r,p,amount,recipient,reason){if(p.cash<amount&&Object.values(r.properties).some(v=>v.ownerId===p.id)){
// Preserve legacy mortgaged assets too: the debtor can always declare bankruptcy.
r.debt={playerId:p.id,recipientId:recipient?.id??null,amount,...(reason?{reason}:{}),resumePhase:'land'};r.phase='debt';return null;}
const paid=transfer(r,p,amount,recipient?.id);if(paid<amount)bankrupt(r,p);return paid;}
function checkFinish(r){if(r.players.filter(p=>!p.bankrupt).length<=1)finish(r);}
function land(r,p,rng){const t=(r.board??BOARD)[p.position];log(r,`${p.name} 到达 ${t.name}`);if(t.type==='property'){if(!p.stamps.includes(t.city))p.stamps.push(t.city);const v=r.properties[t.id];if(v&&v.ownerId!==p.id&&!v.mortgaged){const owner=r.players.find(x=>x.id===v.ownerId);let rent=t.baseRent*(1+v.level*2);const cityTiles=(r.board??BOARD).filter(x=>x.city===t.city);if(cityTiles.every(x=>r.properties[x.id]?.ownerId===owner.id))rent*=2;if(p.effects.shield){delete p.effects.shield;log(r,`${p.name} 的免租卡抵挡了 ${rent} 元租金`);}else{const paid=pay(r,p,rent,owner,'租金');log(r,paid===null?`${p.name} 现金不足，待偿租金 ${rent} 元（债权人 ${owner.name}）`:`${p.name} 向 ${owner.name} 支付租金 ${paid} 元${paid<rent?`（应付 ${rent} 元）`:''}`);}}}
else if(t.type==='event'){
const draw=rng(0,10),version=r.version+1;
const event={id:String(version),playerId:p.id,playerName:p.name,kind:['reward','reward','fine','fine','extra_roll','extra_roll','jail','jail','return_start','jail_free'][draw],title:'',message:'',version};
if(draw<2){event.title='城市奖励';event.amount=rng(5,11)*100;p.cash+=event.amount;event.message=`${p.name} 获得城市奖励 ${event.amount} 元`;}
else if(draw<4){event.title='旅行罚款';event.amount=rng(5,9)*100;event.paid=pay(r,p,event.amount,null,'旅行罚款');event.message=event.paid===null?`${p.name} 现金不足，待偿旅行罚款 ${event.amount} 元`:`${p.name} 支付旅行罚款 ${event.paid} 元${event.paid<event.amount?`（应付 ${event.amount} 元）`:''}`;}
else if(draw<6){event.title='再掷一次';p.extraRolls=(p.extraRolls??0)+1;event.message=`${p.name} 获得一次额外掷骰，结束本次停留后继续旅行`;}
else if(draw<8){event.title='坐牢轮空';p.skipTurns=1;event.message=`${p.name} 坐牢，下次轮到时跳过一个回合，可在本次停留使用出狱卡`;}
else if(draw===8){event.title='返回起点';p.position=0;p.extraRolls=0;event.message=`${p.name} 返回起点，不领取经过起点奖励，立即交给下一位玩家`;}
else{event.title='获得出狱卡';event.granted=p.cards.length<12;if(event.granted)p.cards.push('jail_free');event.message=event.granted?`${p.name} 获得一张出狱卡`:`${p.name} 手牌已满，未获得出狱卡`;}
r.events=[...(r.events??[]),event].slice(-20);log(r,event.message);if(draw===8)next(r);
}
else if(t.type==='station'){const board=r.board??BOARD;for(let steps=1;steps<board.length;steps++){const to=(p.position+steps)%board.length;if(board[to].type==='station'){if(p.position+steps>=board.length){p.cash+=1500;log(r,`${p.name} 高铁经过起点，获得 1500 元`);}p.position=to;if(r.lastMove)r.lastMove.transfer='station';log(r,`${p.name} 乘高铁前往 ${board[to].name}；不触发终站落点`);break;}}}
else if(t.type==='shop'||t.type==='park'){if(p.cards.length<12){const shopCards=CARDS.filter(c=>c.id!=='jail_free');p.cards.push(shopCards[rng(0,shopCards.length)].id);log(r,'旅行商店赠送一张旅行卡');}}
checkFinish(r);if(r.status==='playing'&&p.bankrupt)next(r);}
// Mutates the supplied room. Persistence/network callers must apply to a clone
// or use a transaction and discard on error (including exceptions from rng).
export function applyAction(r,playerId,a,{now=Date.now(),rng=randomInt}={}){
if(!a||typeof a!=='object'||Array.isArray(a)||typeof a.type!=='string')fail('需要有效操作');
const p=r.players.find(x=>x.id===playerId);if(!p)fail('你不在这个房间',403);if(r.status==='finished')fail('本局已经结束',409);
if(a.type==='surrender'){if(r.status!=='playing'||p.bankrupt)fail('当前不能认输');if(r.debt?.playerId===p.id)abandonDebt(r,p);else{const wasTurn=r.turnPlayerId===p.id;bankrupt(r,p);if(r.debt?.recipientId===p.id)r.debt.recipientId=null;checkFinish(r);if(r.status==='playing'&&wasTurn)next(r);}}
else if(r.status==='lobby'){
if(a.type==='ready'){if(typeof a.ready!=='boolean')fail('ready 必须为布尔值');p.ready=a.ready;log(r,`${p.name} ${p.ready?'已准备':'取消准备'}`);}
else if(a.type==='start'){if(p.id!==r.hostId)fail('只有房主可以开始',403);if(r.players.length!==r.capacity||r.players.some(x=>!x.ready||!online(x,now)))fail('需要所有真人玩家到齐、在线并准备',409);r.status='playing';r.round=1;r.turnPlayerId=r.players[0].id;r.phase='roll';log(r,'旅程开始！');}
else fail('大厅中不支持此操作');
}else{
if(p.bankrupt)fail('已破产玩家不能操作',403);if(r.players.some(x=>!x.bankrupt&&!online(x,now)))fail('有玩家离线，游戏暂停；请等待重连或认输',409,'PLAYER_OFFLINE');
if(r.debt&&(r.debt.playerId!==p.id||!['mortgage','sellLevel','settleDebt','declareBankruptcy'].includes(a.type)))fail('偿债阶段仅债务人可以变现房产、偿债或宣布破产',409,'DEBT_PENDING');
if(r.turnPlayerId!==p.id)fail('尚未轮到你',403,'NOT_YOUR_TURN');
if(a.type==='roll'){if(r.phase!=='roll')fail('当前不能掷骰',409);const steps=p.effects.precise??rng(1,p.effects.slow?4:7);delete p.effects.precise;delete p.effects.slow;r.lastDice=steps;const from=p.position,pos=from+steps;if(pos>=(r.board??BOARD).length){p.cash+=1500;log(r,`${p.name} 经过起点，获得 1500 元`);}p.position=pos%(r.board??BOARD).length;r.buildUsed=false;r.lastMove={id:r.version+1,playerId:p.id,from,landed:p.position,to:p.position,steps};r.phase='land';land(r,p,rng);r.lastMove.to=p.position;}
else if(a.type==='buy'||a.type==='upgrade'){if(r.phase!=='land')fail('只能在落地阶段购买或升级',409);if(r.buildUsed)fail('每次落地只能购买或升级一次',409);const t=(r.board??BOARD)[p.position];if(t.type!=='property')fail('这里不是地标');const v=r.properties[t.id];if(a.type==='buy'&&v)fail('此地标已经有主人');if(a.type==='upgrade'&&(!v||v.ownerId!==p.id||v.mortgaged||v.level>=3))fail('此地标不能升级');const price=Math.ceil((a.type==='buy'?t.price:t.upgradeCost)*(p.effects.discount?0.5:1));if(p.cash<price)fail('现金不足');p.cash-=price;r.buildUsed=true;delete p.effects.discount;if(a.type==='buy')r.properties[t.id]={ownerId:p.id,level:0,mortgaged:false};else v.level++;log(r,`${p.name} ${a.type==='buy'?'购买':'升级'} ${t.name}，花费 ${price} 元`);}
else if(a.type==='skip'){if(r.phase!=='land')fail('当前不能结束落地阶段',409);next(r);}
else if(a.type==='end'){if(r.phase!=='end')fail('请先完成落地阶段',409);next(r);}
else if(a.type==='useCard'&&a.cardId==='jail_free'){if(r.phase!=='land'||!(p.skipTurns>0))fail('仅可在本次坐牢停留时使用出狱卡',409);if(!p.cards.includes('jail_free'))fail('没有这张卡');p.cards.splice(p.cards.indexOf('jail_free'),1);p.skipTurns=0;log(r,`${p.name} 使用了出狱卡，取消下次轮空`);}
else if(a.type==='useCard'){if(r.phase!=='roll')fail('策略卡只能在掷骰前使用',409);if(r.cardUsed)fail('每回合只能使用一张策略卡',409);if(p.effects[a.cardId]!==undefined)fail('此卡效果仍待触发',409);if(!CARDS.some(c=>c.id===a.cardId)||!p.cards.includes(a.cardId))fail('没有这张卡');if(['precise','slow'].includes(a.cardId)&&r.phase!=='roll')fail('此卡只能在掷骰前使用');if(a.cardId==='precise'&&(!Number.isInteger(a.steps)||a.steps<1||a.steps>6))fail('精准骰子需要 steps:1～6');if(a.cardId==='precise'){p.effects.precise=a.steps;delete p.effects.slow;}else if(a.cardId==='slow'){p.effects.slow=true;delete p.effects.precise;}else if(a.cardId==='bonus')p.cash+=500;else p.effects[a.cardId]=true;p.cards.splice(p.cards.indexOf(a.cardId),1);r.cardUsed=true;log(r,`${p.name} 使用了 ${CARDS.find(c=>c.id===a.cardId).name}`);}
else if(a.type==='settleDebt')settleDebt(r,p);
else if(a.type==='declareBankruptcy'){if(!r.debt||r.debt.playerId!==p.id)fail('仅待偿债务人可以宣布破产',409);abandonDebt(r,p);}
else if(a.type==='redeem')fail('不再支持赎回；变现后产权已释放，可在下次落点重新购买',409);
else if(['mortgage','sellLevel'].includes(a.type)){if(!Number.isInteger(a.tileId))fail('tileId 必须是整数');const t=(r.board??BOARD)[a.tileId],v=r.properties[a.tileId];if(!t||!v||v.ownerId!==p.id)fail('你不拥有此地标');if(v.mortgaged)fail('旧存档已抵押房产不可再次变现；建议开启新房间，或宣布破产',409);if(a.type==='mortgage'){const proceeds=liquidationValue(t,v);p.cash+=proceeds;delete r.properties[a.tileId];log(r,`${p.name} 变现 ${t.name} 获得 ${proceeds} 元，产权及建筑释放`);}else{if(v.level<=0)fail('没有可出售的建筑');v.level--;p.cash+=Math.floor(t.upgradeCost/2);log(r,`${p.name} 出售 ${t.name} 一级建筑`);}autoSettle(r,p);}
else fail('未知操作');
}
r.version++;r.updatedAt=now;return r;
}
