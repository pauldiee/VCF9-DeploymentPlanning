# ESX Coredump / Dump Collector — Build Guide

Not part of any wizard the VCF Installer runs, and not asked by the P&P
workbook — this is a manual, post-bring-up host configuration step, the same
category as NTP or DNS but easy to miss because nothing in the fleet tooling
prompts for it.

**What it is.** By default an ESX host that PSODs (Purple Screen of Death)
writes its coredump to **local** disk: since ESXi 7.0 a dump file on the
ESX-OSData volume, on older or upgraded builds possibly a coredump partition
(what the host does by default and how to find the dump after the reboot:
[§6](#6-the-local-default-psod-behaviour-and-finding-the-dump)). That is
fine for a single host, but at fleet scale — and
especially on hosts booting from a small local device — you want crash dumps
centralized where Broadcom Support can actually reach them without you
having to console into every host after the fact. The **VMware vSphere ESXi
Dump Collector** service does that: it's a vCenter-side network listener
(UDP), and each ESX host is told to send its coredump there instead of (or in
addition to) local storage.

Two halves, in order: enable the collector service **on vCenter**, then point
**every host** at it.

---

## The full sequence, start to finish

Two halves, in order — enable the collector on vCenter, then point the hosts at
it. Each step links the section that carries the detail.

1. **Enable the Dump Collector service on vCenter**
   ([§1](#1-enable-the-dump-collector-service-on-vcenter)) — set it to start
   automatically, via the VAMI or SSH to the VCSA.
2. **Point every ESX host at the collector**
   ([§2](#2-point-every-esx-host-at-the-collector)) — per host by hand
   (`esxcli system coredump network set …`), or the download-and-run fleet
   sweep script at scale.
3. **Open the firewall** ([§3](#3-firewall)) — the collector's UDP port from
   every ESX management vmkernel to vCenter.
4. **Verify** ([§4](#4-verify)) — `esxcli system coredump network check`, and
   the host reports **Network Dump Collector** on the vCenter *Configure* tab
   once it has checked in.
5. **If a host will not register** ([§5](#5-field-notes)) — the field-notes
   gotchas.
6. **Check the local default as well**
   ([§6](#6-the-local-default-psod-behaviour-and-finding-the-dump)) — an active
   local dump target on every host, and decide whether hosts reboot on their
   own after a PSOD.

---

## 1. Enable the Dump Collector service on vCenter

The service ships with every VCSA but is **not started by default**.

**Via the vCenter Server Management interface (VAMI, port 5480):**

1. Browse to `https://<vcenter-fqdn>:5480` and log in as `root`.
2. **Services** → find **VMware vSphere ESXi Dump Collector**.
3. **Actions → Start**, then **Actions → Edit Startup Type → Automatic** so it
   survives a vCenter reboot.

**Via SSH to the VCSA** (same effect, scriptable):

```bash
service-control --start vmware-netdumper
service-control --enable vmware-netdumper
service-control --status vmware-netdumper
```

Confirm the listener is actually up before touching any hosts:

```bash
netstat -an | grep 6500
```

You should see it bound on **UDP/6500** — that's the default port the hosts
will be told to send to.

---

## 2. Point every ESX host at the collector

Run per host, either directly against the host or via `Get-EsxCli` in
PowerCLI for a fleet sweep.

**Per host, directly (SSH or DCUI shell):**

```bash
esxcli system coredump network set --interface-name vmk0 --server-ip <vcenter-fqdn-or-ip> --server-port 6500
esxcli system coredump network set --enable true
esxcli system coredump network check
```

`--interface-name` is the **vmkernel** interface the host will send from —
usually the management VMkernel (`vmk0`), but confirm that's the interface
that actually routes to vCenter if the management network isn't `vmk0` on
your build. `network check` validates the config against the target
without triggering a real crash.

**Fleet sweep — a script does this for you. Download it and run it**
(Windows PowerShell 5.1 or PowerShell 7; it prompts for whatever you don't pass):

| Script | What it does |
| ------ | ------------ |
| [**Set-ESXCoredump.ps1**](https://vcf-planning.hollebollevsan.nl/scripts/Set-ESXCoredump.ps1) | Runs the same `Get-EsxCli -V2` calls above against every host in a vCenter (or a chosen subset), plus the firewall ruleset check from section 3, with `-WhatIf` support and a per-host results table. **It does not enable the Dump Collector service itself** — that's section 1, done once, manually, before you run this |

```console
.\Set-ESXCoredump.ps1 -VCenter vc01.sfo.example.io -CollectorAddress vc01.sfo.example.io -WhatIf
```

Drop `-WhatIf` to apply once the plan looks right. `-VMHost` (or piping
`Get-VMHost` in) narrows it to a subset instead of every host; `-CollectorAddress`
can point at a standalone Dump Collector instead of vCenter's own.

If you'd rather do it by hand, or on a single host without PowerCLI, the
underlying commands are:

```powershell
$dumpCollectorIP = '<vcenter-or-dedicated-collector-ip>'

foreach ($vmhost in Get-VMHost) {
    $esxcli = Get-EsxCli -VMHost $vmhost -V2

    $setArgs = $esxcli.system.coredump.network.set.CreateArgs()
    $setArgs.interfacename = 'vmk0'
    $setArgs.serverip      = $dumpCollectorIP
    $setArgs.serverport    = 6500
    $esxcli.system.coredump.network.set.Invoke($setArgs) | Out-Null

    $enableArgs = $esxcli.system.coredump.network.set.CreateArgs()
    $enableArgs.enable = $true
    $esxcli.system.coredump.network.set.Invoke($enableArgs) | Out-Null

    $result = $esxcli.system.coredump.network.check.Invoke()
    "{0,-30} {1}" -f $vmhost.Name, $result
}
```

---

## 3. Firewall

Coredump traffic is **outbound UDP/6500** from every host to the collector.
The `vSphereCoredumpClient` firewall ruleset ships **enabled by default** on
ESX, but confirm it rather than assume it on a hardened build:

```bash
esxcli network firewall ruleset list | grep -i coredump
```

If it's disabled:

```bash
esxcli network firewall ruleset set --ruleset-id=vSphereCoredumpClient --enabled=true
```

See [`07-firewall-ports.md`](07-firewall-ports.md) if this traffic has to
cross a physical firewall zone (e.g. hosts and vCenter in different security
zones) — UDP/6500 needs its own rule, it will not ride on an existing
management-plane allow.

---

## 4. Verify

```bash
esxcli system coredump network get
```

Confirm `Enabled: true` and the server IP/port match what you set. On the
vCenter side, **Monitor → System Configuration** for a host will show
**Network Dump Collector** status once the host has checked in.

The real test is a deliberate one, not just config-matching — Broadcom
documents a **soft PSOD trigger** for exactly this (`vsish -e set
/reliability/crashMe/Panic 1`, or the DCUI "Fault the host" option on some
builds) if you want to prove a dump actually lands on the collector before
you need it for real. Treat that as a maintenance-window activity on a host
you can afford to reboot, not a routine check.

---

## 5. Field notes

- **This is per-host, not fleet-wide.** There's no "apply to all hosts"
  toggle in the wizard sense — either script it (above) or bake it into a
  **Host Profile** so new hosts inherit it at commissioning rather than
  needing this run again by hand.
- **The collector service and the coredump target don't have to be the same
  box.** vCenter's own Dump Collector is the common choice, but Broadcom also
  ships a **standalone** ESXi Dump Collector for environments that don't want
  crash traffic landing on the vCenter appliance itself. If your site runs a
  standalone collector, point `--server-ip` at that instead of vCenter.
- **This does not replace the local coredump target.** Network coredump is
  additive — if the host can't reach the collector at the moment it PSODs
  (network down, which is plausible on the exact box that just crashed), the
  local dump file (or partition) is still the fallback. Don't remove local
  coredump provisioning on the assumption the network path always works; see
  §6 for checking that it is actually active.

---

## 6. The local default: PSOD behaviour and finding the dump

What a host does on its own, before any of the network setup above. Sourced
from the Broadcom KBs listed under *References*; most of them list ESXi 7.x
and 8.x, KB 313264 also lists ESX 9.0.

### 6.1 The host stays on the purple screen

The advanced setting `Misc.BlueScreenTimeout` controls whether a host reboots
by itself after a PSOD. KB 345100: *"The default value is set to "0""*, and
*"The default and Broadcom recommended setting is to leave the host in an
unresponsive state with the purple diagnostic screen displayed on the console
screen to aid in troubleshooting."*

So by default the host **does not reboot**: someone has to read or photograph
the screen and reset the host. vSphere HA restarts the VMs elsewhere either
way. If you want an automatic reboot instead, set the number of seconds:

```bash
esxcfg-advcfg -s 120 /Misc/BlueScreenTimeout
esxcfg-advcfg -g /Misc/BlueScreenTimeout
```

or in the Host Client: **Manage → System → Advanced settings**, search
`Misc.BlueScreenTimeout`, edit, save (*"This does not need a host reboot."*).
The trade-off: an automatic reboot gets the host back sooner, but nobody sees
the purple screen. Make sure the dump target works (6.2) before you choose it.

### 6.2 Where the dump goes by default

Since ESXi 7.0 the dump goes to a **file**, not a partition. KB 314320:
*"ESXi 7.0 creates a VMFS-L based ESX-OSData volume and configures a coredump
file to be stored in it if the volume is larger than 4GB"*. The boot option
behind it (KB 313264, which lists ESX 9.0) is `autoCreateDumpFile`, default
`TRUE`: *"The attempted order of creating the coredump file is first to the
VMFS-L ESX-OSData, then to USB VMFS-L, and finally a local VMFS datastore."*
The file is sized automatically (`dumpSize` default 0) and is *"limited to
half of the available space on the VMFS-L volume."*

Check it on every host:

```bash
esxcli system coredump file list        # Active and Configured both true
esxcli system coredump partition list   # an older-style partition, if any
esxcli system coredump network get      # the network target from §2
```

If no file is active, create and activate one (KB 314320; `-d` and `-f` are
optional, the host then picks a datastore and a name):

```bash
esxcli storage filesystem list                              # note the datastore UUID
esxcli system coredump file add -d <datastore_UUID> -f <name>
esxcli system coredump file set --smart --enable true
esxcli system coredump file list
```

KB 314320: *"Software iSCSI and Software FCoE are not supported for coredump
locations."* On hosts that boot from software iSCSI the network target from
§2 is therefore not optional.

### 6.3 Finding the dump after the reboot

After the host is back, look for a `vmkernel-zdump` file. KB 310769:
*"Find the `vmkernel-zdump` file in the `/root/` or `/var/core/` directory"*.

```bash
ls -lh /var/core/ /root/
```

A `vm-support` bundle includes it, and that bundle is what Broadcom Support
asks for. To read the crash yourself, extract the vmkernel log from the
zdump (KB 310769, *"Use the `vmkdump` or `esxcfg-dumppart` utility to extract
the log."*):

```bash
esxcfg-dumppart -L /var/core/vmkernel-zdump.1
```

This writes a plain-text `vmkernel-log.<n>` with what the purple screen
showed and the log lines before it.

**Encrypted dumps.** With vSphere VM Encryption enabled, KB 374266: *"ESXi
core dumps are automatically encrypted to protect sensitive customer data"*,
including the copies in a `vm-support` bundle. Decrypt them on the host
before analysis; the host needs its key from the key provider after the
reboot:

```bash
crypto-util envelope describe --offset 4096 /var/core/vmkernel-zdump.1
crypto-util envelope extract --offset 4096 /var/core/vmkernel-zdump.1 /var/core/unenc-vmkernel-zdump.1
```

### 6.4 When there is no dump

- **No active target after an upgrade.** KB 437765: after a major version
  upgrade the dump file can still exist while *"the kernel drops the active
  configuration pointer"*. vCenter raises *"No coredump target has been
  configured. Host core dumps cannot be saved."* Fix it with
  `esxcli system coredump file set --smart --enable true` (6.2). Check this
  after every upgrade, not after the next crash.
- **The host rebooted without a PSOD.** A hardware fault, a BMC reset or a
  power loss leaves no zdump. The cause is then in the server's own event log
  (IPMI SEL, iDRAC, iLO, XCC).
- **The dump could not be written.** If the boot device itself failed (for
  example APD/PDL on a SAN boot LUN), the local file on ESX-OSData was not
  reachable either. That is the case the network target from §2 covers.
- **The host was reset too early.** With the default timeout of 0 the screen
  shows the dump progress; let it finish before anyone power-cycles the host.

**Not verified:** no Broadcom page we found says that the host copies the
dump to `/var/core` automatically at the next boot, or how this behaves on
ESX 9 specifically. To prove it on your build, trigger a test PSOD on a
host you can spare (§4) and check `/var/core` afterwards.

---

## References

- [Configuring the Network Dump Collector service in vSphere](https://knowledge.broadcom.com/external/article/344063/configuring-the-network-dump-collector-s.html) —
  Broadcom KB
- [Configure ESXi Dump Collector with ESXCLI](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/configure-esxi-dump-collector-with-esxcli.html) —
  Broadcom TechDocs
- [VMware ESXi Dump Collector Support](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/7-0/vsphere-networking/introduction-to-vsphere-networking/esxi-dump-collector-support.html) —
  Broadcom TechDocs
- [KB 345100 — Configuring an ESXi host to restart after becoming unresponsive with a purple diagnostic screen](https://knowledge.broadcom.com/external/article/345100/configuring-an-esxesxi-host-to-restart-a.html) —
  Broadcom KB (§6.1)
- [KB 314320 — Configuring ESXi coredump to file instead of partition](https://knowledge.broadcom.com/external/article/314320/configuring-esxi-coredump-to-file-instea.html) —
  Broadcom KB (§6.2)
- [KB 313264 — Additional Kernel boot options available in ESXi 7.0 and later versions](https://knowledge.broadcom.com/external/article/313264/additional-kernel-boot-options-available.html) —
  Broadcom KB (§6.2)
- [Set Up a File as Core Dump Location (vSphere 8.0)](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/vsphere-storage-8-0/working-with-datastores-in-vsphere-storage-environment/managing-vsphere-vmfs-datastores/setting-up-esxi-core-dump-on-a-vmfs-datastore/set-up-a-file-as-core-dump-location.html) —
  Broadcom TechDocs (§6.2)
- [KB 310769 — Extracting the log file after an ESXi host fails with a purple screen error](https://knowledge.broadcom.com/external/article/310769/extracting-the-log-file-after-an-esx-or.html) —
  Broadcom KB (§6.3)
- [KB 374266 — How to decrypt a core dump following an ESXi host PSOD](https://knowledge.broadcom.com/external/article/374266/psod-core-dump-is-encrypted.html) —
  Broadcom KB (§6.3)
- [KB 437765 — "No coredump target has been configured" alert following upgrade](https://knowledge.broadcom.com/external/article/437765/no-coredump-target-has-been-configured-a.html) —
  Broadcom KB (§6.4)
