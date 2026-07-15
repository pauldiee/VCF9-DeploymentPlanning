# Backup Target & Binary Depot — Build Guide

Two pieces of *your* infrastructure that VCF 9.1 depends on but does not
deploy for you: the **SFTP backup target** every management component backs up
to, and the **binary depot** the platform installs and patches from. The
[prerequisites gate](prerequisites.md) states *what* must exist; this page
covers *how to build it* and the gotchas that cost redo time.

## Contents

**[A. SFTP backup target](#a-sftp-backup-target)**

| # | Section | Use it when |
| - | ------- | ----------- |
| A.1 | [What backs up to it (and how often)](#a1-what-backs-up-to-it-and-how-often) | Sizing the target and setting the schedule |
| A.2 | [Requirements and placement](#a2-requirements-and-placement) | Deciding where it lives and what it must support (**FIPS is the 9.x baseline**) |
| A.3 | [Building one (chrooted OpenSSH example)](#a3-building-one-chrooted-openssh-example) | Building the box |
| | ↳ [Linux variant (chroot jail)](#linux-variant-chroot-jail) | The common case — SFTP-only account in a jail |
| | ↳ [Windows Server variant](#windows-server-variant-built-in-openssh-server) | In-box OpenSSH, and the traps unique to it |
| A.4 | [Verify the target before you register it](#a4-verify-the-target-before-you-register-it) | **Before** you touch the VCF wizard |
| | ↳ [The check: force the FIPS negotiation](#the-check-force-the-fips-negotiation) | The ten-minute test that predicts whether VCF will connect |
| | ↳ [Three traps this catches](#three-traps-this-catches) | ETM MACs, legacy `ssh-rsa`, the path format |
| | ↳ [Windows targets: a word of caution](#windows-targets-a-word-of-caution) | Deciding whether to run the target on Windows at all |
| A.5 | [When the target will not configure (field notes)](#a5-when-the-target-will-not-configure-field-notes) | **The wizard fails and tells you nothing** |
| | ↳ [Read the sshd log correctly](#read-the-sshd-log-correctly-or-you-will-chase-ghosts) | Most `[preauth]` lines are **probes, not failures** |
| | ↳ [A failed submit stores nothing](#a-failed-submit-stores-nothing) | An empty Backup & Restore table means the task failed |
| | ↳ [The clients are the whole services-runtime block](#the-clients-are-the-whole-services-runtime-block) | Firewall the **block**; offer a **superset** of algorithms |
| | ↳ [Two `sshd_config` traps](#two-sshd_config-traps) | Crypto cannot live in a `Match` block; host-key changes break the pin |
| | ↳ [Getting the fingerprint](#getting-the-fingerprint-not-with-windows-ssh-keyscan) | Windows `ssh-keyscan` is broken — read it on the server |
| | ↳ [Ask the API what was actually stored](#ask-the-api-what-was-actually-stored) | The endpoints, and the two scripts in `tools/` |
| A.6 | [Cold backup / cold maintenance](#a6-cold-backup--cold-maintenance-safely-shutting-down-the-management-services) | Safely shut the management plane down — Broadcom's `vcf_services_runtime_shutdown.sh` |
| A.7 | [References](#a7-references) | The TechDocs and KBs behind the above |

**[B. Binary depot](#b-binary-depot--offline-depot--the-vcf-download-tool)**

| # | Section | Use it when |
| - | ------- | ----------- |
| B.0 | [Three ways to feed binaries](#b0-three-ways-to-feed-binaries) | Choosing: online depot, offline depot, or manual transfer |
| B.1 | [Setting up an offline depot](#b1-setting-up-an-offline-depot) | The site has no internet path to Broadcom |
| | ↳ [Step 1 — Depot web server](#step-1--depot-web-server) | Sizing and certifying the box |
| | ↳ [Photon OS variant (offline build)](#photon-os-variant-offline-build) | Air-gapped nginx install (ISO/RPM), serve the store, iptables — end to end |
| | ↳ [Step 2 — Auth split](#step-2--auth-split) | What to protect with basic auth, and what must stay open |
| | ↳ [Step 3 — VCF Download Tool](#step-3--vcf-download-tool) | Getting the tool |
| | ↳ [Step 4 — Activation code](#step-4--activation-code) | **Start here early** — the Product Administrator role takes days |
| | ↳ [Step 5 — Download the binaries](#step-5--download-the-binaries) | The actual `binaries download` / `esx download` runs |
| | ↳ [Step 6 — Transfer to the air-gapped server](#step-6--transfer-to-the-air-gapped-server) | Moving the store across the gap intact |
| | ↳ [Step 7 — Connect VCF to it](#step-7--connect-vcf-to-it) | Pointing the Installer (and later the fleet) at the depot |
| B.2 | [Manual transfer — feeding the VCF Installer without a depot server](#b2-manual-transfer--feeding-the-vcf-installer-without-a-depot-server) | You have no depot server at all and need bits on the Installer |
| B.3 | [Using the Download Tool standalone](#b3-using-the-download-tool-standalone) | Pulling binaries without standing up a depot |
| B.4 | [Proxy for the VCF services runtime](#b4-proxy-for-the-vcf-services-runtime-via-the-fleet-lcm-api) | The fleet has no direct internet — set the `G5` proxy on the runtime via the Fleet LCM API (+ `tools/` scripts) |
| | ↳ [Gotcha: precheck is a netcat test from the whole node block](#gotcha-the-precheck-is-a-netcat-test-from-the-whole-node-block--even-when-the-documented-access-is-in-place) | **Precheck times out even with the documented access** — firewall the whole services-runtime block |
| B.5 | [References](#b5-references) | The TechDocs behind the above |

---

## A. SFTP backup target

### A.1 What backs up to it (and how often)

| Component                             | Cadence (recommended)             | Note                                                        |
| ------------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| SDDC Manager                          | Daily, 7-day retention            | Configure after bring-up                                     |
| vCenter (every instance)              | Daily, 7-day retention            | **Manual, per instance, in the vCenter Management Interface (VAMI)** — see below. Jobs must start within the **same 5-minute window** as the SDDC Manager job |
| NSX Manager                           | Hourly, 7-day retention           | Configured **automatically at bring-up**                     |
| VCF Automation + VCF Identity Broker  | Follows the VCF Operations target | The SFTP config **propagates** to these — incorrect values make the Identity Broker backup config fail |
| vSphere Distributed Switch            | On-demand export, keep last 3     | Manual                                                       |

The fleet target is configured in **VCF Operations**: host FQDN/IP, port 22,
the service account, the backup directory, the **encryption passphrase**, then
**Fetch Fingerprint** to confirm the server's SSH host key. Validate the
credentials before saving — wrong values propagate to the fleet components and
fail there. Monitor free space on the target: a full retention window of every
component lands on it.

> **vCenter backup is NOT configured by VCF.** Setting the fleet SFTP target
> covers SDDC Manager, NSX and the fleet components — but each vCenter's
> file-based backup must be set up **manually** in that vCenter's own
> management interface (VAMI, `https://<vcenter-fqdn>:5480` → Backup):
> schedule, target, retention, per instance. Easy to miss because everything
> else is handled centrally — make it an explicit task per vCenter (it's in
> the deployment plan, story 6.4).

> **The passphrase is a restore-blocker.** Backups are encrypted with the
> passphrase you set here; restore is impossible without it. Store it in a
> password manager with a named owner (intake `F11` pattern) — treat a lost
> passphrase as having no backups at all.

### A.2 Requirements and placement

- SFTP over SSH, TCP **22**, reachable from the VCF management network.
- The server must support **256-bit ECDSA and 2048-bit RSA SSH keys**, and its
  **host key algorithms** must include at least one of `rsa-sha2-512` /
  `rsa-sha2-256` **and** one of `ecdsa-sha2-nistp256` / `nistp384` / `nistp521`.
- **FIPS raises the bar — and in 9.x you don't get a choice.** In new VCF 9.0+
  deployments *"FIPS compliance in SDDC Manager is on by default and cannot be
  turned off"* (only an SDDC Manager **upgraded** from 5.x with FIPS off keeps
  it off). So the FIPS-mode SFTP requirements are the **baseline** on any fresh
  9.1 build, not an optional extra: the SFTP server must additionally offer a
  **KEX** algorithm from `diffie-hellman-group-exchange-sha256`,
  `ecdh-sha2-nistp256`, `ecdh-sha2-nistp384`, `ecdh-sha2-nistp521` — and the
  **MAC** `hmac-sha2-256`. Verify it with A.4 below.
- Service account + write path pre-created (e.g. `svc-vcf-bck` → `/backups/`).
- Put it **outside the management domain it protects** — a backup target that
  dies with the platform is not a backup. A VM on separate infrastructure, a
  physical host, or a NAS with SFTP all work; in multi-AZ designs prefer a
  different fault domain than the primary management AZ.
- Static IP and DNS A + PTR records, like every other appliance in the plan.

### A.3 Building one (chrooted OpenSSH example)

Anything that speaks SFTP over SSH qualifies — a NAS, Windows Server with
OpenSSH Server, or (most common) a small Linux VM.

#### Linux variant (chroot jail)

The hardened pattern is an SFTP-only account locked in a chroot jail:

```text
# /etc/ssh/sshd_config
Subsystem sftp internal-sftp
Match Group sftpbackup
    ChrootDirectory /sftp/%u
    ForceCommand internal-sftp
    AllowTcpForwarding no
    X11Forwarding no
```

- Create the account with **no login shell**:
  `groupadd sftpbackup && useradd -g sftpbackup -s /sbin/nologin -m svc-vcf-bck`.
- The chroot directory itself (`/sftp/svc-vcf-bck`) must be **root-owned,
  0755**; create the writable backup directory *below* it
  (`/sftp/svc-vcf-bck/backups`) owned by the service account.
- **Path gotcha:** VCF sees paths *relative to the chroot* — enter `/backups`
  as the backup directory, not the full server-side path.
- **Validation gotcha:** the backup wizards run reachability pre-checks —
  minimal OS builds (e.g. Photon OS) drop ICMP by default; allow ping and
  TCP 22 from the management network or the wizard fails before saving.

#### Windows Server variant (built-in OpenSSH Server)

The same pattern works on Windows Server with the in-box OpenSSH Server:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service sshd -StartupType Automatic
Start-Service sshd
Get-NetFirewallRule -Name OpenSSH-Server-In-TCP   # confirm the TCP 22 inbound rule exists
```

- **Service gotcha:** installing the capability does **not** enable the
  service — without the `Set-Service` line, `sshd` stays *Manual* and is gone
  after the first reboot.
- Create a dedicated **local, non-admin** account (e.g. `svc-vcf-bck`) and keep
  `PasswordAuthentication yes` (the default) in
  `C:\ProgramData\ssh\sshd_config` — VCF authenticates with username +
  password. Grant the account NTFS *Modify* on the backup folder only.
- **Path gotcha (Windows edition):** VCF expects an absolute Unix-style backup
  directory. On Windows OpenSSH that is `/C:/vcf-backups` — leading slash,
  drive letter, forward slashes; `C:\vcf-backups` fails validation.
- The stock Windows `sshd_config` ends with a `Match Group administrators`
  block that points **all administrators at one shared**
  `__PROGRAMDATA__/ssh/administrators_authorized_keys` file. Harmless for
  password auth with a non-admin account, but it is the classic
  Windows-specific surprise if the service account is an administrator or you
  switch to key auth — one more reason for the dedicated non-admin account.
- An SFTP-only lockdown works like on Linux: a `Match User svc-vcf-bck` block
  with `ForceCommand internal-sftp` (plus `ChrootDirectory`, which must be
  owned by Administrators/SYSTEM and not writable by the account). Restart
  after any config edit: `Restart-Service sshd`.
- **Host-key gotcha:** VCF pins the server's SSH fingerprint when you register
  the target. Reinstalling OpenSSH or rebuilding the VM regenerates the host
  keys — backups then fail until the target is re-confirmed.
- Validate from the management network **before** registering:
  `Test-NetConnection <fqdn> -Port 22`, then a real `sftp` login and a `put`
  of a test file into the backup directory.

### A.4 Verify the target before you register it

Whether you built the target or were handed one, prove the SSH handshake VCF
needs actually completes.

#### The check: force the FIPS negotiation

Don't audit `sshd_config` — **force the negotiation down to the FIPS-approved
algorithms and see if it connects.** If these two logins succeed from the
management network, SDDC Manager's will too:

```console
# ECDSA host-key path
ssh -o KexAlgorithms=ecdh-sha2-nistp256 \
    -o MACs=hmac-sha2-256 \
    -o HostKeyAlgorithms=ecdsa-sha2-nistp256 \
    -o Ciphers=aes256-ctr \
    svc-vcf-bck@sftp01.sfo.example.io

# RSA host-key path (rsa-sha2-*, never legacy ssh-rsa)
ssh -o KexAlgorithms=ecdh-sha2-nistp256 \
    -o MACs=hmac-sha2-256 \
    -o HostKeyAlgorithms=rsa-sha2-512,rsa-sha2-256 \
    -o Ciphers=aes256-ctr \
    svc-vcf-bck@sftp01.sfo.example.io
```

To see everything the server advertises in one shot:
`nmap --script ssh2-enum-algos -p 22 sftp01.sfo.example.io`. To confirm the key
sizes: `ssh-keyscan -t ecdsa,rsa sftp01.sfo.example.io | ssh-keygen -lf -` —
expect a **256**-bit ECDSA and a **≥ 2048**-bit RSA line.

Then exercise SFTP itself as the service account (`sftp svc-vcf-bck@…`, `cd`
to the backup directory, `put` a test file) and note **the path the server
reports** — that, not the OS path, is what goes into the wizard. Finally, in
**VCF Operations**, use **Fetch Fingerprint** and confirm it matches the
`ssh-keygen -lf` output above.

#### Three traps this catches

- **`hmac-sha2-256` vs `hmac-sha2-256-etm@openssh.com`** — different algorithm
  names. Hardened servers often offer only the **ETM** variant, which passes a
  hardening scan and **fails VCF**. The `-o MACs=hmac-sha2-256` test above is
  the precise check.
- **Legacy `ssh-rsa` (SHA-1) is gone** — OpenSSH **8.8+** disables it by
  default, which is exactly what broke SFTP backup validation on older VCF
  ([KB 372839](https://knowledge.broadcom.com/external/article/372839/backup-configuration-fails-during-backup.html);
  fixed from VCF 5.1.1, so 9.1 is fine — it's why everything leans on ECDSA).
- **The path format** — see the Windows gotcha in A.3: `sftp` shows
  `/C:/vcf-backups`, and anything else fails with *"Invalid parameter:
  validation failed for directory path"*.

#### Windows targets: a word of caution

> **A word on Windows targets.** Broadcom's own KBs don't say Windows is
> unsupported, but a Dell/VxRail KB reports that SDDC Manager backups to
> Windows were only ever tested with **Cygwin**, and that native OpenSSH on
> Windows Server 2019 produced failures — recommending a Linux target instead.
> Treat that as a field report, not policy: the checks above will tell you in
> ten minutes whether a given Windows box works. But this is the one
> requirement where *"it validated"* and *"the restore works"* are the same
> question, so if there's no strong reason to run it on Windows, the Linux
> pattern in A.3 is the better-trodden path.

> The `Ciphers` list on Broadcom's SFTP prerequisites page is written as **TLS**
> cipher-suite names (`TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384`, …), which are
> not SSH cipher names and don't apply to this handshake — a doc quirk. For
> SFTP, make sure the server offers **AES-CTR / AES-GCM** and doesn't depend on
> `chacha20-poly1305` (not FIPS-approved).

### A.5 When the target will not configure (field notes)

Everything below was learned the hard way on a 9.1 build whose backup target
refused to configure. None of it is in the product documentation.

#### Read the sshd log correctly, or you will chase ghosts

Tail the SFTP server while you submit: `journalctl -u sshd -f`. Then know what
you are looking at, because **most of what you see is not a failure**:

| Log line | What it means |
| -------- | ------------- |
| `Connection closed by 10.x.x.x port N [preauth]` — **no username** | **A host-key probe, not a failure.** VCF fetching the fingerprint: connect, complete key exchange, read the host key, hang up. They arrive in **bursts of three** (one per key type) and appear on **working** configurations too. Ignore them |
| `Accepted ... for svc-vcf-bck` | The real thing. This is what success looks like |
| `Invalid user 4b6b5201-…` — a **UUID** as the username | The platform is presenting a **credential identifier** instead of the account name. Abnormal — a healthy fleet sends the username you typed. Worth a support case |

**The only lines that mean anything have a username in them.** A bare
`[preauth]` close is noise, and mistaking it for the fault costs an afternoon.

#### A failed submit stores nothing

Submitting the backup location starts a **validation workflow** (*Build →
Lifecycle → VCF Management → Tasks*). If that workflow fails, **the
configuration is not saved** — so an empty Backup & Restore table does not mean
you forgot to press Add; it means the task failed. Worse, the UI's task detail
bottoms out at *"check the errors in the next sub-task(s)"* with **no next
sub-task**. Expect no useful error from the interface, and go to the sshd log
and the API instead.

#### The clients are the whole services-runtime block

The connections do **not** come from a few stable appliances. They come from the
**VCF management-services runtime** (VMSP) on **arbitrary pod addresses** across
its block, and from several different services — each with its **own SSH client
stack**, which is why they negotiate differently from one another.

Two consequences:

- **Open TCP 22 from the entire services-runtime block**, not from named hosts.
  A rule written for three addresses works today and fails the moment a service
  restarts onto a fourth. (Testing with WinSCP from the jump host proves nothing
  here — the jump host is not the client.)
- **Offer a superset of algorithms; do not narrow.** Some of these services are
  **not** FIPS-constrained: they want **ed25519** host keys, **curve25519** key
  exchange, and will happily offer `chacha20-poly1305` and `hmac-sha1`. Tuning
  `sshd_config` down to only the FIPS-approved set to satisfy one client will
  break another. Offer all three host-key types and both MAC families and let
  each client pick — a FIPS-mode client still negotiates FIPS algorithms,
  because that is all *it* will accept.

#### Two `sshd_config` traps

- **The crypto directives cannot live in a `Match` block.** `KexAlgorithms`,
  `Ciphers`, `MACs` and `HostKeyAlgorithms` are **global-only** — they are
  negotiated before sshd knows which user is connecting. Community walkthroughs
  tell you to append their `Match Group sftpbackup` block **at the bottom** of
  `sshd_config`, so appending crypto afterwards lands it **inside** that block
  and **sshd refuses to start**:

  ```text
  /etc/ssh/sshd_config line 128: Directive 'KexAlgorithms' is not allowed within a Match block
  sshd.service: Failed with result 'exit-code'.
  ```

  Put the crypto block **above the first `Match` line**, and run `sshd -t`
  before restarting. Keep a root session open while you do.

- **Changing the host keys invalidates the pinned fingerprint.** VCF pins the
  fingerprint when you register the target. If you add, remove or regenerate
  host keys afterwards, **re-fetch it** — otherwise validation fails and
  (see above) nothing is stored.

#### Getting the fingerprint: not with Windows `ssh-keyscan`

The in-box Windows client (**OpenSSH_for_Windows_9.5p2**) advertises the
post-quantum `sntrup761x25519-sha512` key exchange and then **cannot perform
it**, so `ssh-keyscan` dies during key exchange against any modern server and
prints nothing at all:

```console
choose_kex: unsupported KEX method sntrup761x25519-sha512@openssh.com
```

That is a **client** bug and says nothing about your target. Read the fingerprint
**on the SFTP server**, where no SSH client is involved:

```console
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub
ssh-keygen -lf /etc/ssh/ssh_host_rsa_key.pub
```

VCF's own **Fetch Fingerprint** button is equally authoritative.

#### Ask the API what was actually stored

When the interface tells you nothing, the Fleet lifecycle API tells you what the
platform is really holding — which is not always what you typed:

```text
GET   https://<FleetLCM>/fleet-lcm/v1/sddc-lcms
        -> backupConfig.storage.sftp { host, port, username, directory }
           backupConfig.fullSchedule / .retention
GET   https://<FleetLCM>/fleet-lcm/v1/sddc-lcms/{id}/backups     -> history
PATCH https://<FleetLCM>/fleet-lcm/v1/sddc-lcms/{id}             -> set the location
        { "backupConfigSpec": { "encryptionPassphrase": …,
            "storage": { "sftp": { host, port, username, password, directory, thumbprint } } } }
```

Authentication is a three-call chain through VCF Operations, the only issuer the
Fleet lifecycle service trusts: `POST /suite-api/api/auth/token/acquire` →
`POST /suite-api/api/auth/token/exchange` with `serviceKeys=["fleet-lcm"]` →
`Bearer` the resulting JWT.

Three things about that API cost us hours:

- **Reads *and* writes belong on the fleet appliance.** The browser sends the
  PATCH to `https://<VCFOps>/vcf-operations/plug/fleet-lcm/…`, but that path is
  the **user interface's session-authenticated route** — it works because the
  browser holds a logged-in Ops session cookie. A token client gets **HTML on a
  GET** and **405 on a PATCH** there. Copy the *payload* from the browser, never
  the URL.
- The write wrapper is **`backupConfigSpec`**, while the same data reads back as
  **`backupConfig`**.
- **`port` is a string** (`"22"`), and a **`thumbprint`** is required.

Two PowerShell scripts do all of the above — **download them and run them**
(Windows PowerShell 5.1 or PowerShell 7; they prompt for whatever you don't pass):

| Script | What it does |
| ------ | ------------ |
| [**Get-VCFBackupConfig.ps1**](https://pauldiee.github.io/VCF9-DeploymentPlanning/scripts/Get-VCFBackupConfig.ps1) | **Read-only.** Prints the backup target, the **stored username**, directory, schedule, retention and history that the platform *actually holds* — which is not always what you typed. Flags an empty username, and a username that is an identifier rather than an account name. Changes nothing |
| [**Set-VCFBackupConfig.ps1**](https://pauldiee.github.io/VCF9-DeploymentPlanning/scripts/Set-VCFBackupConfig.ps1) | **Sets the backup location** through the API, for when the wizard will not take it. `-WhatIf` prints the exact payload (secrets masked) without sending it; `-ShowThumbprint` helps with the fingerprint |

```console
.\Get-VCFBackupConfig.ps1 -VCFOps ops01.sfo.example.io -FleetLCM fleet01.sfo.example.io -SkipCertificateValidation
```

Setting the target through the API **bypasses the interface entirely**, which is
the cleanest way to prove whether a stubborn failure is in the UI or in the
platform: it puts the username on the wire *explicitly*, so if the sshd log still
shows an identifier instead of the account, the substitution is happening
server-side and you have a defect worth reporting.

### A.6 Cold backup / cold maintenance: safely shutting down the management services

The SFTP target above is the platform's *online* backup. Some operations instead
need the management plane **fully down** first: a **cold backup or VM-level
snapshot** of the appliances, **planned vSphere maintenance** under them, a
**datacenter power event**, or a **decommission**. For those you must safely shut
down the **VCF services runtime** — the same `VSP` cluster the proxy in
[B.4](#b4-proxy-for-the-vcf-services-runtime-via-the-fleet-lcm-api) configures.
Broadcom KB: [How to Safely Shutdown All Nodes Within a VCF Services Runtime Cluster](https://knowledge.broadcom.com/external/article/440874/how-to-safely-shutdown-all-nodes-within.html)
(covers both the Fleet cluster and Instance clusters).

**Do not hand-stop the components.** The runtime has an internal shutdown order,
and Broadcom ships the automation for it: **`vcf_services_runtime_shutdown.sh`**,
which drives the sequence through the runtime API (**port 5480**) on the
**control-plane node**. The KB warns the procedure "stops all VCF management
components running on the platform" (KB 440874) — Log Management, Realtime
Metrics, VCF Operations Lifecycle and Configuration Management, and the rest. This
is the whole plane going dark, on purpose.

**Prep (on the machine you run the script from):**

- Install `curl`, `jq` and **`govc`** (the last is what powers the VMs off).
- Find the **control-plane node** and get onto it (recipe below).
- Copy that node's **kubeconfig** (`/etc/kubernetes/admin.conf`) to pass with
  `--kubeconfig`.

**Getting a `kubectl` session on the control-plane node.** You need this here for
the kubeconfig, and again in
[B.4](#gotcha-the-precheck-is-a-netcat-test-from-the-whole-node-block--even-when-the-documented-access-is-in-place)
to read the proxy precheck logs:

1. In VCF Operations — **Build > Lifecycle > Components**, click **VCF Services
   Runtime**, scroll to **Nodes** — note the **control-plane** node's IP / FQDN.
2. **SSH to it as `root`** (the shell prompt reads `root@<node>`); the node's root
   credential is the one set for the services runtime at deployment.
3. `kubectl` is already on the node and wired to the cluster —
   **`kubectl get nodes`** should list them. If it does not, point it at the admin
   config first: **`export KUBECONFIG=/etc/kubernetes/admin.conf`**.
4. To run a tool (like the shutdown script) from *another* machine instead, copy
   `/etc/kubernetes/admin.conf` off the node and pass it with `--kubeconfig`.

**Run it (three modes, safest first):**

| Mode | Command | Effect |
| ---- | ------- | ------ |
| **Dry run** (do this first) | `./vcf_services_runtime_shutdown.sh --node-ip <NODE_IP> --dry-run --kubeconfig <file>` | Prints the plan, changes nothing |
| **Stop services, leave VMs up** | `./vcf_services_runtime_shutdown.sh --node-ip <NODE_IP> --skip-poweroff --kubeconfig <file>` | Quiesces the components; appliances stay powered on |
| **Full (also power off VMs)** | `export VCENTER_USERNAME=administrator@vsphere.local; export VCENTER_PASSWORD=<pwd>; ./vcf_services_runtime_shutdown.sh --node-ip <NODE_IP> --kubeconfig <file>` | Stops the components **and** powers off the VMs |

The **vCenter URL is auto-discovered from the `vsp` component config** (the same
component the proxy scripts read); override with `export GOVC_URL=https://<vcenter>`.

**Notes worth keeping:**

- **Always `--dry-run` first.** It exercises the whole path and prints each phase
  without touching anything.
- **`--skip-poweroff` decouples the two halves.** Stop the services with the
  script, then take the VM snapshot / do the maintenance / power off in vSphere on
  your own terms — useful when the shutdown host has no `govc` or no vCenter
  credentials to hand.
- **Power-on** is not scripted here: bring the VMs back up in vSphere and the
  runtime restarts its components. KB 440874 documents the *shutdown*; verify
  recovery **in-product** rather than assuming an order.

### A.7 References

- TechDocs: [File-Based Backups for SDDC Manager, NSX Manager and vCenter](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/backup-and-restore-of-cloud-foundation/file-based-backups-for-sddc-manager-and-vcenter-server.html)
  and [Configure SFTP Backup Target in VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/backup-and-restore-of-cloud-foundation/configure-sftp-backup-target-in-vmware-cloud-foundation-operations.html).
- The SSH key / algorithm requirements (incl. the FIPS KEX + MAC lists) are
  spelled out in [Reconfigure SFTP Backups for SDDC Manager and NSX Manager](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-5-2-and-earlier/5-2/map-for-administering-vcf-5-2/backup-and-restore-of-cloud-foundation-admin/reconfigure-sftp-backups-for-sddc-manager-and-nsx-manager-admin.html)
  — a **5.2** page, but the 9.x *Configure SFTP Backup Target* page doesn't
  restate them, and they still apply.
- FIPS-by-default in 9.x: [FIPS Configuration for VCF Components](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/fips-compliance-for-vcf-components.html).
- Cold shutdown of the management plane (A.6): [How to Safely Shutdown All Nodes Within a VCF Services Runtime Cluster](https://knowledge.broadcom.com/external/article/440874/how-to-safely-shutdown-all-nodes-within.html)
  (Broadcom KB 440874 — the `vcf_services_runtime_shutdown.sh` script and its modes).
- Community walkthroughs: [SFTP server on Photon OS for VCF 9.1 backups](https://topvcf.com/2026/05/19/5685/)
  (chroot jail, end to end) and [SFTP on Ubuntu Server](https://www.velements.net/2024/10/12/setup-sftp-on-ubuntu-server/)
  (includes re-enabling `ssh-rsa` host-key algorithms for older VMware
  components).

---

## B. Binary depot — offline depot & the VCF Download Tool

### B.0 Three ways to feed binaries

Pick one (intake `G1`):

- **Online depot** — VCF Installer (and later the fleet) connect to the
  Broadcom depot directly using the **Download Service ID + Activation Code**
  (intake `G2`/`G3`; how to obtain them — and the Product-Administrator-role
  gotcha — is in B.1 step 4). Needs outbound
  443 to the [Public URLs table](prerequisites.md#public-urls-online-functionality)
  (via the proxy from intake `G5` if there is one — for the **fleet's** own proxy,
  set on the VCF services runtime, see [B.4](#b4-proxy-for-the-vcf-services-runtime-via-the-fleet-lcm-api)). TechDocs:
  [Connect VCF Installer to Broadcom or an Offline Depot and Download Binaries](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance/connect-to-an-online-depot-to-download-binaries.html).
- **Offline depot** — for air-gapped sites the **VCF Download Tool** is the
  only supported method in 9.1. It downloads a **depot store** on an
  internet-connected host; your own web server serves that store to the VCF
  Installer and the fleet. The tool replaced the old Offline Bundle Transfer
  Utility (OBTU) and wraps **UMDS** for ESX patch data. TechDocs:
  [Download Binaries to an Offline Depot by Using the VCF Download Tool](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/lifecycle-management/binary-management-for-vmware-cloud-foundation/download-bundles-to-an-offline-depot.html).
- **Manual transfer** — no depot at all: run the **VCF Download Tool** on any
  internet-connected machine, copy the depot store onto the **VCF Installer
  appliance itself** and import it there. No web server to build — best for a
  one-off install; see B.2 for the steps and the Day-N caveat. TechDocs:
  [Manually Transfer Binaries to VCF Installer](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance/use-the-vmware-download-tool-to-download-binaries.html).

### B.1 Setting up an offline depot

#### Step 1 — Depot web server

A Linux or Windows VM (any distribution), **static IP** (DNS record
recommended), a **dedicated disk** for the depot store (sizing below), and any
web server (Apache, NGINX) serving **HTTPS with TLS 1.2/1.3**. Give it a
certificate with the FQDN *and* IP as SANs — signed by your CA, or self-signed
if you accept the trust-import step (step 7 below).

**Generating the cert (self-signed).** The gotcha: modern clients — the VCF
Installer included — **ignore the CN and read only the `subjectAltName`**, so a
cert with just a CN is rejected even though it looks valid. Put the FQDN *and* the
IP in the SANs:

```bash
mkdir -p /etc/nginx/ssl
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout /etc/nginx/ssl/depot.key -out /etc/nginx/ssl/depot.crt \
  -subj "/CN=depot01.sfo.example.io" \
  -addext "subjectAltName=DNS:depot01.sfo.example.io,IP:10.11.10.20"
chmod 600 /etc/nginx/ssl/depot.key
```

`-addext` needs OpenSSL 1.1.1+ (Photon 4/5 both have it). For a **CA-signed** cert
instead, swap `-x509 … -out depot.crt` for `-new … -out depot.csr`, hand the CSR
to your CA, and drop the returned cert in as `depot.crt`. Once the cert is in
place and referenced in the server block, load it with **`nginx -t && systemctl
reload nginx`** (a running nginx re-reads its certs on reload; `restart` works
too). A self-signed cert means the VCF Installer must trust it — see step 7.

> **HTTP depot (9.1) — skips the cert, but drops auth *and* the UI.** VCF 9.1
> added support for an offline depot served over **plain HTTP** (the VCF Installer
> and the Fleet Depot Service). It avoids the certificate entirely, but two things
> change: **there is no authentication** — an HTTP depot is anonymous (the Step 2
> auth split exists only on HTTPS, as the Installer UI itself notes: *"Authentication
> is supported only with an HTTPS offline depot"*) — and the **Installer UI will
> not register an HTTP depot; you must use the VCF Installer API**. On nginx it is
> just `listen 80;` with no `ssl_*` and no `auth_basic` (open **80** instead of 443
> in iptables). Only worth it on a locked-down segment where an unauthenticated
> depot is acceptable; otherwise stay on HTTPS + a self-signed cert + the step 7
> trust-import. Ref: William Lam,
> [New HTTP Offline Depot Support for VCF Installer & Fleet Depot Service](https://williamlam.com/2026/05/vcf-9-1-new-http-offline-depot-support-for-vcf-installer-fleet-depot-service.html).

> **Disk sizing.** **Start around 300 GB** for the initial INSTALL depot (the
> bring-up bundles + component OVAs + ESX ISO). Broadcom's own recommendation is
> to provision **≥ 1 TB**, and that headroom is real rather than padding: the
> store **grows every Day-N patch cycle** — the fleet Depot Service side-loads
> too (see the [B.2 Day-N caveat](#b2-manual-transfer--feeding-the-vcf-installer-without-a-depot-server)) — on the order of a few GB per ESX patch pull. So
> **build on ~300 GB, provision the 1 TB.** No authoritative *content* footprint
> is published; 300 GB is a field starting point, not a hard minimum.

> **Ports.** The only listening port the platform needs on the depot server is
> **inbound TCP 443 (HTTPS)** — the web server. The clients that pull from it are
> the same "Needed by" set as the [Public URLs table](prerequisites.md#public-urls-online-functionality),
> just pointed at *your* depot instead of Broadcom: the **VCF Installer** at
> bring-up, then the **SDDC Manager / VCF Operations depot services runtime /
> vCenter** for Day-N patching. Open 443 to the depot from the management network
> **and the whole services-runtime block** — the fleet Depot Service pulls from
> there, the same "firewall the block" lesson as the proxy in
> [B.4](#b4-proxy-for-the-vcf-services-runtime-via-the-fleet-lcm-api). No inbound
> 80 is required; serve HTTPS only (an 80 → 443 redirect is optional convenience,
> not a requirement). **Outbound:** the depot box needs none — *unless* it is also
> the internet-connected host running the VCF Download Tool, in which case it
> needs outbound TCP 443 to the Broadcom Public URLs. An air-gapped depot (store
> copied in) makes no outbound connections.

#### Photon OS variant (offline build)

Photon is a natural pick for the depot box — lightweight and VMware-native — but
it is a *minimal* image, and it is usually the **air-gapped** box, so the generic
"`tdnf install nginx`, point a web server at the store" needs spelling out. End to
end:

**1. Install nginx — offline.** The box typically has no internet, so `tdnf` needs
a local source. Two ways, no internet required either way:

- **From the Photon ISO (no second machine).** Photon ships a preconfigured
  `photon-iso` repo pointing at `file:///mnt/cdrom/RPMS`. Mount the **full** ISO
  the appliance was built from (the *minimal* ISO may not carry nginx), refresh
  the cache, and install from it alone:

  ```bash
  mkdir -p /mnt/cdrom && mount /dev/cdrom /mnt/cdrom   # or: mount -o loop photon-full-<ver>.iso /mnt/cdrom
  tdnf makecache
  tdnf install --disablerepo=* --enablerepo=photon-iso nginx
  ```

- **Or pre-download on an online Photon of the *identical* version/arch**, copy
  the RPMs across (scp / USB), and install locally — deps resolve among them:

  ```bash
  # online box:      tdnf install --downloadonly --downloaddir=/root/nginx-rpms nginx
  # air-gapped box:  cd /root/nginx-rpms && tdnf install ./*.rpm
  ```

  (If the box can reach the [proxy from B.4](#b4-proxy-for-the-vcf-services-runtime-via-the-fleet-lcm-api),
  set `proxy=` in `/etc/tdnf/tdnf.conf` and just `tdnf install nginx`.)

**2. Create the store directory** — this *is* what you serve, and what the
Download Tool writes into (pass it as `--depot-store` in Step 5):

```bash
mkdir -p /var/www/offline_depot
chown -R nginx:nginx /var/www/offline_depot && chmod -R a+rX /var/www/offline_depot
```

nginx runs as the **`nginx`** user, so it must be able to read the tree; Photon
has **no SELinux**, so there is no doc-root labeling step you would hit on RHEL.

**3. Serve it over HTTPS with the Step 2 auth split.** Add a server block to the
`http { }` of `/etc/nginx/nginx.conf` (or `/etc/nginx/conf.d/depot.conf` if it
includes `conf.d`):

```nginx
server {
    listen 443 ssl;
    server_name depot01.sfo.example.io;        # must be in the cert SANs
    ssl_certificate     /etc/nginx/ssl/depot.crt;
    ssl_certificate_key /etc/nginx/ssl/depot.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    root      /var/www/offline_depot;          # the --depot-store dir
    autoindex on;                              # directory listing — handy to verify the tree

    # Step 2 auth split: protect COMP + metadata; HCL + UMDS stay open
    location /PROD/COMP     { auth_basic "VCF Depot"; auth_basic_user_file /etc/nginx/.htpasswd; }
    location /PROD/metadata { auth_basic "VCF Depot"; auth_basic_user_file /etc/nginx/.htpasswd; }
    # /PROD/vsan/hcl and /umds-patch-store have no auth_basic -> open, as required
}
```

Create the basic-auth user **without `htpasswd`** (it ships in `httpd-tools`,
absent on the minimal image) — generate the hash with openssl and write the line:

```bash
printf 'depotuser:%s\n' "$(openssl passwd -apr1)" > /etc/nginx/.htpasswd
chmod 640 /etc/nginx/.htpasswd && chown root:nginx /etc/nginx/.htpasswd
```

**4. Open inbound 443 in iptables.** Photon's default firewall allows only SSH
(22) inbound and **drops ICMP**, so the rule must be added *and persisted* or it
is lost on reboot:

```bash
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
iptables-save > /etc/systemd/scripts/ip4save   # Photon's iptables persistence file
systemctl restart iptables
```

(Add `iptables -A INPUT -p icmp -j ACCEPT` before saving if you also want the box
to answer ping for reachability tests — see the ICMP note in A.3.)

**5. Start + verify:**

```bash
nginx -t && systemctl enable --now nginx
curl -k https://depot01.sfo.example.io/PROD/vsan/hcl/            # open      -> 200
curl -k -u depotuser https://depot01.sfo.example.io/PROD/COMP/  # protected -> prompts
```

Everything else — the cert SANs, the auth-split rationale (Step 2), and connecting
VCF (Step 7) — is the same as the generic build.

#### Step 2 — Auth split

Protect `PROD/COMP` and `PROD/metadata` with **basic auth** (`htpasswd`); leave
`PROD/vsan/hcl` and `umds-patch-store` open. The `umds-patch-store` directory
name is **hardcoded** — don't rename it.

#### Step 3 — VCF Download Tool

Download it from the Broadcom Support Portal (*My Downloads → VMware Cloud
Foundation → your version → Drivers & Tools*) and extract it on an
internet-connected host — the depot server itself if it's allowed out,
otherwise any staging machine.

#### Step 4 — Activation code

From 9.1, whatever connects to Broadcom for binaries (VCF Installer, a software
depot, the Download Tool) must be **registered in the VCF Business Services
console** — the authoritative how-to is
[Software Depot Registration in the VCF Business Services Console](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/business-services/home/depot-service-authentication-in-the-vcf-business-services-console.html)
(per-component registration sub-pages). For the Download Tool: generate a
**software depot ID** with the tool
(`./vcf-download-tool configuration generate --software-depot-id`), then log in
to the console, select the tenant + site ID that map to your VCF entitlement,
and generate the **activation code** against that depot ID. Save the code to a
text file for the `--depot-download-activation-code-file` flag. (Code not
appearing? — [KB 399124](https://knowledge.broadcom.com/external/article/399124/activation-code-not-generated-in-connect.html).)

> **Token vs. activation code:** Broadcom is mid-transition. The older
> **download token** (support portal → *My Dashboard → Generate Download
> Token*, see [KB 390098](https://knowledge.broadcom.com/external/article/390098))
> still works for 9.1 downloads — the 9.0-era tool took it as a
> download-*token* file — but the **activation code is the go-forward
> mechanism** that replaces the token workflow.
>
> **Get the credential early:** generating either requires the **Product
> Administrator** role on the Broadcom support-portal site. If your named
> contact doesn't have it, the site's User Administrator must assign it
> first — plan days for this, not minutes.
>
> **Don't confuse it with the *licensing* activation code.** VCF 9 also
> uses an activation code to register **VCF Operations** with the licensing
> service (`vcf.broadcom.com`) for the single fleet license file — a
> separate credential from the depot-download one, generated in its own
> registration wizard. The activation/registration model is explained in
> the VMware blog [Licensing in VMware Cloud Foundation 9.0](https://blogs.vmware.com/cloud-foundation/2025/06/24/licensing-in-vmware-cloud-foundation-9-0/)
> (Sehjung Hah & Kyle Gleed).

#### Step 5 — Download the binaries

Into the depot store (the web server's document root, or a staging directory):

```console
./vcf-download-tool binaries download --sku VCF --vcf-version 9.1.x \
  --depot-download-activation-code-file /path/activation-code.txt \
  --type INSTALL --depot-store /var/www/offline_depot

./vcf-download-tool esx download \
  --depot-download-activation-code-file /path/activation-code.txt \
  --depot-store /var/www/offline_depot
```

`binaries list` (same flags) previews what a run will pull; `--type UPGRADE`
fetches lifecycle bundles for Day-N patching.

> **NSX Edge nodes need no extra binary.** There is no separate NSX Edge
> bundle in the depot — the edge node OVA ships inside the **NSX Manager**
> appliance (`NSX_T_MANAGER`, already part of the `--type INSTALL` set),
> and NSX Manager deploys the edge VMs itself when you create an edge
> cluster after bring-up. The Broadcom
> [edge-cluster prerequisites](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/advanced-network-management/administration-guide/setting-up-network-connectivity/setting-up-centralized-connectivity-with-edge-clusters.html)
> are network/resource-only (Edge TEPs, uplinks, DNS, BGP) and never
> mention the depot, and the depot component list confirms it (see William
> Lam's [depot structure deep-dive](https://williamlam.com/2025/10/vcf-software-depot-structure-deep-dive-for-install-upgrade.html)).
> An air-gapped depot loaded per this section therefore already covers a
> later edge-cluster deployment; Day-N, edge nodes are upgraded through
> the NSX upgrade bundle (`--type UPGRADE`), not a separate download.

**Behind a proxy? Use the tool's own flags — the shell env vars are ignored.**
`http_proxy`/`https_proxy` have no effect; the Download Tool reads only its
[own options](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/lifecycle-management/binary-management-for-vmware-cloud-foundation/what-is-the-vcf-download-tool-/vcf-download-tool-general-options.html).
Add **`--proxy-server <FQDN:Port>`** (`-s`, no `http://` scheme). The symptom
*without* it is `Fail to obtain access token from Broadcom OAuth Authorization
server` plus **name-resolution errors** — because with a proxy the *proxy*
resolves the Broadcom names, not the depot box:

```console
./vcf-download-tool binaries download --sku VCF --vcf-version 9.1.x \
  --depot-download-activation-code-file /path/activation-code.txt \
  --type INSTALL --depot-store /var/www/offline_depot \
  --proxy-server proxy01.sfo.example.io:3128
```

If the proxy is an **HTTPS** proxy, add `--proxy-https` — which first requires the
proxy's certificate imported into the tool's **JRE default trust store**. If it
authenticates, add `--proxy-user <user>` (`-r`) and
`--proxy-user-password-file <path>`. (The `depot …` upload subcommands cannot use
the proxy filter.)

> **Gotcha — `Failed to get last updated time for HCL`.** Even once the proxy
> works the download can fail here: the tool queries `vsanhealth.vmware.com` for
> the vSAN HCL and chokes. Fix is an endpoint swap — change
> `vsan.hcl.client.endpoint=vsanhealth.vmware.com` to
> `vsan.hcl.client.endpoint=eapi.broadcom.com` in **both**
> `conf/application-prod.properties` and `conf/application-prodV2.properties`,
> then retry.
> [Broadcom KB 438222](https://knowledge.broadcom.com/external/article/438222/vmware-cloud-foundation-download-tool-fa.html).

> **(Re)apply the Step 2 security *after* the download.** The `binaries download`
> creates and refreshes the depot's `PROD/…` tree, so the
> [Step 2 auth split](#step-2--auth-split) has to be applied **once the store is
> populated** — not before — protecting `PROD/COMP` and `PROD/metadata` while
> leaving `PROD/vsan/hcl` and `umds-patch-store` open. Do it again after every
> Day-N `--type UPGRADE` refresh, since each run rewrites the tree. Re-verify with
> the curl checks (open paths return 200, protected paths prompt) and confirm the
> web-server user can still read the newly written files.

#### Step 6 — Transfer to the air-gapped server

Move the depot store to the air-gapped web server if the download host is a
separate machine — the directory tree (`PROD/COMP`, `PROD/metadata`,
`PROD/vsan/hcl`, `umds-patch-store`) must arrive intact under the document root.

#### Step 7 — Connect VCF to it

Point the **VCF Installer** at the depot URL (e.g.
`https://depot.sfo.rainpole.io/`) with the basic-auth user (intake `G4`). The
Installer must **trust the depot's TLS certificate** — with a self-signed or
internal-CA cert, plan the certificate import (in 9.0 there was no
accept-certificate prompt; the cert had to be imported over SSH — see the vTam
walkthrough below). Day-N, the fleet connects under **VCF Operations → Depot
Configuration** (fleet-level *and* per-instance).

### B.2 Manual transfer — feeding the VCF Installer without a depot server

For a one-off installation (lab, PoC, or a small air-gapped site) you can skip
building the depot web server entirely: download the depot store with the VCF
Download Tool on any internet-connected machine, copy it onto the VCF
Installer appliance, and import it locally. **"Manual" means no depot server —
not hand-picked downloads:** the binaries still come exclusively through the
**VCF Download Tool + activation code** (B.1 steps 3–4 apply unchanged);
pulling OVAs/ISOs by hand from the support portal is not a supported
substitute in 9.1.

1. **Download** the install set on the internet-connected machine — B.1
   step 5's `binaries download --type INSTALL` command, with `--depot-store`
   pointing at a local staging directory. Metadata comes with it; plan the
   same order of disk space.
2. **Copy to the Installer** — put the Download Tool itself on the appliance
   (extract the `.tar.gz` under `/nfs/vmware/vcf/nfs-mount/vcfdt`) and
   transfer the staged store:

   ```console
   rsync -aP /path/to/binaries vcf@installer-fqdn:/nfs/vmware/vcf/nfs-mount/depot
   ```
3. **Import on the appliance** — save the `admin@local` password to a text
   file, then:

   ```console
   ./vcf-download-tool binaries upload --depot-store /nfs/vmware/vcf/nfs-mount/depot \
     --sddc-manager-fqdn installer-fqdn --sddc-manager-user admin@local \
     --sddc-manager-user-password-file /path/to/password.txt
   ```

   Once the upload finishes, the Installer shows the binaries as available
   and deployment proceeds as normal — no depot configured anywhere.

> **Day-N caveat (new in 9.1).** After bring-up the fleet runs its own **Depot
> Service**, and with no depot connected, patch/upgrade binaries must be
> **side-loaded there too** — a second upload per cycle
> (`vcf-download-tool depot binaries upload --ops-fqdn <vcf-ops-fqdn>
> --depot-fqdn <fleet-depot-fqdn>`, optionally per `--component`). In 9.0 this
> extra step didn't exist. Manual copies at every patch cycle get tedious
> fast — beyond a lab or one-off, the offline depot (B.1) is the smoother
> long-term setup. Walkthrough incl. the Fleet Depot Service step: William
> Lam's [Side-loading VCF binaries into VCF Installer & Fleet Depot Service](https://williamlam.com/2026/06/vcf-9-1-side-loading-vcf-binaries-into-vcf-installer-fleet-depot-service-for-air-gapped-environments.html).

### B.3 Using the Download Tool standalone

You don't need to be air-gapped to use the tool. Run it on any
internet-connected machine with the same activation-code file to **pre-stage
binaries locally** — for example to pull the `--type INSTALL` set before an
installation window, or ESX patch data via its built-in UMDS, without letting
the VCF appliances out to the internet. Whatever machine runs it needs
outbound 443 to the [Public URLs](prerequisites.md#public-urls-online-functionality)
— plan that host's egress (or proxy allowlist) as part of the prereq gate.

### B.4 Proxy for the VCF services runtime (via the Fleet LCM API)

When the VCF Management Services components have **no direct route to the
internet**, the fleet reaches the online depot (and everything else it downloads)
through a **proxy set on the VCF services runtime** — the `VSP` component in Fleet
lifecycle. This is the `G5` proxy referenced in B.0, applied to the fleet rather
than the Installer. TechDocs:
[Configure a Proxy Server for VCF Management Services Components and VCF Automation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/fleet-management/configuring-management-components/configure-a-proxy-server-to-download-bundles-from-sddc-manager.html).

The TechDocs procedure reads as a wall of `curl`/`jq` token-juggling; underneath
it is short. It's the **same Fleet LCM API pattern as the backup config in A.5**,
so the field notes there apply here too.

**The flow, distilled:**

1. **Authenticate** through VCF Operations (the only issuer the Fleet lifecycle
   service trusts):
   - `POST https://<VCFOps>/suite-api/api/auth/token/acquire` (username/password)
     → an `OpsToken`
   - `POST https://<VCFOps>/suite-api/api/auth/token/exchange` with header
     `Authorization: OpsToken <token>` and body `{"serviceKeys":["fleet-lcm"]}`
     → the Fleet LCM **Bearer JWT**
2. **Find the runtime:** `GET https://<FleetLCM>/fleet-lcm/v1/components` → the
   component whose `componentType` is `VSP`, take its `id`.
3. **Set the proxy:**
   `PATCH https://<FleetLCM>/fleet-lcm/v1/components/<vspId>/config`

   ```json
   {
     "type": "VspClusterConfigSpec",
     "peerProxy": {
       "host": "10.11.10.250",
       "port": 3128,
       "tlsEnabled": false,
       "credentialsEnabled": false
     }
   }
   ```

   Returns a task `id`.
4. **Watch / verify:** `GET .../fleet-lcm/v1/tasks/<taskId>`, then
   `GET .../fleet-lcm/v1/components/<vspId>/config`.

Optional `peerProxy` fields: `username` + `password` (with
`credentialsEnabled: true` for an authenticating proxy), `encodedCertificate`
(base64 PEM, with `tlsEnabled: true` for an HTTPS proxy), and `excludeDomains` /
`excludeIpAddresses` for no-proxy bypasses.

> **Set the exclusions — a bare proxy sends *everything* out.** With only a host
> and port, **all** of the services runtime's HTTP egress is forced through the
> proxy, including traffic that must stay on the management network: the other VCF
> appliances (vCenter, NSX, SDDC Manager, VCF Operations) and — the one that bites
> in an air-gapped build — your **on-prem offline depot**. At best that adds a hop;
> at worst the proxy refuses to route the internal/RFC1918 destination and the
> connection fails. So set:
> - **`excludeDomains`** — your internal DNS suffix(es), e.g. `sfo.example.io`, so
>   every internal FQDN bypasses the proxy.
> - **`excludeIpAddresses`** — the management / services-runtime CIDRs and the
>   subnets holding vCenter/NSX/SDDC Manager/VCF Operations, plus the **offline
>   depot's IP or subnet** so bundle pulls stay internal.
>
> With the scripts: `-ExcludeDomains 'sfo.example.io' -ExcludeIpAddresses
> '10.11.0.0/16','<depot-ip>'`. They ride the same merge PATCH, so re-running
> `Set-VCFProxyConfig.ps1` adds them alongside the existing host/port; confirm with
> `Get-VCFProxyConfig.ps1` (empty exclude lines mean *everything* is being proxied).

**Three traps worth knowing** (all cost time to discover):

- **Go straight to the fleet appliance, not the VCF Operations proxy route.**
  The browser sends this to `https://<VCFOps>/vcf-operations/plug/fleet-lcm/...`,
  but that path is the user interface's **session-authenticated** route (it works
  because the browser holds a `JSESSIONID` cookie). A Bearer-token client gets
  **405** on a `PATCH` there and HTML on a `GET`. Both the lookup and the write go
  to `https://<FleetLCM>/fleet-lcm/v1/...`, where the token is accepted — the same
  lesson as the backup write (A.5, and issue #150).
- **Skip the `/casa/services` service-key lookup.** The TechDocs procedure fetches
  a service key from `<VCFOps>/casa/services` with a hard-coded Basic-auth header;
  you don't need it. The fleet-lcm service key is just the literal string
  **`"fleet-lcm"`** in the exchange body (proven live by the backup scripts).
- **`port` is a number here.** In `VspClusterConfigSpec` the proxy `port` is a
  JSON **number** (`3128`), unlike the SFTP backup payload where `port` is a
  **string**. Send the wrong type and validation rejects it.

**The two scripts in `tools/`** do exactly this, reusing the backup scripts'
auth chain — download them straight from the site:

| Script | What it does |
| ------ | ------------ |
| [**Get-VCFProxyConfig.ps1**](https://pauldiee.github.io/VCF9-DeploymentPlanning/scripts/Get-VCFProxyConfig.ps1) | **Read-only.** Shows the `peerProxy` the platform *actually* stored on each `VSP` (VCF services runtime) component. Changes nothing |
| [**Set-VCFProxyConfig.ps1**](https://pauldiee.github.io/VCF9-DeploymentPlanning/scripts/Set-VCFProxyConfig.ps1) | **Sets the proxy** through the API. `-WhatIf` prints the exact payload (secrets masked) without sending it; supports an authenticating proxy (`-ProxyUsername`), a TLS proxy (`-CertificateFile`), and `-ExcludeDomains` / `-ExcludeIpAddresses`; **`-Remove`** clears it by sending **explicit empty values** (blank host, port 0) — the Fleet LCM PATCH is a merge, so a `null` peerProxy is a *silent no-op* (task completes, nothing changes). Verify with `Get-VCFProxyConfig.ps1` afterwards |

#### Gotcha: the precheck is a netcat test from the *whole* node block — even when the documented access is in place

Setting the proxy is not the end of it. The `PATCH` is **accepted** (you get a task
ID), and the platform then runs a **`peer-proxy-precheck`** workflow on the VCF
services runtime. **If that precheck fails, the proxy is never applied** — the
config submit stores nothing, exactly like the backup submit in
[A.5](#a-failed-submit-stores-nothing). And the failure the platform surfaces is
misleading: *"the proxy server may be slow, overloaded, or network latency is too
high."*

What the precheck actually does — read it yourself. Get a `kubectl` session on the
control-plane node ([recipe in A.6](#a6-cold-backup--cold-maintenance-safely-shutting-down-the-management-services)
— SSH in as `root`, `kubectl` is already wired up), then:

```bash
kubectl -n vmsp-platform get pods | grep peer-proxy-precheck        # the failing Error pods
kubectl -n vmsp-platform logs <peer-proxy-precheck-...-main-pod> -c main --tail=200
```

The log shows it is a **plain L4 `nc` (netcat) TCP connect** to the proxy
`host:port` — no auth, no TLS, pure reachability:

```
Testing TCP port connectivity/reachability using nc (netcat)
nc: connect to 10.11.10.250 port 3128 (tcp) failed: Connection timed out
Proxy connectivity test failed: 10.11.10.250:3128
```

**The gotcha:** that `nc` runs from a **pod that can be scheduled on any VCF
services-runtime node**, and its egress **SNATs to that node's IP**. So the source
of the proxy connection is the **entire services-runtime node block** — *not* the
depot or VCF Operations IPs. Broadcom's documented access for the proxy does **not**
call this out, so the firewall gets opened only for the depot + Ops IPs (the hosts
you'd *expect* to use a download proxy), the precheck lands on a node that isn't
permitted, and it **times out**. This is the same trap as the backup target in
[A.5](#the-clients-are-the-whole-services-runtime-block): **firewall the block, not
the named hosts you think talk to it.**

**Fix:** allow the **whole services-runtime node block** outbound to the proxy on
its port (e.g. TCP 3128). List the exact source IPs to hand the network team with:

```bash
kubectl get nodes -o wide      # the INTERNAL-IP column = the source IPs to allow
```

Then re-submit (`Set-VCFProxyConfig.ps1` again, or let the platform retry) and the
`nc` check passes. Because it is L4-only, an authenticating (`credentialsEnabled`)
or TLS (`tlsEnabled`) proxy still has to clear this reachability gate **first** —
fix the firewall before chasing credentials or certificates.

### B.5 References

- TechDocs: [Set Up an Offline Depot Web Server for VMware Cloud Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance/connect-to-an-offline-depot-to-download-binaries/set-up-an-offline-depot-web-server-for-vmware-cloud-foundation.html)
  (full Apache walk-through incl. certificate + basic-auth config),
  [Download Binaries to an Offline Depot by Using the VCF Download Tool](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/lifecycle-management/binary-management-for-vmware-cloud-foundation/download-bundles-to-an-offline-depot.html)
  and [Manually Transfer Binaries to VCF Installer](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance/use-the-vmware-download-tool-to-download-binaries.html)
  (the no-depot-server path in B.2).
- Registration / credentials: [Software Depot Registration in the VCF Business Services Console](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/business-services/home/depot-service-authentication-in-the-vcf-business-services-console.html)
  (authoritative 9.1 registration procedures per component). Broadcom KBs:
  [VCF authenticated downloads configuration update instructions](https://knowledge.broadcom.com/external/article/390098)
  (generating the legacy download token; Product Administrator role required),
  [VCF Download Tool fails with "Download Token is not entitled"](https://knowledge.broadcom.com/external/article/443322/vcf-download-tool-fails-with-download-to.html)
  (entitlement troubleshooting) and
  [Activation code not generated in connected registration flow](https://knowledge.broadcom.com/external/article/399124/activation-code-not-generated-in-connect.html).
- VMware blog: [Licensing in VMware Cloud Foundation 9.0](https://blogs.vmware.com/cloud-foundation/2025/06/24/licensing-in-vmware-cloud-foundation-9-0/)
  — the *licensing* activation code and single-license-file model
  (VCF Operations ↔ `vcf.broadcom.com`), distinct from the depot-download
  credential above.
- Community walkthroughs: [VCF 9.1 VCF Download Tool (VCFDT) cheatsheet](https://williamlam.com/2026/05/vcf-9-1-vcf-download-tool-vcfdt-cheatsheet.html)
  (William Lam — command reference incl. the token → activation-code
  transition), [VCF 9 offline depot installation and configuration](https://vtam.nl/2025/11/12/vmware-cloud-foundation-9-offline-depot-installation-and-configuration/)
  (Ubuntu + Apache end to end, written against 9.0 — commands and directory
  layout carry over to 9.1; watch the version-specific KB notes) and
  [VCF 9.1.x Ultimate Deployment Guide](https://blog.leaha.co.uk/2026/05/06/vcf-9-1-x-ultimate-deployment-guide/)
  (depot connection in the context of a full 9.1 deployment).
