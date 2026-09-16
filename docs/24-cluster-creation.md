# Cluster Creation Runbook — adding a cluster to an existing workload domain

> Closes #313. Companion to [`06-deployment-plan.md`](06-deployment-plan.md)
> epic **E9**, story 9.3's `New-VCFClusterSpec.ps1` reference. Covers adding
> a cluster to a **domain that already exists** — creating the **domain and
> its first cluster together** is
> [`23-workload-domain-creation.md`](23-workload-domain-creation.md); adding
> hosts to an *existing* cluster is
> [`25-cluster-expansion.md`](25-cluster-expansion.md).

Unlike the [stretch runbook](22-stretch-execution.md), Broadcom's VCF 9.1
documentation covers this operation **only through the SDDC Manager UI
wizard** — there is no dedicated 9.1 API walkthrough page for adding a
cluster (there was one for older VCF versions, but it isn't carried forward
in the current docs set). The underlying API endpoint still exists and is
what [**VCFJsonSpecCreators**](https://github.com/pauldiee/VCFJsonSpecCreators)'s
`New-VCFClusterSpec.ps1` drives, but this runbook follows Broadcom's own
documented path: the wizard.

---

## The sequence, end to end

```
network pool  →  commission hosts  →  create the cluster (wizard)
 (manual)          (manual)             one wizard, ~8 pages
```

---

## 1. Manual — network pool and commissioned hosts

- The **network pool** and the hosts you're adding must **already exist** —
  same ordering rule as `22-stretch-execution.md` and
  `23-workload-domain-creation.md`: build the pool, then commission.
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

## 2. Create the cluster — wizard

SDDC Manager → the target workload domain → **Add Cluster**.

1. **General Information** — cluster name.
2. **Image** — select from the image catalog, or extract from a reference
   host (same choice as workload domain creation).
3. **Storage** — principal storage type: vSAN, NFS, VMFS on FC, or vVol.
   Each cluster in a multi-cluster domain **can use a different type**, as
   long as every host **within** that cluster matches.
4. **Storage Details** — the type-specific configuration (vSAN
   type/encryption/FTT, NFS server+path, FC datastore name, or vVol
   protocol/provider/container) — same sub-pages as
   `23-workload-domain-creation.md` step 4.
5. **Host Selection** — pick from the commissioned, matching-storage-type
   hosts from step 1. A **skip failed hosts** toggle lets the wizard proceed
   with the hosts that pass pre-checks rather than blocking on one bad host.
6. **vSphere Distributed Switch** — create a new vDS, or **reuse an
   existing one** if the four conditions above are met.
7. **Review** — verify every prior page's selections.
8. **Validation** — SDDC Manager runs its pre-checks; **Finish** only
   commits once validation completes.

## 3. Acceptance

- Cluster online in SDDC Manager, storage healthy for the chosen principal
  type.
- Hosts joined, vDS configured (new or reused) and reachable across all
  configured traffic types.
- If DHCP-backed Host Overlay: hosts have received TEP addresses from the
  DHCP server.
