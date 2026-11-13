import {createRequire} from 'node:module';
import {createTransport} from '../web/mqtt-transport.js';
const require=createRequire(import.meta.url),mqtt=require('mqtt');
const clients=[];const deadline=setTimeout(()=>{console.error('EMQX WSS probe deadline exceeded');for(const c of clients)c.disconnect();process.exitCode=1;},45000);
try{
 const host=createTransport({connect:mqtt.connect,timeoutMs:12000});clients.push(host);
 const h=await host.create({name:'WSS验证房主',capacity:2});
 const guest=createTransport({connect:mqtt.connect,timeoutMs:12000});clients.push(guest);
 await guest.join({code:h.room.code,name:'WSS验证客人'});
 await host.action({type:'ready',ready:true,version:host.getSession().snapshot.version,requestId:crypto.randomUUID()});
 const g=await guest.action({type:'ready',ready:true,version:host.getSession().snapshot.version,requestId:crypto.randomUUID()});
 await host.action({type:'start',version:host.getSession().snapshot.version,requestId:crypto.randomUUID()});
 await host.action({type:'roll',version:host.getSession().snapshot.version,requestId:crypto.randomUUID()});
 console.log(JSON.stringify({broker:'wss://broker.emqx.io:8084/mqtt',result:'PASS',capacity:2,players:host.getSession().snapshot.players.length,phase:host.getSession().snapshot.phase,scope:'One machine, two MQTT WSS clients; not cross-city validation; no retained messages; only own random room topics.'},null,2));
}catch(e){console.error(JSON.stringify({result:'FAIL',code:e.code,message:e.message}));process.exitCode=1;}finally{clearTimeout(deadline);for(const c of clients)c.disconnect();}
