# VCF Automation — First-Time Tenant / Organization Configuration

What you do **after** the VCF Automation appliance is deployed, to turn a bare
instance into something a tenant can consume: a **region**, an **external IP
block**, one or more **external connections**, and an **organization** (with its
Avi integration). [`docs/05-day2-deployments.md`](05-day2-deployments.md) covers
*deploying* VCF Automation — the methods, the networking, the two CIDRs; this
page picks up once that appliance is up and you first log in.

> **Scope.** This is the **manual** bring-up path — the VCF Automation **Login
> Provider** screen offers a guided setup and a **Manual setup**; everything
> below is the Manual setup walkthrough. It assumes the appliance is deployed and
> healthy, the Supervisor(s) you intend to use are enabled
> ([`docs/10-supervisor-enablement.md`](10-supervisor-enablement.md)), NSX is
> reachable, and — if a tenant needs public/north-south connectivity — an NSX
> **Edge cluster + Tier-0** exists. **Field-verified 2026-08-31** on a customer
> deployment.

## Contents

| # | Step | Key inputs |
| - | ---- | ---------- |
| 1 | [Create a region](#1-create-a-region) | Name (immutable), NSX Manager, Supervisor, storage class |
| 2 | [Create an external IP block](#2-create-an-external-ip-block) | CIDR, ranges, exclusions, subnet limits |
| 3 | [Create an external connection](#3-create-an-external-connection) | Tier-0, IP block |
| 4 | [Create an organization](#4-create-an-organization) | Quota, VM/storage classes, networking, Avi |

Order matters: a connection (step 3) needs a region (step 1) and an IP block
(step 2); an organization (step 4) needs all three.

---

## 1. Create a region

A region binds VCF Automation to one **NSX Manager** + one **Supervisor** and the
storage it may place workloads on.

| Field | Notes |
| ----- | ----- |
| **Name** | **Cannot be changed after creation** (TechDocs: *"You cannot edit the region name and NSX Manager instance."*) — pick a naming scheme you can live with (site / vCenter / Supervisor). |
| **NSX Manager** | The NSX Manager backing the Supervisor's workload networking. Like the name, it **cannot be changed after creation**. A single NSX Manager must integrate with every vCenter in the region. |
| **Supervisor** | One or more vSphere Supervisors this region schedules onto. |
| **Storage class** | One or more, backed by a vSphere **storage policy** — see the gotcha below. Storage classes must exist with **identical names and configuration** across every Supervisor in the region. |

> **The storage class needs a storage *policy* first.** VCF Automation's storage
> classes are surfaced from vSphere **storage policies**. If the policy the
> tenant should use does not exist yet, create it in vCenter **before** you get
> to this field — there is no "create policy" affordance in the region wizard.

> **Re-scan vCenter after creating a policy.** A storage policy added while the
> region wizard is open (or after) will **not** appear until VCF Automation
> re-reads vCenter: go to **Automation → Connections**, open the relevant
> vCenter connection, and **Refresh storage classes**. Then the new class shows
> up for selection.

---

## 2. Create an external IP block

The pool of routable address space that external connections carve tenant
networks out of. (**Formerly "IP space"** — renamed in 9.1, which also added
multiple CIDRs per block and included/excluded custom ranges.)

1. **Name** — a per-tenant / per-customer block name; **Region** — the region
   from step 1; **Hide block from org** — toggle on if this block should not be
   visible to organization users (provider-only). **Next.**
2. **CIDR** — the block itself (the only required field on this page); **IP
   address ranges** — the usable sub-ranges within the CIDR; **Excluded IPs** —
   addresses to carve out (gateways, existing appliances). **Next.**
3. Allocation limits — **number of single IPs**, **number of CIDRs**, and
   **maximum subnet size** an organization may request against this block.
   **Create.**

---

## 3. Create an external connection

How tenant networks reach outside the Supervisor — the join between a Tier-0 and
an IP block. (**Formerly "provider gateway"**; 9.1 also calls the Tier-0-backed
kind a **"centralized connection"**, alongside a distributed-VLAN kind.)

> **A public connection may need its own Edge cluster.** If this connection
> provides north-south / internet reachability and no suitable NSX **Edge
> cluster + Tier-0** exists yet, create one first (NSX side). The wizard only
> *selects* a Tier-0; it does not build the edge path — and the Tier-0 it selects
> must be **Active-Standby** and bound to an existing NSX Edge cluster.

1. **Name**, **Region**. **Next.**
2. **Tier-0** — the NSX Tier-0 gateway this connection routes through.
3. **IP block** — the external IP block from step 2 this connection allocates
   from.
4. **Remote networks** — leave at the defaults unless the design calls for
   specific advertised routes.
5. **Review and complete.**

---

## 4. Create an organization

The tenant boundary — quota, the VM and storage classes it may use, its
networking, and its load balancing.

1. **Name** the organization.
2. **Region quota** — choose **portion** or **full**:
   - **Portion** — set the **capacity** slice and the **Supervisor zone** it
     draws from.
   - **Full** — the organization gets the region's whole capacity.
3. **VM classes** and **storage classes** — select which of the region's classes
   this organization is entitled to.
4. **Configure networking** — select an **external connection** (step 3) for the
   organization's networks. **Assign and continue.**
5. **Configure Avi in the organization** — choose the load-balancing model:
   - **Organization-managed** — the tenant administers its own Avi objects.
   - **Provider-managed** — the provider retains control.

   Then select the **service units** allocated to the organization.

> **Avi must already be deployed and integrated.** This step assigns Avi
> capacity to a tenant; it does not deploy Avi. See
> [`docs/14-avi-load-balancer.md`](14-avi-load-balancer.md) for the controller
> deployment and [the Supervisor LB note](10-supervisor-enablement.md) for where
> Avi is and is not required.

---

## After the four steps

The organization now has quota, classes, a route out, and load balancing — a
tenant administrator can log in and start creating projects and deploying. Verify
by logging in as an org user and confirming the region, the available VM/storage
classes, and that a test network provisions against the external connection.

> **The org's Administer → Bills page will throw `Internal Server Error`** until
> VCF Operations' cost currency is set (**Operate → Administration → Global
> Settings → Cost/Price → Currency**) and the daily cost-calculation job has run.
> See [`05-day2-deployments.md` → VCF Automation tenant billing](05-day2-deployments.md#vcf-automation-tenant-billing--the-bills-page-needs-a-cost-currency-set).

---

## References

The four steps above were cross-checked against Broadcom TechDocs (VCF 9.1); the
storage-policy prerequisite and the *Connections → Refresh storage classes* step
are field observations not stated in the docs.

- [Create a Region in Your VCF Automation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/provider-management/provider-virtual-datacenters/create-a-provider-virtual-datacenter.html)
  and [Managing Regions](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/provider-management/provider-virtual-datacenters.html)
  ("You cannot edit the region name and NSX Manager instance").
- [Managing IP Address Blocks and IP Quotas in VCF Automation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/organization-management/adding-and-managing-virtual-private-clouds/ip-management.html).
- [Add a Provider Gateway to Your VCF Automation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/provider-management/managing-networking-resources/managing-provider-gateways/add-a-provider-gateway.html)
  (the "external connection" of 9.1).
- [Create an Organization](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/provider-management/managing-organizations/create-an-organization.html)
  and [Edit the General Settings of a Region Quota](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/provider-management/managing-organizations/region-quota-of-an-organization/edit-the-general-settings-of-a-region-quota.html)
  ("Share the entire capacity" vs "Share a portion of the capacity").
- [What's New — VCF Automation 9.1](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/what-s-new/whats-new-vcf-automation.html)
  (IP spaces → external IP blocks, provider gateways → external/centralized
  connections, multi-Supervisor region quota, full Avi self-service).
- [Quick Start Your VCF Automation Setup](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/provider-management/getting-started-with-the-vcloud-director-service-provider-portal/quick-start-your-vcf-automation-setup.html)
  (the guided alternative to the Manual setup checklist this page follows).
