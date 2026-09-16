# Cluster Creation Runbook — adding a cluster to an existing workload domain

> Closes #313. Companion to [`06-deployment-plan.md`](06-deployment-plan.md)
> epic **E9**, story 9.3's `New-VCFClusterSpec.ps1` reference. Covers adding
> a cluster to a **domain that already exists** — creating the **domain and
> its first cluster together** is
> [`23-workload-domain-creation.md`](23-workload-domain-creation.md); adding
> hosts to an *existing* cluster is
> [`25-cluster-expansion.md`](25-cluster-expansion.md).

**Broadcom's documented click-path for this runs through the vSphere
Client, not SDDC Manager** — the same shape as `25-cluster-expansion.md`:
you browse to the domain's vCenter and drive the wizard from there. TechDocs
is explicit that the SDDC Manager UI (**deprecated in VCF 9** — see
`CLAUDE.md`) is the *alternative* here, not the primary route:
*"Additionally, you can perform this task using the SDDC Manager UI."* There is also no dedicated 9.1 API *walkthrough page* for
adding a cluster (there was one for older VCF versions, but it isn't carried
forward in the current docs set). **The underlying API endpoint itself is
still live and reference-documented** (`POST /v1/clusters` with
`ClusterCreationSpec`) — it's what
[**VCFJsonSpecCreators**](https://github.com/pauldiee/VCFJsonSpecCreators)'s
`New-VCFClusterSpec.ps1` drives — so section 3 below covers it as the
scripted alternative: vSphere Client for a normal, click-through delivery;
API for LACP, multi-vDS, EVC/HA settings the wizard doesn't expose, or
scripted/repeatable delivery.

---

## The sequence, end to end

```
network pool  →  commission hosts  →  create the cluster (vSphere Client)
 (manual)          (manual)             one wizard, ~6 pages
```

---

## 1. Manual — network pool and commissioned hosts

- The **network pool** and the hosts you're adding must **already exist** —
  same ordering rule as `22-stretch-execution.md` and
  `23-workload-domain-creation.md`: build the pool, then commission. Image
  and commission new hosts with
  [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation)
  before this step.
- Hosts must be **in active state**, commissioned, and use the **same
  principal storage type as the cluster** you're creating.
- If this cluster's NSX Host Overlay uses **DHCP** rather than a static IP
  pool, a DHCP server must already be configured and advertising on that
  VLAN — the wizard does not configure DHCP for you.
- You need access to the **management domain vCenter** (or VCF SSO with
  vCenter linking) to run the wizard against this domain.

### Reusing an existing vDS (9.1.1+)

If you want the new cluster to **join an existing vDS** rather than get its
own, four conditions all apply:

- The source cluster (already on that vDS) and the new cluster must be in
  the **same network pool** and the **same data center**.
- Neither cluster may be **configured as a stretched cluster**.
- Total vDS count must stay under **128 per vCenter** and **16 per ESX
  host** — reusing a vDS doesn't bypass these ceilings, it just avoids
  adding a new one.

Get any of these wrong and the wizard's vDS step won't offer the existing
switch as a reuse target — it isn't a soft warning, it's a hard filter.

## 2. Create the cluster — vSphere Client

In the vSphere Client for the domain's vCenter, browse to the VCF instance
datacenter in the inventory, select it, then **Actions → New Cluster →
Create SDDC Cluster**. TechDocs' own prerequisite matches the note in §1
above, verbatim: *"To perform this task in the vSphere Client, you must have
access to the management domain vCenter, or your VCF Instance must be
configured with VCF SSO and vCenter linking."*

1. **Storage Type** — *"Select the storage type for the SDDC cluster and
   click Begin."* Principal storage type: vSAN, NFS, VMFS on FC, or **vVol
   (deprecated as of VCF/VVF 9.0 — see `02-intake.md` `H6`; don't default a
   new design to it)**. Each cluster in a multi-cluster domain **can use a
   different type**, as long as every host **within** that cluster matches.
2. **Cluster naming & image** — *"Enter a name for the SDDC cluster"* and
   *"Select a cluster image from the drop-down menu"* (or extract from a
   reference host, same choice as workload domain creation).
3. **Storage configuration** — the type-specific page matching what you
   picked on page 1 (*"Enter the vSAN/NFS/FC/vVol Storage details and click
   Next"*) — same sub-pages as `23-workload-domain-creation.md` step 4.
4. **Host Selection** — *"select hosts for the SDDC cluster and click
   Next"* — pick from the commissioned, matching-storage-type hosts from
   step 1 above.
5. **Distributed Switch** — *"Enter the Distributed Switch details and
   click Next"* — create a new vDS, or **reuse an existing one** if the
   four conditions above are met.
6. **Review** — *"review the vSphere cluster details and click Finish."*

TechDocs also flags a remediation consequence worth planning for, not just
approving through: *"If the cluster image contains a different version of a
vendor add-on or component than what is installed on the ESXi hosts you add
to the cluster, the hosts will be remediated"* during creation — budget time
for that if your commissioned hosts weren't imaged against the exact image
you pick on page 2.

**This flow has no "skip failed hosts" toggle or standalone validation
page** — those exist at the API level (`computeSpec.skipFailedHosts` in §3
below) and may exist in SDDC Manager's own UI alternative, but the six
vSphere Client pages above are all there is. If a host fails here, sort it
out and remove/replace it rather than looking for a way to proceed around
it.

## 3. Create the cluster — API (scripted alternative)

`POST /v1/clusters` carrying a `ClusterCreationSpec`, validated first via
`POST /v1/clusters/validations` — same validate-then-submit pattern as the
stretch and domain-creation runbooks.

### Building the JSON by hand

Same lookups as `23-workload-domain-creation.md` §5 — host IDs
(`GET /v1/hosts` with `status=UNASSIGNED_USEABLE`) and the cluster image ID
— plus one more:

- **Domain ID.** `GET /v1/domains`, copy the `id` of the workload domain
  you're adding this cluster to — `ClusterCreationSpec` is domain-scoped,
  not standalone.

Trimmed example (2 hosts, vSAN principal storage) — field names and nesting
verified against the
[VCF API reference](https://developer.broadcom.com/xapis/vmware-cloud-foundation-api/latest/data-structures/ClusterCreationSpec/)'s
`ClusterCreationSpec`:

```json
{
  "domainId": "<workload domain ID>",
  "computeSpec": {
    "clusterSpecs": [
      {
        "name": "sfo-w01-cl02",
        "clusterImageId": "<image catalog ID>",
        "hostSpecs": [
          {
            "id": "<host 1 ID>",
            "licenseKey": "<ESXi license key, or omit with deployWithoutLicenseKeys>",
            "hostNetworkSpec": {
              "vmNics": [
                { "id": "vmnic0", "vdsName": "sfo-w01-cl02-vds01", "uplink": "uplink1" },
                { "id": "vmnic1", "vdsName": "sfo-w01-cl02-vds01", "uplink": "uplink2" }
              ],
              "networkProfileName": "sfo-w01-cl02-network-profile01"
            }
          },
          { "id": "<host 2 ID>", "...": "same shape as host 1" }
        ],
        "datastoreSpec": {
          "vsanDatastoreSpec": {
            "datastoreName": "sfo-w01-cl02-ds-vsan01",
            "failuresToTolerate": 1,
            "licenseKey": "<vSAN license key, or omit with deployWithoutLicenseKeys>"
          }
        },
        "networkSpec": {
          "vdsSpecs": [
            { "name": "sfo-w01-cl02-vds01", "mtu": 9000 }
          ],
          "nsxClusterSpec": { "...": "ipAddressPoolsSpec + uplinkProfiles — identical shape to the stretch/domain-creation runbooks" },
          "networkProfiles": [
            { "name": "sfo-w01-cl02-network-profile01", "isDefault": true, "nsxtHostSwitchConfigs": [ "<binds the profile to the vDS + pool/uplink profile by name>" ] }
          ]
        },
        "advancedOptions": {
          "evcMode": "<EVC baseline, e.g. intel-icelake — omit to inherit the cluster default>",
          "highAvailability": { "enabled": true }
        }
      }
    ],
    "skipFailedHosts": false
  },
  "deployWithoutLicenseKeys": true
}
```

Field-by-field, the parts specific to cluster creation (everything else —
`hostSpecs[].hostNetworkSpec`, `datastoreSpec`, `networkSpec.vdsSpecs`/
`nsxClusterSpec`/`networkProfiles` — is identical in shape and gotchas to
`23-workload-domain-creation.md` §5, since both specs nest the same
`ComputeSpec.ClusterSpec` structure):

- **`domainId`** — the one field this spec has that `DomainCreationSpec`
  doesn't: which existing domain the cluster is added to. Get this from the
  domain-ID lookup above, not the domain name.
- **`computeSpec.skipFailedHosts`** — lets the call proceed with whichever
  hosts pass pre-checks instead of blocking on one bad host; **the vSphere
  Client flow in §2 has no equivalent toggle**, this is API-only.
- **`clusterSpecs[].advancedOptions`** — **not exposed by the vSphere
  Client wizard at all.** `evcMode` sets an Enhanced vMotion Compatibility
  baseline at creation time instead of configuring it after the fact in
  vCenter; `highAvailability.enabled` toggles vSphere HA on the cluster
  immediately rather than as a separate post-creation step. This is one of
  the concrete reasons to reach for the API path even when you don't need
  LACP or a reused vDS.
- **`networkSpec.vdsSpecs[]`** — one entry per vDS; **to reuse an existing
  vDS** (the four-condition check in §1 above) instead of creating a new
  one, reference the existing vDS's `name` here rather than a new one —
  the API doesn't have a separate "reuse" flag, reuse is just naming an
  object that already exists.
- **`deployWithoutLicenseKeys`** — same field and guidance as the stretch
  and domain-creation runbooks: leave `true` unless you specifically want
  the call to hard-fail on a missing license key.

## 4. Acceptance

- Cluster online in SDDC Manager, storage healthy for the chosen principal
  type.
- Hosts joined, vDS configured (new or reused) and reachable across all
  configured traffic types.
- If DHCP-backed Host Overlay: hosts have received TEP addresses from the
  DHCP server.
