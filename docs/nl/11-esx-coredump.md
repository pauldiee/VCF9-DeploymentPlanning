---
lang: nl
source: ../11-esx-coredump.md
source_hash: "3c28c5c36d9ba3ea"
synced: "2026-11-12"
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
Death) krijgt zijn coredump naar **lokale** schijf: sinds ESXi 7.0 een
dumpbestand op het ESX-OSData-volume, op oudere of geüpgradede builds
mogelijk een coredump-partitie (wat de host standaard doet en hoe je de dump
na de reboot terugvindt:
[§6](#6-de-lokale-standaard-psod-gedrag-en-de-dump-terugvinden)). Voor één
host is dat prima, maar op fleet-schaal —
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
6. **Controleer ook de lokale standaard**
   ([§6](#6-de-lokale-standaard-psod-gedrag-en-de-dump-terugvinden)) — een
   actief lokaal dumpdoel op elke host, en de keuze of hosts na een PSOD zelf
   herstarten.

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
- **Dit vervangt het lokale coredump-doel niet.** Netwerk-coredump komt er
  bovenop — als de host de collector niet kan bereiken op het moment van de
  PSOD (netwerk plat, wat goed denkbaar is op precies de machine die net is
  gecrasht), is het lokale dumpbestand (of de partitie) nog steeds de
  terugvaloptie. Verwijder de lokale coredump-voorziening niet in de
  veronderstelling dat het netwerkpad altijd werkt; zie §6 om te controleren
  dat die echt actief is.

---

## 6. De lokale standaard: PSOD-gedrag en de dump terugvinden

Wat een host uit zichzelf doet, nog vóór de netwerkconfiguratie hierboven.
De bronnen zijn de Broadcom-KB's onder *Referenties*; de meeste noemen ESXi
7.x en 8.x, KB 313264 noemt ook ESX 9.0. Citaten staan in het Engels, zoals
in de bron.

### 6.1 De host blijft op het paarse scherm staan

De advanced setting `Misc.BlueScreenTimeout` bepaalt of een host na een PSOD
zelf herstart. KB 345100: *"The default value is set to "0""*, en *"The
default and Broadcom recommended setting is to leave the host in an
unresponsive state with the purple diagnostic screen displayed on the console
screen to aid in troubleshooting."*

Standaard **herstart de host dus niet**: iemand moet het scherm lezen of
fotograferen en de host resetten. vSphere HA herstart de VM's hoe dan ook op
een andere host. Wil je liever een automatische herstart, stel dan het aantal
seconden in:

```bash
esxcfg-advcfg -s 120 /Misc/BlueScreenTimeout
esxcfg-advcfg -g /Misc/BlueScreenTimeout
```

of in de Host Client: **Manage → System → Advanced settings**, zoek
`Misc.BlueScreenTimeout`, bewerk, sla op (*"This does not need a host
reboot."*). De afweging: met een automatische herstart is de host sneller
terug, maar niemand ziet het paarse scherm. Zorg dat het dumpdoel werkt
(6.2) voordat je daarvoor kiest.

### 6.2 Waar de dump standaard heen gaat

Sinds ESXi 7.0 gaat de dump naar een **bestand**, niet naar een partitie.
KB 314320: *"ESXi 7.0 creates a VMFS-L based ESX-OSData volume and configures
a coredump file to be stored in it if the volume is larger than 4GB"*. De
bootoptie die daarachter zit (KB 313264, die ESX 9.0 noemt) is
`autoCreateDumpFile`, standaard `TRUE`: *"The attempted order of creating the
coredump file is first to the VMFS-L ESX-OSData, then to USB VMFS-L, and
finally a local VMFS datastore."* Het bestand krijgt automatisch een grootte
(`dumpSize` standaard 0) en is *"limited to half of the available space on
the VMFS-L volume."*

Controleer het op elke host:

```bash
esxcli system coredump file list        # Active en Configured allebei true
esxcli system coredump partition list   # een partitie in de oude stijl, als die er is
esxcli system coredump network get      # het netwerkdoel uit §2
```

Is er geen actief bestand, maak er dan een aan en activeer het (KB 314320;
`-d` en `-f` zijn optioneel, de host kiest dan zelf een datastore en naam):

```bash
esxcli storage filesystem list                              # noteer de datastore-UUID
esxcli system coredump file add -d <datastore_UUID> -f <naam>
esxcli system coredump file set --smart --enable true
esxcli system coredump file list
```

KB 314320: *"Software iSCSI and Software FCoE are not supported for coredump
locations."* Op hosts die van software iSCSI booten is het netwerkdoel uit
§2 daarom niet optioneel.

### 6.3 De dump terugvinden na de reboot

Zoek na de herstart naar een `vmkernel-zdump`-bestand. KB 310769: *"Find the
`vmkernel-zdump` file in the `/root/` or `/var/core/` directory"*.

```bash
ls -lh /var/core/ /root/
```

Een `vm-support`-bundel neemt hem mee, en om die bundel vraagt Broadcom
Support. Wil je de crash zelf lezen, haal dan de vmkernel-log uit de zdump
(KB 310769, *"Use the `vmkdump` or `esxcfg-dumppart` utility to extract the
log."*):

```bash
esxcfg-dumppart -L /var/core/vmkernel-zdump.1
```

Dat schrijft een platte tekst `vmkernel-log.<n>` met wat het paarse scherm
liet zien en de logregels daarvoor.

**Versleutelde dumps.** Met vSphere VM Encryption aan, KB 374266: *"ESXi core
dumps are automatically encrypted to protect sensitive customer data"*, ook
de kopieën in een `vm-support`-bundel. Ontsleutel ze op de host voordat je ze
analyseert; de host heeft na de reboot zijn sleutel van de key provider
nodig:

```bash
crypto-util envelope describe --offset 4096 /var/core/vmkernel-zdump.1
crypto-util envelope extract --offset 4096 /var/core/vmkernel-zdump.1 /var/core/unenc-vmkernel-zdump.1
```

### 6.4 Als er geen dump is

- **Geen actief doel na een upgrade.** KB 437765: na een upgrade naar een
  nieuwe hoofdversie kan het dumpbestand nog bestaan terwijl *"the kernel
  drops the active configuration pointer"*. vCenter geeft dan *"No coredump
  target has been configured. Host core dumps cannot be saved."* Herstel het
  met `esxcli system coredump file set --smart --enable true` (6.2).
  Controleer dit na elke upgrade, niet pas na de volgende crash.
- **De host herstartte zonder PSOD.** Een hardwarefout, een BMC-reset of
  stroomuitval laat geen zdump achter. De oorzaak staat dan in het eigen
  eventlog van de server (IPMI SEL, iDRAC, iLO, XCC).
- **De dump kon niet worden geschreven.** Viel het bootdevice zelf weg
  (bijvoorbeeld APD/PDL op een SAN-boot-LUN), dan was ook het lokale bestand
  op ESX-OSData onbereikbaar. Precies daarvoor is het netwerkdoel uit §2.
- **De host is te vroeg gereset.** Met de standaardtimeout van 0 toont het
  scherm de voortgang van de dump; laat die afmaken voordat iemand de host
  uit- en aanzet.

**Niet geverifieerd:** we vonden geen Broadcom-pagina die zegt dat de host de
dump bij de volgende boot automatisch naar `/var/core` kopieert, of hoe dat
specifiek op ESX 9 werkt. Wil je het op jouw build bewijzen, geef dan een
test-PSOD op een host die je kunt missen (§4) en kijk daarna in `/var/core`.

---

## Referenties

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
