// Structured mirror of docs/06-deployment-plan.md, used by the interactive
// export tool (src/pages/tools/deployment-plan.astro). The markdown doc stays
// the human-readable source of truth; keep this in sync when it changes.
//
// Core epics apply to every deployment. Variant epics switch on via their
// `variant` key: 'wld' (Type B), 'stretched' (Type C), 'day2' (Type D).

export type Variant = 'wld' | 'stretched' | 'day2';

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
  variant?: Variant; // undefined => core epic (always included)
  stories: Story[];
}

// Ordered in execution order: core E1–E6, then the variants, then E10 (handover
// is always last).
export const EPICS: Epic[] = [
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
      {
        id: '2.1',
        title: 'VLAN / subnet plan',
        tasks: ['Lock every management VLAN, subnet, MTU, gateway, and the IP carve-out.'],
        acceptance: 'One-page plan signed by the network owner; no overlapping ranges.',
      },
      {
        id: '2.2',
        title: 'BGP plan',
        tasks: ['Edge AS, ToR AS, peer IPs, MD5, BFD, advertised/received routes.'],
        acceptance: 'BGP parameters agreed with the fabric team.',
      },
      {
        id: '2.3',
        title: 'DNS & NTP records',
        tasks: ['All A + PTR records created; NTP sources confirmed.'],
        acceptance: 'Every appliance FQDN resolves both ways.',
      },
      {
        id: '2.4',
        title: 'Certificates',
        tasks: ['CA type, template, and signing approach decided.'],
        acceptance: 'CA reachable and the cert template validated.',
      },
    ],
  },
  {
    id: 'E3',
    title: 'Intake & sizing',
    owner: 'Arch + all role teams',
    ref: '02-customer-intake.md, 04-sizing.md',
    stories: [
      {
        id: '3.1',
        title: 'Role-based intake complete',
        tasks: ['Sections A–F answered by their owners.'],
        acceptance: 'Every intake question has an answer or an explicit N/A.',
      },
      {
        id: '3.2',
        title: 'Sizing & host fit',
        tasks: ['Run the sizing calculator; confirm the fleet fits the proposed hosts at N-1.'],
        acceptance: 'Fit check passes (or hosts adjusted); sizing signed off.',
      },
    ],
  },
  {
    id: 'E4',
    title: 'Workbook & deployment-JSON prep',
    owner: 'Arch + Plat',
    ref: 'workbook-cell-mapping.md',
    stories: [
      {
        id: '4.1',
        title: 'Fill the P&P workbook',
        tasks: ['Transfer intake answers into the official workbook.'],
        acceptance: 'Workbook complete; no red validation warnings.',
      },
      {
        id: '4.2',
        title: 'Generate the deployment JSON',
        tasks: ['Produce the bring-up JSON (e.g. VCF.JSONGenerator) from the filled workbook.'],
        acceptance: 'JSON generated and reviewed against the plan.',
      },
    ],
  },
  {
    id: 'E5',
    title: 'Management domain bring-up',
    owner: 'Plat',
    stories: [
      {
        id: '5.1',
        title: 'Stage the VCF Installer',
        tasks: [
          'Deploy the Installer on a management-domain host using the IP + FQDN planned for SDDC Manager (it switches into SDDC Manager at bring-up, not a throwaway IP); verify it reaches the ESXi management network.',
        ],
      },
      {
        id: '5.2',
        title: 'Commission hosts',
        tasks: ['Prep/validate the ESXi hosts for the management domain.'],
      },
      {
        id: '5.3',
        title: 'Deploy the management domain',
        tasks: ['Run bring-up (vCenter, SDDC Manager, NSX, vSAN); submit the JSON.'],
        acceptance: 'Bring-up completes; SDDC Manager healthy; vSAN datastore online.',
      },
    ],
  },
  {
    id: 'E6',
    title: 'Management domain configuration',
    owner: 'Plat + Net + Sec',
    stories: [
      {
        id: '6.1',
        title: 'NSX edges & north-south',
        tasks: ['Deploy edges; establish BGP peering to the ToRs; verify routes.'],
      },
      {
        id: '6.2',
        title: 'Certificates',
        tasks: ['Replace with CA-signed certificates across the fleet.'],
      },
      {
        id: '6.3',
        title: 'Identity & roles',
        tasks: ['Add the AD identity source; map admin/operator/viewer groups.'],
      },
      {
        id: '6.4',
        title: 'Backup & lifecycle',
        tasks: ['Configure SFTP backups; connect the depot; apply licensing.'],
        acceptance: 'North-south routing verified; certs trusted; SSO login works; backups run.',
      },
    ],
  },
  {
    id: 'E7',
    title: 'Workload domain(s)',
    owner: 'Plat + Net',
    ref: '02-customer-intake.md section H',
    variant: 'wld',
    stories: [
      {
        id: '7.1',
        title: 'WLD network prep',
        tasks: ['Provision the per-WLD VLANs/subnets (Step 1) and the 5 IPs each WLD consumes on the mgmt VM-mgmt subnet.'],
      },
      {
        id: '7.2',
        title: 'Deploy the WLD',
        tasks: ['vCenter + NSX (shared or dedicated) + first cluster.'],
      },
      {
        id: '7.3',
        title: 'WLD connectivity',
        tasks: ['Edges / uplinks (Centralized or Distributed); optional vSphere Supervisor.'],
        acceptance: 'WLD healthy in SDDC Manager; workloads can be placed. Repeat per WLD.',
      },
    ],
  },
  {
    id: 'E8',
    title: 'Stretched / multi-AZ',
    owner: 'Net + Arch + Storage',
    ref: '03-multi-az-prep.md',
    variant: 'stretched',
    stories: [
      {
        id: '8.1',
        title: 'Witness site',
        tasks: ['Deploy the vSAN witness appliance at the third site; route it to both AZ ESX-management networks.'],
      },
      {
        id: '8.2',
        title: 'Inter-AZ fabric',
        tasks: ['Verify <5 ms RTT, ≥10 Gbps, MTU 9000, HA L3 gateway between AZs.'],
      },
      {
        id: '8.3',
        title: 'Stretch the cluster',
        tasks: ['Configure fault domains (preferred/secondary/witness); per-AZ networks; storage policy for the dual-site mirror (~2× capacity).'],
        acceptance: 'Stretched cluster compliant; an AZ-failure test survives on the surviving site.',
      },
    ],
  },
  {
    id: 'E9',
    title: 'Day-2 fleet deployment',
    owner: 'Plat',
    ref: '05-day2-deployments.md',
    variant: 'day2',
    stories: [
      {
        id: '9.1',
        title: 'Network placement',
        tasks: ['Decide Shared / Dedicated / NSX Overlay / NSX VLAN Segment; build the network if non-shared.'],
      },
      {
        id: '9.2',
        title: 'VCF Operations',
        tasks: [
          'Deploy Operations (+ Cloud Proxy, License Server).',
          'Decide the cluster address: floating IP (default) or an external load-balancer VIP — VCF never provides the LB for Operations, so if a VIP is wanted, provision the external LB and add its FQDN to the cert SAN first.',
        ],
      },
      {
        id: '9.3',
        title: 'VCF Automation',
        tasks: ['Deploy via SDDC Manager API or via VCF Operations; set the services-runtime cluster CIDR.'],
      },
      {
        id: '9.4',
        title: 'Ops for Logs / Networks & Identity Broker',
        tasks: ['Deploy the remaining fleet components as needed.'],
        acceptance: 'Each Day-2 component healthy; the fleet synthetic check passes.',
      },
    ],
  },
  {
    id: 'E10',
    title: 'Validation & handover',
    owner: 'Arch + all',
    stories: [
      {
        id: '10.1',
        title: 'Health check',
        tasks: ['Run a post-deploy health check of the live environment.'],
      },
      {
        id: '10.2',
        title: 'As-built',
        tasks: ['Capture the as-built (FQDNs, IPs, VLANs, passwords in the secret store).'],
      },
      {
        id: '10.3',
        title: 'Handover',
        tasks: ['Walk the customer through operations and hand over.'],
        acceptance: 'Health check clean; as-built delivered; customer sign-off.',
      },
    ],
  },
];

export interface Selection {
  wld: boolean;
  stretched: boolean;
  day2: boolean;
}

export function defaultSelection(): Selection {
  return { wld: true, stretched: false, day2: true }; // B + D, the common build
}

/** The epics that apply given a selection, in execution order. */
export function selectedEpics(sel: Selection): Epic[] {
  return EPICS.filter((e) => !e.variant || sel[e.variant]);
}

/** Human-readable type label, e.g. "B + D (management + workload domain + Day-2 fleet)". */
export function typeLabel(sel: Selection): string {
  const parts = ['management'];
  const letters: string[] = [];
  if (sel.wld) { letters.push('B'); parts.push('workload domain'); }
  if (sel.stretched) { letters.push('C'); parts.push('stretched / multi-AZ'); }
  if (sel.day2) { letters.push('D'); parts.push('Day-2 fleet'); }
  const code = letters.length ? letters.join(' + ') : 'A';
  return `${code} — ${parts.join(' + ')}`;
}

/** Comma-list of included epic ids, e.g. "E1–E6, E7, E9, E10". */
export function includedEpicList(sel: Selection): string {
  return selectedEpics(sel).map((e) => e.id).join(', ').replace('E1, E2, E3, E4, E5, E6', 'E1–E6');
}

// ---- Exporters -------------------------------------------------------------

export function buildMarkdown(sel: Selection): string {
  const L: string[] = [];
  L.push('# VCF 9.1 Deployment Plan');
  L.push('');
  L.push(`**Deployment type:** ${typeLabel(sel)}`);
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
