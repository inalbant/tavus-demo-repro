import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as reportModule from '../dist/report.js';

// Executes the real host application against a small DOM/transport double.
// This verifies host logic, not rendering or Tavus service behaviour.
function harness(){
  class Element {
    constructor(){this.listeners={};this.children=[];this.attributes={};this.classList={add(){},remove(){}};this.style={setProperty(){}};this.elements=[];this.value='';this.textContent='';}
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
    async emit(name,event={}){for(const fn of this.listeners[name]??[])await fn(event);}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    setAttribute(k,v){this.attributes[k]=v;}
    getAttribute(k){return this.attributes[k];}
    remove(){this.removed=true;}
    click(){} focus(){} showModal(){this.open=true;} close(){this.open=false;}
  }
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  get('location').value='All locations';get('period').value='2–8 Nov 2026';get('revenue').textContent='£48,260';get('orders').textContent='1,284';
  const timers=[],blobs=[],channels=[],sent=[];
  const document={getElementById:get,body:new Element(),head:new Element(),activeElement:null,querySelector:()=>get('tabs'),querySelectorAll:()=>[],createTextNode:t=>t,createElement:tag=>{const e=new Element();if(tag==='tavus-embed'){e.sendMessage=async m=>sent.push(m);e.endConversation=async()=>{};}return e;}};
  class TestURL extends URL {static createObjectURL(b){blobs.push(b);return 'blob:test';}static revokeObjectURL(){}}
  const context=vm.createContext({...reportModule,config:{deploymentId:'test',palTestUrl:null},document,location:{search:'',href:'http://localhost:4173'},URL:TestURL,URLSearchParams,Blob,crypto:{randomUUID:()=>String(Math.random())},BroadcastChannel:class {constructor(){channels.push(this);}close(){this.closed=true;}},customElements:{get:()=>true},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},window:{open(){}},navigator:{clipboard:{writeText:async()=>{}}}});
  vm.runInContext(readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
  return {get,sent,blobs,channels,run:code=>vm.runInContext(code,context),tick:ms=>{for(const timer of timers.splice(0).filter(t=>t.ms===ms))timer.fn();},call:()=>get('call-container').children[0]};
}
const start=async h=>h.call().emit('tavus:conversation-started',{detail:{conversationId:'c1'}});
const update=(call,id,patch)=>call.emit('tavus:tool-call',{detail:{name:'update_bug_report',tool_call_id:id,arguments:JSON.stringify(patch)}});

test('export CSV uses click-time metrics even if location changes during generation',async()=>{
  const h=harness();h.get('location').value='Camden';await h.get('location').emit('change');
  const pending=h.get('export-button').emit('click');
  h.get('location').value='Enfield';await h.get('location').emit('change');h.tick(600);await pending;
  assert.match(await h.blobs[0].text(),/Camden,2–8 Nov 2026,17340,462/);
});
test('manual correction survives late tool updates and duplicate calls do not reapply',async()=>{
  const h=harness();await start(h);
  await update(h.call(),'t1',{title:'Export fails',impact:'Monday'});
  await h.get('report-form').emit('input',{target:{name:'impact',value:'Tuesday'}});
  await update(h.call(),'t2',{impact:'Monday'});
  assert.equal(h.run('report.impact'),'Tuesday');
  await update(h.call(),'t1',{title:'Overwritten'});
  assert.equal(h.run('report.title'),'Export fails');
  assert.equal(h.sent.filter(m=>m.event_type==='conversation.tool_result').length,3);
});
test('reset cancels pending export and rejects events from the old embed',async()=>{
  const h=harness();await start(h);const old=h.call();
  const pending=h.get('export-button').emit('click');
  await h.get('reset-button').emit('click');h.tick(600);await pending;
  await update(old,'late',{title:'Old investigation'});
  await old.emit('tavus:conversation-started',{detail:{conversationId:'old'}});
  assert.equal(h.run('report.title'),'Untitled investigation');assert.equal(h.run('report.evidence.length'),0);
  assert.equal(h.run('connected'),false);assert.notEqual(h.call(),old);assert.equal(h.channels[0].closed,true);
});
test('failed call shutdown preserves report and allows reset retry',async()=>{
  const h=harness();await start(h);await update(h.call(),'t1',{title:'Keep me'});
  h.call().endConversation=async()=>{throw Error('offline');};
  await h.get('reset-button').emit('click');
  assert.equal(h.run('report.title'),'Keep me');assert.equal(h.get('reset-button').disabled,false);
});
test('telemetry remains local through initial context, tools and manual corrections',async()=>{
  const h=harness();h.run("recordExport({ok:false,location:'All locations',period:'week'})");await start(h);
  await update(h.call(),'t1',{title:'Investigating'});await h.get('report-form').emit('change');
  assert.equal(h.run('report.evidence.length'),1);
  assert.ok(!JSON.stringify(h.sent).includes('EXPORT_FAILED'));
  assert.ok(!JSON.stringify(h.sent).includes('application_confirmed'));
});
test('invalid payload returns error, missing optional call ID still updates draft, transport failure is contained',async()=>{
  const h=harness();await start(h);
  await update(h.call(),'bad',{evidence:[{source:'application_confirmed',text:'Forged'}]});
  assert.equal(h.sent.at(-1).properties.status,'error');
  await update(h.call(),undefined,{title:'No ID'});assert.equal(h.run('report.title'),'No ID');
  h.call().sendMessage=async()=>{throw Error('offline');};
  await update(h.call(),'offline',{title:'Saved locally'});assert.equal(h.run('report.title'),'Saved locally');
  assert.match(h.get('toast').textContent,/could not reach/);
});
test('clipboard denial downloads complete Markdown including evidence',async()=>{
  const h=harness();h.run("recordExport({ok:false,location:'All locations',period:'week'});navigator.clipboard.writeText=async()=>{throw Error('denied')}");
  await h.get('copy-button').emit('click');assert.match(await h.blobs[0].text(),/App confirmed.*EXPORT_FAILED/);
});

const finalPayload={mode:'final_review',title:'Export failure',steps:['Select All locations','Export 2–8 Nov'],expected:'Download CSV',actual:'Export fails',error_text:'EXPORT_FAILED',impact:'Meeting Wednesday',open_questions:[],evidence:[{source:'customer_reported',text:'Meeting Wednesday'}]};
test('final review updates visible status; incomplete final request returns an actionable error',async()=>{
  const h=harness();await start(h);
  await update(h.call(),'invalid',{mode:'final_review',title:'Bad',expected:''});
  assert.equal(h.sent.at(-1).properties.status,'error');assert.match(h.sent.at(-1).properties.output.error,/Missing fields/);
  assert.equal(h.get('report-status').textContent,'DRAFT');
  await update(h.call(),'valid',finalPayload);
  assert.equal(h.get('report-status').textContent,'READY FOR REVIEW');
  assert.equal(h.sent.at(-1).properties.output.review_status,'ready');
  assert.ok(JSON.stringify(h.sent.at(-1)).length<1500);
  await h.get('report-form').emit('input',{target:{name:'impact',value:'Meeting Thursday'}});
  assert.equal(h.get('report-status').textContent,'DRAFT');
});
test('evidence editor protects corrections and removes only PAL findings',async()=>{
  const h=harness();await start(h);await update(h.call(),'valid',finalPayload);
  h.run("recordExport({ok:false,location:'All locations',period:'week'})");
  const card=h.get('evidence-list').children[0],actions=card.children[2];
  await actions.children[0].emit('click');
  h.get('evidence-edit-text').value='Meeting Thursday';
  await h.get('evidence-edit-form').emit('submit',{preventDefault(){}});
  assert.equal(h.run('report.evidence[0].text'),'Meeting Thursday');
  assert.equal(h.get('evidence-lock-note').hidden,false);
  await update(h.call(),'late',{evidence:[{source:'customer_reported',text:'Meeting Wednesday'}]});
  assert.equal(h.run("report.evidence.find(e=>e.source==='customer_reported').text"),'Meeting Thursday');
  assert.equal(h.get('evidence-list').children[0].children.length,2); // no editing controls for app event
  const editedCard=h.get('evidence-list').children[1];
  await editedCard.children[2].children[1].emit('click');
  assert.equal(h.run('report.evidence.length'),1);
  await h.get('allow-evidence-updates').emit('click');
  assert.equal(h.get('evidence-lock-note').hidden,true);
});
