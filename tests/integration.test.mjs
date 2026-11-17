import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, start, update } from './helpers/browser.mjs';

const finalPayload = {
  mode: 'final_review',
  title: 'Export failure',
  steps: ['Select All locations', 'Export 2–8 Nov'],
  expected: 'Download CSV',
  actual: 'Export fails',
  error_text: 'EXPORT_FAILED',
  impact: 'Meeting Wednesday',
  open_questions: [],
  evidence: [{ source: 'customer_reported', text: 'Meeting Wednesday' }],
};
const exportMessage = {
  type: 'export',
  payload: { ok: false, location: 'All locations', period: '2–8 Nov 2026' },
};

test('export CSV uses click-time metrics even if location changes during generation', async () => {
  const h = createHarness();
  h.get('location').value = 'Camden';
  await h.get('location').emit('change');
  const pending = h.get('export-button').emit('click');
  h.get('location').value = 'Enfield';
  await h.get('location').emit('change');
  h.tick(600);
  await pending;
  assert.match(await h.blobs[0].text(), /Camden,2–8 Nov 2026,17340,462/);
});
test('manual correction survives late tool updates and duplicate calls do not reapply', async () => {
  const h = createHarness();
  await start(h);
  await update(h.call(), 't1', { title: 'Export fails', impact: 'Monday' });
  await h.edit('impact', 'Tuesday');
  await update(h.call(), 't2', { impact: 'Monday' });
  assert.equal(h.fields.impact.value, 'Tuesday');
  await update(h.call(), 't1', { title: 'Overwritten' });
  assert.equal(h.fields.title.value, 'Export fails');
  assert.equal(h.sent.filter((m) => m.event_type === 'conversation.tool_result').length, 3);
});
test('reset cancels pending export and rejects events from the old embed', async () => {
  const h = createHarness();
  await start(h);
  const old = h.call();
  const pending = h.get('export-button').emit('click');
  await h.get('reset-button').emit('click');
  h.tick(600);
  await pending;
  await update(old, 'late', { title: 'Old investigation' });
  await old.emit('tavus:conversation-started', { detail: { conversationId: 'old' } });
  assert.equal(h.fields.title.value, '');
  assert.deepEqual(h.evidence(), []);
  assert.equal(h.get('call-status').textContent, 'Not connected');
  assert.notEqual(h.call(), old);
  assert.equal(h.channels[0].closed, true);
});
test('failed call shutdown preserves report and allows reset retry', async () => {
  const h = createHarness();
  await start(h);
  await update(h.call(), 't1', { title: 'Keep me' });
  h.call().endConversation = async () => {
    throw Error('offline');
  };
  await h.get('reset-button').emit('click');
  assert.equal(h.fields.title.value, 'Keep me');
  assert.equal(h.get('reset-button').disabled, false);
});
test('telemetry remains local through initial context, tools and manual corrections', async () => {
  const h = createHarness();
  await h.exportReport();
  await start(h);
  await update(h.call(), 't1', { title: 'Investigating' });
  await h.get('report-form').emit('change');
  assert.equal(h.evidence().length, 1);
  assert.doesNotMatch(JSON.stringify(h.sent), /EXPORT_FAILED|application_confirmed/);
});
test('forged provenance is rejected while a call without an ID can still save locally', async () => {
  const h = createHarness();
  await start(h);
  await update(h.call(), 'bad', {
    evidence: [{ source: 'application_confirmed', text: 'Forged' }],
  });
  assert.equal(h.sent.at(-1).properties.status, 'error');
  assert.deepEqual(h.evidence(), []);
  await update(h.call(), undefined, { title: 'No ID' });
  assert.equal(h.fields.title.value, 'No ID');
});
test('clipboard denial downloads complete Markdown including evidence', async () => {
  const h = createHarness();
  await h.exportReport();
  h.browser.navigator.clipboard.writeText = async () => {
    throw Error('denied');
  };
  await h.get('copy-button').emit('click');
  assert.match(await h.blobs[0].text(), /App confirmed.*EXPORT_FAILED/);
});
test('final review updates visible status; incomplete final request returns an actionable error', async () => {
  const h = createHarness();
  await start(h);
  await update(h.call(), 'invalid', { mode: 'final_review', title: 'Bad', expected: '' });
  assert.equal(h.sent.at(-1).properties.status, 'error');
  assert.match(h.sent.at(-1).properties.output.error, /Missing fields/);
  assert.equal(h.get('report-status').textContent, 'DRAFT');
  await update(h.call(), 'valid', finalPayload);
  assert.equal(h.get('report-status').textContent, 'READY FOR REVIEW');
  assert.equal(h.sent.at(-1).properties.output.review_status, 'ready');
  assert.ok(JSON.stringify(h.sent.at(-1)).length < 1500);
  await h.edit('impact', 'Meeting Thursday');
  assert.equal(h.get('report-status').textContent, 'DRAFT');
});
test('evidence editor protects corrections and removes only PAL findings', async () => {
  const h = createHarness();
  await start(h);
  await update(h.call(), 'valid', finalPayload);
  await h.exportReport();
  const actions = h.get('evidence-list').children[0].children[2];
  await actions.children[0].emit('click');
  h.get('evidence-edit-text').value = 'Meeting Thursday';
  await h.get('evidence-edit-form').emit('submit', { preventDefault() {} });
  assert.ok(h.evidence().includes('Meeting Thursday'));
  assert.equal(h.get('evidence-lock-note').hidden, false);
  await update(h.call(), 'late', {
    evidence: [{ source: 'customer_reported', text: 'Meeting Wednesday' }],
  });
  assert.ok(h.evidence().includes('Meeting Thursday'));
  assert.equal(h.get('evidence-list').children[0].children.length, 2);
  const editedCard = h.get('evidence-list').children[1];
  await editedCard.children[2].children[1].emit('click');
  assert.equal(h.evidence().length, 1);
  await h.get('allow-evidence-updates').emit('click');
  assert.equal(h.get('evidence-lock-note').hidden, true);
  await update(h.call(), 'released', {
    evidence: [{ source: 'customer_reported', text: 'New finding' }],
  });
  assert.ok(h.evidence().includes('New finding'));
});
test('malformed JSON preserves the saved draft and shows a persistent rejection', async () => {
  const h = createHarness();
  await start(h);
  await update(h.call(), 'valid', finalPayload);
  await h.call().emit('tavus:tool-call', {
    detail: { name: 'update_bug_report', tool_call_id: 'bad-json', arguments: '{broken' },
  });
  assert.equal(h.fields.title.value, finalPayload.title);
  assert.equal(h.sent.at(-1).properties.output.saved, false);
  assert.match(h.get('save-error').textContent, /rejected.*valid JSON/);
  h.tick(3500);
  assert.equal(h.get('save-error').hidden, false);
  await update(h.call(), 'valid', finalPayload); // old success must not hide a newer failure
  assert.equal(h.get('save-error').hidden, false);
  await update(h.call(), 'repaired', { impact: 'Meeting Thursday' });
  assert.equal(h.get('save-error').hidden, true);
});
test('failed result delivery stays visible and retry confirms without overwriting manual edits', async () => {
  const h = createHarness();
  await start(h);
  const send = h.call().sendMessage;
  h.call().sendMessage = async () => {
    throw Error('offline');
  };
  await update(h.call(), 'retry', { title: 'Saved locally' });
  assert.equal(h.fields.title.value, 'Saved locally');
  assert.match(h.get('save-error').textContent, /saved locally.*could not reach Tavus/);
  h.tick(3500);
  assert.equal(h.get('save-error').hidden, false);
  await h.edit('title', 'Customer correction');
  h.call().sendMessage = send;
  await update(h.call(), 'retry', { title: 'Saved locally' });
  assert.equal(h.fields.title.value, 'Customer correction');
  assert.equal(h.get('save-error').hidden, true);
});
test('a late delivery acknowledgement cannot clear a newer failure', async () => {
  const h = createHarness();
  await start(h);
  const send = h.call().sendMessage;
  let resolveDelivery;
  h.call().sendMessage = () =>
    new Promise((resolve) => {
      resolveDelivery = resolve;
    });
  const pending = update(h.call(), 'delayed', { title: 'Saved' });
  h.call().sendMessage = send;
  await update(h.call(), 'invalid', { title: 42 });
  resolveDelivery();
  await pending;
  assert.match(h.get('save-error').textContent, /rejected/);
  assert.equal(h.get('save-error').hidden, false);
});
test('reset clears a previous save failure', async () => {
  const h = createHarness();
  await start(h);
  await update(h.call(), 'invalid', { title: 42 });
  await h.get('reset-button').emit('click');
  assert.equal(h.get('save-error').hidden, true);
  assert.equal(h.fields.title.value, '');
});
test('malformed cross-window events are ignored and a valid event still works afterwards', () => {
  const h = createHarness();
  for (const data of [
    null,
    {},
    { type: 'other' },
    { type: 'export', payload: null },
    { type: 'export', payload: { ...exportMessage.payload, ok: 'false' } },
    { type: 'export', payload: { ...exportMessage.payload, location: 'Unknown' } },
    { type: 'export', payload: { ...exportMessage.payload, period: 'Invented' } },
    { type: 'export', payload: { ...exportMessage.payload, ok: true } },
  ]) {
    assert.doesNotThrow(() => h.message(data));
  }
  assert.deepEqual(h.evidence(), []);
  h.message(exportMessage);
  h.message(exportMessage);
  assert.equal(h.evidence().length, 1);
  assert.match(h.evidence()[0], /All locations.*2–8 Nov 2026/);
});
test('dashboard windows send exports only to their matching active investigation', async () => {
  const bus = [];
  const host = createHarness({ bus, search: '?investigation=shared' });
  const dashboard = createHarness({ bus, search: '?view=dashboard&investigation=shared' });
  const unrelated = createHarness({ bus, search: '?investigation=another' });
  assert.equal(dashboard.call(), undefined);
  await dashboard.exportReport();
  assert.equal(host.evidence().length, 1);
  assert.deepEqual(unrelated.evidence(), []);
  await host.get('reset-button').emit('click');
  await dashboard.exportReport('Camden');
  assert.deepEqual(host.evidence(), []);
});
test('a failed embed script leaves a visible connection error without breaking the dashboard', async () => {
  const h = createHarness({ embedLoaded: false });
  h.browser.document.head.children[0].onerror();
  h.tick(3500);
  assert.match(h.get('setup-note').textContent, /Unable to load Tavus/);
  assert.equal(h.get('call-status').textContent, 'Connection error');
  await h.exportReport();
  assert.equal(h.evidence().length, 1);
});
test('a stale script failure cannot replace the current investigation loading message', async () => {
  const h = createHarness({ embedLoaded: false });
  const oldScript = h.browser.document.head.children[0];
  await h.get('reset-button').emit('click');
  oldScript.onerror();
  assert.match(h.get('setup-note').textContent, /Loading the Tavus call/);
});
