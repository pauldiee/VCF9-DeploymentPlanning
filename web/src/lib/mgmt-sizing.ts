// VCF 9.1 Management Domain sizing engine.
//
// Reproduces the calculation in the Broadcom "Planning and Preparation
// Workbook" (rev v1.9.1.001), sheet *Management Domain Sizing*, and adds a
// fit-check the spreadsheet does not have: given a proposed cluster (host
// count + per-host spec), does the fleet fit at N-1, and where's the headroom.
//
// Appliance footprints below are lifted verbatim from the workbook's
// `table_*` named ranges on the *Static Reference Tables* sheet. The output
// formulas (host count, per-host N-1, vSAN raw capacity) are transcribed from
// the *Management Domain Sizing* summary cells and verified against the
// sheet's own computed values at defaults (4 hosts / 41 CPUs / 106 GB RAM /
// 7872 GB VM capacity / 17564 GB vSAN raw).
//
// Source of truth: reference/vcf-9.1-planning-and-preparation-workbook.xlsx.

export const WORKBOOK_REVISION = 'v1.9.1.001';

// ---------------------------------------------------------------------------
// Appliance footprint tables (size -> vCPU / RAM GB / disk GB)
// ---------------------------------------------------------------------------

type SizeMap = Record<string, number>;

const vcenterCpu: SizeMap = { Tiny: 2, Small: 4, Medium: 8, Large: 16, XLarge: 24 };
const vcenterRam: SizeMap = { Tiny: 14, Small: 21, Medium: 30, Large: 39, XLarge: 58 };
// keyed by "<size><storage>", storage one of Default / Large / XLarge
const vcenterDisk: SizeMap = {
  TinyDefault: 604, TinyLarge: 1494, TinyXLarge: 2874,
  SmallDefault: 694, SmallLarge: 1519, SmallXLarge: 2899,
  MediumDefault: 858, MediumLarge: 1658, MediumXLarge: 3038,
  LargeDefault: 1158, LargeLarge: 1708, LargeXLarge: 3088,
  XLargeDefault: 1783, XLargeLarge: 1833, XLargeXLarge: 3213,
};

const nsxtManagerCpu: SizeMap = { Extra_Small: 2, Small: 4, Medium: 6, Large: 12, XLarge: 24 };
const nsxtManagerRam: SizeMap = { Extra_Small: 8, Small: 16, Medium: 24, Large: 48, XLarge: 96 };
const nsxtManagerDisk: SizeMap = { Extra_Small: 300, Small: 300, Medium: 300, Large: 300, XLarge: 400 };

const nsxtEdgeCpu: SizeMap = { 'NSX Edge Small': 2, 'NSX Edge Medium': 4, 'NSX Edge Large': 8, 'NSX Edge XLarge': 16 };
const nsxtEdgeRam: SizeMap = { 'NSX Edge Small': 4, 'NSX Edge Medium': 8, 'NSX Edge Large': 32, 'NSX Edge XLarge': 64 };
const nsxtEdgeDisk: SizeMap = { 'NSX Edge Small': 200, 'NSX Edge Medium': 200, 'NSX Edge Large': 200, 'NSX Edge XLarge': 200 };

const aviCpu: SizeMap = { Small: 6, Large: 16, 'X-Large': 16 };
const aviRam: SizeMap = { Small: 32, Large: 48, 'X-Large': 64 };
const aviDisk: SizeMap = { Small: 512, Large: 1400, 'X-Large': 1750 };

const sspCpu: SizeMap = { Medium: 112, Large: 160, 'X-Large': 192 };
const sspRam: SizeMap = { Medium: 414, Large: 606, 'X-Large': 734 };
const sspDisk: SizeMap = { Medium: 4096, Large: 5120, 'X-Large': 6656 };
const SSP_LIC = { cpu: 10, ram: 30, disk: 710 }; // vDefend + AVI licensing hub, added once

const vcfaCpu: SizeMap = { Small: 24, Medium: 24, Large: 32 };
const vcfaRam: SizeMap = { Small: 96, Medium: 96, Large: 128 };
const vcfaDisk: SizeMap = { Small: 717, Medium: 334, Large: 430 };

const vcfopsCpu: SizeMap = { 'Extra Small': 2, Small: 4, Medium: 8, Large: 16, 'Extra Large': 24 };
const vcfopsRam: SizeMap = { 'Extra Small': 8, Small: 16, Medium: 32, Large: 48, 'Extra Large': 128 };
const vcfopsDisk: SizeMap = { 'Extra Small': 274, Small: 274, Medium: 274, Large: 274, 'Extra Large': 274 };

const cloudProxyCpu: SizeMap = { Small: 4, Medium: 8, Large: 8 };
const cloudProxyRam: SizeMap = { Small: 16, Medium: 48, Large: 48 };
const cloudProxyDisk: SizeMap = { Small: 264, Medium: 264, Large: 264 };

const vcfmsControlCpu: SizeMap = { Small: 4, Medium: 4, Large: 8 };
const vcfmsControlRam: SizeMap = { Small: 10, Medium: 10, Large: 14 };
const vcfmsControlDisk: SizeMap = { Small: 100, Medium: 100, Large: 100 };
const vcfmsWorkerNodes: SizeMap = { Small: 3, Medium: 3, Large: 4 };
const vcfmsWorkerCpu: SizeMap = { Small: 12, Medium: 24, Large: 24 };
const vcfmsWorkerRam: SizeMap = { Small: 24, Medium: 48, Large: 48 };
const vcfmsWorkerDisk: SizeMap = { Small: 100, Medium: 100, Large: 100 };
// First-instance VCFMS worker data-disk uplift, per deployment size
const vcfmsWorkerDataDiskFirst: SizeMap = { Small: 2600, Medium: 3000, Large: 3702 };

const opsNetCpu: SizeMap = { Small: 4, Medium: 8, Large: 12 };
const opsNetRam: SizeMap = { Small: 16, Medium: 32, Large: 48 };
const opsNetDisk: SizeMap = { Small: 1024, Medium: 1024, Large: 1024 };
const opsNetCollectorCpu: SizeMap = { Small: 2, Medium: 4, Large: 8 };
const opsNetCollectorRam: SizeMap = { Small: 4, Medium: 12, Large: 16 };
const opsNetCollectorDisk: SizeMap = { Small: 250, Medium: 250, Large: 250 };

// Fixed footprints
const SDDC_MANAGER = { nodes: 1, cpu: 4, ram: 16, disk: 914 };
const PROTECTION_BLUEPRINT = { nodes: 1, cpu: 8, ram: 24, disk: 800 };

// ---------------------------------------------------------------------------
// Option lists (for dropdowns) and defaults
// ---------------------------------------------------------------------------

export const OPTIONS = {
  deploymentModel: ['Simple', 'High Availability'] as const,
  deploymentSize: ['Small', 'Medium', 'Large'] as const,
  instanceModel: ['First Instance', 'Additional Instance'] as const,
  storageType: ['vSAN-ESA', 'vSAN-OSA', 'NFS', 'FC'] as const,
  vcenterSize: ['Tiny', 'Small', 'Medium', 'Large', 'XLarge'] as const,
  vcenterStorage: ['Default', 'Large', 'XLarge'] as const,
  nsxManagerSize: ['Extra_Small', 'Small', 'Medium', 'Large', 'XLarge'] as const,
  nsxEdgeSize: ['Excluded', 'NSX Edge Small', 'NSX Edge Medium', 'NSX Edge Large', 'NSX Edge XLarge'] as const,
  aviSize: ['Excluded', 'Small', 'Large', 'X-Large'] as const,
  sspSize: ['Excluded', 'Medium', 'Large', 'X-Large'] as const,
  opsNetSize: ['Excluded', 'Small', 'Medium', 'Large'] as const,
  nsxModel: ['Shared', 'Dedicated - Single Node', 'Dedicated - HA Cluster'] as const,
  gm: ['None', 'Active GM', 'Standby GM'] as const,
  clusterType: ['Standard', 'Stretched (multi-AZ)'] as const,
};

export interface WorkloadDomain {
  name: string;
  vcenterSize: string;
  vcenterStorage: string;
  nsxModel: string;
  nsxSize: string;
  gm: string;
}

export interface SizingState {
  // deployment profile
  deploymentModel: string;
  deploymentSize: string;
  instanceModel: string;
  storageType: string;
  // proposed host spec (doubles as the sheet's "host parameters")
  coresPerHost: number;
  ramPerHost: number;
  // vSAN capacity is derived from the physical drives per host: for ESA every
  // device counts; for OSA only the capacity-tier disks (cache is excluded).
  capacityDisksPerHost: number;
  capacityDiskSizeGb: number; // raw GB per capacity device
  externalStorageGb: number; // total datastore capacity for NFS / FC
  cpuOver: number;
  ramOver: number;
  reservePct: number;
  growthPct: number;
  // proposed cluster
  clusterType: string;
  proposedHosts: number;
  // management components (vCenter + NSX Local Manager sizes are derived from
  // the deployment profile — see deriveMgmtSizes — not chosen here)
  nsxGmSize: string; // 'Excluded' or a manager size
  nsxEdgeSize: string;
  aviSize: string;
  sspSize: string;
  vcfOps: boolean;
  vcfOpsCollector: boolean;
  vcfAutomation: boolean;
  opsNetSize: string;
  // workload domains
  workloadDomains: WorkloadDomain[];
}

export function defaultState(): SizingState {
  return {
    deploymentModel: 'High Availability',
    deploymentSize: 'Medium',
    instanceModel: 'First Instance',
    storageType: 'vSAN-ESA',
    coresPerHost: 128,
    ramPerHost: 1024,
    capacityDisksPerHost: 8,
    capacityDiskSizeGb: 1920,
    externalStorageGb: 40000,
    cpuOver: 1,
    ramOver: 1,
    reservePct: 30,
    growthPct: 10,
    clusterType: 'Standard',
    proposedHosts: 4,
    nsxGmSize: 'Excluded',
    nsxEdgeSize: 'Excluded',
    aviSize: 'Excluded',
    sspSize: 'Excluded',
    vcfOps: false,
    vcfOpsCollector: false,
    vcfAutomation: false,
    opsNetSize: 'Excluded',
    workloadDomains: [],
  };
}

// ---------------------------------------------------------------------------
// Component derivation
// ---------------------------------------------------------------------------

export interface Component {
  name: string;
  nodes: number;
  cpu: number; // total across nodes
  ram: number; // total GB
  disk: number; // total GB
}

const isVsan = (t: string) => t === 'vSAN-ESA' || t === 'vSAN-OSA';

// Management vCenter and NSX Local Manager sizes are fixed by the deployment
// profile in the workbook (cells D39 / F39 / I39), not chosen by the user.
export interface DerivedSizes {
  vcenterSize: string;
  vcenterStorage: string;
  nsxManagerSize: string;
}
export function deriveMgmtSizes(model: string, size: string): DerivedSizes {
  // vCenter appliance (D39): Simple -> Small; HA -> matches deployment size
  const vcenterSize = model === 'Simple' ? 'Small' : size;
  // vCenter storage (F39): Large, except HA + Large -> XLarge
  const vcenterStorage = model === 'High Availability' && size === 'Large' ? 'XLarge' : 'Large';
  // NSX Local Manager (I39): Medium, except HA + Large -> Large
  const nsxManagerSize = model === 'High Availability' && size === 'Large' ? 'Large' : 'Medium';
  return { vcenterSize, vcenterStorage, nsxManagerSize };
}

// VCF Operations bumps the appliance size one tier when HA is chosen.
function vcfOpsSize(model: string, size: string): string | null {
  if (model === 'High Availability') {
    if (size === 'Small') return 'Medium';
    if (size === 'Medium') return 'Large';
    if (size === 'Large') return 'Extra Large';
  } else if (size === 'Small') {
    return 'Small';
  }
  return null; // Simple + Medium/Large: not sized by the sheet
}

export function components(s: SizingState): Component[] {
  const list: Component[] = [];
  const ha = s.deploymentModel === 'High Availability';
  const size = s.deploymentSize;
  const d = deriveMgmtSizes(s.deploymentModel, size);

  // SDDC Manager — fixed
  list.push({ name: 'SDDC Manager', ...SDDC_MANAGER });

  // Management vCenter (size + storage derived from deployment profile)
  list.push({
    name: 'Management vCenter',
    nodes: 1,
    cpu: vcenterCpu[d.vcenterSize],
    ram: vcenterRam[d.vcenterSize],
    disk: vcenterDisk[d.vcenterSize + d.vcenterStorage],
  });

  // Management NSX Managers (+ optional Global Manager; local size derived)
  {
    const localNodes = ha ? 3 : 1;
    const gm = s.nsxGmSize !== 'Excluded';
    const nodes = localNodes + (gm ? 3 : 0);
    const cpu = nsxtManagerCpu[d.nsxManagerSize] * localNodes + (gm ? nsxtManagerCpu[s.nsxGmSize] * 3 : 0);
    const ram = nsxtManagerRam[d.nsxManagerSize] * localNodes + (gm ? nsxtManagerRam[s.nsxGmSize] * 3 : 0);
    const disk = nsxtManagerDisk[d.nsxManagerSize] * localNodes + (gm ? nsxtManagerDisk[s.nsxGmSize] * 3 : 0);
    list.push({ name: 'Management NSX Managers (Local / Global)', nodes, cpu, ram, disk });
  }

  // Management NSX Edges (2-node)
  if (s.nsxEdgeSize !== 'Excluded') {
    list.push({
      name: 'Management NSX Edges',
      nodes: 2,
      cpu: nsxtEdgeCpu[s.nsxEdgeSize] * 2,
      ram: nsxtEdgeRam[s.nsxEdgeSize] * 2,
      disk: nsxtEdgeDisk[s.nsxEdgeSize] * 2,
    });
  }

  // Management AVI Load Balancer (3-node)
  if (s.aviSize !== 'Excluded') {
    list.push({
      name: 'Management AVI Load Balancer',
      nodes: 3,
      cpu: aviCpu[s.aviSize] * 3,
      ram: aviRam[s.aviSize] * 3,
      disk: aviDisk[s.aviSize] * 3,
    });
  }

  // Management Security Services Platform (+ licensing hub)
  if (s.sspSize !== 'Excluded') {
    const workerNodes = s.sspSize === 'Medium' ? 9 : s.sspSize === 'Large' ? 12 : 14;
    list.push({
      name: 'Security Services Platform',
      nodes: workerNodes,
      cpu: sspCpu[s.sspSize] + SSP_LIC.cpu,
      ram: sspRam[s.sspSize] + SSP_LIC.ram,
      disk: sspDisk[s.sspSize] + SSP_LIC.disk,
    });
  }

  // VCF services runtime (VCFMS) — control nodes
  {
    const nodes = ha ? 3 : 1;
    list.push({
      name: 'VCF services runtime — control nodes',
      nodes,
      cpu: vcfmsControlCpu[size] * nodes,
      ram: vcfmsControlRam[size] * nodes,
      disk: vcfmsControlDisk[size] * nodes,
    });
  }

  // VCF services runtime — worker nodes (with first-instance data-disk uplift)
  {
    const nodes = s.deploymentModel === 'Simple' ? 3 : vcfmsWorkerNodes[size];
    const uplift = s.instanceModel === 'First Instance' ? vcfmsWorkerDataDiskFirst[size] : 0;
    list.push({
      name: 'VCF services runtime — worker nodes',
      nodes,
      cpu: vcfmsWorkerCpu[size] * nodes,
      ram: vcfmsWorkerRam[size] * nodes,
      disk: vcfmsWorkerDisk[size] * nodes + uplift,
    });
  }

  // VCF Operations
  if (s.vcfOps) {
    const opsSize = vcfOpsSize(s.deploymentModel, size);
    if (opsSize) {
      const nodes = ha ? 3 : 1;
      list.push({
        name: 'VCF Operations',
        nodes,
        cpu: vcfopsCpu[opsSize] * nodes,
        ram: vcfopsRam[opsSize] * nodes,
        disk: vcfopsDisk[opsSize] * nodes,
      });
    }
  }

  // Cloud Proxy (VCF Operations collector)
  if (s.vcfOpsCollector) {
    list.push({
      name: 'Cloud Proxy (Ops collector)',
      nodes: 1,
      cpu: cloudProxyCpu[size],
      ram: cloudProxyRam[size],
      disk: cloudProxyDisk[size],
    });
  }

  // VCF Automation
  if (s.vcfAutomation) {
    const nodes = ha ? 3 : 1;
    list.push({
      name: 'VCF Automation',
      nodes,
      cpu: vcfaCpu[size] * nodes,
      ram: vcfaRam[size] * nodes,
      disk: vcfaDisk[size] * nodes,
    });
  }

  // VCF Operations for Networks (+ collector)
  if (s.opsNetSize !== 'Excluded') {
    const nodes = s.opsNetSize === 'Large' ? 3 : 1;
    list.push({
      name: 'VCF Operations for Networks',
      nodes,
      cpu: opsNetCpu[s.opsNetSize] * nodes,
      ram: opsNetRam[s.opsNetSize] * nodes,
      disk: opsNetDisk[s.opsNetSize] * nodes,
    });
    list.push({
      name: 'VCF Operations for Networks — collector',
      nodes: 1,
      cpu: opsNetCollectorCpu[s.opsNetSize],
      ram: opsNetCollectorRam[s.opsNetSize],
      disk: opsNetCollectorDisk[s.opsNetSize],
    });
  }

  // Workload domain components (each runs inside the management domain)
  s.workloadDomains.forEach((w, i) => {
    const label = w.name?.trim() || `Workload Domain ${i + 1}`;
    // WLD vCenter
    list.push({
      name: `${label} — vCenter`,
      nodes: 1,
      cpu: vcenterCpu[w.vcenterSize],
      ram: vcenterRam[w.vcenterSize],
      disk: vcenterDisk[w.vcenterSize + w.vcenterStorage],
    });
    // WLD NSX Managers. Local-manager nodes only when the model is dedicated
    // (Shared reuses an existing instance, adding nothing). Global-manager
    // nodes (Active/Standby) are counted independently of the local model, per
    // the sheet. GM is sized the same as the LM here (simplification: the
    // workbook has a separate GM size cell).
    const localNodes = w.nsxModel === 'Shared' ? 0 : w.nsxModel === 'Dedicated - HA Cluster' ? 3 : 1;
    const gmNodes = w.gm === 'Active GM' || w.gm === 'Standby GM' ? 3 : 0;
    const nodes = localNodes + gmNodes;
    if (nodes > 0) {
      list.push({
        name: `${label} — NSX Managers`,
        nodes,
        cpu: nsxtManagerCpu[w.nsxSize] * nodes,
        ram: nsxtManagerRam[w.nsxSize] * nodes,
        disk: nsxtManagerDisk[w.nsxSize] * nodes,
      });
    }
  });

  // Protection blueprint / fleet reserve — fixed
  list.push({ name: 'Protection blueprint reserve', ...PROTECTION_BLUEPRINT });

  return list;
}

// ---------------------------------------------------------------------------
// Requirement + capacity + fit
// ---------------------------------------------------------------------------

export interface Dimension {
  required: number; // resource the fleet needs
  available: number; // resource the proposed cluster offers (at N-1 for cpu/ram)
  fits: boolean;
  headroomPct: number; // (available/required - 1) * 100
}

export interface SizingResult {
  components: Component[];
  totals: { nodes: number; cpu: number; ram: number; disk: number };
  vsan: { vmCapacity: number; swap: number; interim: number; redundancy: number; reserve: number; growth: number; raw: number };
  requiredHosts: number;
  derived: DerivedSizes; // mgmt vCenter + NSX Local Manager sizes fixed by the profile
  perHostRaw: number; // raw GB each host contributes to vSAN (0 for NFS/FC)
  storageAvailable: number; // total capacity the proposed cluster offers
  perHostN1: { cpu: number; ram: number; storage: number } | null;
  fit: { cpu: Dimension; ram: Dimension; storage: Dimension; hosts: Dimension; overall: boolean; binding: string };
}

const ceil = Math.ceil;

export function compute(s: SizingState): SizingResult {
  const comps = components(s);
  const totals = comps.reduce(
    (a, c) => ({ nodes: a.nodes + c.nodes, cpu: a.cpu + c.cpu, ram: a.ram + c.ram, disk: a.disk + c.disk }),
    { nodes: 0, cpu: 0, ram: 0, disk: 0 },
  );

  // vSAN raw capacity (matches sheet cells R15..R20)
  const stretched = s.clusterType !== 'Standard';
  const vmCapacity = totals.disk;
  const swap = totals.ram; // swap reservation == total RAM
  const interim = vmCapacity + swap;
  let redundancy = interim;
  let reserve = interim;
  let growth: number;
  if (isVsan(s.storageType)) {
    redundancy = ceil(interim * (s.storageType === 'vSAN-ESA' ? 1.5 : 2));
    reserve = ceil(redundancy * (1 + s.reservePct / 100));
    growth = ceil(reserve * (1 + s.growthPct / 100));
  } else {
    growth = ceil(interim * (1 + s.growthPct / 100));
  }
  // Stretched vSAN mirrors the full dataset into each AZ.
  const raw = stretched && isVsan(s.storageType) ? growth * 2 : growth;

  const n = s.proposedHosts;

  // vSAN raw contributed per host = capacity devices x device size (ESA counts
  // every device; OSA counts capacity-tier disks only — the caller supplies the
  // right count). NFS / FC use the external datastore figure instead.
  const perHostRaw = s.capacityDisksPerHost * s.capacityDiskSizeGb;
  const storageAvailable = isVsan(s.storageType) ? perHostRaw * n : s.externalStorageGb;

  // Required host count (sheet cell R8)
  const floor = s.deploymentModel === 'High Availability' ? 4 : isVsan(s.storageType) ? 3 : 2;
  const hostsForCpu = ceil(totals.cpu / s.cpuOver / s.coresPerHost);
  const hostsForRam = ceil(totals.ram / s.ramOver / s.ramPerHost) + 1;
  let requiredHosts = Math.max(floor, hostsForCpu, hostsForRam);
  // Storage-driven hosts, if per-host vSAN capacity is given
  const hostsForStorage = isVsan(s.storageType) && perHostRaw > 0 ? ceil(raw / perHostRaw) : 0;
  requiredHosts = Math.max(requiredHosts, hostsForStorage);
  if (stretched) requiredHosts = Math.max(8, requiredHosts + (requiredHosts % 2)); // even, min 8
  const perHostN1 = n > 1
    ? {
        cpu: ceil(totals.cpu / (n - 1) / s.cpuOver),
        ram: ceil(totals.ram / (n - 1) / s.ramOver),
        storage: ceil(raw / (n - 1)),
      }
    : null;

  // Fit check — CPU/RAM tolerate one host failure (N-1); storage rebuild is in
  // the reserve %, so it uses full N.
  const usableHosts = Math.max(0, n - 1);
  const dim = (required: number, available: number): Dimension => ({
    required,
    available,
    fits: available >= required && required >= 0,
    headroomPct: required > 0 ? (available / required - 1) * 100 : Infinity,
  });
  const cpu = dim(totals.cpu, usableHosts * s.coresPerHost * s.cpuOver);
  const ram = dim(totals.ram, usableHosts * s.ramPerHost * s.ramOver);
  const storage = dim(raw, storageAvailable);
  const hosts = dim(requiredHosts, n);

  const named: Array<[string, Dimension]> = [
    ['CPU', cpu], ['RAM', ram], ['storage', storage], ['host count', hosts],
  ];
  const overall = named.every(([, d]) => d.fits);
  const binding = named.reduce((min, cur) => (cur[1].headroomPct < min[1].headroomPct ? cur : min))[0];

  return {
    components: comps,
    totals,
    vsan: { vmCapacity, swap, interim, redundancy, reserve, growth, raw },
    requiredHosts,
    derived: deriveMgmtSizes(s.deploymentModel, s.deploymentSize),
    perHostRaw,
    storageAvailable,
    perHostN1,
    fit: { cpu, ram, storage, hosts, overall, binding },
  };
}
