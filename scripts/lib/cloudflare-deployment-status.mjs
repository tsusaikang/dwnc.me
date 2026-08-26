import {
  canonicalDeploymentStatusCapturePayload,
  canonicalDeploymentStatusEvidencePayload,
  createDeploymentStatusCapture,
  validateDeploymentStatusCapture,
} from './cloudflare-release.mjs';
import {
  assertSecureCreateOnlyDestination,
  writeCanonicalEvidenceCreateOnly,
} from './cloudflare-signing-key.mjs';

export async function persistDeploymentStatusCaptureAndEvidence({
  capturePath,
  evidencePath,
  capture,
}) {
  if (typeof capturePath !== 'string' || typeof evidencePath !== 'string'
    || capturePath === evidencePath) throw new Error('CLOUDFLARE_E_STATUS_PATH');
  validateDeploymentStatusCapture(capture);
  await Promise.all([
    assertSecureCreateOnlyDestination(capturePath),
    assertSecureCreateOnlyDestination(evidencePath),
  ]);
  await writeCanonicalEvidenceCreateOnly(
    capturePath, capture, canonicalDeploymentStatusCapturePayload,
  );
  await writeCanonicalEvidenceCreateOnly(
    evidencePath, capture.evidence, canonicalDeploymentStatusEvidencePayload,
  );
  return capture;
}

export async function produceDeploymentStatusCaptureAndEvidence({
  capturePath,
  evidencePath,
  args,
  stdout,
  startedAt,
  completedAt,
  evidence,
  rawStatus,
}) {
  return persistDeploymentStatusCaptureAndEvidence({
    capturePath,
    evidencePath,
    capture: createDeploymentStatusCapture({
      args, stdout, startedAt, completedAt, evidence, rawStatus,
    }),
  });
}
