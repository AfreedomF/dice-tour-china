import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransport} from '../web/mqtt-transport.js';
import {createIdentity,sharedKey,seal,open,decrypt,privateKey,digest,randomHex} from '../shared/network-crypto.js';
import {FakeBroker,settle} from './fake-mqtt.js';

async function until(check) { for (let n=0;n<300;n++) { if (check()) return; await new Promise(r=>setTimeout(r,2)); } assert.fail('Condition did not become true'); }
async function setup(t,capacity=2,extra={}) {
  const broker = new FakeBroker(), states=[], sessions=[], clients=[];
  let clock=100000;
  const make = () => {
    const transport=createTransport({connect:broker.connect,timeoutMs:600,heartbeatMs:60000,now:()=>clock,boardRng:(min,max)=>max-1,rng:(min)=>min,...extra,onStatus:s=>states.push(s),onSession:s=>sessions.push(s)});
    clients.push(transport); return transport;
  };
  t.after(()=>clients.forEach(c=>c.disconnect()));
  const host=make(), created=await host.create({name:'Host',capacity}), guests=[];
  for(let n=1;n<capacity;n++){const guest=make();await guest.join({...created.invitation,name:'Guest '+n});guests.push(guest);}
  await until(()=>host.getSession().snapshot.players.length===capacity && guests.every(g=>g.getSession().room?.players.length===capacity));
  for (const guest of guests) {
    const send = guest.action;
    guest.action = async (...args) => {
      await until(()=>guest.getSession().room.version === host.getSession().snapshot.version);
      return send(...args);
    };
  }
  return {broker,host,guests,make,created,states,sessions,advance:ms=>{clock+=ms;}};
}

test('two-player secure real protocol, authority, no retain and private cards',async t=>{
  const {broker,host,guests:[guest],created}=await setup(t);
  assert.match(created.invitation.secret,/^[a-f0-9]{64}$/);assert.match(created.invitation.code,/^\d{6}$/);
  const guestId=guest.getSession().playerId;
  assert.ok(guest.getSession().room.players.find(p=>p.id===guestId).cards);
  assert.equal(guest.getSession().room.players.find(p=>p.id!==guestId).cards,undefined);
  assert.ok(broker.packets.every(p=>p.opts.qos===1&&p.opts.retain===false));
  assert.ok(broker.packets.every(p=>!p.payload.includes('Guest')&&!p.payload.includes('precise')));
  await assert.rejects(guest.action({type:'start'}),/只有房主/);
  await host.action({type:'ready',ready:true});await guest.action({type:'ready',ready:true});await host.action({type:'start'});
  assert.equal(host.getSession().snapshot.status,'playing');
  await assert.rejects(guest.action({type:'roll'}),/尚未轮到/);
  const roll=await host.action({type:'roll',requestId:'roll-once'});
  assert.equal(roll.room.lastDice,1);
  const version=host.getSession().snapshot.version;
  await host.action({type:'roll',requestId:'roll-once'});
  assert.equal(host.getSession().snapshot.version,version);
  await assert.rejects(host.action({type:'skip',requestId:'roll-once'}),e=>e.code==='REQUEST_ID_REUSE');
});

test('four clients get only their own cards; full lobby rejects fifth',async t=>{
  const {host,guests,make,created}=await setup(t,4);
  for(const g of guests){const r=g.getSession().room;assert.equal(r.players.filter(p=>p.cards).length,1);assert.equal(r.players.filter(p=>p.cardCount===3).length,3);}
  await assert.rejects(make().join({...created.invitation,name:'Extra'}),e=>e.code==='ROOM_UNAVAILABLE');
  await host.action({type:'ready',ready:true});for(const g of guests)await g.action({type:'ready',ready:true});
  await host.action({type:'start'});assert.equal(host.getSession().snapshot.status,'playing');
});

test('QoS1 duplicates, bounded persistent receipts and differing reuse',async t=>{
  const {broker,host,guests:[g]}=await setup(t);broker.duplicate=true;
  let r=await g.action({type:'ready',ready:true,requestId:'guest-ready'});
  const version=r.room.version;
  await g.action({type:'ready',ready:true,requestId:'guest-ready'});
  assert.equal(host.getSession().snapshot.version,version);
  await assert.rejects(g.action({type:'ready',ready:false,requestId:'guest-ready'}),e=>e.code==='REQUEST_ID_REUSE');
  assert.equal(host.getSession().snapshot.players.find(p=>p.id===g.getSession().playerId).ready,true);
  assert.equal(host.getSession().receipts.filter(r=>r.key.endsWith(':guest-ready')).length,1);
});

test('secret holders cannot impersonate host, another player, or decrypt peer views',async t=>{
  const {broker,host,guests:[g],created}=await setup(t);
  const attacker=await createIdentity(), key=await sharedKey(created.invitation.secret), original=g.getSession(), before=structuredClone(host.getSession().snapshot);
  const requestPacket=broker.packets.find(p=>p.topic.endsWith('/requests'));
  const attack={v:1,kind:'action',epoch:created.invitation.epoch,hostKey:created.invitation.hostKey,seq:1,requestId:'evil',body:{action:{type:'ready',ready:true},playerId:before.hostId}};
  broker.deliver(requestPacket.topic,await seal(key,attacker,attack,requestPacket.topic));
  const target=broker.packets.find(p=>!p.topic.endsWith('/requests'));
  const forged={v:1,kind:'error',epoch:created.invitation.epoch,to:original.identity.id,seq:99999,body:{kind:'reply',requestId:'evil',room:{version:99999,players:[]}}};
  broker.deliver(target.topic,await seal(key,attacker,forged,target.topic));
  await settle(40);assert.deepEqual(host.getSession().snapshot,before);assert.notEqual(g.getSession().lastHostSeq,99999);
  const viewPacket=await open(key,target.payload,target.topic);
  assert.equal(viewPacket.kind,'private');
  await assert.rejects(decrypt(await privateKey(attacker,viewPacket.dhKey),viewPacket.body,viewPacket.epoch+':'+original.identity.id));
  const valid=JSON.parse(requestPacket.payload);valid.ct=valid.ct.slice(0,-2)+'00';broker.deliver(requestPacket.topic,JSON.stringify(valid));
  broker.deliver(requestPacket.topic,'x'.repeat(200000));await settle();assert.deepEqual(host.getSession().snapshot,before);
});

test('old signed sequence with a new request id is rejected, epoch pin resists stale host',async t=>{
  const {broker,host,guests:[g],created}=await setup(t);
  await g.action({type:'ready',ready:true});const version=host.getSession().snapshot.version;
  const saved=g.getSession(), topic=broker.packets.find(p=>p.topic.endsWith('/requests')).topic,key=await sharedKey(saved.secret);
  const m={v:1,epoch:saved.epoch,hostKey:saved.hostKey,kind:'action',requestId:'replayed-new-id',seq:1,body:{action:{type:'ready',ready:false}}};
  broker.deliver(topic,await seal(key,saved.identity,m,topic));await settle(40);
  assert.equal(host.getSession().snapshot.version,version);
  m.seq=saved.seq+10;m.requestId='wrong-epoch';m.epoch=randomHex(16);broker.deliver(topic,await seal(key,saved.identity,m,topic));await settle(40);
  assert.equal(host.getSession().snapshot.version,version);
});

test('disconnect/reconnect and host snapshot resume preserve identities, receipts, private state',async t=>{
  const {broker,host,guests:[g],make}=await setup(t);
  await g.action({type:'ready',ready:true,requestId:'persisted'});
  const saved=host.getSession(),oldId=g.getSession().playerId;
  host.disconnect();const replacement=make();await replacement.resume(saved);
  await g.action({type:'ready',ready:true,requestId:'persisted'});
  assert.equal(replacement.getSession().snapshot.version,saved.snapshot.version);
  assert.deepEqual(replacement.getSession().identities,saved.identities);
  const guestClient=broker.clients[1];guestClient.drop();guestClient.reconnect();
  await until(()=>broker.clients[1].subscriptions.size>0);
  await g.action({type:'ready',ready:false,requestId:'after-reconnect'});
  assert.equal(g.getSession().playerId,oldId);
  const gs=g.getSession();g.disconnect();const restored=make();await restored.resume(gs);
  assert.equal(restored.getSession().playerId,oldId);
  assert.equal(replacement.getSession().snapshot.players.length,2);
});

test('offline players pause engine; signed reconnect heartbeat restores activity',async t=>{
  const {host,guests:[g],advance}=await setup(t);
  await host.action({type:'ready',ready:true});await g.action({type:'ready',ready:true});await host.action({type:'start'});
  advance(31000);await assert.rejects(host.action({type:'roll'}),e=>e.code==='PLAYER_OFFLINE');
  // Reconnect sends authenticated sync, never trusts a client-provided lastSeen or id.
  const s=g.getSession();g.disconnect();await g.resume(s);await host.action({type:'roll'});
  assert.equal(host.getSession().snapshot.phase,'land');
});

test('accurate connection timeout, input validation, no password persistence or open handles',async t=>{
  const b=new FakeBroker();b.silent=true;const states=[];
  const tr=createTransport({connect:b.connect,timeoutMs:20,password:'DO_NOT_SAVE',onStatus:s=>states.push(s)});t.after(()=>tr.disconnect());
  await assert.rejects(tr.create({name:'A',capacity:3}),e=>e.code==='INVALID_INPUT');
  await assert.rejects(tr.join({code:'123456',secret:'weak',name:'B'}),e=>e.code==='INVALID_INPUT');
  await assert.rejects(tr.create({name:'A'}),e=>e.code==='CONNECT_TIMEOUT');
  assert.equal(b.clients[0].alive,false);assert.equal(states.at(-1).code,'CONNECT_TIMEOUT');
  assert.ok(!JSON.stringify(tr.getSession()).includes('DO_NOT_SAVE'));
  assert.throws(()=>createTransport({brokerUrl:'ws://insecure'}),e=>e.code==='INVALID_BROKER');
});

test('missing invitation pins use explicit first-response TOFU and become persisted pins',async t=>{
  const {make,created}=await setup(t,2);
  // Existing room is full: TOFU still authenticates and pins the signed error, then fails cleanly.
  const guest=make();await assert.rejects(guest.join({code:created.invitation.code,secret:created.invitation.secret,name:'TOFU'}),e=>e.code==='ROOM_UNAVAILABLE');
  assert.equal(guest.getSession().hostKey,created.invitation.hostKey);
  assert.equal(guest.getSession().epoch,created.invitation.epoch);
});

test('session persistence callback failure stops transport rather than claiming durability',async t=>{
  const broker=new FakeBroker();let fail=false;
  const host=createTransport({connect:broker.connect,onSession:()=>{if(fail)throw Error('storage full');}});t.after(()=>host.disconnect());
  await host.create({name:'Host'});fail=true;
  await assert.rejects(host.action({type:'ready',ready:true}),e=>e.code==='PERSISTENCE_FAILED');
  assert.equal(broker.clients[0].alive,false);
  await assert.rejects(host.action({type:'ready',ready:false}),e=>e.code==='OFFLINE');
});

test('concurrent outgoing guest actions preserve signed sequence order',async t=>{
  const {broker,host,guests:[g]}=await setup(t);
  const settled=await Promise.allSettled(Array.from({length:12},(_,i)=>g.action({type:'ready',ready:i%2===0,requestId:'concurrent-'+i})));
  assert.ok(settled.filter(x=>x.status==='rejected').every(x=>x.reason.code==='STALE_VERSION'));
  const saved=g.getSession(),key=await sharedKey(saved.secret),messages=[];
  for(const p of broker.packets.filter(p=>p.topic.endsWith('/requests')))messages.push(await open(key,p.payload,p.topic));
  const seqs=messages.map(m=>m.seq);assert.deepEqual(seqs,[...seqs].sort((a,b)=>a-b));
  assert.ok(host.getSession().receipts.length>=13);
});

test('host reconnect refreshes its own liveness immediately and initial broker errors clean up',async t=>{
  const {broker,host,advance}=await setup(t);advance(40000);broker.clients[0].drop();broker.clients[0].reconnect();
  await until(()=>host.getSession().snapshot.players[0].lastSeen===140000);
  const broken=new FakeBroker();broken.connectError=true;const tr=createTransport({connect:broken.connect});t.after(()=>tr.disconnect());
  await assert.rejects(tr.create({name:'Denied'}),/Connection refused/);assert.equal(broken.clients[0].alive,false);
});

test('failed mutations leave game unchanged and stale versions reject transactionally',async t=>{
  const {host,guests:[g]}=await setup(t);const before=host.getSession().snapshot;
  await assert.rejects(g.action({type:'ready',ready:'not boolean'}));
  assert.deepEqual(host.getSession().snapshot,before);
  await assert.rejects(g.action({type:'ready',ready:true,version:0}),e=>e.code==='STALE_VERSION');
  assert.deepEqual(host.getSession().snapshot,before);
});
