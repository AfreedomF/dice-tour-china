import test from 'node:test';import assert from 'node:assert/strict';
import {createTransport} from '../web/mqtt-transport.js';import {FakeBroker} from './fake-mqtt.js';
for(const capacity of [2,4])test(`${capacity} human room joins using code only without host approval, rejects full room and restores identity`,async t=>{
 const broker=new FakeBroker(),clients=[];const make=()=>{const x=createTransport({connect:broker.connect,timeoutMs:700,heartbeatMs:60000});clients.push(x);return x;};t.after(()=>clients.forEach(x=>x.disconnect()));
 const host=make(),created=await host.create({name:'房主',capacity});assert.equal(created.session.joinMode,'code');const guests=[];
 for(let i=1;i<capacity;i++){const g=make();const joined=await g.join({name:'旅伴'+i,code:created.room.code});assert.equal(joined.room.code,created.room.code);assert.equal(joined.room.players.filter(p=>p.cards).length,1);guests.push(g);}
 assert.equal(host.getSession().snapshot.players.length,capacity);await assert.rejects(make().join({name:'满员客人',code:created.room.code}),e=>e.code==='ROOM_UNAVAILABLE');
 const saved=guests[0].getSession();guests[0].disconnect();const restored=await make().resume(saved);assert.equal(restored.playerId,saved.playerId);assert.equal(host.getSession().snapshot.players.length,capacity);
});
test('old explicitly secret-protected rooms cannot be entered with only code',async t=>{const broker=new FakeBroker(),clients=[];const make=()=>{const x=createTransport({connect:broker.connect,timeoutMs:60,heartbeatMs:60000});clients.push(x);return x;};t.after(()=>clients.forEach(x=>x.disconnect()));const h=await make().create({name:'旧邀请房主',secret:'ab'.repeat(32)});await assert.rejects(make().join({name:'仅房号客人',code:h.room.code}),e=>e.code==='HOST_TIMEOUT');const r=await make().join({...h.invitation,name:'完整邀请客人'});assert.equal(r.room.players.length,2);});
