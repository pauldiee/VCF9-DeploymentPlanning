// Structured mirror of docs/06-deployment-plan.md, used by the interactive
// export tool (src/pages/tools/deployment-plan.astro). The markdown doc stays
// the human-readable source of truth; keep this in sync when it changes.
//
// Model: core epics E1–E6 and E10 always apply. On top, the selection adds:
//   - E8  when the management domain is stretched
//   - E9  when the Day-2 fleet is deployed
//   - one E7 epic per workload domain (each independently non-stretched or
//     stretched — a stretched WLD gets its own hosts and its own vSAN witness)
// Execution order: E1–E6 → E8? → E9? → each WLD → E10.

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
}

export interface Selection {
  mgmtStretched: boolean;
  day2: boolean;
  wlds: Wld[];
}

export function defaultSelection(): Selection {
  // Common build: single non-stretched WLD + Day-2 fleet, management not stretched.
  return { mgmtStretched: false, day2: true, wlds: [{ name: 'wld01', stretched: false }] };
}

// ---- Core epics (always) ---------------------------------------------------

const CORE_PRE: Epic[] = [
  {
    id: 'E1',
    title: 'Prerequisites & readiness gate',
    owner: 'Arch + Cust',
    ref: 'prerequisites.md',
    stories: [
      {
        id: '1.1',
        title: 'Hardware ready',
        tasks: ['Hosts on the VCG, matched spec, BOM confirmed.', 'Confirm CPU/RAM/storage per host against the sizing output (E3).'],
        acceptance: 'Every host model on the Broadcom compatibility guide; even, matched counts.',
      },
      {
        id: '1.2',
        title: 'Physical network ready',
        tasks: [
          'Trunk the required VLANs to host uplinks; set MTU 9000 on jumbo networks.',
          'Configure the ToR BGP fabric (AS numbers, peer IPs) for the NSX edges.',
        ],
        acceptance: 'VLAN/MTU/BGP verified against the Step 1 plan (E2).',
      },
      {
        id: '1.3',
        title: 'Core services ready',
        tasks: ['AD, DNS, NTP, CA, depot reachable.'],
        acceptance: 'Forward+reverse DNS resolves; NTP in sync; CA reachable; depot/binaries staged.',
      },
      {
        id: '1.4',
        title: 'Access ready',
        tasks: ['Jump host / management access into the environment.'],
        acceptance: 'The prerequisite gate is fully green before any build starts.',
      },
    ],
  },
  {
    id: 'E2',
    title: 'Network, DNS & routing plan',
    owner: 'Net + AD',
    ref: '01-network-dns-plan.md',
    stories: [
      { id: '2.1', title: 'VLAN / subnet plan', tasks: ['Lock every management VLAN, subnet, MTU, gateway, and the IP carve-out.'], acceptance: 'One-page plan signed by the network owner; no overlapping ranges.' },
      { id: '2.2', title: 'BGP plan', tasks: ['Edge AS, ToR AS, peer IPs, MD5, BFD, advertised/received routes.'], acceptance: 'BGP parameters agreed with the fabric team.' },
      { id: '2.3', title: 'DNS & NTP records', tasks: ['All A + PTR records created; NTP sources confirmed.'], acceptance: 'Every appliance FQDN resolves both ways.' },
      { id: '2.4', title: 'Certificates', tasks: ['CA type, template, and signing approach decided.'], acceptance: 'CA reachable and the cert template validated.' },
    ],
  },
  {
    id: 'E3',
    title: 'Intake & sizing',
    owner: 'Arch + all role teams',
    ref: '02-customer-intake.md, 04-sizing.md',
    stories: [
      { id: '3.1', title: 'Role-based intake complete', tasks: ['Sections A–F answered by their owners.'], acceptance: 'Every intake question has an answer or an explicit N/A.' },
      { id: '3.2', title: 'Sizing & host fit', tasks: ['Run the sizing calculator; confirm the fleet fits the proposed hosts at N-1.'], acceptance: 'Fit check passes (or hosts adjusted); sizing signed off.' },
    ],
  },
  {
    id: 'E4',
    title: 'Workbook & deployment-JSON prep',
    owner: 'Arch + Plat',
    ref: 'workbook-cell-mapping.md',
    stories: [
      { id: '4.1', title: 'Fill the P&P workbook', tasks: ["Transfer intake answers into the official workbook — or use Coscia's VCF Planner (https://vcfplanning.lcoscia.fr/) for an easier fillable form with live validation that also doubles as an as-built record (JSON/Markdown/CSV export)."], acceptance: 'Workbook complete; no red validation warnings.' },
      { id: '4.2', title: 'Generate the deployment JSON', tasks: ['Produce the bring-up JSON (e.g. VCF.JSONGenerator) from the filled workbook.'], acceptance: 'JSON generated and reviewed against the plan.' },
    ],
  },
  {
    id: 'E5',
    title: 'Management domain bring-up',
    owner: 'Plat',
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
        ],
      },
      {
        id: '5.3',
        title: 'Deploy the management domain',
        tasks: ['Run bring-up: the Installer validates the prepared hosts, then builds vCenter, SDDC Manager, NSX, and vSAN; submit the JSON.'],
        acceptance: 'Bring-up completes; SDDC Manager healthy; vSAN datastore online.',
      },
    ],
  },
  {
    id: 'E6',
    title: 'Management domain configuration',
    owner: 'Plat + Net + Sec',
    stories: [
      { id: '6.1', title: 'NSX edges & north-south', tasks: ['Deploy edges; establish BGP peering to the ToRs; verify routes.'] },
      {
        id: '6.2',
        title: 'Certificates (optional / partial here)',
        tasks: [
          'Optional here: you can replace certificates for the components deployed so far, but the full CA-signed replacement is usually done once all components exist — after the Day-2 fleet — so the whole fleet is certified in one pass (see E9 story 9.5).',
        ],
      },
      {
        id: '6.3',
        title: 'Identity & roles (optional, not recommended here)',
        tasks: [
          'Optional and not recommended at this stage: you can bind vCenter SSO directly to AD/LDAP for early management access, but the recommended approach is fleet-wide SSO via the VCF Identity Broker (a Day-2 component; see E9 / 05-day2-deployments.md). Prefer deferring identity to Day-2; only bind vCenter SSO here if you genuinely need AD admin access before the fleet is up, then map admin/operator/viewer groups.',
        ],
      },
      {
        id: '6.4',
        title: 'Backup & lifecycle',
        tasks: ['Configure SFTP backups; connect the depot; apply licensing.'],
        acceptance: 'North-south routing verified; SFTP backups run; depot connected; licensing applied. (Full fleet certificates + AD SSO are finalized Day-2 — see E9 9.5.)',
      },
    ],
  },
];

// ---- Management-domain stretch (E8) ----------------------------------------

const E8_MGMT_STRETCH: Epic = {
  id: 'E8',
  title: 'Stretch the management domain',
  owner: 'Net + Arch + Storage',
  ref: '03-multi-az-prep.md',
  stories: [
    {
      id: '8.1',
      title: 'Witness site (management)',
      tasks: ['Deploy the vSAN witness appliance for the management cluster at the third site; route it to both AZ ESX-management networks.'],
    },
    { id: '8.2', title: 'Inter-AZ fabric', tasks: ['Verify <5 ms RTT, ≥10 Gbps, MTU 9000, HA L3 gateway between AZs.'] },
    {
      id: '8.3',
      title: 'Install, configure & commission the second-AZ hosts',
      tasks: [
        `Image the AZ2 management hosts with the supported ESXi ISO (see the VCFHostPreparation repo — ${HOST_PREP_REPO} — to prep + commission hosts quickly); configure the per-AZ management network (IP / VLAN / gateway), DNS, NTP, and root; then commission them into SDDC Manager, ready for the stretch.`,
      ],
      acceptance: 'AZ2 hosts reachable on their per-AZ management network with the matched ESXi build; commissioned and available in SDDC Manager.',
    },
    {
      id: '8.4',
      title: 'Stretch the cluster',
      tasks: ['Configure fault domains (preferred/secondary/witness); per-AZ networks; storage policy for the dual-site mirror (~2× capacity).'],
      acceptance: 'Stretched cluster compliant; an AZ-failure test survives on the surviving site.',
    },
  ],
};

// ---- Day-2 fleet (E9) ------------------------------------------------------

const E9_DAY2: Epic = {
  id: 'E9',
  title: 'Day-2 fleet deployment',
  owner: 'Plat',
  ref: '05-day2-deployments.md',
  stories: [
    { id: '9.1', title: 'Network placement', tasks: ['Decide Shared / Dedicated / NSX Overlay / NSX VLAN Segment; build the network if non-shared.'] },
    {
      id: '9.2',
      title: 'VCF Operations',
      tasks: [
        'Deploy Operations (+ Cloud Proxy, License Server).',
        'Decide the cluster address: floating IP (default) or an external load-balancer VIP — VCF never provides the LB for Operations, so if a VIP is wanted, provision the external LB and add its FQDN to the cert SAN first.',
      ],
    },
    { id: '9.3', title: 'VCF Automation', tasks: ['Deploy via SDDC Manager API or via VCF Operations; set the services-runtime cluster CIDR.'] },
    { id: '9.4', title: 'Ops for Logs / Networks & Identity Broker', tasks: ['Deploy the remaining fleet components as needed.'], acceptance: 'Each Day-2 component healthy; the fleet synthetic check passes.' },
    {
      id: '9.5',
      title: 'Certificates & identity (full fleet)',
      tasks: [
        'Now that all components exist, do the full CA-signed certificate replacement across the whole fleet in one pass, and complete fleet SSO via the VCF Identity Broker (the recommended identity path, deferred from E6 6.3).',
      ],
      acceptance: 'Every fleet endpoint presents a CA-signed cert with no trust warnings; AD/LDAP SSO via the Identity Broker works.',
    },
  ],
};

// ---- Validation & handover (E10, always last) ------------------------------

const E10_HANDOVER: Epic = {
  id: 'E10',
  title: 'Validation & handover',
  owner: 'Arch + all',
  stories: [
    { id: '10.1', title: 'Health check', tasks: ['Run a post-deploy health check of the live environment.'] },
    { id: '10.2', title: 'As-built', tasks: ['Capture the as-built (FQDNs, IPs, VLANs, passwords in the secret store).'] },
    { id: '10.3', title: 'Handover', tasks: ['Walk the customer through operations and hand over.'], acceptance: 'Health check clean; as-built delivered; customer sign-off.' },
  ],
};

// ---- Per-WLD epic (E7), non-stretched or stretched -------------------------

function wldEpicId(index: number): string {
  return index === 0 ? 'E7' : `E7-${index + 1}`;
}

function wldEpic(w: Wld, index: number): Epic {
  const name = (w.name || `wld${index + 1}`).trim();
  const id = wldEpicId(index);
  const hostPrep = `see the VCFHostPreparation repo — ${HOST_PREP_REPO} — to prep + commission hosts quickly`;

  if (w.stretched) {
    return {
      id,
      title: `Workload domain: ${name} (stretched)`,
      owner: 'Plat + Net + Storage',
      ref: '02-customer-intake.md section H, 03-multi-az-prep.md',
      stories: [
        { id: '7.1', title: 'WLD network prep (per-AZ)', tasks: ['Provision the per-WLD VLANs/subnets across both AZs (per-AZ networks) and the 5 IPs the WLD consumes on the mgmt VM-mgmt subnet.'] },
        {
          id: '7.2',
          title: 'Prepare & commission the WLD hosts (both AZs)',
          tasks: [`Image the WLD hosts in both AZs with the supported ESXi ISO (${hostPrep}); configure the per-AZ management networks, DNS, NTP; then commission them into SDDC Manager.`],
          acceptance: 'WLD hosts in both AZs reachable, matched ESXi build, commissioned in SDDC Manager.',
        },
        { id: '7.3', title: 'Deploy the WLD', tasks: ['vCenter + NSX (shared or dedicated) + first cluster.'] },
        {
          id: '7.4',
          title: 'WLD witness',
          tasks: ['Deploy a dedicated vSAN witness appliance for THIS WLD at the third site (one witness per stretched cluster — separate from the management witness); route it to both AZ ESX-management networks.'],
        },
        {
          id: '7.5',
          title: 'Stretch the WLD cluster',
          tasks: ['Configure fault domains (preferred/secondary/witness); per-AZ networks; storage policy for the dual-site mirror (~2× capacity). Edge stretched only under NSX Centralized connectivity.'],
          acceptance: 'Stretched WLD compliant; an AZ-failure test survives on the surviving site.',
        },
        { id: '7.6', title: 'WLD connectivity', tasks: ['Edges / uplinks (Centralized or Distributed); optional vSphere Supervisor.'], acceptance: 'WLD healthy in SDDC Manager; workloads can be placed.' },
      ],
    };
  }

  return {
    id,
    title: `Workload domain: ${name}`,
    owner: 'Plat + Net',
    ref: '02-customer-intake.md section H',
    stories: [
      { id: '7.1', title: 'WLD network prep', tasks: ['Provision the per-WLD VLANs/subnets (Step 1) and the 5 IPs the WLD consumes on the mgmt VM-mgmt subnet.'] },
      {
        id: '7.2',
        title: 'Prepare & commission the WLD hosts',
        tasks: [`Image the WLD hosts with the supported ESXi ISO (${hostPrep}); configure the management network, DNS, NTP; then commission them into SDDC Manager.`],
        acceptance: 'WLD hosts reachable, matched ESXi build, commissioned in SDDC Manager.',
      },
      { id: '7.3', title: 'Deploy the WLD', tasks: ['vCenter + NSX (shared or dedicated) + first cluster.'] },
      { id: '7.4', title: 'WLD connectivity', tasks: ['Edges / uplinks (Centralized or Distributed); optional vSphere Supervisor.'], acceptance: 'WLD healthy in SDDC Manager; workloads can be placed.' },
    ],
  };
}

// ---- Assembly --------------------------------------------------------------

/** The epics that apply given a selection, in execution order. */
export function selectedEpics(sel: Selection): Epic[] {
  const out: Epic[] = [...CORE_PRE];
  if (sel.mgmtStretched) out.push(E8_MGMT_STRETCH);
  if (sel.day2) out.push(E9_DAY2);
  sel.wlds.forEach((w, i) => out.push(wldEpic(w, i)));
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

/** Comma-list of included epic ids, e.g. "E1–E6, E8, E9, E7, E10". */
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
  L.push('Owner key: **Arch** = solution architect · **Net** = network · **AD** = AD/DNS/NTP · **PKI** = certificate team · **Plat** = platform/VMware · **Sec** = security · **Cust** = customer teams.');
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
