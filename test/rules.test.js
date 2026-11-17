import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,newPlayer,applyAction,netWorth,publicRoom,OFFLINE_MS,GameError} from '../server/engine.js';
import {randomInt,randomUUID} from '../shared/random.js';
import {BOARD,CARDS} from '../shared/content.js';

const NOW=100000;
function lobby(count=2){const r=createRoom('654321',count,'甲',NOW);r.board=structuredClone(BOARD);while(r.players.length<count)r.players.push(newPlayer(`真人${r.players.length}`,NOW));return r;}
function act(r,p,a,rng=min=>Math.max(min,1)){return applyAction(r,typeof p==='string'?p:p.id,a,{now:NOW,rng});}
function game(count=2){const r=lobby(count);for(const p of r.players)act(r,p,{type:'ready',ready:true});act(r,r.hostId,{type:'start'});return r;}
function end(r){const id=r.turnPlayerId;act(r,id,{type:'skip'});}
function turn(r,steps=1){const id=r.turnPlayerId;act(r,id,{type:'roll'},(min,max)=>min===1?steps:(max===5?1:min));if(r.status==='playing'&&r.turnPlayerId===id)end(r);}
function rejectUnchanged(r,p,a){const before=structuredClone(r);assert.throws(()=>act(r,p,a),GameError);assert.deepEqual(r,before);}
function withCrypto(value,run){const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');Object.defineProperty(globalThis,'crypto',{configurable:true,value});try{run();}finally{Object.defineProperty(globalThis,'crypto',descriptor);}}

test('constructors reject unsupported capacities and invalid names and trim valid names',()=>{
  for(const n of [undefined,null,0,1,3,5,'2',NaN])assert.throws(()=>createRoom('654321',n,'甲'),GameError);
  for(const name of [undefined,null,42,{},'', '   ','x'.repeat(21),'a\nb','a\x7fb'])assert.throws(()=>newPlayer(name),GameError);
  assert.equal(newPlayer('  甲  ',NOW).name,'甲');
  const r=createRoom('654321',2,'  甲  ',NOW);assert.equal(r.logs[0].text,'甲 创建了房间');assert.equal(r.players.length,1);assert.equal(r.players[0].lastSeen,NOW);
});
for(const count of [2,4])test(`${count}-seat lobby requires real full roster, host, ready and online`,()=>{
  const r=createRoom('654321',count,'甲',NOW);assert.equal(r.players.length,1);rejectUnchanged(r,r.hostId,{type:'start'});
  while(r.players.length<count)r.players.push(newPlayer(`玩家${r.players.length}`,NOW));
  rejectUnchanged(r,r.players[1],{type:'start'});rejectUnchanged(r,r.hostId,{type:'start'});
  for(const p of r.players)act(r,p,{type:'ready',ready:true});
  r.players.at(-1).lastSeen=NOW-OFFLINE_MS-1;rejectUnchanged(r,r.hostId,{type:'start'});r.players.at(-1).lastSeen=NOW;
  act(r,r.hostId,{type:'start'});assert.equal(r.players.length,count);assert.equal(r.round,1);assert.equal(r.turnPlayerId,r.hostId);
});
test('wrong turn, malformed action and illegal phase rejection do not spend/version',()=>{
  const r=game(),p=r.players[0];for(const a of [null,[],{}, {type:'unknown'},{type:'buy'},{type:'skip'},{type:'end'}])rejectUnchanged(r,p,a);
  for(const type of ['roll','useCard','buy','upgrade','skip','end','mortgage'])rejectUnchanged(r,r.players[1],{type,cardId:'bonus',tileId:1});
  act(r,p,{type:'roll'});rejectUnchanged(r,p,{type:'roll'});rejectUnchanged(r,p,{type:'end'});
});
test('mutating engine contract: caller clone contains even a partially failed random event',()=>{
  const original=game(),draft=structuredClone(original),snapshot=structuredClone(original);let calls=0;
  assert.throws(()=>act(draft,draft.hostId,{type:'roll'},()=>{if(++calls===1)return 4;throw new Error('random source failed');}),/random source failed/);
  assert.deepEqual(original,snapshot);assert.equal(draft.phase,'land');assert.equal(draft.players[0].position,4);
});
test('one strategy card before roll; failed card use does not consume allowance',()=>{
  const r=game(),p=r.players[0];p.cards=CARDS.filter(c=>c.id!=='jail_free').map(c=>c.id);
  rejectUnchanged(r,p,{type:'useCard',cardId:'precise',steps:0});assert.equal(r.cardUsed,false);
  act(r,p,{type:'useCard',cardId:'bonus'});assert.equal(p.cash,15500);assert.equal(p.cards.length,4);assert.equal(r.cardUsed,true);
  for(const cardId of p.cards)rejectUnchanged(r,p,{type:'useCard',cardId,steps:2});
  act(r,p,{type:'roll'});for(const cardId of p.cards)rejectUnchanged(r,p,{type:'useCard',cardId,steps:2});
  end(r);assert.equal(r.cardUsed,false);turn(r);act(r,p,{type:'useCard',cardId:'shield'});assert.equal(p.cards.length,3);
});
test('precise chooses exactly 1..6 without drawing random dice; slow requests [1,4)',()=>{
  for(const steps of [1,2,3,4,5,6]){const r=game(),p=r.players[0];p.position=0;act(r,p,{type:'useCard',cardId:'precise',steps});const calls=[];act(r,p,{type:'roll'},(min,max)=>{calls.push([min,max]);return 0;});assert.equal(r.lastDice,steps);assert.equal(p.position,steps);assert.equal(p.effects.precise,undefined);if(steps!==4)assert.deepEqual(calls,[]);}
  for(const steps of [-1,0,7,1.5,'2',null]){const r=game();rejectUnchanged(r,r.players[0],{type:'useCard',cardId:'precise',steps});}
  for(const result of [1,2,3]){const r=game(),p=r.players[0];p.cards=['slow'];act(r,p,{type:'useCard',cardId:'slow'});act(r,p,{type:'roll'},(min,max)=>{assert.deepEqual([min,max],[1,4]);return result;});assert.equal(r.lastDice,result);assert.equal(p.effects.slow,undefined);}
});
test('discount survives unused turns, cannot be overwritten, consumed only by successful build',()=>{
  const r=game(),p=r.players[0];act(r,p,{type:'useCard',cardId:'discount'});act(r,p,{type:'roll'},()=>8);end(r);turn(r);assert.equal(p.effects.discount,true);
  p.cards.push('discount');rejectUnchanged(r,p,{type:'useCard',cardId:'discount'});assert.equal(r.cardUsed,false);
  act(r,p,{type:'roll'},()=>1);p.cash=0;rejectUnchanged(r,p,{type:'buy'});assert.equal(p.effects.discount,true);assert.equal(r.buildUsed,false);
  p.cash=15000;act(r,p,{type:'buy'});assert.equal(p.cash,15000-Math.ceil(BOARD[p.position].price/2));assert.equal(p.effects.discount,undefined);assert.equal(r.buildUsed,true);
});
test('shield persists until actual rent, ignores unowned/own/mortgaged deeds',()=>{
  const r=game(),p=r.players[0],owner=r.players[1];act(r,p,{type:'useCard',cardId:'shield'});act(r,p,{type:'roll'});end(r);turn(r);assert.equal(p.effects.shield,true);
  r.properties[2]={ownerId:p.id,level:0,mortgaged:false};act(r,p,{type:'roll'});assert.equal(p.effects.shield,true);end(r);turn(r);
  r.properties[3]={ownerId:owner.id,level:0,mortgaged:true};act(r,p,{type:'roll'});assert.equal(p.effects.shield,true);end(r);turn(r);
  r.properties[5]={ownerId:owner.id,level:0,mortgaged:false};const balances=[p.cash,owner.cash];act(r,p,{type:'roll'},()=>2);assert.equal(p.effects.shield,undefined);assert.deepEqual([p.cash,owner.cash],balances);
});
test('buy or upgrade only once per landing; selling does not restore build allowance',()=>{
  const r=game(),p=r.players[0];act(r,p,{type:'roll'});act(r,p,{type:'buy'});for(let i=0;i<3;i++)rejectUnchanged(r,p,{type:'upgrade'});end(r);turn(r);
  p.position=0;act(r,p,{type:'roll'});act(r,p,{type:'upgrade'});assert.equal(r.properties[1].level,1);rejectUnchanged(r,p,{type:'upgrade'});
  act(r,p,{type:'sellLevel',tileId:1});rejectUnchanged(r,p,{type:'upgrade'});assert.equal(r.properties[1].level,0);
});
test('ownership, mortgage and upgrade cap validation',()=>{
  const r=game(),p=r.players[0],other=r.players[1];r.properties[1]={ownerId:p.id,level:3,mortgaged:false};act(r,p,{type:'roll'});rejectUnchanged(r,p,{type:'upgrade'});rejectUnchanged(r,p,{type:'buy'});
  for(let n=0;n<3;n++)act(r,p,{type:'sellLevel',tileId:1});rejectUnchanged(r,p,{type:'sellLevel',tileId:1});act(r,p,{type:'mortgage',tileId:1});rejectUnchanged(r,p,{type:'mortgage',tileId:1});rejectUnchanged(r,p,{type:'upgrade'});
  r.properties[2]={ownerId:other.id,level:0,mortgaged:false};for(const type of ['mortgage','redeem','sellLevel'])rejectUnchanged(r,p,{type,tileId:2});
  for(const tileId of [undefined,1.1,'1',-1,99])rejectUnchanged(r,p,{type:'mortgage',tileId});
});
test('mortgage credits once; insufficient rent logs real payment, clears debtor and advances',()=>{
  for(const alreadyMortgaged of [false,true]){const r=game(4),p=r.players[0],owner=r.players[1];p.cash=1;r.properties[1]={ownerId:owner.id,level:3,mortgaged:false};r.properties[2]={ownerId:p.id,level:0,mortgaged:alreadyMortgaged};
    act(r,p,{type:'roll'});assert.equal(r.phase,'debt');if(!alreadyMortgaged)act(r,p,{type:'mortgage',tileId:2});act(r,p,{type:'declareBankruptcy'});const paid=alreadyMortgaged?1:451;assert.equal(owner.cash,15000+paid);assert.equal(p.cash,0);assert.equal(p.bankrupt,true);assert.deepEqual(p.cards,[]);assert.deepEqual(p.effects,{});assert.equal(r.properties[2],undefined);assert.equal(r.turnPlayerId,owner.id);assert.equal(r.phase,'roll');assert.equal(r.status,'playing');
    assert.ok(r.logs.some(l=>l.text.includes(`实付租金 ${paid} 元（应付 700 元）`)));rejectUnchanged(r,p,{type:'roll'});
  }
});
test('manual whole-deed sale resolves debt without automatic building sales',()=>{
  const r=game(4),p=r.players[0],owner=r.players[1];p.cash=0;r.properties[1]={ownerId:owner.id,level:3,mortgaged:false};r.properties[2]={ownerId:p.id,level:3,mortgaged:false};act(r,p,{type:'roll'});
  assert.equal(r.phase,'debt');assert.equal(p.cash,0);assert.equal(r.properties[2].level,3);act(r,p,{type:'mortgage',tileId:2});assert.equal(p.bankrupt,false);assert.equal(owner.cash,15700);assert.equal(p.cash,350);assert.equal(r.properties[2],undefined);assert.equal(r.turnPlayerId,p.id);assert.equal(r.phase,'land');
});
test('city set doubles rent, but mortgaged target earns none and does not consume shield',()=>{
  const r=game(),p=r.players[0],owner=r.players[1];for(const id of [1,2,3])r.properties[id]={ownerId:owner.id,level:0,mortgaged:false};act(r,p,{type:'roll'});assert.equal(p.cash,14800);assert.equal(owner.cash,15200);
  const s=game(),q=s.players[0];s.properties[1]={ownerId:s.players[1].id,level:3,mortgaged:true};q.effects.shield=true;act(s,q,{type:'roll'});assert.equal(q.cash,15000);assert.equal(q.effects.shield,true);
});
test('event debt bankruptcy skips eliminated player and resolves final survivor',()=>{
  const r=game(4),p=r.players[0];p.cash=10;const draws=[4,2,5];act(r,p,{type:'roll'},()=>draws.shift());assert.equal(p.bankrupt,true);assert.equal(r.turnPlayerId,r.players[1].id);assert.equal(r.phase,'roll');
  act(r,r.players[3],{type:'surrender'});assert.equal(r.turnPlayerId,r.players[1].id);act(r,r.players[1],{type:'surrender'});assert.equal(r.status,'finished');assert.equal(r.turnPlayerId,null);assert.equal(r.rankings[0].playerId,r.players[2].id);
});
test('last seat bankruptcy wraps round once and never leaves a bankrupt turn',()=>{
  const r=game(4);for(let i=0;i<3;i++)turn(r);const p=r.players[3];p.cash=1;r.properties[1]={ownerId:r.players[0].id,level:3,mortgaged:false};act(r,p,{type:'roll'});assert.equal(r.round,2);assert.equal(r.turnPlayerId,r.players[0].id);assert.equal(r.phase,'roll');
});
test('net worth uses face-value buildings; liquidation frees the deed',()=>{const r=game(),p=r.players[0];r.properties[1]={ownerId:p.id,level:2,mortgaged:false};assert.equal(netWorth(r,p),16600);act(r,p,{type:'mortgage',tileId:1});assert.equal(p.cash,15800);assert.equal(netWorth(r,p),15800);assert.equal(r.properties[1],undefined);rejectUnchanged(r,p,{type:'redeem',tileId:1});});
test('equal net assets share competition rank independent of stamps; bankrupt always bottom',()=>{
 // Restored snapshots can retain assets on eliminated players: finish only
 // once one survivor remains, but preserve the complete ranking comparator.
 const r=game(4);r.players[0].cash=5000;for(const p of r.players.slice(1))p.bankrupt=true;r.players[1].cash=15000;r.players[1].stamps=['beijing'];r.players[2].cash=15000;r.players[3].cash=9000;
 act(r,r.players[0],{type:'roll'},()=>1);assert.equal(r.status,'finished');assert.deepEqual(r.rankings.map(p=>[p.playerId,p.rank]),[[r.players[0].id,1],[r.players[1].id,2],[r.players[2].id,2],[r.players[3].id,4]]);
});
for(const count of [2,4])test(`${count}-player deterministic 20-round card/build journey has no deadlocks`,()=>{
  const r=game(count);let completed=0;while(completed<count*20){assert.equal(r.status,'playing');const p=r.players.find(p=>p.id===r.turnPlayerId);assert.equal(p.bankrupt,false);assert.equal(r.phase,'roll');
    // Deterministic exact movement with occasional strategy cards and safe budgets.
    if(p.cards.includes('discount')&&!p.effects.discount)act(r,p,{type:'useCard',cardId:'discount'});
    act(r,p,{type:'roll'},min=>Math.max(min,1));if(r.status!=='playing'||r.turnPlayerId!==p.id)continue;
    const t=BOARD[p.position],v=r.properties[t.id];if(t.type==='property'&&(!v||(v.ownerId===p.id&&!v.mortgaged&&v.level<3))&&p.cash>3000)act(r,p,{type:v?'upgrade':'buy'});
    end(r);completed++;
  }assert.equal(completed,count*20);assert.equal(r.round,21);assert.equal(r.status,'playing');for(const p of r.players.slice(0,-1))act(r,p,{type:'surrender'});assert.equal(r.rankings.length,count);assert.equal(r.turnPlayerId,null);
  for(const row of r.rankings){assert.equal(row.netWorth,netWorth(r,r.players.find(p=>p.id===row.playerId)));assert.ok(row.rank>=1);}
});
test('public turn allowances and private effects are copied, not live aliases',()=>{
  const r=game(),p=r.players[0];act(r,p,{type:'useCard',cardId:'discount'});const view=publicRoom(r,p.id,NOW);assert.equal(view.cardUsed,true);assert.equal(view.buildUsed,false);view.players[0].effects.discount=false;view.players[0].cards.length=0;view.logs.length=0;assert.equal(p.effects.discount,true);assert.equal(p.cards.length,2);assert.ok(r.logs.length>0);assert.equal(view.players[1].effects,undefined);
});
test('randomInt rejects biased tail and supports exclusive bounds, negative offsets, 48-bit ranges',()=>{
  let calls=0;withCrypto({getRandomValues(words){words[0]=++calls===1?0xffffffff:8;return words;}},()=>assert.equal(randomInt(1,7),3));assert.equal(calls,2);
  withCrypto({getRandomValues(words){words.fill(0);return words;}},()=>{assert.equal(randomInt(7),0);assert.equal(randomInt(-5,-1),-5);assert.equal(randomInt(-10,2**40),-10);});
  let draws=0;withCrypto({getRandomValues(words){words[0]=0xffff;words[1]=++draws===1?0xffffffff:0xfffffffe;return words;}},()=>assert.equal(randomInt(0,2**48-1),2**48-2));assert.equal(draws,2);
  for(const [min,max] of [[0,0],[2,1],[0,2**48],[NaN,2],[1.5,3],[0,Infinity],[0,Number.MAX_SAFE_INTEGER+1]])assert.throws(()=>randomInt(min,max),RangeError);
});
test('shop cards cap at 12; event extra rolls never grant cards or suppress rewards',()=>{
  for(const count of [11,12]){const r=game(),p=r.players[0];p.cards=Array(count).fill('bonus');p.position=15;let calls=0;act(r,p,{type:'roll'},()=>++calls===1?1:0);assert.equal(p.cards.length,12);}
  for(const count of [11,12]){const r=game(),p=r.players[0];p.cards=Array(count).fill('bonus');p.position=3;let calls=0;act(r,p,{type:'roll'},()=>++calls===1?1:4);assert.equal(p.cards.length,count);assert.equal(p.extraRolls,1);}
  const r=game(),p=r.players[0];p.cards=Array(12).fill('bonus');p.position=3;const draws=[1,0,5];act(r,p,{type:'roll'},()=>draws.shift());assert.equal(p.cash,15500);assert.equal(p.cards.length,12);
});
test('remaining players complete 20 rounds with multiple eliminated seats, including host',()=>{
  const r=game(4);act(r,r.players[0],{type:'surrender'});act(r,r.players[2],{type:'surrender'});let turns=0;
  while(turns<40){assert.equal(r.status,'playing');const p=r.players.find(p=>p.id===r.turnPlayerId);assert.equal(p.bankrupt,false);turn(r);turns++;}
  assert.equal(turns,40);assert.equal(r.round,21);assert.equal(r.status,'playing');act(r,r.players[1],{type:'surrender'});assert.deepEqual(r.rankings.slice(-2).map(p=>p.bankrupt),[true,true]);assert.equal(r.rankings.at(-1).rank,r.rankings.at(-2).rank);
});
test('UUID uses Web Crypto native or RFC4122 v4 fallback (no Node imports)',()=>{
  withCrypto({randomUUID:()=> 'native-uuid'},()=>assert.equal(randomUUID(),'native-uuid'));
  withCrypto({getRandomValues(bytes){bytes.fill(255);return bytes;}},()=>assert.equal(randomUUID(),'ffffffff-ffff-4fff-bfff-ffffffffffff'));
  assert.match(randomUUID(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
