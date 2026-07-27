# ESX Coredump / Dump Collector — Build Guide

Not part of any wizard the VCF Installer runs, and not asked by the P&P
workbook — this is a manual, post-bring-up host configuration step, the same
category as NTP or DNS but easy to miss because nothing in the fleet tooling
prompts for it.

**What it is.** By default an ESX host that PSODs (Purple Screen of Death)
writes its coredump to **local** disk (a coredump partition, or a file on
VMFS/vSAN). That is fine for a single host, but at fleet scale — and
especially on hosts booting from a small local device — you want crash dumps
centralized where Broadcom Support can actually reach them without you
having to console into every host after the fact. The **VMware vSphere ESXi
Dump Collector** service does that: it's a vCenter-side network listener
(UDP), and each ESX host is told to send its coredump there instead of (or in
addition to) local storage.

Two halves, in order: enable the collector service **on vCenter**, then point
**every host** at it.

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

**Fleet sweep — a script does this for you.** [**Set-ESXCoredump.ps1**](https://vcf-planning.hollebollevsan.nl/scripts/Set-ESXCoredump.ps1)
runs the same `Get-EsxCli -V2` calls above against every host in a vCenter (or
a chosen subset), plus the firewall ruleset check from section 3, with
`-WhatIf` support and a per-host results table. **It does not enable the Dump
Collector service itself** — that's section 1, done once, manually, before
you run this:

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
- **This does not replace local coredump partitions.** Network coredump is
  additive — if the host can't reach the collector at the moment it PSODs
  (network down, which is plausible on the exact box that just crashed), the
  local partition is still the fallback. Don't remove local coredump
  provisioning on the assumption the network path always works.

---

## References

- [Configuring the Network Dump Collector service in vSphere](https://knowledge.broadcom.com/external/article/344063/configuring-the-network-dump-collector-s.html) —
  Broadcom KB
- [Configure ESXi Dump Collector with ESXCLI](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/configure-esxi-dump-collector-with-esxcli.html) —
  Broadcom TechDocs
- [VMware ESXi Dump Collector Support](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/7-0/vsphere-networking/introduction-to-vsphere-networking/esxi-dump-collector-support.html) —
  Broadcom TechDocs
