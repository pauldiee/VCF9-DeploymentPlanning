# Internal CIDRs — Reference

Several VCF 9.1 components carve an **internal, non-routed** address block out
of the IP space for their own containers, pods, services or transit links.
None of these blocks needs a VLAN, a gateway or a DNS record, so they are easy
to forget in the Step 1 plan ([`01-network-dns-plan.md`](01-network-dns-plan.md)).
But each one is still a route inside the component, so if it overlaps a
network you actually route, traffic to that network is silently sent
inward and never leaves.

This page lists all of them in one place: the default, the alternatives you
can pick, where the value is set, and whether you can change it later.

> **The one rule:** no internal block may overlap **anything you route**
> (management, VM, vMotion, vSAN, TEP, edge uplinks, VPC external blocks, user
> and branch-office networks, VPN ranges). Unless a row below says sharing is
> allowed, they should not overlap **each other** either.

> **Evidence level:** TechDocs / KB / API reference sourced, links per row,
> checked 2026-10-22 against the VCF 9.1 / 9.1.1 pages. The License Hub 2.0 and
> Cloud Proxy rows are also field-verified (see `15-license-hub.md` and
> `27-vcf-operations-ha-cloud-proxy-vvf.md`).

---

## 1. Summary table

| # | Component | Default | Alternatives | Where it's set | Change later? |
| - | --------- | ------- | ------------ | -------------- | ------------- |
| 1 | **VCF services runtime** (VCF Management Services, VCF and VVF) | `198.18.0.0/15` | `240.0.0.0/15` or `250.0.0.0/15`, **fixed list**. IPv6: `fd00::/111` in the API sample | **9.1.0:** JSON spec / SDDC Manager API only (`internalClusterCidrIpv4`). **9.1.1+:** VCF Installer UI, *Internal cluster CIDR IPv4* | Not documented; treat it as fixed at deploy |
| 2 | **VCF Automation** services runtime | `198.18.0.0/15` | `240.0.0.0/15` or `250.0.0.0/15`. **May share** row 1's block | **9.1.0:** fleet lifecycle API only. **9.1.1+:** VCF Operations UI | Not documented; treat it as fixed at deploy |
| 3 | **License Hub 2.0** *Internal Cluster Network* | `10.10.0.0/16` | Any unused non-routable block, **≥512 addresses (`/23` or larger)** | OVA deploy, *Customize template* | Not documented; FQDNs and IPs are immutable, so assume this is too |
| 4 | **vDefend SSP** pod CIDR (SSP Installer flow) | Not stated by Broadcom | Any unused block, e.g. `10.27.0.0/16` (KB example) | `secop_capi_pod_cidr` in `/config/clusterctl/settings.json` on the SSP Installer appliance, **before** deploying | **No.** Changing it afterwards *"will not affect existing cluster"* |
| 5 | **Cloud Proxy** Docker subnet | Docker's own: `172.17.0.0/16` (bridge), then `172.18.0.0/16`, … | **Set it explicitly**, `/27` or larger | OVA deploy, *Docker Subnet* field | **No.** Only by deleting and recreating the Docker networks |
| 6 | **Supervisor** Service CIDR | Pre-filled by the wizard; no default documented | Any private block; this repo's example is `10.96.0.0/23`. VDS networking: `/16`. Classic NSX: `/16` minimum | Supervisor activation wizard / API (`default_service_cidr` in the 9.1 API) | Not without redeploying the Supervisor |
| 7 | **Supervisor** Pod CIDR (classic NSX segment networking only, API-only in 9.1) | None | `/23` minimum; this repo's example is `10.244.0.0/20` | Supervisor JSON / API | Not without redeploying the Supervisor |
| 8 | **VKS guest cluster** Pod / Service CIDRs | **None:** *"required, there is no default"* | Broadcom's examples: pods `192.168.0.0/16`, services `10.96.0.0/12`. Per cluster | Cluster manifest, `spec.clusterNetwork` | Not on a running cluster |
| 9 | **NSX** Tier-0 ↔ Tier-1 transit | `100.64.0.0/16` | Any unused block | Tier-0 `transit_subnets` | Yes, via the Policy API (see §2.6) |
| 10 | **NSX** SR ↔ DR internal transit | `169.254.0.0/24` (active-active), `169.254.0.0/28` (active-standby) | IPv4 only | Tier-0 `internal_transit_subnets` | Rarely needed; link-local |
| 11 | **NSX** default T0 ↔ child VRF transit | `169.254.2.0/23` | — | Tier-0 `vrf_transit_subnets` | Rarely needed; link-local |
| 12 | **NSX** T0/VRF ↔ Transit Gateway transit | `169.254.4.0/22` | — | Tier-0 `tgw_transit_subnets` | Rarely needed; link-local |
| 13 | **NSX** DHCP (reserved) | `100.96.0.0/30` | **Cannot be moved**: keep every other range off it | Created automatically when DHCP runs on a Tier-1 | — |

Not in this table:
- **Routed blocks** that sit next to these in the wizards: the services-runtime
  **node IP pool** and the VCF Automation **nodes CIDR** (both on VM
  Management, see `01-network-dns-plan.md`), the VPC **External IP Blocks**,
  and Supervisor ingress/egress (`10-supervisor-enablement.md`).
- **VPC Private CIDRs** and the **Private Transit Gateway IP Block**. They
  don't leave NSX, but you size and plan them like any other address block:
  see `10-supervisor-enablement.md` §3.3. A `/26` of the Private VPC CIDRs is
  reserved for the Avi Service Engines.

---

## 2. Per component

### 2.1 VCF services runtime and VCF Automation (rows 1–2)

One fixed pick-list for both, verbatim from TechDocs
([Deploy VCF Management Services … as Part of VCF Upgrade to 9.1][td-vcfms-upgrade]):

> *"VCF services runtime uses an internal CIDR block of 198.18.0.0/15. If this
> subnet is in use on your network, you must change the internal CIDR block for
> VCF management services to 240.0.0.0/15 or 250.0.0.0/15."*

**Sharing is allowed.** The same page: *"Different VCF services runtime
instances on the same network can work with the same internal network. For
example, you can have the two instances of VCF services runtime for your VCF
management services and VCF Automation using the same internal network."* So
leaving both at `198.18.0.0/15` is fine. Move both only if that block clashes
with something routed.

**UI vs API depends on the version.** *"With the VCF 9.1.0.x UI, you cannot
change the default internal network. With VCF 9.1.1 and later, you can change
the default internal network."* On 9.1.0 you set it in the JSON spec (VCF
Installer) or the SDDC Manager API for VCF Management Services, and in the
fleet lifecycle API for VCF Automation. *"Starting with VCF 9.1.1 you can specify
the internal networks during the deployment procedures by using the VCF
Installer UI or VCF Operations UI"* ([First VCF Instance FQDNs and IP
addresses][td-first-instance]). The 9.1.1 field help: *"Select a CIDR block
that does not overlap with any of your infrastructure networks, including
management, VM, and IP pool networks. An overlap causes routing conflicts and
breaks connectivity to or from the VCF services runtime cluster."*

The API sample uses `"internalClusterCidrIpv4": "198.18.0.0/15"` and, commented
out, `"internalClusterCidrIpv6": "fd00::/111"`.

**Log Management and Real-time Metrics** run **on** the services runtime, so
they have no internal block of their own. The *Internal cluster CIDR* in
[`31-log-management.md`](31-log-management.md) is row 1, set when VCF
Management Services is added to a VVF deployment.

**Picking an alternative:** `198.18.0.0/15` is the IANA benchmarking range,
and `240.0.0.0/15` / `250.0.0.0/15` sit in the reserved class E space, so none
of them should normally be routed. Check for `198.18.0.0/15` in lab and
test-equipment networks: that's where it is most often used.

### 2.2 License Hub 2.0 (row 3)

The OVA field defaults to `10.10.0.0/16`, and its tooltip (field-verified
2026-08-24) reads: *"The CIDR must support at least 512 IP addresses (prefix
/23 or smaller). Use non-routable IPs as this is for internal use only, and
ensure the range is not used elsewhere in your datacenter. Most deployments can
leave this at the default value."* ([License Hub Appliance System
Requirements][td-lichub-req]).

`10.10.0.0/16` sits in RFC 1918 space, so it collides more often than the
services-runtime defaults. Check it against your IP plan. If it is in use,
pick any other unused block of `/23` or larger. Avoid `198.18.0.0/15` here if
the services runtime already uses it: Broadcom only allows sharing between
services-runtime instances, not with License Hub. See
[`15-license-hub.md`](15-license-hub.md).

### 2.3 vDefend SSP (row 4)

[KB 388890][kb-388890] (vDefend 5.0), verbatim: *"In some customer environment,
the default pod CIDR might cause conflict. An option is given to override the
pod CIDR range."* Before deploying SSP, SSH to the SSP Installer appliance as
root and add `"secop_capi_pod_cidr": "<desired CIDR>"` (example
`10.27.0.0/16`) to `/config/clusterctl/settings.json`. *"Changing the CIDR range
after deployment will not affect existing cluster."*

The KB doesn't name the default pod CIDR. It doesn't mention a service CIDR
either. It is written for vDefend 5.0. **License Hub 5.1.2** deploys through
the same SSP Installer, so the override probably applies there too. That is
not verified. See [`18-vdefend-ssp.md`](18-vdefend-ssp.md).

### 2.4 Cloud Proxy Docker subnet (row 5)

[KB 392302][kb-392302]: *"The 172.17.0.0/16 subnet is used for the default
bridge network"*, and for user-defined bridge networks *"Docker assigns a
different subnet by incrementing the second byte (e.g., 172.18.0.0/16)"*.
*"If a Docker network overlaps with the external environment network,
connectivity problems may occur, as network packets won't be routed outside
the Cloud Proxy but will instead be routed internally."* The only fix
afterwards is to delete and recreate the Docker networks. So set the *Docker
Subnet* field (`/27` or larger) at deploy time, in a block you know is free. See
[`27-vcf-operations-ha-cloud-proxy-vvf.md`](27-vcf-operations-ha-cloud-proxy-vvf.md#field-notes).

### 2.5 Supervisor and VKS (rows 6–8)

- **Supervisor Service CIDR:** unique **per Supervisor**, and it must not
  overlap the VPC blocks, other Supervisors or any fleet network
  ([`10-supervisor-enablement.md`](10-supervisor-enablement.md) §2). The 9.1
  API carries it as `default_service_cidr`. Broadcom doesn't publish a
  default value, so take the one the wizard offers only after checking it
  against your plan.
- **VKS guest clusters:** the v1beta1 / v1beta2 `Cluster` has no default. The
  [VKS 3.5.0 ClusterClass example][td-vks-350] says *"specify the cluster
  network; required, there is no default"* and marks both ranges *"CAUTION: must
  not overlap with Supervisor"*.
- **Watch the example values.** Broadcom's guest-cluster service example,
  `10.96.0.0/12`, covers `10.96.0.0`–`10.111.255.255`. That **includes** a
  Supervisor Service CIDR of `10.96.0.0/23`. If you copy both examples, the
  ranges overlap. This repo's examples avoid that (`10.97.0.0/16` for guest
  services in [`20-supervisor-image-registry.md`](20-supervisor-image-registry.md)),
  but `10.97.0.0/16` also sits inside `10.96.0.0/12`. Pick one scheme and
  check each guest cluster's ranges against the Supervisor's.
- **Proxy no-proxy list:** every one of these ranges goes into the Supervisor
  and VKS no-proxy list (`20-supervisor-image-registry.md`).

### 2.6 NSX transit ranges (rows 9–13)

From the NSX 9.1.1 Policy API, Tier-0 schema ([Tier0][api-tier0]):

- `transit_subnets`: *"When not specified, subnet 100.64.0.0/16 is configured
  by default."* Used for the Tier-0 ↔ Tier-1 links.
- `internal_transit_subnets`: *"Only IPv4 addresses are supported. When not
  specified, subnet 169.254.0.0/24 is assigned by default in ACTIVE_ACTIVE HA
  mode or 169.254.0.0/28 in ACTIVE_STANDBY mode."*
- `vrf_transit_subnets`: default `169.254.2.0/23` (default T0 ↔ child VRFs).
- `tgw_transit_subnets`: default `169.254.4.0/22` (default T0/VRF ↔ Transit
  Gateway).

The `169.254.x` ranges are link-local and never conflict with routed networks.
**`100.64.0.0/16` is the one that bites.** It sits inside the CGNAT range
`100.64.0.0/10`, which some carriers, SD-WAN and VPN products route. If you
route anything in `100.64.0.0/16`, set a different `transit_subnets` on the
Tier-0. [KB 428847][kb-428847] shows the Policy API GET/PATCH to do it.

**Don't move it onto `100.96.0.0/30`.** That KB: *"The IP range 100.96.0.0/30 is
a reserved internal range used by NSX for DHCP services on segments."* A
Tier-0 `transit_subnets` that overlaps it fails with error 500105.

---

## 3. Planning checklist

- [ ] Every row in §1 that applies to your scope has a block, written into the
      Step 1 plan next to the routed subnets.
- [ ] Each block has been checked against the **whole** routed estate, not
      only the VCF subnets: user, branch, VPN, partner and cloud ranges.
- [ ] Services runtime + VCF Automation: one shared block from the fixed list
      (`198.18.0.0/15` unless it clashes).
- [ ] License Hub 2.0: `10.10.0.0/16` checked against your RFC 1918 plan.
- [ ] Cloud Proxy: an explicit Docker subnet, for every Cloud Proxy.
- [ ] Supervisor Service CIDR unique per Supervisor. Guest-cluster ranges
      don't overlap it.
- [ ] NSX: nothing routed in `100.64.0.0/16`, or a different Tier-0
      `transit_subnets` is planned.
- [ ] Everything that can't be changed later (rows 1–8) is decided **before**
      deployment.

[td-vcfms-upgrade]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/upgrading-cloud-foundation/deploy-vcf-management-services.html
[td-first-instance]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses/first-vcf-instance-fqdns-and-ip-addresses.html
[td-lichub-req]: https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/vdefend/license-hub/2-0/license-hub-appliance/license-hub-appliance-system-requirements.html
[kb-388890]: https://knowledge.broadcom.com/external/article/388890/overriding-default-ssp-pod-cidr.html
[kb-392302]: https://knowledge.broadcom.com/external/article/392302/connectivity-issues-between-cloud-proxy.html
[td-vks-350]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vsphere-supervisor-services-and-standalone-components/latest/managing-vsphere-kuberenetes-service-clusters-and-workloads/provisioning-tkg-service-clusters/using-the-cluster-v1beta1-api/using-the-versioned-clusterclass/using-builtin-generic-v350-cluster-class-with-vks-350-and-later.html
[api-tier0]: https://developer.broadcom.com/xapis/nsx-t-data-center-rest-api/latest/schemas_Tier0.html
[kb-428847]: https://knowledge.broadcom.com/external/article/428847/modifying-tier0-gateway-fails-with-error.html
