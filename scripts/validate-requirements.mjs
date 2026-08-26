import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const currentPath = path.join(projectRoot, 'docs', 'REQUIREMENTS.md');
const archivePath = path.join(projectRoot, 'docs', 'REQUIREMENTS_ARCHIVE.md');
const recentCompleteLimit = 12;
const allowedCurrentStatuses = new Set([
  'planned',
  'in-progress',
  'blocked',
  'decision-needed',
  'done',
]);
const allowedArchiveStatuses = new Set(['done']);
const requirementHeadingPattern = /^### `([A-Z0-9-]+)` — (.+)$/;
const archivePolicy =
  '<!-- requirements-archive-policy: status=done order=updated-at-id-asc movement=oldest-first -->';
const dashboardHeading = '## 한눈에 보는 진행 상황';
const ledgerHeading = '## 요구사항 원장';
const completedHeading = '## 최근 완료된 요구사항';
const requiredDashboardSections = [
  '### 현재 목표',
  '### 전체 상태',
  '### 미디어 정리 결과',
  '### 아직 결정할 일과 진행을 막는 조건',
  '### 바로 다음 단계',
  '### 최근 완료',
  '### 이번 작업에서 하지 않는 것',
];
const credentialAssignmentPattern =
  /\b(?:R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID|CF_API_TOKEN|CLOUDFLARE_API_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID)\s*[:=]/i;
const rawAccountIdAssignmentPattern =
  /\b(?:R2_ACCOUNT_ID|CLOUDFLARE_ACCOUNT_ID|CF_ACCOUNT_ID)\s*[:=]\s*[`"']?[a-f0-9]{32}\b/i;

const errors = [];

function addError(filePath, message) {
  errors.push(`${path.relative(projectRoot, filePath)}: ${message}`);
}

function readUtf8(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    addError(filePath, `cannot read: ${error.message}`);
    return '';
  }
}

function fieldValue(blockLines, label, filePath, id) {
  const prefix = `- **${label}:** `;
  const matches = blockLines.filter((line) => line.startsWith(prefix));
  if (matches.length !== 1) {
    addError(filePath, `${id} must have exactly one ${label} field`);
    return null;
  }
  const match = matches[0].match(/`([^`]+)`\s*$/);
  if (!match) {
    addError(filePath, `${id} ${label} must be a single backticked value`);
    return null;
  }
  return match[1];
}

function listField(blockLines, label, filePath, id) {
  const marker = `- **${label}:**`;
  const markerIndexes = blockLines
    .map((line, index) => (line === marker ? index : -1))
    .filter((index) => index !== -1);
  if (markerIndexes.length !== 1) {
    addError(filePath, `${id} must have exactly one ${label} section`);
    return [];
  }

  const items = [];
  for (let index = markerIndexes[0] + 1; index < blockLines.length; index += 1) {
    const line = blockLines[index];
    if (line.startsWith('- **') || line.startsWith('#')) break;
    if (line.startsWith('  - ')) items.push(line.slice(4).trim());
    else if (line.trim() !== '') {
      addError(filePath, `${id} ${label} contains a malformed line: ${line}`);
    }
  }

  if (items.length === 0 || items.some((item) => item.length < 3)) {
    addError(filePath, `${id} ${label} must contain at least one non-empty item`);
  }
  return items;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function parseRequirements(filePath, kind) {
  const text = readUtf8(filePath);
  const lines = text.split(/\r?\n/);
  const requirements = [];
  const completedLineIndex = lines.indexOf(completedHeading);

  if (/\/Users\/|\/home\/|[A-Za-z]:\\Users\\/i.test(text)) {
    addError(filePath, 'must not contain absolute user paths');
  }
  if (credentialAssignmentPattern.test(text) || rawAccountIdAssignmentPattern.test(text)) {
    addError(filePath, 'must not contain credential or raw account ID assignments');
  }

  if (kind === 'current') {
    const policy = `<!-- requirements-policy: recent-complete-limit=${recentCompleteLimit} -->`;
    if (!text.includes(policy)) addError(filePath, `missing exact retention policy marker ${policy}`);

    const dashboardIndex = text.indexOf(dashboardHeading);
    if (dashboardIndex === -1) addError(filePath, `missing dashboard heading ${dashboardHeading}`);
    const ledgerIndex = text.indexOf(ledgerHeading);
    if (ledgerIndex === -1) addError(filePath, `missing requirement ledger section ${ledgerHeading}`);
    if (completedLineIndex === -1) {
      addError(filePath, `missing recent completed requirements section ${completedHeading}`);
    }
    let previousIndex = -1;
    for (const section of requiredDashboardSections) {
      const index = text.indexOf(section);
      if (index === -1) addError(filePath, `missing dashboard section ${section}`);
      else if (index <= previousIndex || (ledgerIndex !== -1 && index >= ledgerIndex)) {
        addError(filePath, `dashboard section is out of order: ${section}`);
      }
      previousIndex = index;
    }

    const ledgerLineIndex = lines.indexOf(ledgerHeading);
    if (ledgerLineIndex !== -1) {
      for (let index = ledgerLineIndex + 1; index < lines.length; index += 1) {
        if (lines[index].startsWith('###') && !requirementHeadingPattern.test(lines[index])) {
          addError(filePath, `malformed requirement heading under ledger: ${lines[index]}`);
        }
      }
    }
  } else {
    if (!text.includes(archivePolicy)) {
      addError(filePath, `missing exact archive policy marker ${archivePolicy}`);
    }
    for (const line of lines) {
      if (line.startsWith('###') && !requirementHeadingPattern.test(line)) {
        addError(filePath, `malformed archived requirement heading: ${line}`);
      }
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(requirementHeadingPattern);
    if (!heading) continue;

    let end = index + 1;
    while (end < lines.length && !/^#{2,3} /.test(lines[end])) end += 1;
    const blockLines = lines.slice(index + 1, end);
    const [_, id, title] = heading;

    if (!/^DWNC-(?:CORE|S3|OPS|P2)-\d{3}$/.test(id)) {
      addError(filePath, `${id} does not match the stable requirement ID format`);
    }
    if (!title.trim()) addError(filePath, `${id} has an empty title`);

    const status = fieldValue(blockLines, 'Status', filePath, id);
    const updatedAt = fieldValue(blockLines, 'Updated-at', filePath, id);
    const acceptance = listField(blockLines, 'Acceptance', filePath, id);
    const evidence = listField(blockLines, 'Evidence', filePath, id);
    const allowedStatuses = kind === 'current' ? allowedCurrentStatuses : allowedArchiveStatuses;

    if (status && !allowedStatuses.has(status)) {
      addError(filePath, `${id} has invalid ${kind} status ${status}`);
    }
    if (updatedAt && !validIsoDate(updatedAt)) {
      addError(filePath, `${id} Updated-at is not a real ISO date: ${updatedAt}`);
    }
    if (kind === 'current' && status === 'done' && index < completedLineIndex) {
      addError(filePath, `${id} is done but is outside Recent completed requirements`);
    }
    if (kind === 'current' && status && status !== 'done' && index > completedLineIndex) {
      addError(filePath, `${id} is not done but is inside Recent completed requirements`);
    }

    requirements.push({ id, title, status, updatedAt, acceptance, evidence, filePath });
    index = end - 1;
  }

  return { text, requirements };
}

function validateLocalLinks(filePath, text) {
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const pathOnly = target.split('#', 1)[0];
    if (!pathOnly) continue;
    const resolved = path.resolve(path.dirname(filePath), decodeURIComponent(pathOnly));
    if (!fs.existsSync(resolved)) addError(filePath, `local link target does not exist: ${target}`);
  }
}

const current = parseRequirements(currentPath, 'current');
const archive = parseRequirements(archivePath, 'archive');
validateLocalLinks(currentPath, current.text);
validateLocalLinks(archivePath, archive.text);

const all = [...current.requirements, ...archive.requirements];
const seenIds = new Map();
for (const requirement of all) {
  const previous = seenIds.get(requirement.id);
  if (previous) {
    addError(
      requirement.filePath,
      `duplicate requirement ID ${requirement.id}; first seen in ${path.relative(projectRoot, previous)}`,
    );
  } else {
    seenIds.set(requirement.id, requirement.filePath);
  }
}

const currentDone = current.requirements.filter(({ status }) => status === 'done');
if (currentDone.length > recentCompleteLimit) {
  addError(
    currentPath,
    `recent completed requirements ${currentDone.length} exceed limit ${recentCompleteLimit}; archive the oldest`,
  );
}

function compareRequirementOrder(left, right) {
  const dateOrder = left.updatedAt.localeCompare(right.updatedAt);
  return dateOrder !== 0 ? dateOrder : left.id.localeCompare(right.id);
}

function validateAscendingOrder(requirements, filePath, label) {
  for (let index = 1; index < requirements.length; index += 1) {
    const previous = requirements[index - 1];
    const currentRequirement = requirements[index];
    if (
      validIsoDate(previous.updatedAt) &&
      validIsoDate(currentRequirement.updatedAt) &&
      compareRequirementOrder(previous, currentRequirement) > 0
    ) {
      addError(
        filePath,
        `${label} must be ordered by Updated-at then ID ascending; ${previous.id} precedes ${currentRequirement.id}`,
      );
    }
  }
}

validateAscendingOrder(currentDone, currentPath, 'recent completed requirements');
validateAscendingOrder(archive.requirements, archivePath, 'archived requirements');

if (archive.requirements.length > 0 && currentDone.length > 0) {
  const newestArchived = archive.requirements.at(-1);
  const oldestCurrent = currentDone[0];
  if (
    validIsoDate(newestArchived.updatedAt) &&
    validIsoDate(oldestCurrent.updatedAt) &&
    compareRequirementOrder(newestArchived, oldestCurrent) > 0
  ) {
    addError(
      archivePath,
      `oldest-first movement violated: archived ${newestArchived.id} is newer than current ${oldestCurrent.id}`,
    );
  }
}

if (current.requirements.length === 0) addError(currentPath, 'must contain at least one requirement');

if (errors.length > 0) {
  for (const error of errors) console.error(`requirements validation ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `requirements validation PASS: current=${current.requirements.length}, ` +
      `recent-done=${currentDone.length}/${recentCompleteLimit}, archived=${archive.requirements.length}, ` +
      `unique-ids=${all.length}`,
  );
}
