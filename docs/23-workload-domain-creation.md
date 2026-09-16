# Workload Domain Creation Runbook — manual prep vs the wizard/API

> Closes #312. Companion to [`06-deployment-plan.md`](06-deployment-plan.md)
> epic **E9** (workload domain), which this doc expands into a linear
> runbook, and [`workbook-cell-mapping.md`](workbook-cell-mapping.md)'s
> **Deploy Workload Domain** sheet (intake `H1`-`H12`). Covers a **new** VI
> workload domain — a **new** cluster added to an *existing* domain is
> [`24-cluster-creation.md`](24-cluster-creation.md); adding hosts to an
> *existing, non-stretched* cluster is
> [`25-cluster-expansion.md`](25-cluster-expansion.md).

Creating a workload domain is mostly manual prep, unlike the [stretch
runbook](22-stretch-execution.md)'s single API call — SDDC Manager's own
procedure for this is a **UI wizard**, not an API-only flow. There is a JSON
API path too (needed for LACP networking or a domain without a cluster), but
it is not the primary documented route the way `clusterStretchSpec` is for
stretching.

---

## The sequence, end to end

```
network prep  →  commission hosts  →  DNS + image  →  create the domain
 (manual)         (manual)             (manual)         (wizard, or API)
```

---

## 1. Manual — network prep

From `01-network-dns-plan.md` and this domain's intake answers (`H1`-`H4`):

- Per-domain VLANs/subnets: ESX Management, vMotion, vSAN (or your chosen
  principal storage), NSX Host Overlay (**HOST TEP**), VM Management.
- **A static IP pool or a DHCP server configured and advertising IP addresses
  on the workload domain's NSX host overlay (HOST TEP) VLAN** — TechDocs
  states this as a hard prerequisite; the wizard will not proceed without one
  or the other.
- Build the **network pool** for this domain — same object and same ordering
  rule as the stretch runbook's step 2: **"A network pool with free IP
  addresses must be available"** before you commission hosts, per Broadcom's
  own prerequisite list. Same shape as intake `H8`: ESX Mgmt / vMotion / vSAN
  / vSAN Storage Client networks (VLAN / MTU / gateway / range).
- If using **Distributed** connectivity (`H4`): the external VLAN every host
  in this domain attaches to, its gateway CIDR, the routable external IP
  block, and the `/16` private transit-gateway block — see
  `01-network-dns-plan.md` §B.

## 2. Manual — commission the hosts

- **Hosts must be commissioned with the target principal storage type** —
  vSAN, NFS, VMFS on FC, or vVol. Mixing storage types within one cluster is
  not supported.
- For vSAN: SSD/NVMe disks with **no pre-existing partitions**, and a
  vSphere Lifecycle Manager image already present in the VCF image library.
- For vVols: a VASA provider added to the inventory first.
- If the management domain hosts have an **express patch** applied, this
  domain's hosts must be imaged with the **same** express patch.
- Image with the supported ESXi ISO — [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation)
  — configure the management network, DNS, NTP, root; then **commission**
  into SDDC Manager, into the network pool from step 1.

## 3. Manual — DNS records

Forward (A) + reverse (PTR) records for every appliance FQDN this domain
will use: vCenter, NSX Manager appliances (1-3 + cluster), and — if
Distributed connectivity — the VNA appliances. All must resolve **before**
the wizard starts; it validates DNS live.

## 4. Create the domain — wizard (primary path)

**VCF Operations, not SDDC Manager** — SDDC Manager's own UI is deprecated
in VCF 9 (see `CLAUDE.md`). TechDocs-verified click-path: **Operate →
Overview → Inventory**, expand **VCF Instances** and select your instance,
then the **Add workload domain** dropdown → **Create new** → review
prerequisites → **Select All** → **Proceed**. Deployment type **"Full
deployment with cluster"** builds vCenter + NSX + the first cluster in one
run; **"Domain infrastructure only"** builds vCenter + NSX with no cluster
(hosts/cluster added later — this is also the only path if you need a domain
with **more than one vDS** or hosts with **more than two pNICs**, which
requires the API instead, see below).

Page by page:

1. **General Information** — domain name (3-20 chars), deployment type,
   **Enable vSphere Supervisor** toggle, optional dual-stack networking, SSO
   domain name.
   > **Always use a new, separate SSO domain per workload domain — this
   > isn't really a "choice" to weigh with the architect, it's the standard
   > answer.** A new SSO domain *"creates a workload domain that is isolated
   > from the other workload domains in your VCF instance"*, and that
   > isolation is what you want by default. **Name it `vsphere.local`**
   > rather than something domain-specific — KISS: one name to remember
   > across every domain, matching TechDocs' own examples, instead of a
   > naming scheme to invent and keep consistent. See `02-intake.md` `H2`.
2. **vCenter** — FQDN, IP, gateway (`H2`).
3. **Cluster** — name, vLCM-images checkbox, vSphere Zone name.
4. **Image** — pick from the image catalog, or extract one from a reference
   host.
5. **Networking** — join an existing NSX Manager or deploy a new one
   (deployment size, appliance size, FQDNs); VPC network config (Full Stack
   vs VLAN-backed); Centralized vs Distributed connectivity (`H4`) — if
   Distributed: VLAN, gateway CIDR, external IP block, private transit
   block, VNA cluster.
6. **Storage** — principal storage type, then the matching sub-page (vSAN
   cluster type/encryption/FTT/space-efficiency; NFS datastore+server; FC
   datastore; or vVol protocol/provider/container).
7. **Hosts** — select from the ESX hosts commissioned in step 2 for this
   storage type.
8. **vSphere Distributed Switch** — a profile (Default, Storage Separation,
   NSX Separation, Combined Separation, or Custom) mapping traffic types to
   uplinks/LAGs.
9. **vSphere Supervisor** (only if enabled in step 1) — Supervisor name,
   Service CIDR, management network, NSX project, VPC connectivity profile,
   private CIDR ranges, workload DNS/NTP.
   > **Enabling Supervisor here has a consequence later, not now:** *"After
   > the workload domain deployment is complete, you must deploy an NSX
   > Edge cluster with a Tier-0 gateway to complete Supervisor activation,
   > unless you are using an existing NSX Manager instance with a compatible
   > NSX Edge cluster."* Plan the Edge cluster into the same delivery window
   > (`06-deployment-plan.md` E6) — Supervisor won't finish activating
   > without it.

What the wizard builds for you: the vCenter instance, the NSX Manager
instance (new or joined), the vSphere cluster, the vDS(es), the datastore(s),
and Supervisor if enabled.

## 5. Create the domain — API (LACP, no-cluster, or scripted)

Needed instead of the wizard when: the domain needs **more than one vDS**,
hosts have **more than two pNICs**, you want **LACP** uplink teaming, or
you're building "Domain infrastructure only" (no cluster) for later
expansion. The spec is `DomainCreationSpec`, submitted the same
validate-then-PATCH pattern as the stretch runbook:
`POST /v1/domains/validations` → `PUT /v1/domains`.

### Building the JSON by hand

Same two lookups as the stretch runbook, plus one more specific to domain
creation:

- **Host IDs.** `GET /v1/hosts` with `status=UNASSIGNED_USEABLE`, copy the
  `id` for each commissioned host (step 2 above).
- **Cluster image ID.** From the image catalog you picked in the wizard's
  equivalent step — `GET /v1/releases` or the image-management endpoints,
  copy the `id` for `clusterImageId`.
- **NSX license key** — `nsxTSpec.licenseKey` below; not needed at all if
  `deployWithoutLicenseKeys: true`.

Trimmed example (2 hosts, one cluster, vSAN principal storage) — field names
and nesting verified against the
[VCF API reference](https://developer.broadcom.com/xapis/vmware-cloud-foundation-api/latest/data-structures/DomainCreationSpec/)'s
`DomainCreationSpec` and its nested types:

```json
{
  "domainName": "sfo-w01",
  "orgName": "sfo",
  "vcenterSpec": {
    "name": "sfo-w01-vc01",
    "networkDetailsSpec": {
      "ipAddress": "10.11.14.10",
      "dnsName": "sfo-w01-vc01.sfo.rainpole.io",
      "gateway": "10.11.14.1",
      "subnetMask": "255.255.255.0"
    },
    "rootPassword": "VMw@re1!VCF",
    "datacenterName": "sfo-w01-dc01",
    "vmSize": "medium",
    "storageSize": "lstorage"
  },
  "computeSpec": {
    "clusterSpecs": [
      {
        "name": "sfo-w01-cl01",
        "clusterImageId": "<image catalog ID>",
        "hostSpecs": [
          {
            "id": "<host 1 ID>",
            "licenseKey": "<ESXi license key, or omit with deployWithoutLicenseKeys>",
            "hostNetworkSpec": {
              "vmNics": [
                { "id": "vmnic0", "vdsName": "sfo-w01-cl01-vds01", "uplink": "uplink1" },
                { "id": "vmnic1", "vdsName": "sfo-w01-cl01-vds01", "uplink": "uplink2" }
              ],
              "networkProfileName": "sfo-w01-cl01-network-profile01"
            }
          },
          { "id": "<host 2 ID>", "...": "same shape as host 1" }
        ],
        "datastoreSpec": {
          "vsanDatastoreSpec": {
            "datastoreName": "sfo-w01-cl01-ds-vsan01",
            "failuresToTolerate": 1,
            "licenseKey": "<vSAN license key, or omit with deployWithoutLicenseKeys>"
          }
        },
        "networkSpec": {
          "vdsSpecs": [
            {
              "name": "sfo-w01-cl01-vds01",
              "mtu": 9000,
              "portGroupSpecs": [ "<one entry per traffic type — same idea as the wizard's vDS profile page>" ]
            }
          ],
          "nsxClusterSpec": { "...": "ipAddressPoolsSpec + uplinkProfiles — identical shape to the stretch runbook's nsxClusterSpec" },
          "networkProfiles": [
            {
              "name": "sfo-w01-cl01-network-profile01",
              "isDefault": true,
              "nsxtHostSwitchConfigs": [ "<binds the profile to the vDS + pool/uplink profile by name — see the stretch runbook>" ]
            }
          ]
        }
      }
    ]
  },
  "nsxTSpec": {
    "nsxManagerSpecs": [
      { "name": "sfo-w01-nsx01a", "networkDetailsSpec": { "...": "IP/gateway/DNS, same shape as vcenterSpec's" } },
      { "name": "sfo-w01-nsx01b", "...": "same shape" },
      { "name": "sfo-w01-nsx01c", "...": "same shape" }
    ],
    "vipFqdn": "sfo-w01-nsx01.sfo.rainpole.io",
    "licenseKey": "<NSX license key, or omit with deployWithoutLicenseKeys>",
    "nsxManagerAdminPassword": "VMw@re1!VCF",
    "formFactor": "medium"
  },
  "ssoDomainSpec": {
    "ssoDomainName": "vsphere.local",
    "ssoDomainPassword": "VMw@re1!VCF"
  },
  "deployWithoutLicenseKeys": true
}
```

Field-by-field, the parts that aren't self-explanatory or that overlap with
the stretch runbook:

- **`vcenterSpec`** — one vCenter appliance per domain, always. `vmSize` /
  `storageSize` are the same tiering choice as the bring-up vCenter
  (`tiny`/`small`/`medium`/`large`/`xlarge`; `lstorage`/`xlstorage`) — size
  it against the domain's expected inventory, not just copy the management
  domain's.
- **`computeSpec.clusterSpecs[].hostSpecs[]`** — one entry per commissioned
  host from step 2. `hostNetworkSpec.vmNics[]` is the **wizard's page-8 vDS
  profile, expressed per host** instead of picked from a dropdown — get the
  uplink-to-vDS mapping wrong here and the host fails to join the vDS,
  exactly like the stretch runbook's `hostSpecs[].hostNetworkSpec.vmNics`.
- **`computeSpec.clusterSpecs[].datastoreSpec`** — pick the block matching
  your principal storage type: `vsanDatastoreSpec` (shown),
  `nfsDatastoreSpecs[]`, `vmfsDatastoreSpec`, or `vvolDatastoreSpecs[]` —
  only one applies per cluster, matching the wizard's step-6 branch.
  `failuresToTolerate` is vSAN OSA-only; vSAN ESA clusters use `esaConfig`
  instead.
- **`computeSpec.clusterSpecs[].networkSpec.vdsSpecs[]`** — one entry **per
  vDS**; this is the field that makes the API path mandatory for a
  **more-than-one-vDS** domain, since the wizard's vDS profile page only
  builds one. `mtu` applies per vDS, not per uplink.
- **`networkSpec.nsxClusterSpec`** and **`networkSpec.networkProfiles[]`** —
  identical shape and gotchas to the stretch runbook's `networkSpec` (the
  AZ2 TEP pool + sub-TNP profile) — see
  [`22-stretch-execution.md`](22-stretch-execution.md#building-the-json-by-hand)
  for the field-by-field breakdown of `ipAddressPoolsSpec`,
  `uplinkProfiles[]`, and `nsxtHostSwitchConfigs[]`. The one difference
  here: `networkProfiles[].isDefault` is **always `true`** for a new
  domain's first (and normally only) network profile — there's no
  management-vs-workload split to make, because this *is* the domain's
  cluster being created fresh, not a stretch being added to one that
  already has a default profile.
- **`nsxTSpec.nsxManagerSpecs[]`** — 1 appliance for a small/compact
  deployment or 3 for a standard HA cluster, same choice as page 5's
  "deploy a new one" branch. `vipFqdn` (shown) or `vip` — TechDocs: *"Can
  be omitted if FQDN is provided"* — provide one or the other, not
  necessarily both.
- **`ssoDomainSpec`** — per the corrected guidance in step 4 above:
  **always `ssoDomainName: "vsphere.local"`**, never a domain-specific
  name. Omitting `ssoDomainSpec` entirely joins an existing SSO domain
  instead of creating a new, isolated one — don't omit it unless that's
  deliberately what you want.
- **`deployWithoutLicenseKeys`** — same field and same guidance as the
  stretch runbook: leave `true` unless you specifically want the call to
  hard-fail on a missing license key. With it `true`, every
  `licenseKey` field above can be omitted.
- **`securitySpec`** (not shown) — optional; only needed to set
  non-default password-complexity or account-lockout policy at creation
  time rather than after the fact in vCenter/NSX directly.

`vcenterSpec`, `computeSpec`, and `nsxTSpec` are each large, deeply-nested
objects (per-host vmnic mappings, per-vDS uplink profiles, NSX transport
zones) — the same category of detail the stretch runbook's `hostSpecs` /
`nsxClusterSpec` cover, multiplied across every host and network in the
domain. Hand-building the full JSON is realistic but long; the practical
path is
[**VCFJsonSpecCreators**](https://github.com/pauldiee/VCFJsonSpecCreators)'s
`New-VCFWorkloadDomain.ps1` (`06-deployment-plan.md` Story 9.3 already
references it), which assembles the nested specs from simpler inputs,
validates, and submits. Reach for the raw JSON only for the LACP or
without-a-cluster variants where the wizard doesn't reach.

## 6. Acceptance

- WLD healthy in SDDC Manager: vCenter and NSX Manager reachable and green.
- First cluster (if created) online, storage healthy for the chosen
  principal type.
- North-south reachable per the connectivity model chosen (`H4`) —
  Centralized: Tier-0 + BGP routes; Distributed: DTGW on the external VLAN,
  fabric routing confirmed.
- With Supervisor enabled: connectivity prerequisites met, ready for the NSX
  Edge cluster / Tier-0 step if using a new NSX Manager instance.
