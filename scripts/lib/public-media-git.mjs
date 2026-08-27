import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GIT_OID = /^[a-f0-9]{40}$/u;

function fail() { throw new Error('MEDIA_E_R2_GIT'); }

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

export function validatePublicMediaGitSnapshot(snapshot, expectedCommit, expectedTree) {
  if (!exactKeys(snapshot, ['commit', 'tree', 'clean'])
    || !GIT_OID.test(expectedCommit ?? '') || !GIT_OID.test(expectedTree ?? '')
    || snapshot.commit !== expectedCommit || snapshot.tree !== expectedTree
    || snapshot.clean !== true) fail();
  return snapshot;
}

export async function inspectPublicMediaGit(root = process.cwd(), {
  runGit = execFileAsync,
} = {}) {
  if (typeof root !== 'string' || root.length === 0 || typeof runGit !== 'function') fail();
  const invoke = async (args, maximumBytes) => {
    const result = await runGit('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: maximumBytes,
    });
    if (!result || typeof result.stdout !== 'string') fail();
    return result.stdout;
  };
  try {
    // The two HEAD reads surround the complete status snapshot. Tree reads are
    // paired with each HEAD so a same-ref tree drift cannot be accepted.
    const firstCommit = (await invoke(['rev-parse', 'HEAD'], 1024)).trim();
    const firstTree = (await invoke(['rev-parse', 'HEAD^{tree}'], 1024)).trim();
    const status = await invoke(
      ['status', '--porcelain=v1', '--untracked-files=all'], 1024 * 1024,
    );
    const secondCommit = (await invoke(['rev-parse', 'HEAD'], 1024)).trim();
    const secondTree = (await invoke(['rev-parse', 'HEAD^{tree}'], 1024)).trim();
    if (!GIT_OID.test(firstCommit) || !GIT_OID.test(firstTree)
      || firstCommit !== secondCommit || firstTree !== secondTree) fail();
    return { commit: firstCommit, tree: firstTree, clean: status === '' };
  } catch (error) {
    if (error?.message === 'MEDIA_E_R2_GIT') throw error;
    fail();
  }
}

export async function assertExactCleanPublicMediaGit(root, expectedCommit, expectedTree,
  options = {}) {
  return validatePublicMediaGitSnapshot(
    await inspectPublicMediaGit(root, options), expectedCommit, expectedTree,
  );
}

export function isPublicMediaGitOid(value) { return GIT_OID.test(value ?? ''); }
