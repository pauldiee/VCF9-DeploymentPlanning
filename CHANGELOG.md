# Changelog

## v2.4.5 — 2026-07-22
- **The License Hub deploy wizard, end to end** (#207). Field-observed on SSP
  Installer `5.1.2`. New table in `prerequisites.md` covering all three Configure
  steps — *Define Instance and Required FQDN(s)*, *Select vCenter Parameters*,
  *Configure Connectivity Options* — plus the `Configure → Pre-Checks → Deploy`
  flow. Nothing described the inputs beyond the installer OVA before.
- **Three FQDNs, not one — Step 1 budgeted a third of what is needed** (#207).
  The instance adds an **Instance FQDN** (required — *"Instance FQDN is
  required"*) and a **Messaging FQDN** on top of the installer's own.
  `01-network-dns-plan.md` now says **~9 IPs + 3 FQDNs**, and `ip-dns-plan.csv`
  gains four rows (both instance FQDNs and both IP pools).
- **The two instance FQDNs are pinned to the service IP pool** (#207). TechDocs:
  the Instance FQDN *"must map to the first IP address in the service IP pool"*
  and the Messaging FQDN *"to the second"*. They are not free-standing records —
  **the pool range has to be settled before the DNS records can be requested**,
  which reverses the usual "ask for the names early" order. The service pool's
  first two addresses are therefore already spoken for.
- **An unusual number of one-way doors** (#207). **Instance Name**, **Instance
  FQDN**, **storage policy** and both **IP pools** are all immutable after
  deployment; a rename or re-IP means a redeploy. Called out together in
  `prerequisites.md` rather than left scattered across field descriptions.
- **Encrypted storage policies are not supported** (#207). TechDocs: *"VM
  encrypted storage policy is not supported"* and *"You cannot use third-party
  encryption solutions."* Combined with the policy being immutable, a site whose
  management cluster defaults to encryption has a deploy-time decision to make.
- **TechDocs and the product disagree on the instance password minimum** (#207).
  The documentation says *"Minimum length: 12"*; the shipping `5.1.2` dialog
  says *"At least 15 characters in length"*. A 12–14 character password planned
  from the docs is **rejected at the wizard** — the docs here follow the
  product.
- **A password that passes the OVA can still be rejected by the instance**
  (#207). Two layers, two rules: the **OVA** enforces **min 12** with no
  dictionary words / palindromes / monotonic runs, the **instance wizard**
  enforces **15–128** with none of those extras. `02-intake.md`'s password table
  now carries both rows instead of one. The same split applies to **DNS
  servers** — **3** at the OVA, **5** at the instance.
- **The IP pools are contiguous ranges, not a count** (#207). Both are entered
  as start–end inside one subnet, so an unbroken block has to be free — the
  earlier "~9 IPs" phrasing let you plan scattered spares that will not work.
- **Three deploy-time constraints worth knowing before the wizard** (#207): it
  requires a **distributed** port group (no standard switch), a **content
  library datastore**, and it **reserves resources by default** — TechDocs calls
  the reservation *"required for a production environment"*, so check the
  footprint against management-cluster admission-control headroom rather than
  planning to switch it off.
- **The 9 pre-checks, as a pre-flight checklist** (#207). Field-observed, all
  re-runnable via **RERUN PRE-CHECK** so a failure is fixed in place. They
  validate **cluster CPU and memory**, the content-library datastore, the
  storage policy, network configuration, **FQDN/domain**, NTP and **node-pool IP
  reachability** — a useful statement of what has to be true before the deploy
  starts. The domain pre-check is also why DNS is easier created **before** the
  deploy, even though TechDocs allows either order.
- **What the deploy run looks like** (#207): 4 steps, ~28 tasks — vCenter
  Configuration (6, starting with **creating a content library**), **Workload
  Cluster (18)**, Security Platform (3), Metrics (1). TechDocs states no
  expected duration.
- **License Hub needs an NSX DFW *exclusion*, not a port** (#207). TechDocs:
  *"If the License Hub VMs are running in an NSX overlay network, NSX VLAN
  segments, and security-enabled port groups, add the License Hub VMs to a
  firewall exclusion list."* No reason given. Added to `07-firewall-ports.md` —
  the one entry there that is a **policy carve-out** rather than a flow, and it
  belongs to the **vDefend DFW** owner, not the perimeter firewall team. The
  appliance that licenses vDefend being filtered by vDefend is a poor thing to
  discover after the fact.
- **Failure recovery is three different buttons** (#207). **Stop Deployment**
  *"does not undo any previous deployments"*; **Update & Redeploy** *"starts
  from the point it was stopped"* (resume, not restart); **Cleanup** *"removes
  all the previous deployment tasks"*. Normal path is Stop → fix → Update &
  Redeploy. Corrects the previous entry, which described Cleanup loosely as the
  unwind for any failed run.
- **A vCenter outage mid-deploy is the expensive failure** (#207). TechDocs:
  resources already exist, so reset may be unavailable — *"clean up the
  deployment before resetting the configurations"*, and *"If the VMware vCenter
  server is not recoverable, uninstall SSP Installer and deploy a new one."*
  Don't run this deploy in a window where vCenter may be patched or restarted.
- **Post-deploy steps, including a backup** (#207): wait for **Healthy**
  (Troubleshooting Diagnostic if not), **Done**, then in via the **Instance FQDN
  & IP** link with the Configure-step credentials — and **back up the SSP
  Installer**, which TechDocs raises as a step at this point.
- **The 4.5 GB package can be pulled by URL** (#207). *Upload a License Hub
  Package* accepts a **locally hosted URL** as well as a browser upload — the
  better path over a slow link or where the file already sits on an internal
  host. Recorded in `prerequisites.md` along with Package Management's
  in-use / not-in-use tracking.

## v2.4.4 — 2026-07-22
- **What the SSP Installer OVA actually asks for** (#206). Nothing described the
  deploy inputs. New table in `prerequisites.md`: GRUB root password + menu
  timeout, **three required appliance passwords** (`sysadmin` / `admin` /
  `audit`), **FQDN**, IPv4 address, netmask, gateway, **DNS server list**, domain
  search list, NTP server list and **Enable SSH** (**off** by default), on a
  single vNIC with **Static – Manual** IPv4.
- **The SSP Installer needs a real FQDN — Step 1 never budgeted one** (#206).
  Unlike VCF Operations for Networks, its OVA **requires** an FQDN (*"must
  contain a dot character"*). `01-network-dns-plan.md`'s License Hub row now says
  **~9 IPs + 1 FQDN**, and `ip-dns-plan.csv` gains an **SSP Installer** row — the
  template previously had no SSP or License Hub row at all.
- **Only three DNS servers are used, and the rest are dropped silently** (#206):
  *"At most three name servers can be configured (first 3 name servers passed in
  list will be used and all other will be ignored)"*. A site handing out four or
  more resolvers should choose which three rather than letting list order decide.
- **NTP is not marked required — the docs say treat it as required** (#206).
  It is a licensing and security appliance; clock skew breaks certificate
  validation and token exchange.
- **SSP passwords are stricter than the rest of the platform, and validated at
  boot** (#206). Min **12**, ≥5 distinct characters, **no dictionary words, no
  palindromes, no monotonic run >4** — well beyond the min-8 other components
  accept. And *"password strength validation will occur during **VM boot**"*, so
  a non-compliant password **deploys successfully** and forces a change at first
  login instead of failing in the wizard. Added to the `02-intake.md` password
  table and called out in `prerequisites.md`.
- **Storage clarified** (#206): **396 GB thick but only ~7 GB thin** (5.0 GB
  download) — the footprint table's 400 GB is the thick figure.

## v2.4.3 — 2026-07-22
- **SSP / License Hub software is a manual download — and it is two files**
  (#205). `prerequisites.md` covered License Hub's IPs, footprint, scale and
  connected-vs-disconnected but never said **where the software comes from**.
  Verified on the **Broadcom Support Portal** (*vDefend Security Services
  Platform*): you need **both** the **SSP Installer `.ova`** (~5.0 GB) and the
  **License Hub `.tar`** (~4.5 GB) — the OVA is deployed, then the TAR is
  *uploaded to it*, matching the TechDocs step *"Upload a License Hub
  installation package to SSP Installer."* Take them from the **same release
  page** as a matched pair (build numbers differ within a release) and keep the
  portal's SHA2/MD5.
- **Neither comes through the depot** (#205). Stated in both places it could be
  assumed otherwise: the License Hub section, and a callout at the top of
  `09-binary-depot.md` — the Fleet Depot Service and the offline depot are
  **VCF-component scoped**.
- **Air-gapped sites carry three things, not one** (#205). The `.ova`, the
  `.tar` (**~9.5 GB** together) **and** the six-monthly license file. The doc
  previously implied only the licence file was a manual burden.
- **Connected mode reports outbound too** (#205, relates to #178). Added the
  verbatim *"License usage report is consolidated and provided to the Avi Cloud
  Console **every 24 hours**"* alongside the 15-minute inbound poll, since a
  proxy allowlist has to accommodate both directions.

## v2.4.2 — 2026-07-22
- **Real-Time Metrics collects nothing until a policy enables it** (#203).
  `05-day2-deployments.md` B.0 documented the deployment *cost* but not the
  enablement step — and *ESX Top* ships **`Deactivated` (Inherited)**, so a fleet
  can pay the VCFMS scale-up and the maintenance window and still collect
  nothing. New "after deployment" block: **Configurations → Policy Definition →
  Real time metrics → EDIT POLICY**, the **two** object types the editor actually
  exposes (**Host System** with category *ESX Top*, and **vCenter** — **no VMs,
  datastores or clusters**, contrary to secondary summaries of the release
  notes), group-based scoping so 2-second collection is not switched on
  fleet-wide, and the granularity quote (20 s default, 2 s floor for ESX).
- **Correction: Ops for Networks *does* participate in certificate management,
  and its FQDN is mandatory** (#204, correcting #197). B.2 said participation was
  "not established" and framed the FQDN as optional-but-recommended. The
  *Generate CSR* dialog runs for the appliance (`Common Name:
  OPS_NETWORKS-PLATFORM…`) and **`DNS/FQDN SAN` is a required field**. So the
  records are not needed **to deploy**, but are **required at certificate
  replacement** — a site that reads "IP-only" and skips DNS hits a hard stop at
  the certificate pass. A **Large** 3-node platform needs *"FQDNs and IPs of all
  nodes"*. Corrected in `05-day2-deployments.md`, `01-network-dns-plan.md` and
  both `ip-dns-plan.csv` rows.
- **CSR dialog ships with Broadcom's placeholder subject** (#204) —
  Organization `Broadcom`, OU `vcfms`, `Palo Alto` / `CA` / United States, and
  **Key Size 2048**. Noted in `prerequisites.md` next to the bulk-CSR guidance
  from #194: replace them before generating, and check 2048 meets the site's
  crypto policy — otherwise every issued certificate carries it.
- **Greyed-out *Activate Network & Flow Collection* is a stale browser session**
  (#202). After a successful Ops for Networks deploy the checkbox can still read
  *"VCF Operations for networks Appliance is required"*; a **browser restart**
  enabled it with no fleet-side action. Documented with the order of checks,
  because the message invites the wrong conclusion (failed deploy) and the
  obvious "fix" is a second appliance to clean up.

## v2.4.1 — 2026-07-22
- **The sizer's Real-Time Metrics figures were invented** (#200). Checked against
  the pinned workbook: its *Real-time Metrics* row multiplies by a node-count
  cell (`J29`) that **does not exist in the sheet**, so the formula evaluates to
  **0 vCPU / 0 RAM** at every size. The tool had papered over that by inventing a
  node count (2, or 3 on Large) and multiplying it by the VCFMS worker figures —
  producing **48 vCPU / 96 GB** on Medium, a number from no source at all.
- **Replaced with the product's own scale-up delta** (#200). RTM deploys **no
  appliances of its own** — it grows the VCFMS runtime — so the row now shows a
  **node count of 0** and reports the scale-up cost. **Medium (32 vCPU / 43 GB)
  is observed** from the wizard; **Small and Large are derived** from the VCFMS
  worker ratio and are labelled as derived in `docs/04-sizing.md` rather than
  presented as fact.
- **Disk conflict documented rather than silently resolved** (#200): the workbook
  hard-codes **205 GB**, the wizard reports **15 GB** for the same Medium
  instance. The tool reports 205 — the only RTM figure that traces to the
  source — and `04-sizing.md` states the disagreement so a reader comparing the
  tool against the wizard does not assume one is broken.
- **`CLAUDE.md` corrected: `ImportExcel` is not installed** — it is absent from
  both pwsh 7.x and Windows PowerShell 5.1, despite the guidance saying
  otherwise. Replaced with the module-free recipe (treat the `.xlsx` as a zip and
  parse the XML parts), plus a warning learned here: **read the `<f>` formula,
  not just the cached `<v>` value** — a cached `0` may only mean the sheet ships
  with that option set to *Exclude*, and a formula may reference a missing cell.

## v2.4.0 — 2026-07-22
- **Real-Time Metrics is a maintenance-window change, not an add-on** (#199).
  New `05-day2-deployments.md` **B.0**. RTM is not a standalone appliance — it
  lands as extra worker capacity **inside the VCF services runtime**, so
  installing it forces that runtime to **scale up**, and the wizard gates INSTALL
  behind *"Scale-up affects all of the VCF management services components for
  those VCF Instances and the operation must be performed during a maintenance
  window"* plus an *"I am aware of possible service disruption"* checkbox. Also
  captured: the **Real-time metrics size** shown in the review dialog (Medium →
  32 vCPU / 43 GB / 15 GB / **6 IPs**) is the size RTM will be *deployed at*, not
  evidence the runtime has room; a pre-flight checklist; and that RTM installs on
  **all eligible instances** but must be installed **manually** on any instance
  added later. **None of this is in TechDocs** — the *Deploy Real-Time Metrics*
  page covers version support, System Managed Credential and port 443, and is
  silent on scale-up, resources, IPs, windows and disruption.
- **The `/29`-vs-5-IPs version split was cited from an *upgrade* page and applied
  to fresh deploys** (#201). `01-network-dns-plan.md` welded the split and the
  *Add VCF Automation* wizard into one sentence; nothing establishes that the
  split describes a fresh deployment at all. The callout is rewritten to
  **attribute it to the upgrade path explicitly**, and the `/29` now rests on
  what is actually observed — the fresh-deploy wizard asks for a **CIDR**
  (field-verified on `9.1.0.0200`). The source URL is recorded for the first
  time; it had been cited three times as *"TechDocs (Upgrade to VCF Automation)"*
  with **no link**.
- **Fuller quotes from that page** (#201): *"The IP addresses can be contiguous
  or non-contiguous"*, and the **field rename** across the boundary — *VCF
  services runtime nodes **CIDR*** (takes *"a valid CIDR"*) becomes *VCF services
  runtime nodes **IP pool*** (takes *"a CIDR or 5 comma-separated individual IP
  addresses"*). Both are scoped to the upgrade path in the text, not stated as
  general fact.
- **Build numbering: four digits is the real form** (#201). Release notes, the
  Version Overview and the product all use `9.1.0.0100` / `9.1.0.0200` /
  **`9.1.0.0400`**; the upgrade page writes three (`9.1.0.400`) for the same
  train. Docs now tell readers to use the **four-digit** form when checking what
  a fleet runs. Also stated: patch trains are **per component** — on 2026-07-22
  SDDC Manager, VCF Operations, Orchestrator and Log Management are at
  `9.1.0.0400` while **VCF Automation is still `9.1.0.0200`**, so the relaxed
  option is unreachable for Automation on any path.

## v2.3.9 — 2026-07-22
- **The sizer left the bring-up Cloud Proxy out by default** (#198). It was an
  opt-in checkbox defaulting to **off**, while the **License Server — deployed by
  the same bring-up** — was counted automatically. So a default first-instance
  greenfield sizing silently omitted an appliance that will certainly exist, the
  same class of under-count as #176/#177. `vcfOpsCollector` now defaults to
  **on**, with a comment and a hint on the control noting that the Installer
  deploys a unified cloud proxy automatically and that Day-N *additional*
  collectors come on top of it. Existing saved sizings keep whatever they stored.
  It stays a **checkbox on purpose** — an upgrade or existing-fleet sizing may
  already account for the proxy, so the control has to remain untickable rather
  than becoming an automatic row like the License Server.
- **VCF Operations for Networks deploys IP-only — there is no FQDN field**
  (#197). Field-observed and confirmed against TechDocs *Deploy VCF Operations
  for Networks*, whose Parameters page asks only for a password, the **platform
  node IP**, the **collector node IP** and an optional **Dual Stack** toggle —
  **DNS, FQDN and hostname are not mentioned anywhere on it**. Intake `E14`
  already said as much; the planning template and the Day-2 doc had never caught
  up. New `05-day2-deployments.md` **B.2**: records are **not required**, create
  A + PTR anyway for runbooks / firewall rules / log identification, and two
  limits stated plainly — an A record does not make the appliance use that name,
  and Ops for Networks' participation in **fleet certificate management is not
  established**, so no CA-signed cert with that name is promised.
- **Its generated password is shown once and covers three accounts** (#197).
  *"Save password to secure place. You won't be able to see it again after the
  deployment"* — and per TechDocs it is used for **`console-user`, `support` and
  `admin@local`**. Capture it **before** clicking Finish; this is the VCF
  Management side, where there is no reveal API to fall back on.
- **`ip-dns-plan.csv` gains the two missing rows** (#197) — platform node and
  collector node, marked **Day-N (if in scope)** so it is clear they are **not
  needed at bring-up**, with the IP-only / FQDN-optional caveat in the
  description. `01-network-dns-plan.md`'s IP-count row now says the same, so
  nobody plans A/PTR as mandatory.

## v2.3.8 — 2026-07-22
- **The sizer had no VCF Automation size** (#196). #193 fixed the
  deployment-plan tool but never touched the sizer, which modelled Automation as
  a bare checkbox: it inherited the **fleet** `deploymentSize` and took its node
  count from the **fleet** `deploymentModel`. That produced configurations which
  cannot exist — *Small + High Availability* gave a **3-node Small** (Small is
  1 node), *Medium + Simple* gave a **1-node Medium** (Medium is 3 nodes) — and
  it could not express the ordinary case of a Medium/Large fleet running a
  single-node Automation. VCF Automation now has its **own Small / Medium /
  Large selector**, shown when it is included, with the node count derived from
  it via the new `vcfAutomationNodes()` (**Small → 1**, **Medium/Large → 3**).
  The fleet model/size no longer feed the Automation row at all. Saved sizings
  missing the new field fall back to the default rather than erroring.
- **`docs/04-sizing.md`** states the coupling alongside the other component
  caveats, so the sizer's behaviour is explained where the figures are sourced.

## v2.3.7 — 2026-07-22
- **A `$` in the VCF Automation deploy password is silently eaten** (#195,
  follow-up to #192). Field-verified — it cost most of a day. William Lam's
  script assigns the appliance password in a **double-quoted** PowerShell string,
  and PowerShell interpolates `$…` inside double quotes, so `VMware1!$ecret` is
  sent as **`VMware1!`**. No error, no warning, and the deployment **succeeds** —
  leaving a healthy appliance built around a password nobody knows. New callout
  in `05-day2-deployments.md` section D: use single quotes, verify the literal
  value via `$OutputJsonPayload`, and — as the first diagnostic — **try the
  password truncated at the first `$`**. This is a PowerShell quoting trap, not a
  defect in Lam's script; the credit block is unchanged.
- **Why it reads as a broken appliance rather than a bad password** (#195).
  Documented because the misdiagnosis is the expensive part: the Provider UI and
  **SSH as `vmware-system-user`** fail *together* (different credentials, same
  provisioning value), VCF Operations fails to change the password with **"could
  not get a token"**, and a power-cycle changes nothing. Two independent auth
  surfaces down at once reads as a bootstrap fault.
- **Recovery is two-part if you are genuinely locked out** (#195). New
  subsection: [KB
  325916](https://knowledge.broadcom.com/external/article/325916) for the
  console/GRUB root reset (incl. the `faillock` / `pam_tally2` lockout check —
  your own retries may have locked the account), **then** [KB
  419010](https://knowledge.broadcom.com/external/article/419010/unable-to-remediate-vcf-automation-vmwar.html)
  to realign the Kubernetes secret — because `passwd vmware-system-user`
  **misaligns** it and Fleet Management then shows the password **Disconnected**.
  Doing only the first half leaves a differently-broken appliance. KB 419010 is
  scoped to **9.0.x**, so the namespace/secret naming is flagged as verify-first
  on 9.1. "Disconnected" in *Fleet Management → Passwords* also noted as a
  no-SSH diagnostic in its own right.
- **#192 closed out end-to-end.** The VPC deployment **completed**, and the
  instance **registered itself in Components with no manual sync** — the earlier
  absence was lag, not a failure, so that is now stated explicitly rather than
  leaving readers hunting. The verification-status callout no longer says
  completion is unconfirmed.

## v2.3.6 — 2026-07-22
- **The certificate pass is bulk-capable — but must be staggered** (#194).
  Field-verified 2026-07-22 on a real deployment, not a lab. **VCF Operations →
  Fleet Management → Certificates**
  lets you tick multiple components and act on them together (`Generate CSRs`,
  `Download CSRs`, `Replace With Configured CA Certificate`, `Import
  Certificates`, plus *Renew* / *Replace With Imported*), reporting progress per
  batch as an *n/total* counter. But the replace dialog carries a **mandatory
  acknowledgement**: *"Each certificate rotation can trigger automated retrust
  operations across dependent components… wait for any current or ongoing batch
  operations to be completed before starting the next."* So the planning shape is
  **fewer, larger batches with a settling wait between them** — not one sweeping
  fleet-wide action. Story **8.5** said "in one pass" in both
  `06-deployment-plan.md` and the export tool; corrected in both, with the
  acceptance criterion now requiring each batch to have settled before the next
  started.
- **Generate before replace — the replace reuses the *last* CSRs** (#194). The
  dialog states *"Last generated Certificate Signing Requests (CSRs) will be used
  for generating certificate(s)"*, so a stale CSR set is a real failure mode:
  regenerate whenever a SAN or FQDN changed. Also captured: the CA type
  (**Microsoft CA** / **OpenSSL**) is chosen **per replacement operation**, not
  only in the global Configure-CA wizard, and a bulk generate submits every CSR
  at once — an **approval-gated Microsoft CA template stalls the queue** rather
  than erroring. All added to `prerequisites.md` → Certificate Authority.
- **A failure does not stop the batch** (#194). Field-verified 2026-07-22: an
  **NSX Manager** replacement failed and the rest kept progressing. A batch is
  **partial-success by design**, so the *n/total* counter is the only signal
  something did not land — read the final count and the task list rather than
  treating "the batch finished" as "the fleet is certified", and re-run the
  failed components as their own batch once the current one has settled.
- **NSX Manager rotation vs. a running NSX backup** (#194). The failure above
  was an NSX Manager with an **NSX backup in progress**. Suspected — **not
  confirmed** — that the rotation triggers a backup and does not wait long
  enough for it. Documented as an observation with a mitigation (check for a
  running/scheduled NSX backup, give NSX Manager its own batch), not as a
  mechanism.
- **Corrected: the #189 / #190 / #192 VCF Automation findings were field, not
  lab.** The v2.3.0, v2.3.1 and v2.3.5 entries and the matching passages in
  `05-day2-deployments.md` said "Lab-verified" / "Confirmed in the lab"; that
  work was done on a **real deployment**. Reworded to `Field-verified` /
  `Field-confirmed` in nine places. No environment-identifying detail added —
  the evidential weight is the only thing that changes. (Older `Lab-verified`
  claims elsewhere in this file predate that work and are untouched.)
- **Auto-renewal is not on by default** (#194). The certificate list carries an
  **Auto-renewal Status** column, observed **Deactivated** across a fresh 9.1
  fleet. Noted in `prerequisites.md` so expiry ownership is assigned rather than
  assumed.

## v2.3.5 — 2026-07-21
- **"There is no NSX VPC option" was wrong** (#192). `05-day2-deployments.md`
  section C stated flatly that VPC placement did not exist. **Field-verified
  2026-07-21:** VCF Automation deployed onto an **NSX VPC subnet** via the Fleet
  LCM API — validation passed, node VMs landed on the VPC portgroup, the cluster
  came up and the Provider Management UI serves at `/provider`. Broadcom's design
  library documents the pattern too ([VCF Automation instance types —
  deployment](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/design-library/vcf-automation-deployment-models-9-x/vcf-automation-instance-types/deployment.html)):
  a **DMZ VPC** for external-facing services, a **Mgmt App VPC** for the VCF
  Automation appliances, and a **Transit Gateway** between them and upstream,
  with east/west firewalling on the app VPC. New section C subsection covering
  it, plus a fifth placement in the deployment-plan tool.
- **Generalised: at Day-N *every* non-shared placement is API-only** (#192). The
  Day-N *Add VCF Automation* wizard has **no network picker at all** — it asks
  only for the runtime nodes CIDR and the FQDNs, and always uses the management
  network. So Dedicated Management Network, NSX Overlay Segment, NSX VLAN
  Segment **and** NSX VPC all require the Fleet LCM API. VPC is not a special
  case. **The exception:** the VCF Installer's *deploy deferred components* path
  (the *Management Components Custom Networking* toggle at bring-up) **does**
  place onto a prepared vDS / NSX segment from a UI — a different wizard at a
  different point in the lifecycle, and worth choosing before bring-up. The
  deployment-plan tool now emits the API task set for **all** non-shared
  placements, not just the VPC.
- **VCF Automation size *is* the deployment model** (#193). The tool offered
  `Single-node` / `HA cluster` with no size concept, implying two independent
  axes. TechDocs [VCF Automation
  Models](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/design/vmware-cloud-foundation-concepts/vcf-automation-deployment-models.html):
  Simple is *"Single node. Applies to small appliance size"*, High Availability
  is *"Three node cluster. Applies to medium or large node sizes"*, and resizing
  small → medium/large *"automatically scales the deployment out to 3 nodes"*.
  Hence the Fleet LCM payload carrying only `"size"` and no HA flag. The
  selector is now **Small (1 node) / Medium (3) / Large (3)**, with legacy saved
  plans mapped (`single`→`small`, `ha`→`medium`) so existing files and tracker
  progress still load. Documented in `05-day2-deployments.md` section D.

## v2.3.4 — 2026-07-21
- **Step-by-step for the non-management VCFA deployment** (#192). The section D
  subsection gains an explicit **Step 0 — the target network must already
  exist**: the API takes a *reference* to an existing network, it does not
  create one. Create the NSX **VPC subnet / overlay segment** first, wait for it
  to **realise in vCenter** (no MoRef until it appears there), check the return
  path, and create both A + PTR records — pre-validation resolves them, so they
  must exist first. Then **Step 1 — get the `networkMoId`**, with the
  `Get-VDPortgroup` one-liner (and the vSphere Client address-bar fallback for
  when PowerCLI is not available), plus which VPC default subnet to target
  (`vm-default-<hash>`, not `pod-default-<hash>`).
- **Mirrored William Lam's deployment script for air-gapped use** (#192). New
  **`tools/third-party/`** directory (`web/public/scripts/` is gitignored and
  regenerated at build time, so a mirror placed there would not survive a clean
  checkout); the `prebuild` step now copies `tools/third-party/*` to the site
  alongside `tools/*.ps1`.
  `tools/third-party/fleet_lcm_deploy_vcf_automation_to_different_network.ps1`
  — **© 2022 William Lam, redistributed unmodified under the BSD 2-Clause
  Licence**, with the full licence text alongside as
  `LICENSE-lamw-vmware-scripts.txt`. The only change is a provenance header
  carrying the copyright notice, the upstream URL, the mirror date and the
  **SHA-256 of the pristine upstream file** so the copy can be verified against
  the original. Docs and README link the **GitHub original first** and label the
  mirror as frozen; it does not track upstream. Everything else under
  `web/public/scripts/` is this project's own work — this one is not.

## v2.3.3 — 2026-07-21
- **Deploying VCF Automation to a non-management network is API-only** (#192).
  New `05-day2-deployments.md` section D subsection. The Fleet LCM **UI can only
  place VCFA on the management network** and only accepts a **CIDR** for the
  node addresses (smallest legal input a `/29` — 8 addresses for a component
  that needs 5). VLAN portgroup, NSX overlay segment and **NSX VPC subnet**
  placements are **API-only**, and the API takes an explicit list of 5 IPs.
  Covers: the exact pre-validation failure text and why it is **not** saying the
  placement is unsupported (the deployment network is never *declared* — the
  fields do not exist in the UI); the declaring fields `networkMoId` /
  `gatewayCidrIpv4` / `ipv4Pool.addresses`; **NSX VPC subnets appear as
  `DISTRIBUTED_PORTGROUP`**, not `OPAQUE_NETWORK` (N-VDS era); the five API
  calls and the **two different hosts** (auth on the VCFMS runtime, everything
  else on fleet lifecycle); the `admin@vsp.local` token account (**VSP** = VCF
  Services Platform); and the depot / **VCD Migration Engine** and
  new-deployments-only prerequisites. Plus a **watch-the-right-task-list**
  callout: an API-initiated deployment appears under **SDDC lifecycle**, not
  Fleet lifecycle, so it can look like it never started.
  **Credit: William Lam** — approach, endpoints and payload shape are from his
  post and `fleet_lcm_deploy_vcf_automation_to_different_network.ps1`, cited
  inline.
- **Verification status stated, not overclaimed** (#192). Confirmed through
  validation `SUCCEEDED` → deployment task progressing → **bootstrap VM present
  in vCenter on the target VPC portgroup** (the stage that proves the placement
  was *honoured*, not merely accepted). End-to-end completion was **not** yet
  confirmed at time of writing and the section says so.
- **Fixed a leftover contradiction from #190.** The section D two-FQDN callout
  still read *"resolving into the Automation `/29` node range"* — reversed in
  #190 and missed in that pass. Now says **outside** it.
- **Non-management deployment checklist** added to `05-day2-deployments.md`
  section E, including the item pre-validation does *not* cover: the return path
  from the target network to SDDC Manager / vCenter / VCF Operations.

## v2.3.2 — 2026-07-21
- **Automation's two CIDRs separated, and the v2.3.1 "unverified" flag resolved**
  (#190). TechDocs research settles it: VCF Automation has **both** an
  **internal cluster CIDR** (`198.18.0.0/15`, or `240./250.`) *and* a
  **routable nodes CIDR**. The internal one is real but **API-only** —
  `internalClusterCidrIpv4`, set via the **fleet lifecycle API / JSON spec**
  (it appears in the services-runtime redeploy payload next to `platformFqdn`),
  which is why it is absent from the *Add VCF Automation* wizard. So
  `05-day2-deployments.md` section D was **right** — just mislabelled as a
  wizard input. The v2.3.1 "verify before relying on it" note is replaced with a
  two-row comparison table.
- **New: the contiguous `/29` is version-dependent** (#190). TechDocs *Upgrade
  to VCF Automation* — `9.1.0.0`–`9.1.0.300`: *"verify that you have a dedicated
  CIDR … For example, a /29 subnet mask as VCF Automation requires 5 IP
  addresses"*; **`9.1.0.400` and later**: *"verify that you have dedicated 5
  unique IP addresses"* — no contiguous block required. Documented in
  `01-network-dns-plan.md`, `05-day2-deployments.md` and `ip-dns-plan.csv`; a
  `/29` stays the tidier choice and is valid on every version.
- **Non-overlap rule quoted** (#190). TechDocs: *"The IP addresses and FQDN for
  the VCF services runtime instance for VCF Automation must be unique. You
  cannot reuse the CIDR block and FQDN from the VCF services runtime instance
  for VCF management services."* — independent confirmation of the #189 two-FQDN
  fix, now cited in `01-network-dns-plan.md`.
- **Rainpole sample:** Automation services-runtime FQDN renamed
  `flt-autosvcs01` → **`flt-vcfa-sr01`**, matching Broadcom's own Rainpole
  example in the redeploy API docs.

## v2.3.1 — 2026-07-21
- **Both VCF Automation FQDNs resolve *outside* the services-runtime nodes
  `/29` — `+2` VM Mgmt IPs** (#190, follow-up to #189). The *Add VCF Automation*
  → **Parameters** step states it inline: *"VCF Automation FQDN and VCF services
  runtime FQDN must resolve to IP addresses that fall outside of the provided
  CIDR."* Field-confirmed that the **VCF services runtime nodes CIDR** field takes
  a **routable `/29` from the VM Management subnet** — so the `/29` is for the
  **nodes only** (IP-only, **no DNS records**) and the Automation appliance FQDN
  and Automation's own services-runtime FQDN each need a **discrete VM Mgmt IP
  on top of it**. Corrects the `-> (VCF Automation /29 range)` example added in
  v2.3.0 **and** the older `VCF Automation -> (from /29)` row in the Rainpole
  sample, which predates #189. VM Mgmt IP budget **~30–48 → ~32–50**. Updated
  `ip-dns-plan.csv` (both FQDN rows + a new IP-only `/29` row),
  `docs/01-network-dns-plan.md` (IP-count table, totals, A/PTR sources, new
  callout), `docs/05-day2-deployments.md` (section D callout) and the
  deployment-plan tool's Automation story.
- **Flagged as unverified:** `05-day2-deployments.md` section D still describes
  the Automation *cluster CIDR* as an **internal** `198.18.0.0/15` network.
  Whether that is a **separate** wizard field from the routable `/29`, or a
  conflation in this repo, is unconfirmed — the row now carries an explicit
  "check before relying on it" note pointing at #190 rather than being silently
  rewritten.

## v2.3.0 — 2026-07-21
- **Two VCF services-runtime FQDNs, not one — v1.4.2 reversed** (#189).
  Field-verified and confirmed verbatim against the TechDocs
  [First VCF Instance FQDNs and IP Addresses](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/vcf-components-fqdns-and-ip-addresses/first-vcf-instance-fqdns-and-ip-addresses.html)
  table, which lists the row *"VCF services runtime — 1 FQDN\*"* **twice**: once
  under **VCF Automation** and once under **VCF Management Services**. The
  v1.4.2 removal under #110 ("Automation's own services runtime is a hidden /
  internal component — it does not have or need an FQDN") was **wrong**;
  Automation's runtime needs its own lowercase FQDN, resolving into the VCF
  Automation `/29` node range. Intake `E10`/`E14` and the mapping already had
  this right since #111 — only the DNS/IP planning list was left with one row.
  Restored across `ip-dns-plan.csv` (both rows now name their parent component;
  new `sfo-m01-autosvcs01` row, E10), `docs/01-network-dns-plan.md` (IP-count
  table + A/PTR table — which was missing the **fleet** runtime record too —
  plus a "two runtimes" callout), `docs/05-day2-deployments.md` (section D
  callout), the Rainpole sample, and the deployment-plan tool's VCF Automation
  story (a task calling out both FQDNs).

## v2.2.9 — 2026-07-20
- **`Get-VCFCredentials.ps1` v1.2.0 — VCF Management account inventory** (#188).
  New `-VCFOps` mode lists the management-plane password *accounts* (VCF
  Operations, Automation, VCF services runtime — component / username / account
  type / expiry). **No secrets**: that side has no reveal, by design. Takes a
  plain `-Credential` (VCF Operations local account) just like SDDC Manager mode:
  it mints an Ops token and calls `/suite-api/internal/passwordmanagement/
  passwords/query` with the `X-Ops-API-use-unsupported` flag — the scriptable
  path (the `/vcf-operations/rest` UI path would need a live browser session).
  Auth recipe borrowed from VCFHealthCheck. Verified live against the lab. Docs
  (`05`) + README updated to describe both modes.

## v2.2.8 — 2026-07-20
- **`Get-VCFCredentials.ps1` is now a downloadable site tool** (#188). Added a
  **G. Helper scripts** section to `docs/05-day2-deployments.md` linking the
  download (`/scripts/Get-VCFCredentials.ps1`, auto-copied at build like the
  backup/proxy tools), with an ESXi example and a callout that VCF Management
  (VCF Operations) passwords are rotation/expiry-only and cannot be read back.
  Sign-off scope updated A–F → A–G.

## v2.2.7 — 2026-07-20
- **New tool: `tools/Get-VCFCredentials.ps1`** (#188). Read-only retrieval of the
  credentials SDDC Manager stores and rotates for its managed components (ESXi,
  vCenter, NSX Manager/Edge, PSC/SSO, backup) via the documented Credentials API
  (`POST /v1/tokens` → `GET /v1/credentials`) — the same endpoint PowerVCF's
  `Get-VCFCredential` uses. Server-side `-ResourceType` filter plus client-side
  `-ResourceName` / `-AccountType` / `-CredentialType`; passwords **masked on
  screen by default** (`-ShowPasswords` reveals, `-ExportCsv` writes the full
  inventory). Never writes. 5.1-safe (ASCII, own cert policy). Verified against a
  live VCF 9.1 lab (22 credentials across 6 resource types). Covers the SDDC
  Manager path; the VCF 9.1 Fleet/VCF Management credential endpoint is a
  deliberate follow-up pending lab confirmation.

## v2.2.6 — 2026-07-19
- **Version Overview: move Fleet Lifecycle Management into Management too**
  (#187 follow-up). Completes the lifecycle regrouping from v2.2.5 — Operations
  now holds only VCF Operations, VCF Operations for Networks and VCF Operations
  HCX. Display grouping only; version unchanged.

## v2.2.5 — 2026-07-19
- **Version Overview: move SDDC Lifecycle, Salt Master, Salt RaaS and Software
  Depot into the Management group** (#187 follow-up). Continues the regrouping
  from v2.2.4 — these run in the management plane. Fleet Lifecycle Management
  stays under Operations, which now holds VCF Operations, VCF Operations for
  Networks and VCF Operations HCX. Display grouping only; versions unchanged.

## v2.2.4 — 2026-07-19
- **Version Overview: scraper now walks the whole patch tree; fixes two silent
  under-reports and adds three components** (#187).
  - **Walk every sub-index, not just the newest.** The `nested` walker only
    searched the latest `vcf-operations/9-1-0-NNNN` sub-index, so any component
    whose latest patch lived in an *older* sub-index was invisible. It now
    gathers each component's release-notes leaf across **all** sub-indexes and
    takes the highest version. (Fetches are memoized per URL so the wider walk
    doesn't multiply load on Broadcom.)
  - **VSP and Identity Broker were stuck at GA.** `vsp`, `telemetry` and
    `identity-broker` were hardcoded `static` at the 9.1.0.0 Bill-of-Materials
    build on the assumption they never patch. They now walk the tree with a GA
    fallback: **VCF Services Runtime → 9.1.0.0200 / 25555874** and **Identity
    Broker → 9.1.0.0100 / 25522734** (both 13 Jul 2026); **Telemetry** has no
    patch leaf yet, so it correctly stays at GA and will auto-upgrade when one
    ships.
  - **Three components added** that exist in the tree but weren't listed: **VCF
    Operations for Networks** (0200 / 25517220) and **VCF Operations HCX** (0200
    / 25535720) as their own Operations rows next to VCF Operations, and
    **Real-Time Metrics Store** (0200 / 25555874). Table now covers 23
    components.
  - **Regrouped the VCF Operations services under Management.** Orchestrator,
    Log Management, Real-Time Metrics and Real-Time Metrics Store now sit in the
    **Management** group alongside VCF Services Runtime, Telemetry and Identity
    Broker (they run in the management plane); the VCF Operations product row
    stays under Operations. They still version independently — only the display
    grouping changed.
  - **Scraper now runs daily** (was weekly) — `.github/workflows/scrape-versions.yml`
    cron moved to `17 6 * * *`, and the page copy updated to match.

## v2.2.3 — 2026-07-19
- **Prerequisites: add three public URLs Broadcom now lists** (#186). The
  **Public URLs (online functionality)** table in `docs/prerequisites.md` was
  missing three outbound-443 endpoints that Broadcom's current
  [Public URLs Required for Online Functionalities](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/planning-and-preparation/public-urls-required-for-vmware-cloud-foundation.html)
  page carries:
  - `vcsa.telemetry.broadcom.com` — CEIP (SDDC Manager, VCF Operations, VCF
    Operations HCX) and `scapi.telemetry.broadcom.com` — CEIP (SDDC Manager, all
    VCF services runtime instances). These **supplement** the existing
    `vcsa.vmware.com` CEIP row — same program, distinct destinations — so all
    three are allowlisted, not swapped.
  - `api.prod.nsxti.vmware.com` — IDS/IPS advanced threat prevention (VMware
    vDefend), from NSX Manager. Gated: **only when vDefend IDS/IPS is in scope**,
    and it is not part of the base VCF SKU. Added a note under the table so the
    conditional row and the three-way CEIP set both read as intentional. Rows
    quoted verbatim from the Broadcom page.

## v2.2.2 — 2026-07-19
- **Docs: point live-site links at the custom domain** (#183). After the site
  moved to `https://vcf-planning.hollebollevsan.nl` (#182), the docs still linked
  to the old `https://pauldiee.github.io/VCF9-DeploymentPlanning/…` URLs. They kept
  working via GitHub's auto-redirect but showed the old domain and added a redirect
  hop. Rewrote every user-facing absolute link (README live-site URL, template
  downloads, tool links, script links) across `README.md` and `docs/` to the new
  domain. `CHANGELOG.md` historical entries are left untouched (dated record).

## v2.2.1 — 2026-07-19
- **Version Overview: correct the VCF Operations sub-component wording** (#185).
  The footnote said the indented rows under VCF Operations were "internal nodes,
  not separately-patched products" — which is inaccurate. Orchestrator, Log
  Management, Real-Time Metrics (and the Salt / lifecycle / depot services) are
  **independently-versioned components**, each with its own build; they simply
  happen to be aligned on the same Express Patch (`9.1.0.0400`) right now because
  none has shipped a divergent patch yet. The scraper already treats them as
  independent (each fetches its own release-notes leaf and build). The nesting
  stays as a **visual grouping**; only the copy (page footnote + code comments)
  was reworded to stop implying they don't version on their own.

## v2.2.0 — 2026-07-19
- **Version Overview: VCF Operations nodes, optional add-ons, and GA release dates**
  (#180, #181, #184).
  - **VCF Operations nodes** (#180): Orchestrator (`25545173`), Log Management
    (`25544947`) and Real-Time Metrics (`25544944`) now appear **indented beneath
    the VCF Operations row**, so their node builds are visible without implying
    they patch as independent products. The scraper reads their own leaves from
    the same `vcf-operations/9-1-0-0400/` tree (the Real-Time Metrics leaf slug
    carries Broadcom's `mertics` typo, which the regex tolerates).
  - **Optional add-ons** (#181): a new **Add-ons** section lists vDefend
    (`9.1`, Build `25377994`), Data Services Manager (`9.1`, Build `25367580`)
    and Avi Load Balancer / NSX ALB (`32.1.2`), clearly marked as **not part of
    the base VCF BOM**. Each lives in its own Broadcom release-notes tree (not the
    VCF `9-1-0-0NNN` patch tree), so each has a dedicated scrape strategy. Avi
    publishes no 8-digit build, so its Build column shows `N/A`.
  - **GA release dates** (#184): the Management rows (VSP, Telemetry, Identity
    Broker) now show the VCF 9.1.0.0 general-availability date (`12 May 2026`,
    from the release-notes header) instead of a blank Released column.

## v2.1.2 — 2026-07-19
- **Site now served on a custom domain: `https://vcf-planning.hollebollevsan.nl`**
  (#182). The GitHub Pages site moves off the project-path URL
  (`pauldiee.github.io/VCF9-DeploymentPlanning`) onto a clean subdomain of the
  author's blog domain. Only `web/astro.config.mjs` changed: the GitHub `SITE`
  default is the new origin and `BASE` defaults to `''` (root) — passed to Astro
  as `base: BASE || '/'`. The GitLab mirror is untouched (it sets its own
  `SITE_URL` / `SITE_BASE`). GitHub auto-redirects the old project URL, so
  existing links keep working. Hardcoded old-domain links inside the docs are
  left to a follow-up (#183); they resolve via the redirect in the meantime.

## v2.1.1 — 2026-07-19
- **Version Overview: real GA builds for the un-patched components** (#179).
  VSP, Telemetry and Identity Broker previously showed a bare "GA build" label.
  They now carry their actual general-availability build (VSP `25370367`,
  Telemetry `25181946`, Identity Broker `25368698`, all `9.1.0.0`), sourced and
  verified verbatim from the 9.1.0.0 Bill of Materials, with the source link
  pointing at the BOM page. The scheduled scraper workflow was fired once via
  `workflow_dispatch` to confirm it runs green in CI end-to-end.

## v2.1.0 — 2026-07-19
- **New: auto-updating VCF 9.1 Version Overview page** (#179). A new
  `/version-overview` page shows the current latest version + build for every
  VCF 9.1 component. In 9.1 components patch per-component and asynchronously
  (Express Patches), so any point-in-time table drifts within weeks — this one
  is refreshed **weekly** from Broadcom and stays honest. A dependency-free Node
  scraper (`web/scripts/scrape-versions.mjs`) reads vCenter from its build-number
  KB and every other component from the Broadcom TechDocs patch-release tree
  (walking hrefs, since slugs and depth vary per product), emitting
  `web/src/data/vcf-versions.json`. A scheduled workflow
  (`.github/workflows/scrape-versions.yml`, Mondays + manual dispatch) runs it
  and commits the JSON back to `main`, which the existing Pages deploy picks up.
  **Fail-safe:** on any fetch/parse miss the last-known value is kept (never
  blanked) and the failing source is flagged on the page. Un-patched components
  (VSP, Telemetry, Identity Broker) render at their GA build. Linked from the
  header nav and the sidebar Reference section.

## v2.0.2 — 2026-07-16
- **Fix: the sizer under-sized Avi-only fleets by a whole License Hub** (#176).
  The hub's footprint (10 vCPU / 30 GB / 710 GB) was folded into the *Security
  Services Platform* row and gated behind **SSP** being selected — but License
  Hub is required whenever **vDefend *or* Avi** is in scope. An **Avi-only**
  fleet (the common case here: Avi as the Supervisor LB, no vDefend) therefore
  lost the entire footprint. It is now **its own row**, added when **either** is
  selected and **once** when both are. Verified across all four combinations;
  the SSP-only total is **unchanged** (122/444/4806 — the hub only moved rows).
  `04-sizing.md` updated to match. The **710 vs 810 GB** workbook-vs-TechDocs
  divergence is documented, not silently "corrected".
- **Fix: `prerequisites.md` asked for Avi DNS records nothing consumes** (#177).
  It said **A + PTR for all four** controller addresses, while
  `01-network-dns-plan.md`, intake `E16` and `workbook-cell-mapping.md` all said
  the 3 nodes are **IP-only** and **only the cluster FQDN needs DNS** — the
  straggler #112 missed. Now aligned: **one A + PTR per set, the cluster FQDN,
  resolving to the cluster VIP**; nodes and VIP are IP-only workbook fields.

## v2.0.1 — 2026-07-16
- **Fix: Avi controllers always live in the management domain** (#174).
  Field-verified. `prerequisites.md` and `06-deployment-plan.md` both said the
  controller cluster is deployed *"into the workload domain"* for a Supervisor —
  it never is. **Controllers always run in the management domain**, whichever
  domain they serve, the same way a workload domain's vCenter and NSX Managers
  do. Only the **Service Engines** are distributed, and they are **always present
  per cluster** (min 2 for HA) in the workload domain.
  **A controller set is scoped to the NSX instance, not the WLD:** WLDs sharing
  an NSX instance share one set; a WLD with its own NSX gets its own. Knock-ons
  fixed in the same pass — `01-network-dns-plan.md` budgeted a flat *"+4 if Avi
  is in scope"* (now **+4 per NSX instance**), `04-sizing.md` lumped Avi into a
  per-WLD repeater (now split: controllers on the **management** footprint per
  NSX instance, Service Engines per **cluster** in the WLD, unmodelled), and
  intake `E16` implied one global cluster (now asked **per NSX instance**).
- **New: License Hub** (#175). The **SSP (Security Services Platform) Installer**
  deploys a licensing appliance — **License Hub** — that centrally manages
  **vDefend + Avi** subscription license files, replacing the traditional
  25-character keys. Needed **only when vDefend or Avi is in scope**. New
  `prerequisites.md` section (Day-N if in scope) + intake `E17` +
  `01-network-dns-plan.md` row + `04-sizing.md` note + mapping row. It is **three
  VMs** (installer / controller / worker) and **~9 IPs** across two pools whose
  **node and service pools cannot be changed after deployment**.
  - **It is not the `License Server`, and both exist.** The License Server is
    deployed at bring-up, tied to VCF Operations, and licenses the VCF fleet;
    License Hub is Day-N from the SSP Installer and licenses vDefend + Avi. They
    **coexist** — called out explicitly so the two names aren't conflated.
  - **Air-gapped sites: a manual license file import every six months.**
    Connected mode polls the Avi Cloud Console every 15 min; **disconnected mode
    needs a file carried in twice a year, forever** — flagged with a named owner,
    for the same audience as the offline depot in `09-binary-depot.md`.

## v2.0.0 — 2026-07-16
- **Renumbered the two split pages to plain section numbers** (#172). The #171
  split deliberately kept the old `A.`/`B.` numbering to preserve every deep-link
  while the pages moved; now that they're standalone, `08-backup-target.md` reads
  **§1–§7** (was A.1–A.7) and `09-binary-depot.md` reads **§1–§6** (was B.0–B.5 —
  the unnumbered-looking `B.0` becomes a plain §1). Headings, both Contents
  tables, intra-page cross-links and every external reference (prerequisites,
  deployment plan, intake) moved together. Cross-page references now name the
  page they point at (*"Backup Target §5"*, not a bare *"A.5"*), since a bare
  number no longer says which of the two pages it means; the two prose refs that
  crossed pages without a link (the depot's ICMP note, the proxy's Fleet LCM
  pattern) are now real links. Whole-page refs that used to read *"§A"* / *"§B"*
  just point at the page. Verified with a build: all **145** in-page and
  cross-doc anchors resolve.
- **Old `/docs/08-backup-and-depot/` URL no longer 404s** (#173). The split
  removed the page and its URL with it. Because it covered two distinct topics,
  it's a small **landing that links both new pages** rather than a meta-refresh
  to one — an auto-redirect would silently strand anyone who bookmarked it for
  the depot half. Kept out of the search index, like the `02-customer-intake`
  redirect it sits beside.
- Version rolls to **2.0.0**: `1.9.9` had both the patch and the minor component
  at `.9`, and this repo caps every component at `.9`.

## v1.9.9 — 2026-07-16
- **Split the backup-and-depot guide into two pages** (#171). It had grown to
  ~1050 lines over two distinct topics; now **`08-backup-target.md`** (the SFTP
  backup target — build, verify, field-notes) and **`09-binary-depot.md`** (the
  offline depot / VCF Download Tool), each with its own focused Contents and a
  cross-link to the other. Section headings promoted to **H2** so the site's
  sticky *On this page* nav lists every section and each gets a **back-to-top**
  button. `nav.ts` (two sidebar entries), README, CLAUDE, and every cross-doc link
  (intake, deployment plan, prerequisites) updated; existing anchors preserved.
  Also refined the §A.1 two-menus note — SDDC Manager **+ NSX** live in *Operate →
  Administration → SDDC Manager*, management services in *Build → Lifecycle →
  Backup & Restore*.

## v1.9.8 — 2026-07-15
- **A.1 note: SDDC Manager and management-services backups live in two menus**
  (#170). In VCF 9.1 the central backup isn't one screen — **SDDC Manager** is
  *Operate → Administration → SDDC Manager*, **management services** (log mgmt,
  identity broker, Salt master, VCF Automation, depot — the Fleet LCM config the
  `tools/` scripts target) is *Build → Lifecycle → Backup & Restore*, and each
  vCenter is separate again (VAMI). Added so people set all of them.

## v1.9.7 — 2026-07-15
- **A.5 note: backup `knownhosts: key is unknown` via FQDN, fixed by IP** (#169).
  Field-verified. When the backup precheck fails the SSH host-key check (banner
  received, so TCP is fine), the cause is usually the target **FQDN** fronting more
  than one host / resolving to a different box than *Fetch Fingerprint* read — the
  pinned key and the precheck's key come from different servers. Address the target
  by the single host's **IP** (a target that failed by FQDN went in flawlessly by
  IP). The ed25519-vs-RSA / `HostKeyAlgorithms` chase is a rabbit hole. New §A.5
  subsection (+ contents row) with the `getent ahosts` check.

## v1.9.6 — 2026-07-15
- **Proxy exclusions note** (#168). `08-backup-and-depot.md` §B.4: a bare
  `peerProxy` (host/port only) forces *all* services-runtime HTTP egress through
  the proxy — including internal VCF appliances and the on-prem offline depot. Set
  `excludeDomains` (internal DNS suffix) and `excludeIpAddresses` (mgmt /
  services-runtime CIDRs + the depot IP/subnet) so only internet-bound traffic is
  proxied; `Get-VCFProxyConfig.ps1` shows whether they're set.

## v1.9.5 — 2026-07-15
- **Fix: the sidebar (planning flow) scrolls when taller than the viewport**
  (#167). The desktop `.sidebar` was `position: sticky` with no height cap, so on a
  short screen the lower nav items (Tools, Example) were cut off and unreachable.
  Capped it to `calc(100vh - header - offset)` with `overflow-y: auto`; the ≤860px
  mobile rule (already `static`) resets that. Verified the sidebar scrolls and the
  last item ("Worked Step 1 plan") is reachable.

## v1.9.4 — 2026-07-15
- **`-Remove` now actually clears the proxy** (#164, script v1.0.3). Field test
  showed `peerProxy: null` was a **silent no-op** — the Fleet LCM PATCH is a
  merge, so null (and an empty object) change nothing while the task still reports
  success. Clearing requires **explicit empty values**; verified live that a blank
  host + port 0 + false flags blanks the stored proxy. `Set-VCFProxyConfig.ps1
  -Remove` now sends that, and §B.4 notes the no-op gotcha.

## v1.9.3 — 2026-07-15
- **Proxy scripts hint `-SkipCertificateValidation` on a TLS trust error** (#166).
  A `-Remove` run failed with *"The SSL connection could not be established"* — a
  self-signed-cert trust error (the flag was omitted), but it read like a `-Remove`
  bug. `Set-VCFProxyConfig.ps1` (v1.0.2) and `Get-VCFProxyConfig.ps1` (v1.0.1) now
  detect SSL/certificate/trust errors in the auth step and suggest re-running with
  `-SkipCertificateValidation`. (The two backup scripts share the same catch and
  can follow.)

## v1.9.2 — 2026-07-15
- **HTTP offline depot option (9.1)** (#165). `08-backup-and-depot.md` §B.1 Step 1:
  9.1 supports an offline depot over plain **HTTP** (VCF Installer + Fleet Depot
  Service), which skips the cert — but **has no authentication** (the Step 2 auth
  split is HTTPS-only; the Installer UI says so) and the **UI won't register it,
  only the VCF Installer API will**. nginx: `listen 80`, no `ssl_*`/`auth_basic`,
  open 80. HTTPS + self-signed + step 7 import stays the recommended path.

## v1.9.1 — 2026-07-15
- **`Set-VCFProxyConfig.ps1 -Remove` clears the proxy** (#164, script v1.0.1).
  The script was set-only (`-ProxyHost` mandatory); `-Remove` now makes
  `-ProxyHost` optional and PATCHes `peerProxy: null` to clear the configured
  proxy, keeping `-WhatIf` and the confirmation prompt. Verify with
  `Get-VCFProxyConfig.ps1`. The clear payload (`null`) is unverified against the
  API — if it wants an empty object instead, that's a one-line change (noted in
  the script). README + §B.4 scripts table updated.

## v1.9.0 — 2026-07-15
- **(Re)apply the Step 2 security after the download** (#163). Field-verified: the
  `binaries download` creates/refreshes the depot's `PROD/…` tree, so the Step 2
  auth split must be applied **after** the store is populated (not before), and
  re-checked after every Day-N `--type UPGRADE` refresh. Added a note at the end of
  `08-backup-and-depot.md` §B.1 Step 5 with the curl re-verify.

## v1.8.9 — 2026-07-15
- **VCF Download Tool proxy flags + the HCL-endpoint gotcha** (#162). Field-
  verified in a proxied site. `08-backup-and-depot.md` §B.1 Step 5:
  - **The shell proxy env vars are ignored** — the tool honors only its own
    flags. Use **`--proxy-server <FQDN:Port>`** (`-s`, no scheme), `--proxy-https`
    for an HTTPS proxy (needs the proxy cert in the tool's JRE trust store), and
    `--proxy-user`/`--proxy-user-password-file` for auth. Without it the symptom is
    `Fail to obtain access token from Broadcom OAuth Authorization server` +
    name-resolution errors (with a proxy, the proxy does the DNS).
  - **Gotcha (KB 438222):** after the proxy works, `Failed to get last updated
    time for HCL` — swap `vsan.hcl.client.endpoint` from `vsanhealth.vmware.com`
    to `eapi.broadcom.com` in both `conf/application-prod.properties` and
    `application-prodV2.properties`.

## v1.8.8 — 2026-07-15
- **openssl recipe for the depot TLS cert** (#161). `08-backup-and-depot.md` §B.1
  Step 1 said "give it a cert with FQDN+IP SANs" but showed no command. Added the
  self-signed `openssl req -x509 … -addext subjectAltName=DNS:…,IP:…` recipe (825
  days, key perms) with the gotcha that clients **ignore the CN and read only the
  SAN**, a CA-signed CSR alternative, and the reload step (`nginx -t && systemctl
  reload nginx` — a running nginx re-reads certs on reload).

## v1.8.7 — 2026-07-15
- **Photon depot variant expanded into a full offline build** (#160). The `tdnf
  install nginx` one-liner (#159) assumed internet on the one box most likely to
  be air-gapped. `08-backup-and-depot.md` §B.1 now has a *Photon OS variant
  (offline build)* subsection (+ contents row) covering it end to end: **install
  nginx offline** — the preconfigured `photon-iso` repo off the mounted full ISO
  (`tdnf --disablerepo=* --enablerepo=photon-iso nginx`) or `--downloadonly`
  RPMs from an online same-version box; **serve the store** — nginx server block,
  HTTPS, doc-root at `--depot-store`, `autoindex`, `nginx`-user perms (no SELinux
  on Photon); the **auth split** in nginx with an `openssl passwd -apr1` htpasswd
  entry (no `httpd-tools` on minimal); **open 443** in iptables; start + verify
  with `curl`. Photon specifics verified against the Photon admin docs.

## v1.8.6 — 2026-07-15
- **Photon OS variant for the depot web server** (#159). `08-backup-and-depot.md`
  §B.1 Step 1: the parts that differ on a minimal Photon image — `tdnf install`
  the web server (`nginx`/`httpd`, nothing preinstalled), point the doc root at
  the depot store + wire the Step 1 cert, and open **inbound 443 in iptables**
  persisted to Photon's `/etc/systemd/scripts/ip4save` (default firewall allows
  only SSH and drops ICMP). Auth split, cert SANs and Step 7 are unchanged.

## v1.8.5 — 2026-07-15
- **Ports for the offline depot server** (#158). `08-backup-and-depot.md` §B.1
  Step 1: the only listening port the platform needs is **inbound TCP 443
  (HTTPS)** — from the VCF Installer (bring-up) and the SDDC Manager / VCF
  Operations depot services runtime / vCenter (Day-N), the same "Needed by" set as
  the Public URLs table pointed at the depot. Open it from the management network
  **and the whole services-runtime block** (the fleet Depot Service pulls from
  there). No inbound 80; outbound only if the box also runs the VCF Download Tool.

## v1.8.4 — 2026-07-15
- **Offline depot disk sizing** (#157). `08-backup-and-depot.md` §B.1 Step 1 now
  distinguishes the actual footprint from the provisioning target: **start around
  300 GB** for the initial INSTALL depot (bundles + OVAs + ESX ISO), and provision
  Broadcom's recommended **≥ 1 TB** because the store grows every Day-N patch cycle
  (the fleet Depot Service side-loads too), a few GB per ESX patch pull. Field
  guidance — no authoritative content footprint is published.

## v1.8.3 — 2026-07-15
- **Gotcha: the peer-proxy precheck is a netcat test from the whole node block**
  (#156). Field-verified on a live 9.1 fleet. Setting the proxy is accepted, then
  a `peer-proxy-precheck` workflow runs on the VCF services runtime and does a
  plain L4 `nc` TCP connect to the proxy from a pod that can land on **any** node
  (egress SNATs to the node IP). If it times out the proxy is never applied, and
  the surfaced error is misleading ("proxy may be slow, overloaded..."). The catch:
  Broadcom's documented access doesn't list the whole services-runtime node block
  as a source, so firewalls get opened only for the depot + VCF Ops IPs and the
  precheck fails. New gotcha in `08-backup-and-depot.md` §B.4 (+ contents sub-row)
  with the `kubectl -n vmsp-platform logs ... -c main` recipe, `kubectl get nodes
  -o wide` for the source IPs, and the fix: **firewall the whole block** — the
  same lesson as the backup target in §A.5. Also flagged on the **Public URLs**
  list in `prerequisites.md` (where proxy egress is planned), linking the full
  §B.4 writeup.

## v1.8.2 — 2026-07-15
- **Field notes: safely shutting down the VCF services runtime** (#155). New
  **§A.6** in `08-backup-and-depot.md` (References → §A.7) for the cases that need
  the management plane fully down first — cold backup / VM snapshot, planned
  vSphere maintenance, a power event, or decommission. It documents Broadcom's own
  **`vcf_services_runtime_shutdown.sh`** (KB 440874) rather than reimplementing it:
  the runtime has an internal shutdown order, driven through the API (port 5480)
  on the control-plane node. Covers the prep (`curl`/`jq`/`govc`, control-plane
  node + kubeconfig) and the three modes — `--dry-run` (first), `--skip-poweroff`,
  and full with vCenter creds. Same `VSP` cluster as the §B.4 proxy. Includes a
  **"getting a `kubectl` session on the control-plane node"** recipe (SSH in as
  `root`, `kubectl` is already wired to the cluster) that the §B.4 precheck
  troubleshooting reuses.

## v1.8.1 — 2026-07-15
- **Make the proxy scripts downloadable from §B.4** (#154). They were listed as
  plain inline code; now they are a clickable download table linking
  **[Get-VCFProxyConfig.ps1](https://pauldiee.github.io/VCF9-DeploymentPlanning/scripts/Get-VCFProxyConfig.ps1)**
  and
  **[Set-VCFProxyConfig.ps1](https://pauldiee.github.io/VCF9-DeploymentPlanning/scripts/Set-VCFProxyConfig.ps1)**
  straight from the site, exactly like the backup scripts in §A.5.

## v1.8.0 — 2026-07-15
- **Proxy config for the VCF services runtime, via the Fleet LCM API** (#154).
  When the VCF Management Services components have no direct internet path, the
  fleet downloads bundles through a proxy set on the **VCF services runtime** (the
  `VSP` component). The Broadcom procedure is a wall of `curl`/`jq`; underneath
  it is the same Fleet LCM API pattern as the backup config. Two new `tools/`
  scripts, reusing the backup scripts' proven auth chain (token acquire → exchange
  for the `fleet-lcm` bearer → talk to the fleet appliance directly, **not** the
  `/vcf-operations/plug` UI route that 405s a token client, #150):
  - **`Get-VCFProxyConfig.ps1`** — read-only; shows the `peerProxy` actually
    stored on each `VSP` component.
  - **`Set-VCFProxyConfig.ps1`** — `PATCH`es the proxy (`-WhatIf`, masked secrets,
    authenticating proxy, TLS proxy via `-CertificateFile`, exclude lists).
  New **§B.4** in `08-backup-and-depot.md` (References → §B.5) with the distilled
  flow and three traps: go straight to the fleet appliance; skip the
  `/casa/services` service-key lookup (the key is the literal `"fleet-lcm"`); and
  the proxy `port` is a JSON **number**, unlike the string port in the backup
  payload. The scripts are served from the site automatically (the `prebuild`
  copies every `tools/*.ps1`).

## v1.7.5 — 2026-07-15
- **Reference the VCFJsonSpecCreators sister repo** (#153). Paul's public
  `pauldiee/VCFJsonSpecCreators` — interactive PowerShell that builds, validates,
  and submits the SDDC Manager API JSON for **Day-N expansion** (network pools,
  workload domains, added clusters, vSAN stretch), the step *after*
  VCFHostPreparation commissions the hosts. New bullet in the README **Related
  tools** section (paired with VCFHostPreparation, and distinguished from
  VCF.JSONGenerator, which builds the *initial* bring-up JSON). Threaded into the
  `06-deployment-plan.md` build stories where those specs are actually assembled
  — **7.4** (mgmt stretch), **9.3** (create WLD + network pool), **9.5** (stretch
  WLD) — and a scope pointer in `05-day2-deployments.md` separating
  fleet-component Day-N (that page) from domain/cluster Day-N (E9). More to come.

## v1.7.4 — 2026-07-13
- **The backup-config scripts are downloadable from the site** (#152). They were
  only reachable by cloning the repo. `08-backup-and-depot.md` §A.5 now links
  **[Get-VCFBackupConfig.ps1](https://pauldiee.github.io/VCF9-DeploymentPlanning/scripts/Get-VCFBackupConfig.ps1)**
  and
  **[Set-VCFBackupConfig.ps1](https://pauldiee.github.io/VCF9-DeploymentPlanning/scripts/Set-VCFBackupConfig.ps1)**
  directly, next to the field notes where someone debugging a target actually is.
  Served the same way as the CSV planning templates. The files are **copied from
  `tools/` at build time** (`prebuild`) rather than duplicated into `web/public/`:
  `tools/` stays the single source of truth and the served copies cannot silently
  drift behind a later fix. `web/public/scripts/` is generated, so it is
  gitignored.

## v1.7.3 — 2026-07-13
- **Field notes for a backup target that will not configure** (#151). A day spent
  on a 9.1 build whose backup target refused to save produced findings that are in
  no product documentation. New **§A.5** in `08-backup-and-depot.md` (References →
  §A.6):
  - **Read the sshd log correctly.** A bare `Connection closed by <ip> [preauth]`
    with **no username** is a **host-key probe, not a failure** — VCF fetching the
    fingerprint, in bursts of three, and it appears on **working** configurations
    too. **Only lines with a username mean anything.** `Accepted … for <account>`
    is success; a **UUID** as the username means the platform is sending a
    credential *identifier* instead of the account name, which is abnormal.
  - **A failed submit stores nothing.** The submit starts a validation workflow;
    if it fails, the configuration is not saved — an empty Backup & Restore table
    means the task failed, not that you forgot to save. The UI's task detail
    bottoms out at *"check the errors in the next sub-task(s)"* with no next
    sub-task.
  - **The clients are the whole services-runtime block**, on arbitrary pod
    addresses, each service with its own SSH stack: open TCP 22 **from the block**,
    not from named hosts, and **offer a superset** of algorithms — some fleet
    services are **not** FIPS-constrained (ed25519, curve25519), so narrowing
    `sshd_config` to satisfy one client breaks another.
  - **Two `sshd_config` traps:** the crypto directives are **global-only and cannot
    live in a `Match` block** — walkthroughs tell you to append their `Match` block
    at the bottom, so appending crypto after it stops sshd from starting; and
    changing the host keys **invalidates the pinned fingerprint**.
  - **Windows `ssh-keyscan` is broken** against modern servers (it offers
    `sntrup761x25519` and cannot perform it) — read the fingerprint **on the
    server**.
  - **The Fleet lifecycle API**, and the trap that cost the most: **reads *and*
    writes belong on the fleet appliance**. The `/vcf-operations/plug/fleet-lcm/…`
    path the browser uses is the **UI's session-authenticated route** — a token
    client gets **HTML on a GET and 405 on a PATCH**. Copy the payload from the
    browser, never the URL. Cross-references `tools/Get-VCFBackupConfig.ps1` and
    `tools/Set-VCFBackupConfig.ps1`.

## v1.7.2 — 2026-07-13
- **`Set-VCFBackupConfig.ps1` now actually writes** (#150, #149, script v1.0.3).
  The PATCH was aimed at the URL captured from the browser
  (`/vcf-operations/plug/fleet-lcm/…`) and came back **405 Method Not Allowed**.
  That path is the **user interface's session-authenticated route** — the
  browser's call works because it carries a logged-in Ops session's `JSESSIONID`
  cookie. A token client gets **405 on a PATCH and HTML on a GET** (#148): one
  cause, two symptoms. The error was copying the browser's request *wholesale* —
  URL, method and payload — when only the **payload** was portable. Both the
  lookup and the write now go straight to the **fleet appliance**
  (`https://<FleetLCM>/fleet-lcm/v1/sddc-lcms/{id}`), where the Bearer token is
  already accepted. **Verified live on 9.1:** 202 Accepted, and the platform
  starts a real `ConfigureBackupLocation` workflow.
- Because `-FleetLCM` is now needed for the write itself, the script **prompts**
  for it when it is missing instead of erroring out, and says where to find it:
  *VCF Operations → Build → Lifecycle → VCF Management → Components*, the **Fleet
  lifecycle** row. It already prompted for everything else it needs, so failing
  there was the odd one out. `-SddcLcmId` is deliberately **not** prompted for —
  looking up a GUID by hand is a chore; it stays the bypass for anyone who has it.

## v1.7.1 — 2026-07-13
- **`Set-VCFBackupConfig.ps1` could not find the VCF instance** (#148, script
  v1.0.2). It failed with *"The property 'id' cannot be found on this object"*.
  Root cause, and the thing worth remembering: **the two endpoints are not
  interchangeable.** The **VCF Operations proxy**
  (`/vcf-operations/plug/fleet-lcm/…`) serves the **write** — it is the path the
  product's own UI calls for the PATCH — but a **GET** against it falls through to
  the VCF Operations **web application and returns HTML**, which the script was
  then treating as an instance object. The **instance list lives on the fleet
  appliance** (`https://<FleetLCM>/fleet-lcm/v1/sddc-lcms`), which is what
  `Get-VCFBackupConfig.ps1` already used. Discovery now runs there (new
  **`-FleetLCM`** parameter) while the write still goes through the proxy — each
  endpoint used only where it is known to work. `-SddcLcmId` still skips discovery
  entirely. Verified end to end against a live 9.1 lab: the instance resolves and
  the `-WhatIf` payload matches the request the UI itself sends.

## v1.7.0 — 2026-07-13
- **`Set-VCFBackupConfig.ps1 -ShowThumbprint` stops lying about why it failed**
  (#147, script v1.0.1). It reported *"ssh-keyscan returned nothing. Is the host
  reachable on port 22? ssh-keyscan and ssh-keygen must be on the PATH"* — and
  both claims were false: the target was reachable and both binaries were on the
  PATH. The real error was being swallowed by `2>$null`:
  `choose_kex: unsupported KEX method sntrup761x25519-sha512@openssh.com`. The
  **in-box Windows OpenSSH client** (9.5p2) advertises the post-quantum
  `sntrup761x25519` key exchange and then **cannot perform it**, so `ssh-keyscan`
  dies during key exchange against any modern server and prints nothing. That is a
  **client** bug and says nothing about the backup target. The helper now checks
  the PATH before blaming it, prints **what `ssh-keyscan` actually said**, names
  the Windows bug when it sees that signature, and always offers the authoritative
  fallback that needs no SSH client at all — read the fingerprint **on the SFTP
  server**: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` (and the `ecdsa` /
  `rsa` pubkeys). Verified against a live 9.1 lab target.

## v1.6.9 — 2026-07-13
- **`08-backup-and-depot.md` is navigable** (#146). It had grown into two long
  sections you could only scroll: it is now the page people open mid-build with a
  specific question ("how do I verify the target?", "how do I feed the Installer
  without a depot server?"), so it should let them jump straight there. Adds a
  **Contents index** (with a *use it when* column, not just section names) and
  **finer-grained headings** to land on: A.3 splits into the **Linux (chroot jail)**
  and **Windows Server** variants; A.4 into **the check** (force the FIPS
  negotiation), **three traps this catches**, and **Windows targets: a word of
  caution**; section B gains **B.0 — three ways to feed binaries** (the
  online/offline/manual decision, previously an unnamed preamble); and **B.1's
  seven steps become seven headings** (*Step 1 — Depot web server* … *Step 7 —
  Connect VCF to it*), so "the activation code needs the Product Administrator
  role and takes days" is findable without reading the section top to bottom. All
  24 index anchors verified against the rendered site.

## v1.6.8 — 2026-07-13
- **Distributed connectivity is planned to the field level, like Centralized was**
  (#142). The Centralized path had concrete inputs at every step and the
  Distributed path had none, so a Distributed fleet still left gaps after Step 1.
  `01-network-dns-plan.md` §B is now split: **B.1 BGP plan (Centralized)** and a
  new **B.2 Distributed Transit Gateway plan** — external VLAN + **gateway CIDR**
  (the VLAN **every ESX host** attaches to, replacing the Edge uplinks), the
  routable **external IP block**, the **private transit-gateway block** (**9.1:
  must be a `/16`**), the **VNA appliance FQDNs + IPs** (2 minimum for HA) and
  default outbound NAT. VLAN row 11 and the IP-count and DNS tables gained their
  VNA rows; Edge rows are marked **Centralized only**. Two clarifications that
  cost people time: **"Distributed" is not a synonym for "VPC"** (VPCs run on
  either transit-gateway type), and a **VNA cluster is not a small Edge cluster**
  (it gives a DTGW **stateful services**; no Tier-0/Tier-1 runs on it).
- **The deployment plan says so too** (#142). `06-deployment-plan.md` +
  `web/src/lib/deployment-plan.ts`: story **1.2** is now a choice (*BGP plan* **or**
  *Distributed Transit Gateway plan*) instead of BGP-only; **4.2** asks for the
  external VLAN on **every host** + the fabric gateway SVI instead of a ToR BGP
  fabric; **4.3**'s DNS acceptance lists the **VNA appliances** where the model has
  no Edge nodes; **6.1 / 9.4** carry the real build inputs, and 9.4 spells out that
  they are **per-domain** (a second Distributed WLD needs its own external VLAN, IP
  block and VNA cluster). Under Distributed, the fabric — not a Tier-0 — does the
  routing, so its sign-off is the same hard gate BGP gets. Also fixes a real error:
  the Supervisor task described the external IP block as **"BGP-advertised"** under
  Distributed connectivity, where **there is no BGP**.

## v1.6.7 — 2026-07-13
- **`tools/` — read and set the 9.1 backup configuration over the API** (#145).
  Configuring the centralized 9.1 backup (VCF Operations → Build → Lifecycle →
  VCF Management → Backup & Restore) can fail with nothing usable in the UI: the
  task detail bottoms out at *"check the errors in the next sub-task(s)"* with no
  next sub-task, while the SFTP server's `sshd` log shows the platform presenting
  a **UUID as the SSH username** instead of the service account that was typed
  into the wizard. Two scripts, both against the Fleet lifecycle API:
  - **`Get-VCFBackupConfig.ps1`** (read-only) — prints the backup target, **the
    stored username**, directory, schedule, retention and history that the
    platform *actually holds*, which is not always what was entered. Flags an
    empty username and a username that is an identifier rather than an account.
  - **`Set-VCFBackupConfig.ps1`** — performs the same `PATCH` the *Add Backup
    Location* dialog makes, for when the dialog will not take it. `-WhatIf`
    prints the payload with the secrets masked; `-ShowThumbprint` lists every SSH
    host-key fingerprint the target offers (the platform pins one, and different
    fleet services negotiate different key types).

  Endpoints, captured from the product: `GET /fleet-lcm/v1/sddc-lcms` carries
  `backupConfig.storage.sftp { host, port, username, directory }` inline, and the
  write is `PATCH /vcf-operations/plug/fleet-lcm/v1/sddc-lcms/{id}` with a
  `backupConfigSpec` wrapper (**note:** it reads back as `backupConfig`, `port` is
  a **string**, and a `thumbprint` is required). Auth is the three-call chain
  through VCF Operations. Both scripts run on Windows PowerShell 5.1 and 7+.

## v1.6.6 — 2026-07-13
- **Verify your SFTP backup target — and FIPS is on by default in 9.x** (#144).
  `08-backup-and-depot.md` explained how to *build* a target but never how to
  *verify* one, and never mentioned that in new VCF 9.0+ deployments *"FIPS
  compliance in SDDC Manager is on by default and cannot be turned off"* — which
  silently makes the FIPS-mode SSH requirements the **baseline** on every fresh
  9.1 build. §A.2 now carries the full requirement set (host key algorithms,
  plus the FIPS KEX list and the `hmac-sha2-256` MAC), and a new **§A.4 Verify
  the target before you register it** gives the decisive test: force the
  negotiation down to FIPS-approved algorithms with `ssh -o KexAlgorithms/MACs/
  HostKeyAlgorithms/Ciphers` — if it connects, SDDC Manager will. Traps called
  out: `hmac-sha2-256` vs the **ETM** variant (hardened servers often offer only
  ETM — passes a hardening scan, fails VCF), OpenSSH 8.8+ dropping legacy
  `ssh-rsa` (KB 372839), the `/C:/…` path format on Windows, and the fact that
  Broadcom's own "Ciphers" list on that page is TLS suite names that don't apply
  to the SSH handshake. Also flags the Dell/VxRail field report that Windows was
  only tested with Cygwin. Old §A.4 References → §A.5; `prerequisites.md`'s SFTP
  section points at the new check.

## v1.6.5 — 2026-07-13
- **Bring-up gates are now explicit, in the docs *and* the templates** (#143).
  You could not tell which prerequisites stop the Installer and which can wait.
  `prerequisites.md` gains a *When is each item needed?* section defining four
  markers — **Bring-up**, **Bring-up (if in scope)**, **Day-N**, **Day-N (if in
  scope)** — plus a **bring-up gate at a glance** checklist (hardware, VLANs +
  MTU, TEP addressing, BGP/ECMP if Centralized, DNS A+PTR, NTP, binaries, jump
  host, AD, public URLs). Every section now states when it is needed, and the
  Network table gained a *When needed* column. The five planning CSVs
  (`ip-dns`, `vlan-subnet`, `ntp-ad-ca`, `bgp-peering`, `firewall-request`)
  gained the same **When needed** column with the identical vocabulary, so a
  filled template can be checked straight against the doc — and the
  firewall template's ad-hoc "Bring-up blocker if missing" notes are now a
  real column.
- Two placements corrected while marking: the **NSX Edge cluster** and the
  **vSAN witness** are built *after* bring-up (E6 / E7), so they are Day-N, not
  bring-up gates; the **Cloud Proxy, License Server and Identity Broker** ship
  *at* bring-up (the Identity Broker's *configuration* is what is Day-N).

## v1.6.4 — 2026-07-13
- **NSX connectivity is now per workload domain, and a Supervisor
  prerequisite** (#141). The export tool had one global connectivity select,
  but connectivity is a per-WLD choice (intake `H4`) — each WLD row now picks
  its own **Centralized** or **Distributed** model (seeded from the
  management domain's, which the top-level select now explicitly labels).
  With Supervisor enabled, that domain's connectivity story becomes its
  **explicit prerequisite** — the story spells out the concrete build
  (Centralized: Edge cluster + Tier-0 + BGP; Distributed: Distributed Transit
  Gateway + VNA) plus the Supervisor reservations (ingress/egress CIDRs, or
  the external IP block + the `/16` private transit-gateway block), and the
  enablement story points back at it by number. Intake `H5` no longer claims
  Supervisor "requires centralized edge gateway" (Distributed/VPC is a
  supported path); `prerequisites.md` leads its Supervisor checklist with the
  connectivity prerequisite. Scopes saved before this release load unchanged
  (each WLD inherits the old global value).
- **vSphere Supervisor prerequisites section** (#140). New
  `prerequisites.md` → *vSphere Supervisor (only if in scope)* — nothing in
  it is needed at bring-up, but activation asks for all of it at once and the
  workbook carries only three Supervisor fields. The checklist: **5
  consecutive control-plane IPs** (3 nodes + floating + upgrade spare),
  **API FQDN + DNS** (FQDN login required — new optional row in the Step 1
  DNS table), Service CIDR, the LB choice, per-networking-path inputs
  (**9.1 gotcha:** the VPC **private transit-gateway IP block must be a
  `/16`** — a `/24` worked in 9.0 but never completes in 9.1), DRS/HA +
  storage policies, Kubernetes content (air-gapped: offline content
  library), the routing matrix, and the 100 ms three-zone latency bound.
  Intake `H5`, the E9 docs section and the generated Supervisor story now
  point at it.
- **Per-WLD Supervisor load-balancer choice, with an Avi story** (#139). Each
  Supervisor-enabled workload domain in the export tool now picks its LB:
  **built-in NSX/VPC LB** (default), **Foundation Load Balancer**
  (platform-packaged L4 active/passive pair for VDS networking — adds a
  deploy step to the enablement story), or **Avi** — which generates its own
  story ahead of enablement: controller cluster **into that WLD** via VCF
  Operations (Avi **32.1.1+ binaries from the depot**, content library for
  Service Engine images), cloud connector per networking path (NSX Cloud
  with **VPC mode** under Distributed — SE mgmt overlay segment behind a
  Tier-1 with DHCP, VIPs from the VPC external IP blocks; NSX/vCenter cloud
  + VIP network/IPAM otherwise) and **min 2 Service Engines**, all **before
  Supervisor activation** per the Avi-for-VCF 9.1 requirements.
  `prerequisites.md`'s Avi section now carries the depot/content-library/SE
  bullets and the corrected placement (management domain for fronting
  Automation, the WLD for Supervisor); intake `H5` captures the choice.
- **VCF Automation HA does not require Avi/an external LB — fixed, and Avi is
  now its own story** (#138). The TechDocs design library (*VCF Automation
  Load Balancing Design*) is explicit: the **native load balancer** is
  automatically configured for **both** the single-node and HA models; an
  external LB is an **optional post-deployment addition** whose pool points
  at the native VIP (L4-only, so Avi in front adds SSL termination / keeps
  user access off the management network — Tom Fojta's *Load Balancing VCF
  Automation with Avi* confirms). The export tool/tracker's warning that an
  HA cluster "needs a load balancer — enable the Avi LB option" was wrong and
  is gone; the Avi choice now generates its own **Story 8.3 — Avi Load
  Balancer in front of VCF Automation** (controller cluster deploy + virtual
  service) instead of extra tasks inside 8.2. E8 renumbered: optional fleet
  components 8.3 → **8.4**, certificates/identity/licensing 8.4 → **8.5**
  (all cross-references updated; tracker progress files saved before this
  release may show E8 ticks one story off — re-tick after loading). Same
  correction in `06-deployment-plan.md`, intake `E16`, `prerequisites.md`
  (Avi section) and the Step 1 IP-count table.

## v1.6.3 — 2026-07-12
- **Manual transfer (no depot server) documented** (#137). VCF 9.1 supports a
  third way to feed binaries besides online/offline depot: run the VCF
  Download Tool on any internet-connected machine, `rsync` the depot store to
  the VCF Installer appliance and import it there with
  `vcf-download-tool binaries upload` — no web server to build. New
  `docs/08-backup-and-depot.md` §B.2 with the steps, the
  "manual ≠ hand-picked portal downloads" clarification, and the 9.1 Day-N
  caveat (patch binaries must additionally be side-loaded into the fleet
  Depot Service — beyond a lab/one-off, the offline depot stays the smoother
  setup). §B intro now lists three ways; old §B.2/§B.3 renumbered to
  §B.3/§B.4. Intake `G1` and the `prerequisites.md` depot bullets extended
  with the third option. Refs: TechDocs *Manually Transfer Binaries to VCF
  Installer*, William Lam's side-loading walkthrough.

## v1.6.2 — 2026-07-12
- **NSX Edge needs no separate depot binary — noted** (#136). New callout in
  `docs/08-backup-and-depot.md` §B: the depot has no NSX Edge bundle; the
  edge node OVA ships inside the NSX Manager appliance (`NSX_T_MANAGER`,
  part of the `--type INSTALL` set) and NSX Manager deploys the edge VMs
  itself, so an offline depot loaded per the guide already covers a later
  edge-cluster deployment. Day-N edge upgrades ride the NSX upgrade bundle
  (`--type UPGRADE`). Verified against the Broadcom edge-cluster
  prerequisites and William Lam's depot structure deep-dive.

## v1.6.1 — 2026-07-10
- **Coscia's VCF 9.1 Network Planner referenced** (#134). Leonardo Coscia
  published a new, separate tool:
  [vcfplanner.lcoscia.fr](https://vcfplanner.lcoscia.fr/) generates a starter
  VCF 9 network design — VLAN plan, appliance IPs + FQDNs, VIPs, validation,
  XLSX/JSON export — from a handful of inputs. It stands on its own next to
  his VCF Planner (vcfplann**ing**.lcoscia.fr — mind the near-identical URL).
  Added to the landing page's Related-tools grid and to
  `docs/01-network-dns-plan.md` as a generated starting point for Step 1
  (the sizing minimums, VM-Management carve-out and the
  network-team/architect hand-off still apply per row).

## v1.6.0 — 2026-07-10
- **Site search** (#132). New `/search/` page (linked in the header) with
  full-text search across docs, samples, and tool pages — powered by
  Pagefind: the index is generated from the built HTML at build time
  (`pagefind --site dist` appended to `npm run build`, so GitHub + GitLab
  Pages both get it) and runs fully client-side; no external service, no
  queries leave the browser. Indexing is scoped to page content
  (`data-pagefind-body` on `<main>`; TOC/pager chrome ignored).
- **Doc references are now links everywhere on the site** (#131). Two gaps:
  the export tool + tracker rendered doc mentions in story text, acceptance
  criteria and epic "Ref:" lines as plain text, and the doc/sample pages
  showed code-span references (`` `01-network-dns-plan.md` ``, ~85 of them)
  as unclickable code. Both now link to the rendered doc pages — the tools
  via their linkify, the markdown pages via a new rehype transform that
  wraps known doc filenames (skips code blocks and existing links). The
  Markdown/CSV exports keep plain filenames (presentation-only change).
- **Docs/samples: back-to-top link on every H2 section** (#133). Appended at
  render time (rehype), styled as a small right-aligned "↑ Top" affordance,
  excluded from the search index.
- **Stray ITQ bullet squares fixed** (spotted while reviewing #133): the ITQ
  token stylesheet draws a brand square on every `ul > li::before`, which
  leaked into the inline chip lists — the docs' "On this page" TOC and the
  new search results. Both now opt out.

## v1.5.9 — 2026-07-10
- **docs 03: witness-appliance deploy gotchas** (#130, field-verified on a
  real 9.1 stretched deployment). The witness OVA cannot be deployed via the
  ESXi Host Client (`Invalid qualifier: ValueMap{"Management", "Secondary"}`
  — standalone-host deploys don't support the OVA's deployment options / OVF
  properties); use a vCenter, `ovftool` or `govc`. And **whatever the deploy
  method** — even via vCenter with properties filled — verify the witness's
  management + witness/vSAN VMkernel gateways afterwards; the 9.1 OVA came up
  with wrong gateways and they had to be fixed by hand.

## v1.5.8 — 2026-07-10
- **Identity Broker is a bring-up component, not Day-2** (#129,
  field-verified on a real 9.1 deployment): the broker deploys automatically
  with the VCF Management Services — no opt-in; only its **configuration**
  (AD binding / fleet SSO) and additional instances are Day-2. Framing fixed
  across: `docs/05` (D1 answer + deployable-set table), `docs/06` (Day-2
  scope block, E8 intro, stories 5.4 / 6.3 / 8.3 / 8.4),
  `docs/prerequisites.md` (identity-source intro), `workbook-cell-mapping.md`
  (C3), and the **export tool** — story 8.3 no longer "deploys" the broker,
  8.4 says configuration-not-deployment, and the scope checkbox is now
  "Fleet SSO via the Identity Broker (configure the bring-up broker)" tagged
  E8.4. (`docs/04-sizing.md` already said "additional-instance only".)

## v1.5.7 — 2026-07-10
- **ntp-ad-ca-plan template: CA enrollment service account row added** (#128).
  The CA block captured type / server / template / signing approach but not
  the **least-privileged service account** the Configure-CA-for-Fleet wizard
  authenticates with on a Microsoft CA — even though `docs/prerequisites.md`
  lists URL + account + template as the wizard's "have ready" trio. The *CA
  server or URL* example now shows the `/certsrv` Web Enrollment form with
  the Basic-authentication note; the new row flags that the OpenSSL CA type
  needs no account at all.

## v1.5.6 — 2026-07-10
- **docs 08: Windows OpenSSH SFTP-target subsection** (#127). A.3 named
  "Windows Server with OpenSSH Server" as a valid backup target but only
  detailed the Linux chroot build. New *Windows Server variant* subsection:
  capability install + `sshd` service to Automatic (install alone doesn't
  survive a reboot), firewall-rule check, non-admin service account with
  password auth, the `/C:/vcf-backups` Unix-style path gotcha, the stock
  `Match Group administrators` / `administrators_authorized_keys` quirk,
  chroot via `ForceCommand internal-sftp`, host-key re-confirmation after a
  rebuild, and pre-registration validation steps.

## v1.5.5 — 2026-07-10
- **ip-dns-plan template: *Provided by* teams aligned with the VLAN-plan flow**
  (#125). The column mixed Network (ESXi hosts), Architect (appliances) and
  Platform (Day-2 fleet) even though every FQDN + IP on the sheet is assigned
  the same way: the network team provides the subnets/ranges (captured in
  `vlan-subnet-plan.csv`), the architect assigns each address from them. All
  rows now read *Architect* and the column header spells out that flow (and
  that the AD/DNS team creates the A + PTR records). `docs/prerequisites.md`
  now lists the hand-off order explicitly: Network team fills the VLAN plan →
  Architect assigns FQDNs/IPs from it → AD/DNS team creates the records.
- **vlan-subnet-plan template: *Minimum IPs needed* column added** (#126).
  The per-network sizing guidance from `docs/01-network-dns-plan.md` (1 per
  host for mgmt/vMotion/vSAN, hosts x pNICs for host overlay, 2 per edge
  node for edge overlay, ~30-48 + a /28-/27 services-runtime block for VM
  Management) now travels with the CSV itself, so a downloaded template is
  self-explanatory. Template descriptions in `docs/prerequisites.md` synced.
  Both changes from field feedback by Jeroen Buren.

## v1.5.4 — 2026-07-09
- **Tracker: export buttons fixed** (#124). Copy Markdown / Download .md /
  Download CSV on the Deployment Tracker rendered but did nothing — their
  click handlers were never wired when the tracker split off the export
  page. Now wired to the status-bearing exports.

## v1.5.3 — 2026-07-09
- **Docs synced with the new Deployment Tracker** (#123). README contents
  table gains the `plan-tracker.astro` row (missed in the #121 merge —
  pre-commit checklist item 2), `docs/06-deployment-plan.md` now links the
  tracker next to the export tool at the top, and CLAUDE.md's `web/` layout
  row names all three interactive tools.

## v1.5.2 — 2026-07-09
- **New tool: Deployment Tracker** (#121). A dedicated page
  (`tools/plan-tracker/`) for the execution side of the plan: a checkbox per
  story, per-epic counters + progress bars, and an overall progress header.
  The scope follows what you set in the export tool (shared via
  localStorage — the tracker has no scope controls of its own); progress
  persists in the browser and travels as a JSON file that **carries scope +
  ticks together** (*Save/Load progress* — keep it with the customer's files,
  not in a repo); *Reset* needs a confirm click. The tracker's exports carry
  the state: Markdown as a GitHub-flavored task list (`- [x]` with done-dates
  and per-epic counts), CSV with `Status` + `Done On` columns. The export
  tool itself stays a pure scope-builder/exporter (its stored scope now also
  survives reloads); its Markdown gains `- [ ]` task-list syntax and the CSV
  the (empty) `Status`/`Done On` columns for a consistent schema.
- **Export tool: stale Day-2 framing fixed** (#122, follow-up to #118). The
  scope checkbox now reads "Day-2 fleet (Automation / Logs / Networks /
  Identity Broker)" (Operations removed), and story 4.3's DNS acceptance
  (doc + tool) lists the bring-up FQDNs (VCF Operations nodes + optional LB
  VIP, Cloud Proxy, License Server, VCF Management Services fleet / instance /
  identity broker / services runtime) instead of counting VCF Operations
  among the Day-2 appliances.

## v1.5.1 — 2026-07-09
- **Stretched management domain: Edge cluster order is a choice, not a
  constraint** (#120). TechDocs-verified both ways: the stretch spec carries
  `isEdgeClusterConfiguredForMultiAZ` (stretching a cluster that already hosts
  edges is a first-class path), and *"VCF 4.5 and later support deploying an
  NSX Edge cluster on a vSphere cluster that is stretched"* (new edge nodes
  land on AZ1 hosts). Noted in 03 §D and the E7 epic (doc + export tool),
  with the flag called out in story 7.4. Also sharpened: the stretch
  operation is **SDDC Manager API-only** (validate + `PATCH
  /v1/clusters/{id}`; no UI workflow) — 03 intro + story 7.4.

## v1.5.0 — 2026-07-09
- **Bring-up wizard corrections + enrichment from a 9.1 Installer walkthrough**
  (#119, follow-up to #118; source: vstellar.com part 5, all 29 wizard screens
  reviewed). Story 5.3 deferral claim refined: **VCF Automation** defers
  *indefinitely*; **VCF Operations** (+ Automation, cloud proxy, license
  server) defers only *short-term* via the *Management Components Custom
  Networking* toggle, deployed afterwards through the wizard's third path
  (*Deploy deferred components*) — 05 §C notes the Installer exposes the same
  placement choice. Story 5.2: running the Installer outside the management
  domain deploys a **separate new SDDC Manager appliance** (extra FQDN + IP).
  Story 5.3 color: milestone sequence, ~4–6 h duration, 20% headroom warning,
  auto-generated passwords (*Review Passwords*), re-uploadable JSON spec;
  licenses due within the **90-day evaluation period** (5.4). Installer input
  caps documented in 01 + intake C7/C10: **max 2 DNS / 3 NTP servers**.
  Prereq NIC row: default profile = one NSX-enabled vDS for all traffic;
  custom switch config supports **VDS LAG**. Export tool mirrors 5.2–5.4.

## v1.4.9 — 2026-07-09
- **Story 5.4 corrected: VCF Management Services, License Server & Cloud Proxy
  ARE deployed at bring-up** (#118). Lab-verified against the 9.1 Installer
  wizard + TechDocs: a unified Cloud Proxy is *"configured by default by the
  VCF Installer"*, a License Server is *"automatically deployed as part of the
  installation"*, and VCF Management Services deploys with the instance — the
  manual deploy procedure applies to the 9.0 → 9.1 **upgrade** path only.
  Story 5.4 (doc + export tool) is now a *verify* story; 05's decision gate and
  deployable-set rows mark Cloud Proxy / License Server as bring-up (Day-N =
  additional appliances only); 07 §E flows flagged as pre-bring-up. Story 5.3's
  "only VCF Automation can be deferred" confirmed correct (the Installer's
  VCF Operations option is connect-to-existing, not a deferral).

## v1.4.8 — 2026-07-08
- **Site: "On this page" section index on every doc page** (#117). The intake
  (and any other long doc) now opens with a clickable chip list of its `##`
  sections — built in the shared docs template from Astro's heading anchors,
  so all docs get it for free; anchor targets carry `scroll-margin` so
  headings land clear of the sticky header. Shown only when a doc has more
  than two sections.

## v1.4.7 — 2026-07-08
- **Intake F: per-component password requirements table** (#116). The old
  two-line blanket policy ("min 15, upper/lower/digit/special") contradicted
  TechDocs in places — the vCenter SSO administrator has **no uppercase
  requirement** (8–20), ESX root is 7–40 with 3-of-4 classes, vCenter root
  maxes at 20, SDDC Manager has two distinct rules (admin@local 15–127 +
  no triple-repeats; vcf/root/backup min 12 + no dictionary words), NSX is
  12–128. Replaced with the verbatim-verified table, the cross-component
  special-character set (`! @ # $ ^`), and a practical one-pattern tip
  (15–20 chars, all four classes) that satisfies every minimum.

## v1.4.6 — 2026-07-08
- **Edge TEP allocation detail added** (#115). The workbook's *Create an NSX
  Edge Cluster* section allocates edge TEPs as an **IP Pool (start–end)** or a
  **per-node static list** — **2 TEP IPs per edge node**, no DHCP option
  (DHCP exists only for the Host Overlay). Added the sizing/mode note to the
  vlan-subnet template's Edge Overlay row, intake `B9`, and the docs/01 §A
  pool table (example right-sized to `.11–.14` for a 2-edge cluster).

## v1.4.5 — 2026-07-07
- **VCF Operations floating-IP claim removed — no such mechanism exists**
  (#114, flagged by Paul). TechDocs (verbatim) says only *"Supports an
  optional external load balancer"* for both HA and Continuous Availability
  models — no floating IP, failover, or cluster address anywhere (the only
  "Cluster VIP" on that page is Log Management's integrated LB, the likely
  source of the confusion); the workbook likewise carries just an optional
  *Load Balancer FQDN*. Corrected everywhere to the real model — **node FQDNs
  directly, or an optional external-LB VIP**: `05-day2-deployments.md` §B.1,
  intake `E9`, `06-deployment-plan.md` + the interactive deployment-plan tool,
  `prerequisites.md`, the ip-dns-plan template row, and the "VCF Operations
  VIP" rows in the docs/01 + Rainpole-sample DNS tables (now marked
  optional / external-LB only).

## v1.4.4 — 2026-07-07
- **vlan-subnet-plan template: IP range (from - to) column added** (#113).
  Bring-up assigns per-host vMotion and vSAN VMkernel IPs from mandatory
  contiguous ranges (workbook: IPv4 address Range From / To; intake `B6`/`B7`)
  and the Host/Edge Overlay TEPs use IP pools (`B8`/`B9`) — the template now
  captures those next to the DHCP column, with per-row range examples
  (1 IP per host; TEP `nodes × pNICs`) and "n/a" guidance for the
  discrete-IP networks (ESX/VM Management, uplinks).

## v1.4.3 — 2026-07-07
- **FQDN once-over vs TechDocs + workbook: Avi and Ops for Networks
  overstated, fleet/instance components missing** (#112). Verified verbatim
  against the TechDocs FQDN/IP list and the pinned v1.9.1.001 workbook:
  **Ops for Networks** platform + collector need **IPs only** (TechDocs: FQDN
  N/A; workbook asks VM name + IP) and **Avi** needs exactly **one cluster
  FQDN** (workbook Avi section: node 1–3 + VIP are IP-only fields). Dropped
  those FQDN rows from `ip-dns-plan.csv`, the docs/01 A+PTR table and the
  Rainpole sample; added the required-but-missing **fleet components** and
  **instance components** records (lowercase family) everywhere. Intake
  `E14`/`E16` corrected; the mapping's false "no Avi input fields" claim
  replaced with the real *AVI Load Balancer {SDDC}* section mapping.

## v1.4.2 — 2026-07-07
- **ip-dns-plan template: the v1.4.1 VCF Automation services-runtime row
  removed again** (#110). Automation's own services runtime is a hidden /
  internal component — it does not have or need an FQDN, despite the workbook
  carrying a same-labelled field with a rainpole example for it. The DNS list
  keeps only the **fleet** services-runtime record (`sfo-m01-svcs01`, E14,
  example IP back to `.27`).

## v1.4.1 — 2026-07-07
- **ip-dns-plan template: VCF Automation services-runtime record restored**
  (#110, completes the #111 disambiguation). Automation's **own** services
  runtime gets back its own DNS row — `sfo-m01-autosr01` (E10; nodes from the
  Automation `/29` range) — next to the appliance row, distinct from the
  fleet-runtime row (`sfo-m01-svcs01`, E14, example IP shifted `.27` → `.28`
  to keep the examples monotonic).

## v1.4.0 — 2026-07-07
- **Intake + mapping: the two same-named "VCF services runtime FQDN" fields
  disambiguated** (#111, follow-up to #110). Verified against the pinned
  v1.9.1.001 workbook: *Deploy Management Domain* carries the identical field
  label twice — the **fleet** management-services runtime (under *VCF
  Management Services* → intake `E14`) and Automation's **own** services
  runtime (under *VCF Automation* → intake `E10`, nodes from the `B5` `/29`
  range). Intake `E10`/`E14` and the three mapping rows now say which is which
  and cross-reference each other.

## v1.3.9 — 2026-07-07
- **ip-dns-plan template: services-runtime row decoupled from VCF Automation**
  (#110). The two example FQDNs are now independent — `sfo-m01-auto01` for the
  Automation appliance, `sfo-m01-svcs01` for the services-runtime (no shared
  stem, no legacy `vra` naming) — and the services-runtime row now reads
  *Fleet management-services runtime* with intake ID **E14** (was "Automation
  runtime nodes" / E10): the two components are not related.

## v1.3.8 — 2026-07-05
- **Workbook unhide recipe documented** (#109). CLAUDE.md *Workbook handling*
  now carries the verified PowerShell recipe for the 13 hidden tabs: the 9.1
  workbook's structure protection is password-protected (SHA-512 hash), so
  the Excel Unhide UI is a dead end — strip the `workbookProtection` element
  and flip sheet states on a **copy** via direct XML edit.

## v1.3.7 — 2026-07-05
- **Host Overlay TEP + Binaries prereq once-over vs the reference workbook**
  (#108). All TEP claims verified (DHCP-optional row, `nodes × pNICs` sizing
  rule, the *Deploy Management Domain* IP-Pool sample); the *Create a New
  Workload Domain* citation upgraded **9.0 → 9.1** (verified live, same
  prerequisite sentence). Binaries section verified clean — no changes.

## v1.3.6 — 2026-07-05
- **AD + Identity Broker prereq once-over vs the reference workbook** (#107).
  The pre-create bullet now names the actual 9.1 account set (vSphere / NSX
  bind accounts, Identity Broker bind account, admin groups → VCF roles,
  intake section C) instead of deferring to the workbook's *Active Directory
  Inputs* tab — that tab is **hidden** in v1.9.1.001 and still carries
  VCF 4.x/5.x-era content (Workspace ONE Access / Aria Suite Lifecycle groups,
  `VMw@re1!` reference passwords); a gotcha note demotes it to a `svc-*`/`gg-*`
  naming-convention reference. The two identity-provider TechDocs links are
  annotated as deliberately 9.0 (verified: the 9.1 doc set doesn't republish
  the SSO section), and the Identity Broker pointer sharpened to E8 stories
  8.3 / 8.4.

## v1.3.5 — 2026-07-05
- **CLAUDE.md: Pages-deploy retry cap** (#106). New "CI / Pages deploys"
  section — the transient *"Deployment failed, try again later"* recovery is
  `gh run rerun --failed`, capped at **3 retries**, then stop and inform Paul.

## v1.3.4 — 2026-07-05
- **Jump host expanded into a tooling checklist** (#105). Placement warning
  (must survive independently of the platform it deploys), plus the practical
  kit: browser, OVF Tool, SSH client (PuTTY / built-in OpenSSH), SFTP/SCP
  client (WinSCP), PowerShell 7 + VCF PowerCLI (custom ESX ISO per TechDocs,
  linked), Excel, and DNS/NTP verification tools run from the same network
  vantage point the appliances will use.

## v1.3.3 — 2026-07-05
- **CA + SFTP prereq once-over vs the reference workbook** (#104). All four
  cert/SFTP TechDocs links upgraded **9.0 → 9.1** (verified live) and the
  "docs lag the 9.1 UI" caveat dropped. CA section gains the have-ready
  wizard inputs (CA server URL `…/certsrv`, least-privileged service account,
  issuing certificate template) and links the four-step *Prepare Your
  Microsoft CA* walkthrough. SFTP consumer list broadened per the 9.1 docs —
  VCF Automation plus the VCF management services (Log Management, Identity
  Broker, Software Depot, fleet/SDDC lifecycle, real-time metrics, Salt) —
  with a note that the workbook's own SFTP row (NSX + SDDC Manager via SDDC
  Manager) is stale in 9.1.

## v1.3.2 — 2026-07-05
- **DNS / NTP / SMTP prereq once-over vs the reference workbook** (#103). DNS
  gains the **uniqueness** rule (every FQDN → unique, unassigned IP) and the
  **lowercase-FQDN** pointer (per #96, detailed in `01` §C), and names the
  real 9.1 sheets (*Deploy Management Domain* / *Deploy Workload Domain* /
  *Deploy Cluster*) instead of the workbook prose's stale "Creation Tabs".
  NTP absorbs the dispersion rule (sources synced to different upstreams) and
  the optional `ntp0`/`ntp1` records, plus a source footer (workbook +
  TechDocs *Configure NTP on the ESX Hosts*). SMTP now names its consumer —
  VCF Operations' outbound Standard Email plug-in — with the TechDocs
  plug-in page linked.

## v1.3.1 — 2026-07-05
- **Network prereq once-over vs the reference workbook** (#102). BGP and ECMP
  rows now scoped to **NSX Centralized Connectivity / Edge clusters** (intake
  `A10`) — the Distributed model needs no BGP peering, matching how the
  stretched row and `01` §B already model it. Overlay MTU row gains the
  TechDocs 9.1 values (**1600 minimum, 1700 recommended, ≥ 9000 optimal**)
  with the *MTU guidance* page linked. Every table row now carries a
  reference: TechDocs 9.1 links on MTU / BGP / vDS teaming, plus a source
  footer anchoring the rest on the workbook's *Prerequisite Checklist*.

## v1.3.0 — 2026-07-05
- **Hardware prereq once-over vs the reference workbook** (#101). Host-count
  minimum now matches the *Prerequisite Checklist*: **2** (Simple, NFS/FC) /
  **3** (Simple, vSAN) / **4** (High Availability — the production baseline),
  with the 16 host slots moved to Notes. NIC row rewritten: 2× pNICs is the
  normal route (Installer vDS Default profile = 2 uplinks), single-pNIC
  bring-up is **API-only** per the workbook (TechDocs *Commission Hosts*
  linked), and 25 GbE for vSAN-ESA is **recommended**, not a minimum. Added
  the no-existing-partitions and single-hardware-vendor gate checks. Fixed the
  Workload Domain blockquote that misattributed the ≥ 10 GbE / VCG
  requirements to the *Preparing ESX Hosts* TechDocs page (they come from the
  workbook), and moved the 64-pNIC VI-WLD note into the WLD section.

## v1.2.9 — 2026-07-04
- **Authoritative depot-registration doc linked** (#100). `08` §B.1 step 4 now
  anchors on TechDocs *Software Depot Registration in the VCF Business
  Services Console* — from 9.1, whatever connects to Broadcom for binaries
  (Installer / depot / Download Tool) must be registered there — plus
  KB 399124 for the activation-code-not-generated failure. §B.3 references
  regrouped under "Registration / credentials".

## v1.2.8 — 2026-07-04
- **Licensing vs. depot activation code disambiguated** (#100). `08` §B.1's
  credential note now warns the VCF Operations *licensing* activation code
  (registers with `vcf.broadcom.com` for the single fleet license file) is a
  **separate credential** from the depot-download one, citing the VMware blog
  *Licensing in VMware Cloud Foundation 9.0* (Hah & Gleed) — also added to
  §B.3 references.

## v1.2.7 — 2026-07-04
- **Workbook-writer idea retired** (#99). Issue #1 (`Write-VCF9Workbook.ps1`,
  stamp intake answers into the workbook) closed as not needed — Coscia's
  planner covers the transfer step. Stale pointers cleaned: `CLAUDE.md`
  `tools/` row + scripts note, and the mapping doc's named-range intro now
  addresses anyone scripting against the workbook instead of promising a
  future writer tool (the named-range map itself is unchanged — it still
  serves VCF.JSONGenerator users).

## v1.2.6 — 2026-07-04
- **Download-credential prep documented** (#98). `08` §B.1 step 4 now walks
  the activation-code flow (software depot ID via
  `vcf-download-tool configuration generate`, then the VCF Business Services
  console), notes the **token → activation-code transition** (tokens per
  KB 390098 still work in 9.1), and flags the **Product Administrator role**
  requirement — arrange the credential days ahead, not minutes. Role gotcha
  also added to the `prerequisites.md` online-depot bullet; §B.3 references
  gain KB 390098, KB 443322 and William Lam's VCFDT cheatsheet.

## v1.2.5 — 2026-07-04
- **vCenter file-based backup is manual — noted everywhere it matters** (#97).
  Setting the fleet SFTP target does **not** configure vCenter backups: each
  vCenter's schedule/target/retention is set per instance in its own
  management interface (VAMI, `:5480`). Added as a callout + table note in
  `08-backup-and-depot.md` §A.1, and folded into deployment-plan story 6.4
  (doc + export tool) with per-vCenter acceptance.

## v1.2.4 — 2026-07-04
- **New reference doc `08-backup-and-depot.md`** (#97, #98) — build guide for
  the two pieces of your own infrastructure VCF depends on: **§A SFTP backup
  target** (what backs up and how often, the propagate-to-fleet and
  encryption-passphrase gotchas, placement, a hardened chrooted-OpenSSH worked
  example) and **§B offline depot / VCF Download Tool** (depot web server
  requirements, auth split incl. the hardcoded `umds-patch-store` name,
  activation-code prep, `vcf-download-tool` commands, transfer + connect
  steps, and using the tool standalone to pre-stage binaries). TechDocs +
  community-walkthrough references throughout.
- `prerequisites.md`: the **SFTP** and **Binaries** gate sections tightened
  and expanded in place — SFTP gains the fleet-components scope, SSH-key
  support, passphrase custody and placement bullets; Binaries now spells out
  the online vs offline depot decision (`G1`–`G4`). Both link to `08` for the
  build detail.
- New doc wired into the README contents table, `CLAUDE.md` layout, and the
  site nav (`web/src/nav.ts`, Reference section).

## v1.2.3 — 2026-07-04
- **Lowercase-FQDN requirement absorbed from the TechDocs asterisks** (#96).
  The FQDN/IP page marks the fleet-services family — VCF Automation, VCF
  services runtime, fleet components, instance components, Identity Broker,
  Log Management, real-time metrics — with *"Do not use capital letters in
  the FQDN."* Now: a **Lowercase only** warning under `01`'s A+PTR table
  (practical rule: create every VCF FQDN lowercase), a DNS-checklist item,
  "(lowercase)" tags on intake `E10`/`E14` and the four affected IP/DNS CSV
  rows.
- **Automation `/29` breakdown made exact** (#96). TechDocs: **3 node IPs +
  2 buffer** for automatic redeploy / rolling updates — replaced the "5 IPs
  used + buffer" wording in `01` and the Rainpole sample.

## v1.2.2 — 2026-07-04
- **"VCF Operations for Logs" → "Log Management" everywhere** (#95 — 9.1
  renamed the component). Renamed in the `01` carve-out + DNS rows, the `05`
  component row (keeps one "formerly VCF Operations for Logs" parenthetical)
  and don't-confuse note, intake `A17`, the Rainpole sample, the IP/DNS CSV
  row, and two sizing-engine comments. The workbook mapping row now uses the
  Day-N sheet's actual 9.1 section label **"Deploy Log management"** —
  verified against the pinned v1.9.1.001 workbook, which still carries a
  legacy "Deploy VCF Operations for Logs" TechDocs-link cell on that sheet
  (noted in the mapping).

## v1.2.1 — 2026-07-04
- **Public URLs absorbed as a prereq layer** (#94). The TechDocs *Public URLs
  Required for Online Functionalities* page (8 destinations, all outbound
  TCP 443, per-row source components) is now in the flow:
  `prerequisites.md` gains a **Public URLs (online functionality)** section —
  the full URL/purpose/source table, proxy-allowlist guidance, and the
  air-gapped note (only the **VCF Download Tool** host needs the access);
  `07` gains **A.1 Outbound public URLs** with the flows grouped by source;
  intake `G` gets a pointer note tying `G1`/`G5` to the allowlist; and the
  firewall-request CSV template gains the consolidated outbound-443 row.

## v1.2.0 — 2026-07-04
- **Correction: Log Management / real-time metrics IPs come FROM the
  services-runtime block** (#93). v1.1.9 claimed the Day-N Logs worker IPs
  land *outside* the `/28` block — the TechDocs FQDN/IP page's own note says
  the opposite: *"The IP addresses for the log management and real-time
  metrics components are allocated from the IP block for VCF services runtime
  nodes."* The row counts stand (Logs: 1 FQDN + 6 IPs, +2 per replica;
  metrics: 6 IPs), but they consume the runtime block — which is exactly why
  `/27` is the recommended block size. Corrected the `01` carve-out rows +
  total note (runtime-block row now names the Day-N headroom), the `05`
  Ops-for-Logs row, the Rainpole sample (dropped the bogus `.80–.86` /
  `.90–.95` reservations; `/28` row notes the `/27` upgrade path), and the
  CSV template row.

## v1.1.9 — 2026-07-03
- **Carve-out sweep — the remaining Day-N components** (#93, extending #90 to
  everything on the TechDocs FQDN/IP list). The `01` VM Management carve-out
  gains **VCF Operations for Logs** (integrated VIP + 6 services-runtime
  worker IPs outside the `/28` block, +2 per extra replica), **real-time
  metrics** (6 worker IPs), and an **Identity Broker** clarity row (FQDN only —
  IP from the services-runtime block); the total row now flags ~20 optional
  IPs. The `01` DNS minimum table adds the missing **required** records —
  Ops analytics nodes 1–3, Cloud Proxy, License Server, Identity Broker —
  plus the optional Ops-for-Logs VIP. Rainpole sample and the IP/DNS CSV
  template extended to match; `05`'s Ops-for-Logs row now carries the same
  worker-IP math.

## v1.1.8 — 2026-07-03
- **Operations for Networks in the Rainpole sample too** (#90 follow-up). The
  sample's VM Management carve-out gains the optional Day-2 row (platform
  `.77` + collector `.78`, reserve 2 more for a Large 3-node platform) and the
  DNS table the matching records — fleet-style `flt-opsnet01.rainpole.io` for
  the platform, site-local `sfo-opsnetc01.sfo.rainpole.io` for the collector.
- **CI: deploys now trigger on `samples/**` and `CHANGELOG.md`** (#92). The
  site renders the samples and reads the version badge from the changelog at
  build time, but neither path triggered a deploy — a samples-only push left
  the live site silently stale. Both the GitHub workflow and `.gitlab-ci.yml`
  gained the two paths.

## v1.1.7 — 2026-07-03
- **Internal-CIDR note in `01` now covers VCF Automation too** (#91). The
  note under the VM Management carve-out attributed the internal
  `198.18.0.0/15` CIDR (alternatives `240.0.0.0/15` / `250.0.0.0/15`) to the
  VCF services runtime only; VCF Automation's **cluster CIDR** is the same
  kind of internal, non-routed range with the same default and alternatives
  (intake `B21`, `05` section D) — the note now says so.

## v1.1.6 — 2026-07-03
- **VCF Operations for Networks added to the VM Management carve-out** (#90).
  The `01` carve-out table never accounted for the Ops-for-Networks platform +
  collector nodes, which land on the VM Management subnet when the Day-2
  placement is the Shared Management Network. Now: an optional carve-out row
  (2 IPs, +2 when a Large platform runs as a 3-node cluster) with the total
  row's headroom note extended, two optional A+PTR rows in the `01` DNS table,
  intake `E14` names the platform + collector in the fleet-FQDN list, and the
  IP/DNS CSV template gains the two matching optional rows (same pattern as
  the #85 Avi rows). The Day-N sheet mapping row already existed in
  `workbook-cell-mapping.md`.

## v1.1.5 — 2026-07-03
- **Generic wording pass — no more consultant-for-customer framing** (#89,
  filed via the site's Feedback button). All public-facing prose now addresses
  the reader directly as the team planning its own deployment: docs `01`–`07`,
  `prerequisites.md`, `workbook-cell-mapping.md`, the Rainpole sample, README,
  the site (hero, nav blurbs, sizing footer) and the deployment-plan export
  tool (E4 owner "Architect + infrastructure teams", handover story now hands
  over to the operations team). The NTP/AD/CA CSV template's "Provided by"
  column says `Network team` / `AD team` / `PKI team` instead of `Customer / …`.
- **Renamed `docs/02-customer-intake.md` → `docs/02-intake.md`** (#89). Page
  title is now "Step 2 — Intake (role-based)"; intake IDs (`A1`–`G…`) and the
  workbook mapping are unchanged. All cross-links, the nav slug/label, README
  and CLAUDE.md updated; the old site URL `/docs/02-customer-intake/` keeps
  working via a static redirect page.

## v1.1.4 — 2026-07-03
- **Site version in the footer + always-present Feedback button** (#87). The
  sticky footer now shows the current release version (read at build time
  from this changelog's top entry — no second version constant to bump),
  linking to the changelog on GitHub. Next to it an orange **Feedback**
  button, visible on every page, opens a pre-filled GitHub issue form
  (`.github/ISSUE_TEMPLATE/site-feedback.yml`, new `site feedback` label)
  with the current page and site version filled in.
- **CLAUDE.md: repo is public, not private** (#88). The header GitHub line
  and the remotes table still described the repo as private; corrected both.

## v1.1.3 — 2026-07-03
- **Supervisor does not require Avi — corrected** (#86, revising the #70-era
  wording; lab-verified). vSphere Supervisor needs **a load balancer** before
  activation, and **Avi is one option** — the NSX / VPC networking paths'
  built-in load balancer and the **Foundation Load Balancer** work without
  Avi. Reworded the hard "Avi required" claim in `06` (E9 Supervisor
  paragraph), the export tool (Supervisor story + WLD hint), the
  `prerequisites.md` Avi section ("needed when **Avi is the chosen LB**"),
  intake `E16`, and the `01` carve-out row.

## v1.1.2 — 2026-07-03
- **Avi Load Balancer prerequisite layer, end-to-end** (#85). The plan
  required the Avi controller cluster (Supervisor activation, Automation HA)
  without ever capturing what Avi needs. Now: `prerequisites.md` gains an
  **Avi Load Balancer** section (when it's needed, 3 controller nodes +
  cluster VIP on VM Management with A+PTR, size tiers Small/Large/XLarge, the
  two break-glass passwords, TechDocs deploy link — and the note that the
  workbook has **no Avi input fields**, sizing rows only); `01` adds the
  4-IP carve-out row + DNS records; intake gains **E16** (size, nodes, VIP)
  and **F11** (password owners) with explicit no-workbook-field mapping rows;
  `07` adds the curated flows (controller UI/API 443, SE↔controller 8443);
  the IP/DNS CSV template gains the four optional Avi rows; and the
  deployment plan's 4.3 acceptance + 8.2 Avi task (doc + export tool) point
  at the new prereqs.

## v1.1.1 — 2026-07-03
- **Versioning rule clarified + changelog renumbered** (#84). The max-10 cap
  (`.0`–`.9`) applies to **every** version component, not just the patch:
  after minor `.9` the **major** rolls (`0.9.9` → `1.0.0`, never `0.10.0`).
  Renumbered accordingly: `0.10.0`–`0.10.9` → **`1.0.0`–`1.0.9`**, `0.11.0` →
  **`1.1.0`**. `CLAUDE.md` rule wording updated. (Precedent: #28.)

## v1.1.0 — 2026-07-03
- **Full repo sweep — fixes from the three-reviewer audit** (#79–#83; minor
  rolled because 1.0.x reached `.9`):
  - **Changelog repair (#80):** reinserted the `v1.0.3` heading that the
    v1.0.4 edit had consumed (the Stage-4 bullets were merged into v1.0.4).
  - **Docs corrections (#79):** `06` — dangling "E8 8.5" → **8.4**, and the
    stretched-Edge note now points at `03` §D (E7 never covered it); `05` —
    ambiguous "(E5)" now says *deployment-plan epic E5*, the §B VCF Operations
    row is qualified as **reuse/additional-instance only**, and the fifth
    (Federation) network model links the design-library page instead of a
    non-existent `03` section; `03` — inter-AZ bandwidth now leads with the
    design library's **≥10 Gbps** figure and M3 uses the **<5 ms** form;
    mapping — added the missing **A15** and **C4** rows; README — refreshed
    the export-tool description; `prerequisites` — templates Intake-ID claim
    scoped to the IP/DNS CSV, and the mgmt **host count now follows the
    workbook** (4–16 slots, sizing sheet computes the minimum, baseline 4);
    `01` — NTP table row IDs renamed (`A-1`/`CN-1`…) so they can't be misread
    as intake IDs.
  - **Rainpole sample rework (#81):** links now use `../docs/` (and the site's
    link rewriter accepts that form); the ESX-Management row no longer claims
    the VCF Installer lives there; the reserved blocks are **CIDR-aligned**
    (runtime `.32–.47` = /28, Automation `.56–.63` = /29, avoiding the
    analytics IPs); added the missing row 12, the License Server IP + FQDN,
    and demoted the duplicate "## A." carve-out heading.
  - **Export-tool fixes (#82):** `esc()` escapes double quotes (WLD names with
    `"` no longer break the row markup); `linkify` keeps trailing punctuation
    outside the anchor (the 9.5 stretch ref rendered a broken URL); the lib's
    Centralized 6.1 carries the stretched-Edge note; WLD default names use a
    counter (no more duplicate `wld02` after remove+add); `csvCell`
    neutralizes formula-leading characters; em-dash sweep over the tool's
    chrome + the VCFHostPreparation index card (ITQ web convention).
  - **Sizing tool + CI (#83):** `sanitize()` now allow-list-validates the
    top-level enum fields (crafted imports/share hashes can't produce NaN
    totals); GitLab CI aligned to **Node 22** to match GitHub Actions.

## v1.0.9 — 2026-07-03
- **Export tool: optional Day-2 fleet components are individually selectable**
  (#78). Three new checkboxes under the Day-2 block — **Log Management**,
  **Operations for Networks**, **Identity Broker** (all on by default,
  matching previous output). Story 8.3 lists only the selected components and
  disappears when none are selected. Knock-on: with the **Identity Broker out
  of scope** (unticked, or no Day-2 fleet at all), **E6 6.3 becomes the
  identity path** (bind vCenter SSO to AD/LDAP, with acceptance) and **8.4
  drops the broker-based fleet SSO** from its tasks + acceptance. `docs/06`
  story 8.3 renamed *Optional fleet components* with a note on the behaviour.

## v1.0.8 — 2026-07-03
- **Export tool: workload domains are now truly optional** (#77). The remove
  button no longer locks at one WLD — deleting the last one yields a
  management-only scope (no E9 epic; label "management + Day-2 fleet"), with
  an empty-state hint in the list. Lede + hints updated to say zero WLDs is a
  valid scope.

## v1.0.7 — 2026-07-03
- **TechDocs references in the deployment plan** (#76). The export tool's
  generated stories (preview / Markdown / CSV) now carry authoritative
  Broadcom TechDocs links, mirrored in `docs/06-deployment-plan.md`: host prep
  (4.1, 5.1), the VCF Installer appliance (5.2) + deployment wizard (5.3),
  Centralized **and** Distributed connectivity setup (6.1), file-based backups
  (6.4), witness deployment (7.3, 9.4), fleet-networking design models +
  custom-networking deployment (8.1), Configure a CA + Identity Provider
  (8.4), and the vSphere Supervisor platform (Supervisor story). All URLs
  liveness-verified; a full-scope export now carries 15 TechDocs links.

## v1.0.6 — 2026-07-03
- **Export tool: cross-choice constraints enforced** (#72). Certain choices now
  exclude others instead of exporting contradictory plans:
  - **NFS / VMFS-on-FC principal storage excludes stretching** (VCF stretching
    is vSAN stretching) — the management-stretch checkbox is disabled and any
    stretched selection is reset, with a visible message.
  - **A stretched workload domain requires the management domain stretched
    first** — ticking a WLD *Stretched* auto-adds E7; unticking the management
    stretch resets stretched WLDs.
  - Both rules are also enforced in the library (`normalizeSelection`), so
    programmatic/exported output stays consistent regardless of UI state.
  - **Distributed connectivity + NSX Overlay Segment placement** gets a nudge
    task (the overlay placement needs an Edge cluster + Tier-0, which a
    Distributed fleet doesn't have) — deploy one first or pick a VLAN-backed
    placement. `docs/06-deployment-plan.md` scope table + 8.2 updated to match.

## v1.0.5 — 2026-07-03
- **Repo-wide Broadcom TechDocs enrichment pass** (#75) — every major claim now
  carries an authoritative link, all URLs liveness-verified:
  - `prerequisites.md`: 9.1 Planning & Preparation companion in the intro; ESX
    host-prep page under Hardware; SFTP backup requirements (ECDSA/RSA key
    support) + VCF Operations backup target; online-depot connect + offline
    VCF Download Tool under Binaries.
  - `01-network-dns-plan.md`: Edge-cluster/BGP setup under §B; Identity
    Provider under §E; Configure-a-CA under §F.
  - `02-customer-intake.md`: new **TechDocs references** section mapping intake
    IDs (A/B/C/D/H) to the pages behind them.
  - `03-multi-az-prep.md`: vSAN Stretched Cluster Bandwidth Sizing guide +
    bandwidth/latency page on the AZ1↔AZ2 row; SDDC-Manager-driven stretch
    (Stretching vSAN Clusters) in the intro.
  - `04-sizing.md`: linked the vCenter / NSX Manager / NSX Edge appliance-size
    sources the validation pass checked against.
  - `06-deployment-plan.md`: VCF Installer deployment-wizard ref on 5.3;
    centralized-connectivity ref on 6.1.
  - `07-firewall-ports.md`: syslog 514→1514 now cites Broadcom KB 430675 + the
    vCenter required-ports page.

## v1.0.4 — 2026-07-03
- **Host Overlay TEP: static IP pool is now the recommended addressing** (DHCP
  scope stays documented as the supported alternative). Flipped the
  `prerequisites.md` "DHCP (optional but easiest)" section into *Host Overlay
  TEP addressing (static IP pool recommended)*, updated the Section A VLAN
  table + IP carve-out in `01-network-dns-plan.md`, and reworded intake `B8`
  (static pool range asked for up front). The workbook's own *Deploy Management
  Domain* sample uses **IP Pool** for *IP Assignment (TEP)* — mapping row `B8`
  now names the real field labels (Host Overlay Network: VLAN ID / Gateway
  CIDR / IP Assignment (TEP) / Range From / To). (#74)
- **More Broadcom TechDocs references:** TEP addressing (WLD prerequisites +
  per-cluster TEP IP pools), the per-component FQDN/IP inventory (9.1 Planning
  and Preparation) linked from the DNS prereqs and the VM-Management sizing
  note, identity-provider configuration (per-IdP sub-pages + AD over LDAP), and
  certificate-management walk-throughs. (#74)

## v1.0.3 — 2026-07-03
- **Export tool: VCF Automation deployment model (Stage 4 — completes #72).** A
  **Deployment model** dropdown in the VCF Automation sub-block — **single-node**
  (no LB) or **HA cluster** (nodes behind a VIP). Choosing HA without the Avi LB
  adds a nudge task ("an HA cluster needs a load balancer for its VIP"), and the
  8.2 title/acceptance reflect the model (e.g. "VCF Automation (NSX Overlay
  Segment, HA + Avi LB)"). All four staged deployment choices (connectivity,
  Supervisor, storage, deployment model) are now in the tool. (#72)

## v1.0.2 — 2026-07-03
- **Export tool: principal storage choice (Stage 3).** A **Principal storage**
  dropdown (**vSAN ESA / vSAN OSA / NFS / VMFS-on-FC**) adapts the E4 hardware
  prereqs (4.1 — disk/HBA + NIC guidance) and the E5 bring-up (5.3 — "builds …
  and the vSAN/NFS/FC datastore"; acceptance names the datastore). Core epics
  read `sel.storage`. (#72)

## v1.0.1 — 2026-07-03
- **Export tool: vSphere Supervisor choice (Stage 2).** Each workload domain now
  has a **Supervisor** checkbox, plus a **control-plane size** (Small/Medium/Large).
  Enabling it appends an *Enable vSphere Supervisor* story to that WLD, with the
  dependency chain: WLD north-south connectivity in place (Centralized Edge/Tier-0,
  or Distributed NSX VPC + VNA) **and** the Avi Load Balancer deployed **before
  activation**. WLD titles reflect it (e.g. "Workload domain: wld01 + Supervisor").
  Supervisor moved out of the connectivity story into its own generated one. (#72)

## v1.0.0 — 2026-07-03
- Added the **Deployment Plan Export** tool to the sidebar **Tools** section
  (previously only the Sizing calculator was listed there; the export tool was
  only reachable via the doc link). (#73)

## v0.9.9 — 2026-07-03
- **Export tool: NSX connectivity choice (Centralized / Distributed)** — the first
  of several deployment choices being added. Drives E6 story 6.1 and the WLD
  connectivity stories: **Centralized** = NSX Edge cluster + Tier-0 + BGP;
  **Distributed** = Distributed Transit Gateway + **Virtual Network Appliance (VNA)
  cluster** for stateful services (NAT). Core epics are now selection-driven
  (`coreEpics(sel)` in `deployment-plan.ts`). Doc E6 6.1 describes both models. (#72)

## v0.9.8 — 2026-07-03
- **Export tool now has VCF Automation choices** that drive the exported plan.
  Under Day-2 fleet: **Deploy VCF Automation?** (it's deferrable), a **network
  placement** dropdown (Shared Management / Dedicated / NSX Overlay Segment / NSX
  VLAN Segment — non-shared placements add the build-the-network detail), and
  **Load-balance with Avi** (management domain). The E8.2 story title, tasks, and
  acceptance are generated from these (e.g. "VCF Automation (NSX Overlay Segment +
  Avi LB)"). `deployment-plan.ts` E8 is now selection-driven (`day2Epic`); the doc
  E8.2 describes the choices and points to the tool. (#71)

## v0.9.7 — 2026-07-03
- Added a verified reference link to the E8.2 Avi/VCF-Automation note — Broadcom's
  *Deploy Avi Load Balancer from VCF Operations* (the design page had moved / 404'd;
  this URL was HTTP-checked). Doc + lib. (#71)

## v0.9.6 — 2026-07-03
- Deployment-plan E8.2 (VCF Automation) now notes the specific case: a **clustered
  / HA** VCF Automation (or self-service load balancing) is load-balanced by an
  **Avi Load Balancer deployed in the management domain**, lifecycle-managed via
  VCF Operations — cite Broadcom's *VCF Automation Load Balancing Design*. Doc + lib. (#71)

## v0.9.5 — 2026-07-03
- Deployment-plan WLD connectivity stories (E9 9.4 / 9.6) now note the ordering
  dependency: **if you enable vSphere Supervisor, deploy and configure the Avi Load
  Balancer (NSX ALB) controller cluster first** — Supervisor activation requires it.
  Verified against Broadcom's *Deploying vSphere Supervisor with NSX and Avi Load
  Balancer*. Doc + lib. (#70)

## v0.9.4 — 2026-07-03
- **Reverted the v0.9.3 CA correction — it was wrong.** Verified in a live lab that
  VCF 9.1 fleet certificate management (VCF Operations → Fleet Management →
  Certificates → Configure CA for Fleet) offers **both Microsoft CA and OpenSSL**
  for the VCF Management fleet; there is **no** separate Microsoft-only restriction
  for management vs instance components (the TechDocs summary that implied it does
  not match the product). Restored OpenSSL as a valid CA type across prerequisites,
  `01-network-dns-plan.md`, intake `D1`, the `ntp-ad-ca` template, and E1 1.4.
- Added the real CA gotcha: the **external-CA path is CSR-based only** — VCF
  generates the CSR and keeps the private key; you **cannot import a certificate
  created entirely outside VCF** (no externally-generated private keys). (#69)

## v0.9.3 — 2026-07-03
- Corrected the **certificate-authority guidance**: for VCF 9 **management
  components only a Microsoft CA is supported** (OpenSSL is limited to VCF Instance
  components; an external/third-party CA via CSR always works). Docs previously
  listed "MS Enterprise / OpenSSL / Other" generically. Fixed the prerequisites CA
  section, `01-network-dns-plan.md` CA-type row, intake `D1`, the `ntp-ad-ca-plan.csv`
  template, and deployment-plan E1 1.4. Verified against Broadcom's *Configure a
  Certificate Authority for VMware Cloud Foundation* (9.x). (#68)

## v0.9.2 — 2026-07-03
- Added **VCF Identity Broker identity-source prep + common gotchas** to the AD
  prerequisites (`prerequisites.md`). What to prepare (bind account incl. TGGAU
  read for Global Catalog; base DN / base group DN / optional base user DN; LDAPS
  root CA in PEM; DC or DNS-SRV reachability; groups to sync incl. the admin
  group) and the traps: **login is the domain UPN, not email** (KB 393150); GC
  syncs only **universal** groups; LDAPS cert must be **PEM**; single base group
  DN scoping; nested-group sync; weekly sync + service-account expiry. Added
  matching rows to `ntp-ad-ca-plan.csv` and a pointer from deployment-plan E8.4.
  Verified against Broadcom's *Configure AD as an Identity Provider (AD/LDAP)*. (#67)

## v0.9.1 — 2026-07-03
- Added a **firewall / ports layer** (#66):
  - **`docs/07-firewall-ports.md`** — a curated reference of the deployment-critical
    cross-zone flows grouped by zone (prereq services, admin access, NSX fabric,
    multi-AZ/witness, Day-2/fleet), the 9.1 gotchas (syslog 514 → **1514** TLS;
    Cloud Proxy **443/4505/4506**), and prominent links to the authoritative tools —
    **Coscia's Ports & Protocols matrix** (1,083 entries) and the **Broadcom Ports &
    Protocols portal**. Deliberately not a full matrix copy.
  - **`firewall-request-plan.csv`** — a downloadable fill-in change-request sheet for
    the security team (source zone / destination / port / protocol / direction /
    purpose / status), pre-populated with the common flows.
  - Callouts wired into `prerequisites.md`, `01-network-dns-plan.md`, and the
    deployment plan (E4.3 core services, E5.4 Cloud Proxy ports). Nav + README/CLAUDE
    updated.

## v0.9.0 — 2026-07-03
- Generic-language sweep of the customer-facing docs: "single-AZ **artifacts**" →
  "planning docs" (`05-day2-deployments.md`, `03-multi-az-prep.md`); "**This repo
  ships** an interactive tool" → "This toolkit provides…" (`04-sizing.md`); dropped
  "**the repo's**" from the Rainpole-placeholder note (`05-day2-deployments.md`).
  (Remaining "internal" hits are legitimate technical terms and were left.)

## v0.8.9 — 2026-07-03
- Made the templates' customer-data-hygiene note generic (dropped the
  OneDrive/repo specifics): a filled copy holds real, sensitive customer data —
  store it with the customer's secure engagement material, not in a public or
  shared repository. (#65)

## v0.8.8 — 2026-07-03
- Rolled the customer-readable format out to the remaining planning templates and
  fixed the empty value columns:
  - **`ip-dns-plan.csv`** — added *What it is*, an *Example (FQDN -> IP)*, explicit
    *FQDN / IP (fill in)* columns, and *Provided by*.
  - **`vlan-subnet-plan.csv`** — added *What it is*, a combined *Example
    (VLAN / subnet / gateway / MTU)*, and *Provided by*.
  - **`ntp-ad-ca-plan.csv`** — moved to the *Setting / What it is / Example /
    Your value / Provided by / Notes* layout.
  Every header cell is now filled and each sheet has an explicit fill-in column
  (the blank value cells previously had no header). (#65)

## v0.8.7 — 2026-07-03
- Reworked **`bgp-peering-plan.csv`** to be customer-readable (was a bare technical
  matrix). New columns — *Setting · What it is (plain language) · Example · Your
  value · Provided by · Notes* — and it now covers the full picture: Edge/ToR AS
  numbers, per-node uplink IPs, ToR neighbor IPs, BFD/ECMP, optional MD5, timers,
  advertised/received routes, and the per-AZ stretched peerings. (#65)

## v0.8.6 — 2026-07-03
- Added blank, downloadable **prereq planning templates** (`web/public/templates/`):
  `ip-dns-plan.csv` (per-appliance FQDN/IP/PTR), `vlan-subnet-plan.csv`,
  `ntp-ad-ca-plan.csv`, and `bgp-peering-plan.csv`. Pre-populated with the standard
  component / traffic-type rows and an **Intake ID** column that maps to
  `workbook-cell-mapping.md`, so a filled sheet transfers straight into the P&P
  workbook or Coscia's planner. Linked from `prerequisites.md` (with a customer-
  data-hygiene note) and `01-network-dns-plan.md`; added to the README/CLAUDE file
  layouts. (#65)

## v0.8.5 — 2026-07-03
- Supplemental-docs freshness sweep after the deployment-plan overhaul:
  - **CLAUDE.md** file layout — added the missing `docs/06-deployment-plan.md`
    row, refreshed the `05-day2` and `web/` rows (deployment-plan tool, GitLab Pages).
  - **README.md** — added `web/src/lib/deployment-plan.ts`; fixed the
    VCFHostPreparation host-prep reference (E5 / E7 / **E9**, was E8); refreshed the
    `05-day2` / `06` descriptions (VCF Operations is a bring-up component).
  - **`05-day2-deployments.md`** decision gate D1/D2 — corrected to state VCF
    Operations is deployed at bring-up (the `useExistingDeployment` path is for
    connecting an additional VCF instance to the fleet's existing Ops).
  - Site nav blurb for the Deployment Plan refreshed (scope + export).

## v0.8.4 — 2026-07-03
- Added an explicit **E5 5.4 — Deploy VCF Management Services, License Server &
  Cloud Proxy**, and removed them from the E5.3 bring-up parenthetical. These are
  **not** part of the automatic bring-up: bring-up deploys the appliances
  (vCenter, SDDC Manager, NSX, vSAN, VCF Operations), then VCF Management Services
  (services runtime, fleet/SDDC lifecycle, software depot, telemetry) + the
  License Server + the Cloud Proxy are deployed **via VCF Operations** (UI or SDDC
  Manager API). License Server needs a unique FQDN outside the services-runtime
  range (IPv4 only); Cloud Proxy stays on the VM-Management network. Doc + lib. (#64)

## v0.8.3 — 2026-07-03
- Clarified the **vSAN witness rule** for stretched clusters. Verified against
  Broadcom: *"A single witness host can support only one vSAN stretched cluster"*
  and *"two-node vSAN clusters can share a single witness host."* So a dedicated
  witness per stretched cluster is **required** (not just recommended) — the
  **shared-witness** feature is **2-node-cluster only**, not stretched. Strengthened
  the wording in E7 7.3, E9 9.4, and the E9 intro. Doc + lib. (#63)

## v0.8.2 — 2026-07-03
- **VCF Operations is a bring-up component in 9.1, not Day-2.** Moved it out of the
  Day-2 epic into E5 bring-up (5.3 now builds vCenter/SDDC Manager/NSX/vSAN **+ VCF
  Operations**, with the cluster-address / external-LB decision); per Broadcom's
  fleet bring-up wizard, only VCF Automation can be deferred to Day-N. E8
  renumbered (8.1 network placement, 8.2 VCF Automation, 8.3 Log Management /
  Operations for Networks / Identity Broker, 8.4 full-fleet finalization); cross-
  refs 6.2/6.4 → E8 8.4; scope-table Day-2 description updated. (#61)
- Renamed **"Ops for Logs" → "Log Management"** (VCF 9.1 / workbook name). (#62)

## v0.8.1 — 2026-07-03
- Elaborated the **stretch stories (E7 7.4, E9 9.5)**: SDDC Manager does the
  stretch from a **JSON spec via its API** — it builds the fault domains
  (AZ1 preferred / AZ2 secondary / witness), balances hosts across AZs, and flips
  the datastore policy to **site mirroring**; you supply the AZ2 network pool,
  commissioned AZ2 hosts (equal per AZ), and witness. Added the **management-
  domain-stretched-first** dependency for a stretched WLD, the limitations
  (shared vSAN storage policy / DPU hosts / L3-split subnets within an AZ), and a
  reference to Broadcom's *Stretching vSAN Clusters* (9.1). Doc + lib. (#60)

## v0.8.0 — 2026-07-03
- Moved the **E10 — Validation & handover** section in `06-deployment-plan.md` to
  its own "Final epic (always last)" section **after** the variant epics, so the
  doc's top-to-bottom order matches the execution order (variants are added per
  scope before handover). The tool/export already emitted E10 last; this is a
  doc-layout fix only. (#59)

## v0.7.9 — 2026-07-03
- Documented the **VCF Installer host port-group VLAN gotcha**: a fresh ESXi
  host's default `VM Network` port group is untagged (VLAN 0), so if VM Management
  is a tagged VLAN you must set the VLAN ID on the port group you deploy the
  Installer to (on that host) — otherwise the appliance has no management
  connectivity. Added to deployment-plan story 5.2 (+ mirrored lib) and the VCF
  Installer callout in `01-network-dns-plan.md`. (#58)

## v0.7.8 — 2026-07-03
- Corrected **BGP MD5/password to optional** (it was labelled "Required by NSX").
  Per Broadcom's *Configure BGP* (VCF 9.x), the only required BGP-neighbor
  settings are the neighbor IP + remote AS; MD5 authentication (and its password)
  is optional. Fixed the `01-network-dns-plan.md` row, the deployment-plan BGP
  story (E1 1.2) + mirrored `deployment-plan.ts`, and marked intake `B14` optional. (#57)

## v0.7.7 — 2026-07-03
- **Moved Prerequisites & readiness gate to just before bring-up.** It's the
  go/no-go verify against the plan's outputs, so the planning epics now lead and
  the gate is E4: **E1 = Network/DNS plan, E2 = Intake & sizing, E3 = Workbook/JSON,
  E4 = Prerequisites & readiness gate, E5 = bring-up**. Story ids and cross-refs
  updated (hardware → sizing E2, physical network → plan E1); story 4.4 renamed
  "Access & final readiness". Doc + `web/src/lib/deployment-plan.ts`. (#56)

## v0.7.6 — 2026-07-03
- **Specificity pass over every deployment-plan acceptance criterion** (doc +
  `web/src/lib/deployment-plan.ts`). Replaced vague/cryptic wording with concrete,
  checkable outcomes and named specifics instead of "gate" / "resolves" /
  "compliant":
  - **1.4** names the access (jump/bastion + out-of-band iDRAC/iLO/BMC) and the
    "gate" (the full `prerequisites.md` checklist). (#54)
  - **1.3** names which DNS must resolve (shipped in v0.7.5). Plus 1.1 (host
    count/AZ split), 1.2, 2.1–2.4 (BGP params, A+PTR), 3.x, 4.x (schema-valid),
    5.2 (added), 5.3 (vCenter/NSX), 6.1 (added; routing moved here), 6.4, 7.1/7.3
    (added), 7.4 (storage-policy compliant + AZ-isolation test), 8.1–8.3 (added),
    8.4, all E9 WLD stories, and 10.1/10.2 (added). Stretch/WLD acceptances now use
    the same "healthy + storage-policy compliant; isolating one AZ keeps VMs
    running" wording. No acceptance asserts Day-2-deferred certs/identity/licensing. (#55)

## v0.7.5 — 2026-07-03
- Deployment-plan E1 story **1.3 acceptance** now specifies which DNS must
  resolve: forward (A) + reverse (PTR), both ways, for every management/fleet
  FQDN — ESXi hosts, vCenter, SDDC Manager, NSX Manager VIP + 3 nodes, NSX Edge
  nodes (and any Day-2 fleet appliances). Doc + `web/src/lib/deployment-plan.ts`. (#53)

## v0.7.4 — 2026-07-03
- **Renumbered the deployment-plan variant epics to follow execution order:**
  **E7 = Stretch the management domain, E8 = Day-2 fleet, E9 = Workload
  domain(s)** (was E7=WLD / E8=stretch / E9=Day-2, which read out of order since
  WLDs execute last). Story ids and all cross-references (6.2 / 6.4 → E8 8.5)
  updated. Also **harmonized the stretch sequence** so the management stretch and
  a stretched WLD follow the same order — *fabric/networks → commission second-AZ
  hosts → witness → stretch* (the mgmt stretch previously put the witness first). (#51)
- **Spelled out owner roles** (Architect, Network, Platform, Security, Storage,
  Customer, AD/DNS/NTP) and **dropped the abbreviation legend** — doc, tool data,
  and Markdown export. (#52)

## v0.7.3 — 2026-07-03
- Deployment-plan E6 6.4 refinements (`docs/06-deployment-plan.md` + mirrored
  `web/src/lib/deployment-plan.ts`):
  - **Licensing moved to Day-2.** Dropped "apply licensing" from 6.4; folded it
    into the E9 9.5 full-fleet finalization (now *Certificates, identity &
    licensing*), applied via VCF Operations. (#49)
  - **Depot clarified.** 6.4's depot step is the **fleet-lifecycle** (fleet-wide
    LCM) depot — SDDC Manager already has its own depot from bring-up (E5), so
    this is not a re-do. (#50)

## v0.7.2 — 2026-07-02
- Deployment-plan E4 story **4.1 (fill the P&P workbook)** now points to
  [Coscia's VCF Planner](https://vcfplanning.lcoscia.fr/) as an easier fillable
  alternative (live VLAN/IP/CIDR validation) that also doubles as an **as-built**
  record with JSON/Markdown/CSV export. Doc + `web/src/lib/deployment-plan.ts`. (#48)

## v0.7.1 — 2026-07-02
- **Deployment-plan stretch is now modelled per-domain.** The export tool and doc
  drop the single global "stretched" variant for: a **Stretch the management
  domain** toggle (E8, renamed) **+** a **per-workload-domain repeater** where each
  WLD is independently **non-stretched or stretched**. A stretched WLD gets its own
  second-AZ host prep + commission, its **own** dedicated vSAN witness (one per
  stretched cluster), and the stretch stories. Execution order: core → mgmt stretch
  → Day-2 → workload domains → handover. Tool page gains an add/remove WLD list;
  `web/src/lib/deployment-plan.ts` generates one E7 epic per WLD. (#46)
- **Referenced [VCFHostPreparation](https://github.com/pauldiee/VCFHostPreparation)**
  (public) for imaging + commissioning ESXi hosts, in every host-prep story
  (E5.1 / E7 / E8.3) and in Related tools (README + site landing page). (#47)

## v0.7.0 — 2026-07-02
- More deployment-plan sequencing fixes (`docs/06-deployment-plan.md` + mirrored
  `web/src/lib/deployment-plan.ts`): certificates and identity are really
  *once-everything-exists* activities.
  - **E6 6.2 (certificates)** reworked as **optional / partial**: cert only the
    components deployed so far at bring-up; the full CA-signed pass waits until
    all components exist.
  - **E6 combined acceptance (6.4)** no longer asserts trusted certs / AD SSO
    (those are deferred to Day-2); it now covers routing, backups, depot, licensing.
  - **New E9 9.5 — Certificates & identity (full fleet):** after the Day-2 fleet
    is up, do the full CA-signed certificate replacement in one pass and complete
    fleet SSO via the VCF Identity Broker (the identity path deferred from 6.3). (#45)

## v0.6.9 — 2026-07-02
Deployment-plan sequencing / dependency fixes (`docs/06-deployment-plan.md` +
the mirrored structured data in `web/src/lib/deployment-plan.ts`):
- **E5 (management domain bring-up) story order** was backward. ESXi host
  install/config now comes first: **5.1 Install & configure the management
  hosts** (image with the ESXi ISO; set mgmt VMkernel IP/VLAN, DNS, NTP, root;
  match the BOM build), then **5.2 Stage the VCF Installer**, then **5.3 Deploy
  the management domain** (Installer validates the prepared hosts, then builds
  vCenter/SDDC Manager/NSX/vSAN). Replaces the vague "Commission hosts" step. (#42)
- **E6 story 6.3 (identity)** assumed the **VCF Identity Broker**, which is a
  Day-2 component not yet installed at bring-up. Reworked as **optional and not
  recommended** at this stage: the recommended path is fleet-wide SSO via the
  Identity Broker Day-2 (E9); bind vCenter SSO to AD directly here only if AD
  admin access is needed before the fleet is up. (#43)
- **E8 (stretched / multi-AZ)** was missing host prep. Added **8.3 Install,
  configure & commission the second-AZ hosts** (ESXi ISO, per-AZ management
  network, commission into SDDC Manager) before **8.4 Stretch the cluster**. (#44)

## v0.6.8 — 2026-07-02
- Added an **interactive Deployment Plan export tool**
  (`web/src/pages/tools/deployment-plan.astro`, `web/src/lib/deployment-plan.ts`).
  Pick the deployment type — core epics always on, with toggles for Workload
  domain (E7), Stretched/multi-AZ (E8), and Day-2 fleet (E9) — see a live filtered
  preview, then **Copy/Download Markdown** or **Download/Copy CSV** for backlog
  import (Jira / Azure DevOps / GitLab; columns Issue Type / Summary / Parent /
  Owner / Acceptance / Reference). Mirrors `docs/06-deployment-plan.md`, which
  stays the source of truth and now links to the tool. (#41)

## v0.6.7 — 2026-07-02
- Documented that the **VCF Operations load balancer is external and never served
  by VCF**. The analytics cluster uses a **floating IP** by default; a
  load-balancer **VIP** is optional and, when used, must be a **customer-provided
  external LB** (F5, standalone Avi/NSX ALB) — VCF does not deploy or lifecycle it
  for Operations (unlike the *integrated* LB in Operations *for Logs*, or the
  platform Avi/NSX ALB used for tenant workloads). Added `05-day2-deployments.md`
  §B.1 (with the floating-IP-vs-VIP switch + cert-SAN requirement, TechDocs
  cited), plus notes on intake `E9`, prerequisites (Network), and deployment-plan
  Story 9.2.

## v0.6.6 — 2026-07-02
- Corrected the VCF Installer IP guidance. It does **not** use a throwaway
  temporary IP: when deployed on a management-domain ESX host (the usual
  greenfield case) you give it the **IP + FQDN you plan for SDDC Manager**, and
  it switches into SDDC Manager after bring-up (per Broadcom TechDocs). Fixed the
  `01-network-dns-plan.md` subnet-table note + added a cited callout, updated
  intake `E7`, and the deployment-plan Story 5.1. (A temporary IP applies only if
  the Installer is deployed *outside* the management infrastructure.)

## v0.6.5 — 2026-07-02
- New **Deployment Plan** page (`docs/06-deployment-plan.md`): a generic **agile
  work breakdown** (epics → stories → tasks, no dates) for the common VCF 9
  deployment types (management-only, + workload domains, stretched/multi-AZ, +
  Day-2 fleet) so customers can drop it into a scrum/agile backlog. A "deployment
  types" table maps each type to the epics that apply; every epic links to the
  detailed page that fills it in, with owners and acceptance criteria. Added a
  sidebar **Delivery** step + README row.

## v0.6.4 — 2026-07-02
- Sizer: fixed the **Import** toolbar control looking greyed-out. It's a
  `<label>`, so the global `.sizer label` rule (muted colour, `display: block`)
  out-specified the toolbar-button styling. Raised the selector specificity
  (`.sizer__toolbar .sizer__filebtn`) so Import matches the other toolbar
  buttons (royal-blue, inline). Import already worked; it just looked disabled.

## v0.6.3 — 2026-07-02
- `workbook-cell-mapping.md`: added the **workload-domain** intake→named-range
  table (section H, issue #36). The `input_wld_*` set is a single WLD (fill per
  WLD) mirroring the mgmt layout, so H1–H12 map to `input_wld_*` families —
  vCenter/NSX/Supervisor/storage, per-cluster networks, vDS, host overlay,
  stretched (az2 twins + witness), and passwords — verified against a full
  defined-names export. Optional-solution prefixes (SRM/DR, CCM, CBR, k8s) noted
  as out of scope unless used.

## v0.6.2 — 2026-07-02
- `04-sizing.md`: added a **"Validation against Broadcom TechDocs"** section
  (issue #16). vCenter (vCPU/RAM), NSX Manager, and NSX Edge match the docs
  exactly; the vSAN math (OSA ×2, 30% reserve, stretched ×2) checks out, with a
  note that ESA ×1.5 reflects adaptive RAID-5 not a RAID-1 mirror. **AVI is the
  outlier** — the workbook's controller disk sizes are high, it lacks a Medium
  tier, and its "X-Large" isn't a real NSX ALB Controller size (real ladder:
  Small 6/32/128, Medium 10/32/256, Large 16/48/512). Documented, with sources.

## v0.6.1 — 2026-07-02
- GitLab Pages base fix. The instance serves project Pages at a **unique-domain
  path** (`/<project>-<hash>`, e.g. `…/vcf9-deploymentplanning-9b6f07`), but the
  job had hardcoded the base to `/<project>` — so assets/links 404'd. The job now
  **derives `SITE_BASE`/`SITE_URL` from `CI_PAGES_URL`** at build time, so the
  base always matches where GitLab actually serves the site. Verified locally.

## v0.6.0 — 2026-07-02
- Fixed the GitLab Pages job for the ITQ runner. The runner is a **shell
  executor** (no container), so `image: node:20` was ignored and the host has no
  Node — the job failed on `node: command not found`. The `pages` job now fetches
  a local Node build itself (cached between runs) when Node isn't on `PATH`, then
  builds as before. Also corrected the docs: Pages settings live under **Deploy →
  Pages** in current GitLab, not Settings → Pages.

## v0.5.9 — 2026-07-02
- **GitLab Pages** publishing for internal visibility. Added `.gitlab-ci.yml`
  (`pages` job: build `web/` → `public/`) mirroring the GitHub Actions deploy, and
  made the Astro `site`/`base` env-configurable (`SITE_URL`/`SITE_BASE`) so one
  codebase serves both — GitHub uses the defaults, GitLab sets the base to the
  project path. Verified an override build emits GitLab paths with zero
  GitHub-base leftovers. README documents enabling Pages + the base caveat.

## v0.5.8 — 2026-07-02
- Landing page: dropped the numeric badge (01–07) from the workflow cards — it
  clashed with the step labels (card "04" was labelled "Step 3"). Cards now show
  the icon + step label (Gate, Step 1…Reference) only. Removed the now-unused
  `.planning-card__num` style.

## v0.5.7 — 2026-07-02
- Sizer: removed all **visible em-dashes** from the tool (title, lede, hints,
  guardrail text, toolbar toasts, per-host/headroom placeholders → `n/a`, and the
  component names like "VCF services runtime (control nodes)") to match the ITQ
  no-em-dash web-chrome convention. Code comments unchanged; engine output and
  the workbook baseline unchanged.

## v0.5.6 — 2026-07-02
- Up-to-date sweep fixes: README contents row for `05-day2` still said "NSX VPC
  placement" → "network placement"; refreshed `CLAUDE.md`'s file-layout table
  (added `03`/`04`/`05` docs, `web/`, `reference/`; `samples/` no longer
  "(future)"; "doc-only" → docs + Astro site); and removed two stray em-dashes
  from web chrome (Step-3 nav blurb, VCF.JSONGenerator card) to match the ITQ
  no-em-dash convention. Cross-refs, doc links, workbook revision, and the build
  otherwise check out.

## v0.5.5 — 2026-07-02
- Landing page / nav refresh: the workflow heading said "Five documents" (there
  are now seven items incl. an interactive tool) → "The planning flow, in order".
  Updated the **Step 3 (Sizing & Fit Check)** blurb to reflect it's now an
  interactive calculator with export/share, and fixed the **Day-2** blurb which
  still referenced the (since-corrected) "NSX VPC" placement — now Shared /
  Dedicated / NSX Overlay / VLAN Segment.

## v0.5.4 — 2026-07-02
- `workbook-cell-mapping.md`: validated the open items in the mgmt-domain
  intake→named-range map. Resolved `C8` (`input_parent_dns_zone`) and `D1`–`D4`
  (the `input_ca_*` / `input_certificate_authority_*` block). Confirmed absent
  (no named range): `C3` DC FQDNs (only the Identity Broker Day-N `input_flt_vidb_*`),
  `D5`/`D6` (cert SAN/validity), `F5` mgmt NSX Manager passwords (only Edge), and
  `B16`/`B17`/`B22`. Documented where the Day-2 `B21`/`E15` fields live.

## v0.5.3 — 2026-07-02
- Related tools: **VCF9 Readiness Assessment** and **VCF Health Check** are **ITQ
  Consulting Services** (internal, not public repos) — removed their public
  `github.com/pauldiee/…` links from the README and the site landing page and
  relabelled them as ITQ Consulting Services offerings. Added **VCF.JSONGenerator**
  to the site's Related-tools grid (it was only in the README). Noted the
  distinction in `CLAUDE.md`.

## v0.5.2 — 2026-07-02
- `workbook-cell-mapping.md`: added a first-cut **intake → named range**
  table for the **management domain** — each intake ID (A/B/C/D/E/F) mapped to the
  `input_*` / `*_chosen` named range(s) VCF.JSONGenerator reads, so a future
  writer (issue #1) can target them directly. Built from a full defined-names
  export + a background cross-reference pass; per-AZ families use `az1`/brace
  notation. Open items (C3/C8/D2–D6/F5, Day-2 B21/E15) are flagged for
  validation.

## v0.5.1 — 2026-07-02
- `03-multi-az-prep.md`: added a **witness-traffic routing** note. Since witness
  traffic rides the ESX Management VMkernel (default TCP/IP stack → management
  default gateway), it follows routed paths and needs **no per-host static
  routes** (unlike a dedicated-witness-VMK design). Requirement: **bidirectional
  L3 routing** between each AZ's ESX-Management subnet and the witness appliance's
  network, both AZs ↔ witness, within the RTT budget; unicast, ports permitted
  end-to-end.

## v0.5.0 — 2026-07-02
- `workbook-cell-mapping.md`: documented **how VCF.JSONGenerator reads the
  workbook** — via **named ranges**, not cells/labels. It collects every
  `input*`-prefixed value field (~2,338 in the pinned 9.1 workbook) and every
  `*chosen`-suffixed dropdown (~465), structured by area (`input_mgmt_*`,
  `input_wld_*`, `input_cluster_*`, `input_flt_*`, …). Named ranges survive
  Broadcom's row shifts, so a future intake→workbook writer (issue #1) should
  target them. (Inspected the module source on GitHub.)

## v0.4.9 — 2026-07-02
- README: extended the **workflow** to show the full pipeline — Fill the workbook
  (raw `.xlsx` or **Coscia's tool**) → **Generate JSON** (VCF.JSONGenerator) →
  VCF Installer — with a note that the filled P&P workbook is the machine-readable
  handoff. Corrected the VCF.JSONGenerator entry: it **reads a populated P&P
  workbook** (the same one this repo targets) to produce the JSON payloads;
  linked its GitHub + PS Gallery. Confirms the tool chain: this repo plans and
  fills the workbook, VCF.JSONGenerator turns it into deployment JSON.

## v0.4.8 — 2026-07-02
- README: added **VCF.JSONGenerator** (Ken Gould's PowerShell module) to *Related
  tools* — it generates the VCF deployment/bring-up JSON for the VCF Installer /
  SDDC Manager, i.e. the "last mile" after this repo's plan → workbook flow.

## v0.4.7 — 2026-07-02
- Sizer: guard the **Log Management replica** field itself. The engine already
  clamped for the calculation, but a typed out-of-range value (e.g. 1 replica on
  a Medium profile, min 3) stuck in the input. Now the field clamps to the
  per-size min..19 on commit (blur / enter / spinner).

## v0.4.6 — 2026-07-02
- `03-multi-az-prep.md`: corrected the **witness traffic separation** networking
  to match the Broadcom VCF design (verified against *vSAN Design for VCF* +
  *Deploying a Witness Appliance*). Prior text implied a dedicated witness
  VLAN/subnet; VCF actually puts witness traffic on the **management network** at
  both ends — data hosts tag their **ESX Management** VMkernel (WTS), and the
  witness appliance uses **one** VMkernel for management + witness. So no
  dedicated witness VLAN is needed: route the witness appliance's management
  subnet to the ESX-management networks in both AZs. Updated section B (+ a
  cited note) and the section D witness row.

## v0.4.5 — 2026-07-02
- Sizer: **Log Management is now first-instance only** (workbook O25: "Log
  management can only be installed on the first instance"). On an Additional
  Instance the size dropdown locks to Exclude with a note, and the engine drops
  the component.
- Sizer: added **Copy summary** — copies a readable **Markdown** report of the
  sizing (profile, cluster, fit verdict + table, fleet requirement, component
  list) to the clipboard for pasting into an email, doc, or ticket.

## v0.4.4 — 2026-07-02
- Sizer: corrected the Log Management size rule from "≤ deployment size" to
  **must match the deployment profile size**. The workbook's warning cell (O24)
  states *"The Log Management size should be the same size as the selected VCF
  Profile size"* — so a Medium profile now offers only Exclude/Medium (Small is
  no longer selectable, which is what triggered the red warning in Excel). The
  size dropdown clamps to the profile size; replica minimums (1/3/6) unchanged.

## v0.4.3 — 2026-07-02
- Sizer: added **export / import / share**. A toolbar offers **Copy share link**
  (encodes the full input state into the URL hash — open the link to restore it),
  **Export** (downloads `mgmt-domain-sizing.json`), **Import** (loads a saved
  JSON), and **Reset**. Imports are sanitised against the known fields/options.
  All client-side; nothing leaves the browser.

## v0.4.2 — 2026-07-02
- `01-network-dns-plan.md`: fixed the VCF Installer placement note. It read as if
  the Installer sits **on** the ESX Management network; corrected to reflect that
  the Installer **lives on VM Management** (temporary IP during bring-up) and only
  needs to **reach / route to** the ESX Management network to commission the hosts.

## v0.4.1 — 2026-07-02
- Site chrome: the footer is now a **compact, always-visible** bar (`position:
  sticky; bottom: 0`, smaller padding + logo) so it stays in view while scrolling,
  and added a **Blog** button to the header (outlined orange, linking
  hollebollevsan.nl) alongside the GitHub CTA.

## v0.4.0 — 2026-07-02
- Renumbered the changelog to honour **max 10 patches per minor** (the entries had
  run to `0.1.29`). Remapped the single long `0.1.x` line into three tidy minors —
  `0.1.0`–`0.1.9`, `0.2.0`–`0.2.9`, `0.3.0`–`0.3.9` — and updated in-body version
  cross-references to match. Safe: no git tags or external references pointed at
  the old numbers. Reinforced the rule in `CLAUDE.md`'s pre-commit checklist.

## v0.3.9 — 2026-07-02
- Sizer: redesigned the **workload-domain repeater** for readability. Each WLD is
  now a labeled **card** (a "WLD N" badge + name + remove control in a header row,
  then its fields — vCenter size/storage, NSX model, NSX Manager size, Global
  Manager — as a responsive auto-fit grid with visible labels) instead of six
  unlabeled dropdowns crammed into one narrow row.

## v0.3.8 — 2026-07-02
- Sizer: added a soft **2:1 oversubscription guardrail**. When CPU or RAM
  oversubscription exceeds 2:1, a non-blocking caution appears noting Broadcom's
  guidance caps the management domain at 2:1 (latency-sensitive control plane).
  The input still accepts higher ratios — it just no longer looks blessed.

## v0.3.7 — 2026-07-02
- Sizer: constrained **Log Management** to the deployment profile, matching the
  workbook (cells E25/E26). The size dropdown now caps at the deployment size
  (Simple/Small → Small; HA+Medium → Small/Medium; HA+Large → all), and the
  replica count enforces the per-size minimum (Small 1 / Medium 3 / Large 6, max
  19) from the `sizing_log_replicas_*` ranges — clamping on change. Added engine
  helpers `logsSizeOptions` / `logsReplicaMin` + defensive clamp in `compute()`.
  Workbook baseline unchanged. Closes #25.

## v0.3.6 — 2026-07-02
- Actually-actually fixed the `Duplicate id` build warning. The v0.3.3 prebuild
  targeted `.astro/data-store.json`, which **does not exist** in this Astro
  version — the content store is `.astro/collections/` — so it was a no-op and
  the warning kept recurring. Pointed `prebuild` at `.astro/collections`;
  verified clean across 12 consecutive `npm run build` cycles alternating the
  three docs that had been failing.

## v0.3.5 — 2026-07-02
- `03-multi-az-prep.md` section D: added a note that **public peering is normally
  a workload-domain concern, not management** — the mgmt domain's Edge uplinks
  peer with the internal ToR fabric, while public / upstream / DMZ peering lives
  on the WLD edges (unless a published service is deliberately routed through the
  mgmt edges). Spelled out the multi-AZ requirement (stretched under Centralized /
  per-AZ under Distributed; surviving AZ advertises public prefixes, failed AZ
  withdraws) and cross-linked intake `B22`.

## v0.3.4 — 2026-07-02
- `01-network-dns-plan.md`: also surface **public / upstream peering** in the main
  VLAN/subnet table (row 12, optional `/29`–`/30` point-to-point uplink), mirroring
  how the Edge uplinks appear in both the subnet table and §B. The BGP-session
  detail stays in §B; this gives the peering a visible subnet slot. Cross-linked
  to intake `B22`.

## v0.3.3 — 2026-07-02
- Actually fixed the `Duplicate id` build warning. The absolute content `base`
  in v0.2.9 helped but did **not** reliably stop it — the warning recurred on
  incremental builds after editing docs, because the persisted content cache
  (`.astro/data-store.json`) can re-add an edited file when `dev`/`build`
  interleave. Added a `prebuild` script that clears that store so every build
  starts from a clean cache; verified clean across 11 consecutive edit+build
  cycles (including the previously-failing case). CI was already unaffected
  (fresh checkout, no cache).

## v0.3.2 — 2026-07-02
- Added intake question `B22` (Network) for optional **public / upstream peering**
  — peer AS/IP/MD5, advertised/received prefixes, and its own uplink subnet if it
  doesn't share the Edge uplinks — cross-linked to `01-network-dns-plan.md` §B.
  Mapped it in `workbook-cell-mapping.md`: no dedicated workbook cell (it's an
  additional Tier-0 BGP neighbor configured in NSX post-bringup; plan it in `01`).
  Extends #24.

## v0.3.1 — 2026-07-02
- `01-network-dns-plan.md` section B (BGP): added an optional **Public / upstream
  peering** row (a separate BGP session for public / north-south routes — internet
  edge, DMZ, or upstream provider — distinct from the internal ToR fabric peering;
  most fleets don't need it) and a **multi-AZ** note that the Edge uplinks /
  peering are stretched under NSX **Centralized** connectivity and per-AZ under
  **Distributed** (intake `A10`). Keeps `01` consistent with the `03-multi-az-prep.md`
  section D clarification. Extends #24.

## v0.3.0 — 2026-07-02
- `03-multi-az-prep.md` section D clarifications: (1) the per-AZ networking table
  applies to **any stretched cluster**, not just the management domain — a
  workload-domain cluster can also be stretched; added a note on the WLD case
  (repeat per-AZ rows per WLD; VM Management stretched is mgmt-specific). (2)
  Fixed an inconsistency with `prerequisites.md`: Edge Overlay + Uplinks are
  stretched **only with NSX Centralized connectivity** (intake `A10`) — per-AZ
  under Distributed; the rows now carry that caveat. (3) Clarified that the NSX
  Edge Uplink BGP sessions **are** the north-south / public peering (captured in
  the `01` BGP plan + intake `B10`–`B16`), not a separate item.

## v0.2.9 — 2026-07-02
- `05-day2-deployments.md`: read all the Broadcom option pages and expanded
  section C with accurate per-placement detail — Shared VLAN (no isolation, not
  DR-suited), Dedicated VLAN (dedicated port group; Cloud Proxy stays on VM-mgmt),
  NSX Overlay (Ops/Automation/Ops-for-Networks/License Server on the overlay via
  Edge cluster + Tier-0 BGP + Tier-1; Cloud Proxy on VLAN), NSX VLAN Segment, and
  the stretched-overlay DR model (NSX Federation + Global Manager primary/
  secondary for IP mobility). Added common prerequisites (unique FQDN→IP,
  dual-stack A/AAAA, binaries to VCF Installer).
- Fixed the spurious `Duplicate id` build warning: the docs/samples content
  collections used a relative `base` outside the project root, which the `dev`
  and `build` content syncs tracked under two normalized paths. Anchored both to
  an absolute URL (`new URL('../../docs', import.meta.url)`) so every file has one
  canonical id. Verified clean under a live dev-cache + build collision.

## v0.2.8 — 2026-07-02
- Corrected the Day-2 network-placement options in `05-day2-deployments.md`. The
  first cut wrongly framed the choice as "Shared Management Network vs. NSX VPC"
  — the *Deploy Fleet Management Day-N* sheet (verified from the raw data-
  validation lists) actually offers four placements: **Shared Management
  Network / Dedicated Management Network / NSX Overlay Segment / NSX VLAN
  Segment**, and there is no VPC option. Reconciled with the Broadcom design
  library (*Fleet-Level Components Networking Detailed Design* — four models incl.
  the DR-oriented stretched-overlay) and the custom-networking deployment
  guidance: the NSX Overlay path is a **hybrid** (Ops + Automation on the overlay
  segment, Cloud Proxy / collectors stay on the VLAN), needs an NSX Edge cluster
  with a centralized transit gateway + Tier-1 (Active/Standby), and the VCF
  Automation internal **cluster CIDR** defaults to `198.18.0.0/15`. Updated the
  deploy-method options (Exclude / Deploy VCF Operations and Automation / Deploy
  VCF Automation) and fixed intake `B21`/`E15` and the Day-N mapping to match.

## v0.2.7 — 2026-07-02
- New **Day-2 / Day-N fleet deployment** prep: `docs/05-day2-deployments.md`,
  sourced from the workbook's *Deploy Fleet Management Day-N* sheet + TechDocs.
  Enumerates the components deployed after bring-up (VCF Operations, Cloud
  Proxy, License Server, VCF Automation, Identity Broker, Operations for Logs /
  Networks) and captures the key decisions: bring-up vs Day-2, the two VCF
  Automation deployment methods (SDDC Manager API vs via VCF Operations), and
  the **network placement** — Shared Management Network vs a dedicated network
  that can be an **NSX VPC** (ties to `A10`/`B20`). Added intake questions
  `A17` / `B21` / `E15` (with `[DAYN]` sheet legend), mapped them plus the
  Log/Networks appliances to the *Deploy Fleet Management Day-N* sheet, and
  added a sidebar **Day-2** step + README row. Closes #23.

## v0.2.6 — 2026-07-02
- New **interactive Management Domain sizing tool** on the site
  (`web/src/pages/tools/mgmt-sizing.astro` + engine `web/src/lib/mgmt-sizing.ts`).
  Reproduces the workbook's *Management Domain Sizing* sheet (pinned rev
  `v1.9.1.001`) — appliance footprints from the `table_*` ranges, host-count and
  vSAN raw-capacity formulas from the summary cells — and **adds a cluster fit
  check the spreadsheet lacks**: enter your proposed host count + per-host spec
  and it reports fits / doesn't-fit at N-1, per-dimension headroom, and the
  binding constraint. Includes a workload-domain repeater (each WLD's vCenter +
  dedicated NSX Managers add to the mgmt footprint). Engine verified against the
  sheet's own values at defaults (122 vCPU / 316 GB / 7872 GB / 4 hosts /
  41 CPU + 106 GB + 5855 GB per host at N-1 / 17564 GB vSAN raw). Added
  `docs/04-sizing.md` (Step 3) linking the tool, a sidebar **Tools** entry, and
  README rows. Closes #15.

## v0.2.5 — 2026-07-02
- `03-multi-az-prep.md` table D: added a sourcing note confirming the
  stretched-vs-per-AZ traffic split against the Broadcom VCF 9 design library
  (*vSphere Stretched Cluster Model*). ESX Management, vMotion, vSAN, and Host
  TEP are "unique per availability zone" (per-AZ); only VM Management is
  "shared across availability zones" (stretched) — there is no option to
  stretch ESX Management. Also pins the AZ1↔AZ2 figure at the vSAN
  stretched-cluster limit (<5 ms RTT, ≥10 Gbps), not the looser 10 ms
  generic-AZ number. Closes #14.

## v0.2.4 — 2026-07-01
- Site proofread: verified every doc cross-link resolves to a real route, the
  ITQ-authored chrome is free of em-dashes and emoji, and there are no
  doubled-word or leftover-marker issues. Fixed one stray "MR" shorthand in
  `prerequisites.md` (now "multi-AZ", consistent with the rest). Closes #13.

## v0.2.3 — 2026-07-01
- Added the first `samples/` worked example: `01-network-dns-plan-rainpole.md`,
  a filled Step 1 plan using the classic Rainpole reference values (VLANs,
  subnets, IP carve-out, BGP AS/uplinks, DNS records, NTP, AD/CA) drawn from the
  pinned workbook. Surfaced it on the site via a `samples` content collection +
  route and a sidebar "Worked example" link. README `samples/` row updated.
  Closes #12.

## v0.2.2 — 2026-07-01
- Built out the Workload Domain / Cluster intake, previously a single stub line
  (`E13`). New **section H** (sourced from the workbook Deploy Workload Domain +
  Deploy Cluster sheets): per-WLD name/vCenter/NSX/connectivity/Supervisor/
  storage and per-cluster hosts/networks/vDS/overlay/stretched/passwords, with
  `E13` now pointing to it. Surfaced the 9.1 sizing gotcha that each WLD's
  vCenter (1) + NSX cluster (4) consume **5 IPs on the management VM Mgmt
  subnet** — noted in section H and the Step 1 carve-out. Mapped `H1`–`H12` in
  `workbook-cell-mapping.md` (replacing the "same as mgmt domain" placeholder).
  Closes #11.

## v0.2.1 — 2026-07-01
- `02-customer-intake.md` Platform (E) section 9.1 accuracy pass: VCF Operations
  and VCF Automation were captured as single "VIP FQDN + IP" entries, but in 9.1
  they are multi-node clusters. Corrected `E9` (3 analytics nodes + optional
  load-balancer VIP) and `E10` (appliance/cluster FQDN + services-runtime FQDN;
  nodes from the `/29`), and added `E14` for the fleet/services FQDNs new in 9.x
  (Cloud Proxy, License Server, Identity Broker, VCF services runtime). Updated
  `workbook-cell-mapping.md` to match (E9/E10 relabelled, E14 added). Verified
  the Architect (A), Security (F) and Depot (G) sections against the workbook —
  no changes needed. Closes #10.

## v0.2.0 — 2026-07-01
- Verified the `03-multi-az-prep.md` stretched-vSAN figures against Broadcom
  vSAN 9.x docs and corrected two:
  - Witness RTT is **tiered by host count**, not a flat ≤200 ms: ≤200 ms up to
    10 hosts/site, **≤100 ms** for 11–15 hosts/site, ≤500 ms for a single
    host/site. Updated M4 and the witness table.
  - Site-to-site bandwidth has **no fixed figure** — it's driven by the write
    bandwidth being mirrored. Replaced the "10 GbE+ typical" wording and pointed
    at VMware's bandwidth-sizing guidance.
  - Added the requirement for a **highly-available Layer 3 gateway** between AZs
    alongside the stretched L2 segments.
  - Confirmed the witness-bandwidth rule (~2 Mbps / 1000 vSAN components) and the
    <5 ms inter-site RTT are correct as written. Closes #9.

## v0.1.9 — 2026-07-01
- VCF 9.1 accuracy pass on `prerequisites.md` (cross-checked vs. the pinned
  workbook Prerequisite Checklist + Management Domain Sizing sheets and Broadcom
  9.1 TechDocs). The hardware minimums were already sound; added:
  - CPU: vSphere 9 **16-core/CPU** licensing minimum, size on physical cores,
    vCPU:pCPU ≤ 2:1.
  - A note that the **9.1 management footprint is larger** (~12 appliances /
    ~120 vCPU baseline incl. the VCF services runtime 3 control + 3 worker
    nodes) — don't reuse a 4.x/5.x host spec.
  - vSAN-OSA disk-group detail (600 GB cache/group, 6.25 TB capacity/group;
    32 GB host RAM for max disk groups).
  - A **vDS teaming** network requirement, overlay MTU ≥ 1600, and a sharper
    stretched-networks caveat (uplinks/edge overlay stretched only under NSX
    Centralized connectivity) cross-linked to `03-multi-az-prep.md`. Closes #8.

## v0.1.8 — 2026-07-01
- VCF 9.1 accuracy pass on the Step 1 Section A VLAN table and the Step 2 intake
  Network questions (follow-on from #6, cross-checked vs. the pinned workbook and
  Broadcom 9.1 TechDocs):
  - Added the **VPC Gateway / Distributed Transit Gateway external network**
    (VLAN row 11, intake `B20`, mapping row) — only for the Distributed
    connectivity model (`A10`).
  - Noted Host Overlay MTU is inherited from the vDS; overlay needs MTU ≥ 1600.
  - Clarified `B4` (VCF Management Services range = `/28`–`/27`, inside VM Mgmt)
    and `B5` (VCF Automation = 5 IPs / `/29`); reworded the Automation split,
    which the workbook and TechDocs describe differently. Closes #7.

## v0.1.7 — 2026-07-01
- `01-network-dns-plan.md`: reworked the Step 1 Section A IP range carve-out.
  The old single VM Mgmt row under-counted a VCF 9.1 management domain (~15 IPs)
  and was internally inconsistent. Split into host-facing subnets plus a proper
  VM Management appliance breakdown (~30–48 IPs): per-component counts for
  vCenter, NSX (3 + VIP), SDDC Manager, VCF Operations (3 analytics + cloud proxy
  + license server, optional VIP), the VCF Automation `/29`, and the VCF
  management-services runtime `/28`–`/27` (where the "12–30" actually belongs).
  Added a note on the separate internal `198.18.0.0/15` services CIDR. Counts
  cross-checked against the pinned workbook and Broadcom 9.1 TechDocs. Closes #6.

## v0.1.6 — 2026-07-01
- Web: improved readability of the wide fill-in tables (e.g. Step 1 Section A).
  Tables now use the full content width, empty cells show a faint placeholder,
  columns have dividers, and each table sits in a bordered scroll container for
  narrow screens. Running text keeps a comfortable reading measure. Bumped the
  Pages CI build to Node 22. Closes #5.

## v0.1.5 — 2026-07-01
- Added `web/` — an ITQ-branded Astro site published to GitHub Pages
  (<https://pauldiee.github.io/VCF9-DeploymentPlanning/>). Renders the existing
  `docs/*.md` in place via a glob content collection (markdown stays the single
  source of truth), themed entirely on the ITQ design tokens (Titillium, Royal
  Blue + Orange, square bullets). Landing page presents the Prereqs → Network →
  Intake → Multi-AZ → Mapping flow; sidebar nav + prev/next pager; `.md`
  cross-links rewritten to site routes. Deploys via
  `.github/workflows/deploy.yml` on pushes touching `web/` or `docs/`. Closes #4.

## v0.1.4 — 2026-07-01
- Added `docs/03-multi-az-prep.md` — standalone extra-prep checklist for
  stretched / multi-AZ (`A13`=Yes) builds: witness/third site, AZ1↔AZ2 fabric
  (≤5 ms / ≤200 ms latency budgets), stretched-vs-per-AZ networking, site+local
  storage-policy capacity, DNS/NTP additions, ownership matrix. README contents
  table updated; intake `A13` now cross-links the checklist. Closes #3.

## v0.1.3 — 2026-06-16
- README: added a "Related tools" section linking to Leonardo Coscia's
  browser-based VCF 9.1 planner (<https://vcfplanning.lcoscia.fr/>) alongside
  the two sister projects (VCF9ReadinessAssessment, VCFHealthCheck). Closes #2.

## v0.1.2 — 2026-05-15
- Pinned reference copy of the Broadcom workbook at
  `reference/vcf-9.1-planning-and-preparation-workbook.xlsx` (v1.9.1.001).
  Repo no longer relies on collaborators downloading the workbook themselves.
- Updated `.gitignore` and `CLAUDE.md` to reflect the new policy.

## v0.1.1 — 2026-05-15
- Added `CLAUDE.md` with project conventions, customer-data hygiene rules, and
  workbook-handling guidance for any collaborator's Claude Code instance.

## v0.1.0 — 2026-05-15
- Initial repo skeleton.
- Added customer-facing prerequisites checklist (`docs/prerequisites.md`).
- Added Step 1 one-page network / DNS / NTP / AD plan template
  (`docs/01-network-dns-plan.md`).
- Added Step 2 role-based customer intake questionnaire
  (`docs/02-customer-intake.md`).
- Added workbook cell mapping reference (`docs/workbook-cell-mapping.md`).
