import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,newPlayer,applyAction,publicRoom,OFFLINE_MS} from '../server/engine.js';
import {BOARD} from '../shared/content.js';
const NOW=100000;
function game(count=2){const r=createRoom('123456',count,'甲',NOW);r.board=structuredClone(BOARD);while(r.players.length<count)r.players.push(newPlayer(`玩家${r.players.length}`,NOW));for(const p of r.players)act(r,p,{type:'ready',ready:true});act(r,r.hostId,{type:'start'});return r;}
function act(r,p,a,rng=min=>min){return applyAction(r,typeof p==='string'?p:p.id,a,{now:NOW,rng});}
function end(r){const id=r.turnPlayerId;act(r,id,{type:'skip'});}
function event(r,kind,amount=5,tile=4){const p=r.players.find(p=>p.id===r.turnPlayerId);p.position=tile-1;const calls=[],values=[1,kind,...(kind<4?[amount]:[])];act(r,p,{type:'roll'},(min,max)=>{calls.push([min,max]);const value=values.shift();assert.ok(value>=min&&value<max,`${value} outside [${min},${max})`);return value;});assert.deepEqual(values,[]);return calls;}
function ordinary(r){act(r,r.turnPlayerId,{type:'roll'},()=>1);end(r);}

test('ten event tickets request rng(0,10), including event-only jail-free cards',()=>{
 const kinds=['reward','reward','fine','fine','extra_roll','extra_roll','jail','jail','return_start','jail_free'];
 for(let ticket=0;ticket<10;ticket++){const r=game(),p=r.players[0],cards=[...p.cards],version=r.version+1;const calls=event(r,ticket);assert.deepEqual(calls,[[1,7],[0,10],...(ticket<4?[[5,ticket<2?11:9]]:[])]);assert.equal(r.events.length,1);assert.equal(r.events[0].kind,kinds[ticket]);assert.equal(r.events[0].id,String(version));assert.equal(r.events[0].version,r.version);assert.equal(r.events[0].playerId,p.id);assert.equal(r.events[0].playerName,p.name);assert.ok(r.events[0].title);assert.ok(r.events[0].message);assert.deepEqual(p.cards,ticket===9?[...cards,'jail_free']:cards);}
});
test('reward 500..1000 and fine 500..800 include every whole-hundred amount and both boundaries',()=>{
  for(const kind of [0,2])for(let hundreds=5;hundreds<=(kind===0?10:8);hundreds++){const r=game(),p=r.players[0];event(r,kind,hundreds);const e=r.events[0];assert.equal(e.amount,hundreds*100);assert.equal(e.amount%100,0);assert.equal(p.cash,15000+(kind===0?1:-1)*e.amount);if(kind===2)assert.equal(e.paid,e.amount);else assert.equal(e.paid,undefined);}
});
test('extra roll waits for skip, consumes one credit, preserves card limit, and grants new landing build',()=>{
  const r=game(),p=r.players[0],other=r.players[1];act(r,p,{type:'useCard',cardId:'discount'});event(r,4);const round=r.round;assert.equal(r.phase,'land');assert.equal(p.extraRolls,1);assert.throws(()=>act(r,p,{type:'roll'}));assert.throws(()=>act(r,p,{type:'end'}));act(r,p,{type:'skip'});assert.equal(r.phase,'roll');assert.equal(r.turnPlayerId,p.id);assert.equal(p.extraRolls,0);assert.equal(r.round,round);assert.equal(r.cardUsed,true);assert.throws(()=>act(r,p,{type:'useCard',cardId:'shield'}));
  act(r,p,{type:'roll'},()=>1);act(r,p,{type:'buy'});assert.equal(r.buildUsed,true);assert.throws(()=>act(r,p,{type:'upgrade'}));end(r);assert.equal(r.turnPlayerId,other.id);assert.equal(r.cardUsed,false);ordinary(r);p.position=4;act(r,p,{type:'roll'},()=>1);assert.equal(r.buildUsed,false);act(r,p,{type:'upgrade'});assert.equal(r.properties[5].level,1);
});
test('consecutive extra-roll events each add one credit and end consumes exactly one, never a round',()=>{
  const r=game(),p=r.players[0];p.extraRolls=2;event(r,4);assert.equal(p.extraRolls,3);end(r);assert.equal(p.extraRolls,2);assert.equal(r.turnPlayerId,p.id);event(r,4,5,12);assert.equal(p.extraRolls,3);end(r);assert.equal(p.extraRolls,2);assert.equal(r.round,1);assert.equal(r.events.length,2);assert.notEqual(r.events[0].id,r.events[1].id);
});
for(const count of [2,4])test(`${count}-player jail skips next scheduled turn, not the current landing`,()=>{
  const r=game(count),p=r.players[0];event(r,6);assert.equal(p.skipTurns,1);assert.equal(r.turnPlayerId,p.id);assert.equal(r.phase,'land');end(r);assert.equal(r.turnPlayerId,r.players[1].id);for(let i=1;i<count;i++)ordinary(r);assert.equal(p.skipTurns,0);assert.equal(r.turnPlayerId,r.players[1].id);assert.equal(r.round,2);for(let i=1;i<count;i++)ordinary(r);assert.equal(r.turnPlayerId,p.id);assert.equal(r.round,3);
});
for(const count of [2,4])test(`${count}-player all-skip restored snapshot resolves without lock, accounting rounds`,()=>{
  const r=game(count);for(const p of r.players)p.skipTurns=1;r.phase='end';act(r,r.hostId,{type:'end'});assert.equal(r.turnPlayerId,r.players[1].id);assert.equal(r.round,2);assert.equal(r.phase,'roll');assert.ok(r.players.every(p=>p.skipTurns===0));
  for(const p of r.players)p.skipTurns=3;r.phase='end';act(r,r.turnPlayerId,{type:'end'});assert.equal(r.phase,'roll');assert.ok(r.players.every(p=>p.skipTurns===0));assert.equal(r.round,count===2?6:5);
});
for(const count of [2,4])test(`${count}-player old round cap is ignored even across skipped seats`,()=>{
 const r=game(count);r.maxRounds=20;r.round=20;r.turnPlayerId=r.players.at(-1).id;r.phase='end';r.players[0].skipTurns=1;act(r,r.turnPlayerId,{type:'end'});assert.equal(r.status,'playing');assert.equal(r.round,21);assert.equal(r.turnPlayerId,r.players[1].id);assert.equal(r.players[0].skipTurns,0);
});
test('last seat extra roll on round20 remains playable after the old cap',()=>{
 const r=game(4),p=r.players.at(-1);r.round=20;r.turnPlayerId=p.id;event(r,4);end(r);assert.equal(r.status,'playing');assert.equal(r.round,20);assert.equal(r.turnPlayerId,p.id);assert.equal(p.extraRolls,0);act(r,p,{type:'roll'},()=>1);end(r);assert.equal(r.status,'playing');assert.equal(r.round,21);
});
test('return to start immediately hands off without bonus or extra rolls; move preserves original player and event landing',()=>{
 const r=game(),p=r.players[0];act(r,p,{type:'useCard',cardId:'shield'});p.extraRolls=3;const cash=p.cash,version=r.version+1;event(r,8,5,20);assert.equal(p.position,0);assert.equal(p.cash,cash);assert.equal(p.extraRolls,0);assert.equal(r.phase,'roll');assert.equal(r.turnPlayerId,r.players[1].id);assert.equal(r.round,1);assert.equal(r.cardUsed,false);assert.deepEqual(r.lastMove,{id:version,playerId:p.id,from:19,landed:20,to:0,steps:1});assert.throws(()=>act(r,p,{type:'roll'}));assert.throws(()=>act(r,p,{type:'skip'}));ordinary(r);p.position=31;act(r,p,{type:'roll'},()=>1);assert.equal(p.cash,cash+1500);assert.deepEqual([r.lastMove.from,r.lastMove.landed,r.lastMove.to],[31,0,0]);
});
test('each roll resets build allowance including extra rolls and return-start handoff',()=>{
 const r=game(),p=r.players[0];r.buildUsed=true;event(r,4);assert.equal(r.buildUsed,false);end(r);r.buildUsed=true;event(r,8);assert.equal(r.buildUsed,false);assert.equal(r.turnPlayerId,r.players[1].id);ordinary(r);r.buildUsed=true;act(r,p,{type:'roll'},()=>1);assert.equal(r.buildUsed,false);act(r,p,{type:'buy'});assert.throws(()=>act(r,p,{type:'upgrade'}));
});
test('fine records real liquidation payment and bankruptcy, skips eliminated player, and resolves final survivor',()=>{
  for(const count of [2,4]){const r=game(count),p=r.players[0];p.cash=10;r.properties[2]={ownerId:p.id,level:0,mortgaged:false};event(r,2,8);assert.equal(r.phase,'debt');assert.equal(r.events[0].paid,null);assert.match(r.events[0].message,/待偿/);act(r,p,{type:'mortgage',tileId:2});act(r,p,{type:'declareBankruptcy'});assert.equal(p.bankrupt,true);assert.equal(p.cash,0);assert.equal(r.properties[2],undefined);assert.deepEqual(p.cards,[]);assert.equal(r.events[0].amount,800);assert.equal(r.events[0].paid,null);assert.ok(r.logs.some(l=>l.text.includes('460')));assert.ok(r.events[0].message.includes('800'));assert.equal(r.lastMove.to,4);assert.equal(r.status,count===2?'finished':'playing');assert.equal(r.turnPlayerId,count===2?null:r.players[1].id);}
  const r=game(),p=r.players[0];p.cash=100;r.properties[2]={ownerId:p.id,level:3,mortgaged:false};event(r,2,5);assert.equal(r.phase,'debt');act(r,p,{type:'sellLevel',tileId:2});act(r,p,{type:'sellLevel',tileId:2});assert.equal(p.bankrupt,false);assert.equal(r.events[0].paid,null);assert.equal(r.properties[2].level,1);assert.equal(r.phase,'land');
});
test('bankrupt last seat ignores extra credits, wraps once, and jail does not bypass offline pause/surrender',()=>{
  const r=game(4),p=r.players.at(-1);r.turnPlayerId=p.id;p.extraRolls=2;p.cash=1;event(r,2,8);assert.equal(r.turnPlayerId,r.players[0].id);assert.equal(r.round,2);assert.equal(p.bankrupt,true);
  const s=game(4);event(s,6);end(s);s.players[0].lastSeen=NOW-OFFLINE_MS-1;assert.throws(()=>act(s,s.turnPlayerId,{type:'roll'}),e=>e.code==='PLAYER_OFFLINE');act(s,s.players[0],{type:'surrender'});assert.equal(s.players[0].bankrupt,true);assert.equal(s.turnPlayerId,s.players[1].id);ordinary(s);assert.equal(s.turnPlayerId,s.players[2].id);
});
test('public events/movement are cloned for every viewer, bounded20, and persist across unrelated actions',()=>{
  const r=game(),p=r.players[0];p.cards=['private-secret'];for(let i=0;i<25;i++){r.phase='roll';event(r,0,5);}assert.equal(r.events.length,20);assert.equal(new Set(r.events.map(e=>e.id)).size,20);assert.ok(r.events.every(e=>e.kind==='reward'));const move=structuredClone(r.lastMove);act(r,p,{type:'skip'});assert.deepEqual(r.lastMove,move);const before=structuredClone(r);for(const viewer of [p.id,r.players[1].id,undefined]){const view=publicRoom(r,viewer,NOW);assert.deepEqual(view.events,r.events);assert.deepEqual(view.lastMove,r.lastMove);assert.equal(view.players[0].extraRolls,0);assert.equal(view.players[0].skipTurns,0);assert.ok(!JSON.stringify(view.events).includes('private-secret'));view.events[0].title='changed';view.events.push({});view.lastMove.to=99;assert.deepEqual(r,before);}
});
test('old persisted snapshots default missing event, movement and player counters to safe zero/null',()=>{
  const r=game(),p=r.players[0];delete r.events;delete r.lastMove;for(const player of r.players){delete player.extraRolls;delete player.skipTurns;}const view=publicRoom(r,p.id,NOW);assert.deepEqual(view.events,[]);assert.equal(view.lastMove,null);assert.ok(view.players.every(p=>p.extraRolls===0&&p.skipTurns===0));event(r,4);assert.equal(p.extraRolls,1);end(r);assert.equal(p.extraRolls,0);act(r,p,{type:'roll'},()=>1);end(r);assert.equal(r.turnPlayerId,r.players[1].id);
});
