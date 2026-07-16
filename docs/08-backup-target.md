# SFTP Backup Target — Build Guide

The **SFTP backup target** that every VCF 9.1 management component backs up to —
a piece of *your* infrastructure the platform depends on but does not build for
you. The [prerequisites gate](prerequisites.md) states *what* must exist; this
page covers *how to build it*, how to verify it before the wizard, and the
field-notes gotchas that cost redo time. Companion page:
[Binary Depot](09-binary-depot.md) — the depot the platform installs and patches
from.

## Contents

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
| | ↳ [`knownhosts: key is unknown`? Use the IP](#knownhosts-key-is-unknown-point-the-target-at-the-ip-not-an-fqdn) | Precheck fails via **FQDN**, works by **IP** — an LB'd/round-robin name breaks host-key pinning |
| | ↳ [Ask the API what was actually stored](#ask-the-api-what-was-actually-stored) | The endpoints, and the two scripts in `tools/` |
| A.6 | [Cold backup / cold maintenance](#a6-cold-backup--cold-maintenance-safely-shutting-down-the-management-services) | Safely shut the management plane down — Broadcom's `vcf_services_runtime_shutdown.sh` |
| A.7 | [References](#a7-references) | The TechDocs and KBs behind the above |

---

## A.1 What backs up to it (and how often)

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

> **Two central backup configs, in two different menus** — set *both*, it's easy
> to configure one and assume the rest followed:
> - **SDDC Manager + NSX Manager** — *Operate → Administration → SDDC Manager*.
>   (NSX is auto-configured at bring-up, but its backup config lives here with
>   SDDC Manager, not with the management services.)
> - **VCF management services** (log management, identity broker, Salt master, VCF
>   Automation, the depot) — *Build → Lifecycle → Backup & Restore*. This is the
>   Fleet LCM config the `tools/` scripts read and write.
>
> Both are under VCF Operations but on separate screens, and each **vCenter** is
> separate again (VAMI, below).

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

## A.2 Requirements and placement

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

## A.3 Building one (chrooted OpenSSH example)

Anything that speaks SFTP over SSH qualifies — a NAS, Windows Server with
OpenSSH Server, or (most common) a small Linux VM.

### Linux variant (chroot jail)

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

### Windows Server variant (built-in OpenSSH Server)

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

## A.4 Verify the target before you register it

Whether you built the target or were handed one, prove the SSH handshake VCF
needs actually completes.

### The check: force the FIPS negotiation

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

### Three traps this catches

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

### Windows targets: a word of caution

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

## A.5 When the target will not configure (field notes)

Everything below was learned the hard way on a 9.1 build whose backup target
refused to configure. None of it is in the product documentation.

### Read the sshd log correctly, or you will chase ghosts

Tail the SFTP server while you submit: `journalctl -u sshd -f`. Then know what
you are looking at, because **most of what you see is not a failure**:

| Log line | What it means |
| -------- | ------------- |
| `Connection closed by 10.x.x.x port N [preauth]` — **no username** | **A host-key probe, not a failure.** VCF fetching the fingerprint: connect, complete key exchange, read the host key, hang up. They arrive in **bursts of three** (one per key type) and appear on **working** configurations too. Ignore them |
| `Accepted ... for svc-vcf-bck` | The real thing. This is what success looks like |
| `Invalid user 4b6b5201-…` — a **UUID** as the username | The platform is presenting a **credential identifier** instead of the account name. Abnormal — a healthy fleet sends the username you typed. Worth a support case |

**The only lines that mean anything have a username in them.** A bare
`[preauth]` close is noise, and mistaking it for the fault costs an afternoon.

### A failed submit stores nothing

Submitting the backup location starts a **validation workflow** (*Build →
Lifecycle → VCF Management → Tasks*). If that workflow fails, **the
configuration is not saved** — so an empty Backup & Restore table does not mean
you forgot to press Add; it means the task failed. Worse, the UI's task detail
bottoms out at *"check the errors in the next sub-task(s)"* with **no next
sub-task**. Expect no useful error from the interface, and go to the sshd log
and the API instead.

### The clients are the whole services-runtime block

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

### Two `sshd_config` traps

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

### Getting the fingerprint: not with Windows `ssh-keyscan`

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

### `knownhosts: key is unknown`? Point the target at the IP, not an FQDN

A precheck failure of

```console
ssh: handshake failed: knownhosts: key is unknown
```

with the SSH **banner already received** (so TCP and the server are fine) is not
what it looks like. It is tempting to chase the host-**key type** — ed25519 vs
RSA, the server's `HostKeyAlgorithms`, forcing RSA-only — and every one of those
is a rabbit hole (forcing RSA-only just trades it for `no known hostkey`, because
a modern server won't do legacy SHA-1 `ssh-rsa`).

The real cause is usually the **target FQDN**. If the FQDN fronts more than one
host — a load balancer, a round-robin `A` record, or simply a name that resolves
to a different box than the one **Fetch Fingerprint** read — then the fingerprint
that gets pinned and the key the precheck's connection receives come from
**different servers**, and the pin can never match.

**Fix: address the backup target by the single host's IP** (or a name that
resolves to exactly one backend). Field-verified: a target that failed by FQDN
went in **flawlessly** by IP. Confirm the FQDN is the problem first — no `dig`/
`nslookup` needed, `getent` is on every Linux:

```console
getent ahosts <backup-fqdn>      # more than one address, or not the box you expect? that's it
```

Only if the **IP** also fails is it worth looking at host-key types at all.

### Ask the API what was actually stored

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

## A.6 Cold backup / cold maintenance: safely shutting down the management services

The SFTP target above is the platform's *online* backup. Some operations instead
need the management plane **fully down** first: a **cold backup or VM-level
snapshot** of the appliances, **planned vSphere maintenance** under them, a
**datacenter power event**, or a **decommission**. For those you must safely shut
down the **VCF services runtime** — the same `VSP` cluster the proxy in
[B.4](09-binary-depot.md#b4-proxy-for-the-vcf-services-runtime-via-the-fleet-lcm-api) configures.
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
[B.4](09-binary-depot.md#gotcha-the-precheck-is-a-netcat-test-from-the-whole-node-block--even-when-the-documented-access-is-in-place)
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

## A.7 References

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
