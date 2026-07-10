# Backup Target & Binary Depot — Build Guide

Two pieces of *your* infrastructure that VCF 9.1 depends on but does not
deploy for you: the **SFTP backup target** every management component backs up
to, and the **binary depot** the platform installs and patches from. The
[prerequisites gate](prerequisites.md) states *what* must exist; this page
covers *how to build it* and the gotchas that cost redo time.

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
- The server must support **256-bit ECDSA and 2048-bit RSA SSH keys**.
- Service account + write path pre-created (e.g. `svc-vcf-bck` → `/backups/`).
- Put it **outside the management domain it protects** — a backup target that
  dies with the platform is not a backup. A VM on separate infrastructure, a
  physical host, or a NAS with SFTP all work; in multi-AZ designs prefer a
  different fault domain than the primary management AZ.
- Static IP and DNS A + PTR records, like every other appliance in the plan.

### A.3 Building one (chrooted OpenSSH example)

Anything that speaks SFTP over SSH qualifies — a NAS, Windows Server with
OpenSSH Server, or (most common) a small Linux VM. The hardened pattern is an
SFTP-only account locked in a chroot jail:

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

### A.4 References

- TechDocs: [File-Based Backups for SDDC Manager, NSX Manager and vCenter](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/backup-and-restore-of-cloud-foundation/file-based-backups-for-sddc-manager-and-vcenter-server.html)
  and [Configure SFTP Backup Target in VCF Operations](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/backup-and-restore-of-cloud-foundation/configure-sftp-backup-target-in-vmware-cloud-foundation-operations.html).
- Community walkthroughs: [SFTP server on Photon OS for VCF 9.1 backups](https://topvcf.com/2026/05/19/5685/)
  (chroot jail, end to end) and [SFTP on Ubuntu Server](https://www.velements.net/2024/10/12/setup-sftp-on-ubuntu-server/)
  (includes re-enabling `ssh-rsa` host-key algorithms for older VMware
  components).

---

## B. Binary depot — offline depot & the VCF Download Tool

Two ways to feed binaries to VCF 9.1 (intake `G1`):

- **Online depot** — VCF Installer (and later the fleet) connect to the
  Broadcom depot directly using the **Download Service ID + Activation Code**
  (intake `G2`/`G3`; how to obtain them — and the Product-Administrator-role
  gotcha — is in B.1 step 4). Needs outbound
  443 to the [Public URLs table](prerequisites.md#public-urls-online-functionality)
  (via the proxy from intake `G5` if there is one). TechDocs:
  [Connect VCF Installer to Broadcom or an Offline Depot and Download Binaries](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance/connect-to-an-online-depot-to-download-binaries.html).
- **Offline depot** — for air-gapped sites the **VCF Download Tool** is the
  only supported method in 9.1. It downloads a **depot store** on an
  internet-connected host; your own web server serves that store to the VCF
  Installer and the fleet. The tool replaced the old Offline Bundle Transfer
  Utility (OBTU) and wraps **UMDS** for ESX patch data. TechDocs:
  [Download Binaries to an Offline Depot by Using the VCF Download Tool](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/lifecycle-management/binary-management-for-vmware-cloud-foundation/download-bundles-to-an-offline-depot.html).

### B.1 Setting up an offline depot

1. **Depot web server** — a Linux or Windows VM (any distribution), **static
   IP** (DNS record recommended), a dedicated disk of **≥ 1 TB**, and any web
   server (Apache, NGINX) serving **HTTPS with TLS 1.2/1.3**. Give it a
   certificate with the FQDN *and* IP as SANs — signed by your CA, or
   self-signed if you accept the trust-import step in B.3.
2. **Auth split** — protect `PROD/COMP` and `PROD/metadata` with **basic
   auth** (`htpasswd`); leave `PROD/vsan/hcl` and `umds-patch-store` open.
   The `umds-patch-store` directory name is **hardcoded** — don't rename it.
3. **VCF Download Tool** — download from the Broadcom Support Portal (*My
   Downloads → VMware Cloud Foundation → your version → Drivers & Tools*) and
   extract it on an internet-connected host — the depot server itself if it's
   allowed out, otherwise any staging machine.
4. **Activation code** — from 9.1, whatever connects to Broadcom for binaries
   (VCF Installer, a software depot, the Download Tool) must be **registered
   in the VCF Business Services console** — the authoritative how-to is
   [Software Depot Registration in the VCF Business Services Console](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/business-services/home/depot-service-authentication-in-the-vcf-business-services-console.html)
   (per-component registration sub-pages). For the Download Tool: generate a
   **software depot ID** with the tool
   (`./vcf-download-tool configuration generate --software-depot-id`), then
   log in to the console, select the tenant + site ID that map to your VCF
   entitlement, and generate the **activation code** against that depot ID.
   Save the code to a text file for the
   `--depot-download-activation-code-file` flag. (Code not appearing? —
   [KB 399124](https://knowledge.broadcom.com/external/article/399124/activation-code-not-generated-in-connect.html).)

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
5. **Download the binaries** into the depot store (the web server's document
   root, or a staging directory):

   ```console
   ./vcf-download-tool binaries download --sku VCF --vcf-version 9.1.x \
     --depot-download-activation-code-file /path/activation-code.txt \
     --type INSTALL --depot-store /var/www/offline_depot

   ./vcf-download-tool esx download \
     --depot-download-activation-code-file /path/activation-code.txt \
     --depot-store /var/www/offline_depot
   ```

   `binaries list` (same flags) previews what a run will pull; `--type
   UPGRADE` fetches lifecycle bundles for Day-N patching.
6. **Transfer** the depot store to the air-gapped web server if the download
   host is a separate machine — the directory tree
   (`PROD/COMP`, `PROD/metadata`, `PROD/vsan/hcl`, `umds-patch-store`) must
   arrive intact under the document root.
7. **Connect VCF to it** (intake `G4`) — point the **VCF Installer** at the
   depot URL (e.g. `https://depot.sfo.rainpole.io/`) with the basic-auth
   user. The Installer must **trust the depot's TLS certificate** — with a
   self-signed or internal-CA cert, plan the certificate import (in 9.0 there
   was no accept-certificate prompt; the cert had to be imported over SSH —
   see the vTam walkthrough below). Day-N, the fleet connects under **VCF
   Operations → Depot Configuration** (fleet-level *and* per-instance).

### B.2 Using the Download Tool standalone

You don't need to be air-gapped to use the tool. Run it on any
internet-connected machine with the same activation-code file to **pre-stage
binaries locally** — for example to pull the `--type INSTALL` set before an
installation window, or ESX patch data via its built-in UMDS, without letting
the VCF appliances out to the internet. Whatever machine runs it needs
outbound 443 to the [Public URLs](prerequisites.md#public-urls-online-functionality)
— plan that host's egress (or proxy allowlist) as part of the prereq gate.

### B.3 References

- TechDocs: [Set Up an Offline Depot Web Server for VMware Cloud Foundation](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/preparing-your-environment/downloading-binaries-to-the-vcf-installer-appliance/connect-to-an-offline-depot-to-download-binaries/set-up-an-offline-depot-web-server-for-vmware-cloud-foundation.html)
  (full Apache walk-through incl. certificate + basic-auth config) and
  [Download Binaries to an Offline Depot by Using the VCF Download Tool](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/lifecycle-management/binary-management-for-vmware-cloud-foundation/download-bundles-to-an-offline-depot.html).
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
