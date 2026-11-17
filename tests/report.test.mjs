import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyReport,validatePatch,mergeReport,applyApplicationEvent,markdown} from '../dist/report.js';
test('PAL cannot promote its own assertions to application-confirmed evidence',()=>{assert.throws(()=>validatePatch({evidence:[{text:'Database is broken',source:'application_confirmed'}]}),/reserved/);});
test('PAL revisions preserve actual application events and replace superseded claims',()=>{
  const base=applyApplicationEvent(emptyReport(),{ok:false,location:'All locations',period:'2–8 Nov 2026'});
  const first=mergeReport(base,validatePatch({title:'Export fails',impact:'Meeting Monday',evidence:[{source:'customer_reported',text:'Meeting Monday'}]}));
  const corrected=mergeReport(first,validatePatch({impact:'Meeting Tuesday',evidence:[{source:'customer_reported',text:'Meeting Tuesday'}]}));
  assert.equal(corrected.evidence.length,2);assert.equal(corrected.evidence[0].source,'application_confirmed');assert.ok(!markdown(corrected).includes('Monday'));assert.match(markdown(corrected),/Tuesday/);
});
test('repeated application events are deduplicated without losing successful comparison',()=>{let report=emptyReport();const failed={ok:false,location:'All locations',period:'week'};report=applyApplicationEvent(report,failed);report=applyApplicationEvent(report,failed);report=applyApplicationEvent(report,{ok:true,location:'Enfield',period:'week'});assert.equal(report.evidence.length,2);assert.match(markdown(report),/Export succeeded for Enfield/);assert.match(markdown(report),/EXPORT_FAILED/);});
test('malformed report updates are rejected',()=>{for(const payload of [null,[],{}, {steps:'a string'}, {title:45}, {evidence:[{source:'screen_observed',text:43}]},{unexpected:'field'}])assert.throws(()=>validatePatch(payload));});

import {saveReportUpdate,reviseEvidence,missingReportFields} from '../dist/report.js';
const complete = (overrides={})=>({mode:'final_review',title:'Export fails for all locations',steps:['Select All locations','Select 2–8 Nov 2026','Click Export'],expected:'Download a combined CSV',actual:'Export fails',error_text:'EXPORT_FAILED',impact:'Meeting Wednesday',open_questions:[],evidence:[{source:'customer_reported',text:'Needed for Wednesday meeting'}],...overrides});
test('final review requires every field even when the prior draft has values',()=>{
  const base=saveReportUpdate(emptyReport(),complete());
  assert.throws(()=>saveReportUpdate(base,{mode:'final_review',title:'Export fails',expected:'CSV'}),/complete report/);
  assert.equal(base.review_status,'ready');
});
test('blank required content cannot become ready; no error text is allowed if no error was shown',()=>{
  for(const fields of [{expected:' '},{impact:''},{steps:[]},{expected:'Not yet established.'},{evidence:[]}])assert.throws(()=>saveReportUpdate(emptyReport(),complete(fields)),/Not ready/);
  assert.throws(()=>saveReportUpdate(emptyReport(),complete({steps:[' ']})),/Invalid steps/);
  assert.equal(saveReportUpdate(emptyReport(),complete({error_text:''})).review_status,'ready');
});
test('final corrected snapshot removes stale deadline evidence and preserves sandbox events',()=>{
  let base=saveReportUpdate(emptyReport(),{title:'Failure',impact:'Meeting Tuesday',evidence:[{source:'customer_reported',text:'Tuesday deadline'}]});
  base=applyApplicationEvent(base,{ok:false,location:'All locations',period:'2–8 Nov 2026'});
  const result=saveReportUpdate(base,complete());
  assert.equal(result.review_status,'ready');assert.equal(missingReportFields(result).length,0);
  assert.doesNotMatch(markdown(result),/Tuesday/);assert.match(markdown(result),/Wednesday/);assert.match(markdown(result),/App confirmed/);
  assert.match(markdown(result),/No outstanding questions recorded/);
});
test('manual evidence edits and removal survive PAL replacement; app events stay protected',()=>{
  const base=applyApplicationEvent(saveReportUpdate(emptyReport(),complete()),{ok:false,location:'All locations',period:'week'});
  const edited=reviseEvidence(base,0,'Meeting Thursday');
  assert.equal(edited.review_status,'draft');assert.match(markdown(edited),/edited by user/);
  const locked=new Set(['evidence']);
  const result=saveReportUpdate(edited,complete(),locked);
  assert.equal(result.evidence[1].text,'Meeting Thursday');
  assert.throws(()=>reviseEvidence(result,0,'Forged success'),/cannot be edited/);
  assert.throws(()=>reviseEvidence(result,0,null),/cannot be edited/);
  const removed=reviseEvidence(result,1,null);
  assert.equal(saveReportUpdate(removed,complete(),locked).evidence.length,1);
});
test('manual field protection participates in final validation, not just rendering',()=>{
  const locked=new Set(['expected']);
  assert.throws(()=>saveReportUpdate(emptyReport(),complete(),locked),/expected/);
});
test('subsequent draft and new telemetry invalidate readiness and question assessment',()=>{
  const reviewed=saveReportUpdate(emptyReport(),complete());
  for(const result of [saveReportUpdate(reviewed,{impact:'Changed deadline'}),applyApplicationEvent(reviewed,{ok:true,location:'Camden',period:'week'})]){
    assert.equal(result.review_status,'draft');assert.match(markdown(result),/not yet been assessed/);
  }
});
test('known speech metadata is ignored without accepting arbitrary report fields',()=>{
  assert.equal(saveReportUpdate(emptyReport(),complete({response_to_user:'Updating'})).review_status,'ready');
  assert.throws(()=>saveReportUpdate(emptyReport(),complete({extra:'wrong'})),/Unknown report field/);
});
