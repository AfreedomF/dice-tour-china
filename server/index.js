import {createApp} from './app.js';
const port=Number(process.env.PORT??8787),host=process.env.HOST??'127.0.0.1';
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT must be an integer in 0..65535');
const app=await createApp();
app.server.listen(port,host,()=>console.log(`城市漫游: http://${host}:${app.server.address().port}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.close().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});});
