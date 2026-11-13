export const CITIES = [
  {id:'beijing',name:'北京',color:'#e45858',icon:'🏯'},
  {id:'xian',name:'西安',color:'#dc9650',icon:'🏺'},
  {id:'chengdu',name:'成都',color:'#84b56a',icon:'🐼'},
  {id:'chongqing',name:'重庆',color:'#b96cbe',icon:'🌉'},
  {id:'guangzhou',name:'广州',color:'#39b6a5',icon:'🌺'},
  {id:'shanghai',name:'上海',color:'#618fe3',icon:'🏙️'},
  {id:'hangzhou',name:'杭州',color:'#5eb3c9',icon:'🪷'},
  {id:'xiamen',name:'厦门',color:'#d4a24c',icon:'🌊'}
];
const landmarks = [['故宫','天坛','颐和园'],['兵马俑','大雁塔','古城墙'],['宽窄巷子','武侯祠','熊猫基地'],['洪崖洞','解放碑','磁器口'],['广州塔','沙面','陈家祠'],['外滩','豫园','陆家嘴'],['西湖','灵隐寺','西溪湿地'],['鼓浪屿','南普陀','环岛路']];
const functions = ['start','event','station','event','shop','event','station','park'];
const names = ['旅程起点','城市奇遇','高铁驿站','街巷奇遇','旅行商店','滨江奇遇','高铁驿站','城市公园'];
export const BOARD = CITIES.flatMap((city,i)=>[
  {id:i*4,type:functions[i],name:names[i]},
  ...landmarks[i].map((name,j)=>({id:i*4+j+1,type:'property',name,city:city.id,price:800+i*120+j*100,upgradeCost:400+i*60,baseRent:100+i*25+j*20}))
]);
export const CARDS = [
  {id:'precise',name:'精准骰子',description:'掷骰前使用并选择 1～6 步，下一次掷骰固定为该步数。'},
  {id:'slow',name:'慢游卡',description:'掷骰前使用，下一次骰子随机为 1～3 步。'},
  {id:'discount',name:'优惠券',description:'掷骰前使用，下一次购买或升级费用减半；未消费则保留，不能叠加。'},
  {id:'shield',name:'免租卡',description:'使用后自动抵挡下一笔租金，直到触发前一直有效。'},
  {id:'bonus',name:'旅行补贴',description:'立即获得 500 元旅行补贴。'}
];
