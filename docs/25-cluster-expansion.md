# Cluster Expansion Runbook — adding hosts to an existing cluster

> Closes #314. Companion to
> [`24-cluster-creation.md`](24-cluster-creation.md) (a **new** cluster) and
> [`22-stretch-execution.md`](22-stretch-execution.md) (stretching an
> existing cluster across AZs — a different operation from what's here).
> This doc covers adding hosts to an **existing, non-stretched** cluster to
> grow its capacity.

The documented path for this operation runs through the **vSphere Client**,
not a dedicated SDDC Manager wizard — a difference from
`23-workload-domain-creation.md` and `24-cluster-creation.md`, both of which
are SDDC Manager wizards end to end. Broadcom's own page notes *"As an
alternative, you can perform this task using the SDDC Manager UI"* but does
not document that alternative's click path — treat the vSphere Client flow
below as the supported, documented route.

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

## 3. Acceptance

- Host shows **connected** in the cluster, matching build/patch level to
  its cluster-mates.
- Storage healthy: for VMFS, the datastore you manually zoned/mounted is
  visible and consumed by the new host; for NFS/vVols, auto-mounted and
  visible.
- If a static TEP IP pool was used: the new host received an address from
  it, not from overflow/DHCP fallback.
