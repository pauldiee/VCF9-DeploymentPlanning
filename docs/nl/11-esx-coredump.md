---
lang: nl
source: ../11-esx-coredump.md
source_hash: "75ab7c723e5888e1"
synced: "2026-09-30"
reviewed: "no"
---

# ESX Coredump / Dump Collector — Bouwhandleiding

> **Nederlandse vertaling (pilot).** Dit is een machinevertaling die nog niet
> door een mens is nagekeken. De [Engelse versie](../11-esx-coredump.md) is
> leidend. Productnamen, commando's en menupaden uit de producten zijn bewust
> niet vertaald.

Geen onderdeel van een wizard die de VCF Installer uitvoert, en er wordt niet
naar gevraagd in het P&P-workbook — dit is een handmatige configuratiestap op
de hosts ná bring-up, in dezelfde categorie als NTP of DNS, maar makkelijk te
missen omdat niets in de fleet-tooling erom vraagt.

**Wat het is.** Standaard schrijft een ESX-host die een PSOD (Purple Screen of
Death) krijgt zijn coredump naar **lokale** schijf (een coredump-partitie, of
een bestand op VMFS/vSAN). Voor één host is dat prima, maar op fleet-schaal —
en zeker bij hosts die van een klein lokaal device booten — wil je crashdumps
centraal hebben, op een plek waar Broadcom Support er ook echt bij kan zonder
dat je achteraf op de console van elke host moet inloggen. De service
**VMware vSphere ESXi Dump Collector** doet dat: het is een netwerklistener
(UDP) aan de vCenter-kant, en elke ESX-host krijgt de instructie om zijn
coredump daarheen te sturen in plaats van (of naast) lokale opslag.

Twee helften, in deze volgorde: schakel de collector-service in **op vCenter**,
en laat daarna **elke host** ernaar wijzen.

---

## De volledige volgorde, van begin tot eind

Twee helften, in deze volgorde — schakel de collector in op vCenter en laat
daarna de hosts ernaar wijzen. Elke stap verwijst naar de sectie met de details.

1. **Schakel de Dump Collector-service in op vCenter**
   ([§1](#1-de-dump-collector-service-op-vcenter-inschakelen)) — stel hem in op
   automatisch starten, via de VAMI of via SSH naar de VCSA.
2. **Laat elke ESX-host naar de collector wijzen**
   ([§2](#2-elke-esx-host-naar-de-collector-laten-wijzen)) — per host met de
   hand (`esxcli system coredump network set …`), of op schaal met het
   fleet-script dat je downloadt en uitvoert.
3. **Open de firewall** ([§3](#3-firewall)) — de UDP-poort van de collector,
   vanaf elke ESX-management-vmkernel naar vCenter.
4. **Controleer** ([§4](#4-controleren)) — `esxcli system coredump network check`,
   en de host meldt **Network Dump Collector** op het tabblad *Configure* in
   vCenter zodra hij zich heeft gemeld.
5. **Als een host zich niet registreert** ([§5](#5-praktijknotities)) — de
   valkuilen uit de praktijk.

---

## 1. De Dump Collector-service op vCenter inschakelen

De service wordt met elke VCSA meegeleverd, maar wordt **standaard niet
gestart**.

**Via de vCenter Server Management interface (VAMI, poort 5480):**

1. Ga naar `https://<vcenter-fqdn>:5480` en log in als `root`.
2. **Services** → zoek **VMware vSphere ESXi Dump Collector**.
3. **Actions → Start**, daarna **Actions → Edit Startup Type → Automatic**,
   zodat de service een herstart van vCenter overleeft.

**Via SSH naar de VCSA** (zelfde effect, te scripten):

```bash
service-control --start vmware-netdumper
service-control --enable vmware-netdumper
service-control --status vmware-netdumper
```

Controleer dat de listener echt draait voordat je aan de hosts begint:

```bash
netstat -an | grep 6500
```

Je hoort hem te zien luisteren op **UDP/6500** — dat is de standaardpoort
waar de hosts naartoe gaan sturen.

---

## 2. Elke ESX-host naar de collector laten wijzen

Voer dit per host uit, rechtstreeks op de host of via `Get-EsxCli` in
PowerCLI voor de hele fleet in één keer.

**Per host, rechtstreeks (SSH of DCUI-shell):**

```bash
esxcli system coredump network set --interface-name vmk0 --server-ip <vcenter-fqdn-or-ip> --server-port 6500
esxcli system coredump network set --enable true
esxcli system coredump network check
```

`--interface-name` is de **vmkernel**-interface waarvandaan de host verstuurt —
meestal de management-VMkernel (`vmk0`), maar controleer of dat de interface
is die daadwerkelijk naar vCenter routeert als het managementnetwerk op jouw
build niet `vmk0` is. `network check` valideert de configuratie tegen het doel
zonder een echte crash te veroorzaken.

**Hele fleet in één keer — een script doet dit voor je. Download het en voer
het uit** (Windows PowerShell 5.1 of PowerShell 7; het vraagt om alles wat je
niet meegeeft):

| Script | Wat het doet |
| ------ | ------------ |
| [**Set-ESXCoredump.ps1**](https://vcf-planning.hollebollevsan.nl/scripts/Set-ESXCoredump.ps1) | Voert dezelfde `Get-EsxCli -V2`-aanroepen als hierboven uit tegen elke host in een vCenter (of een gekozen deelverzameling), plus de controle van de firewall-ruleset uit sectie 3, met ondersteuning voor `-WhatIf` en een resultatentabel per host. **Het schakelt de Dump Collector-service zelf niet in** — dat is sectie 1, eenmalig en handmatig, voordat je dit script uitvoert |

```console
.\Set-ESXCoredump.ps1 -VCenter vc01.sfo.example.io -CollectorAddress vc01.sfo.example.io -WhatIf
```

Laat `-WhatIf` weg om de wijzigingen door te voeren zodra het plan er goed
uitziet. `-VMHost` (of `Get-VMHost` via de pipeline) beperkt het tot een
deelverzameling in plaats van elke host; `-CollectorAddress` kan naar een
standalone Dump Collector wijzen in plaats van naar die van vCenter zelf.

Doe je het liever met de hand, of op één host zonder PowerCLI, dan zijn dit de
onderliggende commando's:

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

Coredump-verkeer is **uitgaand UDP/6500** van elke host naar de collector. De
firewall-ruleset `vSphereCoredumpClient` staat op ESX **standaard aan**, maar
controleer dat op een geharde build in plaats van het aan te nemen:

```bash
esxcli network firewall ruleset list | grep -i coredump
```

Als hij uitstaat:

```bash
esxcli network firewall ruleset set --ruleset-id=vSphereCoredumpClient --enabled=true
```

Zie [`07-firewall-ports.md`](../07-firewall-ports.md) (Engels) als dit verkeer
een fysieke firewallzone moet passeren (bijvoorbeeld hosts en vCenter in
verschillende securityzones) — UDP/6500 heeft een eigen regel nodig; het lift
niet mee op een bestaande allow-regel voor het managementvlak.

---

## 4. Controleren

```bash
esxcli system coredump network get
```

Controleer dat er `Enabled: true` staat en dat het IP-adres en de poort van de
server overeenkomen met wat je hebt ingesteld. Aan de vCenter-kant toont
**Monitor → System Configuration** voor een host de status **Network Dump
Collector** zodra de host zich heeft gemeld.

De echte test is een bewuste test, niet alleen het vergelijken van
configuratie — Broadcom documenteert precies hiervoor een **zachte
PSOD-trigger** (`vsish -e set /reliability/crashMe/Panic 1`, of op sommige
builds de DCUI-optie "Fault the host") als je wilt bewijzen dat een dump echt
op de collector aankomt voordat je hem in het echt nodig hebt. Behandel dat
als een activiteit voor een onderhoudsvenster, op een host die je kunt missen
voor een herstart, niet als een routinecontrole.

---

## 5. Praktijknotities

- **Dit is per host, niet voor de hele fleet.** Er is geen schakelaar "op alle
  hosts toepassen" zoals in een wizard — script het (zie hierboven), of neem
  het op in een **Host Profile**, zodat nieuwe hosts het bij commissioning
  overnemen en je dit niet opnieuw met de hand hoeft uit te voeren.
- **De collector-service en het coredump-doel hoeven niet dezelfde machine te
  zijn.** De eigen Dump Collector van vCenter is de gebruikelijke keuze, maar
  Broadcom levert ook een **standalone** ESXi Dump Collector voor omgevingen
  die geen crashverkeer op de vCenter-appliance zelf willen laten binnenkomen.
  Draait jouw omgeving een standalone collector, laat `--server-ip` dan
  daarnaar wijzen in plaats van naar vCenter.
- **Dit vervangt de lokale coredump-partities niet.** Netwerk-coredump komt er
  bovenop — als de host de collector niet kan bereiken op het moment van de
  PSOD (netwerk plat, wat goed denkbaar is op precies de machine die net is
  gecrasht), is de lokale partitie nog steeds de terugvaloptie. Verwijder de
  lokale coredump-voorziening niet in de veronderstelling dat het netwerkpad
  altijd werkt.

---

## Referenties

- [Configuring the Network Dump Collector service in vSphere](https://knowledge.broadcom.com/external/article/344063/configuring-the-network-dump-collector-s.html) —
  Broadcom KB
- [Configure ESXi Dump Collector with ESXCLI](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/configure-esxi-dump-collector-with-esxcli.html) —
  Broadcom TechDocs
- [VMware ESXi Dump Collector Support](https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/7-0/vsphere-networking/introduction-to-vsphere-networking/esxi-dump-collector-support.html) —
  Broadcom TechDocs
