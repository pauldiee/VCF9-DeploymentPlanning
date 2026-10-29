// src/lib/mgmt-sizing.ts
var WORKBOOK_REVISION = "v1.9.1.102";
var T = {
  vcenter_appliance_cpu: { "Tiny": 2, "Small": 4, "Medium": 8, "Large": 16, "XLarge": 24 },
  vcenter_appliance_ram: { "Tiny": 14, "Small": 21, "Medium": 30, "Large": 39, "XLarge": 58 },
  vcenter_disk_gb: { "TinyDefault": 619, "TinyLarge": 2059, "TinyXLarge": 4319, "Tinylstorage": 2059, "Tinyxlstorage": 4319, "SmallDefault": 734, "SmallLarge": 2084, "SmallXLarge": 4344, "Smalllstorage": 2084, "Smallxlstorage": 4344, "MediumDefault": 933, "MediumLarge": 2233, "MediumXLarge": 4493, "Mediumlstorage": 2233, "Mediumxlstorage": 4493, "LargeDefault": 1383, "LargeLarge": 2283, "Largelstorage": 2283, "Largexlstorage": 4553, "LargeXLarge": 4543, "XLargeDefault": 2308, "XLargeLarge": 2408, "XLargeXLarge": 4668, "XLargelstorage": 2408, "Xlargexlstorage": 4668 },
  nsxt_manager_cpu: { "Extra_Small": 2, "Small": 4, "Medium": 6, "Large": 12, "XLarge": 24 },
  nsxt_manager_ram: { "Extra_Small": 8, "Small": 16, "Medium": 24, "Large": 48, "XLarge": 96 },
  nsxt_manager_disk_gb: { "Extra_Small": 300, "Small": 300, "Medium": 300, "Large": 300, "XLarge": 400 },
  nsxt_edge_cpu: { "NSX Edge Small": 2, "NSX Edge Medium": 4, "NSX Edge Large": 8, "NSX Edge XLarge": 16, "VNA Small": 2, "VNA Medium": 4, "VNA Large": 8, "VNA XLarge": 16 },
  nsxt_edge_ram: { "NSX Edge Small": 4, "NSX Edge Medium": 8, "NSX Edge Large": 32, "NSX Edge XLarge": 64, "VNA Small": 4, "VNA Medium": 8, "VNA Large": 32, "VNA XLarge": 64 },
  nsxt_edge_disk_gb: { "NSX Edge Small": 200, "NSX Edge Medium": 200, "NSX Edge Large": 200, "NSX Edge XLarge": 200, "VNA Small": 200, "VNA Medium": 200, "VNA Large": 200, "VNA XLarge": 200 },
  supervisor_cpu: { "Tiny": 2, "Small": 4, "Medium": 8, "Large": 16, "Xlarge": 32 },
  supervisor_ram: { "Tiny": 8, "Small": 16, "Medium": 24, "Large": 32, "Xlarge": 64 },
  supervisor_disk: { "Tiny": 48, "Small": 48, "Medium": 48, "Large": 48, "Xlarge": 48 },
  avi_lb_cpu: { "Small": 6, "Large": 16, "X-Large": 16 },
  avi_lb_ram: { "Small": 32, "Large": 48, "X-Large": 64 },
  avi_lb_disk: { "Small": 512, "Large": 1400, "X-Large": 1750 },
  ssp_cpu: { "Medium": 64, "Large": 96, "XLarge": 160 },
  ssp_ram: { "Medium": 222, "Large": 350, "XLarge": 606 },
  ssp_disk: { "Medium": 3260, "Large": 3600, "XLarge": 6120 },
  ssp_workers: { "Medium": 2, "Large": 4, "XLarge": 8 },
  ssp_controller: { "Medium": 3, "Large": 3, "XLarge": 3 },
  ssp_sspi: { "Medium": 1, "Large": 1, "XLarge": 1 },
  ssp_sspi_cpu: { "Medium": 4, "Large": 4, "XLarge": 4 },
  ssp_sspi_ram: { "Medium": 6, "Large": 6, "XLarge": 6 },
  ssp_sspi_disk: { "Medium": 400, "Large": 400, "XLarge": 400 },
  vcfms_control_cpu: { "Small": 4, "Small HA": 4, "Medium": 4, "Large": 8 },
  vcfms_control_ram: { "Small": 10, "Small HA": 10, "Medium": 10, "Large": 14 },
  vcfms_control_disk: { "Small": 100, "Small HA": 100, "Medium": 100, "Large": 100 },
  vcfms_control_nodes: { "Simple": 1, "High Availability": 3 },
  vcfms_worker_cpu: { "First InstanceSimpleSmall": 12, "First InstanceHigh AvailabilitySmall": 10, "First InstanceHigh AvailabilityMedium": 12, "First InstanceHigh AvailabilityLarge": 16, "Additional InstanceSimpleSmall": 12, "Additional InstanceHigh AvailabilitySmall": 10, "Additional InstanceHigh AvailabilityMedium": 12, "Additional InstanceHigh AvailabilityLarge": 16 },
  vcfms_worker_ram: { "First InstanceSimpleSmall": 24, "First InstanceHigh AvailabilitySmall": 16, "First InstanceHigh AvailabilityMedium": 24, "First InstanceHigh AvailabilityLarge": 32, "Additional InstanceSimpleSmall": 24, "Additional InstanceHigh AvailabilitySmall": 16, "Additional InstanceHigh AvailabilityMedium": 24, "Additional InstanceHigh AvailabilityLarge": 32 },
  vcfms_worker_disk: { "First InstanceSimpleSmall": 2900, "First InstanceHigh AvailabilitySmall": 2800, "First InstanceHigh AvailabilityMedium": 3300, "First InstanceHigh AvailabilityLarge": 4002, "Additional InstanceSimpleSmall": 1e3, "Additional InstanceHigh AvailabilitySmall": 1e3, "Additional InstanceHigh AvailabilityMedium": 1202, "Additional InstanceHigh AvailabilityLarge": 1500 },
  vcfops_appliance_cpu: { "Extra Small": 2, "Small": 4, "Medium": 8, "Large": 16, "Extra Large": 24 },
  vcfops_appliance_ram: { "Extra Small": 8, "Small": 16, "Medium": 32, "Large": 48, "Extra Large": 128 },
  vcfops_appliance_disk: { "Extra Small": 274, "Small": 274, "Medium": 274, "Large": 274, "Extra Large": 274 },
  vcfo_p_cpu: { "Small": 4, "Standard": 8 },
  vcfo_p_ram: { "Small": 16, "Standard": 48 },
  vcfo_p_disk: { "Small": 264, "Standard": 264 },
  vcfa_appliance_cpu: { "Small": 24, "Medium": 24, "Large": 32 },
  vcfa_appliance_ram: { "Small": 96, "Medium": 96, "Large": 128 },
  vcfa_appliance_disk: { "Small": 600, "Medium": 900, "Large": 1200 },
  vcfopsnet_appliance_cpu: { "Small": 4, "Medium": 8, "Large": 12, "XL": 16, "XXL": 24 },
  vcfopsnet_appliance_ram: { "Small": 16, "Medium": 32, "Large": 48, "XL": 64, "XXL": 128 },
  vcfopsnet_appliance_disk: { "Small": 1024, "Medium": 1024, "Large": 2048, "XL": 2048, "XXL": 2048 },
  vcfopsnet_collector_cpu: { "Small": 2, "Medium": 4, "Large": 8, "XL": 8, "XXL": 16 },
  vcfopsnet_collector_ram: { "Small": 4, "Medium": 12, "Large": 16, "XL": 24, "XXL": 48 },
  vcfopsnet_collector_disk: { "Small": 250, "Medium": 250, "Large": 250, "XL": 250, "XXL": 300 },
  logman_worker_cpu: { "Small": 8, "Medium": 16, "Large": 32 },
  logman_worker_ram: { "Small": 16, "Medium": 32, "Large": 64 },
  vrli_appliance_disk: { "Small": 575, "Medium": 575, "Large": 575 },
  vodap_worker_cpu: { "SimpleSmall": 16, "High AvailabilitySmall": 16, "High AvailabilityMedium": 31, "High AvailabilityLarge": 47 },
  vodap_worker_ram: { "SimpleSmall": 20, "High AvailabilitySmall": 20, "High AvailabilityMedium": 41, "High AvailabilityLarge": 62 },
  software_depot_cpu: { "SimpleSmall": 2, "High AvailabilitySmall": 2, "High AvailabilityMedium": 3, "High AvailabilityLarge": 4 },
  software_depot_ram: { "SimpleSmall": 2, "High AvailabilitySmall": 2, "High AvailabilityMedium": 3, "High AvailabilityLarge": 6 },
  software_depot_disk: { "SimpleSmall": 1500, "High AvailabilitySmall": 1500, "High AvailabilityMedium": 1500, "High AvailabilityLarge": 1500 },
  idbroker_cpu: { "SimpleSmall": 1.5, "High AvailabilitySmall": 3, "High AvailabilityMedium": 5, "High AvailabilityLarge": 10 },
  idbroker_ram: { "SimpleSmall": 2, "High AvailabilitySmall": 5, "High AvailabilityMedium": 5, "High AvailabilityLarge": 20 },
  idbroker_disk: { "SimpleSmall": 20, "High AvailabilitySmall": 60, "High AvailabilityMedium": 60, "High AvailabilityLarge": 120 },
  sddc_lcm_cpu: { "SimpleSmall": 2, "High AvailabilitySmall": 2.5, "High AvailabilityMedium": 2.5, "High AvailabilityLarge": 2.5 },
  sddc_lcm_ram: { "SimpleSmall": 3, "High AvailabilitySmall": 3.5, "High AvailabilityMedium": 3.5, "High AvailabilityLarge": 3.5 },
  salt_cpu: { "SimpleSmall": 0.7, "High AvailabilitySmall": 0.7, "High AvailabilityMedium": 1.5, "High AvailabilityLarge": 2.5 },
  salt_ram: { "SimpleSmall": 1.5, "High AvailabilitySmall": 1.5, "High AvailabilityMedium": 2.5, "High AvailabilityLarge": 4.5 },
  salt_raas_cpu: { "SimpleSmall": 1.15, "High AvailabilitySmall": 1.15, "High AvailabilityMedium": 4.5, "High AvailabilityLarge": 7 },
  salt_raas_ram: { "SimpleSmall": 2.6, "High AvailabilitySmall": 2.6, "High AvailabilityMedium": 6, "High AvailabilityLarge": 9 },
  telemetry_cpu: { "SimpleSmall": 0.5, "High AvailabilitySmall": 0.5, "High AvailabilityMedium": 1, "High AvailabilityLarge": 1 },
  telemetry_ram: { "SimpleSmall": 2, "High AvailabilitySmall": 2, "High AvailabilityMedium": 3, "High AvailabilityLarge": 6 },
  fleet_cpu: { "SimpleSmall": 2, "High AvailabilitySmall": 2.5, "High AvailabilityMedium": 2.5, "High AvailabilityLarge": 2.5 },
  fleet_ram: { "SimpleSmall": 3, "High AvailabilitySmall": 3.5, "High AvailabilityMedium": 3.5, "High AvailabilityLarge": 3.5 },
  srm_cpu: { "Light": 2, "Standard": 8 },
  srm_ram: { "Light": 8, "Standard": 24 },
  srm_disk: { "Light": 20, "Standard": 800 },
  sddc_manager_cpu: 4,
  sddc_manager_ram: 16,
  sddc_manager_disk: 914,
  ssp_lic_cpu: 6,
  ssp_lic_ram: 12,
  ssp_lic_disk: 256
};
var OPTIONS = {
  platform: ["VCF", "VVF"],
  deploymentModel: ["Simple", "High Availability"],
  // Simple deploys at Small only; High Availability at Small, Medium or Large
  // (workbook lists sizing_vcf_deployment_model_small / sizing_vcf_deployment_model).
  deploymentSize: ["Small", "Medium", "Large"],
  instanceModel: ["First Instance", "Additional Instance"],
  storageType: ["vSAN-ESA", "vSAN-OSA", "NFS", "FC"],
  vcenterSize: ["Tiny", "Small", "Medium", "Large", "XLarge"],
  vcenterStorage: ["Default", "Large", "XLarge"],
  nsxManagerSize: ["Small", "Medium", "Large", "XLarge"],
  nsxGmSize: ["Excluded", "Small", "Medium", "Large", "XLarge"],
  nsxEdgeSize: ["Excluded", "NSX Edge Small", "NSX Edge Medium", "NSX Edge Large", "NSX Edge XLarge", "VNA Small", "VNA Medium", "VNA Large", "VNA XLarge"],
  supervisorMode: ["Excluded", "Single Node", "High Availability"],
  supervisorSize: ["Tiny", "Small", "Medium", "Large", "Xlarge"],
  aviSize: ["Excluded", "Small", "Large", "X-Large"],
  ssp: ["Excluded", "Include"],
  vcfOps: ["Include", "Existing", "Exclude"],
  opsNetSize: ["Excluded", "Small", "Medium", "Large", "XL", "XXL"],
  logsSize: ["Exclude", "Small", "Medium", "Large"],
  vcfAutomationSize: ["Small", "Medium", "Large"],
  nsxModel: ["Shared", "Dedicated - Single Node", "Dedicated - HA Cluster"],
  gm: ["Excluded", "Active GM", "Standby GM", "Connect Instance"],
  spr: ["Exclude", "Management Only", "Workload Only", "Management & Workload"],
  clusterType: ["Standard", "Stretched (multi-AZ)", "Stretched (vMSC)"],
  // Advanced Management Domain Sizing (workbook R24-R32)
  advNsxModel: ["HA Cluster", "Single Node"],
  advNsxSize: ["Medium", "Large", "XLarge"],
  advVcfOpsModel: ["Exclude", "HA Cluster", "Single Node"],
  advVcfOpsSize: ["Exclude", "Extra Small", "Small", "Medium", "Large", "Extra Large"],
  advCollectorSize: ["Exclude", "Small", "Standard"],
  advVcfaSize: ["Exclude", "Small", "Medium", "Large"],
  // VVF / Standalone profile (no workbook sheet — see vvfComponents)
  vvfOpsModel: ["Single Node", "HA - 2 nodes", "HA - 3 nodes"],
  vvfOpsSize: ["Extra Small", "Small", "Medium", "Large", "Extra Large"],
  vvfCollectorSize: ["Exclude", "Small", "Standard"]
};
function deploymentSizeOptions(model) {
  return model === "Simple" ? ["Small"] : ["Small", "Medium", "Large"];
}
var LOGS_REPLICA_MAX = 19;
function logsSizeOptions() {
  return ["Exclude", "Small", "Medium", "Large"];
}
function logsReplicaMin(logsSize) {
  return logsSize === "Large" ? 6 : logsSize === "Medium" ? 3 : 1;
}
function vcfAutomationNodes(vcfAutomationSize) {
  return vcfAutomationSize === "Small" ? 1 : 3;
}
function supervisorEdgeWarning(supervisorPlanned, nsxEdgeSize) {
  if (!supervisorPlanned) return null;
  if (nsxEdgeSize === "NSX Edge Small" || nsxEdgeSize === "NSX Edge Medium")
    return "A Supervisor backed by an NSX Edge cluster (VPC + Centralized Transit Gateway, or classic NSX) needs it at the Large form factor minimum \u2014 see 10-supervisor-enablement.md \xA73.1. Small and Medium Edges only cover plain north-south routing.";
  return null;
}
function defaultState() {
  return {
    deploymentModel: "High Availability",
    deploymentSize: "Medium",
    instanceModel: "First Instance",
    storageType: "vSAN-ESA",
    coresPerHost: 128,
    ramPerHost: 1024,
    capacityDisksPerHost: 8,
    capacityDiskSizeGb: 1920,
    externalStorageGb: 4e4,
    cpuOver: 1,
    ramOver: 1,
    reservePct: 30,
    growthPct: 10,
    clusterType: "Standard",
    proposedHosts: 4,
    nsxGmSize: "Excluded",
    nsxEdgeSize: "Excluded",
    supervisorMode: "Excluded",
    supervisorSize: "Medium",
    aviSize: "Excluded",
    ssp: "Excluded",
    licenseHub: false,
    // A greenfield first instance normally deploys VCF Operations, which brings
    // the Cloud Proxy and License Server with it (rows 24-26).
    vcfOps: "Include",
    vcfOpsCollector: false,
    vcfAutomation: false,
    vcfAutomationSize: "Medium",
    opsNetSize: "Excluded",
    logsSize: "Exclude",
    logsReplicas: 3,
    vcfRtm: false,
    vcfSd: false,
    vcfIdb: false,
    // workbook defaults for the advanced cells
    advanced: false,
    advVcenterSize: "Medium",
    advVcenterStorage: "Default",
    advNsxModel: "HA Cluster",
    advNsxSize: "Medium",
    advVcfOpsModel: "Exclude",
    advVcfOpsSize: "Exclude",
    advCollectorSize: "Exclude",
    advVcfaSize: "Exclude",
    spr: "Exclude",
    rwr: false,
    workloadDomains: [],
    // VVF defaults follow the VCF Installer's vSphere Foundation wizard:
    // Medium vCenter, single Medium VCF Operations, small (Simple) management services.
    platform: "VCF",
    vvfVcenterSize: "Medium",
    vvfVcenterStorage: "Default",
    vvfOpsModel: "Single Node",
    vvfOpsSize: "Medium",
    vvfCollectorSize: "Small",
    vvfMgmtServices: true,
    socketsPerHost: 2
  };
}
var VVF_SERVICES_PROFILE = { deploymentModel: "Simple", deploymentSize: "Small" };
function migrateState(raw) {
  const s = { ...raw };
  if (typeof s.vcfOps === "boolean") s.vcfOps = s.vcfOps ? "Include" : "Exclude";
  if (typeof s.sspSize === "string" && s.ssp === void 0) s.ssp = s.sspSize === "Excluded" ? "Excluded" : "Include";
  if (typeof s.supervisorPlanned === "boolean" && s.supervisorMode === void 0)
    s.supervisorMode = s.supervisorPlanned ? "High Availability" : "Excluded";
  if (s.licenseHub === void 0 && (s.sspSize !== void 0 || s.aviSize !== void 0))
    s.licenseHub = typeof s.sspSize === "string" && s.sspSize !== "Excluded";
  if (Array.isArray(s.workloadDomains)) {
    s.workloadDomains = s.workloadDomains.map((w) => ({
      aviSize: "Excluded",
      ssp: false,
      spr: false,
      ...w,
      gm: w.gm === "None" ? "Excluded" : w.gm,
      gmSize: w.gmSize ?? w.nsxSize
    }));
  }
  delete s.sspSize;
  delete s.supervisorPlanned;
  return s;
}
var isVsan = (t) => t === "vSAN-ESA" || t === "vSAN-OSA";
var ceil = (x) => Math.ceil(Math.round(x * 1e9) / 1e9);
var lk = (tbl, key) => tbl[key] ?? 0;
function deriveMgmtSizes(s) {
  if (s.advanced) {
    return {
      vcenterSize: s.advVcenterSize,
      vcenterStorage: s.advVcenterStorage,
      nsxManagerSize: s.advNsxSize,
      nsxHaCluster: s.advNsxModel === "HA Cluster"
    };
  }
  const ha = s.deploymentModel === "High Availability";
  const size = s.deploymentSize;
  const vcenterSize = ha ? size : "Small";
  const vcenterStorage = ha && size === "Large" ? "XLarge" : "Large";
  const nsxManagerSize = ha && size === "Large" ? "Large" : "Medium";
  return { vcenterSize, vcenterStorage, nsxManagerSize, nsxHaCluster: ha };
}
var VCFMS_WORKER_DAYN_CPU = {
  "First InstanceSimpleSmall": 16,
  "First InstanceHigh AvailabilitySmall": 16,
  "First InstanceHigh AvailabilityMedium": 24,
  "First InstanceHigh AvailabilityLarge": 24
};
var VCFMS_WORKER_DAYN_RAM = {
  "First InstanceSimpleSmall": 32,
  "First InstanceHigh AvailabilitySmall": 32,
  "First InstanceHigh AvailabilityMedium": 48,
  "First InstanceHigh AvailabilityLarge": 48
};
function vcfmsWorkers(s) {
  const vvf = s.platform === "VVF";
  const key = (vvf ? "First Instance" : s.instanceModel) + s.deploymentModel + s.deploymentSize;
  const prof = s.deploymentModel + s.deploymentSize;
  const addl = !vvf && s.instanceModel === "Additional Instance";
  const logs = s.logsSize !== "Exclude";
  const rtm = !vvf && s.vcfRtm;
  const dayN = logs || rtm;
  const wCpu = (dayN ? VCFMS_WORKER_DAYN_CPU[key] : void 0) ?? lk(T.vcfms_worker_cpu, key);
  const wRam = (dayN ? VCFMS_WORKER_DAYN_RAM[key] : void 0) ?? lk(T.vcfms_worker_ram, key);
  const reps = logs ? Math.min(LOGS_REPLICA_MAX, Math.max(logsReplicaMin(s.logsSize), s.logsReplicas)) : 0;
  const sd = addl && s.vcfSd;
  const idb = addl && s.vcfIdb;
  const dnCpu = (logs ? reps * lk(T.logman_worker_cpu, s.logsSize) : 0) + (rtm ? lk(T.vodap_worker_cpu, prof) : 0) + (sd ? lk(T.software_depot_cpu, prof) : 0) + (idb ? lk(T.idbroker_cpu, prof) : 0);
  const dnRam = (logs ? reps * lk(T.logman_worker_ram, s.logsSize) : 0) + (rtm ? lk(T.vodap_worker_ram, prof) : 0) + (sd ? lk(T.software_depot_ram, prof) : 0) + (idb ? lk(T.idbroker_ram, prof) : 0);
  const dnDisk = (logs ? reps * lk(T.vrli_appliance_disk, s.logsSize) : 0) + (rtm ? 205 : 0) + (sd ? lk(T.software_depot_disk, prof) : 0) + (idb ? lk(T.idbroker_disk, prof) : 0);
  const d0Cpu = vvf ? lk(T.software_depot_cpu, prof) + lk(T.sddc_lcm_cpu, prof) + lk(T.telemetry_cpu, prof) + lk(T.fleet_cpu, prof) : addl ? lk(T.sddc_lcm_cpu, prof) + lk(T.salt_cpu, prof) + lk(T.telemetry_cpu, prof) : lk(T.idbroker_cpu, prof) + lk(T.software_depot_cpu, prof) + lk(T.sddc_lcm_cpu, prof) + lk(T.salt_cpu, prof) + lk(T.salt_raas_cpu, prof) + lk(T.telemetry_cpu, prof) + lk(T.fleet_cpu, prof);
  const d0Ram = vvf ? lk(T.software_depot_ram, prof) + lk(T.sddc_lcm_ram, prof) + lk(T.telemetry_ram, prof) + lk(T.fleet_ram, prof) : addl ? lk(T.sddc_lcm_ram, prof) + lk(T.salt_ram, prof) + lk(T.telemetry_ram, prof) : lk(T.idbroker_ram, prof) + lk(T.software_depot_ram, prof) + lk(T.sddc_lcm_ram, prof) + lk(T.salt_ram, prof) + lk(T.salt_raas_ram, prof) + lk(T.telemetry_ram, prof) + lk(T.fleet_ram, prof);
  const up = ceil;
  const ramNeed = up((dnRam + d0Ram) * 1.2);
  const cpuNeed = up((dnCpu + d0Cpu) * 1.09);
  const byRam = (wRam ? up(ramNeed / wRam) : 0) + (key === "Additional InstanceSimpleSmall" || key === "First InstanceHigh AvailabilityMedium" ? 0 : 1);
  const byCpu = (wCpu ? up(cpuNeed / wCpu) : 0) + (key === "Additional InstanceSimpleSmall" ? 0 : !logs && !rtm && key === "Additional InstanceHigh AvailabilityMedium" ? 0 : (logs || rtm) && key === "First InstanceHigh AvailabilityMedium" ? 0 : 1);
  const nodes = Math.max(byRam, byCpu);
  return { nodes, cpu: nodes * wCpu, ram: nodes * wRam, disk: lk(T.vcfms_worker_disk, key) + dnDisk, perNodeCpu: wCpu, perNodeRam: wRam };
}
var SSP_SIZE = (nsxSize) => nsxSize === "XLarge" ? "XLarge" : nsxSize;
function vvfComponents(s) {
  const list = [];
  const add = (row, name, nodes, cpu, ram, disk) => {
    if (nodes || cpu || ram || disk) list.push({ row, name, nodes, cpu, ram, disk });
  };
  add(
    9,
    "vCenter",
    1,
    lk(T.vcenter_appliance_cpu, s.vvfVcenterSize),
    lk(T.vcenter_appliance_ram, s.vvfVcenterSize),
    lk(T.vcenter_disk_gb, s.vvfVcenterSize + s.vvfVcenterStorage)
  );
  if (s.supervisorMode !== "Excluded") {
    const n = s.supervisorMode === "High Availability" ? 3 : 1;
    add(
      13,
      "vSphere Supervisor",
      n,
      lk(T.supervisor_cpu, s.supervisorSize) * n,
      lk(T.supervisor_ram, s.supervisorSize) * n,
      lk(T.supervisor_disk, s.supervisorSize) * n
    );
  }
  if (s.aviSize !== "Excluded") {
    add(14, "Avi Load Balancer", 3, lk(T.avi_lb_cpu, s.aviSize) * 3, lk(T.avi_lb_ram, s.aviSize) * 3, lk(T.avi_lb_disk, s.aviSize) * 3);
  }
  if (s.licenseHub) add(17, "License Hub (Avi licensing)", 1, T.ssp_lic_cpu, T.ssp_lic_ram, T.ssp_lic_disk);
  if (s.vvfMgmtServices) {
    const n = lk(T.vcfms_control_nodes, s.deploymentModel);
    add(
      22,
      "VCF services runtime (control nodes)",
      n,
      lk(T.vcfms_control_cpu, s.deploymentSize) * n,
      lk(T.vcfms_control_ram, s.deploymentSize) * n,
      lk(T.vcfms_control_disk, s.deploymentSize) * n
    );
    const w = vcfmsWorkers(s);
    add(23, "VCF services runtime (worker nodes)", w.nodes, w.cpu, w.ram, w.disk);
  }
  {
    const n = vvfOpsNodes(s.vvfOpsModel);
    const z = s.vvfOpsSize;
    add(24, "VCF Operations", n, lk(T.vcfops_appliance_cpu, z) * n, lk(T.vcfops_appliance_ram, z) * n, lk(T.vcfops_appliance_disk, z) * n);
  }
  if (s.vvfCollectorSize !== "Exclude") {
    const z = s.vvfCollectorSize;
    add(25, "Cloud Proxy", 1, lk(T.vcfo_p_cpu, z), lk(T.vcfo_p_ram, z), lk(T.vcfo_p_disk, z));
  }
  add(26, "License Server", 1, 2, 4, 12);
  return list;
}
function vvfOpsNodes(model) {
  return model === "HA - 3 nodes" ? 3 : model === "HA - 2 nodes" ? 2 : 1;
}
function components(s) {
  if (s.platform === "VVF") return vvfComponents(s);
  const list = [];
  const add = (row, name, nodes, cpu, ram, disk) => {
    if (nodes || cpu || ram || disk) list.push({ row, name, nodes, cpu, ram, disk });
  };
  const ha = s.deploymentModel === "High Availability";
  const size = s.deploymentSize;
  const first = s.instanceModel === "First Instance";
  const d = deriveMgmtSizes(s);
  const wlds = s.workloadDomains;
  add(8, "SDDC Manager", 1, T.sddc_manager_cpu, T.sddc_manager_ram, T.sddc_manager_disk);
  add(
    9,
    "Management vCenter",
    1,
    lk(T.vcenter_appliance_cpu, d.vcenterSize),
    lk(T.vcenter_appliance_ram, d.vcenterSize),
    lk(T.vcenter_disk_gb, d.vcenterSize + d.vcenterStorage)
  );
  {
    const lmNodes = d.nsxHaCluster ? 3 : 1;
    const gm = s.nsxGmSize !== "Excluded";
    add(
      10,
      "Management NSX Managers (Local / Global)",
      lmNodes + (gm ? 3 : 0),
      lk(T.nsxt_manager_cpu, d.nsxManagerSize) * lmNodes + (gm ? lk(T.nsxt_manager_cpu, s.nsxGmSize) * 3 : 0),
      lk(T.nsxt_manager_ram, d.nsxManagerSize) * lmNodes + (gm ? lk(T.nsxt_manager_ram, s.nsxGmSize) * 3 : 0),
      lk(T.nsxt_manager_disk_gb, d.nsxManagerSize) * lmNodes + (gm ? lk(T.nsxt_manager_disk_gb, s.nsxGmSize) * 3 : 0)
    );
  }
  if (s.nsxEdgeSize !== "Excluded") {
    const vna = s.nsxEdgeSize.startsWith("VNA");
    add(
      vna ? 12 : 11,
      vna ? "Management Virtual Network Appliances" : "Management NSX Edges",
      2,
      lk(T.nsxt_edge_cpu, s.nsxEdgeSize) * 2,
      lk(T.nsxt_edge_ram, s.nsxEdgeSize) * 2,
      lk(T.nsxt_edge_disk_gb, s.nsxEdgeSize) * 2
    );
  }
  if (s.supervisorMode !== "Excluded") {
    const n = s.supervisorMode === "High Availability" ? 3 : 1;
    add(
      13,
      "Management Supervisor",
      n,
      lk(T.supervisor_cpu, s.supervisorSize) * n,
      lk(T.supervisor_ram, s.supervisorSize) * n,
      lk(T.supervisor_disk, s.supervisorSize) * n
    );
  }
  if (s.aviSize !== "Excluded") {
    add(14, "Management Avi Load Balancer", 3, lk(T.avi_lb_cpu, s.aviSize) * 3, lk(T.avi_lb_ram, s.aviSize) * 3, lk(T.avi_lb_disk, s.aviSize) * 3);
  }
  const mgmtSsp = s.ssp === "Include";
  if (mgmtSsp) {
    const z = SSP_SIZE(d.nsxManagerSize);
    add(
      15,
      "Management Security Services Platform",
      lk(T.ssp_workers, z) + lk(T.ssp_controller, z) + lk(T.ssp_sspi, z),
      lk(T.ssp_cpu, z),
      lk(T.ssp_ram, z),
      lk(T.ssp_disk, z)
    );
  }
  {
    const seq = [[mgmtSsp, d.nsxManagerSize], ...wlds.map((w) => [w.ssp, w.nsxSize])];
    let cnt = 0;
    let n = 0, cpu = 0, ram = 0, disk = 0;
    for (const [inc, sz] of seq) {
      if (!inc) continue;
      cnt += 1;
      if (cnt % 5 === 1) {
        const z = SSP_SIZE(sz);
        n += lk(T.ssp_sspi, z);
        cpu += lk(T.ssp_sspi_cpu, z);
        ram += lk(T.ssp_sspi_ram, z);
        disk += lk(T.ssp_sspi_disk, z);
      }
    }
    add(16, "Security Services Platform Installer", n, cpu, ram, disk);
  }
  if (s.licenseHub) add(17, "License Hub (vDefend / Avi licensing)", 1, T.ssp_lic_cpu, T.ssp_lic_ram, T.ssp_lic_disk);
  {
    let vn = 0, vc = 0, vr = 0, vd = 0;
    let nn = 0, nc = 0, nr = 0, nd = 0;
    let an = 0, ac = 0, ar = 0, ad = 0;
    let sn = 0, sc = 0, sr = 0, sd = 0;
    for (const w of wlds) {
      vn += 1;
      vc += lk(T.vcenter_appliance_cpu, w.vcenterSize);
      vr += lk(T.vcenter_appliance_ram, w.vcenterSize);
      vd += lk(T.vcenter_disk_gb, w.vcenterSize + w.vcenterStorage);
      if (w.nsxModel !== "Shared") {
        const k = w.nsxModel === "Dedicated - HA Cluster" ? 3 : 1;
        nn += k;
        nc += lk(T.nsxt_manager_cpu, w.nsxSize) * k;
        nr += lk(T.nsxt_manager_ram, w.nsxSize) * k;
        nd += lk(T.nsxt_manager_disk_gb, w.nsxSize) * k;
      }
      if (w.gm === "Active GM" || w.gm === "Standby GM") {
        nn += 3;
        nc += lk(T.nsxt_manager_cpu, w.gmSize) * 3;
        nr += lk(T.nsxt_manager_ram, w.gmSize) * 3;
        nd += lk(T.nsxt_manager_disk_gb, w.gmSize) * 3;
      }
      if (w.aviSize !== "Excluded") {
        an += 3;
        ac += lk(T.avi_lb_cpu, w.aviSize) * 3;
        ar += lk(T.avi_lb_ram, w.aviSize) * 3;
        ad += lk(T.avi_lb_disk, w.aviSize) * 3;
      }
      if (w.ssp) {
        const z = SSP_SIZE(w.nsxSize);
        sn += lk(T.ssp_workers, z) + lk(T.ssp_controller, z);
        sc += lk(T.ssp_cpu, z);
        sr += lk(T.ssp_ram, z);
        sd += lk(T.ssp_disk, z);
      }
    }
    add(18, "Workload Domain vCenters", vn, vc, vr, vd);
    add(19, "Workload Domain NSX Managers (Local / Global)", nn, nc, nr, nd);
    add(20, "Workload Domain Avi Load Balancers", an, ac, ar, ad);
    add(21, "Workload Domain Security Services Platform", sn, sc, sr, sd);
  }
  {
    const n = lk(T.vcfms_control_nodes, s.deploymentModel);
    add(
      22,
      "VCF services runtime (control nodes)",
      n,
      lk(T.vcfms_control_cpu, size) * n,
      lk(T.vcfms_control_ram, size) * n,
      lk(T.vcfms_control_disk, size) * n
    );
  }
  {
    const w = vcfmsWorkers(s);
    add(23, "VCF services runtime (worker nodes)", w.nodes, w.cpu, w.ram, w.disk);
  }
  {
    const adv = s.advanced;
    let n = 0;
    if (adv && s.advVcfOpsSize === "Exclude") n = 0;
    else if (adv && s.advVcfOpsModel === "HA Cluster") n = 3;
    else if (adv && s.advVcfOpsModel === "Single Node") n = 1;
    else if (s.vcfOps === "Include") n = ha ? size === "Small" ? 2 : 3 : 1;
    if (n) {
      const z = adv ? s.advVcfOpsSize : ha ? size : "Small";
      const dz = adv ? z : ha && size === "Small" ? "Medium" : z;
      add(24, "VCF Operations", n, lk(T.vcfops_appliance_cpu, z) * n, lk(T.vcfops_appliance_ram, z) * n, lk(T.vcfops_appliance_disk, dz) * n);
    }
  }
  {
    const want = s.vcfOps !== "Exclude" || s.vcfOpsCollector;
    if (s.advanced) {
      if (s.advCollectorSize !== "Exclude") {
        const z = s.advCollectorSize;
        add(25, "Cloud Proxy", want ? 1 : 0, lk(T.vcfo_p_cpu, z), lk(T.vcfo_p_ram, z), lk(T.vcfo_p_disk, z));
      }
    } else if (want) {
      const z = !ha || size === "Small" ? "Small" : "Standard";
      add(25, "Cloud Proxy", 1, lk(T.vcfo_p_cpu, z), lk(T.vcfo_p_ram, z), lk(T.vcfo_p_disk, z));
    }
  }
  {
    const advOps = s.advanced && s.advVcfOpsModel !== "Exclude";
    if (first && (s.vcfOps !== "Exclude" || advOps)) add(26, "License Server", 1, 2, 4, 12);
  }
  {
    const z = s.advanced ? s.advVcfaSize : s.vcfAutomation ? s.vcfAutomationSize : "Exclude";
    if (z !== "Exclude") {
      const n = vcfAutomationNodes(z);
      add(27, "VCF Automation", n, lk(T.vcfa_appliance_cpu, z) * n, lk(T.vcfa_appliance_ram, z) * n, lk(T.vcfa_appliance_disk, z) * n);
    }
  }
  if (s.opsNetSize !== "Excluded") {
    const n = first ? 1 : 0;
    add(
      28,
      "VCF Operations for Networks",
      n,
      lk(T.vcfopsnet_appliance_cpu, s.opsNetSize) * n,
      lk(T.vcfopsnet_appliance_ram, s.opsNetSize) * n,
      lk(T.vcfopsnet_appliance_disk, s.opsNetSize) * n
    );
    add(
      29,
      "VCF Operations for Networks (collector)",
      1,
      lk(T.vcfopsnet_collector_cpu, s.opsNetSize),
      lk(T.vcfopsnet_collector_ram, s.opsNetSize),
      lk(T.vcfopsnet_collector_disk, s.opsNetSize)
    );
  }
  {
    const mo = s.spr === "Management Only", wo = s.spr === "Workload Only", mw = s.spr === "Management & Workload";
    const mgmtN = mo || mw ? 1 : 0;
    const wldN = mo ? 0 : wlds.filter((w) => w.spr).length;
    const wldPer = wo || mw;
    const rwrN = s.rwr ? 1 : 0;
    const per = (t) => lk(t, "Standard");
    add(
      30,
      "Protection blueprints (Live Recovery)",
      mgmtN + wldN + rwrN,
      mgmtN * per(T.srm_cpu) + (wldPer ? wldN * per(T.srm_cpu) : 0) + rwrN * 8,
      mgmtN * per(T.srm_ram) + (wldPer ? wldN * per(T.srm_ram) : 0) + rwrN * 24,
      mgmtN * per(T.srm_disk) + (wldPer ? wldN * per(T.srm_disk) : 0) + rwrN * 800
    );
  }
  return list;
}
function workbookHostCount(s, comps) {
  const sum = (k, rows) => comps.filter((c) => rows ? rows(c.row) : true).reduce((a, c) => a + c[k], 0);
  const cpuAll = sum("cpu");
  const ramNoProt = sum("ram", (r) => r !== 30);
  const ramProt = sum("ram", (r) => r === 30);
  const cpuHosts = ceil(cpuAll / s.cpuOver / s.coresPerHost);
  if (deriveMgmtSizes(s).nsxHaCluster) {
    return Math.max(4, cpuHosts, ceil((ramNoProt + ramProt) / s.ramPerHost) + 1);
  }
  const ramHosts = ceil((ramNoProt + ramProt / s.ramOver) / s.ramPerHost) + 1;
  return Math.max(isVsan(s.storageType) ? 3 : 2, cpuHosts, ramHosts);
}
function vvfHostCount(s, totals) {
  const cpuHosts = ceil(totals.cpu / s.cpuOver / s.coresPerHost);
  const ramHosts = ceil(totals.ram / s.ramOver / s.ramPerHost) + 1;
  return Math.max(isVsan(s.storageType) ? 3 : 2, cpuHosts, ramHosts);
}
var LICENSE_MIN_CORES_PER_CPU = 16;
var VSAN_TIB_PER_CORE = { VCF: 1, VVF: 0.25 };
var GB_PER_TIB = 1024 ** 4 / 1e9;
function licensing(s) {
  const sockets = Math.max(1, Math.round(s.socketsPerHost) || 1);
  const coresPerCpu = s.coresPerHost / sockets;
  const licensedCoresPerHost = sockets * Math.max(LICENSE_MIN_CORES_PER_CPU, Math.ceil(coresPerCpu));
  const licensedCores = licensedCoresPerHost * s.proposedHosts;
  const vsan = isVsan(s.storageType);
  const rawTiB = vsan ? s.capacityDisksPerHost * s.capacityDiskSizeGb * s.proposedHosts / GB_PER_TIB : 0;
  const entitledTiB = ceil(licensedCores * (VSAN_TIB_PER_CORE[s.platform] ?? 1));
  const addOnTiB = vsan ? Math.max(0, ceil(rawTiB - entitledTiB)) : 0;
  return {
    platform: s.platform,
    sockets,
    coresPerCpu,
    evenSplit: Number.isInteger(coresPerCpu),
    physicalCores: s.coresPerHost * s.proposedHosts,
    licensedCoresPerHost,
    licensedCores,
    vsan,
    rawTiB,
    entitledTiB,
    addOnTiB
  };
}
function compute(s) {
  const comps = components(s);
  const totals = comps.reduce(
    (a, c) => ({ nodes: a.nodes + c.nodes, cpu: a.cpu + c.cpu, ram: a.ram + c.ram, disk: a.disk + c.disk }),
    { nodes: 0, cpu: 0, ram: 0, disk: 0 }
  );
  const stretched = s.clusterType !== "Standard";
  const vmsc = s.clusterType === "Stretched (vMSC)";
  const vmCapacity = totals.disk;
  const swap = totals.ram;
  const interim = vmCapacity + swap;
  const redundancy = ceil(interim * (s.storageType === "vSAN-ESA" ? 1.5 : 2));
  const reserve = ceil(redundancy * (1 + s.reservePct / 100));
  const growth = isVsan(s.storageType) ? ceil(reserve * (1 + s.growthPct / 100)) : ceil(interim * (1 + s.growthPct / 100));
  const raw = stretched && !vmsc && isVsan(s.storageType) ? growth * 2 : growth;
  const n = s.proposedHosts;
  const perHostRaw = s.capacityDisksPerHost * s.capacityDiskSizeGb;
  const storageAvailable = isVsan(s.storageType) ? perHostRaw * n : s.externalStorageGb;
  const workbookHosts = s.platform === "VVF" ? vvfHostCount(s, totals) : workbookHostCount(s, comps);
  let requiredHosts = workbookHosts;
  const hostsForStorage = isVsan(s.storageType) && perHostRaw > 0 ? ceil(raw / perHostRaw) : 0;
  requiredHosts = Math.max(requiredHosts, hostsForStorage);
  if (stretched) requiredHosts = Math.max(vmsc ? 2 : 8, requiredHosts + requiredHosts % 2);
  const perHostN1 = n > 1 ? { cpu: ceil(totals.cpu / (n - 1) / s.cpuOver), ram: ceil(totals.ram / (n - 1) / s.ramOver), storage: ceil(raw / (n - 1)) } : null;
  const survivorHosts = stretched ? Math.floor(n / 2) : Math.max(0, n - 1);
  const survivorBasis = stretched ? "one AZ down, N/2" : "N-1";
  const dim = (required, available) => ({
    required,
    available,
    fits: available >= required && required >= 0,
    headroomPct: required > 0 ? (available / required - 1) * 100 : Infinity
  });
  const cpu = dim(totals.cpu, survivorHosts * s.coresPerHost * s.cpuOver);
  const ram = dim(totals.ram, survivorHosts * s.ramPerHost * s.ramOver);
  const storage = dim(raw, storageAvailable);
  const hosts = dim(requiredHosts, n);
  const named = [["CPU", cpu], ["RAM", ram], ["storage", storage], ["host count", hosts]];
  const overall = named.every(([, x]) => x.fits);
  const binding = named.reduce((min, cur) => cur[1].headroomPct < min[1].headroomPct ? cur : min)[0];
  return {
    components: comps,
    totals,
    vsan: { vmCapacity, swap, interim, redundancy, reserve, growth, raw },
    workbookHosts,
    requiredHosts,
    derived: deriveMgmtSizes(s),
    workers: vcfmsWorkers(s),
    perHostRaw,
    storageAvailable,
    survivorHosts,
    survivorBasis,
    perHostN1,
    fit: { cpu, ram, storage, hosts, overall, binding }
  };
}
export {
  LICENSE_MIN_CORES_PER_CPU,
  LOGS_REPLICA_MAX,
  OPTIONS,
  VSAN_TIB_PER_CORE,
  VVF_SERVICES_PROFILE,
  WORKBOOK_REVISION,
  components,
  compute,
  defaultState,
  deploymentSizeOptions,
  deriveMgmtSizes,
  licensing,
  logsReplicaMin,
  logsSizeOptions,
  migrateState,
  supervisorEdgeWarning,
  vcfAutomationNodes,
  vcfmsWorkers,
  vvfHostCount,
  vvfOpsNodes,
  workbookHostCount
};
