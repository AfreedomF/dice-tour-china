// One automatic prompt per debt episode, never per heartbeat/asset mutation.
export function createDebtPromptTracker(){let shown=false;return {shouldOpen({debt,playerId,ready}){if(!debt||debt.playerId!==playerId){shown=false;return false;}if(shown||!ready)return false;shown=true;return true;},reset(){shown=false;}};}
