// Pure queue rules: room snapshots carry bounded authoritative event records.
export function unseenEvents(previous,next){if(!previous||previous.code!==next?.code)return [];const seen=new Set((previous.events||[]).map(e=>e.id));return (next.events||[]).filter(e=>!seen.has(e.id));}
export const EVENT_POPUP_MS=5000;
export function createEventQueue(onChange,{setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let pending=[],current=null,timer=null,disposed=false;const seen=new Set();
 function emit(){onChange(current);}
 function advance(){if(disposed)return;if(timer!==null)clearTimer(timer);timer=null;current=pending.shift()||null;emit();if(current)timer=setTimer(advance,EVENT_POPUP_MS);}
 return {push(events){if(disposed)return;for(const event of events){if(seen.has(event.id))continue;seen.add(event.id);pending.push(event);}while(seen.size>128)seen.delete(seen.values().next().value);if(!current&&pending.length)advance();},dismiss:advance,reset(){if(timer!==null)clearTimer(timer);timer=null;pending=[];current=null;seen.clear();if(!disposed)emit();},dispose(){disposed=true;if(timer!==null)clearTimer(timer);pending=[];current=null;timer=null;},getCurrent:()=>current};
}
