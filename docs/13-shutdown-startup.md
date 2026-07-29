# Shutdown and Startup — Ordered Runbook

Powering a VCF 9.1 fleet down and back up is **an ordered procedure, not a set of
power operations**. Broadcom states it plainly:

> "Shutting down VMware Cloud Foundation, for example, during hardware or power
> maintenance, and then starting it up must be done in a way that prevents data
> loss or appliance malfunction, and supports collection of troubleshooting data.
> You follow a strict order and steps for shutdown and startup of the VMware Cloud
> Foundation management components." **[documented]**

This page is the ordered sequence in one place, with the rules that are easy to
miss — the fleet-level VCF Operations constraint, what shared NSX does to the
order, and the infrastructure VMs that must go last.

**Why it lives in a planning repo:** your shutdown order is a function of *what
you deployed*. Every optional component from
[`05-day2-deployments.md`](05-day2-deployments.md) — VCF Automation, Operations
for Networks, Cloud Proxy, License Server, VCF Management Services — is a step in
the sequence below. Steps you never deployed simply drop out. Decide the fleet at
planning time and this runbook writes itself; discover it during a power
maintenance window and you are reading TechDocs at 02:00.

## Contents

| # | Section | Use it when |
| - | ------- | ----------- |
| 1 | [Before you touch anything](#1-before-you-touch-anything) | The pre-shutdown and pre-startup gates |
| 2 | [The three ordering rules](#2-the-three-ordering-rules-that-catch-people) | **Read this even if you skip the rest** |
| 3 | [Shutdown — workload domains first](#3-shutdown--workload-domains-first) | Powering the fleet down |
| 4 | [Shutdown — the management domain](#4-shutdown--the-management-domain-11-steps) | The 11-step management sequence |
| 5 | [Startup — the management domain](#5-startup--the-management-domain) | Powering back up |
| 6 | [Startup — workload domains](#6-startup--workload-domains) | Including the **Restart Clusters** step people miss |
| 7 | [References](#7-references) | The TechDocs pages and KBs behind the above |

---

## 1. Before you touch anything

**Before shutdown [documented]:**

- [ ] "Verify that you have complete backups of all management components" — see
      [`08-backup-target.md`](08-backup-target.md)
- [ ] "Verify that the management virtual machines are not running on snapshots"
- [ ] VADP-based backup solutions shut down per vendor guidance
- [ ] Migrate the **management vCenter to the first ESX host in the default
      management cluster** — Broadcom gives this as a way "to reduce startup
      time". Cheap to do, and it means you know which host to power on first
- [ ] Know which cluster hosts the management vCenter: "This cluster must be shut
      down last"

**Before startup [documented]:**

- [ ] External services available — "Storage, Active Directory, DNS, NTP, SMTP,
      and FTP or SFTP". If AD/DNS/NTP run *as VMs inside the management domain*,
      see rule 3 below; you are about to need them before they exist
- [ ] VADP backup solutions "properly started and operational according to the
      vendor guidance"

---

## 2. The three ordering rules that catch people

**Rule 1 — VCF Operations is last out, first in. At the *fleet* level.**

> "The VCF Instance that is running VCF Operations must be the last instance to
> shut down." **[documented]**

and on the way back up:

> "If you have shut down all VCF Instances in a VCF fleet, you must first start
> the VCF Instance, which is running VCF Operations." **[documented]**

This is a constraint *between* VCF instances, not within one. Shut down instances
that do **not** run VCF Operations and VCF Automation first. Multi-instance fleets
get this wrong because each instance looks self-contained.

**Rule 2 — shared NSX moves with the first workload domain.**

> "If the NSX Manager cluster and NSX Edge cluster are shared with other workload
> domains, shut down the NSX Manager and NSX Edge clusters as part of the shutdown
> of the first workload domain." **[documented]**

Startup mirrors it — start the *other* workload domains first, then the one
running the shared NSX Edge/VNA nodes, then the workloads that depend on NSX
services **[documented]**.

**Rule 3 — infrastructure VMs go last.**

> "If the management domain contains virtual machines that are running
> infrastructure services like Active Directory, NTP, DNS and DHCP servers, stop
> these virtual machines last." **[documented]**

And for vSAN, the wizard needs you to say so explicitly:

> "For a vSAN cluster, select **I confirm all VMs below are infrastructure VMs**
> in the vSAN shutdown wizard." **[documented]**

> This is a planning decision, not just an operational one. If AD, DNS and NTP
> live inside the management domain you are shutting down, startup has a
> chicken-and-egg problem — the platform wants those services before the VMs
> providing them exist. Worth settling in
> [`01-network-dns-plan.md`](01-network-dns-plan.md).

---

## 3. Shutdown — workload domains first

> "You shut down the customer workloads and the management components for the
> workload domains before you shut down the components for the management
> domain." **[documented]**

Per workload domain, in order **[documented]**:

| # | Component | Note |
| - | --------- | ---- |
| 1 | Virtualized customer workloads | Your tenants' VMs |
| 2 | Protection and recovery for the workload domain | If deployed |
| 3 | NSX Edge or VNA nodes | See rule 2 if shared |
| 4 | NSX Manager nodes | See rule 2 if shared |
| 5 | ESX hosts | vSAN wizard, or the NFS/FC path |
| 6 | vCenter for the workload domain | |

---

## 4. Shutdown — the management domain (11 steps)

The documented order **[documented]**. Steps for components you never deployed
drop out — see [`05-day2-deployments.md`](05-day2-deployments.md) for which of
these are optional.

| # | Component | How |
| - | --------- | --- |
| 1 | **VCF Automation** | VCF Operations UI → *Build* → *Lifecycle VCF Management Components* → *Components* tab → the component → *Actions* → *State management* → the power operation |
| 2 | **VCF Operations for Networks** | As above |
| 3 | **Cloud Proxy** appliances | As above |
| 4 | **License Server** | As above |
| 5 | **VCF Management Services** | The `vcf_services_runtime_shutdown.sh` script — see below |
| 6 | **VCF Operations** | Take the cluster offline first — see below |
| 7 | **Protection and recovery** for the management domain | If deployed |
| 8 | **NSX Edge or VNA nodes** | vSphere Client |
| 9 | **NSX Manager** nodes | vSphere Client |
| 10 | **SDDC Manager** appliance | vSphere Client |
| 11 | **ESX hosts and vCenter** | vSAN wizard **or** the NFS/FC path |

**Step 5 — VCF Management Services** is the one this repo already documents in
detail: [`08-backup-target.md` §6](08-backup-target.md#6-cold-backup--cold-maintenance-safely-shutting-down-the-management-services).
The documented procedure **[documented]** is to find the control-plane node IPs
in VCF Operations (*Build* → *Lifecycle VCF Management Components* → the *VCF
services runtime* component → the *Nodes* table), download
`vcf_services_runtime_shutdown.sh` from **Broadcom KB 440874** onto the SDDC
Manager appliance, `chmod +x` it, run it `--dry-run` first, then for real, and
finally shut down the guest OS of the VMs the script lists. **Do not hand-stop
the components** — the runtime has its own internal order.

**Step 6 — VCF Operations** has a step people skip **[documented]**:

1. VCF Operations admin UI at `https://<vcf_operations_fqdn>/admin` as the local
   `admin` user
2. *System status* → **Take cluster offline**, give a reason, OK.
   > "This operation might take about an hour to complete." Budget for it.
3. *Then* shut down the guest OS of each appliance in vCenter, "by following the
   order in Broadcom knowledge base article **341964**" — the appliance order
   within the cluster matters and lives in that KB

**Step 11 — hosts and vCenter.** For a vSAN cluster the documented path is the
*vSAN Shutdown cluster* wizard **[documented]**: verify vSAN Skyline health and
that resync has finished, add `root` to the **Exception Users** list on any host
in lockdown mode, then right-click the cluster → *vSAN* → *Shutdown cluster*, and
confirm all pre-checks are green. Repeat for the other vSAN clusters, leaving the
cluster hosting the management vCenter until last.

> "Connection to vCenter is lost because the vSAN shutdown cluster wizard shuts it
> down. The shutdown operation is complete after all ESXi hosts are stopped."
> **[documented]**
>
> Note the orchestration host the wizard names before you lose the UI — you will
> want it on the way back up.

Non-vSAN clusters follow the separate *Shut Down ESX Hosts with NFS or Fibre
Channel Storage* path instead.

---

## 5. Startup — the management domain

> "You start the management components for the management domain first. Then, you
> start the management components for the workload domains and the customer
> workloads." **[documented]**

The exact reverse of §4 **[documented]**:

| # | Component | Note |
| - | --------- | ---- |
| 1 | **vSAN and the ESX hosts** (or ESX hosts with NFS/FC storage) | Out-of-band — iLO / iDRAC |
| 2 | **SDDC Manager** | |
| 3 | **NSX Manager** | Wait for **Stable** — see below |
| 4 | **NSX Edge or VNA nodes** | |
| 5 | **Protection and recovery** | If deployed |
| 6 | **VCF Operations** | Power on per KB 341964, then bring the cluster online |
| 7 | **VCF Management Services** | |
| 8 | **License Server** | |
| 9 | **Cloud Proxy** | |
| 10 | **VCF Operations for Networks** | |
| 11 | **VCF Automation** | |

**Step 3 — NSX Manager.** Power on the nodes in the vSphere Client, then log in
to NSX Manager and confirm *System* → *Configuration* → *Appliances* shows the
cluster **Stable** with all nodes available before moving on **[documented]**.

> "This operation takes several minutes to complete until the NSX Manager cluster
> becomes fully operational again and its user interface — accessible."
> **[documented]**

**Step 6 — VCF Operations** is the reverse of the shutdown **[documented]**:
power on the appliances "by following the order in Broadcom knowledge base
article 341964", then in the admin UI at `/admin`, *System status* → **Bring
Cluster Online**.

> "Bringing the cluster online might take about an hour to complete."
> **[documented]** Two of these hour-long waits — one on the way down, one on the
> way up — belong in your maintenance-window estimate.

---

## 6. Startup — workload domains

Per workload domain **[documented]**:

| # | Component | Note |
| - | --------- | ---- |
| 1 | **vCenter** for the workload domain | vSphere Client; check vSAN health too if it has a vSAN cluster |
| 2 | **ESX hosts** | "using an out-of-band management interface, such as ILO or iDRAC" |
| 3 | **Restart Clusters** | **The step people miss** — see below |
| 4 | **NSX Manager** nodes | |
| 5 | **NSX Edge or VNA** nodes | |
| 6 | **Protection and recovery** | If deployed |
| 7 | **Virtualized customer workloads** | |

**Restart Clusters** has no equivalent on the shutdown side, which is why it gets
skipped:

> "After you start the ESX hosts and the vCenter appliance for a workload domain,
> restart all clusters to re-initiate the integration with the principal storage."
> **[documented]**

And rule 2 again, for shared NSX **[documented]**: start the other workload
domains, then the one running the shared NSX Edge/VNA nodes, then the customer
workloads that rely on NSX services.

---

## 7. References

- [Shutdown and Startup of VMware Cloud Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup.html) — the parent page
- [Shutting Down VMware Cloud Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/vcf-shutdown.html) · [Shut Down the Management Domain](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/vcf-shutdown/shut-down-the-management-domain.html) · [Shut Down a Workload Domain](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/vcf-shutdown/shut-down-the-virtual-infrastructure-workload-domain.html)
- [Starting Up VMware Cloud Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/sddc-startup.html) · [Start the Management Domain](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/sddc-startup/start-the-management-domain.html) · [Start a Workload Domain](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/sddc-startup/start-the-virtual-infrastructure-workload-domain.html)
- [Shut Down vSAN and the ESX Hosts in the Management Domain](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/vcf-shutdown/shut-down-the-management-domain/shut-down-the-esx-hosts-in-management-domain/shut-down-vsan-and-the-esx-hosts-in-a-management-domain.html) · [Shut Down the vSAN Cluster Using the Shutdown Cluster Wizard](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsan-deployment-administration-and-monitoring/administering-vmware-vsan/expanding-and-managing-a-vsan-cluster/shutting-down-and-restarting-the-vsan-cluster/shut-down-the-vsan-cluster.html)
- [Shut Down VCF Management Services](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/vcf-shutdown/shut-down-the-management-domain/shut-down-vcf-managament-services.html) · [Shut Down VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/vcf-shutdown/shut-down-the-management-domain/shut-down-vcf-operations.html) · [Start the NSX Manager Nodes](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/vcf-shutdown-and-startup/sddc-startup/start-the-management-domain/start-the-nsx-t-manager-virtual-machines-in-the-management-domain.html)
- Broadcom KB **341964** — the appliance order within the VCF Operations cluster
  (referenced by both the shutdown and startup pages)
- Broadcom KB [**440874**](https://knowledge.broadcom.com/external/article/440874/how-to-safely-shutdown-all-nodes-within.html) —
  `vcf_services_runtime_shutdown.sh`, covered in detail in
  [`08-backup-target.md` §6](08-backup-target.md#6-cold-backup--cold-maintenance-safely-shutting-down-the-management-services)
