# Cluster Expansion Runbook — adding hosts to an existing cluster

> Closes #314. Companion to
> [`24-cluster-creation.md`](24-cluster-creation.md) (a **new** cluster) and
> [`22-stretch-execution.md`](22-stretch-execution.md) (stretching an
> existing cluster across AZs — a different operation from what's here).
> This doc covers adding hosts to an **existing, non-stretched** cluster to
> grow its capacity.

The documented **click-path** for this operation runs through the **vSphere
Client**, not a dedicated SDDC Manager wizard — like
`24-cluster-creation.md` (Create SDDC Cluster), **not** like
`23-workload-domain-creation.md`, which genuinely is a SDDC Manager UI
wizard end to end. Broadcom's own page notes *"you can instead perform this
task using the SDDC Manager UI"* as an alternative but does not document
that alternative's click path — treat the vSphere Client flow below as the
supported, documented UI route.

**The underlying SDDC Manager API is fully reference-documented**, though
(`PATCH /v1/clusters/{clusterId}` with `ClusterExpansionSpec`), and it's the
only documented path to a handful of options the vSphere Client wizard
doesn't expose at all — see §3 below.

---

## The sequence, end to end

```
network pool has room  →  commission the host  →  add it (vSphere Client)
      (manual)                (manual)              Actions > Add Hosts
```

---

## 1. Manual — before you add anything

- **The host must match the existing cluster's configuration**: same
  principal storage type, and — per Broadcom — *"the ESX host to be added
  matches the configuration of the ESX hosts already in the SDDC cluster."*
  **Different NIC enumeration is allowed** (a host doesn't need vmnic0/1 in
  the identical physical slot), but the storage type must match exactly.
- If this cluster's NSX Host Overlay uses a **static IP pool**, confirm it
  **has enough free addresses** for the hosts you're adding before you
  start — the wizard does not grow the pool for you.
- Commission the host into SDDC Manager first (same network pool as the
  existing cluster) — it must show as **unassigned** and **active** in the
  Hosts inventory.
- **vSAN stretched clusters cannot use a shared vDS** — if this cluster is
  stretched, don't route this expansion through a vDS-reuse path meant for
  non-stretched clusters.
- **9.1.1+ vDS limits still apply**: adding a host to a cluster on a shared
  vDS keeps you under 128 vDS per vCenter / 16 per ESX host — same ceiling
  as `24-cluster-creation.md`'s vDS-reuse rules.

## 2. Add the host — vSphere Client

1. Browse to the vSphere cluster in the vSphere Client inventory.
2. Select the cluster → **Actions → Add Hosts → Add Unassigned Hosts**.
3. Select the commissioned host(s) to add → **Next**.
4. Review the proposed switch/network configuration → **Next**.
5. Review host, switch configuration, and license details → **Finish**.

What the wizard automates for you, by storage type:

- **NFS and vVols** — storage is auto-configured and mounted; no manual
  datastore steps.
- **VMFS on FC** — storage is **not** automatic: you handle zoning,
  mounting the volume, and datastore creation yourself before or alongside
  the host add.
- **Any type** — uplinks are assigned and the host is connected to the
  cluster's vDS (shared or otherwise) automatically.

## 3. Add the host — API (scripted alternative)

`PATCH /v1/clusters/{clusterId}` carrying a `ClusterExpansionSpec`,
validated first via `POST /v1/clusters/{clusterId}/validations` — same
validate-then-submit pattern as the other three runbooks.

### Building the JSON by hand

- **Cluster ID.** `GET /v1/clusters`, copy the `id` of the cluster you're
  expanding.
- **Host ID(s).** `GET /v1/hosts` with `status=UNASSIGNED_USEABLE`, copy the
  `id` for each commissioned host from §1 above.

Trimmed example (1 host) — field names verified against the
[VCF API reference](https://developer.broadcom.com/xapis/vmware-cloud-foundation-api/latest/data-structures/ClusterExpansionSpec/)'s
`ClusterExpansionSpec`:

```json
{
  "hostSpecs": [
    {
      "id": "<host ID>",
      "licenseKey": "<ESXi license key, or omit with deployWithoutLicenseKeys>",
      "hostNetworkSpec": {
        "vmNics": [
          { "id": "vmnic0", "vdsName": "sfo-w01-cl01-vds01", "uplink": "uplink1" },
          { "id": "vmnic1", "vdsName": "sfo-w01-cl01-vds01", "uplink": "uplink2" }
        ],
        "networkProfileName": "sfo-w01-cl01-network-profile01"
      }
    }
  ],
  "networkSpec": {
    "nsxClusterSpec": { "...": "cluster-expansion-specific NSX config — ClusterExpansionNsxSpec, same idea as the stretch/creation runbooks' nsxClusterSpec but its own type" },
    "networkProfiles": [ "<ClusterExpansionNetworkProfile — same idea as networkProfiles elsewhere, its own type>" ]
  },
  "deployWithoutLicenseKeys": true
}
```

Field-by-field, the parts specific to expansion:

- **`hostSpecs[]`** — 1-64 hosts per call (`minItems: 1`, `maxItems: 64`).
  Same `hostNetworkSpec.vmNics[]` shape as the creation/stretch/
  domain-creation specs: mirror the existing cluster's vmnic-to-vDS mapping
  exactly, or the host fails to join.
- **`networkSpec`** is `ClusterExpansionNetworkSpec` — a **distinct type**
  from the `NetworkSpec` used by `ClusterCreationSpec`/`DomainCreationSpec`,
  even though `nsxClusterSpec` and `networkProfiles` mean the same thing
  conceptually. Don't assume the exact field names from
  `23-workload-domain-creation.md` §5 carry over unchanged — check the
  linked reference for this call specifically before submitting.
- **`witnessSpec`** / **`witnessTrafficSharedWithVsanTraffic`** /
  **`vsanNetworkSpecs`** (not shown above) — **only relevant if this
  cluster is stretched**, which §1's precondition list already rules out for
  this runbook (*"vSAN stretched clusters cannot use a shared vDS"*). If
  you're expanding a **stretched** cluster instead, use
  `22-stretch-execution.md`'s field-by-field breakdown of the equivalent
  fields on `clusterStretchSpec` as your reference for these three.
- **`interRackExpansion`** — *"Is inter-rack cluster expansion (L2
  non-uniform/L3 vs. L2 uniform). Required for clusters with NSX Edge
  Cluster."* Set this if the hosts you're adding sit in a different
  rack/L2 segment than the cluster's existing hosts and this cluster hosts
  an NSX Edge cluster — easy to miss because nothing in the vSphere Client
  wizard surfaces this concept at all.
- **`deployWithoutLicenseKeys`** — same field and guidance as the other
  three runbooks: leave `true` unless you specifically want the call to
  hard-fail on a missing license key.
- **`forceHostAdditionInPresenceofDeadHosts`** /
  **`skipThumbprintValidation`** — both **deprecated, no effect when used**
  per the API reference; don't rely on either even though they still appear
  in the spec.

## 4. Acceptance

- Host shows **connected** in the cluster, matching build/patch level to
  its cluster-mates.
- Storage healthy: for VMFS, the datastore you manually zoned/mounted is
  visible and consumed by the new host; for NFS/vVols, auto-mounted and
  visible.
- If a static TEP IP pool was used: the new host received an address from
  it, not from overflow/DHCP fallback.
