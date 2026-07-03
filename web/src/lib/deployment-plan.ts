// Structured mirror of docs/06-deployment-plan.md, used by the interactive
// export tool (src/pages/tools/deployment-plan.astro). The markdown doc stays
// the human-readable source of truth; keep this in sync when it changes.
//
// Planning epics run E1 (network/DNS plan) → E2 (intake & sizing) → E3
// (workbook/JSON) → E4 (prerequisites & readiness gate, the go/no-go verify) →
// E5 (bring-up). Core epics E1–E6 and E10 always apply. On top, the selection adds:
//   - E7  when the management domain is stretched
//   - E8  when the Day-2 fleet is deployed
//   - one E9 epic per workload domain (each independently non-stretched or
//     stretched — a stretched WLD gets its own hosts and its own vSAN witness)
// Epic ids follow execution order: E1–E6 → E7? → E8? → each WLD (E9) → E10.

// Public helper repo for imaging + commissioning ESXi hosts, referenced from
// every host-prep story.
export const HOST_PREP_REPO = 'https://github.com/pauldiee/VCFHostPreparation';

export interface Story {
  id: string; // e.g. "1.1"
  title: string;
  tasks: string[];
  acceptance?: string;
}

export interface Epic {
  id: string; // e.g. "E1"
  title: string;
  owner: string;
  ref?: string;
  stories: Story[];
}

export interface Wld {
  name: string;
  stretched: boolean;
  supervisor: boolean;
}

export type AutomationPlacement = 'shared' | 'dedicated' | 'overlay' | 'vlan';
export type AutomationModel = 'single' | 'ha';
export type NsxConnectivity = 'centralized' | 'distributed';
export type SupervisorSize = 'Small' | 'Medium' | 'Large';
export type StorageType = 'vsan-esa' | 'vsan-osa' | 'nfs' | 'fc';

export interface AutomationChoice {
  deploy: boolean;
  model: AutomationModel;
  placement: AutomationPlacement;
  aviLb: boolean;
}

export interface Selection {
  connectivity: NsxConnectivity;
  storage: StorageType;
  supervisorSize: SupervisorSize;
  mgmtStretched: boolean;
  day2: boolean;
  automation: AutomationChoice;
  wlds: Wld[];
}

export function defaultSelection(): Selection {
  // Common build: Centralized connectivity, single non-stretched WLD + Day-2 fleet
  // (VCF Automation on the shared management network, no Avi), management not stretched.
  return {
    connectivity: 'centralized',
    storage: 'vsan-esa',
    supervisorSize: 'Small',
    mgmtStretched: false,
    day2: true,
    automation: { deploy: true, model: 'single', placement: 'shared', aviLb: false },
    wlds: [{ name: 'wld01', stretched: false, supervisor: false }],
  };
}

/** NSX connectivity models (mirrors the workbook's Transit Gateway type). */
export const NSX_CONNECTIVITY: { value: NsxConnectivity; label: string }[] = [
  { value: 'centralized', label: 'Centralized (Edge cluster + BGP)' },
  { value: 'distributed', label: 'Distributed (VNA cluster)' },
];

/** vSphere Supervisor control-plane sizes. */
export const SUPERVISOR_SIZES: SupervisorSize[] = ['Small', 'Medium', 'Large'];

/** Principal storage types (mirrors the workbook's Storage Type). */
export const STORAGE_TYPES: { value: StorageType; label: string; prereq: string; bringup: string }[] = [
  { value: 'vsan-esa', label: 'vSAN ESA', prereq: 'all-flash NVMe (TLC) capacity, single storage pool; 25 GbE NICs recommended', bringup: 'vSAN ESA datastore' },
  { value: 'vsan-osa', label: 'vSAN OSA', prereq: 'all-flash cache + capacity disk groups (OSA); 10/25 GbE', bringup: 'vSAN OSA datastore' },
  { value: 'nfs', label: 'NFS (external)', prereq: 'external NFSv3 storage + the NFS network/VLAN; no local vSAN disks required', bringup: 'external NFS datastore (principal storage)' },
  { value: 'fc', label: 'VMFS on Fibre Channel', prereq: 'FC HBAs, SAN zoning, and LUNs presented to the hosts; no local vSAN disks required', bringup: 'external VMFS-on-FC datastore (principal storage)' },
];

/** VCF Automation network placements (mirrors docs/05-day2-deployments.md §C). */
export const AUTOMATION_PLACEMENTS: { value: AutomationPlacement; label: string; text: string }[] = [
  { value: 'shared', label: 'Shared Management Network', text: 'nodes come from the management /29 (intake B5); simplest, no new network to build' },
  { value: 'dedicated', label: 'Dedicated Management Network', text: 'build the dedicated vDS port group / VLAN first; Cloud Proxy stays on the VM-Management network' },
  { value: 'overlay', label: 'NSX Overlay Segment', text: 'needs an NSX Edge cluster + Tier-0 (BGP) + Tier-1 and the overlay segment first; Cloud Proxy stays on VM-Management' },
  { value: 'vlan', label: 'NSX VLAN Segment', text: 'deploy on an NSX VLAN-backed segment (no overlay / Edge routing)' },
];

/** VCF Automation deployment models — an HA cluster needs a load balancer. */
export const AUTOMATION_MODELS: { value: AutomationModel; label: string }[] = [
  { value: 'single', label: 'Single-node' },
  { value: 'ha', label: 'HA cluster' },
];

const AVI_LB_URL =
  'https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer-vmware-cloud-foundation/9-1/build-and-deploy-avi-91/deploy-avi-load-balancer-from-vcf-operations.html';

// ---- Core epics (always) ---------------------------------------------------
// Selection-driven: E6 story 6.1 adapts to the NSX connectivity model.

function coreEpics(sel: Selection): Epic[] {
  const distributed = sel.connectivity === 'distributed';
  const storage = STORAGE_TYPES.find((s) => s.value === sel.storage) ?? STORAGE_TYPES[0];
  return [
  {
    id: 'E1',
    title: 'Network, DNS & routing plan',
    owner: 'Network + AD/DNS/NTP',
    ref: '01-network-dns-plan.md',
    stories: [
      { id: '1.1', title: 'VLAN / subnet plan', tasks: ['Lock every management VLAN, subnet, MTU, gateway, and the IP carve-out.'], acceptance: 'One-page plan signed by the network owner; every VLAN/subnet/gateway/MTU recorded and no overlapping subnets.' },
      { id: '1.2', title: 'BGP plan', tasks: ['Edge AS, ToR AS, peer IPs, BFD, advertised/received routes — plus an optional MD5 password only if you enable BGP authentication.'], acceptance: 'Edge AS, ToR AS, peer IPs, BFD, and advertised/received routes agreed and documented with the fabric team. (BGP MD5 is optional — capture a password only if authentication is enabled; VCF/NSX requires just the neighbor IP + remote AS.)' },
      { id: '1.3', title: 'DNS & NTP records', tasks: ['All A + PTR records created; NTP sources confirmed.'], acceptance: 'Forward (A) + reverse (PTR) records created for every planned appliance FQDN and resolving both ways; NTP sources reachable and serving.' },
      { id: '1.4', title: 'Certificates', tasks: ['CA type (Microsoft CA or OpenSSL; external CA is CSR-based only — VCF will not import an externally-created cert+key), template, and signing approach decided.'], acceptance: 'CA reachable; signing method and certificate template chosen, with a test issuance succeeding.' },
    ],
  },
  {
    id: 'E2',
    title: 'Intake & sizing',
    owner: 'Architect + all role teams',
    ref: '02-customer-intake.md, 04-sizing.md',
    stories: [
      { id: '2.1', title: 'Role-based intake complete', tasks: ['Sections A–F answered by their owners.'], acceptance: 'Every intake question answered or explicitly marked N/A by its owner.' },
      { id: '2.2', title: 'Sizing & host fit', tasks: ['Run the sizing calculator; confirm the fleet fits the proposed hosts at N-1.'], acceptance: 'Sizing fit-check passes at N-1 (or hosts adjusted); sizing signed off by the architect.' },
    ],
  },
  {
    id: 'E3',
    title: 'Workbook & deployment-JSON prep',
    owner: 'Architect + Platform',
    ref: 'workbook-cell-mapping.md',
    stories: [
      { id: '3.1', title: 'Fill the P&P workbook', tasks: ["Transfer intake answers into the official workbook — or use Coscia's VCF Planner (https://vcfplanning.lcoscia.fr/) for an easier fillable form with live validation that also doubles as an as-built record (JSON/Markdown/CSV export)."], acceptance: "Workbook complete with no red validation warnings (or the equivalent complete in Coscia's Planner)." },
      { id: '3.2', title: 'Generate the deployment JSON', tasks: ['Produce the bring-up JSON (e.g. VCF.JSONGenerator) from the filled workbook.'], acceptance: 'Deployment JSON generated, schema-valid, and reviewed against the plan.' },
    ],
  },
  {
    id: 'E4',
    title: 'Prerequisites & readiness gate',
    owner: 'Architect + Customer',
    ref: 'prerequisites.md',
    stories: [
      {
        id: '4.1',
        title: 'Hardware ready',
        tasks: ['Hosts on the VCG, matched spec, BOM confirmed.', 'Confirm CPU/RAM/storage per host against the sizing output (E2).', `Storage — ${storage.label}: ${storage.prereq}.`],
        acceptance: 'All hosts on the Broadcom compatibility guide, identical spec; host count meets the cluster minimum (with an even per-AZ split if the cluster will be stretched).',
      },
      {
        id: '4.2',
        title: 'Physical network ready',
        tasks: [
          'Trunk the required VLANs to host uplinks; set MTU 9000 on jumbo networks.',
          'Configure the ToR BGP fabric (AS numbers, peer IPs) for the NSX edges.',
        ],
        acceptance: 'Required VLANs trunked with MTU 9000 on the jumbo networks; ToR BGP fabric up; all verified against the network plan (E1).',
      },
      {
        id: '4.3',
        title: 'Core services ready',
        tasks: ['AD, DNS, NTP, CA, depot reachable (open the firewall flows — see 07-firewall-ports.md).'],
        acceptance: 'Forward (A) and reverse (PTR) DNS resolves both ways for every management/fleet FQDN — ESXi hosts, vCenter, SDDC Manager, NSX Manager VIP + the 3 nodes, NSX Edge nodes (and any Day-2 fleet appliances: VCF Operations, Automation, Logs, Identity Broker); NTP in sync; CA reachable; depot/binaries staged.',
      },
      {
        id: '4.4',
        title: 'Access & final readiness',
        tasks: ['A jump/bastion host reaches the management network, and out-of-band (iDRAC / iLO / BMC) access to the hosts is available.'],
        acceptance: 'The build team can reach the management network and host consoles; and the full prerequisites checklist (prerequisites.md — hardware, network, AD, DNS, NTP, CA, depot) is green before bring-up starts.',
      },
    ],
  },
  {
    id: 'E5',
    title: 'Management domain bring-up',
    owner: 'Platform',
    stories: [
      {
        id: '5.1',
        title: 'Install & configure the management hosts',
        tasks: [
          `Image each host with the supported ESXi ISO (see the VCFHostPreparation repo — ${HOST_PREP_REPO} — to prep + commission hosts quickly); set the management VMkernel (IP / gateway / VLAN), DNS, NTP, and root password; confirm the ESXi build matches the BOM.`,
        ],
        acceptance: 'Every host reachable on the management network with the matched ESXi build; DNS + NTP correct.',
      },
      {
        id: '5.2',
        title: 'Stage the VCF Installer',
        tasks: [
          'Deploy the Installer on a management-domain host using the IP + FQDN planned for SDDC Manager (it switches into SDDC Manager at bring-up, not a throwaway IP); verify it reaches the ESXi management network.',
          'On that host, put the Installer on a port group carrying the VM Management VLAN. A fresh ESXi host\'s default "VM Network" port group is untagged (VLAN 0), so if VM Management is a tagged VLAN, set the VLAN ID on it (or use a tagged port group) first — otherwise the appliance has no management connectivity.',
        ],
        acceptance: 'VCF Installer deployed on the VM-Management VLAN, resolves in DNS on the planned SDDC Manager FQDN, and reaches the ESXi management network.',
      },
      {
        id: '5.3',
        title: 'Deploy the management domain',
        tasks: [
          `Run bring-up: the Installer validates the prepared hosts, then builds vCenter, SDDC Manager, NSX, VCF Operations, and the ${storage.bringup}; submit the JSON.`,
          'VCF Operations is deployed AT bring-up in VCF 9.1 (not Day-2 — only VCF Automation can be deferred). Decide its cluster address up front: floating IP (default) or an external load-balancer VIP — VCF never provides the LB for Operations, so provision an external LB and add its FQDN to the cert SAN first if you want a VIP.',
        ],
        acceptance: `Bring-up completes; vCenter, SDDC Manager, NSX, and VCF Operations healthy; ${storage.label} datastore online.`,
      },
      {
        id: '5.4',
        title: 'Deploy VCF Management Services, License Server & Cloud Proxy',
        tasks: [
          'These are NOT part of the automatic bring-up. Once VCF Operations + SDDC Manager are up, deploy them via VCF Operations (its UI, or the SDDC Manager API for custom VLAN-backed placement to avoid IP exhaustion): VCF Management Services (VCF services runtime, fleet and SDDC lifecycle, software depot, telemetry), the License Server, and the Cloud Proxy collector as needed.',
          'The License Server needs a unique FQDN resolving to an IP outside the VCF services-runtime range (IPv4 only). The Cloud Proxy stays on the VM-Management network and needs ports 443 / 4505 / 4506 to VCF Operations (see 07-firewall-ports.md). Licenses are applied fleet-wide later (E8 8.4).',
        ],
        acceptance: 'VCF Management Services + License Server deployed and healthy; the License Server FQDN resolves to an IP outside the services-runtime range; Cloud Proxy (if used) is collecting.',
      },
    ],
  },
  {
    id: 'E6',
    title: 'Management domain configuration',
    owner: 'Platform + Network + Security',
    stories: [
      distributed
        ? { id: '6.1', title: 'NSX north-south (Distributed connectivity)', tasks: ['Configure Distributed connectivity: the Distributed Transit Gateway distributes routing to the hypervisors (no centralized Edge cluster). Deploy the Virtual Network Appliance (VNA) cluster for stateful services (NAT etc.) and the external network for the Distributed Transit Gateway.'], acceptance: 'Distributed Transit Gateway up; VNA cluster healthy; north-south (incl. stateful services) reachable.' }
        : { id: '6.1', title: 'NSX north-south (Centralized connectivity)', tasks: ['Deploy the NSX Edge cluster + Tier-0 gateway; establish BGP peering to the ToRs; verify north-south routes.'], acceptance: 'Edge cluster + Tier-0 deployed; BGP peering to the ToRs established; north-south routes advertised and reachable.' },
      {
        id: '6.2',
        title: 'Certificates (optional / partial here)',
        tasks: [
          'Optional here: you can replace certificates for the components deployed so far, but the full CA-signed replacement is usually done once all components exist — after the Day-2 fleet — so the whole fleet is certified in one pass (see E8 story 8.4).',
        ],
      },
      {
        id: '6.3',
        title: 'Identity & roles (optional, not recommended here)',
        tasks: [
          'Optional and not recommended at this stage: you can bind vCenter SSO directly to AD/LDAP for early management access, but the recommended approach is fleet-wide SSO via the VCF Identity Broker (a Day-2 component; see E8 / 05-day2-deployments.md). Prefer deferring identity to Day-2; only bind vCenter SSO here if you genuinely need AD admin access before the fleet is up, then map admin/operator/viewer groups.',
        ],
      },
      {
        id: '6.4',
        title: 'Backup & lifecycle',
        tasks: ['Configure SFTP backups; connect the depot for fleet lifecycle (SDDC Manager already has its own depot from bring-up — this is the fleet-wide LCM depot, not a re-do).'],
        acceptance: 'A test SFTP backup completes; fleet-lifecycle depot connected. (North-south routing is verified in 6.1; certificates, identity & licensing are finalized Day-2 — see E8 8.4.)',
      },
    ],
  },
  ];
}

// ---- Management-domain stretch (E7) ----------------------------------------
// Stretch sequence is kept consistent with a stretched WLD (E9):
// fabric/networks → commission second-AZ hosts → witness → stretch.

const E7_MGMT_STRETCH: Epic = {
  id: 'E7',
  title: 'Stretch the management domain',
  owner: 'Network + Architect + Storage',
  ref: '03-multi-az-prep.md',
  stories: [
    {
      id: '7.1',
      title: 'Inter-AZ fabric',
      tasks: ['Verify <5 ms RTT, ≥10 Gbps, MTU 9000, HA L3 gateway between AZs.'],
      acceptance: 'Inter-AZ link measured under 5 ms RTT, at least 10 Gbps, MTU 9000 end-to-end; HA L3 gateway between AZs verified.',
    },
    {
      id: '7.2',
      title: 'Install, configure & commission the second-AZ hosts',
      tasks: [
        `Image the AZ2 management hosts with the supported ESXi ISO (see the VCFHostPreparation repo — ${HOST_PREP_REPO} — to prep + commission hosts quickly); configure the per-AZ management network (IP / VLAN / gateway), DNS, NTP, and root; then commission them into SDDC Manager, ready for the stretch.`,
      ],
      acceptance: 'AZ2 hosts reachable on their per-AZ management network with the matched ESXi build; commissioned and available in SDDC Manager.',
    },
    {
      id: '7.3',
      title: 'Witness site (management)',
      tasks: ['Deploy the vSAN witness appliance for the management cluster at the third site (its own — a vSAN witness serves only one stretched cluster); route it to both AZ ESX-management networks.'],
      acceptance: 'Management witness appliance deployed at the third site and reachable from both AZ ESX-management networks.',
    },
    {
      id: '7.4',
      title: 'Stretch the cluster',
      tasks: [
        'SDDC Manager does the stretch for you: submit a stretch JSON spec via the SDDC Manager API and VCF builds the fault domains (AZ1 preferred / AZ2 secondary / witness), balances hosts across the AZs, and flips the datastore storage policy to site mirroring (stretched, ~2× capacity). You just supply the inputs from 7.1–7.3: an AZ2 network pool, the commissioned AZ2 hosts (equal count per AZ), and the witness. It will not stretch if the cluster shares a vSAN storage policy with another cluster, has DPU-backed hosts, or has L3-different subnets within an AZ. Ref: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/stretching-clusters.html and 03-multi-az-prep.md.',
      ],
      acceptance: 'SDDC Manager reports the cluster stretched; vSAN healthy and storage-policy compliant (site mirroring); isolating one AZ keeps VMs running on the surviving site.',
    },
  ],
};

// ---- Day-2 fleet (E8) ------------------------------------------------------

// Day-2 fleet epic — the VCF Automation story (8.2) is generated from the
// selection's automation choices (deploy? / network placement / Avi LB).
function day2Epic(sel: Selection): Epic {
  const a = sel.automation;
  let automationStory: Story;
  if (!a.deploy) {
    automationStory = {
      id: '8.2',
      title: 'VCF Automation (deferred — not deployed)',
      tasks: ['VCF Automation is deferred at this Day-N pass (it is the one fleet component you can skip from bring-up to Day-N). Deploy it later when needed.'],
    };
  } else {
    const p = AUTOMATION_PLACEMENTS.find((x) => x.value === a.placement) ?? AUTOMATION_PLACEMENTS[0];
    const ha = a.model === 'ha';
    const modelText = ha ? 'HA cluster (nodes behind a load-balancer VIP)' : 'single-node (no load balancer needed)';
    const tasks = [
      `Deploy via SDDC Manager API or via VCF Operations as a ${modelText}. Network placement: ${p.label} — ${p.text} (see 05-day2-deployments.md section C). Set the services-runtime cluster CIDR.`,
    ];
    if (ha && !a.aviLb) {
      tasks.push('An HA-cluster VCF Automation needs a load balancer for its cluster VIP — enable the Avi LB option (or provide an external LB).');
    }
    if (a.aviLb) {
      tasks.push(
        `Load-balance VCF Automation with an Avi Load Balancer deployed in the management domain (lifecycle-managed via VCF Operations); deploy the Avi controller cluster first. See Broadcom Deploy Avi Load Balancer from VCF Operations: ${AVI_LB_URL}`
      );
    }
    automationStory = {
      id: '8.2',
      title: `VCF Automation (${p.label}${ha ? ', HA' : ''}${a.aviLb ? ' + Avi LB' : ''})`,
      tasks,
      acceptance: `VCF Automation deployed and healthy (${ha ? 'HA cluster' : 'single-node'}) on the ${p.label}; services-runtime cluster CIDR set and non-overlapping${a.aviLb ? '; Avi LB fronting the cluster' : ''}.`,
    };
  }
  return {
    id: 'E8',
    title: 'Day-2 fleet deployment',
    owner: 'Platform',
    ref: '05-day2-deployments.md',
    stories: [
      { id: '8.1', title: 'Network placement', tasks: ['Decide Shared / Dedicated / NSX Overlay / NSX VLAN Segment for the Day-2 components; build the network if non-shared.'], acceptance: 'Chosen placement built (or the shared network confirmed); the segment/VLAN is reachable and the fleet FQDNs resolve.' },
      automationStory,
      { id: '8.3', title: 'Log Management, Operations for Networks & Identity Broker', tasks: ['Deploy the remaining fleet components as needed: Log Management, VCF Operations for Networks, and the Identity Broker.'], acceptance: 'Each deployed Day-2 component healthy; the fleet-management health (synthetic) check passes.' },
      {
        id: '8.4',
        title: 'Certificates, identity & licensing (full fleet)',
        tasks: [
          'Now that all components exist, do the full CA-signed certificate replacement across the whole fleet in one pass, complete fleet SSO via the VCF Identity Broker (the recommended identity path, deferred from E6 6.3 — prep the AD/LDAP identity source and its gotchas first: see prerequisites.md, Identity source for the VCF Identity Broker), and apply licensing across the fleet (via VCF Operations).',
        ],
        acceptance: 'Every fleet endpoint presents a CA-signed cert with no trust warnings; AD/LDAP SSO via the Identity Broker works; licensing applied.',
      },
    ],
  };
}

// ---- Validation & handover (E10, always last) ------------------------------

const E10_HANDOVER: Epic = {
  id: 'E10',
  title: 'Validation & handover',
  owner: 'Architect + all teams',
  stories: [
    { id: '10.1', title: 'Health check', tasks: ['Run a post-deploy health check of the live environment.'], acceptance: 'Post-deploy health check run; no critical findings (or all triaged).' },
    { id: '10.2', title: 'As-built', tasks: ['Capture the as-built (FQDNs, IPs, VLANs, passwords in the secret store).'], acceptance: 'As-built captured — FQDNs, IPs, VLANs recorded; passwords stored in the secret store.' },
    { id: '10.3', title: 'Handover', tasks: ['Walk the customer through operations and hand over.'], acceptance: 'Health check clean; as-built delivered; customer sign-off received.' },
  ],
};

// ---- Per-WLD epic (E9), non-stretched or stretched -------------------------

function wldEpicId(index: number): string {
  return index === 0 ? 'E9' : `E9-${index + 1}`;
}

function wldEpic(w: Wld, index: number, connectivity: NsxConnectivity, supervisorSize: SupervisorSize): Epic {
  const name = (w.name || `wld${index + 1}`).trim();
  const id = wldEpicId(index);
  const hostPrep = `see the VCFHostPreparation repo — ${HOST_PREP_REPO} — to prep + commission hosts quickly`;
  const connText =
    connectivity === 'distributed'
      ? 'Distributed connectivity — Distributed Transit Gateway + VNA cluster (stateful services / NAT)'
      : 'Centralized connectivity — NSX Edges / uplinks (Tier-0 + BGP)';
  // Supervisor no longer floats in the connectivity story — it becomes its own
  // story below when enabled for this WLD.
  const connStory = (sid: string): Story => ({
    id: sid,
    title: 'WLD connectivity',
    tasks: [`${connText}.`],
    acceptance: 'WLD healthy in SDDC Manager; north-south reachable; workloads can be placed.',
  });

  const stories: Story[] = w.stretched
    ? [
        { id: '9.1', title: 'WLD network prep (per-AZ)', tasks: ['Provision the per-WLD VLANs/subnets across both AZs (per-AZ networks) and the 5 IPs the WLD consumes on the mgmt VM-mgmt subnet.'], acceptance: 'Per-WLD VLANs/subnets provisioned across both AZs; the 5 mgmt-subnet IPs reserved; DNS in place.' },
        {
          id: '9.2',
          title: 'Prepare & commission the WLD hosts (both AZs)',
          tasks: [`Image the WLD hosts in both AZs with the supported ESXi ISO (${hostPrep}); configure the per-AZ management networks, DNS, NTP; then commission them into SDDC Manager.`],
          acceptance: 'WLD hosts in both AZs reachable, matched ESXi build, commissioned in SDDC Manager.',
        },
        { id: '9.3', title: 'Deploy the WLD', tasks: ['vCenter + NSX (shared or dedicated) + first cluster.'], acceptance: 'WLD deployed; its vCenter + NSX healthy; first cluster online in SDDC Manager.' },
        {
          id: '9.4',
          title: 'WLD witness',
          tasks: ['Deploy a dedicated vSAN witness appliance for THIS WLD at the third site. A witness serves only ONE stretched cluster, so each stretched WLD needs its own, separate from the management witness (the shared-witness feature is 2-node-cluster only, not stretched). Route it to both AZ ESX-management networks.'],
          acceptance: 'Dedicated WLD witness deployed at the third site and reachable from both AZ ESX-management networks.',
        },
        {
          id: '9.5',
          title: 'Stretch the WLD cluster',
          tasks: [
            "SDDC Manager stretches it for you, same as the management stretch — a JSON spec via the SDDC Manager API builds the fault domains, balances the per-AZ hosts, and sets the site-mirroring storage policy. Supply the AZ2 network pool, the commissioned WLD hosts (equal per AZ), and this WLD's witness. The management domain must already be stretched (E7) before any workload-domain cluster can be stretched. Edge stretched only under NSX Centralized connectivity. Ref: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/building-your-private-cloud-infrastructure/stretching-clusters.html.",
          ],
          acceptance: 'SDDC Manager reports the WLD stretched; vSAN healthy and storage-policy compliant (site mirroring); isolating one AZ keeps VMs running on the surviving site.',
        },
        connStory('9.6'),
      ]
    : [
        { id: '9.1', title: 'WLD network prep', tasks: ['Provision the per-WLD VLANs/subnets (Step 1) and the 5 IPs the WLD consumes on the mgmt VM-mgmt subnet.'], acceptance: 'Per-WLD VLANs/subnets provisioned; the 5 mgmt-subnet IPs reserved; DNS in place.' },
        {
          id: '9.2',
          title: 'Prepare & commission the WLD hosts',
          tasks: [`Image the WLD hosts with the supported ESXi ISO (${hostPrep}); configure the management network, DNS, NTP; then commission them into SDDC Manager.`],
          acceptance: 'WLD hosts reachable, matched ESXi build, commissioned in SDDC Manager.',
        },
        { id: '9.3', title: 'Deploy the WLD', tasks: ['vCenter + NSX (shared or dedicated) + first cluster.'], acceptance: 'WLD deployed; its vCenter + NSX healthy; first cluster online in SDDC Manager.' },
        connStory('9.4'),
      ];

  if (w.supervisor) {
    const connPrereq =
      connectivity === 'distributed'
        ? 'Distributed — the NSX VPC workflow + VNA cluster'
        : 'Centralized — the Edge cluster + Tier-0 gateway';
    stories.push({
      id: `9.${stories.length + 1}`,
      title: 'Enable vSphere Supervisor',
      tasks: [
        `Prerequisites first: the WLD north-south connectivity is in place (${connPrereq}) and the Avi Load Balancer controller cluster is deployed — Supervisor activation requires the load balancer.`,
        `Enable vSphere Supervisor with a ${supervisorSize} control plane; provide the Supervisor management network, API-server FQDN(s), and the workload / service CIDRs.`,
      ],
      acceptance: 'Supervisor enabled and Ready; the control plane is reachable on its VIP; namespaces can be created.',
    });
  }

  return {
    id,
    title: `Workload domain: ${name}${w.stretched ? ' (stretched)' : ''}${w.supervisor ? ' + Supervisor' : ''}`,
    owner: `Platform + Network${w.stretched ? ' + Storage' : ''}`,
    ref: w.stretched ? '02-customer-intake.md section H, 03-multi-az-prep.md' : '02-customer-intake.md section H',
    stories,
  };
}

// ---- Assembly --------------------------------------------------------------

/** The epics that apply given a selection, in execution order. */
export function selectedEpics(sel: Selection): Epic[] {
  const out: Epic[] = coreEpics(sel);
  if (sel.mgmtStretched) out.push(E7_MGMT_STRETCH);
  if (sel.day2) out.push(day2Epic(sel));
  sel.wlds.forEach((w, i) => out.push(wldEpic(w, i, sel.connectivity, sel.supervisorSize)));
  out.push(E10_HANDOVER);
  return out;
}

/** Human-readable scope label. */
export function typeLabel(sel: Selection): string {
  const parts: string[] = [`management${sel.mgmtStretched ? ' (stretched)' : ''}`];
  if (sel.day2) parts.push('Day-2 fleet');
  if (sel.wlds.length) {
    const n = sel.wlds.length;
    const stretched = sel.wlds.filter((w) => w.stretched).length;
    const stretchNote = stretched ? `, ${stretched} stretched` : '';
    parts.push(`${n} workload domain${n === 1 ? '' : 's'}${stretchNote}`);
  }
  return parts.join(' + ');
}

/** Comma-list of included epic ids, e.g. "E1–E6, E7, E8, E9, E10". */
export function includedEpicList(sel: Selection): string {
  return selectedEpics(sel)
    .map((e) => e.id)
    .join(', ')
    .replace('E1, E2, E3, E4, E5, E6', 'E1–E6');
}

// ---- Exporters -------------------------------------------------------------

export function buildMarkdown(sel: Selection): string {
  const L: string[] = [];
  L.push('# VCF 9.1 Deployment Plan');
  L.push('');
  L.push(`**Scope:** ${typeLabel(sel)}`);
  L.push(`**Epics included:** ${includedEpicList(sel)}`);
  L.push('');
  for (const e of selectedEpics(sel)) {
    L.push(`## ${e.id} — ${e.title}  ·  Owner: ${e.owner}`);
    if (e.ref) L.push(`Ref: ${e.ref}`);
    L.push('');
    for (const s of e.stories) {
      L.push(`- **Story ${s.id} — ${s.title}.**`);
      for (const t of s.tasks) L.push(`  - ${t}`);
      if (s.acceptance) L.push(`  - _Acceptance:_ ${s.acceptance}`);
    }
    L.push('');
  }
  L.push('_Generated with the ITQ VCF 9.1 deployment-plan export tool._');
  return L.join('\n');
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Flat CSV for backlog import (Jira / Azure DevOps / GitLab). One row per epic,
 * story, and task; `Parent` references the parent row's Summary so importers can
 * rebuild the epic → story → task hierarchy.
 */
export function buildCsv(sel: Selection): string {
  const header = ['Issue Type', 'Summary', 'Parent', 'Owner', 'Acceptance Criteria', 'Reference'];
  const rows: string[][] = [header];
  for (const e of selectedEpics(sel)) {
    const epicSummary = `${e.id} ${e.title}`;
    rows.push(['Epic', epicSummary, '', e.owner, '', e.ref ?? '']);
    for (const s of e.stories) {
      const storySummary = `${e.id}.${s.id.split('.').pop()} ${s.title}`;
      rows.push(['Story', storySummary, epicSummary, e.owner, s.acceptance ?? '', '']);
      for (const t of s.tasks) {
        rows.push(['Task', t, storySummary, '', '', '']);
      }
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}
