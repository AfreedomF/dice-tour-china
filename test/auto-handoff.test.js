import test from 'node:test';
import assert from 'node:assert/strict';
import {BOARD} from '../shared/content.js';
import {createRoom,newPlayer,applyAction,publicRoom} from '../server/engine.js';
const NOW=100000;
const act=(r,p,a,rng=()=>1)=>applyAction(r,p.id??p,a,{now:NOW,rng});
function game(count){const r=createRoom('052052',count,'甲',NOW);r.board=structuredClone(BOARD);while(r.players.length<count)r.players.push(newPlayer(`玩家${r.players.length}`,NOW));for(const p of r.players)act(r,p,{type:'ready',ready:true});act(r,r.hostId,{type:'start'});return r;}
function reject(r,p,a){const before=structuredClone(r);assert.throws(()=>act(r,p,a));assert.deepEqual(r,before);}
for(const count of [2,4])for(const kind of ['station','lone station','own level3','legacy mortgaged own level3'])for(const wrap of [false,true])test(`052 ${count} players ${kind} ${wrap?'wraps':'does not wrap'} and hands off once`,()=>{
 const r=game(count),p=wrap?r.players.at(-1):r.players[0],next=wrap?r.players[0]:r.players[1];r.turnPlayerId=p.id;p.extraRolls=3;r.cardUsed=true;r.buildUsed=true;
 const station=kind.includes('station'),landed=station?24:1;p.position=landed-1;
 if(station&&kind==='lone station')r.board[8].type='start';
 if(!station)r.properties[landed]={ownerId:p.id,level:3,mortgaged:kind.startsWith('legacy')};
 const cash=p.cash,version=r.version+1;act(r,p,{type:'roll'});
 const to=kind==='station'?8:landed;
 assert.equal(p.position,to);assert.equal(p.cash,cash+(kind==='station'?1500:0));assert.equal(p.extraRolls,0);assert.equal(r.turnPlayerId,next.id);assert.equal(r.phase,'roll');assert.equal(r.round,wrap?2:1);assert.equal(r.lastDice,null);assert.equal(r.cardUsed,false);assert.equal(r.buildUsed,false);assert.equal(r.version,version);assert.equal(r.debt,null);
 assert.deepEqual(r.lastMove,{id:version,playerId:p.id,from:landed-1,landed,to,steps:1,...(kind==='station'?{transfer:'station'}:{})});
 for(const viewer of r.players)assert.deepEqual(publicRoom(r,viewer.id,NOW).lastMove,r.lastMove);
 reject(r,p,{type:'skip'});assert.equal(r.turnPlayerId,next.id);assert.equal(r.round,wrap?2:1);
});
for(const kind of ['station','own level3','return_start'])test(`052 ${kind} automatic handoff skips jail and bankrupt seats once`,()=>{
 const r=game(4),[p,dead,jailed,next]=r.players;dead.bankrupt=true;jailed.skipTurns=1;p.extraRolls=4;next.extraRolls=2;
 p.position=kind==='station'?7:kind==='own level3'?0:3;if(kind==='own level3')r.properties[1]={ownerId:p.id,level:3,mortgaged:false};
 const values=kind==='return_start'?[1,8]:[1];act(r,p,{type:'roll'},()=>values.shift());
 assert.equal(r.turnPlayerId,next.id);assert.equal(r.phase,'roll');assert.equal(r.round,1);assert.equal(jailed.skipTurns,0);assert.equal(p.extraRolls,0);assert.equal(next.extraRolls,2);assert.equal(r.logs.filter(l=>l.text.includes('跳过本回合')).length,1);assert.equal(r.lastMove.playerId,p.id);assert.equal(r.lastDice,null);
 if(kind==='return_start'){assert.equal(p.position,0);assert.equal(p.cash,10000);assert.deepEqual([r.lastMove.from,r.lastMove.landed,r.lastMove.to,r.lastMove.steps],[3,4,0,1]);}
});
for(const level of [0,1,2])test(`052 own level ${level} remains land, including upgrade to max`,()=>{
 const r=game(2),p=r.players[0];r.properties[1]={ownerId:p.id,level,mortgaged:false};p.extraRolls=2;act(r,p,{type:'roll'});assert.equal(r.phase,'land');assert.equal(r.turnPlayerId,p.id);assert.equal(p.cash,10000);assert.equal(p.extraRolls,2);
 act(r,p,{type:'upgrade'});assert.equal(r.properties[1].level,level+1);assert.equal(r.phase,'land');assert.equal(r.turnPlayerId,p.id);act(r,p,{type:'skip'});assert.equal(r.turnPlayerId,p.id);assert.equal(p.extraRolls,1);
});
for(const kind of ['unowned','other level3','other mortgaged level3','shop','start','reward'])test(`052 ${kind} is not an automatic handoff`,()=>{
 const r=game(2),[p,q]=r.players;p.extraRolls=2;
 if(kind.startsWith('other'))r.properties[1]={ownerId:q.id,level:3,mortgaged:kind.includes('mortgaged')};
 const landed=kind==='shop'?16:kind==='start'?0:kind==='reward'?4:1;p.position=(landed+31)%32;const values=kind==='reward'?[1,0,5]:[1,0];act(r,p,{type:'roll'},()=>values.shift());
 assert.equal(r.turnPlayerId,p.id);assert.equal(r.phase,'land');assert.equal(p.extraRolls,2);if(kind==='other level3'){assert.equal(p.cash,9300);assert.equal(q.cash,10700);}assert.equal(r.lastMove.playerId,p.id);
});
test('052 rent debt never advances or consumes extras and blocks skip',()=>{
 const r=game(4),[p,q]=r.players;p.cash=1;p.extraRolls=3;r.properties[1]={ownerId:q.id,level:3,mortgaged:false};r.properties[2]={ownerId:p.id,level:0,mortgaged:false};act(r,p,{type:'roll'});assert.equal(r.phase,'debt');assert.equal(r.turnPlayerId,p.id);assert.equal(p.extraRolls,3);assert.equal(r.debt.amount,700);reject(r,p,{type:'skip'});
});
test('052 dice and rail wrap each award 1500 while handing off once',()=>{
 const r=game(2),p=r.players[1];r.turnPlayerId=p.id;r.board=r.board.map((t,id)=>({...t,type:[1,2].includes(id)?'station':'start'}));p.position=31;p.extraRolls=2;act(r,p,{type:'roll'},()=>3);assert.equal(p.cash,13000);assert.equal(p.position,1);assert.equal(r.round,2);assert.equal(r.turnPlayerId,r.players[0].id);assert.equal(p.extraRolls,0);assert.deepEqual(r.lastMove,{id:r.version,playerId:p.id,from:31,landed:2,to:1,steps:3,transfer:'station'});
});
