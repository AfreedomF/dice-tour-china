// Deterministic in-memory MQTT.js subset; no sockets, processes or public broker traffic.
export class FakeBroker {
  constructor() { this.clients = []; this.packets = []; this.duplicate = false; this.connectError = false; this.silent = false; }
  connect = (url, options) => {
    const handlers = new Map(), broker = this;
    const client = {url,options,subscriptions:new Set(),alive:true,
      on(event,fn) { const all = handlers.get(event) ?? []; all.push(fn); handlers.set(event,all); return this; },
      emit(event,...args) { for (const fn of handlers.get(event) ?? []) fn(...args); },
      subscribe(topic,opts,cb) { this.subscriptions.add(topic); queueMicrotask(() => cb(null,[{topic,qos:1}])); },
      publish(topic,payload,opts,cb) { if (!this.alive) { cb(Error('offline')); return; } broker.deliver(topic,payload,opts); queueMicrotask(() => cb?.()); },
      end() { this.alive = false; this.subscriptions.clear(); },
      drop() { this.alive = false; this.subscriptions.clear(); this.emit('offline'); this.emit('close'); },
      reconnect() { this.alive = true; this.emit('connect'); }
    };
    this.clients.push(client);
    queueMicrotask(() => { if (this.silent) return; if (this.connectError) client.emit('error',Error('Connection refused')); else client.emit('connect'); });
    return client;
  };
  deliver(topic,payload,opts = {qos:1,retain:false}) {
    this.packets.push({topic,payload,opts});
    for (const c of this.clients) if (c.alive && c.subscriptions.has(topic)) {
      queueMicrotask(() => c.emit('message',topic,payload));
      if (this.duplicate) queueMicrotask(() => c.emit('message',topic,payload));
    }
  }
}
export async function settle(n = 30) { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); }
