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
