import { ChildProcess, spawn } from 'node:child_process';
import cluster from 'node:cluster';
import * as dgram from 'node:dgram';
import * as dns from 'node:dns';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as dnsPromises from 'node:dns/promises';
import * as inspector from 'node:inspector';
import { Worker } from 'node:worker_threads';

const probe = process.env.R2_OFFLINE_PROBE;
const boundary = globalThis[Symbol.for('dwnc.r2-full-audit.offline-boundary.v1')];
if (typeof boundary?.probeForbiddenChild !== 'function') {
  throw new Error('R2_OFFLINE_E_PROBE_GUARD');
}
const probes = Object.freeze({
  fetch: () => fetch('data:,offline'),
  http: () => http.request({ protocol: 'file:' }),
  http2: () => http2.connect('data:,offline'),
  https: () => https.request({ protocol: 'http:' }),
  net: () => net.connect({ port: -1 }),
  tls: () => tls.connect({ port: -1 }),
  dns: () => dns.lookup({}, () => undefined),
  dnsPromises: () => dnsPromises.lookup({}),
  dgram: () => dgram.createSocket('not-a-socket-type'),
  childProcess: () => spawn('/usr/bin/false', []),
  childProcessClass: () => new ChildProcess().spawn({
    file: '/usr/bin/false', args: ['/usr/bin/false'], cwd: process.cwd(), envPairs: [],
    stdio: [{ type: 'ignore' }, { type: 'ignore' }, { type: 'ignore' }],
  }),
  security: () => boundary.probeForbiddenChild('/usr/bin/security'),
  pbpaste: () => boundary.probeForbiddenChild('/usr/bin/pbpaste'),
  pbcopy: () => boundary.probeForbiddenChild('/usr/bin/pbcopy'),
  curl: () => boundary.probeForbiddenChild('/usr/bin/curl'),
  wget: () => boundary.probeForbiddenChild('/usr/bin/wget'),
  shell: () => boundary.probeForbiddenChild('/bin/sh'),
  python: () => boundary.probeForbiddenChild('/usr/bin/python3'),
  git: () => boundary.probeForbiddenChild('/usr/bin/git'),
  worker: () => new Worker(null),
  cluster: () => cluster.fork(),
  inspectorOpen: () => inspector.open(),
  inspectorSession: () => new inspector.Session().connect(),
  websocket: () => new WebSocket('data:,offline'),
  eventsource: () => new EventSource('data:,offline'),
});

if (!Object.hasOwn(probes, probe)) throw new Error('R2_OFFLINE_E_PROBE');
let blocked = false;
try { await probes[probe](); }
catch (error) {
  if (error?.code !== 'R2_OFFLINE_E_BOUNDARY') throw error;
  blocked = true;
}
if (!blocked) throw new Error('R2_OFFLINE_E_PROBE_ESCAPED');
console.log(JSON.stringify({ probe, blocked: true }));
