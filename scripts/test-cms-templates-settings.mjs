import assert from 'node:assert/strict';
import { createEditorDatabase } from './fixtures/editor-database.mjs';
import { CmsConfigurationStore, DEFAULT_SETTINGS } from '../src/lib/cms-configuration.ts';

const db = await createEditorDatabase(), store = new CmsConfigurationStore(db);
// Existing saved settings gain defaults without rewriting their document.
db.sqlite.prepare("INSERT INTO cms_configuration VALUES ('settings', ?, 1, 'synthetic')").run(JSON.stringify({ ...DEFAULT_SETTINGS, timezone: undefined, ccl: undefined, iconPath: undefined }));
const initial = await store.settings();
assert.equal(initial.value.timezone, 'Asia/Seoul'); assert.equal(initial.value.ccl, 'none'); assert.equal(initial.value.iconPath, null);
await assert.rejects(() => store.saveSettings(1, { ...initial.value, timezone: 'Mars/Base' }), /SETTINGS/);
await assert.rejects(() => store.saveSettings(1, { ...initial.value, ccl: 'unrecognized' }), /SETTINGS/);
const path = '/media/site/123e4567-e89b-42d3-a456-426614174000.png';
await assert.rejects(() => store.saveSettings(1, { ...initial.value, iconPath: path }), /ICON/);
db.sqlite.prepare('INSERT INTO cms_media VALUES (?, ?, ?, ?, ?, ?, ?)').run('123e4567-e89b-42d3-a456-426614174000', path, path.slice(1), 'a'.repeat(64), 1, 'image/png', 'synthetic');
const settings = await store.saveSettings(1, { ...initial.value, timezone: 'America/New_York', ccl: 'by-nc-sa', iconPath: path });
assert.equal(settings.value.iconPath, path); assert.equal(settings.value.timezone, 'America/New_York');
await assert.rejects(() => store.saveSettings(1, initial.value), /REVISION/);
const template = { id: '123e4567-e89b-42d3-a456-426614174000', name: '합성 서식', html: '<h2>제목</h2><table><tr><td colspan="2">내용</td></tr></table><p style="color:#123456" onclick="bad()">서식<script>bad()</script></p>' };
const saved = await store.saveTemplates(0, [template]);
assert.equal(saved.revision, 1); assert.match(saved.value[0].html, /colspan="2"/); assert.match(saved.value[0].html, /color:#123456/);
assert.doesNotMatch(saved.value[0].html, /onclick|script|bad\(/);
assert.deepEqual(await store.templates(), saved);
await assert.rejects(() => store.saveTemplates(0, []), /REVISION/);
for (const html of ['<img src="/media/native/photo.png">', '<iframe src="https://example.test"></iframe>', '<a href="/media/photo.pdf">사진</a>', '<video poster="x"></video>']) await assert.rejects(() => store.saveTemplates(1, [{ ...template, html }]), /TEMPLATE_MEDIA/);
await assert.rejects(() => store.saveTemplates(1, [template, template]), /TEMPLATES/);
await assert.rejects(() => store.saveTemplates(1, [{ ...template, html: '<script>bad()</script>' }]), /TEMPLATES/);
assert.deepEqual((await store.saveTemplates(1, [])).value, []);
console.log(JSON.stringify({ suite: 'cms-templates-settings', status: 'PASS' }));
