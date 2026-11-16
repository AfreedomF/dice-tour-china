import {createRoom, newPlayer, publicRoom, applyAction, OFFLINE_MS} from '../server/engine.js';
import {randomHex, digest, canonical, createIdentity, sharedKey, privateKey, encrypt, decrypt, seal, open, MAX_PACKET_BYTES} from '../shared/network-crypto.js';

const clone = value => structuredClone(value);
const error = (message, code = 'TRANSPORT_ERROR') => Object.assign(new Error(message), {code});
const validId = s => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(s);
const nameOf = n => { if (typeof n !== 'string' || !n.trim() || n.trim().length > 32) throw error('Name must contain 1–32 characters','INVALID_INPUT'); return n.trim(); };
const secretOf = s => { if (typeof s !== 'string' || !/^[a-f0-9]{32,128}$/.test(s) || s.length % 2) throw error('Secret must be at least 128-bit hexadecimal','INVALID_INPUT'); return s; };
const codeOf = c => { c = String(c); if (!/^\d{6}$/.test(c)) throw error('Room code must contain six digits','INVALID_INPUT'); return c; };
// Convenience mode explicitly has no room-code secrecy: do not call this a password.
const codeKey = code => digest('dice-tour/code-only/v1:' + code);
const actionTypes = new Set(['ready','start','roll','buy','upgrade','skip','end','useCard','mortgage','redeem','sellLevel','surrender']);
const RECEIPTS = 256;
const requestDigest = (kind, body) => digest({kind,body:kind === 'action' ? {action:body?.action} : body});

/** MQTT.js-compatible connect injection. Sessions contain private keys: store locally, never share them. */
export function createTransport(options = {}) {
  const connect = options.connect ?? globalThis.mqtt?.connect?.bind(globalThis.mqtt);
  const brokerUrl = options.brokerUrl ?? 'wss://broker.emqx.io:8084/mqtt';
  if (!/^wss:\/\//i.test(brokerUrl)) throw error('Secure WebSocket MQTT (wss://) is required','INVALID_BROKER');
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 12000;
  const heartbeatMs = options.heartbeatMs ?? 8000;
  let client, connected = false, closed = true, generation = 0, session, key, inbox, personal, roomView;
  let queue = Promise.resolve(), heartbeat, connectTimer, opening, lastHostAt = 0, queuedPackets = 0;
  const pending = new Map();
  let outbound = Promise.resolve();
  const status = (state, detail = {}) => options.onStatus?.({state,...detail});
  const save = () => {
    if (!session) return;
    try { options.onSession?.(clone(session)); }
    catch (cause) {
      const e = error('Session persistence failed: ' + cause.message,'PERSISTENCE_FAILED');
      stop(e); status('error',{message:e.message,code:e.code}); throw e;
    }
  };
  const result = () => ({room:clone(roomView),playerId:session.playerId,session:getSession(),invitation:invitation()});
  const invitation = () => session ? {code:session.code,secret:session.secret,epoch:session.epoch,hostKey:session.hostKey} : null;
  const getSession = () => session ? clone(session) : null;
  function view() { if (!session?.host) return; roomView = publicRoom(session.snapshot,session.playerId,now()); options.onRoom?.(clone(roomView)); }
  function failPending(err) { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); } pending.clear(); }
  function stop(err = error('Disconnected','DISCONNECTED')) {
    closed = true; connected = false; generation++; clearTimeout(connectTimer); clearInterval(heartbeat); heartbeat = null;
    opening?.reject(err); opening = null; failPending(err);
    const old = client; client = null; old?.end(true); status('disconnected');
    // A rejected local operation must not poison the next resume's serial queue.
    queue = queue.catch(() => {});
  }
  function publish(topic, payload) { return new Promise((resolve,reject) => {
    if (!connected || !client) return reject(error('Broker is offline','OFFLINE'));
    client.publish(topic,payload,{qos:1,retain:false},err => err ? reject(err) : resolve());
  }); }
  async function subscribe(topic) { await new Promise((resolve,reject) => client.subscribe(topic,{qos:1},(err, grants) => err || grants?.some(g => g.qos === 128) ? reject(err ?? error('Subscription denied')) : resolve())); }
  async function response(to, body) {
    const peer = session.identities[to];
    // Unknown joiners receive a signed public error only; no room or private material.
    const privateBody = peer ? await encrypt(await privateKey(session.identity,peer.dhKey),body,session.epoch + ':' + to) : body;
    session.hostSeq++; save();
    const message = {v:1,epoch:session.epoch,seq:session.hostSeq,to,kind:peer?'private':'error',body:privateBody};
    await publish(await topicFor(to),await seal(key,session.identity,message,await topicFor(to)));
  }
  async function topicFor(id) { return 'dice-tour/v1/' + await digest(session.code + ':' + session.secret) + '/' + (id === 'inbox' ? 'requests' : await digest('view:' + id)); }
  async function broadcast() {
    view(); save();
    for (const [id, peer] of Object.entries(session.identities)) if (id !== session.identity.id) {
      await response(id,{kind:'view',room:publicRoom(session.snapshot,peer.playerId,now()),playerId:peer.playerId,hostDh:session.identity.dhPublic});
    }
  }
  async function sendRequest(kind, body = {}, requestId = randomHex(16)) {
    if (!validId(requestId)) throw error('Invalid requestId','INVALID_INPUT');
    if (pending.size >= 32) throw error('Too many pending requests','BUSY');
    if (pending.has(requestId)) throw error('Request already pending','BUSY');
    let resolveReply, rejectReply;
    const reply = new Promise((resolve,reject) => { resolveReply=resolve; rejectReply=reject; });
    // Serialize signing and publication, not host replies: ECDSA promises may complete out of order.
    const ownGeneration = generation;
    outbound = outbound.catch(() => {}).then(async () => {
      if (closed || generation !== ownGeneration) throw error('Disconnected','DISCONNECTED');
      if (pending.has(requestId)) throw error('Request already pending','BUSY');
      if (pending.size >= 32) throw error('Too many pending requests','BUSY');
      session.seq++; save();
      const data = {v:1,epoch:session.epoch ?? null,hostKey:session.hostKey ?? null,kind,body,requestId,seq:session.seq};
      const wire = await seal(key,session.identity,data,inbox);
      const fingerprint = await requestDigest(kind,body);
      const timer = setTimeout(() => { pending.delete(requestId); rejectReply(error('Host response timed out','HOST_TIMEOUT')); }, timeoutMs);
      pending.set(requestId,{resolve:resolveReply,reject:rejectReply,timer,wire,fingerprint});
      try { await publish(inbox,wire); } catch (e) { clearTimeout(timer); pending.delete(requestId); throw e; }
    }).catch(rejectReply);
    return reply;
  }
  async function hostRequest(m) {
    if (m.v !== 1 || !validId(m.requestId) || !Number.isSafeInteger(m.seq) || m.seq < 1 || !['join','sync','heartbeat','action'].includes(m.kind)) return;
    if (m.epoch && m.epoch !== session.epoch || m.hostKey && m.hostKey !== session.hostKey) return;
    if (m.kind !== 'join' && m.epoch !== session.epoch) return;
    let peer = session.identities[m.from];
    if (peer && (canonical(peer.signKey) !== canonical(m.signKey) || canonical(peer.dhKey) !== canonical(m.dhKey))) return;
    const fingerprint = await requestDigest(m.kind,m.body);
    const receiptKey = m.from + ':' + m.requestId;
    const prior = session.receipts.find(r => r.key === receiptKey);
    if (prior) { await response(m.from,{...(prior.fingerprint === fingerprint ? prior.reply : {kind:'reply',requestId:m.requestId,error:{message:'requestId reused with different content',code:'REQUEST_ID_REUSE'}}),fingerprint}); return; }
    if (peer && m.seq <= peer.lastSeq) { await response(m.from,{kind:'reply',requestId:m.requestId,fingerprint,error:{message:'Replayed request',code:'REPLAY'}}); return; }
    let reply;
    try {
      if (!m.body || typeof m.body !== 'object' || Array.isArray(m.body)) throw error('Invalid request','INVALID_INPUT');
      if (m.kind === 'join') {
        if (!peer) {
          if (session.snapshot.status !== 'lobby' || session.snapshot.players.length >= session.snapshot.capacity) throw error('Room is full or already started','ROOM_UNAVAILABLE');
          const name = nameOf(m.body.name);
          // Validate ECDH key before committing membership.
          await privateKey(session.identity,m.dhKey);
          const next = clone(session.snapshot), player = newPlayer(name,now());
          next.players.push(player); next.version++; next.updatedAt = now();
          session.snapshot = next;
          peer = session.identities[m.from] = {playerId:player.id,signKey:m.signKey,dhKey:m.dhKey,lastSeq:0};
        }
      } else if (!peer) throw error('Identity is not a room member','UNAUTHORIZED');
      if (peer) {
        const next = clone(session.snapshot);
        next.players.find(p => p.id === peer.playerId).lastSeen = now();
        if (m.kind === 'action') {
          const action = cleanAction(m.body.action);
          if (!Number.isSafeInteger(m.body.version) || m.body.version !== next.version) throw error('State changed; retry after synchronizing','STALE_VERSION');
          applyAction(next,peer.playerId,action,{now:now(),...(options.rng ? {rng:options.rng} : {})});
        }
        session.snapshot = next;
        peer.lastSeq = m.seq;
      }
      reply = {kind:'reply',requestId:m.requestId,room:publicRoom(session.snapshot,peer.playerId,now()),playerId:peer.playerId,hostDh:session.identity.dhPublic};
    } catch (e) {
      if (peer) peer.lastSeq = m.seq;
      reply = {kind:'reply',requestId:m.requestId,error:{message:String(e.message).slice(0,200),code:e.code ?? 'INVALID_ACTION'},...(peer?{room:publicRoom(session.snapshot,peer.playerId,now()),playerId:peer.playerId}:{})};
    }
    if (peer) {
      session.receipts.push({key:receiptKey,fingerprint,reply}); session.receipts = session.receipts.slice(-RECEIPTS); save();
    }
    await response(m.from,{...reply,fingerprint});
    if (!reply.error) await broadcast();
  }
  async function guestMessage(m) {
    if (m.v !== 1 || m.to !== session.identity.id || !Number.isSafeInteger(m.seq) || m.seq <= (session.lastHostSeq ?? 0)) return;
    if (session.hostKey && m.from !== session.hostKey || session.epoch && m.epoch !== session.epoch) return;
    // TOFU is only accepted in direct response to a currently pending join.
    let body;
    if (m.kind === 'private') body = await decrypt(await privateKey(session.identity,m.dhKey),m.body,m.epoch + ':' + session.identity.id);
    else if (m.kind === 'error') body = m.body;
    else return;
    if (!session.hostKey && (!body.requestId || !pending.has(body.requestId))) return;
    if (!session.hostKey) session.hostKey = m.from;
    if (!session.epoch) session.epoch = m.epoch;
    if (session.hostDh && canonical(session.hostDh) !== canonical(m.dhKey)) return;
    session.hostDh = m.dhKey; session.lastHostSeq = m.seq; lastHostAt = now();
    if (body.room && (!roomView || body.room.version >= roomView.version)) {
      roomView = body.room; session.playerId = body.playerId; session.room = clone(roomView); options.onRoom?.(clone(roomView));
    }
    save(); status('connected');
    if (body.kind === 'reply') {
      const p = pending.get(body.requestId);
      if (p && (!body.fingerprint || body.fingerprint === p.fingerprint)) { clearTimeout(p.timer); pending.delete(body.requestId); body.error ? p.reject(error(body.error.message,body.error.code)) : p.resolve(result()); }
    }
  }
  async function receive(topic, raw) {
    const text = typeof raw === 'string' ? raw : raw.toString();
    if (text.length > MAX_PACKET_BYTES || topic !== (session.host ? inbox : personal)) return;
    try {
      const m = await open(key,text,topic);
      if (session.host) await hostRequest(m); else await guestMessage(m);
    } catch (e) { options.onSecurityEvent?.({code:'REJECTED_PACKET',message:String(e.message).slice(0,160)}); }
  }
  async function begin() {
    if (typeof connect !== 'function') throw error('Inject mqtt.connect as options.connect','MQTT_UNAVAILABLE');
    key = await sharedKey(session.secret); inbox = await topicFor('inbox'); personal = await topicFor(session.identity.id);
    closed = false; connected = false; const ownGeneration = ++generation; let hasConnected = false; status('connecting');
    return new Promise((resolve,reject) => {
      opening = {reject};
      const timeout = () => { const e = error('MQTT connection timed out','CONNECT_TIMEOUT'); stop(e); status('error',{message:e.message,code:e.code}); reject(e); };
      connectTimer = setTimeout(timeout,timeoutMs);
      try {
        client = connect(brokerUrl,{username:options.username,password:options.password,clean:true,clientId:'dtc-' + randomHex(12),reconnectPeriod:options.reconnectPeriod ?? 1000,connectTimeout:timeoutMs,resubscribe:false,queueQoSZero:false});
        client.on('message',(topic,raw) => {
          if (closed || generation !== ownGeneration || queuedPackets >= 128 || raw.length > MAX_PACKET_BYTES) return;
          queuedPackets++;
          queue = queue.then(() => { if (generation === ownGeneration && !closed) return receive(topic,raw); }).catch(e => status('error',{message:e.message})).finally(() => { queuedPackets--; });
        });
        client.on('connect',() => {
          queue = queue.then(async () => {
            if (closed || generation !== ownGeneration) return;
            connected = true;
            try {
              await subscribe(session.host ? inbox : personal);
              clearTimeout(connectTimer); opening = null; hasConnected = true; lastHostAt = now(); status('connected');
              if (session.host) session.snapshot.players.find(p=>p.id===session.playerId).lastSeen = now();
              if (!heartbeat) heartbeat = setInterval(() => {
                if (!connected || closed) return;
                if (session.host) {
                  // The host is locally present; remote lastSeen is refreshed only by signed traffic.
                  const p = session.snapshot.players.find(p => p.id === session.playerId); p.lastSeen = now();
                  queue = queue.then(() => broadcast()).catch(e => status('error',{message:e.message}));
                } else {
                  if (now() - lastHostAt > OFFLINE_MS) status('paused',{message:'Host is offline'});
                  sendRequest('heartbeat').catch(e => { if (!closed) status('paused',{message:e.message,code:e.code}); });
                }
              },heartbeatMs);
              for (const p of pending.values()) await publish(inbox,p.wire);
              if (session.host) { await broadcast(); }
              else if (session.playerId && pending.size === 0) { void sendRequest('sync').catch(e => status('paused',{message:e.message,code:e.code})); }
              resolve();
            } catch (e) { stop(e); status('error',{message:e.message,code:e.code}); reject(e); }
          });
        });
        const offline = () => { if (closed || ownGeneration !== generation) return; connected = false; status('reconnecting'); clearTimeout(connectTimer); connectTimer = setTimeout(timeout,timeoutMs); };
        client.on('offline',offline); client.on('close',offline);
        client.on('error',e => {
          if (closed) return;
          if (!hasConnected) { stop(e); status('error',{message:e.message,code:e.code ?? 'MQTT_ERROR'}); reject(e); }
          else status('error',{message:e.message,code:e.code ?? 'MQTT_ERROR'});
        });
      } catch (e) { stop(e); reject(e); }
    });
  }
  function cleanAction(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !actionTypes.has(input.type)) throw error('Invalid action','INVALID_INPUT');
    if (canonical(input).length > 4096) throw error('Action too large','INVALID_INPUT');
    const out = {type:input.type};
    for (const k of ['ready','cardId','steps','tileId']) if (input[k] !== undefined) out[k] = input[k];
    return out;
  }
  async function create({name,capacity = 2,secret} = {}) {
    if (!closed) throw error('Disconnect before changing rooms','BUSY');
    name = nameOf(name); if (![2,4].includes(capacity)) throw error('Capacity must be 2 or 4','INVALID_INPUT');
    const identity = await createIdentity();
    // Rejection sampling avoids modulo bias for the six-digit invitation code.
    let n; do { n = parseInt(randomHex(4),16); } while (n >= 4294800000);
    const code = String(100000 + n % 900000), snapshot = createRoom(code,capacity,name,now(),{rng:options.boardRng});
    session = {protocol:1,host:true,code,secret:secretOf(secret ?? await codeKey(code)),joinMode:secret?'invite':'code',epoch:randomHex(16),hostKey:identity.id,identity,playerId:snapshot.hostId,snapshot,identities:{[identity.id]:{playerId:snapshot.hostId,signKey:identity.signPublic,dhKey:identity.dhPublic,lastSeq:0}},receipts:[],hostSeq:0,seq:0};
    save(); await begin(); view(); return result();
  }
  async function join({code,secret,name,epoch,hostKey} = {}) {
    if (!closed) throw error('Disconnect before changing rooms','BUSY');
    name = nameOf(name); code = codeOf(code); secret = secretOf(secret ?? await codeKey(code));
    if (epoch !== undefined && !/^[a-f0-9]{32}$/.test(epoch) || hostKey !== undefined && !/^[a-f0-9]{64}$/.test(hostKey)) throw error('Invalid invitation pin','INVALID_INPUT');
    session = {protocol:1,host:false,code,secret,identity:await createIdentity(),seq:0,lastHostSeq:0,...(epoch?{epoch}:{}),...(hostKey?{hostKey}:{})};
    roomView = undefined; save(); await begin();
    try { return await sendRequest('join',{name}); } catch (e) { stop(e); status('error',{message:e.message,code:e.code}); throw e; }
  }
  async function resume(saved) {
    if (!closed) throw error('Disconnect before resuming','BUSY');
    if (!saved || saved.protocol !== 1 || typeof saved.host !== 'boolean' || !saved.identity?.signPrivate || !saved.identity?.dhPrivate) throw error('Invalid saved session','INVALID_SESSION');
    codeOf(saved.code); secretOf(saved.secret);
    if (await digest(saved.identity.signPublic) !== saved.identity.id || !/^[a-f0-9]{32}$/.test(saved.epoch) || !/^[a-f0-9]{64}$/.test(saved.hostKey)) throw error('Invalid saved identity','INVALID_SESSION');
    session = clone(saved); roomView = saved.room ? clone(saved.room) : undefined;
    if (session.host) {
      if (session.hostKey !== session.identity.id || !session.snapshot?.players?.some(p => p.id === session.playerId) || !session.identities || !Array.isArray(session.receipts) || session.receipts.length > RECEIPTS) throw error('Invalid host snapshot','INVALID_SESSION');
      session.snapshot.players.find(p => p.id === session.playerId).lastSeen = now();
    }
    await begin(); if (session.host) { view(); return result(); }
    return sendRequest('sync');
  }
  async function action(input, meta = {}) {
    if (closed || !connected || !session?.playerId) throw error('Not connected to a room','OFFLINE');
    const a = cleanAction(input), requestId = meta.requestId ?? input.requestId ?? randomHex(16);
    if (!validId(requestId)) throw error('Invalid requestId','INVALID_INPUT');
    const body = {action:a,version:input.version ?? roomView?.version};
    if (!session.host) return sendRequest('action',body,requestId);
    // Local actions traverse exactly the same authorization, receipt and transactional path.
    return new Promise((resolve,reject) => {
      queue = queue.then(async () => {
        const fingerprint = await requestDigest('action',body), receiptKey = session.identity.id + ':' + requestId;
        const prior = session.receipts.find(r => r.key === receiptKey);
        if (prior) { if (prior.fingerprint !== fingerprint) throw error('requestId reused with different content','REQUEST_ID_REUSE'); if (prior.reply.error) throw error(prior.reply.error.message,prior.reply.error.code); return result(); }
        const next = clone(session.snapshot); next.players.find(p => p.id === session.playerId).lastSeen = now();
        let failure;
        try { if (!Number.isSafeInteger(body.version) || body.version !== next.version) throw error('State changed','STALE_VERSION'); applyAction(next,session.playerId,a,{now:now(),...(options.rng?{rng:options.rng}:{})}); session.snapshot = next; }
        catch (e) { failure = {message:e.message,code:e.code ?? 'INVALID_ACTION'}; }
        session.receipts.push({key:receiptKey,fingerprint,reply:failure?{error:failure}:{ok:true}}); session.receipts = session.receipts.slice(-RECEIPTS); save();
        if (failure) throw error(failure.message,failure.code); await broadcast(); return result();
      }).then(resolve,reject);
    });
  }
  return {create,join,resume,action,disconnect:() => stop(),getSession};
}
