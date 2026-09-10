// Ordered navigation manifest for the planning docs. The docs themselves carry
// no frontmatter (they double as GitHub-rendered .md), so labels, icons and the
// workflow order live here. `slug` matches the glob collection id (filename
// without extension).
//
// Two kinds of entry:
//   - Planning-flow items have a `step` ('Gate', 'Step 1', ...) and no `band`.
//     They render as the ordered "Planning flow" list.
//   - Reference build guides have a `band` (see REFERENCE_BANDS) and their `step`
//     mirrors the band name (used as the per-page eyebrow). They render grouped
//     by band under "Reference".
// Array order is also the prev/next pager order, so keep related guides adjacent.
export interface NavItem {
  slug: string;
  step: string;
  label: string;
  icon: string; // Font Awesome Classic Solid name
  blurb: string;
  band?: string; // reference sub-group; absent for planning-flow items
}

// Render order for the reference bands.
export const REFERENCE_BANDS = [
  'Foundation',
  'Load balancer & licensing',
  'Supervisor & VKS',
  'VCF Automation',
  'Security services',
  'Operations',
  'Reference data',
] as const;

export const NAV: NavItem[] = [
  {
    slug: 'prerequisites',
    step: 'Gate',
    label: 'Prerequisites',
    icon: 'clipboard-check',
    blurb: 'Environment gate: hardware, network, AD, DNS, NTP, CA. Fix reds before anything else.',
  },
  {
    slug: '01-network-dns-plan',
    step: 'Step 1',
    label: 'Network / DNS Plan',
    icon: 'diagram-project',
    blurb: 'One page, one meeting: VLANs, subnets, BGP, DNS, NTP, AD, certificates.',
  },
  {
    slug: '02-intake',
    step: 'Step 2',
    label: 'Intake',
    icon: 'list-check',
    blurb: 'Role-based questionnaire, grouped by who owns each answer.',
  },
  {
    slug: '04-sizing',
    step: 'Step 3',
    label: 'Sizing & Fit Check',
    icon: 'server',
    blurb: 'Interactive calculator: size the management fleet, check whether your hosts fit at N-1, and export or share the result.',
  },
  {
    slug: '03-multi-az-prep',
    step: 'If stretched',
    label: 'Multi-AZ Prep',
    icon: 'left-right',
    blurb: 'Extra prep for stretched vSAN: witness, latency budgets, capacity.',
  },
  {
    slug: '05-day2-deployments',
    step: 'Day-2',
    label: 'Day-2 Deployments',
    icon: 'layer-group',
    blurb: 'Fleet components deployed after bring-up: VCF Automation, Ops, and their network placement (Shared / Dedicated / NSX Overlay / VLAN Segment).',
  },
  {
    slug: '06-deployment-plan',
    step: 'Delivery',
    label: 'Deployment Plan',
    icon: 'sitemap',
    blurb: 'An agile work breakdown (epics, stories, tasks); build your deployment scope and export it to Markdown or a backlog CSV.',
  },

  // --- Reference: Foundation ------------------------------------------------
  {
    slug: '07-firewall-ports',
    step: 'Foundation',
    band: 'Foundation',
    label: 'Firewall & Ports',
    icon: 'shield-halved',
    blurb: 'Deployment-critical firewall flows by zone, the 9.1 port gotchas, and links to the authoritative Ports & Protocols tools.',
  },
  {
    slug: '08-backup-target',
    step: 'Foundation',
    band: 'Foundation',
    label: 'Backup Target',
    icon: 'hard-drive',
    blurb: 'Build guide for the SFTP backup target every management component backs up to — building it, verifying it, and the field-notes gotchas.',
  },
  {
    slug: '09-binary-depot',
    step: 'Foundation',
    band: 'Foundation',
    label: 'Binary Depot',
    icon: 'box-archive',
    blurb: 'The offline depot and VCF Download Tool — build, feed, and connect the depot the platform installs and patches from.',
  },
  {
    slug: '11-esx-coredump',
    step: 'Foundation',
    band: 'Foundation',
    label: 'ESX Coredump',
    icon: 'bug',
    blurb: 'Build guide for the ESXi network Dump Collector: enable the service on vCenter, point every host at it, verify.',
  },
  {
    slug: '12-sso-configuration',
    step: 'Foundation',
    band: 'Foundation',
    label: 'SSO Configuration',
    icon: 'key',
    blurb: 'Configure fleet SSO via the VCF Identity Broker: the identity provider, per-product federation, role mapping, and verification.',
  },

  // --- Reference: Load balancer & licensing ------------------------------
  {
    slug: '15-license-hub',
    step: 'Load balancer & licensing',
    band: 'Load balancer & licensing',
    label: 'License Hub',
    icon: 'certificate',
    blurb: 'Deploy License Hub for vDefend and Avi subscription licensing — both the 2.0 standalone OVA and 5.1.2 SSP Installer flows — and the post-deploy registration chain.',
  },
  {
    slug: '14-avi-load-balancer',
    step: 'Load balancer & licensing',
    band: 'Load balancer & licensing',
    label: 'Avi Load Balancer',
    icon: 'scale-balanced',
    blurb: 'Deploy Avi Load Balancer from VCF Operations: the wizard, first-login controller setup, and the licensing chain.',
  },

  // --- Reference: Supervisor & VKS --------------------------------------
  {
    slug: '10-supervisor-enablement',
    step: 'Supervisor & VKS',
    band: 'Supervisor & VKS',
    label: 'Supervisor',
    icon: 'dharmachakra',
    blurb: 'Enable a vSphere Supervisor on a workload domain: the pre-flight gate, the Centralized Transit Gateway, Avi, the content library, and the wizard screen by screen.',
  },
  {
    slug: '20-supervisor-image-registry',
    step: 'Supervisor & VKS',
    band: 'Supervisor & VKS',
    label: 'Supervisor Image Registry',
    icon: 'boxes-stacked',
    blurb: 'The runtime container-image supply chain for Supervisor / VKS: direct, proxy (Supervisor + TkgServiceConfiguration + the no-proxy list), and the fully air-gapped path (the VCF Software Depot OCI registry, imgpkg relocation, the depot image proxy).',
  },

  // --- Reference: VCF Automation --------------------------------------
  {
    slug: '17-vcfa-tenant-config',
    step: 'VCF Automation',
    band: 'VCF Automation',
    label: 'VCFA Tenant Config',
    icon: 'building',
    blurb: 'First-time VCF Automation tenant/org config from the Login Provider Manual setup: create a region, an external IP block, an external connection, and an organization with its Avi integration.',
  },
  {
    slug: '19-securing-vcf-automation',
    step: 'VCF Automation',
    band: 'VCF Automation',
    label: 'Securing VCFA',
    icon: 'user-shield',
    blurb: 'Hardening for an external-facing (Pattern 3) VCF Automation instance: the Transit Gateway firewall, the DFW exclusion-list sequence, IP-based portal locking, the Avi WAF policy, and the Avi management-plane Tier-1 firewall.',
  },

  // --- Reference: Security services ---------------------------------
  {
    slug: '18-vdefend-ssp',
    step: 'Security services',
    band: 'Security services',
    label: 'vDefend SSP',
    icon: 'shield-virus',
    blurb: 'Deploy the vDefend Security Services Platform from the SSP Installer and configure it first time: form factors and footprint, the deploy wizard, onboarding NSX Manager, and activating Security Intelligence / NDR / Malware Prevention.',
  },

  // --- Reference: Operations --------------------------------------
  {
    slug: '13-shutdown-startup',
    step: 'Operations',
    band: 'Operations',
    label: 'Shutdown / Startup',
    icon: 'power-off',
    blurb: 'The ordered fleet shutdown and startup runbook: the 11-step management sequence, the fleet-level VCF Operations rule, shared NSX, and the infrastructure VMs that go last.',
  },
  {
    slug: '16-remove-components',
    step: 'Operations',
    band: 'Operations',
    label: 'Remove Components',
    icon: 'trash-can',
    blurb: 'Cleanly remove and reinstall optional Day-N fleet components — Log Management, Real-time Metrics, VON, Depot Service, Identity Broker, VCF Automation — via cleanup_component.py.',
  },
  {
    slug: '21-config-artifacts',
    step: 'Operations',
    band: 'Operations',
    label: 'Config Artifacts',
    icon: 'file-export',
    blurb: 'Pull re-submittable spec JSON out of a built VCF 9.1 instance (bring-up spec, Fleet LCM components, Supervisor export, the NSX policy hierarchy), then sanitise, parameterise and validate it into reusable templates.',
  },

  // --- Reference: Reference data ------------------------------------
  {
    slug: 'workbook-cell-mapping',
    step: 'Reference data',
    band: 'Reference data',
    label: 'Workbook Mapping',
    icon: 'table-cells',
    blurb: 'Intake answers mapped to workbook sheet and field label.',
  },
];

export function navBySlug(slug: string): NavItem | undefined {
  return NAV.find((n) => n.slug === slug);
}

/** Planning-flow items, in order (everything without a reference `band`). */
export function navFlowItems(): NavItem[] {
  return NAV.filter((n) => !n.band);
}

/** Reference build guides grouped by band, in REFERENCE_BANDS order. */
export function navReferenceBands(): { band: string; items: NavItem[] }[] {
  return REFERENCE_BANDS.map((band) => ({
    band,
    items: NAV.filter((n) => n.band === band),
  })).filter((group) => group.items.length > 0);
}
