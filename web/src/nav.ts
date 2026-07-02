// Ordered navigation manifest for the planning docs. The docs themselves carry
// no frontmatter (they double as GitHub-rendered .md), so labels, icons and the
// workflow order live here. `slug` matches the glob collection id (filename
// without extension).
export interface NavItem {
  slug: string;
  step: string;
  label: string;
  icon: string; // Font Awesome Classic Solid name
  blurb: string;
}

export const NAV: NavItem[] = [
  {
    slug: 'prerequisites',
    step: 'Gate',
    label: 'Prerequisites',
    icon: 'clipboard-check',
    blurb: 'Customer-side gate: hardware, network, AD, DNS, NTP, CA. Fix reds before anything else.',
  },
  {
    slug: '01-network-dns-plan',
    step: 'Step 1',
    label: 'Network / DNS Plan',
    icon: 'diagram-project',
    blurb: 'One page, one meeting: VLANs, subnets, BGP, DNS, NTP, AD, certificates.',
  },
  {
    slug: '02-customer-intake',
    step: 'Step 2',
    label: 'Customer Intake',
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
    slug: 'workbook-cell-mapping',
    step: 'Reference',
    label: 'Workbook Mapping',
    icon: 'table-cells',
    blurb: 'Intake answers mapped to workbook sheet and field label.',
  },
];

export function navBySlug(slug: string): NavItem | undefined {
  return NAV.find((n) => n.slug === slug);
}
