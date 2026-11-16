/* Pure presentation helpers. No transport, clocks, React or game randomness. */
export function boardCoordinates(index, size=9) {
  const edge=size-1, count=edge*4;
  const i=((Math.trunc(Number(index)||0)%count)+count)%count;
  if(i<=edge)return {row:0,column:i};
  if(i<=edge*2)return {row:i-edge,column:edge};
  if(i<=edge*3)return {row:edge,column:edge*3-i};
  return {row:edge*4-i,column:0};
}
export function boardPlace(index,size=9) {
  const {row,column}=boardCoordinates(index,size);
  return {gridRow:row+1,gridColumn:column+1};
}
export function forwardPath(from,to,count=32) {
  if(!Number.isInteger(count)||count<1)return [];
  const norm=n=>((Math.trunc(Number(n)||0)%count)+count)%count;
  const start=norm(from),end=norm(to),distance=(end-start+count)%count;
  return Array.from({length:distance},(_,i)=>(start+i+1)%count);
}
export function pawnOffset(slot=0) {
  return [{x:-13,y:-15},{x:13,y:-15},{x:-13,y:15},{x:13,y:15}][((slot%4)+4)%4];
}
export function pawnPosition(index,slot=0,size=9) {
  const {row,column}=boardCoordinates(index,size),offset=pawnOffset(slot);
  return {left:(column+.5)/size*100+'%',top:(row+.5)/size*100+'%', '--pawn-x':offset.x+'px','--pawn-y':offset.y+'px'};
}
export function dicePips(value) {
  const n=Number(value);
  const layouts={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  return (layouts[n]||[]).map(i=>({row:Math.floor(i/3)+1,column:i%3+1}));
}
/* Only authoritative movement constitutes a roll; version / online heartbeats do not. */
export function rollTransition(previous,next) {
  if(!previous||!next||previous.code!==next.code)return null;
  const before=previous.players?.find(p=>p.id===previous.turnPlayerId);
  const after=next.players?.find(p=>p.id===previous.turnPlayerId);
  if(!before||!after||previous.status!=='playing')return null;
  const movement=next.lastMove;
  if(movement&&movement.id!==previous.lastMove?.id&&movement.playerId===before.id){
    return {playerId:before.id,from:movement.from,to:movement.to,path:forwardPath(movement.from,movement.landed),value:movement.steps,teleport:movement.to!==movement.landed};
  }
  const path=forwardPath(before.position,after.position);
  const rolled=path.length>0 || (previous.phase==='roll'&&next.phase!=='roll'&&Number(next.lastDice)>0);
  return rolled?{playerId:before.id,from:before.position,to:after.position,path,value:Number(next.lastDice)||path.length}:null;
}
