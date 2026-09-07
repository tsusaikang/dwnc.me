import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';

class Statement {
  constructor(database, sql, args = []) { Object.assign(this, { database, sql, args }); }
  bind(...args) { return new Statement(this.database, this.sql, args); }
  first() { return this.database.prepare(this.sql).get(...this.args) ?? null; }
  all() { return { success: true, results: this.database.prepare(this.sql).all(...this.args), meta: {} }; }
  run() { const result = this.database.prepare(this.sql).run(...this.args); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
}

export class EditorDatabase {
  sqlite = new DatabaseSync(':memory:');
  prepare(sql) { return new Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(({ sql, args }) => ({ success: true, results: this.sqlite.prepare(sql).all(...args), meta: { changes: this.sqlite.prepare('SELECT changes() AS count').get().count } }));
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}

export async function createEditorDatabase() {
  const database = new EditorDatabase();
  const directory = new URL('../../migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => /^\d+.*\.sql$/u.test(name)).sort()) {
    database.sqlite.exec(await readFile(new URL(name, directory), 'utf8'));
  }
  return database;
}

export function seedLegacy(database) {
  const image = '/media/native/123e4567-e89b-42d3-a456-426614174000.png';
  const html = `<p>방문자에게 보이는 원래 본문입니다.</p><h2>기존 소제목</h2><p><strong>굵은 예시</strong> <i>기울임 예시</i> <u>밑줄 예시</u> <s>취소선 예시</s></p><p style="text-align:center"><span style="font-size:20px;color:#cc2244;background-color:#fff2ac">크기와 색상 예시</span></p><blockquote><p>인용문 예시</p></blockquote><ul><li>첫 번째 항목<ul><li>중첩 항목</li></ul></li></ul><ol start="3"><li>세 번째 항목</li><li value="5">다섯 번째 항목</li></ol><table><tbody><tr><th colspan="2">병합된 제목 셀</th></tr><tr><td rowspan="2">세로 병합 셀</td><td>오른쪽 셀</td></tr><tr><td>마지막 셀</td></tr></tbody></table><figure class="imageblock alignCenter"><span><img src="${image}" alt="합성 시험 이미지"></span><figcaption>이미지 설명 예시</figcaption></figure><figure data-ke-type="opengraph"><a href="https://example.test"><div class="og-text"><p class="og-title">합성 링크 카드</p><p class="og-desc">링크 카드 선택과 삭제 시험</p></div></a></figure>` + '<p>긴 본문에서 도구막대를 확인합니다.</p>'.repeat(45);
  database.sqlite.prepare(`INSERT INTO legacy_posts (id, global_sequence, source, source_id, source_url, legacy_path, title, description, body_html, body_text, category_id, category_slug, category_label, tags_json, legacy_categories_json, cover_alt, created_at, updated_at, published_at, import_complete) VALUES ('legacy-1', 1, 'tistory', '1', 'https://example.test/1', '/1', '합성 기존 공개 글', '공개 사본 설명', ?, '방문자에게 보이는 원래 본문입니다.', 'daily', '일상', '일상', '[]', '[]', '', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 1)`).run(html);
  return image;
}
