# Research — IPv6 for external application access on the VPC model + VCF Automation

*Research notes, not a build guide. Not published on the site (lives outside
`docs/`). Captured 2026-09-09 from public TechDocs / Broadcom blogs — verify
against the target build's docs and a lab before acting on it.*

## Question

Can the NSX **VPC networking model** and **VCF Automation** handle **IPv6** for
**external access to applications** — i.e. tenant workloads (or the VCFA portal)
reachable over IPv6 from outside the DMZ?

## Answer (as of VCF 9.1)

**No — not in a supported or documented way.** The layers that would carry
external IPv6 to tenant apps are either explicitly IPv4-only or have no
documented IPv6 support.

| Layer | IPv6 for external app access? | Basis |
| ----- | ---------------------------- | ----- |
| **vSphere Supervisor / VKS** (where most VPC-model tenant apps run) | **No — explicitly IPv4-only.** A `LoadBalancer` Service / Ingress for a tenant app gets an IPv4 VIP only. | Supervisor requirements: *"IPv6 is not supported."* |
| **VCF Automation's own endpoints** (portal, platform FQDN, VS VIP) | **IPv4.** | Fleet LCM deployment spec is IPv4-only: `vspClusterSpec.ipv4Pool.addresses`, `ingress.vcfa.vips.ipv4`. The 9.1 "external IP blocks" enhancement (multi-CIDR, exclusions, Infoblox IPAM) is documented with no IPv6 mention. |
| **NSX VPC constructs** — external IP blocks, private / transit CIDRs, Private/Public/Isolated subnets, VPC NAT, the built-in VPC load balancer | **No documented IPv6 / dual-stack support** in 9.0 or 9.1. | NSX-T *below* the VPC layer (T0/T1, segments, BGP, NAT64) has had dual-stack since NSX-T 2.4, but that is not surfaced through the VPC abstraction. Public 9.1 NSX/VPC release notes and blogs are silent on VPC IPv6. |
| **Avi Load Balancer** | Avi supports IPv6 / dual-stack virtual services in general — but in the NSX-VPC integration the VIP is drawn from the VPC external IP block, so it inherits the IPv4 constraint. | |
| **Where IPv6 *is* first-class** | NSX **Manager cluster VIP** (IPv4 / IPv6 / dual-stack) and lower-level NSX infrastructure — **not** the VPC consumption layer. | |

## Practical position

- App on **Supervisor / VKS** → not possible today (IPv4-only cluster
  networking).
- Plain **VM workload in a VPC** → gated by IPv6 on the VPC subnet + external
  block, which is not documented as supported.
- **Workaround if it is a hard requirement:** a **dual-stack front-end outside
  the VPC / Supervisor scope** — an external LB or edge device terminating IPv6
  and proxying (IPv6 → IPv4) to the IPv4 VIP — or do not use the VPC / Supervisor
  model for that workload.

## Unverified / open

- No Broadcom statement found that *explicitly* confirms **or** denies IPv6 for
  the **VPC layer itself** (external IP blocks / VPC subnets / VPC LB). The
  definitive IPv4-only signals are on **Supervisor** and the **VCFA deployment
  schema**, not the VPC construct.
- Could change in a maintenance release — re-check the target build's NSX + VPC
  admin guide and the Supervisor requirements page.
- Not tested in a lab. A quick check would be: try to create a VPC external IP
  block with an IPv6 CIDR, and try an IPv6 subnet in a VPC, on the target NSX
  build.

## Sources

- [Requirements for Supervisor deployment with NSX VPC (9.1)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/vsphere-supervisor-installation-and-configuration/supervisor-networking-with-virtual-private-clouds/nsx-vpc-workflow-for-supervisor/requirements-for-supervisor-deployment-with-nsx-vpc.html) — "IPv6 is not supported"
- [What's New — VCF Automation 9.1](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/what-s-new/whats-new-vcf-automation.html)
- [What's New — NSX 9.1](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/release-notes/vmware-cloud-foundation-9-1-0-0-release-notes/what-s-new/whats-new-nsx.html)
- [VCF 9.1 Networking — VPC Network Services (Broadcom blog)](https://blogs.vmware.com/cloud-foundation/2026/05/15/vcf-networking-9-1-exploring-network-services-for-virtual-private-clouds/)
- [IPv6 Support in the NSX Platform Infrastructure](https://techdocs.broadcom.com/us/en/vmware-cis/nsx/vmware-nsx/4-2/installation-guide/nsx-ipv6-configuration/ipv6-support-in-the-nsx-platform-infrastructure.html)
- [NSX Virtual Private Clouds (admin guide)](https://techdocs.broadcom.com/us/en/vmware-cis/nsx/vmware-nsx/4-2/administration-guide/nsx-multi-tenancy/nsx-virtual-private-clouds.html)
