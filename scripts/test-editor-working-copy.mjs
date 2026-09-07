import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { EditorDatabase, createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';

const database = await createEditorDatabase();
seedLegacy(database);
const store = new NativePostStore(database);
const input = { title: '시험 제목', description: '설명', bodyMarkdown: '본문', categoryId: 'daily', tags: ['시험'], coverMediaId: null };
const category = { id: 'daily', slug: '일상', label: '일상' };
const original = await store.getPublishedBySequence(1);
assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS n FROM editor_working_copies').get().n, 0);
const legacySaved = await store.update('legacy-1', 0, { ...input, bodyMarkdown: '<p>미공개 작업본</p>' });
assert.equal(legacySaved.publishedRevision, 0);
assert.equal((await store.getPublishedBySequence(1)).bodyHtml, original.bodyHtml);
assert.equal((await store.listPublished()).find((post) => post.id === 'legacy-1').title, original.title);
assert.equal((await store.listForAdmin()).find((post) => post.id === 'legacy-1').title, input.title);
const legacyPublished = await store.publish('legacy-1', legacySaved.revision);
assert.equal(legacyPublished.publishedRevision, legacyPublished.revision);
assert.equal(legacyPublished.publishedAt, original.publishedAt);
assert.equal(legacyPublished.globalSequence, 1);
const blankLegacy = await store.update('legacy-1', legacyPublished.revision, { ...input, title: '', bodyMarkdown: '' });
await assert.rejects(() => store.publish('legacy-1', blankLegacy.revision), /NATIVE_E_INPUT/u);
assert.equal((await store.getPublishedBySequence(1)).title, input.title);

const native = await store.createDraft(category);
assert.equal(native.publishedRevision, null);
const saved = await store.update(native.id, 0, input);
assert.equal(saved.publishedRevision, null);
assert.equal((await store.listPublished()).some((post) => post.id === native.id), false);
const firstPublic = await store.publish(native.id, saved.revision);
assert.equal(firstPublic.globalSequence, 597);
const changed = await store.update(native.id, firstPublic.revision, { ...input, title: '아직 공개하지 않은 제목' });
assert.equal((await store.getPublishedBySequence(597)).title, input.title);
const secondPublic = await store.publish(native.id, changed.revision);
assert.equal(secondPublic.title, '아직 공개하지 않은 제목');
assert.equal(secondPublic.publishedAt, firstPublic.publishedAt);
assert.equal(secondPublic.globalSequence, 597);

// Both requests complete their initial read before SQLite serializes the CAS.
const races = await Promise.allSettled([
  store.update(native.id, secondPublic.revision, { ...input, title: '탭 A' }),
  store.update(native.id, secondPublic.revision, { ...input, title: '탭 B' }),
]);
assert.equal(races.filter((result) => result.status === 'fulfilled').length, 1);
assert.match(races.find((result) => result.status === 'rejected').reason.message, /NATIVE_E_REVISION/u);
const winner = races.find((result) => result.status === 'fulfilled').value;
assert.equal((await store.getForAdmin(native.id)).title, winner.title);
assert.equal((await store.getPublishedBySequence(597)).title, secondPublic.title);
await assert.rejects(() => store.publish(native.id, secondPublic.revision), /NATIVE_E_REVISION/u);
const publishRace = await Promise.allSettled([store.publish(native.id, winner.revision), store.publish(native.id, winner.revision)]);
assert.equal(publishRace.filter((result) => result.status === 'fulfilled').length, 1);
assert.equal((await store.getPublishedBySequence(597)).title, winner.title);

// Change the revision after the read but before the exact publishing transaction.
const originalBatch = database.batch.bind(database);
let intercept = true;
database.batch = async (statements) => {
  if (intercept) {
    intercept = false;
    database.sqlite.prepare('UPDATE editor_working_copies SET revision = revision + 1, title = ? WHERE post_id = ?').run('다른 세션의 최신본', native.id);
  }
  return originalBatch(statements);
};
const beforeStale = await store.getForAdmin(native.id);
await assert.rejects(() => store.publish(native.id, beforeStale.revision), /NATIVE_E_REVISION/u);
assert.equal((await store.getPublishedBySequence(597)).title, winner.title);
assert.equal((await store.getForAdmin(native.id)).title, '다른 세션의 최신본');
database.batch = originalBatch;

const mediaId = '223e4567-e89b-42d3-a456-426614174000';
const mediaPath = `/media/native/${mediaId}.png`;
await store.addMedia({ id: mediaId, postId: 'legacy-1', publicPath: mediaPath, objectKey: mediaPath.slice(1), sha256: 'a'.repeat(64), bytes: 1, mime: 'image/png', alt: '시험', createdAt: new Date().toISOString() });
const legacyWithImage = await store.update('legacy-1', blankLegacy.revision, { ...input, bodyMarkdown: `<p>새 이미지</p><img src="${mediaPath}" alt="시험">` });
assert.equal(await store.getPublicMedia(mediaPath), null);
assert.equal((await store.getAdminMedia(mediaPath)).id, mediaId);
const legacyImagePublic = await store.publish('legacy-1', legacyWithImage.revision);
assert.equal((await store.getPublicMedia(mediaPath)).id, mediaId);
const legacyImageRemoved = await store.update('legacy-1', legacyImagePublic.revision, { ...input, bodyMarkdown: '<p>이미지 삭제 작업본</p>' });
assert.equal((await store.getPublicMedia(mediaPath)).id, mediaId);
await store.publish('legacy-1', legacyImageRemoved.revision);
assert.equal(await store.getPublicMedia(mediaPath), null);

// A write error after the working revision changes rolls back both snapshots.
const beforeFailure = await store.getForAdmin(native.id);
database.sqlite.exec("CREATE TRIGGER fail_public_write BEFORE UPDATE ON native_posts BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END");
await assert.rejects(() => store.publish(native.id, beforeFailure.revision), /synthetic write failure/u);
assert.equal((await store.getForAdmin(native.id)).revision, beforeFailure.revision);
assert.equal((await store.getPublishedBySequence(597)).title, winner.title);
database.sqlite.exec('DROP TRIGGER fail_public_write');

// Upgrade an existing database without changing any public or draft content.
const oldDatabase = new EditorDatabase();
for (const name of ['0001_native_editor.sql', '0002_legacy_editor.sql', '0003_legacy_import_state.sql']) oldDatabase.sqlite.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
seedLegacy(oldDatabase);
const legacyBefore = { ...oldDatabase.sqlite.prepare('SELECT * FROM legacy_posts').get() };
oldDatabase.sqlite.exec(await readFile(new URL('../migrations/0004_editor_working_copies.sql', import.meta.url), 'utf8'));
oldDatabase.sqlite.exec(await readFile(new URL('../migrations/0005_editor_body_format.sql', import.meta.url), 'utf8'));
assert.deepEqual({ ...oldDatabase.sqlite.prepare('SELECT * FROM legacy_posts').get() }, legacyBefore);
assert.equal((await new NativePostStore(oldDatabase).getForAdmin('legacy-1')).publishedRevision, 0);
assert.equal(oldDatabase.sqlite.prepare('SELECT COUNT(*) AS n FROM editor_working_copies').get().n, 0);

console.log(JSON.stringify({ suite: 'editor-working-copy', status: 'PASS', behavior: 'public isolation, native/legacy publish, blank working copy, racing CAS, stale publish, transaction rollback, migration preservation' }));
