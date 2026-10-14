// Verifies the VCF Operations / Log Management / Real-Time Metrics sizing engine
// (src/lib/ops-logs-sizing.ts) against hand-worked cases taken from the sources it cites:
// KB 397782's own scaling example, and the 9.1 Log Management Detailed Design rules (#394).
//
// Usage: node scripts/verify-ops-logs-sizer.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'opslogs-'));
const out = join(tmp, 'engine.mjs');
await build({ entryPoints: [join(here, '../src/lib/ops-logs-sizing.ts')], bundle: true, format: 'esm', outfile: out, logLevel: 'warning' });
const eng = await import(pathToFileURL(out).href);
rmSync(tmp, { recursive: true, force: true });

const st = (o) => ({ ...eng.defaultState(), growthPct: 0, ...o });
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
// Metrics can set the node count: 20,000 objects (Medium HA = 3 nodes) but 10M metrics
// -> ceil(20M / 4M) = 5 Medium nodes.
{
  const r = eng.sizeOps(st({ objectsOverride: 20_000, metrics: 10_000_000, opsModel: 'High Availability' }));
  eq('metrics drive Medium', opt(r, 'Medium').nodes, 5);
}
// CA: even node count plus a 2 vCPU / 8 GB witness; Small CA is 1 node per fault domain.
{
  const r = eng.sizeOps(st({ objectsOverride: 20_000, opsModel: 'Continuous Availability' }));
  eq('CA 20k: Medium nodes (even)', opt(r, 'Medium').nodes, 4);
  eq('CA 20k: Medium vCPU incl witness', opt(r, 'Medium').vcpu, 4 * 8 + 2);
  eq('CA 20k: Small max 2 nodes', opt(r, 'Small').nodes, null);
}
// Objects count = VMs + hosts + datastores + vCenters + other, then growth.
{
  const r = eng.sizeOps({ ...eng.defaultState(), vms: 1_000, hosts: 50, datastores: 40, vcenters: 2, otherObjects: 8, growthPct: 10 });
  eq('object count with growth', r.objects, 1_210);
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
// Design page: EPS ~ hosts x 250. 64 hosts -> 16,000 EPS.
{
  const r = eng.sizeLogs(st({ hosts: 64, retentionDays: 1 }));
  eq('EPS estimate', r.eps, 16_000);
  eq('Small 1 active + N+1', [opt(r, 'Small').replicas, r.pick.size], [2, 'Small']);
}
// Medium and Large have a 3-replica minimum.
{
  const r = eng.sizeLogs(st({ hosts: 10, retentionDays: 1, logsSize: 'Medium' }));
  eq('Medium min 3 replicas', r.pick.replicas, 3);
}
// 400 hosts -> 100,000 EPS: Small = 5 + 1 = 6 (still Small), 500 hosts -> 125,000 EPS:
// Small 7 + 1 = 8 > 6, so Medium (4 + 1 = 5).
{
  eq('400 hosts Small x6', [eng.sizeLogs(st({ hosts: 400, retentionDays: 1 })).pick.size, eng.sizeLogs(st({ hosts: 400, retentionDays: 1 })).pick.replicas], ['Small', 6]);
  const r = eng.sizeLogs(st({ hosts: 500, retentionDays: 1 }));
  eq('500 hosts -> Medium x5', [r.pick.size, r.pick.replicas], ['Medium', 5]);
}
// Large uses 2 worker nodes of 24 vCPU / 48 GB per replica, 2 IPs per replica.
{
  const r = eng.sizeLogs(st({ hosts: 2_000, retentionDays: 1, logsSize: 'Large' }));
  const L = r.pick;
  eq('Large workers', [L.workers, L.workerVcpu, L.workerRam], [L.replicas * 2, L.replicas * 48, L.replicas * 96]);
  eq('Large IPs', L.ips, 6 + L.replicas * 2 + (L.vips - 1));
}
// Storage-driven replicas: 9 TB cap per replica. 10 hosts, override 20,000 EPS, 350 B,
// 90 days -> 604.8 GB/day x 90 = 54,432 GB -> ceil(54,432 / 9,216) = 6 active + 1.
{
  const r = eng.sizeLogs(st({ hosts: 10, epsOverride: 20_000, retentionDays: 90 }));
  eq('storage GB', r.storageGb, 54_432);
  eq('storage-driven Small replicas', opt(r, 'Small').replicas, 7);
}
// Host limit: 1,600 hosts rules out Small (max 1,500).
{
  eq('Small host limit', opt(eng.sizeLogs(st({ hosts: 1_600, retentionDays: 1 })), 'Small').fits, false);
}

// --- Real-Time Metrics -------------------------------------------------------
eq('RTM small', eng.sizeRtm(st({ hosts: 400, vcenters: 2 })).pick.name, 'Small');
eq('RTM medium by vCenters', eng.sizeRtm(st({ hosts: 400, vcenters: 3 })).pick.name, 'Medium');
eq('RTM none', eng.sizeRtm(st({ hosts: 6_000, vcenters: 2 })).pick, null);

console.log(`${n - fails}/${n} ops/logs sizer checks pass`);
process.exit(fails ? 1 : 0);
