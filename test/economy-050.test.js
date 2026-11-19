import test from 'node:test';
import assert from 'node:assert/strict';
import {BOARD} from '../shared/content.js';
import {createRoom,newPlayer,applyAction,publicRoom,netWorth} from '../server/engine.js';
const NOW=100000;
const act=(r,p,a,rng=min=>min)=>applyAction(r,p.id??p,a,{now:NOW,rng});
function game(count=4){const r=createRoom('050050',count,'甲',NOW);r.board=structuredClone(BOARD);while(r.players.length<count)r.players.push(newPlayer(`玩家${r.players.length}`,NOW));for(const p of r.players)act(r,p,{type:'ready',ready:true});act(r,r.hostId,{type:'start'});return r;}
function deed(r,id,p,level=0,mortgaged=false){r.properties[id]={ownerId:p.id,level,mortgaged};}
function rentDebt(){const r=game(),[p,owner]=r.players;p.cash=10;deed(r,1,owner,3);deed(r,2,p,2);deed(r,3,p);act(r,p,{type:'roll'},()=>1);return {r,p,owner};}
function reject(r,p,a){const before=structuredClone(r);assert.throws(()=>act(r,p,a));assert.deepEqual(r,before);}

test('050 starts at 15000; discounted buildings/land use actual liquidation value in public assets',()=>{
 const r=game(),p=r.players[0];assert.equal(p.cash,15000);act(r,p,{type:'useCard',cardId:'discount'});act(r,p,{type:'roll'},()=>1);act(r,p,{type:'buy'});assert.equal(p.cash,14600);assert.equal(netWorth(r,p),15000);r.buildUsed=false;p.effects.discount=true;act(r,p,{type:'upgrade'});assert.equal(p.cash,14400);assert.equal(netWorth(r,p),15000);for(const viewer of r.players){assert.equal(publicRoom(r,viewer.id,NOW).players[0].netWorth,15000);}
});
test('050 mortgage selects exact property, includes buildings, deletes ownership, and later permits fresh purchase',()=>{
 const r=game(),[p,q]=r.players;deed(r,1,p,2);deed(r,2,p,3);const before=p.cash;act(r,p,{type:'mortgage',tileId:2});assert.equal(p.cash,before+Math.floor((BOARD[2].price+3*BOARD[2].upgradeCost)/2));assert.equal(r.properties[2],undefined);assert.equal(r.properties[1].level,2);assert.equal(netWorth(r,p),p.cash+Math.floor((BOARD[1].price+2*BOARD[1].upgradeCost)/2));reject(r,p,{type:'mortgage',tileId:2});reject(r,p,{type:'redeem',tileId:2});r.phase='land';act(r,p,{type:'skip'});q.position=1;act(r,q,{type:'roll'},()=>1);assert.equal(q.cash,15000);act(r,q,{type:'buy'});assert.deepEqual(r.properties[2],{ownerId:q.id,level:0,mortgaged:false});assert.equal(q.cash,15000-BOARD[2].price);
});
test('050 selling building first reduces whole-deed proceeds, with no double construction refund',()=>{
 const a=game(),b=structuredClone(a),p=a.players[0],q=b.players[0];deed(a,1,p,3);deed(b,1,q,3);act(a,p,{type:'mortgage',tileId:1});act(b,q,{type:'sellLevel',tileId:1});assert.equal(b.properties[1].level,2);act(b,q,{type:'mortgage',tileId:1});assert.equal(q.cash,p.cash);assert.equal(q.cash,16000);
});
test('050 rent pauses without partial payment or automatic sale; player chooses another deed and auto-settles once',()=>{
 const {r,p,owner}=rentDebt();assert.equal(p.cash,10);assert.equal(owner.cash,15000);assert.equal(r.phase,'debt');assert.deepEqual(r.debt,{playerId:p.id,recipientId:owner.id,amount:700,reason:'租金',resumePhase:'land'});assert.equal(r.properties[2].level,2);assert.equal(r.turnPlayerId,p.id);assert.match(r.logs.at(-1).text,/待偿租金/);assert.ok(!r.logs.at(-1).text.includes('支付租金 0'));
 act(r,p,{type:'mortgage',tileId:3});assert.equal(p.cash,510);assert.equal(owner.cash,15000);assert.equal(r.phase,'debt');act(r,p,{type:'mortgage',tileId:2});assert.equal(p.cash,660);assert.equal(owner.cash,15700);assert.equal(r.debt,null);assert.equal(r.phase,'land');assert.equal(r.turnPlayerId,p.id);reject(r,p,{type:'settleDebt'});assert.equal(owner.cash,15700);act(r,p,{type:'skip'});assert.equal(r.turnPlayerId,owner.id);
});
test('050 debt is deeply public and restored host state can settle; all ordinary and foreign actions reject unchanged',()=>{
 const {r,p,owner}=rentDebt();const restored=structuredClone(r);for(const viewer of [p.id,owner.id,undefined]){const view=publicRoom(r,viewer,NOW);assert.deepEqual(view.debt,r.debt);view.debt.amount=1;assert.equal(r.debt.amount,700);}
 for(const type of ['roll','skip','end','buy','upgrade','useCard','redeem'])reject(r,p,{type,cardId:'bonus',tileId:2});for(const type of ['roll','mortgage','sellLevel','settleDebt','declareBankruptcy'])reject(r,owner,{type,tileId:1});reject(r,p,{type:'settleDebt'});const rp=restored.players[0];rp.cash=700;act(restored,rp,{type:'settleDebt'});assert.equal(restored.debt,null);assert.equal(restored.phase,'land');assert.equal(restored.players[1].cash,15700);assert.equal(r.debt.amount,700);
});
test('050 manual rent bankruptcy pays only real cash, clears all assets/debt and advances exactly once including wrap',()=>{
 for(const action of ['declareBankruptcy','surrender']){const {r,p,owner}=rentDebt();p.extraRolls=3;act(r,p,{type:'mortgage',tileId:3});act(r,p,{type:action});assert.equal(owner.cash,15510);assert.equal(p.cash,0);assert.equal(p.bankrupt,true);assert.ok(!Object.values(r.properties).some(v=>v.ownerId===p.id));assert.equal(r.debt,null);assert.equal(r.phase,'roll');assert.equal(r.turnPlayerId,owner.id);assert.equal(r.round,1);reject(r,p,{type:action});}
 const r=game(),p=r.players.at(-1),owner=r.players[0];r.turnPlayerId=p.id;p.cash=1;deed(r,1,owner,3);deed(r,2,p);act(r,p,{type:'roll'},()=>1);act(r,p,{type:'mortgage',tileId:2});act(r,p,{type:'declareBankruptcy'});assert.equal(r.round,2);assert.equal(r.turnPlayerId,owner.id);
});
test('050 creditor may surrender during debt; recipient becomes bank and is never revived by settlement',()=>{
 const {r,p,owner}=rentDebt();const turn=r.turnPlayerId;act(r,owner,{type:'surrender'});assert.equal(r.debt.recipientId,null);assert.equal(r.turnPlayerId,turn);act(r,p,{type:'mortgage',tileId:2});assert.equal(r.debt,null);assert.equal(owner.bankrupt,true);assert.equal(owner.cash,0);assert.equal(p.cash,160);
});
test('050 fine remains unpaid pending choice, then manual sale settles or bankrupts to bank',()=>{
 for(const resolve of ['mortgage','declareBankruptcy']){const r=game(),p=r.players[0];p.position=3;p.cash=10;deed(r,2,p,2);const draws=[1,2,8];act(r,p,{type:'roll'},()=>draws.shift());assert.equal(r.debt.recipientId,null);assert.equal(r.debt.amount,800);assert.equal(r.events[0].paid,null);assert.match(r.events[0].message,/现金不足，待偿/);assert.equal(p.cash,10);act(r,p,{type:resolve,tileId:2});assert.equal(r.debt,null);assert.equal(p.bankrupt,resolve==='declareBankruptcy');assert.equal(p.cash,resolve==='mortgage'?60:0);}
});
test('050 two-player debt endings clear both debt and debt phase for either surrendering side',()=>{for(const surrendering of ['debtor','creditor']){const r=game(2),[p,owner]=r.players;p.cash=10;deed(r,1,owner,3);deed(r,2,p);act(r,p,{type:'roll'},()=>1);assert.equal(r.phase,'debt');act(r,surrendering==='debtor'?p:owner,{type:'surrender'});assert.equal(r.status,'finished');assert.equal(r.turnPlayerId,null);assert.equal(r.debt,null);assert.notEqual(r.phase,'debt');assert.equal(owner.cash,surrendering==='debtor'?15010:0);}});
test('050 old mortgaged snapshots cannot yield cash twice or deadlock bankruptcy',()=>{
 const {r,p}=rentDebt();r.properties[2].mortgaged=true;r.properties[3].mortgaged=true;reject(r,p,{type:'mortgage',tileId:2});reject(r,p,{type:'sellLevel',tileId:2});reject(r,p,{type:'redeem',tileId:2});assert.equal(p.cash,10);act(r,p,{type:'declareBankruptcy'});assert.equal(r.debt,null);assert.equal(p.bankrupt,true);assert.equal(r.turnPlayerId,r.players[1].id);
});
test('050 rail finds next room-board station, transfers once and rewards crossing start',()=>{
 const r=game(),p=r.players[0];p.position=23;const cash=p.cash;act(r,p,{type:'roll'},()=>1);assert.equal(p.position,8);assert.deepEqual(r.lastMove,{id:r.version,playerId:p.id,from:23,landed:24,to:8,steps:1,transfer:'station'});assert.equal(p.cash,cash+1500);assert.equal(r.logs.filter(l=>l.text.includes('到达')).length,1);assert.equal(r.events.length,0);assert.equal(r.phase,'land');r.phase='roll';p.position=31;act(r,p,{type:'roll'},()=>1);assert.equal(p.cash,cash+3000);
 const s=game(),q=s.players[0];[s.board[2],s.board[8]]=[s.board[8],s.board[2]];[s.board[5],s.board[24]]=[s.board[24],s.board[5]];s.board=s.board.map((t,id)=>({...t,id}));q.position=1;act(s,q,{type:'roll'},()=>1);assert.equal(q.position,5);assert.equal(s.lastMove.landed,2);assert.equal(s.lastMove.to,5);assert.equal(q.cash,15000);
});
test('050 two shops and legacy park fallback grant only a card, no park bonus',()=>{
 assert.equal(BOARD.filter(t=>t.type==='shop').length,2);assert.equal(BOARD.some(t=>t.type==='park'),false);assert.equal(BOARD[28].name,'第二旅行商店');for(const id of [16,28])for(const legacy of [false,true]){const r=game(),p=r.players[0];if(legacy)r.board[id].type='park';p.position=id-1;const cards=p.cards.length,draws=[1,0];act(r,p,{type:'roll'},()=>draws.shift());assert.equal(p.cards.length,cards+1);assert.equal(p.cash,15000);}
});
