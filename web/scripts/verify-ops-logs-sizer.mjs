// Verifies the VCF Operations / Log Management / Real-Time Metrics sizing engine
// (src/lib/ops-logs-sizing.ts) against hand-worked cases taken from the sources it cites:
// KB 397782's own scaling example, and the 9.1 Log Management Detailed Design rules (#394);
// and against reference results captured from Broadcom's official VCF Operations Sizing
// Estimator (scripts/ops-logs-estimator-fixtures.json, #400), so drift from it fails the build.
//
// Usage: node scripts/verify-ops-logs-sizer.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'opslogs-'));
const out = join(tmp, 'engine.mjs');
await build({ entryPoints: [join(here, '../src/lib/ops-logs-sizing.ts')], bundle: true, format: 'esm', outfile: out, logLevel: 'warning' });
const eng = await import(pathToFileURL(out).href);
rmSync(tmp, { recursive: true, force: true });

// Hand-worked ops cases size on objects alone, as KB 397782 does: no estimator buffer, and a
// token known metric count so metrics never set the node count.
const st = (o) => ({ ...eng.defaultState(), growthPct: 0, bufferPct: 0, metrics: 1, ...o });
let fails = 0, n = 0;
const eq = (name, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const opt = (r, size) => r.options.find((o) => o.size === size);

// --- VCF Operations ----------------------------------------------------------
// KB 397782: "to monitor 352,000 objects deploy 4 nodes of size Extra Large instead of
// deploying 10 nodes of size Large". That example is non-HA; HA halves capacity, so the same
// node counts hold for 176,000 objects under HA.
{
  const r = eng.sizeOps(st({ objectsOverride: 176_000, opsModel: 'High Availability' }));
  eq('KB example: XL nodes', opt(r, 'Extra Large').nodes, 4);
  eq('KB example: Large nodes', opt(r, 'Large').nodes, 10);
  eq('KB example: pick', [r.pick.size, r.pick.nodes], ['Extra Large', 4]);
}
// Simple: single-node limits. 9,000 objects -> Small (10,000), not Extra Small (700).
{
  const r = eng.sizeOps(st({ objectsOverride: 9_000, opsModel: 'Simple' }));
  eq('Simple 9k: pick', [r.pick.size, r.pick.nodes], ['Small', 1]);
  eq('Simple 9k: XS refused', opt(r, 'Extra Small').nodes, null);
}
// HA minimum is 2 nodes; Small HA holds 2 x 6,000 / 2 = 6,000 objects.
{
  const r = eng.sizeOps(st({ objectsOverride: 5_000, opsModel: 'High Availability' }));
  eq('HA 5k: Small 2 nodes', opt(r, 'Small').nodes, 2);
  eq('HA 5k: XS has no HA', opt(r, 'Extra Small').nodes, null);
  const r2 = eng.sizeOps(st({ objectsOverride: 7_000, opsModel: 'High Availability' }));
  eq('HA 7k: Small over its 2-node max', opt(r2, 'Small').nodes, null);
  eq('HA 7k: Medium 2 nodes', opt(r2, 'Medium').nodes, 2);
}
// Metrics can set the node count: 20,000 objects (Medium HA = 3 nodes) but 18M metrics
// -> ceil(18M / 4M) = 5 Medium nodes. Metrics are not doubled for HA (the estimator doesn't).
{
  const r = eng.sizeOps(st({ objectsOverride: 20_000, metrics: 18_000_000, opsModel: 'High Availability' }));
  eq('metrics drive Medium', opt(r, 'Medium').nodes, 5);
}
// Simple past one node becomes a multi-node cluster without HA: 38,000 objects -> Medium
// ceil(38,000 / 17,000) = 3; the pick is Extra Large x 1 (its single node holds it).
{
  const r = eng.sizeOps(st({ objectsOverride: 38_000, opsModel: 'Simple' }));
  eq('Simple multi-node Medium', opt(r, 'Medium').nodes, 3);
  eq('Simple 38k pick', [r.pick.size, r.pick.nodes], ['Large', 1]);
}
// CA: even node count plus a 2 vCPU / 8 GB witness; Small CA is 1 node per fault domain.
{
  const r = eng.sizeOps(st({ objectsOverride: 20_000, opsModel: 'Continuous Availability' }));
  eq('CA 20k: Medium nodes (even)', opt(r, 'Medium').nodes, 4);
  eq('CA 20k: Medium vCPU incl witness', opt(r, 'Medium').vcpu, 4 * 8 + 2);
  eq('CA 20k: Small max 2 nodes', opt(r, 'Small').nodes, null);
}
// Objects count = VMs + hosts + datastores + vCenters + other, then the estimator's 20% buffer,
// then growth. Metrics: 1,000 x 262 + 50 x 292 + 40 x 93 + 2 x 230 + 8 x 262 = 282,876.
{
  const base = { ...eng.defaultState(), vms: 1_000, hosts: 50, datastores: 40, vcenters: 2, otherObjects: 8, growthPct: 10 };
  eq('object count, growth only', eng.sizeOps({ ...base, bufferPct: 0 }).objects, 1_210);
  eq('object count, buffer + growth', eng.sizeOps(base).objects, 1_452);
  eq('metric estimate', eng.estimateMetrics(base), 282_876);
}
// Cloud proxies: Small while one per location is enough, else Standard.
{
  eq('proxy small', eng.sizeOps(st({ objectsOverride: 10_000, vcenters: 3, proxySites: 1 })).proxy.size, 'Small');
  const p = eng.sizeOps(st({ objectsOverride: 100_000, vcenters: 3, proxySites: 1 })).proxy;
  eq('proxy standard x2', [p.size, p.count], ['Standard', 2]);
  const q = eng.sizeOps(st({ objectsOverride: 5_000, vcenters: 30, proxySites: 1 })).proxy;
  eq('proxy by vCenter count', [q.size, q.count], ['Standard', 1]);
}

// --- Log Management ----------------------------------------------------------
// Estimator defaults: 200 EPS per host, 400 bytes per event, GiB, x1.25, no spare.
// 64 hosts -> 12,800 EPS -> one Small replica.
{
  const r = eng.sizeLogs(st({ hosts: 64, retentionDays: 1 }));
  eq('EPS estimate', r.eps, 12_800);
  eq('Small x1, no spare', [opt(r, 'Small').replicas, r.pick.size], [1, 'Small']);
  eq('spare is opt-in', eng.sizeLogs(st({ hosts: 64, retentionDays: 1, spareReplicas: 1 })).pick.replicas, 2);
}
// Medium and Large have a 3-replica minimum.
{
  const r = eng.sizeLogs(st({ hosts: 10, retentionDays: 1, logsSize: 'Medium' }));
  eq('Medium min 3 replicas', r.pick.replicas, 3);
}
// GB/day per replica is a limit: 200 hosts -> 40,000 EPS = 2 Small by EPS, but
// 1,287 GiB/day / 600 = 3 Small.
{
  eq('GB/day sets replicas', opt(eng.sizeLogs(st({ hosts: 200, retentionDays: 1 })), 'Small').replicas, 3);
}
// Switch points: Small up to 5 replicas. 400 hosts -> Small 5 (by GB/day); 500 hosts ->
// Small 6, so Medium (3).
{
  const a = eng.sizeLogs(st({ hosts: 400, retentionDays: 1 }));
  eq('400 hosts Small x5', [a.pick.size, a.pick.replicas], ['Small', 5]);
  const b = eng.sizeLogs(st({ hosts: 500, retentionDays: 1 }));
  eq('500 hosts -> Medium x3', [b.pick.size, b.pick.replicas], ['Medium', 3]);
}
// Large uses 2 worker nodes of 24 vCPU / 48 GB per replica, 2 IPs per replica.
{
  const r = eng.sizeLogs(st({ hosts: 2_000, retentionDays: 1, logsSize: 'Large' }));
  const L = r.pick;
  eq('Large workers', [L.workers, L.workerVcpu, L.workerRam], [L.replicas * 2, L.replicas * 48, L.replicas * 96]);
  eq('Large IPs', L.ips, 6 + L.replicas * 2 + (L.vips - 1));
}
// Storage-driven replicas: 9,000 GB cap per replica. 10 hosts, override 20,000 EPS, 400 B,
// 90 days -> 643.7 GiB/day x 90 x 1.25 = 72,420 GB -> ceil(72,420 / 9,000) = 9.
{
  const r = eng.sizeLogs(st({ hosts: 10, epsOverride: 20_000, retentionDays: 90 }));
  eq('storage GB', r.storageGb, 72_420);
  eq('storage-driven Small replicas', opt(r, 'Small').replicas, 9);
}
// Host limit: 1,600 hosts rules out Small (max 1,500).
{
  eq('Small host limit', opt(eng.sizeLogs(st({ hosts: 1_600, retentionDays: 1 })), 'Small').fits, false);
}

// --- Real-Time Metrics -------------------------------------------------------
eq('RTM small', eng.sizeRtm(st({ hosts: 400, vcenters: 2 })).pick.name, 'Small');
eq('RTM medium by vCenters', eng.sizeRtm(st({ hosts: 400, vcenters: 3 })).pick.name, 'Medium');
eq('RTM none', eng.sizeRtm(st({ hosts: 6_000, vcenters: 2 })).pick, null);

// --- Official estimator reference results (#400) ---------------------------------
{
  const fx = JSON.parse(readFileSync(join(here, 'ops-logs-estimator-fixtures.json'), 'utf8'));
  for (const c of fx.ops) {
    const r = eng.sizeOps({ ...eng.defaultState(), hosts: c.hosts, vms: c.vms, datastores: c.datastores, vcenters: c.vcenters, otherObjects: 0, growthPct: 0, opsModel: c.model });
    const tag = `estimator ops ${c.hosts}h/${c.vms}vm/${c.datastores}ds ${c.model}`;
    eq(`${tag} objects+metrics`, [r.objects, r.metrics], [c.objects, c.metrics]);
    eq(`${tag} pick`, r.pick ? [r.pick.size, r.pick.nodes] : null, c.pick);
    for (const o of r.options) if (o.size !== 'Extra Small') eq(`${tag} ${o.size}`, o.nodes, c.nodes[o.size]);
  }
  for (const c of fx.logs) {
    const r = eng.sizeLogs({ ...eng.defaultState(), hosts: c.hosts, retentionDays: c.retentionDays, growthPct: 0 });
    const tag = `estimator logs ${c.hosts}h ${c.retentionDays}d`;
    eq(`${tag} eps`, r.eps, c.eps);
    eq(`${tag} pick`, r.pick && r.pick.fits ? [r.pick.size, r.pick.replicas, r.pick.diskPerReplicaGb] : null, c.pick);
  }
}

console.log(`${n - fails}/${n} ops/logs sizer checks pass`);
process.exit(fails ? 1 : 0);
