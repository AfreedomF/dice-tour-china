import test from 'node:test';
import assert from 'node:assert/strict';
import {BOARD} from '../shared/content.js';
import {createRoom,newPlayer,applyAction,publicRoom,netWorth} from '../server/engine.js';
const NOW=100000;
const act=(r,p,a,rng=min=>min)=>applyAction(r,p.id??p,a,{now:NOW,rng});
function game(){const r=createRoom('051051',2,'甲',NOW);r.board=structuredClone(BOARD);r.players.push(newPlayer('乙',NOW));for(const p of r.players)act(r,p,{type:'ready',ready:true});act(r,r.hostId,{type:'start'});return r;}
function deed(r,id,p,level=0,mortgaged=false){r.properties[id]={ownerId:p.id,level,mortgaged};}
function railGame(stations){const r=game();r.board=r.board.map((t,id)=>({...t,type:stations.includes(id)?'station':'start'}));return r;}
const bonuses=r=>r.logs.filter(l=>l.text.includes('获得 1500 元')).length;

test('051 net worth rounds each deed separately, ignores foreign and legacy mortgaged deeds, and survives whole-deed liquidation',()=>{
 const r=game(),[p,q]=r.players;p.cash=123;
 Object.assign(r.board[1],{price:801,upgradeCost:401});Object.assign(r.board[2],{price:903,upgradeCost:403});
 deed(r,1,p,2);deed(r,2,p);deed(r,3,p,3,true);deed(r,5,q,3);
 // floor(1603/2)+floor(903/2)=801+451, not floor(2506/2)=1253.
 const expected=123+801+451;assert.equal(netWorth(r,p),expected);
 for(const viewer of [p.id,q.id,undefined])assert.equal(publicRoom(r,viewer,NOW).players[0].netWorth,expected);
 for(const tileId of [1,2]){act(r,p,{type:'mortgage',tileId});assert.equal(netWorth(r,p),expected);assert.equal(publicRoom(r,q.id,NOW).players[0].netWorth,expected);}
 assert.equal(p.cash,expected);assert.equal(r.properties[3].mortgaged,true);
 for(const type of ['mortgage','sellLevel','redeem'])assert.throws(()=>act(r,p,{type,tileId:3}));
 assert.equal(netWorth(r,p),p.cash);
});

test('051 legacy board fallback values only actual liquidation proceeds with no redemption liability',()=>{
 const r=game(),p=r.players[0];delete r.board;p.cash=50;deed(r,1,p,2);deed(r,2,p,3,true);
 assert.equal(netWorth(r,p),50+Math.floor((BOARD[1].price+2*BOARD[1].upgradeCost)/2));
 act(r,p,{type:'mortgage',tileId:1});assert.equal(netWorth(r,p),p.cash);
});

test('051 finished rankings and all public viewers use the same liquidation net worth',()=>{
 const r=game(),[p,q]=r.players;p.cash=100;deed(r,1,p,2);deed(r,2,p,3,true);
 const expected=900;assert.equal(netWorth(r,p),expected);act(r,q,{type:'surrender'});
 assert.equal(r.status,'finished');assert.equal(r.rankings[0].playerId,p.id);assert.equal(r.rankings[0].netWorth,expected);
 for(const viewer of [p.id,q.id,undefined]){const view=publicRoom(r,viewer,NOW);for(const row of view.rankings){const player=view.players.find(x=>x.id===row.playerId);assert.equal(row.netWorth,player.netWorth);}assert.equal(view.players[0].netWorth,expected);view.rankings[0].netWorth=0;assert.equal(r.rankings[0].netWorth,expected);}
});

for(const {name,stations,from,steps,landed,to,rewards} of [
 {name:'non-wrapping dice and transfer give no bonus',stations:[8,24],from:7,steps:1,landed:8,to:24,rewards:0},
 {name:'only transfer wraps and earns one bonus',stations:[8,24],from:23,steps:1,landed:24,to:8,rewards:1},
 {name:'dice wrap then non-wrapping transfer earns only one bonus',stations:[1,2],from:31,steps:2,landed:1,to:2,rewards:1},
 {name:'dice and transfer each wrap and each earn a bonus',stations:[1,2],from:31,steps:3,landed:2,to:1,rewards:2},
 {name:'transfer landing exactly at zero crosses start',stations:[0,24],from:23,steps:1,landed:24,to:0,rewards:1},
 {name:'dice landing exactly at zero then transfer gives one bonus',stations:[0,24],from:31,steps:1,landed:0,to:24,rewards:1},
])test(`051 rail ${name}`,()=>{
 const r=railGame(stations),p=r.players[0];p.position=from;let calls=0;act(r,p,{type:'roll'},()=>{calls++;return steps;});
 assert.equal(calls,1);assert.equal(p.position,to);assert.equal(p.cash,15000+1500*rewards);assert.equal(bonuses(r),rewards);
 assert.deepEqual(r.lastMove,{id:r.version,playerId:p.id,from,landed,to,steps,transfer:'station'});
 assert.equal(r.logs.filter(l=>l.text.includes('到达')).length,1);assert.equal(r.logs.filter(l=>l.text.includes('乘高铁')).length,1);
 assert.equal(r.events.length,0);assert.equal(r.phase,'land');assert.equal(r.turnPlayerId,p.id);
});

test('051 a lone station has no destination, bonus, or recursive landing',()=>{
 const r=railGame([24]),p=r.players[0];p.position=23;act(r,p,{type:'roll'},()=>1);
 assert.equal(p.position,24);assert.equal(p.cash,15000);assert.equal(r.lastMove.transfer,undefined);assert.equal(bonuses(r),0);
});

for(const wrap of [false,true])test(`051 return-start event grants no teleport bonus after ${wrap?'wrapping':'non-wrapping'} dice`,()=>{
 const r=game(),p=r.players[0],landed=wrap?1:4;p.position=wrap?31:3;r.board[landed].type='event';
 const draws=[wrap?2:1,8];act(r,p,{type:'roll'},()=>draws.shift());
 assert.equal(p.position,0);assert.equal(p.cash,15000+(wrap?1500:0));assert.equal(bonuses(r),wrap?1:0);
 assert.equal(r.events.at(-1).kind,'return_start');assert.equal(r.turnPlayerId,r.players[1].id);assert.equal(r.phase,'roll');assert.equal(r.lastMove.to,0);
});
