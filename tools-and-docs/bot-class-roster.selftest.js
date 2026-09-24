'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
const src=fs.readFileSync(require('path').join(__dirname,'../server/bot/src/bot.js'),'utf8');
const fragment=src.slice(src.indexOf('function rosterClassKey'),src.indexOf("bot.command('students'"));
let role={classes:[{code:'own'}]}, classes=[['own',{name:'Мой класс',ownerTgId:2}],['school',{name:'Школа',orgId:'a',ownerTgId:3}],['other',{name:'Чужой',orgId:'b',ownerTgId:4}],['gone',{archived:true,ownerTgId:2}]];
let students=[];
const doc=(id,data)=>({id,exists:!!data,data:()=>data});
const snap=rows=>({size:rows.length,forEach:fn=>rows.forEach(([id,d])=>fn(doc(id,d)))});
const fdb={doc:()=>({get:async()=>doc('2',role)}),collection:path=>{let field,value;return {where(f,op,v){field=f;value=v;return this;},limit(){return this;},async get(){return snap(path.endsWith('/classes')?classes:students.filter(([,d])=>d[field]===value));}};}};
class Keyboard {constructor(){this.rows=[[]];}text(t,data){assert(Buffer.byteLength(data)<=64);this.rows.at(-1).push({t,data});return this;}row(){this.rows.push([]);return this;}}
const sandbox={crypto,fdb,base:'base',ADMIN_ID:1,InlineKeyboard:Keyboard,normClasses:a=>(a||[]).map(c=>typeof c==='string'?{code:c}:c)};
vm.createContext(sandbox);vm.runInContext(fragment,sandbox);
const ctx=()=>({from:{id:2},chat:{type:'private'},reply:async(text,opts)=>({text,opts})});
(async()=>{
 assert.deepEqual(Array.from(await sandbox.rosterClasses(2),c=>c.code),['own']);
 role={role:'org_owner',orgId:'a',classes:[]};assert.deepEqual(Array.from(await sandbox.rosterClasses(2),c=>c.code).sort(),['own','school']);
 assert.equal((await sandbox.doClassRoster({...ctx(),chat:{type:'group'}})).text.includes('личном'),true);
 role={classes:['own']};
 students=Array.from({length:23},(_,i)=>[String(100+i),{name:`Ученик ${i}`,classCode:'own',knownTgId:String(100+i),username:i===0?'ivan_petrov':i===1?'bad name!':''}]);
 students.push(['dup',{name:'Копия',classCode:'own',knownTgId:'100'}],['merged',{classCode:'own',_mergedInto:'100'}],['left',{classCode:'own',leftClassAt:123}],['moved',{classCode:'own',inviteClassCode:'other'}],['new',{name:'<Имя & фамилия>',classCode:'other',inviteClassCode:'own'}]);
 const key=sandbox.rosterClassKey('own');
 let r=await sandbox.doClassRoster(ctx(),key,0);assert(r.text.includes('Учеников: 24.'));assert(r.text.includes('&lt;Имя &amp; фамилия&gt;'));assert(r.text.includes('Telegram не привязан'));assert(r.text.length<4096);
 // Имя — ссылка на профиль (работает и без юзернейма), @юзернейм — отдельной ссылкой t.me; кривой юзернейм не выводится.
 assert(r.text.includes('<a href="tg://user?id=100">Ученик 0</a>'));assert(r.text.includes('<a href="https://t.me/ivan_petrov">@ivan_petrov</a>'));assert(!r.text.includes('bad name'));assert.equal((r.text.match(/<a /g)||[]).length,(r.text.match(/<\/a>/g)||[]).length);assert(!/<a href="tg:\/\/user\?id=">/.test(r.text));
 r=await sandbox.doClassRoster(ctx(),key,1);assert(r.text.includes('Страница 2 из 2'));assert.equal((r.text.match(/tg:\/\/user\?id=/g)||[]).length,4);
 classes[0][1].ownerTgId=3;role=null;r=await sandbox.doClassRoster(ctx(),key);assert(r.text.includes('Нет доступных'));
 role={classes:['own']};r=await sandbox.doClassRoster(ctx(),sandbox.rosterClassKey('other'));assert(r.text.includes('недоступен'));
 assert.equal(sandbox.rosterTgId(doc('google_x',{})),null);assert.equal(sandbox.rosterTgId(doc('789',{})),'789');
 console.log('Class roster: roles, school isolation, revoked access, private chat, paging, merges, transfers, profile links and HTML escaping passed');
})().catch(e=>{console.error(e);process.exitCode=1});
