# Changelog

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
