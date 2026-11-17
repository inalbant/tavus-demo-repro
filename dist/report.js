export const sources = Object.freeze({customer_reported:'Customer reported',screen_observed:'Screen observation',application_confirmed:'App confirmed',hypothesis:'Hypothesis'});
export const emptyReport = () => ({title:'Untitled investigation',steps:[],expected:'',actual:'',error_text:'',impact:'',open_questions:[],evidence:[],review_status:'draft',questions_assessed:false});
const stringFields = ['title','expected','actual','error_text','impact'];
export function validatePatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Report update must be an object.');
  const allowed = [...stringFields,'steps','open_questions','evidence'];
  if (Object.keys(value).some(k=>!allowed.includes(k))) throw new Error('Unknown report field.');
  const patch = {};
  for(const [key,v] of Object.entries(value)) {
    if(stringFields.includes(key)) { if(typeof v!=='string'||v.length>3000) throw new Error(`Invalid ${key}.`); patch[key]=v; }
    else if(key==='evidence') {
      if(!Array.isArray(v)||v.length>30) throw new Error('Invalid evidence list.');
      patch.evidence=v.map(item=>{
        if(!item || !['customer_reported','screen_observed','hypothesis'].includes(item.source) || typeof item.text!=='string'||!item.text.trim()||item.text.length>1500) throw new Error('Evidence requires text and an allowed source. App-confirmed evidence is reserved for actual application events.');
        return {source:item.source,text:item.text.trim()};
      });
    } else { if(!Array.isArray(v)||v.length>30||v.some(x=>typeof x!=='string'||!x.trim()||x.length>1500)) throw new Error(`Invalid ${key}.`); patch[key]=v; }
  }
  if(!Object.keys(patch).length) throw new Error('No report fields supplied.');
  return patch;
}
export function mergeReport(report,patch,editedFields=new Set()) {
  patch=Object.fromEntries(Object.entries(patch).filter(([key])=>!editedFields.has(key)));
  const seen = new Set();
  const evidence=[...report.evidence.filter(e=>e.source==='application_confirmed'),...(patch.evidence??report.evidence.filter(e=>e.source!=='application_confirmed'))].filter(e=>{const key=e.source+':'+e.text;if(seen.has(key))return false;seen.add(key);return true;});
  return {...report,...patch,evidence,review_status:'draft',questions_assessed:false};
}
export function applyApplicationEvent(report,event) {
  const text=event.ok ? `Export succeeded for ${event.location} (${event.period}).` : `Export failed for ${event.location} (${event.period}): EXPORT_FAILED — Unable to generate report.`;
  if(report.evidence.some(e=>e.source==='application_confirmed'&&e.text===text)) return report;
  return {...report,evidence:[...report.evidence,{source:'application_confirmed',text}],review_status:'draft',questions_assessed:false};
}
export function markdown(report) {
  const list=a=>a.length?a.map(x=>`- ${x}`).join('\n'):'Not yet established.';
  return `# ${report.title}\n\nStatus: ${report.review_status==='ready'?'Ready for review — completeness checked; accuracy needs human review.':'Draft — final review pending.'}\n\n## Steps to reproduce\n${list(report.steps)}\n\n## Expected behaviour\n${report.expected||'Not yet established.'}\n\n## Actual behaviour\n${report.actual||'Not yet established.'}\n\n## Error text\n${report.error_text||'Not yet captured.'}\n\n## Customer impact\n${report.impact||'Not yet established.'}\n\n## Evidence\n${list(report.evidence.map(e=>`[${sources[e.source]}${e.user_edited?"; edited by user":""}] ${e.text}`))}\n\n## Open questions\n${report.open_questions.length?list(report.open_questions):report.questions_assessed?'No outstanding questions recorded.':'Open questions have not yet been assessed in a final review.'}\n`;
}

export const reportFields = Object.freeze(['title','steps','expected','actual','error_text','impact','open_questions','evidence']);
export function missingReportFields(report) {
  const missing=['title','expected','actual','impact'].filter(key=>!report[key]?.trim() || /^(not yet established\.?|unknown|tbd|untitled investigation)$/i.test(report[key].trim()));
  if(!report.steps?.length || report.steps.some(step=>!step.trim()))missing.push('steps');
  if(!report.evidence?.length)missing.push('evidence');
  return missing;
}
export function saveReportUpdate(report,value,editedFields=new Set()) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Report update must be an object.');
  // Tavus may inject this transport-only field when generated filler is enabled.
  const {mode='draft',response_to_user,...fields}=value;
  if(response_to_user!==undefined&&typeof response_to_user!=='string')throw new Error('Invalid speech metadata.');
  if(!['draft','final_review'].includes(mode))throw new Error('Invalid report mode.');
  if(mode==='final_review'){
    const omitted=reportFields.filter(key=>!Object.hasOwn(fields,key));
    if(omitted.length)throw new Error(`Final review requires a complete report. Missing fields: ${omitted.join(', ')}.`);
  }
  const candidate=mergeReport(report,validatePatch(fields),editedFields);
  if(mode==='final_review'){
    const missing=missingReportFields(candidate);
    if(missing.length)throw new Error(`Not ready for review. Complete: ${missing.join(', ')}. Manual edits take priority.`);
    candidate.review_status='ready';candidate.questions_assessed=true;
  }
  return candidate;
}
export function reviseEvidence(report,index,text) {
  const item=report.evidence[index];
  if(!item||item.source==='application_confirmed')throw new Error('App-confirmed events cannot be edited or removed.');
  if(text!==null&&(typeof text!=='string'||!text.trim()||text.length>1500))throw new Error('Evidence must contain 1–1500 characters.');
  const evidence=report.evidence.flatMap((entry,i)=>i!==index?[entry]:text===null?[]:[{...entry,text:text.trim(),user_edited:true}]);
  return {...report,evidence,review_status:'draft',questions_assessed:false};
}
