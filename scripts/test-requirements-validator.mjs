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
  'docs/GIT_DELIVERY_20260910_142007.md',
  'docs/history/PROJECT_STATE_HISTORY_20260909_234401.md',
  'docs/결함_보완_요구사항_20260909_223512.md',
  'docs/운영자_상황별_대응_점검_20260909_223042.md',
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
  const currentPosition = userSummary.match(/### 현재 위치\n([\s\S]*?)(?=\n### |$)/)?.[1];
  assert.ok(currentPosition?.trim(), 'user summary needs a current position');
  for (const requiredPhrase of [
    '완료 항목은 현재 문서에 남기지 않고',
    '승인 없이 실제 `dwnc.me`의 주소 연결 설정과 방문자 흐름을 다시 바꾸는 일',
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

const firstDoneRequirement = sourceArchive.match(
  /### `([A-Z0-9-]+)` — [^\n]+\n- \*\*Status:\*\* `done`[\s\S]*?(?=\n### |\n## |$)/,
);
assert.ok(firstDoneRequirement, 'test fixture could not find an archived done requirement');
const [firstRequirement, firstRequirementId] = firstDoneRequirement;
withFixture(
  { archive: `${sourceArchive}\n\n${firstRequirement}\n` },
  (result) => assertRejected(result, new RegExp(`duplicate requirement ID ${firstRequirementId}`)),
);

withFixture(
  { current: sourceCurrent.replace('- **Evidence:**', '- **Proof:**') },
  (result) => assertRejected(result, /must have exactly one Evidence section/),
);

withFixture(
  { current: `${sourceCurrent}\n\n${archivedRequirement({ id: 'DWNC-P2-900', updatedAt: '2026-09-09' })}\n` },
  (result) => assertRejected(result, /invalid current status done/),
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
  { current: sourceCurrent.replace('current-status=unfinished', 'recent-complete-limit=12') },
  (result) => assertRejected(result, /missing exact retention policy marker/),
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

for (const unclearWording of ['최초 Worker 생성', 'Worker가 최초 생성', 'DNS 변경']) {
  assert.throws(
    () => assertPlainLanguageSummary({
      current: sourceCurrent.replace('### 최종 결과\n', `### 최종 결과\n${unclearWording}\n`),
    }),
    /user summary contains unclear technical wording/,
  );
}

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
  { current: sourceCurrent.replace('- **Plans:** `PLAN-09`', '- **Plans:** `PLAN-99`') },
  (result) => assertRejected(result, /references unknown plan ID PLAN-99/),
);

withFixture(
  {
    current: sourceCurrent.replace(
      /^(\| `PLAN-00` \|[^\n]*\| )`계속 적용` \|$/m,
      '$1`진행 중` |',
    ),
  },
  (result) => assertRejected(result, /overall plan must have at most one in-progress PLAN; found 2/),
);

withFixture(
  { current: sourceCurrent.replace(/^(\| `PLAN-09` \|[^\n]*\| )`진행 중` \|$/m, '$1`완료` |') },
  (result) => assertRejected(result, /PLAN-09 is complete and must be archived/),
);

withFixture(
  { archive: sourceArchive.replace(/^(\| `PLAN-08` \|[^\n]*\| )`완료` \|$/m, '$1`대기` |') },
  (result) => assertRejected(result, /PLAN-08 is not complete and must remain current/),
);

withFixture(
  { archive: sourceArchive.replace(/^(\| `PLAN-08` \|[^\n]*)$/m, '$1\n$1') },
  (result) => assertRejected(result, /duplicate plan ID PLAN-08/),
);

withFixture(
  { current: sourceCurrent.replace('- **Priority:** `P0`', '- **Priority:** `urgent`') },
  (result) => assertRejected(result, /has invalid priority urgent/),
);

withFixture(
  { current: sourceCurrent.replace('(../PROJECT_STATE.md)', '(../missing-state-fixture.md)') },
  (result) => assertRejected(result, /local link target does not exist/),
);

console.log('requirements validator tests PASS: current-only policy, archive, IDs, links, metadata and dashboard');
