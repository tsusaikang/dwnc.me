import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { standaloneCardCandidates, prepareUrlLinkCards } from '../src/lib/url-link-cards.ts';

// Read-only audit. Feed a fresh D1 export, never migration snapshots.
// Input: {source:'live-d1',fetchedAt:ISO,rows:[...the current D1 join...]}
export function auditStandaloneUrlCards(snapshot) {
  assert.equal(snapshot.source, 'live-d1', 'A fresh operating D1 export is required');
  assert.ok(Number.isFinite(Date.parse(snapshot.fetchedAt)), 'fetchedAt is required');
  assert.ok(Array.isArray(snapshot.rows));
  const ids = new Set();
  const records = [];
  let workingCopies = 0;
  for (const row of snapshot.rows) {
    assert.ok(row.id && !ids.has(row.id), 'Missing/duplicate post id'); ids.add(row.id);
    assert.ok(['native','legacy'].includes(row.source_kind));
    assert.ok(Number.isSafeInteger(row.revision));
    const variants = [{variant:'reflected', html:row.body_html, revision:row.revision, format:row.body_format}];
    if (row.working_post_id != null) {
      workingCopies++;
      assert.equal(row.working_post_id,row.id);
      assert.ok(Number.isSafeInteger(row.working_revision));
      variants.push({variant:'working',html:row.working_body_html,revision:row.working_revision,format:row.working_body_format ?? row.body_format});
    }
    for (const variant of variants) {
      assert.equal(typeof variant.html,'string', 'Missing body must not be silently skipped');
      const {$,candidates}=standaloneCardCandidates(variant.html);
      records.push({id:row.id,globalSequence:row.global_sequence,sourceKind:row.source_kind,status:row.status,visibility:row.visibility,kind:row.kind,
        variant:variant.variant,revision:variant.revision,format:variant.format,
        hasUnpublishedChanges:row.working_post_id != null ? row.published_revision == null || row.working_revision !== row.published_revision : row.status !== 'published',
        existingCards:$('figure[data-ke-type="opengraph"],.se_component.se_oglink,.se-component.se-oglink').length,
        candidates:candidates.map(({element,url})=>({url,tag:element.tagName,text:$(element).text()}))});
    }
  }
  const affected=records.filter(r=>r.candidates.length);
  return {source:snapshot.source,fetchedAt:snapshot.fetchedAt,auditedAt:new Date().toISOString(),
    summary:{posts:ids.size,workingCopies,bodies:records.length,affectedPosts:new Set(affected.map(r=>r.id)).size,
      reflectedBodies:affected.filter(r=>r.variant==='reflected').length,workingBodies:affected.filter(r=>r.variant==='working').length,
      reflectedUrls:affected.filter(r=>r.variant==='reflected').reduce((n,r)=>n+r.candidates.length,0),
      workingUrls:affected.filter(r=>r.variant==='working').reduce((n,r)=>n+r.candidates.length,0),
      uniqueUrls:new Set(affected.flatMap(r=>r.candidates.map(c=>c.url))).size},records};
}
if (process.argv[2]==='--self-test') {
  const row={id:'synthetic',source_kind:'native',global_sequence:1,status:'published',revision:1,visibility:'public',kind:'post',body_format:'html',
    body_html:'<p>https://example.test/a</p><p>See https://example.test/a</p><pre>https://example.test/a</pre><figure data-ke-type="opengraph"><a href="https://example.test/b">https://example.test/b</a></figure>',
    working_post_id:'synthetic',working_revision:2,published_revision:1,working_body_format:'html',working_body_html:'<p><a href="https://example.test/c">https://example.test/c</a></p><p><a href="https://example.test/d">https://example.test/c</a></p>'};
  const report=auditStandaloneUrlCards({source:'live-d1',fetchedAt:new Date().toISOString(),rows:[row]});
  assert.equal(report.summary.posts,1);assert.equal(report.summary.bodies,2);assert.equal(report.summary.reflectedUrls,1);assert.equal(report.summary.workingUrls,1);
  assert.ok(report.records.every(r=>r.hasUnpublishedChanges));assert.equal(report.records[0].existingCards,1);
  assert.throws(()=>auditStandaloneUrlCards({source:'migration',fetchedAt:new Date().toISOString(),rows:[]}));
  assert.throws(()=>auditStandaloneUrlCards({source:'live-d1',fetchedAt:new Date().toISOString(),rows:[row,row]}));
  for (const html of ['https://example.test/a','<a href="https://example.test/a">https://example.test/a</a><br><p>본문</p>','<p>https://example.test/a<br></p>']) assert.equal(standaloneCardCandidates(html).candidates.length,1);
  for (const html of ['<p>https://example.test/a<br>본문</p>','<p>https://example.test/a https://example.test/b</p>','<div class="se_component se_oglink"><div><a href="https://example.test/">https://example.test/</a></div></div>']) assert.equal(standaloneCardCandidates(html).candidates.length,0);
  const converted=await prepareUrlLinkCards('<p id="section" style="text-align:center" dir="ltr" lang="ko">https://example.test/a</p>',[],fetch,false);
  assert.match(converted,/id="section"/u);assert.match(converted,/style="text-align:center"/u);assert.match(converted,/dir="ltr"/u);assert.match(converted,/lang="ko"/u);
  assert.equal(standaloneCardCandidates(converted).candidates.length,0,'Converted cards must be idempotent');
  console.log(JSON.stringify({suite:'standalone-url-audit',status:'PASS',syntheticOnly:true}));
} else if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1])).href) {
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw new Error('Usage: node scripts/audit-standalone-url-cards.mjs LIVE_D1.json migration/private/core033.../audit.json');
  const destination=path.resolve(output),root=path.resolve('migration/private');
  assert.ok(destination.startsWith(root+path.sep+'core033'), 'Reports containing URLs must stay in the private core033 directory');
  const report=auditStandaloneUrlCards(JSON.parse(await readFile(input,'utf8')));
  await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({fetchedAt:report.fetchedAt,...report.summary}));
}
