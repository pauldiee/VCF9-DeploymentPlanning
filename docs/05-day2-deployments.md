# Day-2 / Day-N Fleet Deployments

Not every fleet component has to go in at bring-up. In VCF 9 the management
domain comes up first, and a set of fleet components can be deployed **later**
as Day-2 (Day-N) operations, driven by VCF Operations fleet lifecycle. VCF
Automation in particular is commonly **skipped at bring-up and deployed Day-N**.

This page captures the planning decisions for those Day-2 deployments so the
networking, DNS, and IP prep is ready *before* the deployment runs — the same
"lock it first" idea as the Step 1 network plan. It maps to the workbook's
*Deploy Fleet Management Day-N* sheet.

> Placeholders below use the repo's Rainpole-style values (`sfo.example.io`,
> `10.11.x.x`). Replace consistently. This is a planning checklist, not a
> step-by-step deployment guide — follow the Broadcom deployment guidance for
> the actual procedure.

---

## A. Decision gate — what goes in Day-2 vs. at bring-up?

| # | Question                                                            | Notes                                                                 |
| - | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
|D1 | Which fleet components are deployed at bring-up vs. Day-2?           | VCF Automation, VCF Operations for Logs/Networks are often Day-2       |
|D2 | Is VCF Operations deployed at bring-up, or Day-2?                    | If reused/existing, "useExistingDeployment" — no new appliances        |
|D3 | Deployment **method** for VCF Automation?                           | Via **SDDC Manager API**, or via **VCF Operations** — see D            |
|D4 | Network placement: **Shared Management Network** or a dedicated one? | Dedicated network can be an **NSX VPC** — see C                        |
|D5 | Every Day-2 appliance has forward + reverse DNS and a reserved IP?  | Fleet Day-2 workflows run a synthetic check that must pass             |

Size the footprint of whatever you choose here on the
[sizing tool](https://pauldiee.github.io/VCF9-DeploymentPlanning/tools/mgmt-sizing/)
(`04-sizing.md`) — the Day-2 components are the same optional components the
sizer models.

---

## B. The deployable set

Each of these can be added Day-N from the *Deploy Fleet Management Day-N* sheet.
Capture an FQDN + reserved IP for every appliance (nodes listed), plus the
network placement from section C.

| Component                     | Appliances / nodes                                             | Notes                                                        |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| **VCF Operations**            | Primary, Replica, Data nodes + Load Balancer (VIP)             | Skip if reusing an existing instance (`useExistingDeployment`)|
| **Cloud Proxy** (Ops collector)| One or more collector appliances                              | Lives on the `localRegion` network (see C)                    |
| **License Server**            | One appliance                                                  | Tied to VCF Operations                                        |
| **VCF Automation**            | VCF Automation appliance(s) + **VCF services runtime** nodes   | Two deployment methods — see D. Needs a node **cluster CIDR** |
| **Identity Broker**           | One appliance                                                  | Plus identity provider (AD/LDAP), user/group provisioning     |
| **VCF Operations for Logs**   | Log Management nodes + cluster VIP                             | Node size + replica count (size it in `04-sizing.md`)         |
| **VCF Operations for Networks**| Platform node + Collector node                                | Optional dual-stack (IPv4 / IPv6)                             |

---

## C. Network placement — Shared Management vs. NSX VPC

This is the decision behind the "VCF Automation on a VPC network" question. Each
Day-2 deployment lands on **one of**:

- **Shared Management Network** — the existing VLAN-backed VM-Mgmt subnet. VCF
  Automation's nodes come from the `/29` reserved on VM-Mgmt (intake `B5`). No
  new network to build; simplest path.
- **A dedicated network** — a separate routed network the fleet components use
  instead of the shared subnet. The Day-N sheet models two:
  - **`localRegion`** — VCF Operations **collectors** (Cloud Proxy).
  - **`xRegion`** — VCF **Operations + Automation** (cross-region mobility, e.g.
    for failover). This is the network that is commonly an **NSX VPC**.

An **NSX VPC** is a self-service private network within an NSX Project, reached
through the Transit Gateway. Choosing a VPC-backed dedicated network ties to the
existing VPC Gateway decision (intake `A10`, Distributed vs Centralized) and the
VPC Gateway external network (`B20`).

Per dedicated network, capture:

| Field            | Example                          | Notes                                     |
| ---------------- | -------------------------------- | ----------------------------------------- |
| networkName      | `xregion-vcfa-net`               | Segment / VPC subnet name                 |
| subnet / CIDR    | `10.11.40.0/24`                  | Private CIDR for the VPC subnet           |
| gateway (CIDR)   | `10.11.40.1/24`                  | Subnet gateway                            |
| IP pools         | `10.11.40.11 – .20`              | The Day-N sheet asks up to 5 pools        |
| cluster CIDR     | `100.64.0.0/24` (non-overlapping)| VCF services-runtime node cluster CIDR    |
| Transit / routing| via VPC Gateway (`A10`)          | How the VPC reaches mgmt + north-south     |
| DNS (A + PTR)    | `sfo-vcfa01.sfo.example.io`      | Forward + reverse for every appliance     |

> Keep the **cluster CIDR** (the VCF services-runtime internal node network)
> distinct from every routed subnet in the Step 1 plan — an overlap here is a
> common Day-2 failure.

---

## D. VCF Automation — deployment method

VCF Automation can be deployed two ways; capture which one, as they ask for
different inputs:

| Method                          | Where it's driven          | Key inputs                                                   |
| ------------------------------- | -------------------------- | ------------------------------------------------------------ |
| **Using SDDC Manager API**      | SDDC Manager               | Deployment type, `localRegion` + `xRegion` networks, IP pools, cluster CIDR |
| **Using VCF Operations**        | VCF Operations             | Installation type, VCF instance, VCF services-runtime nodes CIDR, FQDNs |

Both need: VCF Automation FQDN, VCF services runtime FQDN, node prefix, the node
IP pools, and the admin password. Decide the method and the network placement
(section C) together.

---

## E. DNS / IP checklist (additive to Step 1)

On top of `01-network-dns-plan.md`, for every Day-2 appliance you deploy:

- [ ] Forward (A) + reverse (PTR) DNS for each node / VIP FQDN
- [ ] Reserved IP outside any DHCP scope
- [ ] If VPC-backed: the dedicated network exists and is routable (Transit Gateway)
- [ ] VCF services-runtime **cluster CIDR** does not overlap any Step 1 subnet
- [ ] Passwords captured with the other fleet credentials (intake section F)
- [ ] The synthetic check prerequisites (DNS/NTP/reachability) are in place

---

## F. Ownership matrix

| Area                                             | Owner               | Sign-off |
| ------------------------------------------------ | ------------------- | -------- |
| Which components Day-2 vs bring-up (A)            | Architect           |          |
| Network placement: Shared vs NSX VPC (C)         | Network + Architect |          |
| Dedicated / VPC network CIDR, gateway, pools (C) | Network             |          |
| VCF Automation method (D)                        | Platform + Architect|          |
| Day-2 FQDNs + PTR records (E)                    | AD/DNS/NTP          |          |
| Appliance passwords (E)                          | Platform / Security |          |

---

## Sign-off

Once A–F are filled and signed, feed the results back into the single-AZ
artifacts and the workbook:

- Day-2 FQDNs + IPs → the DNS section of `01-network-dns-plan.md`
- Dedicated / VPC network → the VLAN/subnet table in `01-network-dns-plan.md`
- Decisions + method → intake `A17` / `E15` / `B21` in `02-customer-intake.md`
- All values → the *Deploy Fleet Management Day-N* sheet (see
  `workbook-cell-mapping.md`)
