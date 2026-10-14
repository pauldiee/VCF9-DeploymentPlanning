# VCF Operations & Log Management Sizing

> **Interactive tool:** [VCF Operations & Log Management Sizer](https://vcf-planning.hollebollevsan.nl/tools/ops-logs-sizing/)
> applies the rules on this page to your numbers and recommends a size and count for each
> component.

The [Management Domain sizer](04-sizing.md) starts from a size you have already chosen and adds
up its footprint. This page covers the step before that: **which size, and how many nodes or
replicas**, for the environment you will monitor. Take the result back into the Management
Domain sizer to check that it fits your cluster.

Everything here is Broadcom's published limits, read on **2026-10-14** from the sources in
[Sources](#sources). None of it is lab-measured. For an existing VCF Operations or Aria
Operations install, the
[VCF Operations Sizing Estimator](https://vcfopssizer.broadcom.com/) with your real object and
metric counts is still the authority.

---

## VCF Operations

### Node sizes

From Configuration Maximums (VCF Operations 9.1.0). The figures are identical to
[KB 397782](https://knowledge.broadcom.com/external/article/397782/vcf-operations-90-sizing-guidelines.html)
(9.0), which also carries the scaling rules below.

| Size | vCPU | RAM (GB) | Objects, single node | Metrics, single node | Objects per node in a cluster | Metrics per node in a cluster | Max nodes | CA nodes per fault domain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Extra Small | 2 | 8 | 700 | 140,000 | – | – | 1 | – |
| Small | 4 | 16 | 10,000 | 1,600,000 | 6,000 | 1,400,000 | 2 | 1 |
| Medium | 8 | 32 | 30,000 | 5,000,000 | 17,000 | 4,000,000 | 8 | 4 |
| Large | 16 | 48 | 44,000 | 8,000,000 | 36,000 | 6,000,000 | 16 | 8 |
| Extra Large | 24 | 128 | 100,000 | 20,000,000 | 88,000 | 15,000,000 | 12 | 6 |

### How the size is picked

1. **Count objects.** An object is anything VCF Operations collects properties and metrics
   for: every VM, host, datastore and vCenter, plus NSX, vSAN and management-pack objects.
   If you already run VCF Operations, use its real count instead.
2. **Add growth.** Neither VCF Operations nor Log Management can be scaled back down, so
   size for where you'll be, not where you are.
3. **Apply the model.**
   - **Simple** is one node, held to the *single node* limits.
   - **High Availability** replicates every object to a second node, so KB 397782 says the
     limit is *"two times less compared to a non HA configuration"*. Nodes needed =
     ⌈2 × objects ÷ objects per node in a cluster⌉, at least 2.
   - **Continuous Availability** replicates to a node pair across two fault domains, so
     capacity is also halved. The node count must be even, each fault domain is capped by
     the last column above, and a **witness** node (2 vCPU / 8 GB) is added in a third site.
4. **Check metrics** the same way if you know the metric count. They can set the node count
   before objects do.
5. **Pick the fewest nodes.** KB 397782: *"Use the configuration which has the least number
   of nodes, but is able to accommodate the number of objects to be monitored."* Its
   example: 352,000 objects (no HA) is **4 × Extra Large** rather than 10 × Large, which
   saves almost half the CPU. All nodes in a cluster must be the same size.

Raising node memory to its maximum (Extra Small 16, Small 32, Medium 64, Large 96, Extra Large
256 GB) raises the limits by about 20% for a single node and 10% for a cluster. The tool doesn't
count on that, so treat it as headroom.

### Cloud Proxies

Unified Cloud Proxy limits, from KB 397782 and the 9.1 *Add a Cloud Proxy* page:

| Unified Cloud Proxy | vCPU | RAM (GB) | Max objects | Max vCenter adapters |
| --- | --- | --- | --- | --- |
| Small | 4 | 16 | 16,000 | 25 |
| Standard | 8 | 48 | 80,000 | 100 |

Plan at least one proxy per location (site or network zone) that is collected locally. Add
more when objects or vCenters go over one proxy's limit. Use Small while the per-location count
already covers the load, otherwise Standard. A node's own collector handles only 5 / 25 / 50 /
100 / 120 vCenter adapters (Extra Small to Extra Large), which is another reason to collect
through proxies.

---

## Log Management

### Per-replica limits

From the VCF 9.1 *Log Management Detailed Design* (Last Updated 2026-10-12). Log Management
runs as replicas on the VCF services runtime. Capacity scales with the **number of replicas**
and with their **size**.

| Size (max hosts) | Replica vCPU / RAM | Events/sec per replica | Hard cap per replica | GB/day per replica | Replicas | Per VIP: EPS | Per VIP: connections, as printed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Small (1,500) | 8 / 16 GB | 20,000 | 40,000 | 600 | 1–19 | 200,000 | 20k / 50k |
| Medium (3,000) | 16 / 32 GB | 40,000 | 70,000 | 1,200 | 3–19 | 200,000 | 20k / 50k |
| Large (4,560) | 32 / 64 GB | 60,000 | 120,000 | 1,800 | 3–19 | 300,000 | 30k / 50k |

The GB/day column is from Configuration Maximums. Which connection figure applies to which
protocol is disputed; see [Where the sources disagree](#where-the-sources-disagree). The events-per-second figure is for a
*"typical load profile"*: a lighter profile (fewer queries, smaller messages) can reach the
hard cap, but don't plan on it.

### How the size is picked

1. **Estimate events per second.** The design page: *"The number of EPS can be approximated
   by the number of ESX hosts in the fleet multiplied by 250."* Add your heavy senders on
   top. The page names firewall-rule logging as one that *"can generate a significant volume
   of EPS"*.
2. **Replicas for load** = ⌈EPS ÷ events per replica⌉.
3. **Replicas for retention.** Each replica's disk ranges from 500 GB to 9 TB, so the
   retained data needs at least ⌈retained GB ÷ 9 TB⌉ replicas.
4. **Add spares.** *"plan for an extra replica or two (N+1 or N+2)"*. Then apply the size's
   minimum (3 for Medium and Large).
5. **Choose the size.** Broadcom advises *"scaling up the size to medium once you exceed 5-6
   small replicas, or large once you get to 6-8 medium replicas"*. Many small replicas make a
   later size change a big jump, because it applies to every replica (12 Small become 12
   Medium). The tool uses the upper end of each range: Small up to 6 replicas, Medium up to
   8, otherwise Large.
6. **Size the VIPs.** Each VIP has its own load balancer with the per-VIP limits above. Add
   VIPs, and point senders at different FQDNs, when events or connections go over one VIP.
   Broadcom recommends against putting an external load balancer in front.

### Storage: the assumptions

Broadcom says only that *"Storage capacity is a factor of the retention period and the number
of log messages received"*. It publishes no bytes-per-event figure and no compression ratio,
so the tool turns events into storage with two values you can change:

- **Bytes per event: 350.** This is what Configuration Maximums implies: 600 GB/day per Small
  replica ÷ 20,000 events/sec ≈ 350 bytes.
- **Stored GB per ingested GB: 1.** Logs are stored as received, with no compression. This is
  deliberately conservative.

If you can measure both on a current log platform, use your own numbers.

### Footprint on the VCF services runtime

Log Management deploys no appliances of its own. The services runtime adds worker nodes for it
(design page):

| Size | Worker node | Workers per replica | IPs per replica |
| --- | --- | --- | --- |
| Small | 12 vCPU / 24 GB | 1 | 1 |
| Medium | 24 vCPU / 48 GB | 1 | 1 |
| Large | 24 vCPU / 48 GB | 2 | 2 |

Allow **6 IPs** for the initial installation plus the per-replica IPs, plus one for each VIP you
add. All replicas run on the same cluster and datastore as the services runtime, so that
datastore has to hold every replica's disk.

### Where the sources disagree

The sources disagree in two places. All three TechDocs pages involved show *Last Updated 12 Oct
2026*:

- **Medium is 24 vCPU / 48 GB on the *Deploy Log Management* page**, but 16 / 32 on the design
  page and in Configuration Maximums. The design page explains the gap: 24 / 48 is the size of
  the services-runtime **worker node** that a Medium replica runs on, and 16 / 32 is the
  replica. Both are correct; they measure different things.
- **Connections per VIP are printed in opposite orders.** The design page heads the column
  *"Connection Limit (http / tcp [syslog])"* and gives Small 20k / 50k, which reads as HTTP 20k
  and syslog 50k. Configuration Maximums labels the same pair *"Syslog Connections (Active TCP
  Connections) / Http Connections"*, which reads as syslog 20k and HTTP 50k. Large is 30k / 50k
  in both. Until one is corrected, the tool takes the **lower** figure (20k, or 30k for Large)
  for both protocols. That may ask for one VIP more than you need, but never one less.
- **The Large minimum is 3 replicas** on the design and deploy pages. The P&P workbook (and so
  the [Management Domain sizer](04-sizing.md)) uses a minimum of 6. This page and its tool
  follow TechDocs.

---

## Real-Time Metrics

From Configuration Maximums (VCF Operations 9.1.0). Pick the smallest size that covers both
your ESX host count and your vCenter count:

| Size | vCPU | RAM (GB) | Storage | Max ESX hosts | Max vCenters |
| --- | --- | --- | --- | --- | --- |
| Small | 18 | 22 | 500 GB | 500 | 2 |
| Medium | 37 | 47.5 | 2 TB | 1,500 | 10 |
| Large | 120 | 164.5 | 4.5 TB | 5,000 | 24 |

The host limit counts all connected vCenters together. Real-Time Metrics also runs on the
services runtime, with no appliances of its own. The deploy wizard has been seen to show
**32 vCPU / 43 GB** for a Medium instance: that's the services-runtime scale-up for it, which
is not the same quantity as the table (see [`04-sizing.md`](04-sizing.md), #200).

---

## What this does not model

- **VCF Operations for Networks**, **Telegraf agents**, **Service Discovery** and **VDI
  (Horizon)** objects have their own limits in KB 397782. They're not covered here.
- **Multi-instance Log Management.** If no single instance fits (more than 19 Large replicas
  or 4,560 hosts), split the logs across instances. See Broadcom's *Multi-instance Log
  Management Model*.
- **Other load factors.** The design page lists factors that lower processing capacity:
  complex or numerous filtering rules, many queries (from automation or several admins), and
  hosts without hardware-accelerated FIPS ciphers. Turning off event clustering raises it.
  Leave headroom if your environment has the first three.
- **Peak vs average.** Broadcom notes you can provision for peak load, or for average load
  and accept that some logs may be lost at peak. The tool sizes for the events-per-second
  figure you give it.

---

## Sources

- Configuration Maximums, [configmax.broadcom.com](https://configmax.broadcom.com/), product
  *VCF Operations*, release 9.1.0: VCF Operations node and Cloud Proxy sizes, Log Management
  and Real-Time Metrics categories.
- [VCF Operations 9.0 Sizing Guidelines (KB 397782)](https://knowledge.broadcom.com/external/article/397782/vcf-operations-90-sizing-guidelines.html):
  HA / CA halving, CA fault-domain limits and witness, the fewest-nodes tip, collectors.
- [Log Management Detailed Design (VCF 9.1)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-operations-design/vcf-operations-for-logs-deployment-models.html):
  per-replica and per-VIP limits, EPS estimate, spares, scale-up advice, disk range, worker
  nodes and IPs.
- [Deploy Log Management (VCF 9.1)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/manual-deployment-of-components-to-complete-your-vcf-platform/installing-vcf-logs.html):
  wizard sizes and replica ranges.
- [VCF Operations Models (VCF 9.1)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-operations.html):
  Simple, High Availability and Continuous Availability.
- [VCF Operations Sizing Estimator](https://vcfopssizer.broadcom.com/).
- For scaling an existing VCF Operations cluster up or out, see the upgrade guide's
  [VCF Operations sizing and scaling](https://github.com/pauldiee/VCFUpgradeGuide/blob/main/docs/24-vcf-operations-sizing-and-scaling.md).
