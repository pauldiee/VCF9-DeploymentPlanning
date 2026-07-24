// Scope-driven verification test plan for a VCF 9.1 deployment, used by the
// interactive tool (src/pages/tools/test-plan.astro).
//
// It consumes the SAME `Selection` as deployment-plan.ts, so the scope you build
// in the export tool decides which cases apply. Every case names the epic and
// story it proves, so the plan and the test plan stay legible against each other:
//
//   TP-0 Readiness   → E1–E4   (the pre-bring-up gate)
//   TP-1 Bring-up    → E5
//   TP-2 Mgmt config → E6
//   TP-3 Stretch     → E7      (management domain, and per stretched WLD)
//   TP-4 Day-2 fleet → E8
//   TP-5 Workload    → E9      (repeated per workload domain)
//   TP-6 Handover    → E10
//
// Case ids are STABLE: they are assigned in the catalogue below, not generated
// from the current scope, so narrowing the scope never renumbers the cases that
// remain. Per-WLD cases are keyed `<id>#<wld index>` so each domain tracks its
// own result.
//
// All case text here is original. It is informed by what a VCF 9.1 deployment
// actually has to prove, and deliberately covers the things the vendor
// verification material leaves out: the pre-bring-up readiness gate, distributed
// (Transit Gateway / VNA) connectivity, stretched clusters, backup, License Hub
// and Avi, non-vSAN principal storage, and Supervisor beyond "the VMs booted".

import {
  aviInScope,
  includedEpicList,
  isVsanStorage,
  licenseHubNeeded,
  normalizeSelection,
  typeLabel,
  type Selection,
  type Wld,
} from './deployment-plan';

/** Result of a single executed case. Mirrors the four states a verification sheet uses. */
export type TestStatus = 'P' | 'F1' | 'F2' | 'NA';

export const TEST_STATUSES: { value: TestStatus; label: string; hint: string }[] = [
  { value: 'P', label: 'Pass', hint: 'Verified, with evidence filed' },
  { value: 'F1', label: 'Critical fail', hint: 'Blocks the next phase and handover' },
  { value: 'F2', label: 'Non-critical fail', hint: 'Handover proceeds with a named owner and a date' },
  { value: 'NA', label: 'Not applicable', hint: 'Out of scope — record why' },
];

export interface TestCase {
  /** Stable id, e.g. "TP-206". Never renumbered when the scope changes. */
  id: string;
  title: string;
  /** Epic this case proves, e.g. "E6". */
  epic: string;
  /** Story this case proves, e.g. "6.4". */
  story: string;
  /** How to run it. */
  steps: string[];
  /** What "pass" looks like — the only thing that may be ticked P. */
  expected: string;
  /** A failure here blocks the phase gate and handover (status F1). */
  critical?: boolean;
  /** Field note: a trap, a sequencing constraint, or why this case exists at all. */
  note?: string;
}

export interface TestPhase {
  id: string; // "TP-2"
  title: string;
  /** What the phase proves before the next one may start. */
  gate: string;
  /** Deployment-plan epics this phase covers, e.g. "E6". */
  epics: string;
  /** Set when the phase repeats per workload domain. */
  wld?: { index: number; name: string };
  cases: TestCase[];
}

/** Per-case result. Key is `caseKey(phase, case)`. */
export interface TestResult {
  status: TestStatus;
  /** ISO date (yyyy-mm-dd) the case was executed. */
  date: string;
  /** Free text: measured value, evidence reference, or the reason for NA / F2. */
  actual?: string;
}
export type TestResults = Record<string, TestResult>;

/** Stable key for a result. Per-WLD phases append the domain index so each domain tracks separately. */
export function caseKey(phase: TestPhase, c: TestCase): string {
  return phase.wld ? `${c.id}#${phase.wld.index}` : c.id;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** A catalogue entry: a case plus the condition under which it applies. */
interface Entry extends TestCase {
  /** Omitted = always in scope for its phase. */
  when?: (sel: Selection) => boolean;
}
/** Per-WLD catalogue entry — the condition sees the domain as well as the fleet scope. */
interface WldEntry extends TestCase {
  when?: (w: Wld, sel: Selection) => boolean;
}

const isCentral = (sel: Selection) => sel.connectivity === 'centralized';
const isDistrib = (sel: Selection) => sel.connectivity === 'distributed';
const isVsan = (sel: Selection) => isVsanStorage(sel.storage);
const isExternalStorage = (sel: Selection) => !isVsanStorage(sel.storage);

// --- TP-0 — Readiness (E1–E4) ---------------------------------------------
// Almost all of this is absent from post-deployment verification material,
// which starts once the fleet exists. The readiness gate is where a deployment
// is actually won or lost, so it gets first-class cases.

const TP0: Entry[] = [
  {
    id: 'TP-001',
    title: 'Management VLANs trunked to every host uplink at the planned MTU',
    epic: 'E1',
    story: '1.1 / 4.2',
    critical: true,
    steps: [
      'From the switch side, list the allowed VLANs on each host-facing port and compare against the VLAN table in your network plan.',
      'Confirm the same set is trunked on BOTH uplinks of every host — a VLAN present on one uplink only fails over badly and passes a casual test.',
      'Verify MTU 9000 is set end to end on the jumbo networks (vSAN, vMotion, host overlay) — on the host port, the ToR, and any L3 hop between racks.',
      'Prove the MTU rather than reading the config: from a host, send an unfragmented ping at 8972 bytes payload across each jumbo VLAN to a peer in the other rack.',
    ],
    expected:
      'Every planned VLAN is trunked on both uplinks of every host, and an unfragmented 8972-byte ping succeeds across each jumbo VLAN — including between racks.',
    note: 'An MTU mismatch that only appears on the inter-rack path is the classic cause of a bring-up that stalls at cluster creation.',
  },
  {
    id: 'TP-002',
    title: 'Subnets and IP reservations do not overlap',
    epic: 'E1',
    story: '1.1',
    steps: [
      'List every planned subnet: management, vMotion, vSAN/storage, host overlay, edge/uplink or external, and the fleet component ranges.',
      'Check for overlap between them, and against anything already routed on the customer network — including the VCF services-runtime cluster CIDR and, on Distributed connectivity, the private transit-gateway block.',
      'Confirm the static IP carve-outs are reserved in the IPAM system so nobody else is handed one mid-build.',
    ],
    expected:
      'No subnet overlaps another planned subnet or an existing routed network, and every static reservation is recorded in IPAM.',
    note: 'The services-runtime CIDR and the transit-gateway block are internal to VCF but still have to be unique — they are the two most commonly forgotten.',
  },
  {
    id: 'TP-003',
    title: 'ToR BGP fabric is configured and ready to peer',
    epic: 'E1',
    story: '1.2 / 4.2',
    critical: true,
    when: isCentral,
    steps: [
      'With the network team, confirm on the ToRs: the local AS, the neighbour statements for the planned edge uplink IPs, the remote AS, and BFD settings.',
      'If BGP authentication is in scope, confirm the MD5 password is configured and recorded — and that both sides agree on it.',
      'Confirm which prefixes the fabric will accept from the edges, and which it will advertise to them.',
      'Verify the uplink VLANs and their gateway SVIs exist and answer.',
    ],
    expected:
      'ToR-side BGP configuration is complete and waiting on the edges: neighbours defined with the correct remote AS, uplink VLANs live, and the accept/advertise policy agreed in writing.',
    note: 'VCF/NSX only needs the neighbour IP and remote AS — an MD5 password is optional and only required if the fabric enables authentication.',
  },
  {
    id: 'TP-004',
    title: 'External VLAN reaches every host in the domain, and the fabric routes it',
    epic: 'E1',
    story: '1.2 / 4.2',
    critical: true,
    when: isDistrib,
    steps: [
      'Confirm the external VLAN is trunked to EVERY host in the domain — not just to a pair of hosts. There are no edge VMs on this model, so every host participates in north-south.',
      'Confirm the gateway SVI for the external VLAN is configured on the ToRs and answers ARP and ping from a test interface on that VLAN.',
      'Get written confirmation from the fabric team that the routable external IP block is advertised upstream and returns traffic to this gateway.',
      'Trace a route from an address in the external IP block out to a known upstream destination and back.',
    ],
    expected:
      'The external VLAN is present on every host in the domain, its gateway answers, and the external IP block is reachable from upstream in both directions.',
    note: 'On Distributed connectivity there is no Tier-0 — the physical fabric performs the routing NSX would otherwise do. This is a hard gate, not a follow-up, and it is the single most common Distributed-deployment failure.',
  },
  {
    id: 'TP-005',
    title: 'Private transit-gateway block is a /16 and is free',
    epic: 'E1',
    story: '1.2',
    critical: true,
    when: isDistrib,
    steps: [
      'Confirm the planned private transit-gateway block is a /16.',
      'Confirm it does not overlap any routed customer network or any other VCF range.',
    ],
    expected: 'The private transit-gateway block is a /16 and overlaps nothing.',
    note: 'A /24 was accepted in VCF 9.0. In 9.1 it never completes — the deployment hangs rather than erroring clearly, so catch it here.',
  },
  {
    id: 'TP-006',
    title: 'Forward and reverse DNS resolve for every planned FQDN',
    epic: 'E1',
    story: '1.3 / 4.3',
    critical: true,
    steps: [
      'Build the list from the plan: every ESX host, vCenter, SDDC Manager, the NSX Manager VIP and all three nodes, the edge nodes (Centralized) or VNA appliances (Distributed), VCF Operations nodes and any external LB VIP, the Cloud Proxy, the License Server, and every VCF Management Services FQDN — plus any Day-2 appliance FQDNs already known.',
      'For each name, resolve A → IP.',
      'For each IP, resolve PTR → name.',
      'Run the checks from a client on the management network, not only from the DNS server itself.',
    ],
    expected:
      'Every planned FQDN resolves forward to its planned IP, and every planned IP resolves back to the same name. No missing PTR records.',
    note: 'Missing PTR records are the most common single cause of a failed bring-up. Forward-only is not a pass.',
  },
  {
    id: 'TP-007',
    title: 'NTP sources are reachable and serving from the management subnet',
    epic: 'E1',
    story: '1.3 / 4.3',
    critical: true,
    steps: [
      'From a host on the management subnet, query each planned NTP source directly and confirm it answers with a sane stratum and offset.',
      'Confirm the sources agree with each other to within a second.',
      'Confirm UDP 123 is permitted from the management subnet to the sources.',
    ],
    expected: 'Every planned NTP source answers from the management subnet and the sources agree with each other.',
    note: 'Time skew breaks certificate validation and SSO in ways that surface much later as unrelated-looking failures.',
  },
  {
    id: 'TP-008',
    title: 'Certificate authority is reachable and issues from the chosen template',
    epic: 'E1',
    story: '1.4',
    steps: [
      'Confirm the CA type and signing approach match the plan (Microsoft CA or OpenSSL; an external CA is CSR-based only — VCF will not import an externally created certificate plus private key).',
      'Confirm the CA endpoint is reachable from the management network.',
      'Submit a throwaway CSR against the intended template and have it signed.',
      'Inspect the issued certificate: key usage, extended key usage, key size, signature algorithm, and validity period against what the fleet requires.',
    ],
    expected:
      'A test certificate is issued from the intended template and its key usage, key size, and validity match fleet requirements.',
    note: 'Discovering the template is wrong during the fleet-wide replacement (TP-428) costs a day. It costs ten minutes here.',
  },
  {
    id: 'TP-009',
    title: 'Sizing fits the proposed hosts at N-1',
    epic: 'E2',
    story: '2.2',
    steps: [
      'Run the sizing calculation for the agreed component set, including any Day-2 fleet and License Hub footprint.',
      'Compare CPU, memory, and usable capacity against the proposed hosts with ONE host removed from the cluster.',
      'For vSAN, size against usable capacity after the chosen failure tolerance — and after site mirroring if the cluster will be stretched, which roughly doubles consumption.',
    ],
    expected: 'The full component set fits within N-1 host capacity, or the host count/spec has been adjusted and re-signed by the architect.',
  },
  {
    id: 'TP-010',
    title: 'Hosts are on the compatibility guide, identically specified, and meet the cluster minimum',
    epic: 'E4',
    story: '4.1',
    critical: true,
    steps: [
      'Check every host model, CPU, storage controller, and NIC against the Broadcom compatibility guide for the target release.',
      'Confirm firmware and driver levels match the guide, and that all hosts in a cluster carry the same levels.',
      'Confirm CPU, RAM, and disk are identical across the cluster — a mismatched host will be accepted at commission and cause imbalance later.',
      'Confirm host count meets the cluster minimum for the chosen configuration.',
    ],
    expected:
      'Every host is listed on the compatibility guide at its installed firmware/driver level, all hosts in a cluster are identically specified, and the count meets the minimum.',
  },
  {
    id: 'TP-011',
    title: 'Even host split across availability zones',
    epic: 'E4',
    story: '4.1',
    critical: true,
    when: (sel) => sel.mgmtStretched,
    steps: [
      'Confirm the host count divides evenly between AZ1 and AZ2.',
      'Confirm each AZ can independently run the workload the surviving site must carry.',
    ],
    expected: 'Hosts split evenly per AZ, and either AZ alone has the capacity to run the protected workload.',
    note: 'An uneven split is rejected at stretch time, after the hosts have already been racked and commissioned.',
  },
  {
    id: 'TP-012',
    title: 'vSAN disks are present, unclaimed, and eligible',
    epic: 'E4',
    story: '4.1',
    when: isVsan,
    steps: [
      'On each host, confirm the intended devices are visible and carry no existing partitions or stale vSAN metadata.',
      'Confirm the controller is in the required pass-through mode and its firmware/driver combination is on the compatibility guide.',
      'For vSAN ESA, confirm the devices meet the ESA requirements and that the network supports the required bandwidth.',
    ],
    expected: 'Every intended device on every host is visible, unclaimed, and eligible for the chosen vSAN configuration.',
  },
  {
    id: 'TP-013',
    title: 'External principal storage is presented and mountable from every host',
    epic: 'E4',
    story: '4.1',
    critical: true,
    when: isExternalStorage,
    steps: [
      'Confirm the storage network (VLAN, MTU, and for FC the zoning and masking) is provisioned to every host in the cluster.',
      'From EVERY host, mount the NFS export or rescan and see the FC LUN — not just from the first host.',
      'Confirm the same volume presents with the same identifier on every host.',
      'Write and read back a test file or verify multipath state on all paths.',
    ],
    expected:
      'The principal datastore mounts on every host in the cluster with a consistent identifier, and read/write succeeds on all of them.',
    note: 'Vendor verification material is vSAN-only throughout, so external principal storage has no coverage at all — this case exists to close that. Note that an NFS or FC cluster cannot be stretched.',
  },
  {
    id: 'TP-014',
    title: 'Active Directory is reachable and the bind account authenticates',
    epic: 'E4',
    story: '4.3',
    steps: [
      'From the management network, connect to each planned domain controller on the LDAP/LDAPS port.',
      'Bind with the service account and run a search against the planned base DN.',
      'Confirm the account is not subject to a password expiry that will silently break the fleet later, and that its password is recorded in the secret store.',
      'Confirm the planned admin/operator/viewer groups exist and contain the expected members.',
    ],
    expected: 'The bind account authenticates against every planned domain controller and can read the intended base DN; the planned groups exist.',
    note: 'The bind account is a shared dependency across vCenter, NSX, VCF Operations and the Identity Broker — a rotation breaks every consumer at once. Record who owns it.',
  },
  {
    id: 'TP-015',
    title: 'Required firewall flows are open',
    epic: 'E4',
    story: '4.3',
    steps: [
      'Work through the flows by zone: management to AD/DNS/NTP/CA, management to the depot or offline depot, jump host to the management network, and the fleet component flows.',
      'Spot-check each zone with an actual connection attempt from the source subnet — not a rule review.',
      'Confirm the Cloud Proxy path to VCF Operations on 443, 4505 and 4506.',
    ],
    expected: 'Each zone is proven open by a successful connection from a host on the source subnet.',
  },
  {
    id: 'TP-016',
    title: 'Software depot is reachable, or the offline depot is staged and serving',
    epic: 'E4',
    story: '4.3',
    critical: true,
    steps: [
      'Connected site: confirm the depot host resolves and answers over 443 from the management network, through the proxy if one is in use.',
      'Air-gapped site: confirm the offline depot is populated with the full target BOM, is serving over HTTPS, and its certificate is trusted by the fleet.',
      'Either way, confirm the binaries for the exact target release are present — not just that the endpoint answers.',
    ],
    expected: 'The depot answers from the management network AND the complete target BOM is available from it.',
    note: 'Reachability alone is a false pass: an empty or partially synced offline depot answers perfectly and then fails at the first lifecycle operation.',
  },
  {
    id: 'TP-017',
    title: 'Build access: jump host and out-of-band consoles',
    epic: 'E4',
    story: '4.4',
    steps: [
      'From the jump/bastion host, reach the management network and each planned appliance IP.',
      'Open the out-of-band console (iDRAC / iLO / BMC) of every host and confirm virtual media or console redirection works.',
      'Confirm the build team has working credentials for both.',
    ],
    expected: 'The build team reaches the management network and can open a console on every host.',
    note: 'Out-of-band configuration is not part of VCF. If the site has no BMC cards, mark NA and record how hosts will be recovered instead.',
  },
];

// --- TP-1 — Management bring-up (E5) --------------------------------------

const TP1: Entry[] = [
  {
    id: 'TP-101',
    title: 'Hosts are imaged to the BOM build and correctly networked',
    epic: 'E5',
    story: '5.1',
    steps: [
      'On each host, confirm the installed build matches the BOM exactly — not merely the same major version.',
      'Confirm the management VMkernel carries the planned IP, mask, gateway and VLAN.',
      'Confirm DNS servers and search domain are set, and that the host resolves its own FQDN and a peer.',
      'Confirm NTP is configured, the service is running and set to start with the host, and the host clock is in sync.',
      'Confirm the root password is the planned one and is recorded in the secret store.',
    ],
    expected:
      'Every host runs the BOM build, is reachable on its planned management address, resolves DNS both ways, and is time-synced.',
  },
  {
    id: 'TP-102',
    title: 'VCF Installer is staged on the VM-Management VLAN under the planned SDDC Manager identity',
    epic: 'E5',
    story: '5.2',
    critical: true,
    steps: [
      'Confirm the Installer was deployed with the IP and FQDN planned for SDDC Manager — it becomes SDDC Manager at bring-up, so this is not a throwaway address.',
      "Confirm its port group actually carries the VM Management VLAN. A fresh host's default VM Network port group is untagged (VLAN 0); if VM Management is tagged, the appliance will have no connectivity until the VLAN ID is set.",
      'From a client, resolve the Installer FQDN and open its UI.',
      'From the Installer, confirm it reaches the ESX management network and each host.',
      'If the Installer is running OUTSIDE the management domain, confirm the extra FQDN and IP for the separate SDDC Manager appliance are planned and in DNS.',
    ],
    expected:
      'The Installer is reachable on the planned SDDC Manager FQDN, sits on the VM-Management VLAN, and can reach every management host.',
  },
  {
    id: 'TP-103',
    title: 'Bring-up completes and the core components are healthy',
    epic: 'E5',
    story: '5.3',
    critical: true,
    steps: [
      'Run bring-up and watch it through its milestones: vCenter, SDDC Manager, vSphere cluster, NSX, VCF Management Platform, operations appliance, VCF Management Services. Budget roughly four to six hours.',
      'On the Review page, download the JSON spec before starting — it is the repeatable record of what was actually deployed.',
      'Note any soft-stop warning about resource headroom below 20% and record the decision taken.',
      'After completion, log in to vCenter, NSX Manager and VCF Operations in turn and confirm each reports healthy with no outstanding alarms.',
      'Confirm the NSX Manager cluster shows three nodes stable and the VIP answers.',
    ],
    expected:
      'Bring-up completes without error; vCenter, SDDC Manager, NSX (3 nodes plus VIP) and VCF Operations are all reachable and healthy.',
  },
  {
    id: 'TP-104',
    title: 'vSAN datastore is online and health checks are clean',
    epic: 'E5',
    story: '5.3',
    critical: true,
    when: isVsan,
    steps: [
      'Open the cluster health view and retest, so results reflect the current state rather than a cached run.',
      'Work through every failed or warning check and either resolve it or record why it is accepted.',
      'Run the proactive VM creation test.',
      'Run the proactive network performance test.',
      'Confirm the datastore capacity matches what sizing predicted.',
    ],
    expected: 'No failed health checks; both proactive tests pass; datastore capacity matches the sizing output.',
  },
  {
    id: 'TP-105',
    title: 'External principal datastore is online across the cluster',
    epic: 'E5',
    story: '5.3',
    critical: true,
    when: isExternalStorage,
    steps: [
      'Confirm the datastore is mounted and writable on every host in the cluster.',
      'For FC, confirm all expected paths are active and no host is running degraded on a single path.',
      'Confirm the datastore capacity matches what sizing predicted.',
    ],
    expected: 'The principal datastore is mounted and writable on every host, with full path redundancy where applicable.',
  },
  {
    id: 'TP-106',
    title: 'Auto-generated component passwords are captured',
    epic: 'E5',
    story: '5.3',
    critical: true,
    steps: [
      'The Installer generates all component passwords. Retrieve them via Review Passwords during or immediately after the deploy.',
      'Store every credential in the secret store used for this engagement.',
      'Confirm each captured credential actually works by logging in with it once.',
    ],
    expected: 'Every auto-generated credential is captured, stored in the secret store, and verified by a successful login.',
    note: 'VCF Operations password management is rotate-and-expire only — there is no reveal API. If these are not captured now, they are not recoverable later.',
  },
  {
    id: 'TP-107',
    title: 'VCF Operations cluster is online and consistent',
    epic: 'E5',
    story: '5.4',
    steps: [
      'In the administration interface, confirm the cluster reports online.',
      'Confirm every node is in a running state with an online status, and that node roles match the design.',
      'Confirm all nodes report the same build and version — a version split is a silent source of odd behaviour.',
      'Confirm each node reports a non-zero object and metric count.',
      'Confirm SSH is off on all nodes unless it has been explicitly approved and documented.',
      'If high availability or continuous availability is in scope, confirm the chosen mode is enabled. They are mutually exclusive.',
    ],
    expected:
      'Cluster online; all nodes running, online, same build, reporting non-zero objects and metrics; SSH off unless approved; the chosen availability mode enabled.',
    note: 'A new cluster can take a while to come online while its post-deploy software step finishes. Check the update status before treating it as a failure.',
  },
  {
    id: 'TP-108',
    title: 'Data collection is running',
    epic: 'E5',
    story: '5.4',
    steps: [
      'Confirm every adapter instance reports a receiving state.',
      'Confirm the expected collector groups exist and each contains the right members.',
      'Confirm the inventory lists every workload domain and each is collecting.',
    ],
    expected: 'All adapter instances are receiving data, collector groups are correctly populated, and every domain appears in the inventory.',
  },
  {
    id: 'TP-109',
    title: 'License Server resolves outside the services-runtime range',
    epic: 'E5',
    story: '5.4',
    critical: true,
    steps: [
      'Confirm the License Server was deployed automatically as part of bring-up and is healthy.',
      'Resolve its FQDN and confirm the address is IPv4 and falls OUTSIDE the VCF services-runtime range.',
      'Confirm the evaluation period start date, so the 90-day window is a known deadline rather than a surprise.',
    ],
    expected: 'The License Server is healthy and its FQDN resolves to an IPv4 address outside the services-runtime range.',
    note: 'This is the bring-up License Server. It is a different appliance from License Hub (TP-411) and the two coexist.',
  },
  {
    id: 'TP-110',
    title: 'Cloud Proxy is collecting',
    epic: 'E5',
    story: '5.4',
    steps: [
      'Confirm the Cloud Proxy was configured by default during bring-up and sits on the VM-Management network.',
      'Confirm it reaches VCF Operations on 443, 4505 and 4506.',
      'Confirm it shows as connected and is passing data.',
    ],
    expected: 'The Cloud Proxy is on the VM-Management network, connected, and actively collecting.',
  },
  {
    id: 'TP-111',
    title: 'Fleet lifecycle sees the depot, the components and the instances',
    epic: 'E5',
    story: '5.4',
    steps: [
      'In fleet lifecycle, confirm every deployed component appears.',
      'Confirm the depot is configured and binaries are listed for those components.',
      'Confirm every VCF instance is connected.',
      'Confirm the VCF Management Services — services runtime, identity broker, fleet and SDDC lifecycle, software depot, telemetry — are all up.',
    ],
    expected: 'All components, the depot with its binaries, and every VCF instance are visible and connected in fleet lifecycle.',
  },
  {
    id: 'TP-112',
    title: 'A support bundle can be generated and read',
    epic: 'E5',
    story: '5.4',
    steps: [
      'Generate a light support bundle covering all nodes, download it, and confirm it contains readable content for each node.',
      'Generate a full support bundle and do the same.',
    ],
    expected: 'Both bundle types generate successfully and contain readable per-node content.',
    note: 'Slow. Start it in parallel with other work rather than blocking on it — but do prove it now, because the first time you need a bundle is the worst time to discover it fails.',
  },
];

// --- TP-2 — Management domain configuration (E6) --------------------------

const TP2: Entry[] = [
  {
    id: 'TP-201',
    title: 'Edge cluster, Tier-0 and BGP are up with routes exchanged',
    epic: 'E6',
    story: '6.1',
    critical: true,
    when: isCentral,
    steps: [
      'Confirm all hosts are configured as transport nodes, the edge transport nodes are deployed, and the edge cluster is formed.',
      'Confirm the Tier-0 gateway is up on the planned uplink interfaces.',
      'Confirm each BGP neighbour is in an established state, with BFD up if configured.',
      'Confirm the expected prefixes are being RECEIVED from the fabric and the expected prefixes are being ADVERTISED to it — check both directions, not just the session state.',
      'From a VM on an overlay segment, reach an address beyond the ToRs.',
    ],
    expected:
      'Edge cluster and Tier-0 up; every BGP neighbour established; expected prefixes exchanged in both directions; north-south traffic reaches beyond the ToRs.',
    note: 'An established session with no prefixes exchanged is a very common false pass. Always check the route tables, not the neighbour state.',
  },
  {
    id: 'TP-202',
    title: 'Distributed Transit Gateway is up on the external VLAN and routed by the fabric',
    epic: 'E6',
    story: '6.1',
    critical: true,
    when: isDistrib,
    steps: [
      'Confirm the Distributed Transit Gateway is attached to the external VLAN planned in TP-004.',
      'Confirm the private transit-gateway block is configured as a /16.',
      'Confirm the fabric routes the external VLAN gateway CIDR and advertises the external IP block upstream.',
      'From a VM behind the transit gateway, reach an address beyond the ToRs and confirm the return path works.',
      'Confirm routing is distributed to the hypervisors — there is no Tier-0 and no edge cluster on this model, so do not look for one.',
    ],
    expected:
      'The transit gateway is up on the external VLAN with a /16 private block, the fabric routes and advertises correctly, and north-south works end to end.',
    note: 'Vendor NSX verification material assumes an edge cluster and a Tier-0, so none of it applies here. This case and TP-203 are the Distributed equivalents.',
  },
  {
    id: 'TP-203',
    title: 'VNA cluster is healthy and stateful services work',
    epic: 'E6',
    story: '6.1',
    critical: true,
    when: isDistrib,
    steps: [
      'Confirm at least two Virtual Network Appliances are deployed, each with its own FQDN and static IP on the ESX management subnet.',
      'Confirm the cluster reports healthy on all nodes — two is the minimum for HA, and a single-node cluster is not a pass.',
      'Confirm NAT/SNAT works: from a VM behind the transit gateway, reach an external destination and confirm the source translates to an address from the external IP block.',
      'If default outbound NAT was planned, confirm it is enabled and behaving as designed.',
      'Fail one appliance and confirm stateful services continue.',
    ],
    expected:
      'Two or more VNA appliances healthy; NAT/SNAT translates to the external IP block; losing one appliance does not break stateful services.',
    note: 'A VNA cluster is not a small edge cluster — no Tier-0 or Tier-1 runs on it. It exists to give the transit gateway stateful services.',
  },
  {
    id: 'TP-204',
    title: 'Network segments match the plan',
    epic: 'E6',
    story: '6.1',
    steps: [
      'List the configured segments and compare name, transport zone, VLAN or overlay type, gateway address and subnet against the network plan.',
      'Confirm no leftover segments from testing remain.',
    ],
    expected: 'Every segment matches the plan, and there are no unplanned leftovers.',
  },
  {
    id: 'TP-205',
    title: 'A VM on a segment reaches its gateway and the outside world',
    epic: 'E6',
    story: '6.1',
    steps: [
      'Attach a test VM to each configured segment and give it an address from that segment.',
      'Reach the segment gateway.',
      'Reach outbound past the ToRs — an internet address, or an internal address beyond the rack on an isolated site.',
      'From a machine external to the segment, reach the test VM inbound.',
    ],
    expected: 'Gateway, outbound and inbound all succeed on every configured segment.',
  },
  {
    id: 'TP-206',
    title: 'Uplinks are clean and the expected VLANs egress the ToRs',
    epic: 'E6',
    story: '6.1',
    steps: [
      'With the network team, review the uplink interfaces for errors, drops and CRCs — the exact commands vary by switch vendor.',
      'Confirm the VLANs that are supposed to egress the ToRs actually do, and that the ones that should not, do not.',
    ],
    expected: 'No interface errors on the uplinks, and VLAN egress matches the design in both directions.',
  },
  {
    id: 'TP-207',
    title: 'East-west throughput between VMs on the same host',
    epic: 'E6',
    story: '6.1',
    steps: [
      'Place two test VMs on the SAME host, one as receiver and one as sender.',
      'Run a TCP throughput test between them on a VDS-backed port group, using the real per-VM addresses.',
      'Repeat on an overlay-backed segment.',
      'Record the measured throughput as the actual result — a number, not a tick.',
    ],
    expected:
      'Same-host throughput reaches the level agreed for this platform on both VDS and overlay networking, with no packet loss.',
    note: 'Set the target with the customer before testing. A same-host figure is bounded by CPU and vNIC, not the physical fabric, so it should comfortably exceed the cross-host figure.',
  },
  {
    id: 'TP-208',
    title: 'East-west throughput between VMs on different hosts',
    epic: 'E6',
    story: '6.1',
    steps: [
      'Move one test VM to a different host, keeping the other in place.',
      'Repeat the throughput test on a VDS-backed port group.',
      'Repeat on an overlay-backed segment — this is the path that exercises the host overlay and its MTU.',
      'Record measured throughput as the actual result.',
    ],
    expected: 'Cross-host throughput reaches the agreed level on both VDS and overlay, with no packet loss and no fragmentation.',
    note: 'A large gap between the VDS and overlay figures usually means the host overlay MTU is not what TP-001 thought it was.',
  },
  {
    id: 'TP-209',
    title: 'VMs deploy and anti-affinity rules apply',
    epic: 'E6',
    story: '6.1',
    steps: [
      'Deploy two test VMs into the cluster from a template or OVF.',
      'Create an anti-affinity rule that keeps them on separate hosts.',
      'Confirm the rule is created and shows as applied.',
    ],
    expected: 'Both VMs deploy successfully and the anti-affinity rule is created and applied.',
    note: 'These two VMs are reused by TP-207, TP-208, TP-210 and TP-211. Build them once, early.',
  },
  {
    id: 'TP-210',
    title: 'vMotion works between every pair of hosts',
    epic: 'E6',
    story: '6.1',
    steps: [
      'Migrate a running test VM between hosts, changing compute resource only.',
      'Confirm compatibility checks pass at each step and the VM stays up through the migration.',
      'Repeat until every host in the cluster has both sent and received a migration — a single migration proves one path, not the cluster.',
      'Confirm the anti-affinity rule from TP-209 prevents a migration that would co-locate the pair.',
    ],
    expected:
      'Every host both sends and receives a live migration with no interruption, and the anti-affinity rule blocks a co-locating move.',
  },
  {
    id: 'TP-211',
    title: 'vSphere HA restarts workloads after a host failure',
    epic: 'E6',
    story: '6.1',
    critical: true,
    steps: [
      'Confirm HA is enabled on the cluster and its admission control setting matches the design.',
      'Note which host runs a test VM, then hard-power that host off via its out-of-band interface — not a graceful shutdown, which does not exercise HA.',
      'Confirm the VM restarts on a surviving host, and record how long it took.',
      'Power the host back on and confirm it rejoins the cluster cleanly.',
      'Repeat for any additional cluster in scope.',
    ],
    expected: 'The VM restarts on a surviving host within the agreed recovery time, and the failed host rejoins cleanly.',
  },
  {
    id: 'TP-212',
    title: 'SDDC Manager backup completes to the SFTP target',
    epic: 'E6',
    story: '6.4',
    critical: true,
    steps: [
      'Confirm the SFTP target is configured with the correct host, port, path, credentials and host key.',
      'Trigger a backup and confirm it completes.',
      'Confirm the archive actually landed on the target with a non-trivial size.',
      'Confirm the backup schedule and retention match what was agreed.',
      'Confirm the backup encryption passphrase is recorded in the secret store — without it the archive is useless.',
    ],
    expected: 'A backup completes, the archive is present on the SFTP target, the schedule is set, and the passphrase is stored.',
  },
  {
    id: 'TP-213',
    title: 'Every vCenter file-based backup is scheduled and completes',
    epic: 'E6',
    story: '6.4',
    critical: true,
    steps: [
      "For EACH vCenter in the fleet, open its own management interface (VAMI) and confirm a file-based backup schedule is configured — VCF does not configure this for you.",
      'Trigger a backup on each and confirm it completes.',
      'Confirm each archive is present on the target.',
      'Confirm retention and any encryption passphrase are set and recorded.',
    ],
    expected: 'Every vCenter has a working, scheduled file-based backup with its archive verified on the target.',
    note: 'This is the single most commonly missed post-deployment task: SDDC Manager backup is configured centrally and looks like it covers everything, but each vCenter must be set up individually in its own VAMI.',
  },
  {
    id: 'TP-214',
    title: 'Backups are restorable, not merely present',
    epic: 'E6',
    story: '6.4',
    steps: [
      'Retrieve one archive from the SFTP target to a separate machine.',
      'Confirm it is complete and readable, and that the passphrase in the secret store opens it.',
      'Confirm the restore procedure is documented, including where the passphrase lives and who can reach the target.',
    ],
    expected: 'An archive can be retrieved and opened with the stored passphrase, and the restore procedure is written down.',
    note: 'An unverified backup is a hypothesis. This is the cheapest possible version of testing it — do at least this much.',
  },
  {
    id: 'TP-215',
    title: 'Fleet lifecycle depot is connected and pending updates are understood',
    epic: 'E6',
    story: '6.4',
    steps: [
      'Confirm the fleet-wide lifecycle depot is connected (separate from the depot SDDC Manager already got at bring-up).',
      'Confirm the proxy is configured if the site requires one.',
      'Review any available updates and record the decision: applied now, scheduled, or deferred with a reason.',
    ],
    expected: 'The fleet lifecycle depot is connected and every available update has a recorded decision.',
  },
  {
    id: 'TP-216',
    title: 'Storage firmware and driver health is clean',
    epic: 'E6',
    story: '6.4',
    critical: false,
    when: isVsan,
    steps: [
      'Open the vSAN health view and check the firmware and driver checks specifically.',
      'Confirm the hosts are configured to receive firmware and driver updates through the intended channel.',
      'Resolve or document every warning.',
    ],
    expected: 'No firmware or driver health failures, and the update channel is configured.',
  },
  {
    id: 'TP-217',
    title: 'Early identity binding behaves as designed',
    epic: 'E6',
    story: '6.3',
    steps: [
      'If vCenter SSO was bound directly to AD/LDAP for early access, confirm a directory user logs in and lands on the intended role.',
      'Confirm the admin, operator and viewer group mappings match the design.',
      'Confirm privileges on the non-vSphere components — NSX and VCF Operations — are applied as intended.',
    ],
    expected: 'Directory logins land on the intended roles across vCenter, NSX and VCF Operations.',
    note: 'Fleet-wide SSO via the Identity Broker (TP-430) is the recommended path and is done Day-2. Mark this NA if identity was deliberately deferred.',
  },
];

// --- TP-3 — Stretch (E7) --------------------------------------------------
// No vendor verification material covers vSAN stretched clusters at all. All of
// TP-3 is original.

const TP3: Entry[] = [
  {
    id: 'TP-301',
    title: 'Inter-AZ link meets latency, bandwidth and MTU requirements',
    epic: 'E7',
    story: '7.1',
    critical: true,
    steps: [
      'Measure round-trip latency between the AZs over a sustained period, not a single ping — record the average and the worst case.',
      'Measure achievable bandwidth between the AZs.',
      'Prove MTU 9000 end to end between AZs with an unfragmented large ping.',
      'Confirm the L3 gateway between AZs is itself highly available, so a single gateway failure does not partition the cluster.',
      'Record the measured numbers as the actual result.',
    ],
    expected:
      'Round-trip latency stays under 5 ms, bandwidth is at least 10 Gbps, MTU 9000 passes unfragmented end to end, and the inter-AZ L3 gateway is HA.',
    note: 'Measure over time. A link that averages 3 ms but spikes to 12 ms under load will cause vSAN problems that are extremely hard to attribute later.',
  },
  {
    id: 'TP-302',
    title: 'Second-AZ hosts are imaged, networked and commissioned',
    epic: 'E7',
    story: '7.2',
    steps: [
      'Confirm each AZ2 host runs the same BOM build as AZ1.',
      'Confirm the per-AZ management network, DNS and NTP are configured and working on each.',
      'Confirm they are commissioned into SDDC Manager and show as available.',
      'Confirm the AZ2 network pool exists with the per-AZ ranges the stretch will need.',
    ],
    expected: 'AZ2 hosts run the matched build, are reachable on their per-AZ networks, and are commissioned and available with a network pool ready.',
  },
  {
    id: 'TP-303',
    title: 'Witness is deployed at the third site and serves only this cluster',
    epic: 'E7',
    story: '7.3',
    critical: true,
    steps: [
      'Confirm the witness appliance is deployed at the third site, not inside either AZ.',
      'Confirm it is routable from BOTH AZ ESX management networks and that both directions work.',
      'Confirm latency from each AZ to the witness is within the supported bound.',
      'Confirm this witness is dedicated to this cluster — a vSAN witness serves exactly one stretched cluster.',
    ],
    expected: 'The witness is at the third site, reachable from both AZs within the supported latency, and dedicated to this cluster.',
    note: 'The shared-witness feature applies to 2-node clusters only, not stretched clusters. Every stretched cluster needs its own.',
  },
  {
    id: 'TP-304',
    title: 'Cluster is stretched with correct fault domains and storage policy',
    epic: 'E7',
    story: '7.4',
    critical: true,
    steps: [
      'Confirm SDDC Manager reports the cluster as stretched.',
      'Confirm the fault domains are correct: AZ1 preferred, AZ2 secondary, witness assigned.',
      'Confirm hosts are balanced evenly across the AZs.',
      'Confirm the datastore storage policy is site mirroring and that objects report compliant.',
      'Confirm capacity consumption reflects the roughly doubled footprint that site mirroring implies.',
      'If the cluster hosts an edge cluster, confirm the multi-AZ edge flag was set in the stretch specification — if it was wrong, the edge-specific AZ configuration was silently skipped.',
    ],
    expected:
      'The cluster reports stretched with correct fault domains, balanced hosts, a compliant site-mirroring policy, and correct edge handling if applicable.',
  },
  {
    id: 'TP-305',
    title: 'Isolating one availability zone keeps workloads running',
    epic: 'E7',
    story: '7.4',
    critical: true,
    steps: [
      'Agree the test window with the customer — this is a disruptive test and it is the only one that actually proves the stretch.',
      'Place test workloads on both AZs.',
      'Isolate the secondary AZ at the network layer, or power its hosts off.',
      'Confirm workloads on the surviving AZ keep running and workloads from the isolated AZ restart there.',
      'Confirm the datastore stays accessible and the witness keeps quorum.',
      'Restore the isolated AZ and confirm resynchronisation completes and objects return to compliant.',
      'Record recovery time and resync duration as the actual result.',
    ],
    expected:
      'The surviving AZ keeps its workloads and restarts the failed ones; the datastore stays available throughout; after restore, resync completes and all objects return to compliant.',
    note: 'If the customer will not accept a disruptive test, mark this F2 rather than P and record explicitly that the stretch is unproven. Do not tick a pass on a test that was not run.',
  },
];

// --- TP-4 — Day-2 fleet (E8) ----------------------------------------------

const day2 = (sel: Selection) => sel.day2;
const automation = (sel: Selection) => sel.day2 && sel.automation.deploy;

const TP4: Entry[] = [
  {
    id: 'TP-401',
    title: 'Fleet component network placement is built and reachable',
    epic: 'E8',
    story: '8.1',
    when: day2,
    steps: [
      'Confirm the chosen placement exists — shared management, dedicated management, an NSX overlay segment, or an NSX VLAN segment.',
      'If a non-shared network was built, confirm it is routed and reachable from the management network.',
      'Confirm every Day-2 appliance FQDN resolves forward and reverse to an address on that network.',
    ],
    expected: 'The chosen placement is built and routed, and all Day-2 FQDNs resolve both ways onto it.',
    note: 'An overlay-segment placement needs an edge cluster and a Tier-0. Under Distributed connectivity there is none, so either build one for the fleet segment or pick a VLAN-backed placement.',
  },
  {
    id: 'TP-402',
    title: 'Automation appliances: identity, time and cluster state',
    epic: 'E8',
    story: '8.2',
    when: automation,
    steps: [
      'On each appliance, confirm shell access with the expected credential.',
      'Confirm the time zone and NTP configuration are correct and the clock is in sync.',
      'Confirm the hostname is the correct FQDN and that it resolves forward AND reverse.',
      'Confirm the cluster reports ready.',
    ],
    expected: 'Every appliance authenticates, is time-synced, carries the correct FQDN resolving both ways, and the cluster reports ready.',
  },
  {
    id: 'TP-403',
    title: 'Automation is reachable on its cluster VIP',
    epic: 'E8',
    story: '8.2',
    critical: true,
    when: automation,
    steps: [
      'Confirm the built-in load balancer is serving the cluster VIP — it is configured automatically for both the single-node and the HA model, and no external load balancer is required for this.',
      'Reach the provider portal through the VIP and log in as a system administrator.',
      'On an HA cluster, take one node out and confirm the VIP keeps serving.',
      'Confirm the services-runtime cluster CIDR is set and overlaps nothing.',
    ],
    expected: 'The portal is reachable and serving through the cluster VIP, survives the loss of one node on HA, and the services-runtime CIDR is unique.',
  },
  {
    id: 'TP-404',
    title: 'Provider plane matches the design',
    epic: 'E8',
    story: '8.2',
    when: automation,
    steps: [
      'Confirm the provider gateway is discovered with the expected type and its associated IP spaces report normal.',
      'Confirm the regions show the expected supervisor and NSX manager.',
      'Confirm edge clusters report healthy where applicable.',
      'Confirm the vCenter and NSX connections were auto-discovered through VCF Operations, are connected and enabled, and report as licensed.',
    ],
    expected: 'Provider gateway, IP spaces, regions and connections all report normal, and the vCenter connections report licensed.',
  },
  {
    id: 'TP-405',
    title: 'Content libraries and their items are ready',
    epic: 'E8',
    story: '8.2',
    when: automation,
    steps: [
      'Confirm the expected content libraries are present with the correct local or subscribed type.',
      'Confirm library items are discovered and report ready.',
      'Trigger a sync on a subscribed library and confirm it completes.',
    ],
    expected: 'Libraries and their items are present and ready, and a subscribed library syncs successfully.',
  },
  {
    id: 'TP-406',
    title: 'Organizations, projects, quotas and membership are configured',
    epic: 'E8',
    story: '8.2',
    when: automation,
    steps: [
      'Confirm the expected organizations exist with their allocated regions and resources.',
      'Confirm projects exist with the intended type, quotas and resource limits.',
      'Confirm users and groups come from the identity provider and land on the intended roles.',
      'Confirm the roles themselves match the design, including any custom roles.',
    ],
    expected: 'Organizations, projects, quotas and role assignments all match the design, sourced from the identity provider.',
  },
  {
    id: 'TP-407',
    title: 'End-to-end provisioning: request, deploy and decommission',
    epic: 'E8',
    story: '8.2',
    critical: true,
    when: automation,
    steps: [
      'As an end user, browse the catalog and request an item.',
      'Complete the request form and submit.',
      'Watch the deployment through to success, checking events for warnings along the way.',
      'Confirm the resulting workload is actually usable — reachable on its network, with the storage and sizing the blueprint specified.',
      'Perform a day-2 action on it, such as a power cycle.',
      'DELETE the deployment and confirm every resource it created is cleaned up — VMs, networks, and IP allocations.',
    ],
    expected:
      'A catalog request deploys a working workload, day-2 actions succeed, and deletion removes every resource it created with no orphans left behind.',
    note: 'Decommission is the half people skip. A blueprint that deploys but leaks IP allocations on delete will exhaust the pool weeks after handover.',
  },
  {
    id: 'TP-408',
    title: 'License Hub is deployed, registered and holding licences',
    epic: 'E8',
    story: '8.2a',
    critical: true,
    when: licenseHubNeeded,
    steps: [
      'Confirm the SSP Installer appliance is deployed on a real FQDN with forward and reverse DNS, and that it connected to vCenter successfully.',
      'Confirm the License Hub instance is deployed and reports healthy.',
      'Confirm its three FQDNs resolve, and that the instance and messaging names map to the first and second addresses of the service pool.',
      'Confirm the hub is registered.',
      'Open the licensing view and confirm licences are actually LOADED — a registered hub with an empty licence list is not a pass.',
    ],
    expected: 'The SSP Installer and License Hub instance are healthy, the hub is registered, and the licence list is populated.',
    note: 'Registration brings no entitlement on its own. The licence file is downloaded separately from the vendor cloud console and added by hand.',
  },
  {
    id: 'TP-409',
    title: 'License Hub VMs are excluded from the distributed firewall',
    epic: 'E8',
    story: '8.2a',
    when: licenseHubNeeded,
    steps: [
      'With the distributed-firewall policy owner, confirm the License Hub VMs are in the exclusion list.',
      'Confirm this is a policy carve-out rather than an allow rule, and that it is recorded so a later policy review does not remove it.',
    ],
    expected: 'The License Hub VMs are on the firewall exclusion list and the carve-out is documented.',
  },
  {
    id: 'TP-410',
    title: 'SSP Installer is backed up',
    epic: 'E8',
    story: '8.2a',
    critical: true,
    when: licenseHubNeeded,
    steps: [
      'Take a backup of the SSP Installer and store it with the engagement records.',
      'Confirm the backup is retrievable and complete.',
    ],
    expected: 'An SSP Installer backup exists, is retrievable, and is stored with the engagement records.',
    note: 'That backup is the only migration path if the vCenter FQDN or IP ever changes. Several properties of the deployment — instance name, instance FQDN, storage policy, and both pools — cannot be changed afterwards.',
  },
  {
    id: 'TP-411',
    title: 'Brownfield Avi licence entitlement was migrated before upgrade',
    epic: 'E8',
    story: '8.2a',
    critical: true,
    when: aviInScope,
    steps: [
      'Establish whether the site already ran a load balancer on an older version.',
      'If so, confirm the entitlement was migrated on the vendor support portal BEFORE the upgrade — the migration is one-way.',
      'Confirm the current licences are not on a deprecated format that is running out a grace period.',
      'Confirm the grace-period expiry date, if any, and that it is on the customer calendar.',
    ],
    expected: 'Entitlement is on the current format with no grace period running, or the grace period is known, dated and owned.',
    note: 'Deprecated licence formats get a strict 90-day grace period from first boot that OVERRIDES the stated validity date — a licence marked valid until 2029 will still stop. Mark NA on a greenfield site.',
  },
  {
    id: 'TP-412',
    title: 'Load-balancer controller cluster is healthy and initialised',
    epic: 'E8',
    story: '8.3',
    critical: true,
    when: aviInScope,
    steps: [
      'Confirm the controller cluster is deployed in the MANAGEMENT domain — controllers always live there, never in a workload domain.',
      'Confirm the cluster reports healthy on all nodes.',
      'Confirm the first-login wizard was completed, and that the items nothing on the VCF side collects were captured: the passphrase, the DNS resolvers and search domain, the SMTP choice, and the multi-tenancy model.',
      'Confirm the PASSPHRASE is recorded in the secret store — it protects the controller configuration backups and is restore-critical.',
      'Confirm the required binaries were available from the depot at the version the release requires.',
    ],
    expected:
      'The controller cluster is healthy in the management domain, its first-login wizard is complete, and the passphrase is in the secret store.',
    note: 'The multi-tenancy model — service engines shared by the provider versus per-tenant — is an architecture decision that is awkward to change after first login. Settle it beforehand.',
  },
  {
    id: 'TP-413',
    title: 'Controller is onboarded to License Hub with a non-zero licence count',
    epic: 'E8',
    story: '8.3a',
    critical: true,
    when: aviInScope,
    steps: [
      'In the hub, onboard the controller as an endpoint: type, name, connection type, the cluster address, and that endpoint’s admin credential AND its certificate — the hub logs in to it.',
      'Assign licences to the endpoint.',
      'On the controller, switch licensing to the on-premises License Hub. It does not discover the hub by itself.',
      'Open the licence usage view and read the actual counts.',
    ],
    expected:
      'The controller is listed as an endpoint with licences assigned, is switched to the on-premises hub, and licence usage shows a NON-ZERO used and available count.',
    note: 'This is a documented false-pass: a connected status with a fresh refresh timestamp still reads zero used and zero available if no licence file was ever loaded. Verify the usage numbers, not the connectivity indicator.',
  },
  {
    id: 'TP-414',
    title: 'Load balancer fronts Automation and its published name resolves to the VIP',
    epic: 'E8',
    story: '8.3',
    when: (sel) => sel.day2 && sel.automation.deploy && sel.automation.aviLb,
    steps: [
      'Confirm the virtual service is configured with its pool pointing at the cluster VIP of Automation’s built-in load balancer — the built-in VIP stays the ingress.',
      'Confirm the published FQDN resolves to the virtual service address.',
      'Confirm SSL terminates on the virtual service with the intended certificate, and that the browser reports no trust warning.',
      'Reach the Automation portal through the published FQDN and log in.',
      'Confirm user and tenant traffic now reaches Automation WITHOUT traversing the management network.',
    ],
    expected:
      'The published FQDN resolves to the virtual service, SSL terminates cleanly, the portal is usable through it, and tenant traffic stays off the management network.',
    note: 'The built-in load balancer is L4-only. Putting a load balancer in front is what adds SSL termination and traffic separation — it is an optional addition, never a requirement.',
  },
  {
    id: 'TP-415',
    title: 'Log Management appliances are deployed, networked and resolvable',
    epic: 'E8',
    story: '8.4',
    when: (sel) => sel.day2 && sel.day2Components.logs,
    steps: [
      'Confirm every appliance in the cluster is powered on and on the correct network.',
      'Confirm forward and reverse DNS for the cluster VIP and for every individual node.',
      'Confirm the virtual hardware version is appropriate for the appliance size and the host.',
      'Confirm the integrated load balancer is serving the cluster VIP.',
    ],
    expected: 'All nodes are up on the correct network, the VIP and every node resolve both ways, and the VIP serves the interface.',
    note: 'This product has an integrated load balancer and a genuine cluster VIP. VCF Operations does not — do not confuse the two.',
  },
  {
    id: 'TP-416',
    title: 'Log Management access control and integrations are correct',
    epic: 'E8',
    story: '8.4',
    when: (sel) => sel.day2 && sel.day2Components.logs,
    steps: [
      'Confirm the directory integration is configured and its connection test passes, if in scope.',
      'Confirm local users and groups exist as designed.',
      'Confirm membership of each administrative and read-only group is correct — check every group, not just the admin one.',
      'Confirm NTP, SMTP, archiving and the SSL certificate are all configured as agreed.',
      'Confirm event forwarding destinations and their protocol, port, filter and cache settings match the design.',
    ],
    expected: 'Directory integration, group membership, NTP, SMTP, archiving, SSL and event forwarding all match the design.',
  },
  {
    id: 'TP-417',
    title: 'Every source is actually shipping logs',
    epic: 'E8',
    story: '8.4',
    critical: true,
    when: (sel) => sel.day2 && sel.day2Components.logs,
    steps: [
      'Confirm each vCenter is configured to send to the cluster VIP.',
      'Confirm EVERY ESX host is configured to send to the cluster VIP — not a sample.',
      'For each source type, search for a recent event and confirm it is arriving now.',
      'Create a test alert query, trigger it, and confirm the notification is delivered.',
    ],
    expected:
      'Every vCenter and every ESX host is shipping logs to the VIP with recent events visible, and a triggered test alert is delivered.',
    note: 'Configuration and delivery are different things. Check for arriving events per source, because one silently missing host is invisible until the day you need its logs.',
  },
  {
    id: 'TP-418',
    title: 'Operations for Networks is paired, collecting and healthy',
    epic: 'E8',
    story: '8.4',
    when: (sel) => sel.day2 && sel.day2Components.networks,
    steps: [
      'Confirm platform and collector appliances are powered on, on the correct network, and resolve forward and reverse.',
      'Confirm every collector is paired with the platform and listed without warnings.',
      'Confirm the overall health indicator is green.',
      'Confirm every intended data source is connected and collecting with no warnings.',
      'Confirm licensing is applied — specifically that the instance is NOT in assessment mode.',
      'Confirm NTP, SMTP and the SSL certificate match the design.',
    ],
    expected: 'Platform and collectors are paired and healthy, all data sources collect without warnings, and the instance is licensed rather than in assessment mode.',
  },
  {
    id: 'TP-419',
    title: 'Operations for Networks detects a real change and is usable for analysis',
    epic: 'E8',
    story: '8.4',
    when: (sel) => sel.day2 && sel.day2Components.networks,
    steps: [
      'Make a small, reversible configuration change on a monitored switch or port group.',
      'Confirm the change is detected and recorded as a change event, and that the configured notification is delivered.',
      'Revert the change.',
      'Run a representative search, save it as a pin, and confirm the pinboard works.',
      'Run a path-and-topology query between two workloads and confirm the path is rendered.',
    ],
    expected: 'A real configuration change is detected and notified, and search, pinboards and path analysis all work.',
  },
  {
    id: 'TP-420',
    title: 'Fleet certificates are CA-signed with no trust warnings',
    epic: 'E8',
    story: '8.5',
    critical: true,
    steps: [
      'Confirm the fleet-wide replacement was run in STAGGERED batches, letting each batch settle before starting the next — each rotation triggers automated retrust across dependent components.',
      'Open every fleet endpoint in a browser and confirm no trust warning appears.',
      'Confirm each certificate is issued by the intended CA, carries the right subject alternative names — including any load-balancer VIP FQDN — and has the expected validity period.',
      'Confirm inter-component trust survived: check that integrations still report connected after the rotation, not just that the browsers are happy.',
    ],
    expected: 'Every endpoint presents a CA-signed certificate with correct SANs and no trust warning, and all inter-component integrations still report connected.',
    note: 'Where the load balancer is managed through VCF Operations, drive its certificate from there. Swapping it directly in the product UI breaks NSX trust.',
  },
  {
    id: 'TP-421',
    title: 'Certificate auto-renewal is configured',
    epic: 'E8',
    story: '8.5',
    steps: [
      'Confirm the fleet certificate view shows the expected certificate authority configured.',
      'Confirm auto-renewal is enabled where intended.',
      'Record the earliest expiry date in the fleet and confirm it is on the customer calendar.',
    ],
    expected: 'The CA is configured, auto-renewal is enabled where intended, and the earliest expiry date is known and diarised.',
    note: 'Objects can take several hours to appear under certificate management after deployment. Do not read an empty list as a failure straight away.',
  },
  {
    id: 'TP-422',
    title: 'Fleet SSO through the identity broker works end to end',
    epic: 'E8',
    story: '8.5',
    when: (sel) => sel.day2 && sel.day2Components.identityBroker,
    steps: [
      'Confirm every VCF instance and every management appliance is configured against the intended identity broker.',
      'Log in as a directory user and confirm single sign-on carries across the fleet components.',
      'Confirm group-to-role mapping lands each test user on the intended role in each component.',
      'Confirm a break-glass local account exists, works, and is recorded — so an identity-provider outage does not lock everyone out.',
    ],
    expected:
      'Directory users sign on once and reach every fleet component on the intended role, and a working break-glass local account is recorded.',
    note: 'The identity broker itself is deployed at bring-up with the management services. This is its configuration, not its deployment.',
  },
  {
    id: 'TP-423',
    title: 'Negative test: an unprivileged user cannot administer',
    epic: 'E8',
    story: '8.5',
    critical: true,
    steps: [
      'Log in as a deliberately NON-administrative user — this is the step that is most often got wrong, leaving the test unable to fail.',
      'Attempt to create or modify a policy and confirm it is refused.',
      'Attempt to create a user or group and confirm it is refused.',
      'Confirm the user cannot see objects outside their intended scope.',
      'Repeat on each component with its own role system.',
    ],
    expected: 'Every administrative action is refused for the non-administrative user, on every component tested.',
    note: 'Write down which account was used. A negative test executed with an admin account passes vacuously and proves nothing.',
  },
  {
    id: 'TP-424',
    title: 'Licensing is applied across the fleet',
    epic: 'E8',
    story: '8.5',
    steps: [
      'Confirm the environment is registered.',
      'Confirm every licence key is installed, valid, and of the expected type, capacity and expiry.',
      'Confirm licence groups exist with the right membership.',
      'Confirm each vCenter carries its primary licence and any add-ons.',
      'Confirm no component is still running on the evaluation period.',
    ],
    expected: 'All licences are installed and valid, groups are correct, and nothing is left in evaluation.',
    note: 'The evaluation window starts at bring-up and is 90 days. Confirm the expiry date rather than assuming there is time.',
  },
  {
    id: 'TP-425',
    title: 'Operations alerting and self-health are sound',
    epic: 'E8',
    story: '8.5',
    steps: [
      'Review active alerts: either there are none, or every one is explained.',
      'Confirm the alert workflow works — take ownership of an alert, release it, and cancel one.',
      'If an external ticketing integration is in scope, trigger an alert matching its rule and confirm the ticket is raised.',
      'Confirm the self-health dashboards report green, and explain anything that is not.',
      'Confirm log forwarding from Operations to the log platform is configured and arriving.',
    ],
    expected: 'No unexplained active alerts, the alert workflow and any ticketing integration work, self-health is green, and log forwarding is arriving.',
  },
  {
    id: 'TP-426',
    title: 'Operations content is usable by the customer',
    epic: 'E8',
    story: '8.5',
    steps: [
      'Create a dashboard from widgets.',
      'Export it, then import it back, and confirm both succeed.',
      'Share it with a group and confirm members can see it but not edit or delete it.',
      'Stop sharing and confirm access is withdrawn.',
      'Confirm expected policies exist, are active, and are assigned to the right groups.',
      'Confirm maintenance schedules match what the customer agreed.',
    ],
    expected: 'Dashboards create, export, import and share correctly; policies are active and correctly assigned; maintenance schedules match the agreement.',
  },
];

// --- TP-5 — Workload domain (E9), repeated per WLD -------------------------

const TP5: WldEntry[] = [
  {
    id: 'TP-501',
    title: 'Workload domain network prep is complete',
    epic: 'E9',
    story: '9.1',
    steps: [
      'Confirm this domain’s VLANs and subnets are provisioned and trunked to its hosts at the correct MTU — across both AZs if this domain is stretched.',
      'Confirm the addresses this domain consumes on the management VM-management subnet are reserved.',
      'Confirm forward and reverse DNS for this domain’s vCenter, NSX components, and hosts.',
    ],
    expected: 'This domain’s VLANs, subnets, reservations and DNS records are all in place and resolve both ways.',
  },
  {
    id: 'TP-502',
    title: 'Workload domain hosts are imaged and commissioned',
    epic: 'E9',
    story: '9.2',
    steps: [
      'Confirm each host runs the BOM build and is on the compatibility guide.',
      'Confirm the management network, DNS and NTP are configured on each — per AZ if this domain is stretched.',
      'Confirm they are commissioned into SDDC Manager and available.',
    ],
    expected: 'All hosts run the matched build, are correctly networked and time-synced, and are commissioned and available.',
  },
  {
    id: 'TP-503',
    title: 'Workload domain is deployed and healthy',
    epic: 'E9',
    story: '9.3',
    critical: true,
    steps: [
      'Confirm the domain appears in the inventory with its CPU, memory and storage allocation.',
      'Confirm its vCenter is reachable and healthy.',
      'Confirm its NSX — shared or dedicated as designed — is healthy.',
      'Confirm the first cluster is online with all hosts joined.',
      'Run a platform health check and review the results.',
    ],
    expected: 'The domain, its vCenter, its NSX and its first cluster are all deployed and healthy.',
  },
  {
    id: 'TP-504',
    title: 'Workload domain principal storage is healthy',
    epic: 'E9',
    story: '9.3',
    critical: true,
    steps: [
      'For vSAN: retest the cluster health view, resolve or document every failure, and run the proactive VM-creation and network-performance tests.',
      'For NFS or FC: confirm the datastore mounts and is writable on every host in the cluster, with full path redundancy where applicable.',
      'Confirm capacity matches the sizing done for this domain.',
    ],
    expected: 'The principal datastore is healthy and writable across every host in the cluster, with capacity matching sizing.',
  },
  {
    id: 'TP-505',
    title: 'Workload domain north-south via edge cluster and BGP',
    epic: 'E9',
    story: '9.4 / 9.6',
    critical: true,
    when: (w) => w.connectivity === 'centralized',
    steps: [
      'Confirm this domain’s hosts are transport nodes and this domain’s edge cluster is deployed.',
      'Confirm its Tier-0 is up on the planned uplinks.',
      'Confirm BGP neighbours are established and prefixes are exchanged in BOTH directions.',
      'From a VM on this domain’s overlay, reach beyond the ToRs and back.',
    ],
    expected: 'This domain’s edge cluster and Tier-0 are up, BGP is exchanging prefixes both ways, and north-south works end to end.',
    note: 'Connectivity is chosen per workload domain, independently of the management domain. This domain gets its own edge cluster.',
  },
  {
    id: 'TP-506',
    title: 'Workload domain north-south via transit gateway and VNA',
    epic: 'E9',
    story: '9.4 / 9.6',
    critical: true,
    when: (w) => w.connectivity === 'distributed',
    steps: [
      'Confirm THIS domain’s own external VLAN is trunked to every host in this domain — a second Distributed domain does not share the management domain’s.',
      'Confirm this domain’s gateway CIDR is routed by the fabric and its own external IP block is advertised upstream.',
      'Confirm this domain’s private transit block is a /16 and overlaps nothing.',
      'Confirm this domain’s VNA cluster is deployed with at least two appliances, each with its own FQDN and IP on the ESX management subnet, and reports healthy.',
      'Confirm NAT/SNAT works from a workload out to an external destination.',
    ],
    expected:
      'This domain has its own external VLAN, IP block, /16 transit block and healthy 2+ node VNA cluster, with north-south and NAT/SNAT working.',
    note: 'The per-domain point matters: external VLAN, external IP block and VNA cluster are all per-domain inputs, not a share of the management domain’s.',
  },
  {
    id: 'TP-507',
    title: 'Workload domain datapath and availability',
    epic: 'E9',
    story: '9.4 / 9.6',
    steps: [
      'Deploy two test VMs into this domain and apply an anti-affinity rule.',
      'Migrate a running VM until every host in the cluster has both sent and received one.',
      'Hard-power a host off and confirm HA restarts its workload on a survivor, then bring it back and confirm it rejoins.',
      'Measure throughput between VMs on the same host and on different hosts, on both VDS-backed and overlay-backed networks.',
      'Record the measured throughput figures as the actual result.',
    ],
    expected:
      'Migrations succeed across every host, HA restarts workloads after a hard failure, and throughput meets the agreed level on both same-host and cross-host paths.',
  },
  {
    id: 'TP-508',
    title: 'Workload domain witness is deployed and dedicated',
    epic: 'E9',
    story: '9.4',
    critical: true,
    when: (w) => w.stretched,
    steps: [
      'Confirm a witness dedicated to THIS domain is deployed at the third site — separate from the management witness and from any other domain’s.',
      'Confirm it is reachable from both AZ ESX management networks.',
      'Confirm latency from each AZ is within the supported bound.',
    ],
    expected: 'A dedicated witness for this domain is at the third site, reachable from both AZs within the supported latency.',
    note: 'A vSAN witness serves exactly one stretched cluster. Shared-witness applies to 2-node clusters only.',
  },
  {
    id: 'TP-509',
    title: 'Workload domain cluster is stretched and compliant',
    epic: 'E9',
    story: '9.5',
    critical: true,
    when: (w) => w.stretched,
    steps: [
      'Confirm the management domain was stretched FIRST — a workload-domain cluster cannot be stretched before it.',
      'Confirm SDDC Manager reports this cluster stretched with correct fault domains and balanced per-AZ hosts.',
      'Confirm the storage policy is site mirroring and objects report compliant.',
      'Isolate the secondary AZ and confirm workloads survive on the primary; restore it and confirm resync completes and compliance returns.',
    ],
    expected:
      'The cluster reports stretched with correct fault domains and a compliant site-mirroring policy, and survives an AZ isolation with a clean resync afterwards.',
  },
  {
    id: 'TP-510',
    title: 'Supervisor prerequisites are routed and reserved',
    epic: 'E9',
    story: '9.4 / 9.6',
    critical: true,
    when: (w) => w.supervisor,
    steps: [
      'Confirm this domain’s north-south connectivity is already up — activation requires it.',
      'On Centralized connectivity: confirm the Supervisor ingress and egress CIDRs are reserved, non-overlapping, and routed by the fabric.',
      'On Distributed connectivity: confirm the routable external IP block and the /16 private transit-gateway block are in place.',
      'Confirm five consecutive control-plane IP addresses are free and reserved.',
      'Confirm the API FQDN is planned and resolves.',
      'Confirm DRS and HA are enabled on the cluster and the required storage policies exist.',
    ],
    expected:
      'North-south is up, the per-model IP blocks are reserved and routed, five consecutive control-plane addresses and the API FQDN are in place, and DRS/HA/storage policies are ready.',
  },
  {
    id: 'TP-511',
    title: 'Supervisor load balancer is serving',
    epic: 'E9',
    story: '9.4 / 9.6',
    critical: true,
    when: (w) => w.supervisor,
    steps: [
      'Built-in NSX/VPC load balancer: confirm the networking path provides it and that the API endpoint answers on its virtual address.',
      'Foundation load balancer: confirm the appliance pair is deployed active/passive, and that failing the active one keeps the endpoint serving.',
      'Avi load balancer: confirm the controller set for this NSX instance is in place, the cloud connector matches the networking model, and the service engines are deployed PER CLUSTER in this workload domain with at least two per cluster for HA.',
      'Whatever the choice, confirm the Supervisor API address is reachable and serving.',
    ],
    expected: 'The chosen load balancer is deployed and serving the Supervisor API address, with redundancy proven where the model provides it.',
    note: 'Supervisor needs A load balancer, not specifically a premium one. The built-in NSX/VPC option and the Foundation load balancer both satisfy it. Controllers, where used, always live in the management domain — only service engines distribute.',
  },
  {
    id: 'TP-512',
    title: 'Supervisor is enabled and the control plane is usable',
    epic: 'E9',
    story: '9.4 / 9.6',
    critical: true,
    when: (w) => w.supervisor,
    steps: [
      'Confirm the three control-plane VMs are running.',
      'Confirm the Supervisor reports a running, ready state and the chosen control-plane size matches the design.',
      'Log in with the command-line client against the API FQDN — over its published name, not an IP, so DNS and the certificate are exercised.',
      'Create a namespace, confirm it reports running and active, and assign permissions and resource limits to it.',
      'Run a workload in that namespace and confirm it starts, gets its networking, and is reachable per the design.',
      'Delete the namespace and confirm it is fully cleaned up.',
    ],
    expected:
      'The control plane is running, command-line login over the published FQDN works, and a namespace can be created, run a reachable workload, and be deleted cleanly.',
    note: 'Confirming three VMs are powered on is not evidence the Supervisor is usable. Log in and run something.',
  },
  {
    id: 'TP-513',
    title: 'Kubernetes content is available and a guest cluster lifecycles cleanly',
    epic: 'E9',
    story: '9.4 / 9.6',
    when: (w) => w.supervisor,
    steps: [
      'Confirm the Kubernetes content library is configured and has synced — with an offline site, confirm the images were imported.',
      'Confirm the expected image versions are available.',
      'Provision a guest cluster and confirm it reaches a ready state with all nodes joined.',
      'Run a workload on it and confirm it is reachable.',
      'DELETE the guest cluster and confirm every resource is released — nodes, addresses and volumes.',
    ],
    expected: 'The content library is synced with the expected images, and a guest cluster provisions, runs a workload, and deletes cleanly with nothing left behind.',
  },
];

// --- TP-6 — Validation & handover (E10) -----------------------------------

const TP6: Entry[] = [
  {
    id: 'TP-601',
    title: 'Final health check of the complete environment',
    epic: 'E10',
    story: '10.1',
    critical: true,
    steps: [
      'Re-run the platform health check against the FINAL state, after every domain and Day-2 component is in place — an early clean run does not describe the environment being handed over.',
      'Re-check storage health on every cluster in every domain.',
      'Confirm no component reports a version or build inconsistency.',
      'Triage every finding: fixed, accepted with a reason, or scheduled with an owner.',
    ],
    expected: 'The final-state health check is clean, or every finding is triaged with an owner and a decision.',
  },
  {
    id: 'TP-602',
    title: 'No unexplained active alerts',
    epic: 'E10',
    story: '10.1',
    steps: [
      'Review active alerts across the fleet.',
      'For each one, either resolve it or record why it is expected and accepted.',
      'Confirm the self-health dashboards are green.',
    ],
    expected: 'Every active alert is either resolved or explicitly accepted with a written reason.',
  },
  {
    id: 'TP-603',
    title: 'As-built is complete',
    epic: 'E10',
    story: '10.2',
    steps: [
      'Confirm the as-built records every FQDN, IP, VLAN and subnet actually deployed — the as-deployed state, not the plan.',
      'Confirm the deployment JSON specification and any stretch specification are stored with the engagement records.',
      'Confirm the network and connectivity model is documented, including the per-domain choices.',
      'Confirm the backup configuration, its target and its schedule are documented.',
    ],
    expected: 'The as-built reflects the deployed environment, with specifications and backup configuration stored alongside.',
  },
  {
    id: 'TP-604',
    title: 'Every credential is in the secret store',
    epic: 'E10',
    story: '10.2',
    critical: true,
    steps: [
      'Confirm all auto-generated component passwords from bring-up are stored.',
      'Confirm the host root passwords, appliance shell credentials, and directory bind account are stored.',
      'Confirm the backup encryption passphrase is stored.',
      'Confirm the load-balancer controller passphrase and the SSP Installer credentials are stored, where those components are in scope.',
      'Confirm the break-glass local account is stored and documented.',
      'Spot-check several entries by logging in with them.',
    ],
    expected: 'Every credential the environment depends on is in the secret store and spot-checked as working.',
    note: 'There is no reveal API for VCF-managed passwords — management is rotate-and-expire only. Anything not captured here is unrecoverable without a rotation.',
  },
  {
    id: 'TP-605',
    title: 'Test results are complete and evidenced',
    epic: 'E10',
    story: '10.3',
    critical: true,
    steps: [
      'Confirm every in-scope case has a status, a date and an actual result.',
      'Confirm every pass has filed evidence — a screenshot, log excerpt or API response.',
      'Confirm every non-critical failure has a named owner and an agreed date.',
      'Confirm every not-applicable has a written reason.',
      'Confirm no critical failure remains open.',
    ],
    expected: 'All cases are executed and evidenced, no critical failure is open, and every non-critical failure and exclusion is owned and explained.',
  },
  {
    id: 'TP-606',
    title: 'Security baseline is applied or its deviations are accepted',
    epic: 'E10',
    story: '10.3',
    steps: [
      'Confirm the highest-priority hardening controls are either applied or carry a documented, accepted deviation.',
      'Confirm the installer appliance was powered off or removed after bring-up — unless it became SDDC Manager, in which case it stays.',
      'Confirm every deviation records the parameter, the chosen value, the reason, and any compensating control.',
    ],
    expected: 'Top-priority controls are compliant or carry an accepted, documented deviation, and the installer has been dealt with correctly.',
    note: 'Sequence hardening against this plan: powering off the installer belongs after bring-up is verified, and disabling API basic authentication will break any tooling that still uses it.',
  },
  {
    id: 'TP-607',
    title: 'Operations team walkthrough and sign-off',
    epic: 'E10',
    story: '10.3',
    critical: true,
    steps: [
      'Walk the operations team through the platform: topology, the connectivity model per domain, where to look when something breaks.',
      'Walk through backup and restore, including where the passphrase lives.',
      'Walk through lifecycle: the depot, how updates are applied, and the certificate and licence expiry dates.',
      'Hand over the as-built and the completed test results.',
      'Obtain written sign-off.',
    ],
    expected: 'The operations team has been walked through the platform and its lifecycle, has the as-built and results, and has signed off.',
  },
];

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function pick(entries: Entry[], sel: Selection): TestCase[] {
  return entries.filter((e) => !e.when || e.when(sel)).map(({ when: _when, ...c }) => c);
}

function pickWld(entries: WldEntry[], w: Wld, sel: Selection): TestCase[] {
  return entries.filter((e) => !e.when || e.when(w, sel)).map(({ when: _when, ...c }) => c);
}

/** The phases — and within them, the cases — that apply to this scope. */
export function selectedPhases(raw: Selection): TestPhase[] {
  const sel = normalizeSelection(raw);
  const phases: TestPhase[] = [
    {
      id: 'TP-0',
      title: 'Readiness',
      gate: 'The pre-bring-up go/no-go. Everything the plan called for has actually been built.',
      epics: 'E1–E4',
      cases: pick(TP0, sel),
    },
    {
      id: 'TP-1',
      title: 'Management bring-up',
      gate: 'Bring-up completed and the management fleet is healthy.',
      epics: 'E5',
      cases: pick(TP1, sel),
    },
    {
      id: 'TP-2',
      title: 'Management configuration',
      gate: 'North-south connectivity, availability, and backup are proven.',
      epics: 'E6',
      cases: pick(TP2, sel),
    },
  ];

  if (sel.mgmtStretched) {
    phases.push({
      id: 'TP-3',
      title: 'Stretch the management domain',
      gate: 'The management cluster survives the loss of an availability zone.',
      epics: 'E7',
      cases: pick(TP3, sel),
    });
  }

  const tp4 = pick(TP4, sel);
  if (tp4.length) {
    phases.push({
      id: 'TP-4',
      title: 'Day-2 fleet',
      gate: 'Every deferred and added component is healthy, certified, licensed and integrated.',
      epics: 'E8',
      cases: tp4,
    });
  }

  sel.wlds.forEach((w, i) => {
    phases.push({
      id: `TP-5.${i + 1}`,
      title: `Workload domain — ${w.name}`,
      gate: 'The domain is healthy, north-south works, and workloads can be placed.',
      epics: 'E9',
      wld: { index: i, name: w.name },
      cases: pickWld(TP5, w, sel),
    });
  });

  phases.push({
    id: 'TP-6',
    title: 'Validation & handover',
    gate: 'The complete environment is verified, evidenced, and signed off.',
    epics: 'E10',
    cases: pick(TP6, sel),
  });

  return phases;
}

/** Total in-scope cases, counting a per-WLD case once per domain. */
export function caseCount(sel: Selection): number {
  return selectedPhases(sel).reduce((n, p) => n + p.cases.length, 0);
}

export interface TestStats {
  total: number;
  executed: number;
  passed: number;
  criticalOpen: number;
  perPhase: Record<string, { total: number; executed: number; passed: number; criticalOpen: number }>;
}

export function testStats(sel: Selection, results: TestResults): TestStats {
  const stats: TestStats = { total: 0, executed: 0, passed: 0, criticalOpen: 0, perPhase: {} };
  for (const p of selectedPhases(sel)) {
    const per = { total: 0, executed: 0, passed: 0, criticalOpen: 0 };
    for (const c of p.cases) {
      const r = results[caseKey(p, c)];
      per.total++;
      if (r?.status) per.executed++;
      if (r?.status === 'P' || r?.status === 'NA') per.passed++;
      if (r?.status === 'F1') per.criticalOpen++;
    }
    stats.perPhase[p.id] = per;
    stats.total += per.total;
    stats.executed += per.executed;
    stats.passed += per.passed;
    stats.criticalOpen += per.criticalOpen;
  }
  return stats;
}

export const RESULTS_STORE_KEY = 'vcf9-test-results-v1';

/** Defensive load of a results object from untrusted JSON. */
export function coerceResults(data: unknown): TestResults {
  const out: TestResults = {};
  if (!data || typeof data !== 'object') return out;
  const valid: TestStatus[] = ['P', 'F1', 'F2', 'NA'];
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.status !== 'string' || !valid.includes(r.status as TestStatus)) continue;
    out[k] = {
      status: r.status as TestStatus,
      date: typeof r.date === 'string' ? r.date : '',
      actual: typeof r.actual === 'string' ? r.actual : undefined,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<TestStatus, string> = {
  P: 'Pass',
  F1: 'Critical fail',
  F2: 'Non-critical fail',
  NA: 'N/A',
};

export function buildTestMarkdown(raw: Selection, results: TestResults = {}): string {
  const sel = normalizeSelection(raw);
  const phases = selectedPhases(sel);
  const stats = testStats(sel, results);
  const out: string[] = [];

  out.push('# VCF 9.1 — Test Plan', '');
  out.push(
    `Generated from the deployment scope. **${stats.total}** cases across **${phases.length}** phases; ` +
      `**${stats.executed}** executed, **${stats.passed}** passed or N/A, **${stats.criticalOpen}** critical failures open.`,
    '',
  );
  out.push(
    'Status codes: `P` pass · `F1` critical failure (blocks the phase gate and handover) · ' +
      '`F2` non-critical failure (proceed with a named owner and a date) · `NA` not applicable (record why).',
    '',
    'A phase does not start until the prior phase has no open `F1`. A pass needs an actual result and filed evidence — a tick on its own is not a pass.',
    '',
  );

  for (const p of phases) {
    const per = stats.perPhase[p.id];
    out.push(`## ${p.id} — ${p.title}`, '');
    out.push(`*Covers ${p.epics}. Gate: ${p.gate}*`, '');
    out.push(`${per.executed}/${per.total} executed · ${per.passed} passed or N/A · ${per.criticalOpen} critical open`, '');
    for (const c of p.cases) {
      const r = results[caseKey(p, c)];
      const status = r?.status ? `${STATUS_LABEL[r.status]}${r.date ? ` (${r.date})` : ''}` : 'Not executed';
      out.push(`### ${c.id} — ${c.title}`, '');
      out.push(`**Epic ${c.epic} · Story ${c.story}**${c.critical ? ' · **Critical**' : ''} · Status: ${status}`, '');
      out.push('Steps:', '');
      for (const s of c.steps) out.push(`1. ${s}`);
      out.push('', `**Expected:** ${c.expected}`, '');
      if (c.note) out.push(`> ${c.note}`, '');
      if (r?.actual) out.push(`**Actual:** ${r.actual}`, '');
    }
  }

  out.push('---', '');
  out.push(
    '## Exit criteria',
    '',
    '- Every in-scope case is `P`, `F2` or `NA` — no open `F1`.',
    '- Every `F2` has a named owner and an agreed date.',
    '- Every `NA` has a written reason.',
    '- Every `P` has an actual result and filed evidence.',
    '- The as-built is complete and every credential is in the secret store.',
    '',
  );
  return out.join('\n');
}

/**
 * Exit-criteria audit. The plan's own rule is that a tick on its own is not a
 * pass and an exclusion needs a reason, so the report checks its own evidence
 * rather than reporting a clean sheet that nobody can stand behind.
 */
export interface ReportIssues {
  /** Cases marked P with no actual result / evidence reference recorded. */
  passNoEvidence: { id: string; title: string; phase: string }[];
  /** F2 / NA with no reason recorded — an unowned action or an unexplained exclusion. */
  noReason: { id: string; title: string; phase: string; status: TestStatus }[];
  /** In-scope cases never executed. */
  notExecuted: { id: string; title: string; phase: string; critical: boolean }[];
}

export function reportIssues(raw: Selection, results: TestResults): ReportIssues {
  const sel = normalizeSelection(raw);
  const out: ReportIssues = { passNoEvidence: [], noReason: [], notExecuted: [] };
  for (const p of selectedPhases(sel)) {
    for (const c of p.cases) {
      const r = results[caseKey(p, c)];
      const where = `${p.id} — ${p.title}`;
      if (!r?.status) {
        out.notExecuted.push({ id: c.id, title: c.title, phase: where, critical: !!c.critical });
        continue;
      }
      const hasReason = !!r.actual && r.actual.trim().length > 0;
      if (r.status === 'P' && !hasReason) out.passNoEvidence.push({ id: c.id, title: c.title, phase: where });
      if ((r.status === 'F2' || r.status === 'NA') && !hasReason)
        out.noReason.push({ id: c.id, title: c.title, phase: where, status: r.status });
    }
  }
  return out;
}

/**
 * Delivery report. Shaped for handover: verdict, per-phase summary, the open
 * items someone has to act on, and a full results appendix — WITHOUT the test
 * steps, which belong in the runbook export rather than in a report.
 */
export function buildTestReport(raw: Selection, results: TestResults = {}, preparedOn = ''): string {
  const sel = normalizeSelection(raw);
  const phases = selectedPhases(sel);
  const stats = testStats(sel, results);
  const issues = reportIssues(sel, results);
  const out: string[] = [];

  const notExecuted = stats.total - stats.executed;
  const f2 = phases.reduce(
    (n, p) => n + p.cases.filter((c) => results[caseKey(p, c)]?.status === 'F2').length,
    0,
  );
  const na = phases.reduce(
    (n, p) => n + p.cases.filter((c) => results[caseKey(p, c)]?.status === 'NA').length,
    0,
  );
  const passed = stats.passed - na;

  out.push('# VCF 9.1 — Verification Report', '');
  if (preparedOn) out.push(`**Prepared:** ${preparedOn}  `);
  out.push(`**Scope:** ${typeLabel(sel)}  `, `**Deployment plan epics:** ${includedEpicList(sel)}`, '');

  // Verdict first — the reader wants to know whether this environment is signed off.
  const verdict =
    stats.criticalOpen > 0
      ? `**NOT ACCEPTED** — ${stats.criticalOpen} critical failure${stats.criticalOpen === 1 ? '' : 's'} open.`
      : notExecuted > 0
        ? `**INCOMPLETE** — ${notExecuted} of ${stats.total} case${stats.total === 1 ? '' : 's'} not executed.`
        : f2 > 0
          ? `**ACCEPTED WITH ACTIONS** — all critical cases pass; ${f2} non-critical failure${f2 === 1 ? ' carried as an action' : 's carried as actions'}.`
          : '**ACCEPTED** — all in-scope cases pass or are recorded as not applicable.';
  out.push('## Verdict', '', verdict, '');

  out.push('| Result | Cases |', '| --- | ---: |');
  out.push(`| Passed | ${passed} |`);
  out.push(`| Critical failures (F1) | ${stats.criticalOpen} |`);
  out.push(`| Non-critical failures (F2) | ${f2} |`);
  out.push(`| Not applicable | ${na} |`);
  out.push(`| Not executed | ${notExecuted} |`);
  out.push(`| **Total in scope** | **${stats.total}** |`, '');

  out.push('## Results by phase', '');
  out.push('| Phase | Covers | Executed | Passed / N/A | Critical open |', '| --- | --- | ---: | ---: | ---: |');
  for (const p of phases) {
    const per = stats.perPhase[p.id];
    out.push(
      `| ${p.id} — ${p.title} | ${p.epics} | ${per.executed}/${per.total} | ${per.passed} | ${per.criticalOpen} |`,
    );
  }
  out.push('');

  // Everything below is an action list: what someone still has to do.
  const section = (heading: string, lead: string, rows: string[]) => {
    if (!rows.length) return;
    out.push(`## ${heading}`, '', lead, '', '| Case | Phase | Detail |', '| --- | --- | --- |', ...rows, '');
  };

  section(
    'Open critical failures',
    'These block handover. Each must be resolved and retested.',
    phases.flatMap((p) =>
      p.cases
        .filter((c) => results[caseKey(p, c)]?.status === 'F1')
        .map((c) => `| ${c.id} — ${c.title} | ${p.id} | ${results[caseKey(p, c)]?.actual || '_(no detail recorded)_'} |`),
    ),
  );
  section(
    'Non-critical failures carried as actions',
    'Handover proceeds, but each needs a named owner and an agreed date.',
    phases.flatMap((p) =>
      p.cases
        .filter((c) => results[caseKey(p, c)]?.status === 'F2')
        .map((c) => `| ${c.id} — ${c.title} | ${p.id} | ${results[caseKey(p, c)]?.actual || '_(no owner or date recorded)_'} |`),
    ),
  );
  section(
    'Not applicable',
    'Cases excluded from scope, with the reason recorded.',
    phases.flatMap((p) =>
      p.cases
        .filter((c) => results[caseKey(p, c)]?.status === 'NA')
        .map((c) => `| ${c.id} — ${c.title} | ${p.id} | ${results[caseKey(p, c)]?.actual || '_(no reason recorded)_'} |`),
    ),
  );
  section(
    'Not executed',
    'In-scope cases with no result. The report is incomplete until these are run or explicitly excluded.',
    issues.notExecuted.map((i) => `| ${i.id} — ${i.title} | ${i.phase.split(' — ')[0]} | ${i.critical ? 'Critical' : ''} |`),
  );

  if (issues.passNoEvidence.length || issues.noReason.length) {
    out.push('## Report quality', '');
    out.push(
      'The plan requires an actual result or evidence reference behind every pass, and a written reason behind every action or exclusion. The following entries are incomplete.',
      '',
    );
    if (issues.passNoEvidence.length) {
      out.push(`- **${issues.passNoEvidence.length} pass${issues.passNoEvidence.length === 1 ? '' : 'es'} with no evidence recorded:** ${issues.passNoEvidence.map((i) => i.id).join(', ')}`);
    }
    if (issues.noReason.length) {
      out.push(`- **${issues.noReason.length} action${issues.noReason.length === 1 ? '' : 's'} or exclusion${issues.noReason.length === 1 ? '' : 's'} with no reason recorded:** ${issues.noReason.map((i) => i.id).join(', ')}`);
    }
    out.push('');
  }

  out.push('## Full results', '');
  for (const p of phases) {
    out.push(`### ${p.id} — ${p.title}`, '');
    out.push('| Case | Title | Status | Date | Actual result / evidence |', '| --- | --- | --- | --- | --- |');
    for (const c of p.cases) {
      const r = results[caseKey(p, c)];
      const status = r?.status ? STATUS_LABEL[r.status] : 'Not executed';
      const title = `${c.title}${c.critical ? ' _(critical)_' : ''}`;
      out.push(`| ${c.id} | ${title} | ${status} | ${r?.date || ''} | ${(r?.actual || '').replace(/\|/g, '\\|')} |`);
    }
    out.push('');
  }

  out.push('---', '');
  out.push(
    '_Test steps are omitted here by design; the executed procedure is in the runbook export. ' +
      'Status codes: Pass · Critical fail (blocks handover) · Non-critical fail (action) · N/A (out of scope)._',
    '',
  );
  return out.join('\n');
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildTestCsv(raw: Selection, results: TestResults = {}): string {
  const sel = normalizeSelection(raw);
  const rows: string[] = [
    ['Phase', 'Phase Title', 'Domain', 'Case ID', 'Title', 'Epic', 'Story', 'Critical', 'Steps', 'Expected', 'Note', 'Status', 'Date', 'Actual Results']
      .map(csvCell)
      .join(','),
  ];
  for (const p of selectedPhases(sel)) {
    for (const c of p.cases) {
      const r = results[caseKey(p, c)];
      rows.push(
        [
          p.id,
          p.title,
          p.wld?.name ?? '',
          c.id,
          c.title,
          c.epic,
          c.story,
          c.critical ? 'Yes' : 'No',
          c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
          c.expected,
          c.note ?? '',
          r?.status ?? '',
          r?.date ?? '',
          r?.actual ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return rows.join('\n');
}
