import test from 'node:test';
import assert from 'node:assert/strict';
import {BOARD,CARDS} from '../shared/content.js';
import {createRoom,newPlayer,applyAction,publicRoom,netWorth} from '../server/engine.js';
const NOW=100000;
const act=(r,p,a,rng=min=>min)=>applyAction(r,p.id??p,a,{now:NOW,rng});
function game({fixed=true,rng=min=>min}={}){const r=createRoom('040040',2,'甲',NOW,{rng});if(fixed)r.board=structuredClone(BOARD);r.players.push(newPlayer('乙',NOW));for(const p of r.players)act(r,p,{type:'ready',ready:true});act(r,r.hostId,{type:'start'});return r;}
function event(r,ticket){const p=r.players.find(p=>p.id===r.turnPlayerId);p.position=3;const values=[1,ticket];act(r,p,{type:'roll'},()=>values.shift());return p;}
function reject(r,p,a){const before=structuredClone(r);assert.throws(()=>act(r,p,a));assert.deepEqual(r,before);}

test('room shuffle is Fisher-Yates over positions 1..31, with independent boards and immutable template',()=>{
 const original=structuredClone(BOARD),calls=[];const a=createRoom('040001',2,'甲',NOW,{rng:(min,max)=>{calls.push([min,max]);return min;}}),b=createRoom('040002',2,'乙',NOW,{rng:(min,max)=>max-1});
 assert.deepEqual(calls,Array.from({length:30},(_,n)=>[1,32-n]));assert.deepEqual(a.board[0],{...BOARD[0],sourceId:0});assert.deepEqual(a.board.map(t=>t.id),Array.from({length:32},(_,i)=>i));assert.deepEqual(a.board.map(t=>t.sourceId).sort((a,b)=>a-b),Array.from({length:32},(_,i)=>i));assert.notDeepEqual(a.board,b.board);assert.deepEqual(b.board.map(t=>t.sourceId),Array.from({length:32},(_,i)=>i));
 for(const t of a.board){const {sourceId,id,...content}=t;const {id:oldId,...expected}=BOARD[sourceId];assert.deepEqual(content,expected);}
 a.board[1].name='changed';assert.deepEqual(BOARD,original);assert.notEqual(b.board[1].name,'changed');assert.equal(a.maxRounds,null);
});
test('public board is deeply cloned and legacy rooms use template board without mutation',()=>{
 const r=game({fixed:false}),before=structuredClone(r.board);for(const viewer of [r.hostId,r.players[1].id,undefined]){const view=publicRoom(r,viewer,NOW);assert.deepEqual(view.board,before);view.board[0].name='changed';view.board.pop();assert.deepEqual(r.board,before);}
 delete r.board;r.maxRounds=20;const view=publicRoom(r,r.hostId,NOW);assert.deepEqual(view.board,BOARD);assert.equal(view.maxRounds,null);view.board[1].price=0;assert.equal(BOARD[1].price,800);act(r,r.hostId,{type:'roll'},()=>1);act(r,r.hostId,{type:'buy'});assert.equal(r.players[0].cash,14200);
});
test('all property economics use shuffled position IDs rather than template IDs',()=>{
 const r=game({fixed:false}),p=r.players[0],other=r.players[1],tile=r.board[1];assert.equal(tile.sourceId,2);act(r,p,{type:'roll'},()=>1);act(r,p,{type:'buy'});assert.equal(p.cash,15000-tile.price);assert.equal(r.properties[1].ownerId,p.id);assert.equal(r.properties[tile.sourceId],undefined);assert.equal(netWorth(r,p),p.cash+Math.floor(tile.price/2));
 act(r,p,{type:'mortgage',tileId:1});const principal=Math.floor(tile.price/2);assert.equal(p.cash,15000-tile.price+principal);assert.equal(netWorth(r,p),p.cash);assert.equal(r.properties[1],undefined);reject(r,p,{type:'redeem',tileId:1});
 act(r,p,{type:'skip'});other.position=0;act(r,other,{type:'roll'},()=>1);assert.equal(other.cash,15000);assert.equal(p.cash,15000-tile.price+principal);act(r,other,{type:'buy'});assert.equal(r.properties[1].ownerId,other.id);
});
test('shuffled upgrade and building sale use room costs, not template costs',()=>{
 const r=game({fixed:false}),p=r.players[0],tile=r.board.find(t=>t.type==='property'&&t.upgradeCost!==BOARD[t.id]?.upgradeCost);assert.ok(tile);p.position=tile.id;r.phase='land';r.properties[tile.id]={ownerId:p.id,level:0,mortgaged:false};const before=p.cash;act(r,p,{type:'upgrade'});assert.equal(p.cash,before-tile.upgradeCost);assert.equal(netWorth(r,p),p.cash+Math.floor((tile.price+tile.upgradeCost)/2));act(r,p,{type:'sellLevel',tileId:tile.id});assert.equal(p.cash,before-tile.upgradeCost+Math.floor(tile.upgradeCost/2));assert.equal(r.properties[tile.id].level,0);
});
test('shuffled city monopoly and liquidation use room tiles and room prices',()=>{
 const r=game({fixed:false}),p=r.players[0],owner=r.players[1],tile=r.board[1];for(const t of r.board.filter(t=>t.city===tile.city))r.properties[t.id]={ownerId:owner.id,level:0,mortgaged:false};act(r,p,{type:'roll'},()=>1);assert.equal(p.cash,15000-2*tile.baseRent);
 const s=game({fixed:false}),debtor=s.players[0],creditor=s.players[1],deed=s.board[2],target=s.board[1];s.properties[1]={ownerId:creditor.id,level:3,mortgaged:false};s.properties[2]={ownerId:debtor.id,level:0,mortgaged:false};debtor.cash=1;act(s,debtor,{type:'roll'},()=>1);assert.equal(s.phase,'debt');act(s,debtor,{type:'mortgage',tileId:2});assert.equal(s.phase,'debt');act(s,debtor,{type:'declareBankruptcy'});assert.equal(creditor.cash,15000+Math.min(1+Math.floor(deed.price/2),target.baseRent*7));assert.equal(debtor.bankrupt,true);
});
test('jail-free event gives a private real card with twelve-card cap, never a free immediate escape',()=>{
 for(const count of [0,11,12]){const r=game(),p=r.players[0];p.cards=Array(count).fill('bonus');event(r,9);const e=r.events.at(-1);assert.equal(e.kind,'jail_free');assert.equal(e.granted,count<12);assert.equal(p.cards.length,Math.min(12,count+1));assert.equal(p.cards.includes('jail_free'),count<12);assert.equal(p.skipTurns,0);assert.equal(r.phase,'land');reject(r,p,{type:'useCard',cardId:'jail_free'});const self=publicRoom(r,p.id,NOW),other=publicRoom(r,r.players[1].id,NOW);assert.deepEqual(self.players[0].cards,p.cards);assert.equal(other.players[0].cards,undefined);assert.equal(other.players[0].cardCount,p.cards.length);if(count===12)assert.match(e.message,/手牌已满/);}
});
test('shop draws only the original five cards and uses rng(0,5)',()=>{
 assert.equal(CARDS.find(c=>c.id==='jail_free').name,'出狱卡');for(let index=0;index<5;index++){const r=game(),p=r.players[0];p.position=15;p.cards=[];const calls=[];act(r,p,{type:'roll'},(min,max)=>{calls.push([min,max]);return calls.length===1?1:index;});assert.deepEqual(calls,[[1,7],[0,5]]);assert.deepEqual(p.cards,[CARDS[index].id]);assert.notEqual(p.cards[0],'jail_free');}
});
for(const cardUsed of [false,true])test(`jail-free can be used immediately in jail landing with strategy allowance ${cardUsed}`,()=>{
 const r=game(),p=r.players[0];p.cards=['jail_free','bonus'];reject(r,p,{type:'useCard',cardId:'jail_free'});if(cardUsed)act(r,p,{type:'useCard',cardId:'bonus'});event(r,6);assert.equal(r.phase,'land');assert.equal(r.turnPlayerId,p.id);assert.equal(p.skipTurns,1);assert.equal(r.cardUsed,cardUsed);act(r,p,{type:'useCard',cardId:'jail_free'});assert.equal(p.skipTurns,0);assert.equal(p.cards.includes('jail_free'),false);assert.equal(r.cardUsed,cardUsed);assert.equal(r.phase,'land');reject(r,p,{type:'useCard',cardId:'jail_free'});act(r,p,{type:'skip'});const other=r.players[1];act(r,other,{type:'roll'},()=>1);act(r,other,{type:'skip'});assert.equal(r.turnPlayerId,p.id);assert.equal(r.phase,'roll');assert.equal(r.cardUsed,false);
});
test('unused jail-free card stays held while the next scheduled turn is skipped exactly once',()=>{
 const r=game(),p=r.players[0],other=r.players[1];p.cards=['jail_free'];event(r,7);act(r,p,{type:'skip'});reject(r,p,{type:'useCard',cardId:'jail_free'});act(r,other,{type:'roll'},()=>1);act(r,other,{type:'skip'});assert.equal(p.skipTurns,0);assert.equal(r.turnPlayerId,other.id);assert.deepEqual(p.cards,['jail_free']);act(r,other,{type:'roll'},()=>1);act(r,other,{type:'skip'});assert.equal(r.turnPlayerId,p.id);reject(r,p,{type:'useCard',cardId:'jail_free'});
});
