import assert from 'node:assert/strict';
import {
  canonicalR2ExposureEvidencePayload,
  fetchR2ExposureCapture,
  remoteReceiptBucketExposure,
  validateR2ExposureCapture,
  validateR2ExposureEvidence,
} from './lib/cloudflare-r2-exposure.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';

const accountId = 'a'.repeat(32);
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
const environment = 'staging';
const bucket = 'dwnc-me-public-media-staging';
const now = new Date('2026-08-26T00:00:00.000Z');
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const throws = (action, code) => {
  assert.throws(action, (error) => error?.message === code);
  assertions += 1;
};

const calls = [];
const capture = await fetchR2ExposureCapture({
  environment,
  bucket,
  accountId,
  apiToken: 'synthetic-control-plane-token',
  now: () => now,
  fetchImpl: async (url, init) => {
    calls.push({
      url,
      method: init.method,
      authorization: init.headers.authorization,
      jurisdiction: init.headers['cf-r2-jurisdiction'],
    });
    const result = url.endsWith(`/${bucket}`)
      ? {
        name: bucket,
        creation_date: '2026-08-27T00:00:00.000Z',
        location: 'ENAM',
        storage_class: 'Standard',
      }
      : url.endsWith('/managed')
      ? { enabled: false, domain: 'not-reported.example.invalid' }
      : { domains: [] };
    return Response.json({ success: true, errors: [], messages: [], result });
  },
});
equal(calls.length, 3);
equal(calls.every((call) => call.method === 'GET'), true);
equal(calls.every((call) => call.authorization === 'Bearer synthetic-control-plane-token'), true);
equal(calls.every((call) => call.jurisdiction === 'default'), true);
equal(calls[0].url.endsWith(`/${bucket}`), true);
validateR2ExposureCapture(capture, {
  expected: { environment, bucket, accountIdSha256 },
  now,
});
assertions += 1;
const exposure = remoteReceiptBucketExposure(capture, {
  expected: { environment, bucket, accountIdSha256 },
  now,
});
equal(exposure.verification, 'cloudflare-control-plane');
equal(exposure.jurisdiction, 'default');
equal(exposure.location, 'ENAM');
equal(exposure.storageClass, 'Standard');
equal(exposure.bucketPropertiesSha256.length, 64);
equal(exposure.r2DevEnabled, false);
equal(exposure.customDomainCount, 0);
equal(exposure.evidenceSha256.length, 64);
equal(canonicalR2ExposureEvidencePayload(capture.evidence).includes(accountId), false);

throws(() => validateR2ExposureCapture({
  ...capture,
  customRawBody: JSON.stringify({
    success: true, errors: [], messages: [], result: { domains: [{ domain: 'public.example' }] },
  }),
}, { now }), 'CLOUDFLARE_E_R2_EXPOSURE_CAPTURE');
throws(() => validateR2ExposureCapture({
  ...capture,
  evidence: { ...capture.evidence, location: 'WNAM' },
}, { now }), 'CLOUDFLARE_E_R2_EXPOSURE_CAPTURE');
throws(() => validateR2ExposureEvidence({ ...capture.evidence, r2DevEnabled: true }, { now }),
  'CLOUDFLARE_E_R2_EXPOSURE_PUBLIC');
throws(() => validateR2ExposureEvidence({ ...capture.evidence, customDomainCount: 1 }, { now }),
  'CLOUDFLARE_E_R2_EXPOSURE_PUBLIC');
throws(() => validateR2ExposureEvidence(capture.evidence, {
  expected: { bucket: 'wrong-bucket' }, now,
}), 'CLOUDFLARE_E_R2_EXPOSURE_EXPECTED');
throws(() => validateR2ExposureEvidence(capture.evidence, {
  now: new Date('2026-08-26T00:15:00.000Z'),
}), 'CLOUDFLARE_E_R2_EXPOSURE_EXPIRED');

console.log(JSON.stringify({
  suite: 'cloudflare-r2-private-exposure',
  assertions,
  liveNetworkCalls: 0,
  mutations: 0,
  status: 'PASS',
}, null, 2));
