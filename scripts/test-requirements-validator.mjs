import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCurrent = fs.readFileSync(path.join(projectRoot, 'docs', 'REQUIREMENTS.md'), 'utf8');
const sourceArchive = fs.readFileSync(
  path.join(projectRoot, 'docs', 'REQUIREMENTS_ARCHIVE.md'),
  'utf8',
);
const sourceProjectState = fs.readFileSync(path.join(projectRoot, 'PROJECT_STATE.md'), 'utf8');

const linkedFiles = [
  'docs/MEDIA_SERVING_CONTRACT.md',
  'docs/MIGRATION_PLAN.md',
  'docs/URL_CONTRACT.md',
  'src/data/public-media-r2-v1.json',
  'src/data/public-media-release-policy-v1.json',
];

function createFixture({
  current = sourceCurrent,
  archive = sourceArchive,
  projectState = sourceProjectState,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dwnc-requirements-validator-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, 'scripts', 'validate-requirements.mjs'),
    path.join(root, 'scripts', 'validate-requirements.mjs'),
  );
  fs.writeFileSync(path.join(root, 'docs', 'REQUIREMENTS.md'), current, { flag: 'wx' });
  fs.writeFileSync(path.join(root, 'docs', 'REQUIREMENTS_ARCHIVE.md'), archive, { flag: 'wx' });
  fs.writeFileSync(path.join(root, 'PROJECT_STATE.md'), projectState, { flag: 'wx' });

  for (const relativePath of linkedFiles) {
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, relativePath), destination);
  }
  return root;
}

function runFixture(fixtureRoot) {
  return spawnSync(process.execPath, [path.join(fixtureRoot, 'scripts', 'validate-requirements.mjs')], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  });
}

function withFixture(options, check) {
  const fixtureRoot = createFixture(options);
  try {
    check(runFixture(fixtureRoot));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function assertRejected(result, expectedMessage) {
  assert.notEqual(result.status, 0, `fixture unexpectedly passed:\n${result.stdout}`);
  assert.match(`${result.stdout}\n${result.stderr}`, expectedMessage);
}

function assertPlainLanguageSummary({ current = sourceCurrent } = {}) {
  const dashboardStart = current.indexOf('## 한눈에 보는 진행 상황');
  const technicalReferenceStart = current.indexOf('### 기술 참고');
  assert.notEqual(dashboardStart, -1, 'missing user dashboard');
  assert.notEqual(technicalReferenceStart, -1, 'missing technical reference boundary');
  const userSummary = current.slice(dashboardStart, technicalReferenceStart);
  const unclearTerm = userSummary.match(
    /시험용 Worker|새 Worker 버전|최초 Worker|Worker가|DNS/i,
  )?.[0];
  assert.equal(
    unclearTerm,
    undefined,
    `user summary contains unclear technical wording: ${unclearTerm}`,
  );
  for (const requiredPhrase of [
    '시험용 사이트 프로그램',
    '실제 `dwnc.me` 주소가 새 사이트를 가리키도록 연결하지 않는다',
    '실제 `dwnc.me` 주소가 가리키는 곳과 주소 연결 설정을 바꾸는 일',
  ]) {
    assert.ok(
      userSummary.includes(requiredPhrase),
      `user summary is missing current plain-language wording: ${requiredPhrase}`,
    );
  }
}

function archivedRequirement({ id, updatedAt, status = 'done' }) {
  return [
    `### \`${id}\` — archive fixture ${id}`,
    `- **Status:** \`${status}\``,
    `- **Updated-at:** \`${updatedAt}\``,
    '- **Plans:** `PLAN-09`',
    '- **Priority:** `P2`',
    '- **Acceptance:**',
    '  - fixture acceptance',
    '- **Evidence:**',
    '  - fixture evidence',
  ].join('\n');
}

assertPlainLanguageSummary();

withFixture({}, (result) => {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /requirements validation PASS/);
});

withFixture(
  { current: sourceCurrent.replace('`decision-needed`', '`invalid-status`') },
  (result) => assertRejected(result, /invalid current status invalid-status/),
);

const firstRequirement = sourceCurrent.match(
  /### `DWNC-S3-005`[\s\S]*?(?=\n### |\n## |$)/,
)?.[0];
assert.ok(firstRequirement, 'test fixture could not find DWNC-S3-005');
withFixture(
  { archive: `${sourceArchive}\n\n${firstRequirement}\n` },
  (result) => assertRejected(result, /duplicate requirement ID DWNC-S3-005/),
);

withFixture(
  { current: sourceCurrent.replace('- **Evidence:**', '- **Proof:**') },
  (result) => assertRejected(result, /must have exactly one Evidence section/),
);

const recentCompletedSource = sourceCurrent.slice(
  sourceCurrent.indexOf('## 최근 완료된 요구사항'),
);
const recentDoneMatches = [
  ...recentCompletedSource.matchAll(
    /^### `([A-Z0-9-]+)` — [^\n]+\n- \*\*Status:\*\* `done`\n- \*\*Updated-at:\*\* `(\d{4}-\d{2}-\d{2})`/gm,
  ),
];
assert.ok(recentDoneMatches.length > 0, 'test fixture could not find recent done requirements');
assert.ok(recentDoneMatches.length <= 12, 'source already exceeds recent done limit');
const overflowUpdatedAt = new Date(`${recentDoneMatches.at(-1)[2]}T00:00:00Z`);
overflowUpdatedAt.setUTCDate(overflowUpdatedAt.getUTCDate() + 1);
const overflowDate = overflowUpdatedAt.toISOString().slice(0, 10);
const overflowDone = Array.from({ length: 13 - recentDoneMatches.length }, (_, index) => {
  const id = String(900 + index);
  return [
    `### \`DWNC-P2-${id}\` — retention fixture ${id}`,
    '- **Status:** `done`',
    `- **Updated-at:** \`${overflowDate}\``,
    '- **Plans:** `PLAN-09`',
    '- **Priority:** `P2`',
    '- **Acceptance:**',
    '  - fixture acceptance',
    '- **Evidence:**',
    '  - fixture evidence',
  ].join('\n');
}).join('\n\n');
withFixture(
  { current: `${sourceCurrent}\n\n${overflowDone}\n` },
  (result) => assertRejected(result, /recent completed requirements 13 exceed limit 12/),
);

withFixture(
  { current: `${sourceCurrent}\n\nR2_SECRET_ACCESS_KEY = "fixture-not-a-secret"\n` },
  (result) => assertRejected(result, /must not contain credential or raw account ID assignments/),
);

withFixture(
  {
    current: sourceCurrent.replace(
      '## 요구사항 원장',
      '## 요구사항 원장\n\n### DWNC-S3-099 — malformed fixture',
    ),
  },
  (result) => assertRejected(result, /malformed requirement heading under ledger/),
);

withFixture(
  {
    current: sourceCurrent.replace(
      '## 요구사항 원장',
      '## 요구사항 원장\n\n### unmatched fixture heading',
    ),
  },
  (result) => assertRejected(result, /malformed requirement heading under ledger/),
);

withFixture(
  {
    current: sourceCurrent.replace(
      '### 이번 작업에서 하지 않는 것',
      '### 변경 금지선',
    ),
  },
  (result) => assertRejected(result, /missing dashboard section ### 이번 작업에서 하지 않는 것/),
);

withFixture(
  {
    archive: `${sourceArchive}\n\n${archivedRequirement({
      id: 'DWNC-P2-800',
      updatedAt: '2026-08-23',
      status: 'planned',
    })}\n`,
  },
  (result) => assertRejected(result, /invalid archive status planned/),
);

withFixture(
  {
    archive: `${sourceArchive}\n\n${archivedRequirement({
      id: 'DWNC-P2-801',
      updatedAt: '2026-02-30',
    })}\n`,
  },
  (result) => assertRejected(result, /Updated-at is not a real ISO date/),
);

withFixture(
  {
    archive: `${sourceArchive}\n\n${archivedRequirement({
      id: 'DWNC-P2-902',
      updatedAt: '2026-08-23',
    })}\n\n${archivedRequirement({ id: 'DWNC-P2-901', updatedAt: '2026-08-22' })}\n`,
  },
  (result) => assertRejected(result, /archived requirements must be ordered/),
);

withFixture(
  {
    archive: `${sourceArchive}\n\n${archivedRequirement({
      id: 'DWNC-P2-999',
      updatedAt: '2026-08-26',
    })}\n`,
  },
  (result) => assertRejected(result, /oldest-first movement violated/),
);

withFixture(
  {
    current: sourceCurrent.replace(
      /\n### `DWNC-OPS-004`[\s\S]*?(?=\n### |\n## |$)/,
      '',
    ),
  },
  (result) => assertRejected(result, /missing ongoing plain-language requirement DWNC-OPS-004/),
);

withFixture(
  { current: sourceCurrent.replace('사용자에게 이는', '이 작업은') },
  (result) => assertRejected(result, /user summary is missing a plain-language explanation/),
);

withFixture(
  {
    current: sourceCurrent.replace(
      '### 최종 결과\n',
      '### 최종 결과\n\n다음 gate를 준비한다.\n',
    ),
  },
  (result) => assertRejected(result, /user summary contains unclear technical wording: gate/),
);

assert.throws(
  () =>
    assertPlainLanguageSummary({
    current: sourceCurrent.replace(
      '시험용 사이트 프로그램 최초 생성이',
      '최초 Worker 생성이',
    ),
    }),
  /user summary contains unclear technical wording: 최초 Worker/,
);

assert.throws(
  () =>
    assertPlainLanguageSummary({
    current: sourceCurrent.replace(
      '시험용 사이트 프로그램이 없는 경우에만',
      'Worker가 없는 경우에만',
    ),
    }),
  /user summary contains unclear technical wording: Worker가/,
);

assert.throws(
  () =>
    assertPlainLanguageSummary({
    current: sourceCurrent.replace(
      '실제 `dwnc.me` 주소가 새 사이트를 가리키도록 연결하지 않는다',
      '실제 `dwnc.me` 주소와 DNS는 연결하지 않는다',
    ),
    }),
  /user summary contains unclear technical wording: DNS/,
);

assert.throws(
  () =>
    assertPlainLanguageSummary({
    current: sourceCurrent.replace(
      '실제 `dwnc.me` 주소가 가리키는 곳과 주소 연결 설정을 바꾸는 일',
      '실제 `dwnc.me` 도메인 연결과 DNS 변경',
    ),
    }),
  /user summary contains unclear technical wording: DNS/,
);

withFixture(
  {
    current: sourceCurrent.replace(
      /\n### `DWNC-OPS-005`[\s\S]*?(?=\n### |\n## |$)/,
      '',
    ),
  },
  (result) => assertRejected(result, /missing ongoing plan traceability requirement DWNC-OPS-005/),
);

withFixture(
  { current: sourceCurrent.replace('- **Plans:** `PLAN-05`', '- **Plans:** `PLAN-99`') },
  (result) => assertRejected(result, /references unknown plan ID PLAN-99/),
);

withFixture(
  {
    current: sourceCurrent.replace(
      /^(\| `PLAN-06` \|[^\n]*\| )`대기` \|$/m,
      '$1`진행 중` |',
    ),
  },
  (result) => assertRejected(result, /overall plan must have exactly one in-progress PLAN; found 2/),
);

withFixture(
  { current: sourceCurrent.replace('- **Priority:** `P0`', '- **Priority:** `urgent`') },
  (result) => assertRejected(result, /has invalid priority urgent/),
);

console.log('requirements validator tests PASS: baseline=1, negative=23');
