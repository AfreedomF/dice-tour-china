import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url));
const esbuildRequire=createRequire(require.resolve('esbuild'));
const executable=esbuildRequire.resolve('@esbuild/win32-x64/esbuild.exe');
await mkdir(path.join(root,'dist/browser/vendor'),{recursive:true});await mkdir(path.join(root,'dist/build'),{recursive:true});
// Native CLI with inherited stdio: no sandbox-prohibited captured child pipes.
function bundle(entry,out,globalName){const result=spawnSync(executable,[entry,'--bundle','--platform=browser','--format=iife',...(globalName?['--global-name='+globalName]:[]),'--minify','--legal-comments=eof','--define:process.env.NODE_ENV="production"','--outfile='+out],{cwd:path.join(root,'tools'),stdio:'inherit',env:{...process.env,NODE_PATH:path.join(root,'tools/node_modules')}});if(result.error)throw result.error;if(result.status!==0)throw new Error('esbuild exited '+result.status);}
bundle(path.join(root,'web/app.js'),path.join(root,'dist/browser/vendor/app.bundle.js'));
await copyFile(path.join(root,'web/index.html'),path.join(root,'dist/browser/index.html'));
const uiSource=await readFile(path.join(root,'web/game-ui.js'),'utf8');
const labels=[...new Set([...uiSource.matchAll(/'([^'\n]*[\u3400-\u9fff][^'\n]*)'/g)].map(m=>m[1]))];
const wrapper='const UI_TEXTS='+JSON.stringify(labels)+';\n'+await readFile(path.join(root,'tools/plugin-wrapper.js'),'utf8');
await writeFile(path.join(root,'tools/plugin-entry.generated.js'),`import {createGameUI} from '../web/game-ui.js';\nimport {BOARD,CITIES,CARDS} from '../shared/content.js';\nexport default function(React){\n${wrapper}\n}\n`);
bundle(path.join(root,'tools/plugin-entry.generated.js'),path.join(root,'dist/build/plugin-core.js'),'DiceTourPlugin');
const core=await readFile(path.join(root,'dist/build/plugin-core.js'),'utf8');
await writeFile(path.join(root,'plugin/client.js'),`window.__ModuleLoader__.load({id:'@local/dice-tour-china',factory(require){const React=require('react');\n${core}\nreturn DiceTourPlugin.default(React);}});\n`);
await mkdir(path.join(root,'plugin/locale'),{recursive:true});
for(const [locale,meta] of Object.entries({zh:{title:'骰游中国：城市合伙人',description:'2 人或 4 人真人旅行经营桌游。EMQX/WSS 转发，房主客户端裁判；无需独立游戏服务器。游戏内容仅中文。'},en:{title:'Dice tour China: City partners',description:'A 2- or 4-human travel board game using EMQX/WSS and a host-client referee. No standalone game server. Game content is Chinese only.'}}))await writeFile(path.join(root,`plugin/locale/${locale}.json`),JSON.stringify({meta},null,2)+'\n');
await mkdir(path.join(root,'locale'),{recursive:true});
for(const file of ['index.js','client.js','cordis.patch.yml','icon.svg','locale/en.json','locale/zh.json'])await copyFile(path.join(root,'plugin',file),path.join(root,file));
console.log('Built browser, plugin ZIP directory, and matching GitHub root bundle; React comes from DSH.');
