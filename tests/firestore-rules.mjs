// Run ONLY with the local Firestore emulator. Never targets the live project.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, serverTimestamp, query, where, orderBy, limit } from 'firebase/firestore';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('These rules tests require the local Firestore emulator.');
const projectId = 'demo-sunpro-analytics';
const rules = fs.readFileSync(new URL('../firebase/firestore.rules', import.meta.url), 'utf8');
const ownerEmail = rules.match(/request\.auth\.token\.email == '([^']+)'/)[1];
let env;
before(async () => {
  const [hostname, port] = host.split(':');
  env = await initializeTestEnvironment({ projectId, firestore: { host: hostname, port: Number(port), rules } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });
const payload = overrides => ({ version: 1, event: 'page_view', page: '/', visitorId: randomUUID(), sessionId: randomUUID(), source: 'instagram', medium: 'social', campaign: 'refresh_october', device: 'mobile', service: '', createdAt: serverTimestamp(), ...overrides });
const target = db => doc(collection(db, 'websiteAnalytics'), randomUUID());
const owner = () => env.authenticatedContext('owner', { email: ownerEmail, email_verified: true }).firestore();
const other = () => env.authenticatedContext('other-account', { email: 'other@example.invalid', email_verified: true }).firestore();
const publicDB = () => env.unauthenticatedContext().firestore();
test('anonymous browser may append a valid event, but cannot read it', async () => {
  const ref = target(publicDB());
  await assertSucceeds(setDoc(ref, payload()));
  await assertFails(getDoc(ref));
  await assertSucceeds(getDoc(doc(owner(), ref.path)));
});
test('the old signed-in wildcard cannot bypass analytics owner-only reads', async () => {
  const ref = target(publicDB()); await setDoc(ref, payload());
  await assertFails(getDoc(doc(other(), ref.path)));
  const unverified = env.authenticatedContext('unverified-owner', { email: ownerEmail, email_verified: false }).firestore();
  await assertFails(getDoc(doc(unverified, ref.path)));
  await assertFails(getDocs(collection(publicDB(), 'websiteAnalytics')));
});
test('neither visitors nor signed-in accounts may alter or delete events', async () => {
  const ref = target(publicDB()); await setDoc(ref, payload());
  for (const db of [publicDB(), other(), owner()]) {
    await assertFails(updateDoc(doc(db, ref.path), { source: 'facebook' }));
    await assertFails(deleteDoc(doc(db, ref.path)));
  }
});
test('PII fields, arbitrary sources, admin pages and client timestamps are rejected', async () => {
  const db = publicDB();
  for (const change of [{ email: 'private@example.invalid' }, { source: 'anything' }, { page: '/admin.html' }, { campaign: 'person@example.invalid' }, { createdAt: new Date(0) }, { sessionId: 'bad-id' }, { version: 2 }, { event: 'unapproved' }]) await assertFails(setDoc(target(db), payload(change)));
});
test('existing public gallery and enquiry access is preserved', async () => {
  await assertSucceeds(setDoc(doc(publicDB(), 'enquiries', 'example'), { name: 'Fixture only' }));
  await assertFails(getDoc(doc(publicDB(), 'enquiries', 'example')));
  await assertSucceeds(getDoc(doc(other(), 'enquiries', 'example')));
  await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'gallery', 'refresh', 'photos', 'fixture'), { order: 0 }); });
  await assertSucceeds(getDoc(doc(publicDB(), 'gallery', 'refresh', 'photos', 'fixture')));
  await assertFails(setDoc(doc(publicDB(), 'gallery', 'fixture'), { order: 0 }));
});
test('the admin dashboard range query needs no public read access', async () => {
  await setDoc(target(publicDB()), payload());
  const q = query(collection(owner(), 'websiteAnalytics'), where('createdAt', '>=', new Date(Date.now() - 86400000)), where('createdAt', '<=', new Date(Date.now() + 1000)), orderBy('createdAt', 'desc'), limit(500));
  const snap = await assertSucceeds(getDocs(q)); assert.equal(snap.size, 1);
});
test('the browser REST commit schema with REQUEST_TIME passes the exact prepared rules', async () => {
  const fields = Object.fromEntries(Object.entries(payload({ createdAt: undefined })).filter(([key]) => key !== 'createdAt').map(([key, value]) => [key, typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }]));
  const write = { update: { name: `projects/${projectId}/databases/(default)/documents/websiteAnalytics/${randomUUID()}`, fields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] };
  const response = await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents:commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: [write] }) });
  assert.equal(response.ok, true, await response.text());
  assert.equal((await getDocs(collection(owner(), 'websiteAnalytics'))).size, 1);
});
