# Stretch Execution Runbook — manual steps vs the API

> Closes #311. Companion to [`03-multi-az-prep.md`](03-multi-az-prep.md) (design/prep —
> what stretches vs per-AZ, witness, capacity) and
> [`06-deployment-plan.md`](06-deployment-plan.md) epics **E7** (management domain) /
> **E9** (workload domain), which this doc expands into a linear runbook. Read
> `03` first — this page assumes the design decisions there (M1-M6, section D) are
> already made.

A VCF cluster stretch is **one API call** doing a lot of work, bracketed by
manual prep that the API cannot do for you. This page draws that line
explicitly, for both the management domain (first) and a workload domain
(after the management domain is stretched).

---

## The sequence, end to end

```
inter-AZ fabric  →  commission AZ2 hosts  →  deploy witness  →  stretch (API)
   (manual)            (manual)                (manual)          (one call)
```

Same order for a workload domain, once the management domain is stretched.

---

## 1. Manual — inter-AZ fabric (before any of this)

Confirm against `03-multi-az-prep.md` sections A-C: `<5 ms` RTT + `≥10 Gbps`
between AZ1/AZ2, witness RTT budget, MTU 9000 end-to-end, per-AZ subnets for
ESX Management / vMotion / vSAN / **host TEP**, stretched L2 only for VM
Management. This is a hard gate — resolve it before touching hosts.

## 2. Manual — build the AZ2 network pool, then commission the hosts

Broadcom's own prerequisites list these as two separate, ordered items:
*"Create a network pool for availability zone 2"* comes before *"Commission
vSAN ESA or OSA hosts for availability zone 2."* Build the pool first — the
commission call binds each host to a pool by ID, so there is nothing to bind
to until it exists.

- **Build the AZ2 network pool first.** SDDC Manager → Administration →
  Network Settings → Network Pools (or `POST /v1/network-pools`). Same shape
  as intake `H8` / `docs/workbook-cell-mapping.md`: the **vMotion + vSAN**
  VMkernel network definitions for AZ2 — VLAN, MTU, gateway, IP range. This
  pool is a distinct object from the AZ2 host TEP (overlay) subnet below —
  vMotion/vSAN and the NSX host overlay are configured and validated
  separately, don't treat "network pool" as covering both.
- Image the AZ2 hosts with the supported ESXi ISO. Use
  [**VCFHostPreparation**](https://github.com/pauldiee/VCFHostPreparation) to
  prep and commission quickly.
- Configure the per-AZ management network on each host (IP / VLAN / gateway),
  DNS, NTP, root credentials.
- **Commission** them into SDDC Manager, into the AZ2 network pool you just
  built. They now sit as available/unassigned hosts, ready for the stretch —
  SDDC Manager does not touch them until step 4.

Separately, this is where the most common failure mode lives — not the
network pool above, but the AZ2 host TEP:

> **Host TEP must be a genuinely distinct per-AZ subnet, not a reused AZ1
> VLAN.** Per `03-multi-az-prep.md` section D, ESX Host Overlay (TEP) is
> *"unique per availability zone"* — there is no option to stretch it, even
> if every other network (VM Management aside) in your design is flat L2
> across sites. If you reuse AZ1's TEP VLAN/subnet for AZ2, the stretch API
> call in step 4 fails with `ipAssignmentType not found for the NSX overlay
> VDS for the cluster <id>` (`PUBLIC_INTERNAL_SERVER_ERROR`,
> `IllegalStateException`) — SDDC Manager/NSX have nothing to register as a
> second, distinct IP-assignment entry on the cluster's overlay VDS. Give
> AZ2 its own TEP VLAN/subnet even when the rest of the fabric is
> deliberately L2-stretched end to end.

**Reserve the AZ2 TEP subnet/range in your IP plan now — but don't build
anything for it in NSX yet.** Unlike the network pool above, there is no
manual NSX object to create here. The AZ2 host-overlay IP pool
(`ipAddressPoolsSpec` in the step 4 JSON, e.g. a pool named
`sfo-w01-az2-host-ip-pool01` with its own CIDR/gateway/range) and the
transport-node sub-profile that consumes it are both declared **inline in the
stretch API payload** and created **by the stretch call itself**. Broadcom is
explicit: *"SDDC Manager automatically creates this sub-TNP during the
stretch operation... Do not create the profile manually before submitting
the API request."* Pre-building a TEP profile/pool in NSX Manager ahead of
the stretch doesn't save a step — it conflicts with what step 4 creates for
you.

## 3. Manual — deploy the witness

- Deploy the vSAN witness appliance (`VMware-VirtualSAN-Witness-*.ova`) at the
  **third** site. A witness serves **only one** stretched cluster — the
  management domain and each stretched workload domain each need their own.
- Route it to **both** AZs' ESX-management networks (witness traffic rides the
  ESX Management VMkernel on data hosts — no dedicated witness VLAN).
- **Don't deploy via the ESXi Host Client** — it fails at step 1
  (`Invalid qualifier: ValueMap{"Management", "Secondary"}`). Deploy through a
  vCenter that reaches the witness host, or use `ovftool`/`govc` against the
  host directly.
- **Verify the VMkernel gateways after deploy regardless of method** — the
  witness OVA has shipped with wrong management/vSAN gateways that need fixing
  by hand (DCUI / Host Client) before it can route back to both AZs.

Full detail, RTT budgets, and the routing requirement: `03-multi-az-prep.md`
section B.

## 4. API — the stretch call itself

One `PATCH /v1/clusters/{id}` (or `/v1/domains` shape for the initial
management-domain case) carrying a `clusterStretchSpec`, validated first via
`POST /v1/clusters/{id}/validations`. This is what SDDC Manager does for you
in that single call:

- Builds the fault domains (AZ1 preferred / AZ2 secondary / witness)
- Balances the commissioned AZ2 hosts across the cluster
- Flips the datastore storage policy to **site mirroring** (~2x capacity)
- Wires in Edge-cluster multi-AZ config, **if** you set
  `isEdgeClusterConfiguredForMultiAZ: true` correctly (required when the
  cluster already hosts an NSX Edge cluster — get this wrong and the
  edge-specific AZ configuration is silently skipped)

You supply: the AZ2 network pool (step 2), the commissioned AZ2 hosts (equal
count to AZ1), and the witness (step 3). Nothing else — no separate call to
build fault domains or flip the storage policy.

### Building the JSON by hand

Get the two lookups out of the way first — you need both before you can fill
in the spec:

- **AZ2 host IDs.** `GET /v1/hosts` with `status=UNASSIGNED_USEABLE`, copy the
  `id` for each commissioned AZ2 host.
- **Cluster ID.** `GET /v1/clusters`, copy the `id` of the cluster you're
  stretching.

Trimmed example (2 hosts; add one `hostSpecs` entry per AZ2 host, equal count
to AZ1) — field names and shape verbatim from Broadcom's SDDC Manager API
Explorer walkthrough. **The one field in here that changes between a
management-domain stretch and a workload-domain stretch is
`networkProfiles[].isDefault`** — shown below as `true` (management domain);
set it `false` for a workload domain. Everything else in the spec is the
same shape either way:

```json
{
  "clusterStretchSpec": {
    "deployWithoutLicenseKeys": true,
    "hostSpecs": [
      {
        "id": "<AZ2 host 1 ID>",
        "hostname": "sfo02-m01-r01-esx01.sfo.rainpole.io",
        "hostNetworkSpec": {
          "networkProfileName": "sfo02-m01-r01-network-profile01",
          "vmNics": [
            { "id": "vmnic0", "vdsName": "sfo-m01-cl01-vds01", "uplink": "uplink1" },
            { "id": "vmnic1", "vdsName": "sfo-m01-cl01-vds01", "uplink": "uplink2" }
          ]
        }
      },
      {
        "id": "<AZ2 host 2 ID>",
        "hostname": "sfo02-m01-r01-esx02.sfo.rainpole.io",
        "hostNetworkSpec": {
          "networkProfileName": "sfo02-m01-r01-network-profile01",
          "vmNics": [
            { "id": "vmnic0", "vdsName": "sfo-m01-cl01-vds01", "uplink": "uplink1" },
            { "id": "vmnic1", "vdsName": "sfo-m01-cl01-vds01", "uplink": "uplink2" }
          ]
        }
      }
    ],
    "networkSpec": {
      "networkProfiles": [
        {
          "isDefault": true,
          "name": "sfo02-m01-r01-network-profile01",
          "nsxtHostSwitchConfigs": [
            {
              "ipAddressPoolName": "sfo02-m01-r01-ip-pool01-host",
              "uplinkProfileName": "sfo02-m01-r01-uplink-profile01",
              "vdsName": "sfo-m01-cl01-vds01",
              "vdsUplinkToNsxUplink": [
                { "nsxUplinkName": "uplink1", "vdsUplinkName": "uplink1" },
                { "nsxUplinkName": "uplink2", "vdsUplinkName": "uplink2" }
              ]
            }
          ]
        }
      ],
      "nsxClusterSpec": {
        "ipAddressPoolsSpec": [
          {
            "name": "sfo02-m01-r01-ip-pool01-host",
            "subnets": [
              {
                "cidr": "10.12.14.0/24",
                "gateway": "10.12.14.1",
                "ipAddressPoolRanges": [
                  { "start": "10.12.14.101", "end": "10.12.14.132" }
                ]
              }
            ]
          }
        ],
        "uplinkProfiles": [
          {
            "name": "sfo02-m01-r01-uplink-profile01",
            "transportVlan": 1214,
            "teamings": [
              {
                "name": "DEFAULT",
                "policy": "LOADBALANCE_SRCID",
                "standByUplinks": [],
                "activeUplinks": ["uplink1", "uplink2"]
              }
            ]
          }
        ]
      }
    },
    "isEdgeClusterConfiguredForMultiAZ": true,
    "witnessSpec": {
      "fqdn": "sfo-m01-cl01-vsw01.sfo.rainpole.io",
      "vsanCidr": "10.21.10.0/24",
      "vsanIp": "10.21.10.218"
    },
    "witnessTrafficSharedWithVsanTraffic": false
  }
}
```

What each block is doing, and why it trips people up:

- **`hostSpecs[]`** — one entry per AZ2 host. `id`/`hostname` come from the
  two lookups above. `vmNics` **must mirror the exact vmnic-to-vDS mapping
  the AZ1 hosts on this cluster already use** — same uplink names, same
  count — or the host fails to join the cluster's vDS.
- **`networkSpec.networkProfiles[]`** — this is the sub-TNP from the TEP
  callout above. `name` is a label you choose; **don't pre-create it in
  NSX** — SDDC Manager creates it from this spec during the PATCH. `isDefault`
  is the field the management-vs-workload gotcha below turns on.
- **`networkProfiles[].nsxtHostSwitchConfigs[]`** — the wiring: it binds the
  network profile to the vDS (`vdsName`) and points it at the pool and uplink
  profile defined below by **name reference**
  (`ipAddressPoolName`/`uplinkProfileName`), not by inline value. Get a name
  mismatch between here and `nsxClusterSpec` and the profile silently has no
  pool to assign from.
- **`networkSpec.nsxClusterSpec.ipAddressPoolsSpec[]`** — the actual AZ2 TEP
  subnet: `cidr` / `gateway` / `ipAddressPoolRanges`. **This is the subnet
  that must be genuinely distinct from AZ1's** — see the TEP callout above;
  reusing AZ1's here is what produces the
  `ipAssignmentType not found for the NSX overlay VDS` failure.
- **`nsxClusterSpec.uplinkProfiles[]`** — `transportVlan` is the AZ2
  host-overlay VLAN ID; `teamings[].activeUplinks` must match how AZ1's
  uplink profile is already teamed (same policy, same uplink count) so the
  two AZs' hosts behave identically on the shared vDS.
- **`isEdgeClusterConfiguredForMultiAZ`** — `true` only if this cluster
  already hosts an NSX Edge cluster (per the precondition list above); leave
  `false` otherwise.
- **`witnessSpec`** — `fqdn` / `vsanCidr` / `vsanIp` of the witness appliance
  deployed and gateway-fixed in step 3.
- **`deployWithoutLicenseKeys`** — defers license-key validation for whatever
  the call would otherwise check licensing on, same as the domain-creation
  spec's field of the same name. `true` lets the stretch proceed on
  evaluation/unlicensed capacity and enforces licensing later; `false` makes
  the call fail up front if a required key isn't already assigned. Leave it
  `true` (as shown) unless you specifically want the stretch to hard-fail on
  a missing license.
- **`witnessTrafficSharedWithVsanTraffic`** — the vSAN
  [witness traffic separation](https://knowledge.broadcom.com/external/article/324702/) toggle: `true` tags witness traffic onto the
  same VMkernel interface as vSAN data traffic; `false` routes it over a
  separate interface instead. **This runbook's own step 3 puts witness
  traffic on the ESX Management VMkernel, not the vSAN VMkernel** — so
  `false` (as shown) is the value that matches the routing this doc has you
  build. Only flip it to `true` if you've instead made the vSAN network
  itself routable to the witness site and want witness traffic riding that
  interface.

Optionally build, validate, and submit the spec with
[**VCFJsonSpecCreators**](https://github.com/pauldiee/VCFJsonSpecCreators)'s
`New-VCFvSANStretchSpec.ps1`, which assembles the JSON, calls
`/validations`, and PATCHes it — setting `isEdgeClusterConfiguredForMultiAZ`
for you. `networkProfiles[].isDefault` must be `true` for a management-domain
stretch, `false` for a workload domain (`03-multi-az-prep.md` / the script's
own gotcha notes cover why: management's AZ2 profile *is* the cluster's first
VCF network profile, a workload domain's AZ1 default already exists and AZ2
is a sub-config).

### Preconditions that hard-fail this call

Check these before submitting — none of them are visible from the JSON shape
alone:

- The cluster must not share a vSAN storage policy with another cluster
- No DPU-backed hosts
- No L3-different subnets **within** a single AZ (the per-AZ split in step 2
  is AZ1-vs-AZ2, not host-vs-host inside one AZ)
- **vSphere Supervisor must not be enabled on the cluster** — enable
  Supervisor only after the stretch, not before

### Reading the response

Verified against a live VCF 9.1 SDDC Manager
(`03-multi-az-prep.md` / the JSON spec creators repo):

| Response | Means |
| --- | --- |
| `REST_INVALID_API_INPUT` — "Invalid input" | Schema-layer rejection — the JSON shape is wrong |
| `ESXIS_NOT_FOUND` / hosts not found on a `/validations` dry run | Schema passed — only tripped on placeholder host UUIDs, this is the success signal for a dry run |
| `PUBLIC_INTERNAL_SERVER_ERROR` with a `causes[]` array | Schema passed, failure is downstream (NSX/vSAN resolution) — read `causes[]`, not the top-level message |

## 5. Acceptance

- SDDC Manager reports the cluster stretched
- vSAN healthy and storage-policy compliant (site mirroring)
- Isolating one AZ keeps VMs running on the surviving site

---

## Workload domain: same pattern, one precondition

A stretched workload domain follows steps 1-5 identically, with its **own**
AZ2 hosts and its **own** witness (never shared with the management witness —
the shared-witness feature is 2-node-cluster only, not stretched). The one
hard gate: **the management domain must already be stretched (E7) before any
workload-domain cluster can be stretched.** Edge Overlay + Uplinks are
stretched only under NSX **Centralized** connectivity; under Distributed
they're per-AZ, same as the management-domain case.

Full story breakdown: `06-deployment-plan.md` E9, stories 9.1-9.6.
