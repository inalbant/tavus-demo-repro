import {config} from './config.js';
import {emptyReport,validatePatch,mergeReport,applyApplicationEvent,markdown,sources,saveReportUpdate,missingReportFields,reviseEvidence} from './report.js';
const $=id=>document.getElementById(id);
const dashboardOnly=new URLSearchParams(location.search).get('view')==='dashboard';
if(dashboardOnly) document.body.classList.add('dashboard-only');
let report=emptyReport(),call=null,connected=false,conversationId=null,exporting=false,generation=0,resetting=false;
const editedFields=new Set();
const processedCalls=new Map();
// A random, tab-scoped channel keeps unrelated investigations from mixing.
const params=new URLSearchParams(location.search);
let investigationId=params.get('investigation')||crypto.randomUUID();
let channel=typeof BroadcastChannel==='function'?new BroadcastChannel(`repro:${investigationId}`):null;
let toastTimer,evidenceEditIndex=null;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function renderReport(){
  const ready=report.review_status==='ready';
  $('report-status').textContent=ready?'READY FOR REVIEW':'DRAFT';
  $('report-status').className=ready?'draft-pill ready':'draft-pill';
  const missing=missingReportFields(report);
  $('review-note').textContent=ready?'Required fields are complete. Check accuracy, corrections and tested scope before copying.':missing.length?`Draft · missing: ${missing.join(', ')}. Ask Repro for a final review when you are ready.`:'Draft saved. Ask Repro to submit a complete final review.';
  $('evidence-lock-note').hidden=!editedFields.has('evidence');
  $('evidence-count').textContent=report.evidence.length;
  $('empty-evidence').hidden=report.evidence.length>0;
  $('report-title').textContent=report.title==='Untitled investigation'?'The details, without the chase.':report.title;
  $('report-subtitle').textContent=report.evidence.length?`${report.evidence.length} sourced findings · review and edit anytime`:'Findings build here as you investigate.';
  $('evidence-list').replaceChildren(...report.evidence.map((item,index)=>{
    const card=document.createElement('article');card.className='evidence-card';
    const badge=document.createElement('span');badge.className=`source-badge ${item.source}`;
    const dot=document.createElement('i');badge.append(dot,document.createTextNode(sources[item.source]+(item.user_edited?" · edited by you":"")));
    const text=document.createElement('p');text.textContent=item.text;card.append(badge,text);
    if(item.source!=='application_confirmed'){
      const actions=document.createElement('div');actions.className='evidence-actions';
      const edit=document.createElement('button');edit.type='button';edit.className='text-button';edit.textContent='Edit';edit.setAttribute('aria-label',`Edit evidence ${index+1}`);
      edit.addEventListener('click',()=>{evidenceEditIndex=index;$('evidence-edit-text').value=item.text;$('evidence-edit-error').textContent='';$('evidence-dialog').showModal();$('evidence-edit-text').focus();});
      const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove evidence ${index+1}`);
      remove.addEventListener('click',()=>changeEvidence(index,null));actions.append(edit,remove);card.append(actions);
    }
    return card;
  }));
  for(const field of $('report-form').elements){if(!field.name||document.activeElement===field)continue;const v=report[field.name];field.value=Array.isArray(v)?v.join('\n'):(v==='Untitled investigation'?'':v??'');}
}
function changeEvidence(index,text){
  report=reviseEvidence(report,index,text);editedFields.add('evidence');renderReport();
  appendContext('The customer edited the evidence list. Preserve it; do not reintroduce removed claims. '+JSON.stringify({evidence:palReport().evidence}));
}
$('evidence-edit-form').addEventListener('submit',event=>{
  event.preventDefault();
  try{changeEvidence(evidenceEditIndex,$('evidence-edit-text').value);$('evidence-dialog').close();}
  catch(error){$('evidence-edit-error').textContent=error.message;}
});
$('allow-evidence-updates').addEventListener('click',()=>{editedFields.delete('evidence');renderReport();appendContext('The customer has allowed AI evidence updates again. Retain their corrections.');});
function palReport(){return {...report,evidence:report.evidence.filter(item=>item.source!=='application_confirmed')};}
async function appendContext(context){
  if(!connected||resetting||!call?.sendMessage)return;
  try{await call.sendMessage({event_type:'conversation.append_llm_context',properties:{context}});}
  catch{toast('Draft saved, but context could not reach the call. Please repeat your correction.');}
}
function recordExport(event){
  report=applyApplicationEvent(report,event);renderReport();
  // Keep telemetry as an independent local cross-check, not a shortcut for perception.
}
function listenToDashboard(){if(channel)channel.onmessage=event=>{
  if(event.data?.type==='export'&&!dashboardOnly)recordExport(event.data.payload);
};}listenToDashboard();
function updateMetrics(){
  const values={'All locations':['£48,260','1,284'],Camden:['£17,340','462'],Enfield:['£14,820','391'],Shoreditch:['£16,100','431']};
  const [revenue,orders]=values[$('location').value];$('revenue').textContent=revenue;$('orders').textContent=orders;
  [...document.querySelectorAll('.bar')].forEach((bar,i)=>bar.style.setProperty('--height',`${[48,65,57,82,72,96,68][i]*(revenue==='£48,260'?1:.81)}%`));
}
$('location').addEventListener('change',updateMetrics);
$('export-button').addEventListener('click',async()=>{
  if(exporting)return;exporting=true;const run=generation;
  const event={location:$('location').value,period:$('period').value};
  const revenue=$('revenue').textContent.replace(/[£,]/g,''),orders=$('orders').textContent.replace(/,/g,'');
  const button=$('export-button');button.disabled=true;button.textContent='Generating…';
  const box=$('export-result');box.className='export-result neutral';box.replaceChildren();
  const message=document.createElement('strong');message.textContent=`Generating report for ${event.location}…`;box.append(message);
  await new Promise(resolve=>setTimeout(resolve,600));
  if(run!==generation)return;
  event.ok=event.location!=='All locations';event.timestamp=new Date().toISOString();
  box.className=`export-result ${event.ok?'success':'error'}`;
  const symbol=document.createElement('span');symbol.textContent=event.ok?'✓':'!';
  const content=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p');
  title.textContent=event.ok?'Report exported successfully':'EXPORT_FAILED · Unable to generate report';
  detail.textContent=event.ok?`${event.location} · ${event.period} · CSV downloaded`:`${event.location} · ${event.period} · Please try again.`;
  content.append(title,detail);box.replaceChildren(symbol,content);
  button.disabled=false;button.textContent='↓ Export report';exporting=false;
  if(dashboardOnly)channel?.postMessage({type:'export',payload:event});else recordExport(event);
  if(event.ok){const csv=`location,period,revenue,orders\n${event.location},${event.period},${revenue},${orders}\n`;const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`northstar-${event.location.toLowerCase()}-report.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
});
$('dashboard-window').addEventListener('click',()=>{const url=new URL(location.href);url.search='';url.searchParams.set('view','dashboard');url.searchParams.set('investigation',investigationId);window.open(url,'_blank','noopener');});
function selectTab(name){for(const n of ['evidence','details']){$(`${n}-tab`).setAttribute('aria-selected',String(n===name));$(`${n}-panel`).hidden=n!==name;}}
for(const name of ['evidence','details'])$(`${name}-tab`).addEventListener('click',()=>selectTab(name));
document.querySelector('.report-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const next=$('evidence-tab').getAttribute('aria-selected')==='true'?'details':'evidence';selectTab(next);$(`${next}-tab`).focus();});
$('report-form').addEventListener('submit',e=>e.preventDefault());
$('report-form').addEventListener('input',e=>{const {name,value}=e.target;if(!name)return;editedFields.add(name);report[name]=['steps','open_questions'].includes(name)?value.split('\n').filter(x=>x.trim()):value;report.review_status='draft';report.questions_assessed=false;renderReport();});
$('report-form').addEventListener('change',()=>appendContext(`The customer edited the draft report. Use these corrected fields in future report updates; manually edited fields are authoritative until a new investigation: ${JSON.stringify(palReport())}`));
$('copy-button').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(markdown(report));toast('Report copied to clipboard.');}catch{const url=URL.createObjectURL(new Blob([markdown(report)],{type:'text/markdown;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='repro-report.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Clipboard unavailable. Downloaded the complete report instead.');}});
for(const [button,dialog] of [['guide-button','guide-dialog'],['architecture-button','architecture-dialog']])$(button).addEventListener('click',()=>$(dialog).showModal());
for(const dialog of document.querySelectorAll('dialog')){dialog.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});}
$('reset-button').addEventListener('click',async()=>{
  if(resetting)return;
  resetting=true;$('reset-button').disabled=true;
  try{
    // Do not discard the report if the live call cannot be ended.
    if(call?.endConversation)await call.endConversation();
    call?.remove();call=null;connected=false;conversationId=null;generation++;exporting=false;
    processedCalls.clear();editedFields.clear();$('evidence-dialog').close();evidenceEditIndex=null;channel?.close();investigationId=crypto.randomUUID();
    channel=typeof BroadcastChannel==='function'?new BroadcastChannel(`repro:${investigationId}`):null;
    listenToDashboard();report=emptyReport();renderReport();
    $('location').value='All locations';$('period').selectedIndex=0;updateMetrics();
    $('export-button').disabled=false;$('export-button').textContent='↓ Export report';
    $('export-result').className='export-result neutral';$('export-result').replaceChildren();
    const div=document.createElement('div'),s=document.createElement('strong'),p=document.createElement('p');
    s.textContent='Ready to export';p.textContent='Your report will use the filters selected above.';
    div.append(s,p);$('export-result').append(div);
    $('call-status').classList.remove('connected');$('call-status').textContent='Not connected';
    await mountCall();
    toast('New investigation started. Open a fresh dashboard window.');
  }catch{toast('Could not end the call. Your draft is preserved; end the call and retry.');}
  finally{resetting=false;$('reset-button').disabled=false;}
});
async function handleTool(detail,element){
  if(element!==call||resetting||!connected||!detail)return;
  const {name,tool_call_id}=detail;
  try{
    if(name==='end_call'){await element.endConversation();return;}
    if(name!=='update_bug_report')return;
    let result=tool_call_id&&processedCalls.get(tool_call_id);
    if(!result){
      try{
        const raw=typeof detail.arguments==='string'?JSON.parse(detail.arguments):detail.arguments;
        if($('evidence-dialog').open)throw new Error('Customer is editing evidence. Wait until they finish before retrying.');
        report=saveReportUpdate(report,raw,editedFields);renderReport();
        result={status:'success',output:{saved:true,review_status:report.review_status,missing_fields:missingReportFields(report),protected_fields:[...editedFields],note:report.review_status==='ready'?'Complete draft saved locally. Invite the customer to check accuracy and copy it. Nothing was submitted externally. Manual edits remain authoritative.':'Draft saved locally. Continue investigating; submit mode final_review with every report field before final readback. Nothing was submitted externally.'}};
      }catch(error){toast(error.message);result={status:'error',output:{saved:false,error:error.message}};}
      if(tool_call_id)processedCalls.set(tool_call_id,result);
    }
    if(tool_call_id)await element.sendMessage({event_type:'conversation.tool_result',properties:{tool_call_id,...result}});
  }catch{toast('Tool result could not reach Tavus. The current draft remains available.');}
}
async function mountCall(){
  if(config.palTestUrl&&$('pal-test-link')){$('pal-test-link').href=config.palTestUrl;$('pal-test-link').hidden=Boolean(config.deploymentId);}
  if(!config.deploymentId||dashboardOnly)return;
  if($('setup-note'))$('setup-note').textContent='Loading the Tavus call… Allow camera and microphone access when prompted.';
  const element=document.createElement('tavus-embed');
  element.setAttribute('deployment-id',config.deploymentId);
  element.setAttribute('conversational-context','You are assisting a customer in the Repro web application. The host implements update_bug_report with mode draft or final_review. Before final readback, send mode final_review and ALL report fields: title, steps, expected, actual, error_text, impact, open_questions, evidence. Keep the complete call concise, under 3000 UTF-8 bytes. Reconcile corrections across fields and evidence, use tested conditions, and remove answered questions. Only claim ready after the host returns review_status ready. If validation fails, address the missing fields and retry. On a user correction after review, submit a new complete final review. Ready means complete, not independently fact-checked; invite the customer to review and copy the local draft. Shared-screen observations and customer statements should both be recorded with their correct evidence sources. Application telemetry is kept local as an independent cross-check and is not supplied to you. Do not treat the report panel as independent visual evidence of the product bug.');
  element.setAttribute('override-config',JSON.stringify({customization:{preview:{title:'Meet Repro',description:'Show the problem. We’ll gather the details.',btn_title:'Start investigation'},style:{mode:'light'}}}));
  call=element;
  element.addEventListener('tavus:tool-call',e=>handleTool(e.detail,element));
  element.addEventListener('tavus:conversation-started',e=>{if(element!==call||resetting)return;connected=true;conversationId=e.detail.conversationId;processedCalls.clear();$('call-status').classList.add('connected');$('call-status').innerHTML='<i></i>Connected';appendContext(`Current draft (local telemetry withheld; investigate using customer testimony and the shared dashboard): ${JSON.stringify(palReport())}`);});
  element.addEventListener('tavus:conversation-ended',()=>{if(element!==call||resetting)return;connected=false;conversationId=null;$('call-status').classList.remove('connected');$('call-status').innerHTML='<i></i>Call ended';});
  element.addEventListener('tavus:error',e=>{if(element!==call||resetting)return;connected=false;toast(e.detail?.message||'The call could not connect. Please try again.');$('call-status').classList.remove('connected');$('call-status').innerHTML='<i></i>Connection error';});
  if(customElements.get('tavus-embed')){$('call-container').replaceChildren(element);return;}
  const script=document.createElement('script');script.src='https://unpkg.com/@tavus/embed@latest';
  script.onload=async()=>{await customElements.whenDefined('tavus-embed');if(element===call)$('call-container').replaceChildren(element);};
  script.onerror=()=>{if(element!==call)return;if($('setup-note'))$('setup-note').textContent='Unable to load Tavus. Check your connection, then reload this page.';toast('Unable to load the Tavus call. Check your connection and retry.');};
  document.head.append(script);
}
renderReport();mountCall();
