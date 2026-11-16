const h = React.createElement;
const listeners = new Set();
let opened = false;
function notify(value) { opened = value; for (const fn of listeners) fn(); }
return {
  inject: ['slots', 'locale'],
  apply(ctx) {
    const ns = 'dice-tour-china';
    const labels = typeof UI_TEXTS !== 'undefined' ? UI_TEXTS : [];
    const dictionary = Object.fromEntries(labels.map(s => [s,s]));
    Object.assign(dictionary, {'open':'骰游中国','close':'收起游戏','title':'骰游中国 · 城市合伙人'});
    const english = {...dictionary,open:'Dice tour China',close:'Minimize game',title:'Dice tour China'};
    ctx.effect(() => ctx.locale.register(ns,'zh',dictionary));
    ctx.effect(() => ctx.locale.register(ns,'en',english));
    const translate = ctx.locale.bind(ns);
    const Game = createGameUI(React,{BOARD,CITIES,CARDS},s => labels.includes(s) ? translate(s) : s);
    // Game state is separate from DSH session data. Network starts only after user connects.
    function useOpened() { return React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>opened); }
    function Entry({wide}) {
      const active=useOpened();
      return h('button',{type:'button',title:translate('open'),'aria-label':translate('open'),'aria-expanded':active,onClick:()=>notify(!opened),style:{background:'var(--dsw-alias-bg-layer-1)',color:'var(--dsw-alias-label-primary)',border:'1px solid var(--dsw-alias-border-l1)',borderRadius:8,padding:8,cursor:'pointer'}},wide?'🎲 '+translate('open'):'🎲');
    }
    function Surface() {
      const active=useOpened();
      React.useSyncExternalStore(fn=>ctx.locale.subscribe(fn),()=>ctx.locale.getSnapshot());
      const [visited,setVisited]=React.useState(false);
      React.useEffect(()=>{if(active)setVisited(true);},[active]);
      const ref=React.useRef(null);
      React.useEffect(()=>{
        if(!active) return;
        const previous=document.activeElement;
        const panel=ref.current;
        panel?.focus();
        function key(e) {
          if(e.key==='Escape'){e.preventDefault();notify(false);}
          if(e.key==='Tab') {
            const nodes=[...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(n=>n.getClientRects().length);
            if(!nodes.length){e.preventDefault();return;}
            const first=nodes[0],last=nodes[nodes.length-1];
            if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel)){e.preventDefault();last.focus();}
            else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===panel)){e.preventDefault();first.focus();}
          }
        }
        panel?.addEventListener('keydown',key);
        return()=>{panel?.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};
      },[active]);
      // Keep mounted while minimized so an active human participant keeps heartbeating.
      return h('section',{ref,role:'dialog','aria-modal':active?'true':undefined,'aria-label':translate('title'),tabIndex:-1,style:{display:active?'flex':'none',position:'fixed',inset:'2vh 2vw',zIndex:85,pointerEvents:'auto',flexDirection:'column',background:'var(--dsw-alias-bg-base)',color:'var(--dsw-alias-label-primary)',border:'1px solid var(--dsw-alias-border-l2)',borderRadius:16,overflow:'hidden',isolation:'isolate'}},
        h('header',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 12px',fontSize:12,flexShrink:0,borderBottom:'1px solid var(--dsw-alias-border-l1)'}},h('strong',null,translate('title')+' · 收起仍在线；主动断开才停止'),h('button',{type:'button',onClick:()=>notify(false),style:{background:'var(--dsw-alias-bg-layer-2)',color:'inherit',border:'1px solid var(--dsw-alias-border-l1)',borderRadius:6,padding:'6px 12px'}},translate('close'))),
        h('div',{style:{overflow:'auto',flex:1,minHeight:0,height:'100%'}},visited&&h(Game,{defaultServer:'wss://broker.emqx.io:8084/mqtt',embedded:true,onClose:()=>notify(false)})));
    }
    ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'dice-tour-china-entry',order:40,label:()=>translate('open')},Entry));
    ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'dice-tour-china-game',order:85},Surface));
    ctx.effect(()=>()=>{opened=false;listeners.clear();});
  }
};
