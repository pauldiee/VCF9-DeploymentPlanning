// ops-logs-sizing.ts
// Sizing engine for the VCF Operations / Log Management / Real-Time Metrics sizer (#394).
//
// The Management Domain sizer (mgmt-sizing.ts) takes a size you already picked and counts its
// footprint. This answers the step before: given the environment, which size and how many
// nodes / replicas. Every figure below is transcribed from a Broadcom source, named per table;
// the few planning assumptions that no source publishes (bytes per event, storage factor) are
// inputs with their defaults labelled in the UI and in docs/30-ops-logs-sizing.md.
//
// Sources (read 2026-10-14):
//   OPS  Configuration Maximums, VCF Operations 9.1.0 (configmax.broadcom.com), identical to
//        KB 397782 "VCF Operations 9.0 Sizing Guidelines" -- which also carries the HA / CA
//        "two times less" rule, the CA per-fault-domain limits and the "fewest nodes" tip.
//   LOGS TechDocs 9.1 "Log Management Detailed Design" (Last Updated 2026-10-12): per-replica
//        EPS, per-VIP limits, replica ranges, max hosts, worker-node footprint, IP rule,
//        "ESX hosts x 250" EPS estimate, N+1 / N+2 advice, scale-up thresholds, 500 GB - 9 TB
//        disk per replica. GB/day per replica from Configuration Maximums 9.1.0.
//   RTM  Configuration Maximums, VCF Operations 9.1.0, "Real-Time Metrics" categories.

export const SOURCES_DATE = '2026-10-14';

// ---------------------------------------------------------------- VCF Operations
export interface OpsSize {
  name: string;
  vcpu: number;
  ram: number; // default GB
  ramMax: number; // GB, raising memory (not modelled, shown as a hint)
  singleObjects: number;
  singleMetrics: number;
  nodeObjects: number | null; // per node in a multi-node cluster
  nodeMetrics: number | null;
  maxNodes: number;
  caPerFaultDomain: number; // 0 = no Continuous Availability at this size
  maxVcAdapters: number; // vCenter adapter instances on the node's own collector
}

export const OPS_SIZES: OpsSize[] = [
  { name: 'Extra Small', vcpu: 2, ram: 8, ramMax: 16, singleObjects: 700, singleMetrics: 140_000, nodeObjects: null, nodeMetrics: null, maxNodes: 1, caPerFaultDomain: 0, maxVcAdapters: 5 },
  { name: 'Small', vcpu: 4, ram: 16, ramMax: 32, singleObjects: 10_000, singleMetrics: 1_600_000, nodeObjects: 6_000, nodeMetrics: 1_400_000, maxNodes: 2, caPerFaultDomain: 1, maxVcAdapters: 25 },
  { name: 'Medium', vcpu: 8, ram: 32, ramMax: 64, singleObjects: 30_000, singleMetrics: 5_000_000, nodeObjects: 17_000, nodeMetrics: 4_000_000, maxNodes: 8, caPerFaultDomain: 4, maxVcAdapters: 50 },
  { name: 'Large', vcpu: 16, ram: 48, ramMax: 96, singleObjects: 44_000, singleMetrics: 8_000_000, nodeObjects: 36_000, nodeMetrics: 6_000_000, maxNodes: 16, caPerFaultDomain: 8, maxVcAdapters: 100 },
  { name: 'Extra Large', vcpu: 24, ram: 128, ramMax: 256, singleObjects: 100_000, singleMetrics: 20_000_000, nodeObjects: 88_000, nodeMetrics: 15_000_000, maxNodes: 12, caPerFaultDomain: 6, maxVcAdapters: 120 },
];

// The CA witness node (KB 397782): 2 vCPU / 8 GB.
export const CA_WITNESS = { vcpu: 2, ram: 8 };

// Unified Cloud Proxy (the 9.1 "Add a Cloud Proxy" page sizes these by VM count).
export const PROXY_SIZES = [
  { name: 'Small', vcpu: 4, ram: 16, objects: 16_000, vcAdapters: 25 },
  { name: 'Standard', vcpu: 8, ram: 48, objects: 80_000, vcAdapters: 100 },
] as const;

export const OPS_MODELS = ['Simple', 'High Availability', 'Continuous Availability'] as const;
export type OpsModel = (typeof OPS_MODELS)[number];

// ---------------------------------------------------------------- Log Management
export interface LogSize {
  name: 'Small' | 'Medium' | 'Large';
  vcpu: number; // per replica
  ram: number;
  eps: number; // per replica, typical load profile
  epsCap: number; // per replica, hard cap with a lighter load profile
  gbPerDay: number; // per replica (Configuration Maximums)
  minReplicas: number;
  maxReplicas: number;
  maxHosts: number;
  vipEps: number; // per VIP / FQDN
  // Connections per VIP. The two sources print the same pair in opposite order: the design page
  // "Connection Limit (http / tcp [syslog])" = 20k / 50k, Configuration Maximums "Syslog ... /
  // Http" = 20k/50k (Large: 30k / 50k). Until one is corrected, the lower figure is used for
  // both connection types.
  vipTcp: number; // syslog TCP connections per VIP
  vipHttp: number; // HTTP connections per VIP
  workerVcpu: number; // VCF services runtime worker node
  workerRam: number;
  workersPerReplica: number;
  ipsPerReplica: number;
}

export const LOG_SIZES: LogSize[] = [
  { name: 'Small', vcpu: 8, ram: 16, eps: 20_000, epsCap: 40_000, gbPerDay: 600, minReplicas: 1, maxReplicas: 19, maxHosts: 1_500, vipEps: 200_000, vipTcp: 20_000, vipHttp: 20_000, workerVcpu: 12, workerRam: 24, workersPerReplica: 1, ipsPerReplica: 1 },
  { name: 'Medium', vcpu: 16, ram: 32, eps: 40_000, epsCap: 70_000, gbPerDay: 1_200, minReplicas: 3, maxReplicas: 19, maxHosts: 3_000, vipEps: 200_000, vipTcp: 20_000, vipHttp: 20_000, workerVcpu: 24, workerRam: 48, workersPerReplica: 1, ipsPerReplica: 1 },
  { name: 'Large', vcpu: 32, ram: 64, eps: 60_000, epsCap: 120_000, gbPerDay: 1_800, minReplicas: 3, maxReplicas: 19, maxHosts: 4_560, vipEps: 300_000, vipTcp: 30_000, vipHttp: 30_000, workerVcpu: 24, workerRam: 48, workersPerReplica: 2, ipsPerReplica: 2 },
];

export const LOG_DISK_MIN_GB = 500;
export const LOG_DISK_MAX_GB = 9 * 1024; // "can be scaled up to 9 TB per replica"
export const LOG_BASE_IPS = 6; // "Allow for 6 IPs for an initial log management installation"
export const EPS_PER_HOST = 250; // "ESX hosts in the fleet multiplied by 250"
// The design page's scale-up advice: medium "once you exceed 5-6 small replicas", large "once
// you get to 6-8 medium replicas". The upper end of each range is used.
export const LOG_SCALE_UP_AT = { Small: 6, Medium: 8 } as const;

// ---------------------------------------------------------------- Real-Time Metrics
export const RTM_SIZES = [
  { name: 'Small', vcpu: 18, ram: 22, diskGb: 500, maxHosts: 500, maxVcenters: 2 },
  { name: 'Medium', vcpu: 37, ram: 47.5, diskGb: 2_000, maxHosts: 1_500, maxVcenters: 10 },
  { name: 'Large', vcpu: 120, ram: 164.5, diskGb: 4_500, maxHosts: 5_000, maxVcenters: 24 },
] as const;

// ---------------------------------------------------------------- State
export interface OpsLogsState {
  // Environment (shared)
  hosts: number;
  vcenters: number;
  vms: number;
  datastores: number;
  otherObjects: number; // anything else monitored: NSX, vSAN, management packs ...
  objectsOverride: number; // 0 = use the count above
  metrics: number; // 0 = unknown, objects-only check
  growthPct: number;
  // VCF Operations
  opsModel: OpsModel;
  proxySites: number; // locations that need their own cloud proxy
  // Log Management
  logsInclude: boolean;
  logsSize: 'Auto' | 'Small' | 'Medium' | 'Large';
  epsPerHost: number;
  extraEps: number; // firewall-rule logging, other senders
  epsOverride: number; // 0 = estimate
  syslogSources: number; // 0 = one per ESX host
  httpSources: number;
  retentionDays: number;
  bytesPerEvent: number;
  storageFactor: number; // stored GB per ingested GB
  spareReplicas: number; // N+1 = 1, N+2 = 2
  // Real-Time Metrics
  rtmInclude: boolean;
}

export function defaultState(): OpsLogsState {
  return {
    hosts: 64, vcenters: 2, vms: 1_500, datastores: 20, otherObjects: 300, objectsOverride: 0, metrics: 0, growthPct: 20,
    opsModel: 'High Availability', proxySites: 1,
    logsInclude: true, logsSize: 'Auto', epsPerHost: EPS_PER_HOST, extraEps: 0, epsOverride: 0, syslogSources: 0, httpSources: 0,
    retentionDays: 30, bytesPerEvent: 350, storageFactor: 1, spareReplicas: 1,
    rtmInclude: false,
  };
}

const num = (v: unknown, d: number, min = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : d;
};

// Accept a partial / older / hand-edited state (share link, import) without throwing.
export function migrateState(raw: unknown): OpsLogsState {
  const d = defaultState();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = { ...d };
  for (const k of Object.keys(d) as (keyof OpsLogsState)[]) {
    const dv = d[k];
    if (typeof dv === 'number') (s as Record<string, unknown>)[k] = num(r[k], dv);
    else if (typeof dv === 'boolean') (s as Record<string, unknown>)[k] = typeof r[k] === 'boolean' ? r[k] : dv;
  }
  s.opsModel = (OPS_MODELS as readonly string[]).includes(r.opsModel as string) ? (r.opsModel as OpsModel) : d.opsModel;
  s.logsSize = ['Auto', 'Small', 'Medium', 'Large'].includes(r.logsSize as string) ? (r.logsSize as OpsLogsState['logsSize']) : d.logsSize;
  s.proxySites = Math.max(1, Math.round(s.proxySites));
  s.spareReplicas = Math.min(2, Math.round(s.spareReplicas));
  s.storageFactor = s.storageFactor > 0 ? s.storageFactor : d.storageFactor;
  s.bytesPerEvent = s.bytesPerEvent > 0 ? s.bytesPerEvent : d.bytesPerEvent;
  return s;
}

// ---------------------------------------------------------------- VCF Operations sizing
export interface OpsOption {
  size: string;
  nodes: number | null; // null = cannot hold the load in this model
  why: string; // why it doesn't fit, or what limits it
  vcpu: number;
  ram: number;
  objectCapacity: number;
  vcAdapterWarn: boolean;
}

export interface OpsResult {
  objects: number; // after growth
  metrics: number; // after growth, 0 = not given
  options: OpsOption[];
  pick: OpsOption | null;
  witness: boolean;
  proxy: { size: string; count: number; vcpu: number; ram: number; why: string };
}

function opsOption(z: OpsSize, model: OpsModel, objects: number, metrics: number, vcenters: number): OpsOption {
  const base = { size: z.name, vcAdapterWarn: vcenters > z.maxVcAdapters };
  if (model === 'Simple') {
    const ok = objects <= z.singleObjects && (!metrics || metrics <= z.singleMetrics);
    return { ...base, nodes: ok ? 1 : null, vcpu: ok ? z.vcpu : 0, ram: ok ? z.ram : 0, objectCapacity: z.singleObjects,
      why: ok ? '' : objects > z.singleObjects ? `more than ${z.singleObjects.toLocaleString('en-US')} objects on one node` : 'too many metrics for one node' };
  }
  if (z.nodeObjects === null || z.nodeMetrics === null) {
    return { ...base, nodes: null, vcpu: 0, ram: 0, objectCapacity: 0, why: 'single node only, no HA or CA' };
  }
  // HA and CA both replicate each object to a second node: "two times less" than non-HA.
  const ca = model === 'Continuous Availability';
  const maxNodes = ca ? z.caPerFaultDomain * 2 : z.maxNodes;
  if (ca && z.caPerFaultDomain === 0) return { ...base, nodes: null, vcpu: 0, ram: 0, objectCapacity: 0, why: 'no Continuous Availability at this size' };
  const byObj = Math.ceil((objects * 2) / z.nodeObjects);
  const byMet = metrics ? Math.ceil((metrics * 2) / z.nodeMetrics) : 0;
  let n = Math.max(2, byObj, byMet);
  if (ca && n % 2) n++; // equal nodes in both fault domains
  const cap = Math.floor((maxNodes * z.nodeObjects) / 2);
  if (n > maxNodes) {
    return { ...base, nodes: null, vcpu: 0, ram: 0, objectCapacity: cap,
      why: `needs ${n} nodes, max ${maxNodes}${ca ? ` (${z.caPerFaultDomain} per fault domain)` : ''}` };
  }
  return { ...base, nodes: n, vcpu: n * z.vcpu + (ca ? CA_WITNESS.vcpu : 0), ram: n * z.ram + (ca ? CA_WITNESS.ram : 0), objectCapacity: cap,
    why: byMet > byObj ? 'metrics set the node count' : '' };
}

export function sizeOps(s: OpsLogsState): OpsResult {
  const g = 1 + s.growthPct / 100;
  const counted = s.vms + s.hosts + s.datastores + s.vcenters + s.otherObjects;
  const objects = Math.ceil((s.objectsOverride > 0 ? s.objectsOverride : counted) * g);
  const metrics = s.metrics > 0 ? Math.ceil(s.metrics * g) : 0;
  const options = OPS_SIZES.map((z) => opsOption(z, s.opsModel, objects, metrics, s.vcenters));
  // KB 397782: "Use the configuration which has the least number of nodes, but is able to
  // accommodate the number of objects" -- then the smaller total vCPU on a tie.
  const fits = options.filter((o) => o.nodes !== null);
  const pick = fits.sort((a, b) => a.nodes! - b.nodes! || a.vcpu - b.vcpu)[0] ?? null;

  const sites = Math.max(1, s.proxySites);
  const need = (p: (typeof PROXY_SIZES)[number]) => Math.max(sites, Math.ceil(objects / p.objects), Math.ceil(s.vcenters / p.vcAdapters));
  const [ps, pt] = PROXY_SIZES;
  const nS = need(ps), nT = need(pt);
  const useSmall = nS === nT;
  const p = useSmall ? ps : pt;
  const count = useSmall ? nS : nT;
  const why = count > sites
    ? `${count} proxies: ${Math.ceil(objects / p.objects) >= Math.ceil(s.vcenters / p.vcAdapters) ? `objects exceed ${p.objects.toLocaleString('en-US')} per proxy` : `more than ${p.vcAdapters} vCenters per proxy`}`
    : `one per location (${sites})`;
  return { objects, metrics, options, pick, witness: s.opsModel === 'Continuous Availability',
    proxy: { size: p.name, count, vcpu: count * p.vcpu, ram: count * p.ram, why } };
}

// ---------------------------------------------------------------- Log Management sizing
export interface LogOption {
  size: LogSize['name'];
  fits: boolean;
  why: string;
  replicas: number;
  activeReplicas: number; // replicas minus the spare(s)
  diskPerReplicaGb: number;
  totalDiskGb: number;
  vips: number;
  ips: number;
  workers: number;
  workerVcpu: number;
  workerRam: number;
  replicaVcpu: number;
  replicaRam: number;
  gbPerDayCapacity: number;
  epsCapacity: number;
}

export interface LogsResult {
  eps: number;
  epsEstimated: boolean;
  gbPerDay: number;
  storageGb: number;
  options: LogOption[];
  pick: LogOption | null;
  pickReason: string;
}

function logOption(z: LogSize, s: OpsLogsState, eps: number, storageGb: number): LogOption {
  const spare = s.spareReplicas;
  const byEps = Math.ceil(eps / z.eps);
  const byDisk = Math.ceil(storageGb / LOG_DISK_MAX_GB);
  const active = Math.max(byEps, byDisk, 1);
  const replicas = Math.max(z.minReplicas, active + spare);
  const disk = Math.min(LOG_DISK_MAX_GB, Math.max(LOG_DISK_MIN_GB, Math.ceil(storageGb / replicas / 50) * 50));
  const syslog = s.syslogSources > 0 ? s.syslogSources : s.hosts;
  const vips = Math.max(1, Math.ceil(eps / z.vipEps), Math.ceil(syslog / z.vipTcp), Math.ceil(s.httpSources / z.vipHttp));
  const workers = replicas * z.workersPerReplica;
  let why = '';
  if (replicas > z.maxReplicas) why = `needs ${replicas} replicas, max ${z.maxReplicas}`;
  else if (s.hosts > z.maxHosts) why = `more than ${z.maxHosts.toLocaleString('en-US')} hosts`;
  return {
    size: z.name, fits: !why, why, replicas, activeReplicas: replicas - spare, diskPerReplicaGb: disk, totalDiskGb: disk * replicas, vips,
    ips: LOG_BASE_IPS + replicas * z.ipsPerReplica + (vips - 1),
    workers, workerVcpu: workers * z.workerVcpu, workerRam: workers * z.workerRam,
    replicaVcpu: replicas * z.vcpu, replicaRam: replicas * z.ram,
    gbPerDayCapacity: (replicas - spare) * z.gbPerDay, epsCapacity: (replicas - spare) * z.eps,
  };
}

export function sizeLogs(s: OpsLogsState): LogsResult {
  const g = 1 + s.growthPct / 100;
  const estimated = !(s.epsOverride > 0);
  const eps = Math.ceil((estimated ? s.hosts * s.epsPerHost + s.extraEps : s.epsOverride) * g);
  const gbPerDay = (eps * s.bytesPerEvent * 86_400) / 1e9;
  const storageGb = Math.ceil(gbPerDay * s.retentionDays * s.storageFactor);
  const options = LOG_SIZES.map((z) => logOption(z, s, eps, storageGb));
  let pick: LogOption | null = null;
  let pickReason = '';
  if (s.logsSize !== 'Auto') {
    pick = options.find((o) => o.size === s.logsSize) ?? null;
    pickReason = pick?.fits ? 'your chosen size' : `your chosen size does not fit: ${pick?.why}`;
  } else {
    const [S, M, L] = options;
    if (S.fits && S.replicas <= LOG_SCALE_UP_AT.Small) { pick = S; pickReason = `Small fits in ${S.replicas} replica(s)`; }
    else if (M.fits && M.replicas <= LOG_SCALE_UP_AT.Medium) { pick = M; pickReason = S.fits ? `Small would need ${S.replicas} replicas; Broadcom advises Medium past 5-6 Small replicas` : `Small does not fit (${S.why})`; }
    else if (L.fits) { pick = L; pickReason = M.fits ? `Medium would need ${M.replicas} replicas; Broadcom advises Large past 6-8 Medium replicas` : `Medium does not fit (${M.why})`; }
    else pickReason = `no size fits (Large: ${L.why}); split across more than one Log Management instance`;
  }
  return { eps, epsEstimated: estimated, gbPerDay, storageGb, options, pick, pickReason };
}

// ---------------------------------------------------------------- Real-Time Metrics sizing
export function sizeRtm(s: OpsLogsState) {
  const pick = RTM_SIZES.find((z) => s.hosts <= z.maxHosts && s.vcenters <= z.maxVcenters) ?? null;
  return { pick, why: pick ? '' : `more than ${RTM_SIZES[2].maxHosts.toLocaleString('en-US')} hosts or ${RTM_SIZES[2].maxVcenters} vCenters` };
}

export function compute(s: OpsLogsState) {
  return { ops: sizeOps(s), logs: s.logsInclude ? sizeLogs(s) : null, rtm: s.rtmInclude ? sizeRtm(s) : null };
}
