// Verifies the sizing engine (src/lib/mgmt-sizing.ts) against the Planning and
// Preparation Workbook's own Excel-computed results.
//
// test/sizer-golden-<revision>.json holds, per scenario, the workbook input
// cells that were set and every row Excel computed on 'Management Domain
// Sizing' (rows 8-30: nodes / vCPU / RAM / disk) plus the summary (R8 host
// count, R15-R20 capacity). It is produced by scripts/sizer-golden/
// Get-SizerGolden.ps1, which drives Excel over a copy of the workbook. This script maps each scenario's
// cells onto a SizingState, runs the engine and compares row by row.
//
// Usage: node scripts/verify-sizer.mjs [path/to/golden.json]
import { build } from 'esbuild';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');

const tmp = mkdtempSync(join(tmpdir(), 'sizer-'));
const out = join(tmp, 'engine.mjs');
await build({ entryPoints: [join(web, 'src/lib/mgmt-sizing.ts')], bundle: true, format: 'esm', outfile: out, logLevel: 'warning' });
const eng = await import(pathToFileURL(out).href);

const golden = JSON.parse(readFileSync(process.argv[2] ?? join(web, `test/sizer-golden-${eng.WORKBOOK_REVISION}.json`), 'utf8').replace(/^﻿/, ''));

// Workbook input cells -> SizingState. Cells the scenario does not set keep the
// workbook baseline, which matches defaultState() except where noted.
function toState(cells) {
  const c = (k, d) => (cells[k] !== undefined ? cells[k] : d);
  const s = eng.defaultState();
  s.reservePct = Number(c('E8', 30));
  s.growthPct = Number(c('E9', 10));
  s.coresPerHost = Number(c('E13', 128));
  s.ramPerHost = Number(c('E14', 1024));
  s.cpuOver = Number(c('E15', 1));
  s.ramOver = Number(c('E16', 1));
  s.storageType = c('R13', 'vSAN-ESA');
  s.instanceModel = c('E20', 'First Instance');
  s.deploymentModel = c('E21', 'High Availability');
  s.deploymentSize = c('E22', 'Small');
  s.logsSize = c('E25', 'Exclude');
  s.logsReplicas = s.logsSize === 'Exclude' ? 3 : Number(c('E26', 3));
  s.vcfRtm = c('E27', 'Exclude') === 'Include';
  s.vcfSd = c('E28', 'Exclude') === 'Include';
  s.vcfIdb = c('E29', 'Exclude') === 'Include';
  s.vcfOps = c('E31', 'Exclude');
  s.vcfOpsCollector = c('E33', 'Exclude') === 'Include';
  s.vcfAutomation = c('E34', 'Exclude') === 'Include';
  s.vcfAutomationSize = s.deploymentSize; // the workbook sizes Automation by the profile
  const net = c('E35', 'Exclude');
  s.opsNetSize = net === 'Exclude' ? 'Excluded' : net;
  s.licenseHub = c('E36', 'Exclude') === 'Include';
  s.nsxEdgeSize = c('L40', 'Excluded');
  s.supervisorMode = c('O40', 'Excluded');
  s.supervisorSize = c('P40', 'Medium');
  s.nsxGmSize = c('Q40', 'Excluded');
  s.aviSize = c('S40', 'Excluded');
  s.ssp = c('W40', 'Excluded');
  s.spr = c('B82', 'Exclude');
  s.rwr = c('B83', 'Exclude') === 'Include';
  s.workloadDomains = [];
  for (let i = 0; i < 35; i++) {
    const r = 44 + i;
    if (c(`C${r}`, 'Excluded') !== 'Included') continue;
    s.workloadDomains.push({
      name: `w${i + 1}`,
      vcenterSize: c(`D${r}`, 'Medium'), vcenterStorage: c(`F${r}`, 'Default'),
      nsxModel: c(`H${r}`, 'Dedicated - HA Cluster'), nsxSize: c(`I${r}`, 'Large'),
      gm: c(`L${r}`, 'Excluded'), gmSize: c(`M${r}`, 'Medium'),
      spr: c(`R${r}`, 'Exclude') === 'Include', aviSize: c(`U${r}`, 'Excluded'),
      ssp: c(`X${r}`, 'Excluded') === 'Include',
      supervisorPlanned: false, nsxEdgeSize: 'Excluded',
    });
  }
  return s;
}

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;
let fails = 0;
for (const sc of golden) {
  const st = toState(sc.cells);
  const r = eng.compute(st);
  const errs = [];
  for (const g of sc.rows) {
    const mine = r.components.filter((x) => x.row === g.row)
      .reduce((a, x) => ({ nodes: a.nodes + x.nodes, cpu: a.cpu + x.cpu, ram: a.ram + x.ram, disk: a.disk + x.disk }), { nodes: 0, cpu: 0, ram: 0, disk: 0 });
    for (const k of ['nodes', 'cpu', 'ram', 'disk']) {
      if (!near(mine[k], g[k])) errs.push(`row ${g.row} ${g.label.trim()} ${k}: engine ${mine[k]} vs workbook ${g[k]}`);
    }
  }
  const S = sc.summary;
  const pairs = [['hosts', r.workbookHosts, S.hosts], ['vmCapacity', r.vsan.vmCapacity, S.vmCapacity], ['swap', r.vsan.swap, S.swap],
    ['interim', r.vsan.interim, S.interim], ['redundancy', r.vsan.redundancy, S.redundancy], ['reserve', r.vsan.reserve, S.reserve],
    ['growth', r.vsan.growth, S.growth]];
  for (const [k, a, b] of pairs) if (!near(a, b)) errs.push(`summary ${k}: engine ${a} vs workbook ${b}`);
  if (errs.length) {
    fails++;
    console.log(`FAIL ${sc.name}`);
    for (const e of errs.slice(0, 8)) console.log(`   ${e}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${golden.length - fails}/${golden.length} scenarios match workbook ${eng.WORKBOOK_REVISION}`);
process.exit(fails ? 1 : 0);
