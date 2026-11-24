// scrape-versions.mjs
// Scrapes the current latest version + build per VCF 9.1.x component from Broadcom's
// server-rendered KB / TechDocs pages and writes web/src/data/vcf-versions.json.
//
// In VCF 9.1 components patch per-component and asynchronously (Express Patches), so a
// point-in-time table drifts within weeks. This keeps it honest on a schedule.
//
// Broadcom's 9.x version string is X.Y.Z.EEHH.######## :
//   X  Major version        (~3 yr)   -.
//   Y  Minor version        (~9 mo)    |- an UPGRADE (update sequence required)
//   Z  Maintenance version  (~3 mo)   -'
//   EE Express Patch  ]  the 4-char EEHH field -- a PATCH (no update sequence required)
//   HH Hot Patch      ]
//   ######## Build number
// So 9.1.0 -> 9.1.1 is a maintenance-version *upgrade*, and 9.1.0.0300 -> 9.1.0.0400 is an
// express *patch* within 9.1.0. This script calls each X.Y.Z stream (9.1.0.x, 9.1.1.x) a
// "release line".
//
// Multiple release lines (#265): once 9.1.1 shipped there are concurrent patch streams --
// 9.1.0.x keeps taking express/hot patches (security backports) for fleets still on that
// maintenance version, 9.1.1.x is a separate stream, neither supersedes the other. So the
// output carries one component set per supported release line (`lines[]`), plus a shared
// `addons[]` (vDefend / DSM / License Hub / Avi version on their own schemes, unaffected by
// the VCF maintenance version). Adding a future line is one `LINES` entry; adding a patch tree
// to a line that only has a BOM today is one field.
//
// Fail-safe: on any fetch/parse miss, the last-known value is kept (never blanked) and the
// failing source is recorded in `_sourceErrors`. Both source shapes are plain server-rendered
// HTML, so a bare fetch returns the data (no JS/Cloudflare gate) and this runs fine in CI.
//
// Author: Paul van Dieen  -  https://www.hollebollevsan.nl
// Issues: #179 (page), #180 (VCF Operations nodes), #181 (optional add-ons), #184 (GA release dates),
//         #187 (walk ALL sub-indexes; VSP/Identity Broker/Telemetry nested-with-GA-fallback; +3 Ops components),
//         #214 (knownBadRender), #230 (vCenter off the KB), #258 (License Hub), #265 (per-minor lines),
//         #370 (VCF Download Tool), #389 (leaf header without the "Build" word),
//         #390 (per-line index renames; vSAN Witness; PowerCLI / VCF SDK from package feeds),
//         #391 (depotVerified: builds reconciled against the VCF Download Tool depot listing),
//         #393 (ESX "Live Patchable" flag from the patch leaf),
//         #486 (9.0.2 line with its own manifest; 9.1.0 frozen: no patches since 9.1.1 GA),
//         #487 (9.1.2 line; 9.1.1 frozen; hasPatchTree from scraped rows)
// Run:    node web/scripts/scrape-versions.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/data/vcf-versions.json');

const TD_ROOT = 'https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later';
const TD = `${TD_ROOT}/9-1/release-notes`;
const TD90 = `${TD_ROOT}/9-0/release-notes`;

// The major version this page covers. Shown in the page title/intro; per-line sections carry
// their own full maintenance version (`9.1.1`, `9.0.2`, ...). Since #486 the page spans two
// minors (9.1 and 9.0), so this is the major only.
const FAMILY = '9';

// Supported VCF release lines (one per maintenance version), newest first. Each has its own
// patch tree, BOM and GA date.
//   y:      the minor-version digit (1 for 9.1, 0 for 9.0) and
//   z:      the maintenance-version digit (0 for 9.1.0.x, 1 for 9.1.1.x) -- both substituted
//           into every component leaf regex, so one manifest covers all lines of a minor.
//   components: the manifest for this line's minor (COMPONENTS for 9.1, COMPONENTS_90 for 9.0:
//           9.0 has other products (Operations for logs, Fleet Management) and other leaf names).
//   frozen: the line no longer receives patches (#486). It is not scraped any more; the
//           last-known rows are carried over as they are and the page shows the note. Patches go
//           to the newest maintenance version of each minor: VMSA-2026-0009 (19 NOV 2026, vCenter
//           CVE-2026-123890, Critical) lists 9.1.1.0200 for 9.1.x.x and 9.0.2.0200 for 9.0.x.x,
//           with no 9.1.0.x fix, and the 9.1.0.x tree stopped at 29 JUL 2026. Broadcom publishes
//           no written policy for this (KB 410435 only gives the cadence), so the note states
//           what was observed, with its source.
//   patch:  the patch-releases-9-1-Z-x tree root, or null until Broadcom opens one. While it
//           is null the whole line runs at its BOM (GA) builds, rendered with the "GA" pill.
//   bom:    the line's Bill of Materials page. The slug is version-scoped and NOT consistent
//           between lines: 9.1.0.0 is ".../vmware-cloud-foundation-bill-of-materials.html",
//           9.1.1.0 is ".../vmware-cloud-foundation-9-1-1-0-bill-of-material.html" (singular).
//   The 9.0 patch tree is one "patch-releases-9-0-0-x" for every 9.0.x maintenance version (no
//   per-maintenance tree and no date table), so the 9.0.2 line points at it and the leaf regex
//   (which carries y and z) keeps 9.0.0 / 9.0.1 leaves out.
//   9.1.2 (#487): `patch` points at the tree Broadcom will open as patch-releases-9-1-2-x. Until it
//   exists every index 404s, scrapeTechdocs() returns null and the line runs at its BOM builds;
//   `hasPatchTree` is set from whether any row came from a patch leaf, so the line switches over
//   by itself. 9.1.1 is frozen from 9.1.2 GA: VMSA-2026-0011 (24 NOV 2026, online later that day)
//   lists 9.1.2 as the vCenter and ESX fix for 9.1.x.x, with no 9.1.1.x build. Every advisory
//   is also in web/src/data/vmsa.json, shown on /security-advisories/ (#489).
const LINES = [
  {
    v: '9.1.2', y: 1, z: 2, ga: '2026-11-24', patch: `${TD}/patch-releases-9-1-2-x`,
    bom: `${TD}/vmware-cloud-foundation-9-1-2-0-release-notes/vmware-cloud-foundation-9-1-2-0-bill-of-material.html`,
  },
  {
    v: '9.1.1', y: 1, z: 1, ga: '2026-09-03', patch: `${TD}/patch-releases-9-1-1-x`,
    bom: `${TD}/vmware-cloud-foundation-9-1-1-0-release-notes/vmware-cloud-foundation-9-1-1-0-bill-of-material.html`,
    frozen: {
      lastPatch: '2026-11-19', upgradeTo: '9.1.2', checked: '2026-11-24',
      reason: 'VMSA-2026-0011 (24 Nov 2026, vCenter CVE-2026-123903 and ESX CVE-2026-123910, Critical) is fixed in 9.1.2 for 9.1.x.x, with no 9.1.1.x build; the 9.1.1.x patch tree has had no release since 19 Nov 2026',
      sourceUrl: 'https://support.broadcom.com/web/ecx/support-content-notification/-/external/content/SecurityAdvisories/0/39626',
      sourceLabel: 'VMSA-2026-0011',
    },
  },
  {
    v: '9.1.0', y: 1, z: 0, ga: '2026-05-12', patch: `${TD}/patch-releases-9-1-0-x`,
    bom: `${TD}/vmware-cloud-foundation-9-1-0-0-release-notes/vmware-cloud-foundation-bill-of-materials.html`,
    frozen: {
      lastPatch: '2026-07-29', upgradeTo: '9.1.2', checked: '2026-11-24',
      reason: 'VMSA-2026-0009 (19 Nov 2026, vCenter CVE-2026-123890, Critical) was fixed in 9.1.1.0200 and 9.0.2.0200 only; the 9.1.0.x patch tree has had no release since 29 Jul 2026',
      sourceUrl: 'https://support.broadcom.com/web/ecx/support-content-notification/-/external/content/SecurityAdvisories/0/39495',
      sourceLabel: 'VMSA-2026-0009',
    },
  },
  {
    v: '9.0.2', y: 0, z: 2, ga: '2026-01-20', patch: `${TD90}/patch-releases-9-0-0-x`,
    bom: `${TD90}/vmware-cloud-foundation-9-0-2-release-notes/vmware-cloud-foundation-902-bill-of-materials.html`,
  },
];

// VCF 9.1 release-notes landing page - indexes every maintenance version's release notes
// (each with its Bill of Materials) and every patch-release tree. Linked from the page footer
// as the single "start here" source; every table row also links its own exact source.
const RELEASE_NOTES = `${TD}.html`;
const RELEASE_NOTES_90 = `${TD90}.html`;

// --- Per-minor component manifest -------------------------------------------------------------
//
// One entry per component that ships inside the VCF BOM and patches on the 9-1-N-NNNN cadence.
//   indexPath:  path under a line's patch tree to the component's patch index
//               (e.g. "vsphere/vcenter.html" -> "<line.patch>/vsphere/vcenter.html"). May be
//               an array of candidates tried in order (first one that isn't a 404 wins):
//               Broadcom renames indexes between lines (#390: 9.1.0 "vcf-installer.html" is
//               9.1.1 "sddc-manager.html"; "vmware-download-tool.html" is "vcf-download-tool.html").
//   leafLabel:  the product label in front of the version on the leaf's header, for leaves that
//               carry several products (#390: the vSAN leaf lists vSAN, ESA Witness and OSA
//               Witness, each with its own build). Without it the first header row is taken.
//   leafSlug:   the release-notes filename stem. Built into a minor-parameterised regex
//               "/<slug>-9-1-<minor>-(\d{4})-release-notes.html$". The slug may itself contain
//               regex (the Real-Time Metrics leaf misspells "metrics" as "mertics" upstream, so
//               both spellings are tolerated). Anchored with a leading "/" so a sibling leaf
//               can't be mistaken for the product (e.g. "vcfoperations-" vs "vcf-operations-*-").
//   nested:     the component's leaves live under version sub-indexes
//               ("<tree>/9-1-<minor>-NNNN.html") rather than directly off the component index.
//   bomName:    the component's row label in the Bill of Materials table (tag-free spelling --
//               see normBom()) -- used to read its GA build when a line has no patch tree yet,
//               or when it has shipped no patch leaf.
//   knownBadRender: see extractLeafBuild() (#214).
//   depotVerified: see applyDepotVerified() (#391).
//   livePatch:  read the leaf's "Live Patchable | Yes/No" row (#393; ESX only). See
//               extractLivePatchable().
const COMPONENTS = [
  // vCenter reads TechDocs, not KB 326316, since #230 (the KB lagged a security patch by a day).
  { key: 'vcenter', name: 'vCenter Server', category: 'Core',
    indexPath: 'vsphere/vcenter.html', leafSlug: 'vcenter', bomName: 'vCenter' },
  { key: 'esxi', name: 'ESXi', category: 'Core',
    indexPath: 'vsphere/esx.html', leafSlug: 'esx', bomName: 'ESX', livePatch: true },
  { key: 'nsx', name: 'NSX', category: 'Core',
    indexPath: 'nsx.html', leafSlug: 'nsx', bomName: 'NSX' },
  { key: 'sddc-manager', name: 'SDDC Manager', category: 'Core',
    indexPath: ['sddc-manager.html', 'vcf-installer.html'], leafSlug: 'sddc-manager', bomName: 'SDDC Manager' },
  // vSAN (#390): the vSAN build is the ESX build (vSAN ships in ESX), so the rows worth tracking
  // are the two witness appliances. Both are listed on the same vsan-9-1-Z-NNNN leaf, each with
  // its own build, and each has its own BOM row.
  { key: 'vsan-esa-witness', name: 'vSAN ESA Witness', category: 'Core',
    indexPath: 'vsan.html', leafSlug: 'vsan', leafLabel: 'vSAN ESA Witness', bomName: 'vSAN ESA Witness' },
  { key: 'vsan-osa-witness', name: 'vSAN OSA Witness', category: 'Core',
    indexPath: 'vsan.html', leafSlug: 'vsan', leafLabel: 'vSAN OSA Witness', bomName: 'vSAN OSA Witness' },

  // Leaf slug is dashless for 9.1.0 ("vcfoperations-9-1-0-0400-...") but dashed for 9.1.1
  // ("vcf-operations-9-1-1-0100-...") (#390, same split as VCF Automation in #353). Safe against
  // the sibling leaves: leafRe needs the version straight after the slug, so
  // "vcf-operations-orchestrator-9-1-1-..." can't match.
  { key: 'vcf-operations', name: 'VCF Operations', category: 'Operations',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'vcf-?operations', bomName: 'VCF Operations' },
  // VCF Operations for Networks + HCX (#187): separate products in the family, not internal nodes.
  { key: 'vcf-ops-for-networks', name: 'VCF Operations for Networks', category: 'Operations',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'vcf-operations-for-networks',
    bomName: 'VCF Operations for networks' },
  { key: 'vcf-ops-hcx', name: 'VCF Operations HCX', category: 'Operations',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'vcf-operations-hcx',
    bomName: 'VCF Operations HCX' },

  // VCF Operations services (#180 -> Management in #187): independently-versioned, ship in the
  // vcf-operations/<ver>/ tree but run in the management plane, so listed under Management.
  { key: 'vcf-ops-orchestrator', name: 'Orchestrator', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'vcf-operations-orchestrator',
    bomName: 'VCF Operations orchestrator' },
  { key: 'vcf-ops-log-management', name: 'Log Management', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'log-management', bomName: 'Log management' },
  // Broadcom's leaf slug misspells "metrics" as "mertics"; tolerate both.
  // The 9.1.1.0100 RTM leaf prints the Metrics Store build (25801571) under "Real-Time Metrics";
  // the depot ships RTM as 25794546 (#391). Since 9.1.0.0200 the Store has carried the VCF
  // Services Runtime build (0200: both 25555874; 9.1.1.0 BOM: both 25714471; 0100: both 25801571;
  // at 9.1.0 GA it shared RTM's 25346020 instead) and it has no 0100 leaf of its own.
  { key: 'vcf-ops-real-time-metrics', name: 'Real-Time Metrics', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'real-time-me(?:rt|tr)ics',
    bomName: 'Real-time metrics',
    depotVerified: [{ line: '9.1.1', when: { version: '9.1.1.0100', build: '25801571' },
      set: { build: '25794546' }, verified: '2026-10-13',
      note: 'The release notes print the Real-Time Metrics Store build for this component' }] },
  { key: 'vcf-ops-real-time-metrics-store', name: 'Real-Time Metrics Store', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'real-time-me(?:rt|tr)ics-store',
    bomName: 'Real-time metrics store',
    depotVerified: [{ line: '9.1.1', when: { version: '9.1.1.0', build: '25714471' },
      set: { version: '9.1.1.0100', build: '25801571', releaseDate: '2026-10-12' }, verified: '2026-10-13',
      note: 'Patched in the 9.1.1.0100 wave without release notes of its own' }] },

  // Leaf slug is dashless at GA/9.1.0 ("vcfautomation-...") but dashed on its first 9.1.1 patch
  // ("vcf-automation-9-1-1-0100-..."); tolerate both (#353, same family of inconsistency as the
  // leafRe dash-optional fix below).
  { key: 'vcf-automation', name: 'VCF Automation', category: 'Automation',
    indexPath: 'vcf-automation.html', leafSlug: 'vcf-?automation', bomName: 'VCF Automation' },
  // New with the 9.1.1.0100 patch (#353): ships its own leaf under the vcf-automation.html tree.
  { key: 'migration-service-engine', name: 'Migration Service Engine', category: 'Automation',
    indexPath: 'vcf-automation.html', leafSlug: 'migration-service-engine',
    bomName: 'Migration service engine' },

  // VCF Operations bundle sub-components (own leaf under vcf-operations/<ver>/).
  { key: 'fleet-lifecycle', name: 'Fleet Lifecycle Management', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'fleet-lifecycle', bomName: 'Fleet lifecycle' },
  { key: 'sddc-lifecycle', name: 'SDDC Lifecycle Management', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'sddc-lifecycle', bomName: 'SDDC lifecycle' },
  { key: 'salt-master', name: 'Salt Master', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'salt-master', bomName: 'Salt master' },
  { key: 'salt-raas', name: 'Salt RaaS', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'salt-raas', bomName: 'Salt RaaS' },
  // software-depot's 9.1.0.0400 leaf renders "Build 255070105" (an extra 0 after the third
  // digit); the real build is 25570105, reconciled by a human (#214). Only substituted when the
  // page renders this EXACT malformed string for this EXACT version -- any change and we throw.
  { key: 'software-depot', name: 'Software Depot', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'software-depot', bomName: 'Software depot',
    knownBadRender: { version: '9.1.0.0400', raw: '255070105', build: '25570105', verified: '2026-07-22',
      note: 'Broadcom inserts an extra 0 after the third digit; confirmed against product inventory' } },
  // VCF Download Tool (#370): the CLI that feeds the depot. Own flat patch tree
  // ("vmware-download-tool.html" -> "vcf-download-tool-9-1-Z-NNNN-release-notes.html") and its
  // own BOM row, so a line without a patch leaf yet falls back to its GA build.
  { key: 'vcf-download-tool', name: 'VCF Download Tool', category: 'Management',
    indexPath: ['vcf-download-tool.html', 'vmware-download-tool.html'], leafSlug: 'vcf-download-tool',
    bomName: 'VCF download tool' },

  // Management components (#187): live in the vcf-operations/<ver>/ tree, patch on their own
  // cadence but not on every Express Patch -- walk the tree, and if no leaf exists yet fall back
  // to the line's Bill-of-Materials build (rendered with the GA pill).
  { key: 'vsp', name: 'VCF Services Runtime (VSP)', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'vcf-services-runtime',
    bomName: 'VCF services runtime' },
  { key: 'telemetry', name: 'Telemetry', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'telemetry', bomName: 'Telemetry' },
  // Cloud Proxy + License Server are deliberately NOT rows (#391): they are part of VCF Operations
  // and move up with it (depot 9.1.1.0100: VCF Ops 25795063, Cloud proxy 25795064, License server
  // 25795080), so the VCF Operations row already stands for them.
  { key: 'identity-broker', name: 'Identity Broker', category: 'Management',
    indexPath: 'vcf-operations.html', nested: true, leafSlug: 'identity-broker', bomName: 'Identity broker' },
];

// --- 9.0 manifest (#486) -------------------------------------------------------------------
// The 9.0 tree (patch-releases-9-0-0-x, read 2026-11-23) differs from 9.1's: vCenter and ESX sit
// under vsphere/, the VCF Operations index links every product's leaves directly (no version
// sub-indexes, so not `nested`), VCF Automation leaves are "vcfa-...", and there are no NSX or
// vSAN indexes (those rows run at the 9.0.2 BOM build). The products are 9.0's own: VCF
// Operations for logs and Fleet Management instead of 9.1's Log Management and Fleet / SDDC
// lifecycle; no services runtime, Real-Time Metrics, Salt or software depot. bomName is matched
// against the 9.0.2 BOM after normBom() turns "VMware Cloud Foundation ..." into "vcf ...".
const COMPONENTS_90 = [
  { key: 'vcenter', name: 'vCenter Server', category: 'Core',
    indexPath: 'vsphere/vcenter.html', leafSlug: 'vcenter', bomName: 'vCenter' },
  { key: 'esxi', name: 'ESXi', category: 'Core',
    indexPath: ['vsphere/esx.html', 'esx.html'], leafSlug: 'esx', bomName: 'ESX', livePatch: true },
  { key: 'nsx', name: 'NSX', category: 'Core',
    indexPath: 'nsx.html', leafSlug: 'nsx', bomName: 'NSX' },
  { key: 'sddc-manager', name: 'SDDC Manager', category: 'Core',
    indexPath: 'sddc-manager.html', leafSlug: 'sddc-manager', bomName: 'SDDC Manager' },
  { key: 'vsan-esa-witness', name: 'vSAN ESA Witness', category: 'Core',
    indexPath: 'vsan.html', leafSlug: 'vsan', leafLabel: 'vSAN ESA Witness', bomName: 'vSAN ESA Witness' },
  { key: 'vsan-osa-witness', name: 'vSAN OSA Witness', category: 'Core',
    indexPath: 'vsan.html', leafSlug: 'vsan', leafLabel: 'vSAN OSA Witness', bomName: 'vSAN OSA Witness' },
  { key: 'vcf-operations', name: 'VCF Operations', category: 'Operations',
    indexPath: 'vcf-operations.html', leafSlug: 'vcf-operations', bomName: 'VCF Operations' },
  { key: 'vcf-ops-for-networks', name: 'VCF Operations for Networks', category: 'Operations',
    indexPath: 'vcf-operations.html', leafSlug: 'vcf-operations-for-networks', bomName: 'VCF Operations for networks' },
  { key: 'vcf-ops-hcx', name: 'VCF Operations HCX', category: 'Operations',
    indexPath: 'vcf-operations.html', leafSlug: 'vcf-operations-hcx', bomName: 'VCF Operations HCX' },
  { key: 'vcf-ops-orchestrator', name: 'Orchestrator', category: 'Management',
    indexPath: 'vcf-operations.html', leafSlug: 'vcf-operations-orchestrator', bomName: 'VCF Operations orchestrator' },
  { key: 'vcf-ops-for-logs', name: 'VCF Operations for logs', category: 'Management',
    indexPath: 'vcf-operations.html', leafSlug: 'vcf-operations-for-logs', bomName: 'VCF Operations for logs' },
  { key: 'fleet-management', name: 'Fleet Management', category: 'Management',
    indexPath: 'vcf-operations.html', leafSlug: 'fleet-management', bomName: 'VCF Operations fleet management' },
  // Leaves are "vidb-9-0-2-0100.html" (no "-release-notes") then "vcf-identity-broker-9-0-2-0200-
  // release-notes.html"; the newer spelling is the one the regex reads.
  { key: 'identity-broker', name: 'Identity Broker', category: 'Management',
    indexPath: 'vcf-operations.html', leafSlug: 'vcf-identity-broker', bomName: 'VCF Identity broker' },
  // Only a 9.0.0.0100 leaf exists ("vcf-dt-9-0-0-0100.html"), so 9.0.2 runs at its BOM build.
  { key: 'vcf-download-tool', name: 'VCF Download Tool', category: 'Management',
    indexPath: 'vmware-download-tool.html', leafSlug: 'vcf-download-tool', bomName: 'VCF download tool' },
  { key: 'vcf-automation', name: 'VCF Automation', category: 'Automation',
    indexPath: 'vcf-automation.html', leafSlug: 'vcfa', bomName: 'VCF Automation' },
];

// --- Shared add-ons (not part of the base VCF BOM; scraped once, not per minor) ---------------
const ADDONS = [
  { key: 'vdefend', name: 'vDefend (Firewall / IDS-IPS / ATP)', category: 'Add-ons', strategy: 'page',
    url: 'https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/vdefend-firewall/9-1/release-notes/vmware-vdefend-91-release-notes.html',
    versionRe: /vDefend\s+(\d+\.\d+(?:\.\d+)?)/i, buildRe: /Build Number:?\s*(\d{8})/i },
  { key: 'dsm', name: 'Data Services Manager', category: 'Add-ons', strategy: 'page',
    url: 'https://techdocs.broadcom.com/us/en/vmware-cis/dsm/data-services-manager/9-1/release-notes/vmware-data-services-manager-91-release-notes.html',
    versionRe: /Data Services Manager\s+(\d+\.\d+(?:\.\d+)?)/i, buildRe: /Build\s+(\d{8})/i,
    dateRe: /Data Services Manager\s+[\d.]+\s*\|\s*([^|]+?)\s*\|\s*Build/i },
  // License Hub (#258): standalone OVA since 2.0, licensing vDefend + Avi. Own release-notes
  // tree, own 8-digit build. Header renders "License Hub 2.0 ... | August 5, 2026 | Build ...".
  { key: 'license-hub', name: 'License Hub (vDefend / Avi licensing)', category: 'Add-ons', strategy: 'page',
    url: 'https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/license-hub/2-0/release-notes/license-hub-20-for-vmware-vdefend-and-avi-load-balancer-release-notes.html',
    versionRe: /License Hub\s+(\d+\.\d+(?:\.\d+)?)/i, buildRe: /Build\s+(\d{8})/i,
    dateRe: /License Hub\s+[\d.]+[^|]*\|\s*([^|]+?)\s*\|\s*Build/i },
  // Avi mints a per-version leaf page and publishes NO 8-digit build; discover the newest leaf.
  { key: 'avi-lb', name: 'Avi Load Balancer (NSX ALB)', category: 'Add-ons', strategy: 'avi',
    index: 'https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer/32-1/vmware-avi-load-balancer-release-notes.html',
    leaf: /release-notes-for-avi-load-balancer-version-(\d+)-(\d+)-(\d+)\.html$/i,
    versionRe: /Avi Load Balancer Version\s+(\d+\.\d+\.\d+)/i },

  // Tools (#390): client-side tooling, not in the BOM or the TechDocs patch trees, and their
  // release notes live on developer.broadcom.com (a JS-rendered SPA a bare fetch can't read).
  // The package feeds are machine-readable and are what an admin installs from anyway.
  // PowerCLI's gallery version is "<X.Y.Z>.<8-digit build>" (e.g. 9.1.1.25718932).
  { key: 'powercli', name: 'VCF PowerCLI', category: 'Tools', strategy: 'psgallery', id: 'VCF.PowerCLI',
    url: 'https://www.powershellgallery.com/packages/VCF.PowerCLI' },
  { key: 'vcf-sdk-python', name: 'VCF SDK (Python)', category: 'Tools', strategy: 'pypi', id: 'vcf-sdk',
    url: 'https://pypi.org/project/vcf-sdk/' },
];

const UA = 'Mozilla/5.0 (compatible; VCF9-DeploymentPlanning version scraper; +https://github.com/pauldiee/VCF9-DeploymentPlanning)';

// In-run cache: the all-sub-index walk (#187) re-reads the same family index + sub-indexes across
// every nested component and across both lines, so memoize by URL to keep the fetch count low.
const _fetchCache = new Map();
function fetchText(url, tries = 3) {
  if (!_fetchCache.has(url)) _fetchCache.set(url, _fetchText(url, tries));
  return _fetchCache.get(url);
}

async function _fetchText(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (i === tries) throw err;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

// Collapse tags/entities to plain text for build/version matching.
function plain(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ');
}

// Absolute hrefs found in the page (deduped).
function hrefs(html, baseUrl) {
  const out = new Set();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#?]+)["']/gi)) {
    try { out.add(new URL(m[1], baseUrl).href.split('#')[0]); } catch { /* skip */ }
  }
  return [...out];
}

// The trailing 4 chars are the EEHH (Express+Hot Patch) field; parseInt orders it correctly
// (0400 > 0300, 0401 > 0400, 1000 > 0900) as long as it is always 4 digits, which it is.
const eehh = (s) => parseInt(String(s).slice(-4), 10); // "9-1-0-0400" or "0400" -> 400

// The component leaf regex for a given maintenance version z:
// "/<slug>-9-1-<z>-(\d{4})-release-notes.html$"  -- the (\d{4}) capture is the EEHH field.
// Dashes between the version digits are optional (#353): Broadcom is inconsistent even within
// the same patch release -- e.g. 9.1.1.0100 shipped "fleet-lifecycle-9-1-1-0100-..." dashed but
// "sddc-lifecycle-9110100-..." with the dashes dropped, both in the same sub-index.
const leafRe = (slug, y, z) => new RegExp(`/${slug}-9-?${y}-?${z}-?(\\d{4})-release-notes\\.html$`, 'i');

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
// Normalize "13 JUL 2026", "August 5, 2026" or "2026-07-13" to ISO "2026-07-13"; null if unrecognized.
function isoDate(s) {
  if (!s) return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`;
  const m2 = t.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m2 && MONTHS[m2[1].toUpperCase()]) return `${m2[3]}-${MONTHS[m2[1].toUpperCase()]}-${m2[2].padStart(2, '0')}`;
  return null;
}

// First version-anchored "<ver> | <date> | Build <8-digit>" on a leaf page. Each leaf is a
// single product, so the first hit is that product's own build.
//
// A wrong build is worse than a missing one: anything that is not exactly 8 digits throws, and
// the caller keeps the last-known value. The ONE exception (#214) is a `knownBadRender` -- a
// malformed string a human has reconciled against the real product inventory; accepted only
// when the page renders EXACTLY the recorded malformed string for the recorded version.
function extractLeafBuild(html, c) {
  const text = plain(html);
  // Header row is "<version> | <date> | Build <n>", but some leaves drop the "Build" word
  // (NSX 9.1.1.0100: "NSX 9.1.1.0100 | 12 OCT 2026 | 25762940", #389). Without the word,
  // accept only a bare 8-digit number so an unrelated "x.y.z.wwww | ... | n" can't match.
  // The ESX 9.0.2.0100 leaf writes "| 29 JUL 2026 | ISO Build 25595025" (#486).
  const header = /(9\.\d+\.\d+\.\d{4})\s*\|\s*([^|]+?)\s*\|\s*(?:(?:ISO\s+)?Build\s*(\d+)|(\d{8})(?!\d))/.source;
  const label = c?.leafLabel ? `${c.leafLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+` : '';
  const m = text.match(new RegExp(label + header, 'i'));
  if (!m) return null;
  const version = m[1].trim();
  const build = (m[3] ?? m[4]).trim();
  if (!/^\d{8}$/.test(build)) {
    const kbr = c?.knownBadRender;
    if (kbr && kbr.raw === build && kbr.version === version) {
      return { version, releaseDate: isoDate(m[2]), build: kbr.build, pinned: kbr };
    }
    throw new Error(
      `implausible build "${build}" (${build.length} digits, expected 8) for ${version} -- ` +
      `likely a typo in the Broadcom release notes; refusing to guess` +
      (kbr ? ` (knownBadRender is recorded for ${kbr.version}/"${kbr.raw}" and does NOT match: upstream changed, re-verify)` : '')
    );
  }
  return { version, releaseDate: isoDate(m[2]), build };
}

// ESX patch leaves carry a details row "Live Patchable | Yes" (some write "Live Patchable: | No")
// next to "Host Reboot Required" (#393). The first hit is that details row; the ESX Images table
// further down repeats the header word without a Yes/No after it, so it can't match. Anything
// else returns null (shown as no pill) -- never guess a reboot-free patch.
function extractLivePatchable(html) {
  const m = plain(html).match(/Live\s*Patchable\s*:?\s*(Yes|No)\b/i);
  return m ? m[1].toLowerCase() === 'yes' : null;
}

// Read a component's GA build from a line's Bill of Materials table. The BOM table is
// 4-column -- [Component] [VVF component? ("", "Yes", "Yes (VCF Installer)")] [Version] [Build] --
// so parse rows into cells rather than regexing the flattened text: the middle column pushes
// the version away from the name for most rows. Match the component's row by an exact
// normalised name (the one alias is the "VCF Installer/ SDDC Manager" row, stripped to
// "sddc manager"), so "VCF Operations" cannot swallow "VCF Operations for networks". The BOM
// carries no per-row date, so the line's GA date is used.
// Some rows also gained a trailing "(VCF service)" tag between lines (#353: Migration Service
// Engine is "Migration service engine" at 9.1.0 GA but "Migration service engine (VCF service)"
// at 9.1.1 GA) -- strip it so bomName only needs the one, tag-free spelling.
// The 9.0.2 BOM (#486) prefixes "VMware " and spells out "VMware Cloud Foundation ..." ("VMware
// Cloud Foundation Operations fleet management"), so both are folded to 9.1's "vcf ..." form.
const normBom = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  .replace(/\*+$/, '').replace(/^vmware /, '').replace(/^cloud foundation /, 'vcf ')
  .replace(/^vcf installer\/\s*/, '').replace(/\s*\(vcf service\)$/, '');
function extractBomBuild(html, c, line) {
  if (!c.bomName) return null;
  const want = normBom(c.bomName);
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map((td) =>
      td.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(),
    );
    if (cells.length < 3 || normBom(cells[0]) !== want) continue;
    const vi = cells.findIndex((x) => /^9\.\d+\.\d+/.test(x));
    if (vi === -1) continue;
    const build = (cells[vi + 1] || '').trim();
    if (!/^\d{8}$/.test(build)) return null;
    return { version: cells[vi], build, releaseDate: line.ga, sourceUrl: line.bom, patched: false };
  }
  return null;
}

// Builds reconciled by a human against the VCF Download Tool depot listing (#391), for
// components whose TechDocs value is wrong (a leaf printing a sibling's build) or missing (patched
// with no leaf, so only the BOM's GA build is readable). Applied ONLY while the scrape returns
// exactly the recorded `when` (version + build) for that line; as soon as Broadcom publishes
// anything newer, the entry stops matching and the scraped value wins again -- no stale override.
function applyDepotVerified(r, c, line) {
  const hit = (c.depotVerified || []).find((d) =>
    d.line === line.v && d.when.version === r.version && d.when.build === r.build);
  if (!hit) return r;
  return {
    ...r, version: hit.set.version ?? r.version, build: hit.set.build,
    releaseDate: hit.set.releaseDate ?? r.releaseDate, patched: true,
    reconciled: { scraped: `${r.version} / ${r.build}`, verified: hit.verified, note: hit.note,
      source: 'VCF Download Tool depot listing' },
  };
}

// Walk a line's patch tree for one component. Returns null (not throw) when the tree is
// reachable but carries no leaf for this component yet -- the caller then falls back to the BOM.
async function scrapeTechdocs(c, line) {
  const re = leafRe(c.leafSlug, line.y, line.z);
  let index, indexHtml = null;
  for (const p of [].concat(c.indexPath)) {
    index = `${line.patch}/${p}`;
    indexHtml = await fetchText(index).catch((err) => {
      if (/^HTTP 404$/.test(String(err.message || err))) return null;
      throw err;
    });
    if (indexHtml) break;
  }
  // A fresh line's patch tree doesn't grow every component's sub-index at once -- Broadcom adds
  // one as that component first patches (#353: 9.1.1's tree opened with only vcf-operations.html
  // and vcf-automation.html, days before vsphere/esx.html existed). A 404 here means "no patch
  // tree for this component yet", the same as an empty sub-index list below -- fall back to BOM
  // rather than surfacing it as a source error and freezing on the last-known value. With
  // several candidate paths (#390), only "all of them 404" means that.
  if (!indexHtml) return null;
  const subtreeDir = index.replace(/\.html$/i, '');
  const inSubtree = hrefs(indexHtml, index).filter((h) => h.startsWith(subtreeDir + '/'));

  // Candidate leaves, newest EEHH first. A tree can carry a sibling product's leaf at a higher
  // EEHH (#436: vsan-9-1-1-0200 is vSAN File Services), so the newest leaf is not necessarily this
  // component's: take the first one whose header actually matches (a null extraction is "not ours").
  let candidates;
  if (c.nested) {
    // Gather this component's leaf across ALL EEHH sub-indexes for this line (#187): a
    // component's latest patch can live in an older sub-index than the family's newest.
    // Sub-index filenames are normally dashed ("9-1-0-0400.html") but 9.1.1's first one shipped
    // as bare concatenated digits ("9100100.html", reusing the 9.1.0-style scheme) (#353), so
    // match any href directly under the component index whose filename is purely digits/dashes
    // rather than requiring the dashed shape.
    const subIdxs = inSubtree.filter((h) => /\/[\d-]+\.html$/i.test(h));
    if (!subIdxs.length) return null; // no patch sub-index for this line yet
    candidates = [];
    for (const s of subIdxs) {
      const subHtml = await fetchText(s);
      for (const h of hrefs(subHtml, s)) if (re.test(h)) candidates.push(h);
    }
  } else {
    candidates = inSubtree.filter((h) => re.test(h));
  }
  candidates = [...new Set(candidates)].sort((a, b) => eehh(b.match(re)[1]) - eehh(a.match(re)[1]));

  for (const leafUrl of candidates) {
    const leafHtml = await fetchText(leafUrl);
    const got = extractLeafBuild(leafHtml, c);
    if (!got || !got.build) continue;
    if (c.livePatch) got.livePatchable = extractLivePatchable(leafHtml);
    return { ...got, sourceUrl: leafUrl, patched: true };
  }
  if (candidates.length) throw new Error(`${candidates.length} leaf(s) found but none carried a matching build header`);
  return null;
}

// Single rolling release-notes page (vDefend, DSM, License Hub): read version + build in place.
async function scrapePage(c) {
  const text = plain(await fetchText(c.url));
  const vm = text.match(c.versionRe);
  if (!vm) throw new Error('no version match on page');
  const bm = c.buildRe ? text.match(c.buildRe) : null;
  if (c.buildRe && !bm) throw new Error('no build match on page');
  const dm = c.dateRe ? text.match(c.dateRe) : null;
  return { version: vm[1].trim(), build: bm ? bm[1].trim() : null, releaseDate: dm ? isoDate(dm[1]) : null, sourceUrl: c.url };
}

// Avi Load Balancer: no 8-digit build; each release is its own leaf under a train index.
const aviNum = (m) => parseInt(m[1], 10) * 1e6 + parseInt(m[2], 10) * 1e3 + parseInt(m[3], 10);
async function scrapeAvi(c) {
  const idxHtml = await fetchText(c.index);
  const leaf = hrefs(idxHtml, c.index)
    .map((h) => ({ h, m: h.match(c.leaf) }))
    .filter((x) => x.m)
    .sort((a, b) => aviNum(b.m) - aviNum(a.m))[0];
  if (!leaf) throw new Error('no Avi leaf href found');
  const text = plain(await fetchText(leaf.h));
  const vm = text.match(c.versionRe);
  const version = vm ? vm[1].trim() : leaf.m.slice(1, 4).join('.');
  return { version, build: null, releaseDate: null, sourceUrl: leaf.h };
}

// PowerShell Gallery (OData v2): the latest version of a module, and its publish date.
async function scrapePsGallery(c) {
  const feed = `https://www.powershellgallery.com/api/v2/FindPackagesById()?id='${c.id}'&$filter=IsLatestVersion`;
  const xml = await fetchText(feed);
  const v = xml.match(/<d:Version>([^<]+)<\/d:Version>/);
  if (!v) throw new Error('no version in gallery feed');
  const pub = xml.match(/<d:Published[^>]*>(\d{4}-\d{2}-\d{2})/);
  const parts = v[1].trim().split('.');
  const tail = parts[parts.length - 1];
  // "9.1.1.25718932" -> version 9.1.1, build 25718932; anything else is shown whole, no build.
  const hasBuild = parts.length === 4 && /^\d{8}$/.test(tail);
  return { version: hasBuild ? parts.slice(0, 3).join('.') : v[1].trim(), build: hasBuild ? tail : null,
    releaseDate: pub ? pub[1] : null, sourceUrl: c.url };
}

// PyPI JSON API: the latest release and its upload date. No build number is published.
async function scrapePypi(c) {
  const j = JSON.parse(await fetchText(`https://pypi.org/pypi/${c.id}/json`));
  const version = j?.info?.version;
  if (!version) throw new Error('no version in PyPI metadata');
  const files = j.releases?.[version] || [];
  const up = files[0]?.upload_time;
  return { version, build: null, releaseDate: up ? up.slice(0, 10) : null, sourceUrl: c.url };
}

const ADDON_SCRAPERS = { page: scrapePage, avi: scrapeAvi, psgallery: scrapePsGallery, pypi: scrapePypi };

function loadPrev() {
  try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return { lines: [], addons: [] }; }
}

async function main() {
  const prev = loadPrev();
  // keep-last-known lookup: composite key per line for components, bare key for add-ons.
  const prevByKey = new Map();
  for (const ln of prev.lines || []) for (const c of ln.components || []) prevByKey.set(`${ln.v}:${c.key}`, c);
  for (const a of prev.addons || []) prevByKey.set(`addon:${a.key}`, a);

  const errors = [];
  const lines = [];

  for (const line of LINES) {
    // A frozen line (#486) is not scraped: carry the last-known rows over unchanged.
    const prevLine = (prev.lines || []).find((l) => l.v === line.v);
    if (line.frozen && prevLine?.components?.length) {
      lines.push({ v: line.v, minor: `9.${line.y}`, ga: line.ga, hasPatchTree: !!line.patch,
        frozen: line.frozen, components: prevLine.components.map((c) => ({ ...c })) });
      console.log(`FRZN ${line.v}  ${prevLine.components.length} rows carried over (no patches since ${line.frozen.lastPatch})`);
      continue;
    }
    const bomHtml = await fetchText(line.bom).catch((err) => {
      errors.push({ key: `bom:${line.v}`, source: line.bom, error: String(err.message || err) });
      return null;
    });
    const comps = [];
    for (const c of line.y === 0 ? COMPONENTS_90 : COMPONENTS) {
      const base = { key: c.key, name: c.name, category: c.category };
      try {
        let r = line.patch ? await scrapeTechdocs(c, line) : null;
        if (!r && bomHtml) r = extractBomBuild(bomHtml, c, line);
        if (!r) throw new Error(line.patch ? 'no patch leaf and not found in BOM' : 'not found in BOM');
        r = applyDepotVerified(r, c, line);
        comps.push({
          ...base, version: r.version, build: r.build, releaseDate: r.releaseDate ?? null,
          sourceUrl: r.sourceUrl, patched: r.patched ?? true, ...(r.pinned ? { pinned: r.pinned } : {}),
          ...(r.reconciled ? { reconciled: r.reconciled } : {}),
          ...(typeof r.livePatchable === 'boolean' ? { livePatchable: r.livePatchable } : {}),
        });
        const tag = r.pinned ? 'PIN ' : r.reconciled ? 'DEPO' : r.patched === false ? 'GA  ' : 'OK  ';
        console.log(`${tag} ${line.v}  ${c.key.padEnd(20)} ${r.version}  Build ${r.build}` +
          (r.pinned ? `  (upstream renders "${r.pinned.raw}"; verified ${r.pinned.verified})` : ''));
      } catch (err) {
        const kept = prevByKey.get(`${line.v}:${c.key}`);
        errors.push({ key: `${line.v}:${c.key}`, source: line.patch || line.bom, error: String(err.message || err) });
        if (kept) {
          comps.push({ ...kept });
          console.warn(`KEEP ${line.v}  ${c.key.padEnd(20)} last-known ${kept.version} Build ${kept.build}  (${err.message})`);
        } else {
          comps.push({ ...base, version: null, build: null, releaseDate: null, sourceUrl: line.bom, patched: null });
          console.warn(`MISS ${line.v}  ${c.key.padEnd(20)} no prior value  (${err.message})`);
        }
      }
    }
    lines.push({ v: line.v, minor: `9.${line.y}`, ga: line.ga, hasPatchTree: comps.some((c) => c.patched),
      ...(line.frozen ? { frozen: line.frozen } : {}), components: comps });
  }

  const addons = [];
  for (const c of ADDONS) {
    const base = { key: c.key, name: c.name, category: c.category };
    try {
      const r = await ADDON_SCRAPERS[c.strategy](c);
      addons.push({ ...base, version: r.version, build: r.build, releaseDate: r.releaseDate ?? null, sourceUrl: r.sourceUrl, patched: true });
      console.log(`OK   addon ${c.key.padEnd(20)} ${r.version}  Build ${r.build}`);
    } catch (err) {
      const kept = prevByKey.get(`addon:${c.key}`);
      errors.push({ key: `addon:${c.key}`, source: c.url || c.index, error: String(err.message || err) });
      if (kept) {
        addons.push({ ...kept });
        console.warn(`KEEP addon ${c.key.padEnd(20)} last-known ${kept.version} Build ${kept.build}  (${err.message})`);
      } else {
        addons.push({ ...base, version: null, build: null, releaseDate: null, sourceUrl: c.url || c.index, patched: null });
        console.warn(`MISS addon ${c.key.padEnd(20)} no prior value  (${err.message})`);
      }
    }
  }

  const out = {
    _updated: new Date().toISOString().slice(0, 10),
    _family: FAMILY,
    _sourceErrors: errors,
    _sources: { releaseNotes: RELEASE_NOTES, releaseNotes90: RELEASE_NOTES_90 },
    lines,
    addons,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  const n = lines.reduce((s, l) => s + l.components.length, 0) + addons.length;
  console.log(`\nWrote ${OUT}  (${lines.length} line(s), ${n} rows, ${errors.length} source error(s))`);
  if (errors.length) process.exitCode = 0; // fail-safe kept last-known; do not fail CI
}

main().catch((e) => { console.error(e); process.exit(1); });
