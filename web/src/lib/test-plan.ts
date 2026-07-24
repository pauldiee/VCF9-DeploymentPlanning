// Scope-driven verification test plan for a VCF 9.1 deployment, used by the
// interactive tool (src/pages/tools/test-plan.astro).
//
// It consumes the SAME `Selection` as deployment-plan.ts, so the scope you build
// in the export tool decides which cases apply. Every case names the epic and
// story it proves, so the plan and the test plan stay legible against each other:
//
//   TP-0 Readiness   → E1–E4   (the pre-bring-up gate)
//   TP-1 Bring-up    → E5
//   TP-2 Mgmt config → E6
//   TP-3 Stretch     → E7      (management domain, and per stretched WLD)
//   TP-4 Day-2 fleet → E8
//   TP-5 Workload    → E9      (repeated per workload domain)
//   TP-6 Handover    → E10
//
// Case ids are STABLE: they are assigned in the catalogue below, not generated
// from the current scope, so narrowing the scope never renumbers the cases that
// remain. Per-WLD cases are keyed `<id>#<wld index>` so each domain tracks its
// own result.
//
// All case text here is original. It is informed by what a VCF 9.1 deployment
// actually has to prove, and deliberately covers the things the vendor
// verification material leaves out: the pre-bring-up readiness gate, distributed
// (Transit Gateway / VNA) connectivity, stretched clusters, backup, License Hub
// and Avi, non-vSAN principal storage, and Supervisor beyond "the VMs booted".

import {
  aviInScope,
  includedEpicList,
  isVsanStorage,
  licenseHubNeeded,
  normalizeSelection,
  typeLabel,
  type Selection,
  type Wld,
} from './deployment-plan';

/** Result of a single executed case. Mirrors the four states a verification sheet uses. */
export type TestStatus = 'P' | 'F1' | 'F2' | 'NA';

export const TEST_STATUSES: { value: TestStatus; label: string; hint: string }[] = [
  { value: 'P', label: 'Pass', hint: 'Verified, with evidence filed' },
  { value: 'F1', label: 'Critical fail', hint: 'Blocks the next phase and handover' },
  { value: 'F2', label: 'Non-critical fail', hint: 'Handover proceeds with a named owner and a date' },
  { value: 'NA', label: 'Not applicable', hint: 'Out of scope — record why' },
];

export interface TestCase {
  /** Stable id, e.g. "TP-206". Never renumbered when the scope changes. */
  id: string;
  title: string;
  /** Epic this case proves, e.g. "E6". */
  epic: string;
  /** Story this case proves, e.g. "6.4". */
  story: string;
  /** How to run it. */
  steps: string[];
  /** What "pass" looks like — the only thing that may be ticked P. */
  expected: string;
  /** A failure here blocks the phase gate and handover (status F1). */
  critical?: boolean;
  /** Field note: a trap, a sequencing constraint, or why this case exists at all. */
  note?: string;
}

export interface TestPhase {
  id: string; // "TP-2"
  title: string;
  /** What the phase proves before the next one may start. */
  gate: string;
  /** Deployment-plan epics this phase covers, e.g. "E6". */
  epics: string;
  /** Set when the phase repeats per workload domain. */
  wld?: { index: number; name: string };
  cases: TestCase[];
}

/** Per-case result. Key is `caseKey(phase, case)`. */
export interface TestResult {
  status: TestStatus;
  /** ISO date (yyyy-mm-dd) the case was executed. */
  date: string;
  /** Free text: measured value, evidence reference, or the reason for NA / F2. */
  actual?: string;
}
export type TestResults = Record<string, TestResult>;

/** Stable key for a result. Per-WLD phases append the domain index so each domain tracks separately. */
export function caseKey(phase: TestPhase, c: TestCase): string {
  return phase.wld ? `${c.id}#${phase.wld.index}` : c.id;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** A catalogue entry: a case plus the condition under which it applies. */
interface Entry extends TestCase {
  /** Omitted = always in scope for its phase. */
  when?: (sel: Selection) => boolean;
}
/** Per-WLD catalogue entry — the condition sees the domain as well as the fleet scope. */
interface WldEntry extends TestCase {
  when?: (w: Wld, sel: Selection) => boolean;
}

const isCentral = (sel: Selection) => sel.connectivity === 'centralized';
const isDistrib = (sel: Selection) => sel.connectivity === 'distributed';
const isVsan = (sel: Selection) => isVsanStorage(sel.storage);
const isExternalStorage = (sel: Selection) => !isVsanStorage(sel.storage);

// --- TP-0 — Readiness (E1–E4) ---------------------------------------------
// Almost all of this is absent from post-deployment verification material,
// which starts once the fleet exists. The readiness gate is where a deployment
// is actually won or lost, so it gets first-class cases.

const TP0: Entry[] = [
  {
    id: 'TP-001',
    title: 'Management VLANs trunked to every host uplink at the planned MTU',
    epic: 'E1',
    story: '1.1 / 4.2',
    critical: true,
    steps: [
      'On the ToRs, list the allowed VLANs per host-facing port and compare against your VLAN table. Cisco NX-OS: `show interface trunk`. Arista EOS: `show interfaces trunk`. Dell OS10: `show interface status`.',
      'Confirm the same VLAN set is on BOTH uplinks of every host — a VLAN trunked on one uplink only survives a casual test and fails at the first uplink outage.',
      'On a host, check the uplinks are up at the expected speed: `esxcli network nic list`',
      'Check the switch MTU as configured: `esxcli network vswitch dvs vmware list | grep -i mtu` (or, for a standard switch, `esxcli network vswitch standard list`).',
      'Now PROVE the MTU instead of reading it. From a host, ping a peer on each jumbo VLAN (vSAN, vMotion, host overlay) with do-not-fragment set at 8972 bytes payload — 9000 minus the 28-byte IP+ICMP header: `vmkping -I vmk1 -d -s 8972 <peer-vmk-ip>`',
      'Repeat to a peer in a DIFFERENT rack, so the test crosses the inter-switch link and any L3 hop rather than staying inside one ToR.',
      'List the VMkernel interfaces if you need the right vmk number and its IP: `esxcli network ip interface ipv4 get`',
    ],
    expected:
      'Every planned VLAN is trunked on both uplinks of every host, and an unfragmented 8972-byte ping succeeds across each jumbo VLAN — including between racks.',
    note: 'An MTU mismatch that only appears on the inter-rack path is the classic cause of a bring-up that stalls at cluster creation.',
  },
  {
    id: 'TP-002',
    title: 'Subnets and IP reservations do not overlap',
    epic: 'E1',
    story: '1.1',
    steps: [
      'List every planned subnet: management, vMotion, vSAN/storage, host overlay, edge/uplink or external, the fleet component ranges, the VCF services-runtime cluster CIDR, and on Distributed connectivity the private transit-gateway block.',
      'Check them for overlap against each other and against the existing routed network. A quick pass in PowerShell — paste your CIDRs and it flags any pair that overlaps:',
      '`$c=@("10.0.0.0/24","10.0.1.0/24"); $n=$c|%{ $p=$_.Split("/"); $b=([ipaddress]$p[0]).GetAddressBytes(); [array]::Reverse($b); $i=[bitconverter]::ToUInt32($b,0); $m=[uint32]([math]::Pow(2,32)-[math]::Pow(2,32-$p[1])); [pscustomobject]@{Cidr=$_;Start=$i-band $m;End=($i-band $m)+([math]::Pow(2,32-$p[1])-1)} }; foreach($a in $n){foreach($b in $n){if($a.Cidr -ne $b.Cidr -and $a.Start -le $b.End -and $b.Start -le $a.End){"OVERLAP: $($a.Cidr) <-> $($b.Cidr)"}}}`',
      'Ask the network team to confirm none of the ranges is already routed elsewhere — an overlap with something you cannot see from the build network is the one this check cannot catch.',
      'Confirm the static IP carve-outs are reserved in the IPAM system so nobody is handed one mid-build.',
    ],
    expected:
      'No subnet overlaps another planned subnet or an existing routed network, and every static reservation is recorded in IPAM.',
    note: 'The services-runtime CIDR and the transit-gateway block are internal to VCF but still have to be unique — they are the two most commonly forgotten.',
  },
  {
    id: 'TP-003',
    title: 'ToR BGP fabric is configured and ready to peer',
    epic: 'E1',
    story: '1.2 / 4.2',
    critical: true,
    when: isCentral,
    steps: [
      'On the ToRs, confirm the local AS and the neighbour statements for the planned edge uplink IPs. Cisco NX-OS: `show running-config bgp` then `show bgp sessions`. Arista EOS: `show running-config section bgp` then `show ip bgp summary`.',
      'Confirm the remote AS on each neighbour statement matches the Edge AS in your plan, and that BFD is set if the design calls for it: `show bfd neighbors`',
      'If BGP authentication is in scope, confirm the MD5 password is configured on the ToR side and recorded in the secret store — and that both sides will agree on it.',
      'Confirm the accept/advertise policy: which prefixes the fabric will take from the edges, and which it will advertise to them. `show ip prefix-list` / `show route-map`',
      'Confirm the uplink VLANs and their gateway SVIs exist and answer: `show ip interface brief` on the ToR, then ping each SVI from a host on that VLAN.',
    ],
    expected:
      'ToR-side BGP configuration is complete and waiting on the edges: neighbours defined with the correct remote AS, uplink VLANs live, and the accept/advertise policy agreed in writing.',
    note: 'VCF/NSX only needs the neighbour IP and remote AS — an MD5 password is optional and only required if the fabric enables authentication.',
  },
  {
    id: 'TP-004',
    title: 'External VLAN reaches every host in the domain, and the fabric routes it',
    epic: 'E1',
    story: '1.2 / 4.2',
    critical: true,
    when: isDistrib,
    steps: [
      'Confirm the external VLAN is trunked to EVERY host in the domain, not just a pair. There are no Edge VMs on this model, so every host participates in north-south. On the ToRs: `show interface trunk` and check the VLAN appears against every host-facing port.',
      'Cross-check from the host side across the whole cluster with PowerCLI: `Get-VMHost | Get-VirtualPortGroup | Where-Object VLanId -eq <external-vlan> | Select VMHost,Name,VLanId` — every host must appear in the output.',
      'Confirm the gateway SVI exists on the ToRs and is up: `show ip interface brief | include <svi>`',
      'Prove the gateway answers: put a temporary VMkernel or a test VM on the external VLAN and ping it — `vmkping -I <vmk> <gateway-ip>` — then check the ARP entry resolved rather than timing out: `esxcli network ip neighbor list`',
      'Trace outbound from an address in the external IP block to a known upstream destination: `traceroute <upstream-ip>` (ESXi) or `tracert <upstream-ip>` (Windows). Confirm the first hop is the external VLAN gateway.',
      'Get WRITTEN confirmation from the fabric team that the external IP block is advertised upstream and that return traffic comes back to this gateway. Inbound is the half that silently does not work.',
    ],
    expected:
      'The external VLAN is present on every host in the domain, its gateway answers, and the external IP block is reachable from upstream in both directions.',
    note: 'On Distributed connectivity there is no Tier-0 — the physical fabric performs the routing NSX would otherwise do. This is a hard gate, not a follow-up, and it is the single most common Distributed-deployment failure.',
  },
  {
    id: 'TP-005',
    title: 'Private transit-gateway block is a /16 and is free',
    epic: 'E1',
    story: '1.2',
    critical: true,
    when: isDistrib,
    steps: [
      'Confirm the planned private transit-gateway block is a **/16** — check the value in the workbook/plan before it is entered, and afterwards in NSX Manager → **Networking → Transit Gateway**.',
      'Confirm it overlaps nothing — include it in the TP-002 overlap sweep rather than checking it by eye.',
    ],
    expected: 'The private transit-gateway block is a /16 and overlaps nothing.',
    note: 'A /24 was accepted in VCF 9.0. In 9.1 it never completes — the deployment hangs rather than erroring clearly, so catch it here.',
  },
  {
    id: 'TP-006',
    title: 'Forward and reverse DNS resolve for every planned FQDN',
    epic: 'E1',
    story: '1.3 / 4.3',
    critical: true,
    steps: [
      'Put every planned FQDN in a text file, one per line: every ESX host, vCenter, SDDC Manager, the NSX Manager VIP and all three nodes, the Edge nodes (Centralized) or VNA appliances (Distributed), the VCF Operations nodes and any external LB VIP, the Cloud Proxy, the License Server, every VCF Management Services FQDN, and any Day-2 appliance FQDNs already known.',
      'Check forward AND reverse in one pass from a client on the management network — this prints a line per name and flags anything that fails either way:',
      '`Get-Content .\\fqdns.txt | ForEach-Object { $a=(Resolve-DnsName $_ -Type A -ErrorAction SilentlyContinue).IPAddress; $p=if($a){(Resolve-DnsName $a -Type PTR -ErrorAction SilentlyContinue).NameHost}; $ok=if($a -and $p -eq $_){"OK"}else{"** FAIL **"}; "{0,-45} {1,-16} {2,-45} {3}" -f $_,$a,$p,$ok }`',
      'From Linux or a shell: `while read f; do ip=$(dig +short A "$f"); ptr=$(dig +short -x "$ip"); echo "$f -> $ip -> $ptr"; done < fqdns.txt`',
      'Spot-check a couple of names from an ESX host too, since it uses its own resolver config: `nslookup <fqdn>` and `esxcli network ip dns server list`',
      'Run this from the management network, NOT on the DNS server itself — a record that resolves locally but is not served to the management subnet still fails bring-up.',
    ],
    expected:
      'Every planned FQDN resolves forward to its planned IP, and every planned IP resolves back to the same name. No missing PTR records.',
    note: 'Missing PTR records are the most common single cause of a failed bring-up. Forward-only is not a pass.',
  },
  {
    id: 'TP-007',
    title: 'NTP sources are reachable and serving from the management subnet',
    epic: 'E1',
    story: '1.3 / 4.3',
    critical: true,
    steps: [
      'From Windows, query each planned source directly and read the offset: `w32tm /stripchart /computer:<ntp-server> /samples:5 /dataonly`',
      'From Linux or an ESX host: `ntpdate -q <ntp-server>` — check the reported stratum and offset are sane (stratum well under 16, offset small).',
      'Query every planned source and confirm they agree with each other to within a second. Two sources a minute apart is worse than one source.',
      'Confirm UDP 123 is permitted from the management subnet: `Test-NetConnection <ntp-server> -Port 123 -InformationLevel Detailed` (note TCP test only proves routing; the `w32tm`/`ntpdate` query above is the real check).',
      'On an already-built ESX host, confirm it is actually synced rather than just configured: `esxcli system ntp get` then `esxcli system ntp stats get`',
    ],
    expected: 'Every planned NTP source answers from the management subnet and the sources agree with each other.',
    note: 'Time skew breaks certificate validation and SSO in ways that surface much later as unrelated-looking failures.',
  },
  {
    id: 'TP-008',
    title: 'Certificate authority is reachable and issues from the chosen template',
    epic: 'E1',
    story: '1.4',
    steps: [
      'Confirm the CA type matches the plan — Microsoft CA or OpenSSL are both supported fleet CA types. An external CA is CSR-based only: VCF will not import an externally created certificate plus its private key.',
      'Microsoft CA: confirm it is reachable and list the available templates — `certutil -config "<ca-host>\\<ca-name>" -ping` then `certutil -template | findstr /i "TemplatePropCommonName"`',
      'Generate a throwaway CSR: `openssl req -new -newkey rsa:2048 -nodes -keyout test.key -out test.csr -subj "/CN=cert-test.<domain>" -addext "subjectAltName=DNS:cert-test.<domain>"`',
      'Submit it against the intended template: `certreq -submit -config "<ca-host>\\<ca-name>" -attrib "CertificateTemplate:<TemplateName>" test.csr test.cer`',
      'Inspect what came back: `openssl x509 -in test.cer -noout -text | findstr /i "Signature Algorithm Public-Key Not Before Not After Key Usage DNS"`',
      'Check it against fleet requirements: RSA 2048 or better, SHA-256 or better, Key Usage includes Digital Signature and Key Encipherment, Extended Key Usage includes Server Authentication and Client Authentication, and the SAN carried through.',
      'Delete the throwaway certificate and key when done.',
    ],
    expected:
      'A test certificate is issued from the intended template and its key usage, key size, and validity match fleet requirements.',
    note: 'Discovering the template is wrong during the fleet-wide replacement (TP-428) costs a day. It costs ten minutes here.',
  },
  {
    id: 'TP-009',
    title: 'Sizing fits the proposed hosts at N-1',
    epic: 'E2',
    story: '2.2',
    steps: [
      'Run the sizing calculation for the agreed component set on the **Sizing calculator** tool (`/tools/mgmt-sizing/`), including any Day-2 fleet and License Hub footprint.',
      'Compare CPU, memory, and usable capacity against the proposed hosts with ONE host removed from the cluster.',
      'For vSAN, size against usable capacity after the chosen failure tolerance — and after site mirroring if the cluster will be stretched, which roughly doubles consumption.',
    ],
    expected: 'The full component set fits within N-1 host capacity, or the host count/spec has been adjusted and re-signed by the architect.',
  },
  {
    id: 'TP-010',
    title: 'Hosts are on the compatibility guide, identically specified, and meet the cluster minimum',
    epic: 'E4',
    story: '4.1',
    critical: true,
    steps: [
      'Dump the fleet spec in one pass with PowerCLI and eyeball it for outliers: `Get-VMHost | Select Name,Model,ProcessorType,NumCpu,CpuTotalMhz,@{n="RAM_GB";e={[math]::Round($_.MemoryTotalGB)}},Version,Build | Sort Name | Format-Table -Auto`',
      'Every row should be identical apart from the name. A single mismatched host is accepted at commission and causes imbalance later.',
      'List the storage controllers and NICs to check against the compatibility guide: `Get-VMHost | Get-VMHostPciDevice | Where-Object DeviceClassName -match "Serial Attached SCSI|RAID|Ethernet" | Select VMHost,DeviceName,VendorName`',
      'Per host, get the driver and firmware for the storage controller: `esxcli storage core adapter list` then `vmkload_mod -s <driver> | grep -i version`',
      'Check each model, controller and NIC against the Broadcom compatibility guide for the target release, at the installed driver/firmware level — the model being listed is not enough if the firmware is not.',
      'Confirm the host count meets the cluster minimum for the chosen configuration: `(Get-Cluster <name> | Get-VMHost).Count`',
    ],
    expected:
      'Every host is listed on the compatibility guide at its installed firmware/driver level, all hosts in a cluster are identically specified, and the count meets the minimum.',
  },
  {
    id: 'TP-011',
    title: 'Even host split across availability zones',
    epic: 'E4',
    story: '4.1',
    critical: true,
    when: (sel) => sel.mgmtStretched,
    steps: [
      'Confirm the host count divides evenly between AZ1 and AZ2 — count the physical hosts destined for each AZ against your rack plan. An uneven split is rejected at stretch time, after the hosts are already racked and commissioned.',
      'Once commissioned, verify from the inventory: `Get-Cluster <name> | Get-VMHost | Select Name,@{n="AZ";e={$_.Parent}} | Group-Object AZ | Select Name,Count`',
      'Confirm each AZ alone has the CPU, memory and capacity to run the workload the surviving site must carry — half the cluster running everything, not half the workload.',
    ],
    expected: 'Hosts split evenly per AZ, and either AZ alone has the capacity to run the protected workload.',
    note: 'An uneven split is rejected at stretch time, after the hosts have already been racked and commissioned.',
  },
  {
    id: 'TP-012',
    title: 'vSAN disks are present, unclaimed, and eligible',
    epic: 'E4',
    story: '4.1',
    when: isVsan,
    steps: [
      'On each host, list which devices are eligible for vSAN and why the ineligible ones are not: `vdq -q` — look for `"State":"Eligible for use by VSAN"`. Anything reporting `Ineligible` gives its reason in the same output.',
      'A device that is ineligible because it holds an old partition can be cleared with `partedUtil` — but confirm it really is spare before wiping anything.',
      'List the devices with their transport and size to confirm they are the ones you intend: `esxcli storage core device list | grep -E "Display Name|Size|Is SSD|Device Type"`',
      'Confirm the controller is in pass-through / HBA mode rather than presenting a RAID volume: `esxcli storage core adapter list`',
      'For vSAN ESA, confirm the devices are all-flash NVMe and on the ESA compatibility list, and that the host has the network bandwidth ESA expects (25 GbE): `esxcli network nic list`',
    ],
    expected: 'Every intended device on every host is visible, unclaimed, and eligible for the chosen vSAN configuration.',
  },
  {
    id: 'TP-013',
    title: 'External principal storage is presented and mountable from every host',
    epic: 'E4',
    story: '4.1',
    critical: true,
    when: isExternalStorage,
    steps: [
      'NFS — confirm the export is reachable and mounts on every host: `esxcli storage nfs add -H <nfs-server> -s <export-path> -v <datastore-name>` then `esxcli storage nfs list` (use `nfs41` in place of `nfs` for NFS 4.1).',
      'FC — rescan and confirm the LUN appears: `esxcli storage core adapter rescan --all` then `esxcli storage core device list | grep -E "Display Name|Size"`',
      'Run the check across the WHOLE cluster in one go, because "it mounted on the first host" is the classic false pass: `Get-Cluster <name> | Get-VMHost | ForEach-Object { $m = $_ | Get-Datastore | Where-Object Name -eq "<datastore>"; "{0,-30} {1}" -f $_.Name, $(if ($m) { "MOUNTED" } else { "** MISSING **" }) }`',
      'Confirm the same volume presents with the same identifier everywhere: `Get-Cluster <name> | Get-VMHost | Get-Datastore <datastore> | Select Name,CapacityGB,@{n="Id";e={$_.ExtensionData.Info.Url}}`',
      'FC only — confirm full path redundancy, not a host quietly running on one path: `esxcli storage core path list -d <naa.id> | grep -E "Runtime Name|State"` and confirm every expected path is `active`.',
      'Prove it is writable: create a folder on the datastore from the vSphere Client (Datastore → Files → New Folder), or `touch /vmfs/volumes/<datastore>/writetest` from a host. Remove it afterwards.',
    ],
    expected:
      'The principal datastore mounts on every host in the cluster with a consistent identifier, and read/write succeeds on all of them.',
    note: 'Vendor verification material is vSAN-only throughout, so external principal storage has no coverage at all — this case exists to close that. Note that an NFS or FC cluster cannot be stretched.',
  },
  {
    id: 'TP-014',
    title: 'Active Directory is reachable and the bind account authenticates',
    epic: 'E4',
    story: '4.3',
    steps: [
      'Confirm each planned domain controller answers on the LDAPS port from the management network: `Test-NetConnection <dc-fqdn> -Port 636` (and 389 if plain LDAP is in the design).',
      'Bind with the service account and search the planned base DN — this proves the credential AND the base DN in one go: `$c = Get-Credential; $e = New-Object System.DirectoryServices.DirectoryEntry("LDAP://<dc-fqdn>:636/<base-dn>", $c.UserName, $c.GetNetworkCredential().Password); $s = New-Object System.DirectoryServices.DirectorySearcher($e); $s.Filter = "(objectClass=user)"; $s.SizeLimit = 5; $s.FindAll() | ForEach-Object { $_.Path }`',
      'From Linux: `ldapsearch -x -H ldaps://<dc-fqdn>:636 -D "<bind-dn>" -W -b "<base-dn>" "(objectClass=user)" dn`',
      'Check the bind account will not expire underneath the fleet: `Get-ADUser <svc-account> -Properties PasswordNeverExpires,PasswordExpired,PasswordLastSet,Enabled | Select Name,Enabled,PasswordNeverExpires,PasswordExpired,PasswordLastSet`',
      'Confirm the planned groups exist and hold the expected members: `Get-ADGroup -Filter "Name -like \'<vcf-group-prefix>*\'" | ForEach-Object { $_.Name; Get-ADGroupMember $_ | Select -Expand SamAccountName }`',
      'Record the bind credential in the secret store, and record WHO owns it.',
    ],
    expected: 'The bind account authenticates against every planned domain controller and can read the intended base DN; the planned groups exist.',
    note: 'The bind account is a shared dependency across vCenter, NSX, VCF Operations and the Identity Broker — a rotation breaks every consumer at once. Record who owns it.',
  },
  {
    id: 'TP-015',
    title: 'Required firewall flows are open',
    epic: 'E4',
    story: '4.3',
    steps: [
      'Build a host/port list per zone from `07-firewall-ports.md`, then test it from a machine ON the source subnet — a rule review is not a test.',
      'Sweep a list in one pass: `@( @{h="<dc>";p=636}, @{h="<dns>";p=53}, @{h="<ca>";p=443}, @{h="<depot>";p=443} ) | ForEach-Object { $r = Test-NetConnection $_.h -Port $_.p -WarningAction SilentlyContinue; "{0,-30} {1,-6} {2}" -f $_.h, $_.p, $(if ($r.TcpTestSucceeded) { "OPEN" } else { "** BLOCKED **" }) }`',
      'The Cloud Proxy path to VCF Operations specifically — three ports, all needed: `443, 4505, 4506 | ForEach-Object { $r = Test-NetConnection <vcf-ops-fqdn> -Port $_ -WarningAction SilentlyContinue; "{0,-6} {1}" -f $_, $r.TcpTestSucceeded }`',
      'From an ESX host where PowerShell is not available: `nc -z <host> <port>` or `esxcli network firewall ruleset list`',
      'Confirm UDP flows separately (DNS 53, NTP 123, syslog 514) — `Test-NetConnection` is TCP only, so use the protocol-level checks from TP-006 and TP-007 instead of assuming.',
    ],
    expected: 'Each zone is proven open by a successful connection from a host on the source subnet.',
  },
  {
    id: 'TP-016',
    title: 'Software depot is reachable, or the offline depot is staged and serving',
    epic: 'E4',
    story: '4.3',
    critical: true,
    steps: [
      'Connected site — confirm the depot answers from the management network: `curl -I https://depot.broadcom.com` (add `-x http://<proxy>:<port>` if a proxy is in use).',
      'Air-gapped site — confirm the offline depot is serving and its certificate is trusted: `curl -I https://<offline-depot-fqdn>/` (drop `-k`; if it only works WITH `-k`, the certificate is not trusted and the fleet will fail where curl succeeded).',
      'Now confirm the BINARIES are there, not just that the endpoint answers. In VCF Operations: **Fleet Management → Lifecycle → Binary Management** (or **Software Depot**) — check the exact target BOM version is listed and shows as downloaded rather than available-to-download.',
      'Cross-check the depot connection itself: **VCF Operations → Fleet Management → Lifecycle → Settings → Depot** — confirm the URL and credentials are set and the connection status is green.',
      'If a proxy is required, confirm it is stored on the services runtime with `tools/Get-VCFProxyConfig.ps1` in this repo.',
    ],
    expected: 'The depot answers from the management network AND the complete target BOM is available from it.',
    note: 'Reachability alone is a false pass: an empty or partially synced offline depot answers perfectly and then fails at the first lifecycle operation.',
  },
  {
    id: 'TP-017',
    title: 'Build access: jump host and out-of-band consoles',
    epic: 'E4',
    story: '4.4',
    steps: [
      'From the jump/bastion host, reach each planned appliance address: `@("<esxi-1>","<esxi-2>","<vcenter>","<sddc-manager>") | ForEach-Object { $r = Test-NetConnection $_ -Port 443 -WarningAction SilentlyContinue; "{0,-30} {1}" -f $_, $r.TcpTestSucceeded }`',
      'Open the out-of-band console (iDRAC / iLO / BMC) of EVERY host in a browser and confirm console redirection and virtual media both work — not just that the login page loads.',
      'Check the BMCs answer across the board: `@("<bmc-1>","<bmc-2>") | ForEach-Object { $r = Test-NetConnection $_ -Port 443 -WarningAction SilentlyContinue; "{0,-20} {1}" -f $_, $r.TcpTestSucceeded }`',
      'Confirm the build team has working credentials for both the jump host and the BMCs, and that they are in the secret store.',
    ],
    expected: 'The build team reaches the management network and can open a console on every host.',
    note: 'Out-of-band configuration is not part of VCF. If the site has no BMC cards, mark NA and record how hosts will be recovered instead.',
  },
];

// --- TP-1 — Management bring-up (E5) --------------------------------------

const TP1: Entry[] = [
  {
    id: 'TP-101',
    title: 'Hosts are imaged to the BOM build and correctly networked',
    epic: 'E5',
    story: '5.1',
    steps: [
      'Confirm the build matches the BOM exactly, not just the major version — run this on each host: `esxcli system version get`',
      'Or across all of them at once from PowerCLI: `Get-VMHost | Select Name,Version,Build | Sort Name`',
      'Confirm the management VMkernel has the planned IP, mask and gateway: `esxcli network ip interface ipv4 get` and `esxcli network ip route ipv4 list`',
      'Confirm the management port group VLAN: `esxcli network vswitch standard portgroup list`',
      'Confirm DNS and the search domain, then prove resolution works both ways from the host itself: `esxcli network ip dns server list` then `nslookup <this-host-fqdn>` and `nslookup <its-ip>`',
      'Confirm NTP is configured, running, set to start with the host, and actually synced: `esxcli system ntp get` then `esxcli system ntp stats get`',
      'Confirm the root password is the planned one — log in with it once — and that it is recorded in the secret store.',
    ],
    expected:
      'Every host runs the BOM build, is reachable on its planned management address, resolves DNS both ways, and is time-synced.',
  },
  {
    id: 'TP-102',
    title: 'VCF Installer is staged on the VM-Management VLAN under the planned SDDC Manager identity',
    epic: 'E5',
    story: '5.2',
    critical: true,
    steps: [
      'Confirm the Installer carries the IP and FQDN planned for SDDC Manager — it becomes SDDC Manager at bring-up, so this is not a throwaway address: `Resolve-DnsName <planned-sddc-manager-fqdn>` must return the Installer\'s IP.',
      'Check the port group VLAN on the host running it: `esxcli network vswitch standard portgroup list` — a fresh host\'s default `VM Network` is untagged (VLAN 0). If VM Management is a tagged VLAN, the appliance has NO connectivity until the VLAN ID is set.',
      'Set it if needed: `esxcli network vswitch standard portgroup set -p "VM Network" -v <vlan-id>`',
      'Open the Installer UI at `https://<planned-sddc-manager-fqdn>` and confirm it loads over the NAME, not just the IP.',
      'From the Installer, confirm it reaches every ESX host — `ping <esxi-mgmt-ip>` for each, or run the Installer\'s own host-validation step.',
      'If the Installer runs OUTSIDE the management domain the wizard deploys a SEPARATE new SDDC Manager appliance and asks for its FQDN. Confirm that extra FQDN and IP are planned and in DNS: `Resolve-DnsName <separate-sddc-manager-fqdn>`',
    ],
    expected:
      'The Installer is reachable on the planned SDDC Manager FQDN, sits on the VM-Management VLAN, and can reach every management host.',
  },
  {
    id: 'TP-103',
    title: 'Bring-up completes and the core components are healthy',
    epic: 'E5',
    story: '5.3',
    critical: true,
    steps: [
      'On the Installer **Review** page, DOWNLOAD THE JSON SPEC before starting. It is the repeatable record of what was actually deployed and can be edited and re-uploaded for a repeat run.',
      'Note any soft-stop warning about resource headroom below 20% and record the decision taken.',
      'Run bring-up and watch its milestones: vCenter → SDDC Manager → vSphere cluster → NSX → VCF Management Platform → operations appliance → VCF Management Services. Budget four to six hours.',
      'After completion, confirm vCenter: `Connect-VIServer <vcenter-fqdn>` then `Get-VMHost | Select Name,ConnectionState`, and check **vCenter → Monitor → Issues and Alarms** is clear.',
      'Confirm the NSX Manager cluster: NSX Manager → **System → Appliances** — three nodes **Stable**, cluster green, and the VIP answering: `Test-NetConnection <nsx-vip-fqdn> -Port 443`',
      'Confirm VCF Operations is up at `https://<vcf-ops-fqdn>/` (TP-107 checks its cluster in detail).',
      'Confirm SDDC Manager lists the domain: **SDDC Manager → Inventory → Workload Domains**.',
    ],
    expected:
      'Bring-up completes without error; vCenter, SDDC Manager, NSX (3 nodes plus VIP) and VCF Operations are all reachable and healthy.',
  },
  {
    id: 'TP-104',
    title: 'vSAN datastore is online and health checks are clean',
    epic: 'E5',
    story: '5.3',
    critical: true,
    when: isVsan,
    steps: [
      'vSphere Client → **Cluster → Monitor → vSAN → Skyline Health** → click **Retest**. Retesting matters: the default view can be a cached run from before the cluster settled.',
      'Work through every red or amber check and either resolve it or record why it is accepted.',
      'Same page → **Proactive Tests** → run **VM Creation Test**.',
      'Same page → **Proactive Tests** → run **Network Performance Test**.',
      'From the CLI if you prefer: `esxcli vsan health cluster list` for the check list, and `esxcli vsan cluster get` to confirm the host is in the cluster with the expected role.',
      'Confirm capacity against sizing: **Cluster → Monitor → vSAN → Capacity**, or `Get-Cluster <name> | Get-Datastore | Select Name,CapacityGB,FreeSpaceGB`',
    ],
    expected: 'No failed health checks; both proactive tests pass; datastore capacity matches the sizing output.',
  },
  {
    id: 'TP-105',
    title: 'External principal datastore is online across the cluster',
    epic: 'E5',
    story: '5.3',
    critical: true,
    when: isExternalStorage,
    steps: [
      'Confirm the datastore is mounted on every host: `Get-Cluster <name> | Get-VMHost | ForEach-Object { $m = $_ | Get-Datastore | Where-Object Name -eq "<datastore>"; "{0,-30} {1}" -f $_.Name, $(if ($m) { "MOUNTED" } else { "** MISSING **" }) }`',
      'Confirm it is writable — create and remove a folder via **vSphere Client → Datastore → Files → New Folder**, or `touch /vmfs/volumes/<datastore>/writetest` from a host.',
      'FC only — confirm full path redundancy so no host is quietly on one path: `esxcli storage core path list -d <naa.id> | grep -E "Runtime Name|State"`',
      'Confirm capacity matches sizing: `Get-Datastore <datastore> | Select Name,CapacityGB,FreeSpaceGB`',
    ],
    expected: 'The principal datastore is mounted and writable on every host, with full path redundancy where applicable.',
  },
  {
    id: 'TP-106',
    title: 'Auto-generated component passwords are captured',
    epic: 'E5',
    story: '5.3',
    critical: true,
    steps: [
      'The Installer auto-generates every component password. Retrieve them from the Installer UI → **Review Passwords**, during or immediately after the deploy.',
      'Store every credential in the engagement secret store.',
      'Cross-check against what SDDC Manager holds, so nothing is missed: `.\\tools\\Get-VCFCredentials.ps1 -SDDCManager <fqdn> -Credential (Get-Credential)` — read-only, masked by default.',
      'Confirm each captured credential actually works by logging in with it once. A password captured with a transcription error looks identical to a correct one.',
    ],
    expected: 'Every auto-generated credential is captured, stored in the secret store, and verified by a successful login.',
    note: 'VCF Operations password management is rotate-and-expire only — there is no reveal API. If these are not captured now, they are not recoverable later.',
  },
  {
    id: 'TP-107',
    title: 'VCF Operations cluster is online and consistent',
    epic: 'E5',
    story: '5.4',
    steps: [
      'Open the admin interface at `https://<vcf-ops-fqdn>/admin` and log in with the admin account (this is a different UI from the main `https://<vcf-ops-fqdn>/`).',
      'Go to **System Status** in the left nav. Under **Cluster Status**, confirm the cluster reports **Online**.',
      'On the same page, confirm every node shows state **Running** and status **Online**, and that the **Cluster Role** column matches the design.',
      'Same page — confirm all nodes report the same version and build. A version split is a silent source of odd behaviour.',
      'Same page — confirm each node reports a non-zero **Objects** and **Metrics** count.',
      'Same page — confirm **SSH Status** is off (no green) on every node, unless SSH has been explicitly approved and documented.',
      'If HA or Continuous Availability is in scope, confirm the chosen mode shows **Enabled** on the same page. They are mutually exclusive — only one should be on.',
      'If the cluster is not yet online, check **Software Update** in the left nav first: a fresh cluster runs a post-deploy software step and stays offline until it finishes.',
    ],
    expected:
      'Cluster online; all nodes running, online, same build, reporting non-zero objects and metrics; SSH off unless approved; the chosen availability mode enabled.',
    note: 'A new cluster can take a while to come online while its post-deploy software step finishes. Check the update status before treating it as a failure.',
  },
  {
    id: 'TP-108',
    title: 'Data collection is running',
    epic: 'E5',
    story: '5.4',
    steps: [
      'In the admin UI (`https://<vcf-ops-fqdn>/admin`) → **System Status** — confirm every adapter instance shows **Data Receiving**.',
      'In the main UI (`https://<vcf-ops-fqdn>/`) → **Administration → Management → Collector Groups** — confirm the expected groups exist and each holds the right members.',
      'Main UI → **Inventory** — confirm every workload domain is listed and is collecting rather than sitting at zero objects.',
    ],
    expected: 'All adapter instances are receiving data, collector groups are correctly populated, and every domain appears in the inventory.',
  },
  {
    id: 'TP-109',
    title: 'License Server resolves outside the services-runtime range',
    epic: 'E5',
    story: '5.4',
    critical: true,
    steps: [
      'Confirm the License Server appliance exists and is healthy: **VCF Operations → Fleet Management → Lifecycle** — it is deployed automatically by the Installer, so this is a verify, not a deploy.',
      'Resolve its FQDN and check the address: `Resolve-DnsName <license-server-fqdn>`',
      'Confirm that address is IPv4 and falls OUTSIDE the VCF services-runtime range — compare against the services-runtime CIDR from TP-002. Inside the range is a misconfiguration that bites later, not at deploy time.',
      'Note the evaluation start date so the 90-day window is a diarised deadline: **VCF Operations → Manage → Licensing → Registration**.',
    ],
    expected: 'The License Server is healthy and its FQDN resolves to an IPv4 address outside the services-runtime range.',
    note: 'This is the bring-up License Server. It is a different appliance from License Hub (TP-411) and the two coexist.',
  },
  {
    id: 'TP-110',
    title: 'Cloud Proxy is collecting',
    epic: 'E5',
    story: '5.4',
    steps: [
      'Confirm the Cloud Proxy VM exists and sits on the VM-Management network: `Get-VM | Where-Object Name -match "cloud-proxy|cloudproxy" | Select Name,PowerState,@{n="Network";e={($_ | Get-NetworkAdapter).NetworkName}}`',
      'From the Cloud Proxy, confirm all three ports to VCF Operations: `443, 4505, 4506 | ForEach-Object { $r = Test-NetConnection <vcf-ops-fqdn> -Port $_ -WarningAction SilentlyContinue; "{0,-6} {1}" -f $_, $r.TcpTestSucceeded }`',
      'Confirm it is registered and collecting: **VCF Operations → Administration → Management → Collector Groups**, or **Data Sources → Cloud Proxies** — status should be connected with a recent heartbeat, not merely present.',
    ],
    expected: 'The Cloud Proxy is on the VM-Management network, connected, and actively collecting.',
  },
  {
    id: 'TP-111',
    title: 'Fleet lifecycle sees the depot, the components and the instances',
    epic: 'E5',
    story: '5.4',
    steps: [
      '**VCF Operations → Fleet Management → Lifecycle** — confirm every deployed component is listed.',
      'Same page — confirm the depot is configured and binaries are listed against those components.',
      'Same page — confirm every VCF instance shows as connected.',
      '**Fleet Management → Fleet Management → Identity & Access** — confirm the identity broker is present (it deploys at bring-up with the management services; configuring it for fleet SSO is TP-422, later).',
      'Confirm the VCF Management Services appliances are up and healthy — services runtime, identity broker, fleet and SDDC lifecycle, software depot, telemetry.',
    ],
    expected: 'All components, the depot with its binaries, and every VCF instance are visible and connected in fleet lifecycle.',
  },
  {
    id: 'TP-112',
    title: 'A support bundle can be generated and read',
    epic: 'E5',
    story: '5.4',
    steps: [
      'Admin UI (`https://<vcf-ops-fqdn>/admin`) → **Support** → generate a **light** support bundle for all nodes, then download it.',
      'Open the archive and confirm it holds readable content for EVERY node, not just the primary.',
      'Repeat for a **full** support bundle from the same page.',
      'For the platform side, run the health check from SDDC Manager over SSH: `ssh vcf@<sddc-manager>` then `cd /opt/vmware/sddc-support` and `./sos --health-check`',
    ],
    expected: 'Both bundle types generate successfully and contain readable per-node content.',
    note: 'Slow. Start it in parallel with other work rather than blocking on it — but do prove it now, because the first time you need a bundle is the worst time to discover it fails.',
  },
];

// --- TP-2 — Management domain configuration (E6) --------------------------

const TP2: Entry[] = [
  {
    id: 'TP-201',
    title: 'Edge cluster, Tier-0 and BGP are up with routes exchanged',
    epic: 'E6',
    story: '6.1',
    critical: true,
    when: isCentral,
    steps: [
      'NSX Manager → **System → Fabric → Nodes → Host Transport Nodes** — every host shows **Up** / **Success**. Then **Edge Transport Nodes** and **Edge Clusters** — edges deployed and the cluster formed.',
      'NSX Manager → **Networking → Tier-0 Gateways** → your T0 → confirm status is **Up** and the interfaces sit on the planned uplink VLANs and IPs.',
      'SSH to an edge node (`ssh admin@<edge-node>`) and check the sessions: `get bgp neighbor summary` — every neighbour must show **Established**, with a non-zero uptime.',
      'Check BFD if the design uses it: `get bfd-sessions`',
      'Now check BOTH directions, which is where the real failure hides. Received: `get route bgp`. Advertised: `get bgp neighbor <peer-ip> advertised-routes`',
      'An Established session that exchanges no prefixes is the classic false pass — confirm actual routes, not just the neighbour state.',
      'Confirm the full table the T0 will forward on: `get route`',
      'From a VM on an overlay segment, reach past the ToRs: `ping <upstream-ip>` and `tracert <upstream-ip>` — the path should leave via the T0 uplink.',
    ],
    expected:
      'Edge cluster and Tier-0 up; every BGP neighbour established; expected prefixes exchanged in both directions; north-south traffic reaches beyond the ToRs.',
    note: 'An established session with no prefixes exchanged is a very common false pass. Always check the route tables, not the neighbour state.',
  },
  {
    id: 'TP-202',
    title: 'Distributed Transit Gateway is up on the external VLAN and routed by the fabric',
    epic: 'E6',
    story: '6.1',
    critical: true,
    when: isDistrib,
    steps: [
      'NSX Manager → **Networking → Transit Gateway** → confirm the transit gateway exists and its attachment sits on the external VLAN planned in TP-004.',
      'On the same page, confirm the private transit-gateway block is a **/16**. In 9.1 a /24 does not error — the deployment just never completes.',
      'Confirm the external IP block: **Networking → IP Address Pools → IP Address Blocks** — the routable block that north-south NAT/SNAT and any VIPs draw from.',
      'Confirm the fabric side: the external VLAN gateway CIDR is routed and the external IP block is advertised upstream. On the ToRs: `show ip route <external-block>` and `show ip bgp <external-block>` if it is redistributed into BGP.',
      'From a VM behind the transit gateway, reach past the ToRs: `ping <upstream-ip>` then `tracert <upstream-ip>`.',
      'Confirm the return path works too — from something upstream, reach an address in the external IP block. Outbound-only is a very common half-pass here.',
      'Do NOT go looking for a Tier-0, an Edge cluster or BGP on this model — routing is distributed to the hypervisors and none of those exist.',
    ],
    expected:
      'The transit gateway is up on the external VLAN with a /16 private block, the fabric routes and advertises correctly, and north-south works end to end.',
    note: 'Vendor NSX verification material assumes an edge cluster and a Tier-0, so none of it applies here. This case and TP-203 are the Distributed equivalents.',
  },
  {
    id: 'TP-203',
    title: 'VNA cluster is healthy and stateful services work',
    epic: 'E6',
    story: '6.1',
    critical: true,
    when: isDistrib,
    steps: [
      'NSX Manager → **System → Fabric → Nodes → Virtual Network Appliances** (or **Networking → Transit Gateway → VNA**) — confirm at least TWO appliances, each with its own FQDN and static IP on the ESX management subnet. A single-node cluster is not a pass.',
      'Confirm every node reports healthy on that page.',
      'Confirm the VMs are actually spread across hosts rather than stacked on one: `Get-VM | Where-Object Name -match "vna" | Select Name,PowerState,VMHost`',
      'Prove SNAT translates. From a VM behind the transit gateway, hit something upstream that echoes the source address — an internal web server log, or on a connected site `curl ifconfig.me`. The source must appear as an address from the external IP block, NOT the VM\'s private address.',
      'Check the rule itself: NSX Manager → **Networking → Transit Gateway → NAT** — confirm the SNAT rule and, if planned, that **default outbound NAT** is enabled.',
      'Now fail one appliance: power off the active VNA (`Stop-VM -VM <vna-vm> -Confirm:$false`) and re-run the SNAT check. Stateful services must continue.',
      'Power it back on and confirm it rejoins the cluster healthy.',
    ],
    expected:
      'Two or more VNA appliances healthy; NAT/SNAT translates to the external IP block; losing one appliance does not break stateful services.',
    note: 'A VNA cluster is not a small edge cluster — no Tier-0 or Tier-1 runs on it. It exists to give the transit gateway stateful services.',
  },
  {
    id: 'TP-204',
    title: 'Network segments match the plan',
    epic: 'E6',
    story: '6.1',
    steps: [
      'NSX Manager → **Networking → Segments** — compare each segment\'s name, transport zone, VLAN or overlay type, gateway address and subnet against the network plan.',
      'Confirm no leftover test segments remain.',
      'To diff a long list against the plan rather than reading the UI, pull them from the API: `curl -k -u admin:<pw> https://<nsx-manager>/policy/api/v1/infra/segments | ConvertFrom-Json | Select -Expand results | Select display_name,type,vlan_ids,@{n="gw";e={$_.subnets.gateway_address}}`',
    ],
    expected: 'Every segment matches the plan, and there are no unplanned leftovers.',
  },
  {
    id: 'TP-205',
    title: 'A VM on a segment reaches its gateway and the outside world',
    epic: 'E6',
    story: '6.1',
    steps: [
      'Attach a test VM to each segment and give it an address from that segment: `Get-VM TestVM-A | Get-NetworkAdapter | Set-NetworkAdapter -NetworkName "<segment>" -Confirm:$false`',
      'From the VM, confirm the gateway answers: `ping <segment-gateway>`',
      'Confirm the default route is the one you expect: `route print` (Windows) or `ip route` (Linux).',
      'Reach outbound past the ToRs: `ping <upstream-ip>` then `tracert <upstream-ip>` — an internet address, or an address beyond the rack on an isolated site.',
      'From a machine EXTERNAL to the segment, reach the test VM inbound. Outbound-only is a half-pass and is the more common failure.',
    ],
    expected: 'Gateway, outbound and inbound all succeed on every configured segment.',
  },
  {
    id: 'TP-206',
    title: 'Uplinks are clean and the expected VLANs egress the ToRs',
    epic: 'E6',
    story: '6.1',
    steps: [
      'On the ToRs, check the uplinks for errors, drops and CRCs. Cisco NX-OS: `show interface counters errors` and `show interface <intf>` (look at input/output errors and CRC). Arista EOS: `show interfaces counters errors`.',
      'Clear the counters, wait a few minutes under load, and re-check — a non-zero count from months ago is not the same as errors happening now: `clear counters`',
      'Confirm the uplinks are up at the expected speed and are not flapping: `show interface status` and `show logging | include LINK`',
      'Confirm the VLANs that should egress the ToRs do, and those that should not, do not: `show interface trunk` on the uplinks.',
    ],
    expected: 'No interface errors on the uplinks, and VLAN egress matches the design in both directions.',
  },
  {
    id: 'TP-207',
    title: 'East-west throughput between VMs on the same host',
    epic: 'E6',
    story: '6.1',
    steps: [
      'Put both test VMs on the SAME host: `Move-VM -VM TestVM-B -Destination (Get-VM TestVM-A).VMHost`',
      'Install iperf3 on both (any recent Linux or Windows build is fine — the point is a consistent tool at both ends).',
      'On the receiver: `iperf3 -s`',
      'On the sender, with the receiver\'s REAL address — 4 streams over 30 seconds: `iperf3 -c <receiver-ip> -P 4 -t 30`',
      'Repeat in reverse to catch a one-way problem: `iperf3 -c <receiver-ip> -P 4 -t 30 -R`',
      'Now repeat the whole thing with both VMs on an OVERLAY-backed segment instead of the VDS port group.',
      'Record the measured numbers (VDS and overlay, both directions) in the actual-result box. A number, not a tick.',
    ],
    expected:
      'Same-host throughput reaches the level agreed for this platform on both VDS and overlay networking, with no packet loss.',
    note: 'Set the target with the customer before testing. A same-host figure is bounded by CPU and vNIC, not the physical fabric, so it should comfortably exceed the cross-host figure.',
  },
  {
    id: 'TP-208',
    title: 'East-west throughput between VMs on different hosts',
    epic: 'E6',
    story: '6.1',
    steps: [
      'Split the pair across hosts: `Move-VM -VM TestVM-B -Destination <other-host>`',
      'Repeat the VDS-backed test: `iperf3 -s` on the receiver, `iperf3 -c <receiver-ip> -P 4 -t 30` on the sender, then `-R` for the reverse direction.',
      'Repeat on an OVERLAY-backed segment. This is the path that actually exercises the host overlay (TEP-to-TEP) and its MTU.',
      'If the overlay figure is far below the VDS figure, suspect the overlay MTU rather than the fabric — go back and re-run the TP-001 check against the TEP VMkernel: `vmkping -I vmk10 -d -s 8972 <peer-tep-ip>` (`esxcli network ip interface ipv4 get` to find the TEP vmk).',
      'Record all four measured numbers in the actual-result box.',
    ],
    expected: 'Cross-host throughput reaches the agreed level on both VDS and overlay, with no packet loss and no fragmentation.',
    note: 'A large gap between the VDS and overlay figures usually means the host overlay MTU is not what TP-001 thought it was.',
  },
  {
    id: 'TP-209',
    title: 'VMs deploy and anti-affinity rules apply',
    epic: 'E6',
    story: '6.1',
    steps: [
      'Deploy two test VMs. From an OVF: **vSphere Client → right-click the cluster → Deploy OVF Template** → name them `TestVM-A` and `TestVM-B`, storage `<datastore>`, network `<mgmt-portgroup>`.',
      'Or from a template with PowerCLI: `1..2 | ForEach-Object { New-VM -Name "TestVM-$([char](64+$_))" -Template <template> -ResourcePool <cluster> -Datastore <datastore> }`',
      'Power both on and confirm they boot and take an address: `Get-VM TestVM-A,TestVM-B | Select Name,PowerState,VMHost,@{n="IP";e={$_.Guest.IPAddress -join ","}}`',
      'Create the anti-affinity rule: `New-DrsRule -Cluster <cluster> -Name "TestVMs-AntiAffinity" -KeepTogether $false -VM (Get-VM TestVM-A,TestVM-B)`',
      'Confirm it exists and is enabled: `Get-DrsRule -Cluster <cluster> | Select Name,Enabled,KeepTogether` — or **Cluster → Configure → VM/Host Rules**.',
      'Confirm DRS actually separated them: `Get-VM TestVM-A,TestVM-B | Select Name,VMHost` — two different hosts.',
    ],
    expected: 'Both VMs deploy successfully and the anti-affinity rule is created and applied.',
    note: 'These two VMs are reused by TP-207, TP-208, TP-210 and TP-211. Build them once, early.',
  },
  {
    id: 'TP-210',
    title: 'vMotion works between every pair of hosts',
    epic: 'E6',
    story: '6.1',
    steps: [
      'Start a continuous ping to the test VM from elsewhere so you can see any drop during migration: `ping -t <testvm-ip>` (Windows) or `ping <testvm-ip>` (Linux).',
      'Migrate it, compute resource only: `Move-VM -VM TestVM-A -Destination <target-host>` — or vSphere Client → right-click the VM → **Migrate** → **Change compute resource only**.',
      'Confirm the VM stayed up: the ping should lose at most one packet.',
      'Now walk it round every host so each one both sends and receives — a single migration proves one path, not the cluster: `Get-Cluster <name> | Get-VMHost | ForEach-Object { Move-VM -VM TestVM-A -Destination $_ -Confirm:$false; "moved to $($_.Name)" }`',
      'Confirm the anti-affinity rule blocks a co-locating move: try `Move-VM -VM TestVM-B -Destination (Get-VM TestVM-A).VMHost` and confirm DRS refuses it or flags the violation.',
    ],
    expected:
      'Every host both sends and receives a live migration with no interruption, and the anti-affinity rule blocks a co-locating move.',
  },
  {
    id: 'TP-211',
    title: 'vSphere HA restarts workloads after a host failure',
    epic: 'E6',
    story: '6.1',
    critical: true,
    steps: [
      'Confirm HA is on and admission control matches the design: `Get-Cluster <name> | Select Name,HAEnabled,HAAdmissionControlEnabled,HAFailoverLevel,DrsEnabled,DrsAutomationLevel`',
      'Note which host currently runs the test VM: `Get-VM TestVM-A | Select Name,VMHost`',
      'Start a continuous ping to the VM so you can time the outage: `ping -t <testvm-ip>`',
      'HARD-power that host off from its out-of-band console (iDRAC / iLO / BMC) — power off, NOT a graceful shutdown, which does not exercise HA at all.',
      'Watch the VM restart elsewhere: `while ($true) { Get-VM TestVM-A | Select Name,VMHost,PowerState; Start-Sleep 15 }`',
      'Record the outage duration from the ping output — that is your measured recovery time, and it goes in the actual-result box.',
      'Power the host back on and confirm it rejoins cleanly with no lingering alarms: `Get-VMHost <host> | Select Name,ConnectionState,PowerState`',
      'For vSAN, confirm resync finished before moving on: vSphere Client → **Cluster → Monitor → vSAN → Resyncing Objects** should be empty.',
      'Repeat for any additional cluster in scope.',
    ],
    expected: 'The VM restarts on a surviving host within the agreed recovery time, and the failed host rejoins cleanly.',
  },
  {
    id: 'TP-212',
    title: 'SDDC Manager backup completes to the SFTP target',
    epic: 'E6',
    story: '6.4',
    critical: true,
    steps: [
      'Check what the platform actually stored — target, username, schedule, retention — with `tools/Get-VCFBackupConfig.ps1` from this repo. That reads the Fleet LCM API, so it shows the real configuration rather than what the wizard appeared to accept.',
      'Or in the UI: **VCF Operations → Fleet Management → Lifecycle → Backup Configuration**.',
      'Confirm the SFTP target answers from the management network: `Test-NetConnection <sftp-host> -Port 22`',
      'Trigger a backup and watch it to completion (UI: **Backup Configuration → Backup Now**, then follow the task).',
      'Now go and look on the TARGET — a task that reports success and an archive that exists are different claims: `sftp <user>@<sftp-host>` then `ls -l <backup-path>`. Confirm a new archive with a plausible size and a current timestamp.',
      'Confirm schedule and retention match what was agreed.',
      'Confirm the backup encryption passphrase is in the secret store. Without it the archive is unusable, and nothing will tell you that until a restore.',
    ],
    expected: 'A backup completes, the archive is present on the SFTP target, the schedule is set, and the passphrase is stored.',
  },
  {
    id: 'TP-213',
    title: 'Every vCenter file-based backup is scheduled and completes',
    epic: 'E6',
    story: '6.4',
    critical: true,
    steps: [
      'List every vCenter in the fleet so none is missed: `Get-VIServer` / the inventory in **VCF Operations → Fleet Management → Lifecycle**.',
      'For EACH one, open its own VAMI at `https://<vcenter-fqdn>:5480` and log in as root. This is per-vCenter and manual — VCF does not configure it for you.',
      'Go to **Backup** in the left nav and confirm a schedule exists: target URL (e.g. `sftp://<host>/<path>`), credentials, day/time, retention, and which parts are included.',
      'If it is missing, create it: **Backup → Configure** → enter the target, credentials, schedule, retention, and an encryption password.',
      'Run one now: **Backup → Backup Now** → confirm it completes and note the archive name.',
      'Verify on the target that each vCenter wrote its own folder: `sftp <user>@<sftp-host>` then `ls -l <backup-path>` — expect one subfolder per vCenter.',
      'Record every encryption password in the secret store, per vCenter.',
    ],
    expected: 'Every vCenter has a working, scheduled file-based backup with its archive verified on the target.',
    note: 'This is the single most commonly missed post-deployment task: SDDC Manager backup is configured centrally and looks like it covers everything, but each vCenter must be set up individually in its own VAMI.',
  },
  {
    id: 'TP-214',
    title: 'Backups are restorable, not merely present',
    epic: 'E6',
    story: '6.4',
    steps: [
      'Pull one archive down to a separate machine: `sftp <user>@<sftp-host>` then `get -r <backup-path>/<latest-folder>`',
      'Confirm it is complete and not truncated — compare the byte count against what the source reported, and confirm every expected file is present.',
      'Confirm the passphrase from the secret store actually opens it. This is the step that catches a passphrase recorded with a typo, which is otherwise invisible until the day it matters.',
      'Confirm the restore procedure is written down: where the archive lives, where the passphrase lives, who can reach the target, and the restore steps per component.',
    ],
    expected: 'An archive can be retrieved and opened with the stored passphrase, and the restore procedure is written down.',
    note: 'An unverified backup is a hypothesis. This is the cheapest possible version of testing it — do at least this much.',
  },
  {
    id: 'TP-215',
    title: 'Fleet lifecycle depot is connected and pending updates are understood',
    epic: 'E6',
    story: '6.4',
    steps: [
      '**VCF Operations → Fleet Management → Lifecycle → Settings → Depot** — confirm the fleet-wide depot is connected. This is separate from the depot SDDC Manager already got at bring-up, not a re-do of it.',
      'Confirm the proxy if the site needs one: `.\\tools\\Get-VCFProxyConfig.ps1` from this repo reads what is actually stored on the services runtime, rather than what the wizard appeared to accept.',
      '**Fleet Management → Lifecycle → Binary Management** — confirm bundles for the current BOM are present and downloaded.',
      'Review available updates: **Lifecycle → <SDDC Manager> → Updates**. Record the decision for each — applied now, scheduled, or deferred with a reason. An unreviewed update list is not a pass.',
    ],
    expected: 'The fleet lifecycle depot is connected and every available update has a recorded decision.',
  },
  {
    id: 'TP-216',
    title: 'Storage firmware and driver health is clean',
    epic: 'E6',
    story: '6.4',
    critical: false,
    when: isVsan,
    steps: [
      'vSphere Client → **Cluster → Monitor → vSAN → Skyline Health** → the **Hardware compatibility** section — check the controller firmware and driver items specifically, not just the overall status.',
      'Confirm the hosts are set up to receive firmware and driver updates through the intended channel: **Cluster → Updates → Image** (or the HCL database refresh setting if the site is offline).',
      'Confirm the installed driver/firmware from the host side: `esxcli storage core adapter list` then `vmkload_mod -s <driver> | grep -i version`',
      'Resolve or document every warning — an accepted firmware mismatch needs a written reason, not a silent pass.',
    ],
    expected: 'No firmware or driver health failures, and the update channel is configured.',
  },
  {
    id: 'TP-217',
    title: 'Early identity binding behaves as designed',
    epic: 'E6',
    story: '6.3',
    steps: [
      'If vCenter SSO was bound directly to AD/LDAP for early access: **vCenter → Administration → Single Sign On → Configuration → Identity Provider** — confirm the source is configured and its connection test passes.',
      'Log in as a directory user and confirm the role that lands: **Administration → Access Control → Global Permissions** should show the expected group-to-role mapping.',
      'Confirm the admin, operator and viewer group mappings match the design — test one user per role, do not read the configuration.',
      'Confirm privileges on the non-vSphere components: NSX Manager → **System → Users and Roles**, and VCF Operations → **Administration → Access → Access Control**.',
    ],
    expected: 'Directory logins land on the intended roles across vCenter, NSX and VCF Operations.',
    note: 'Fleet-wide SSO via the Identity Broker (TP-430) is the recommended path and is done Day-2. Mark this NA if identity was deliberately deferred.',
  },
];

// --- TP-3 — Stretch (E7) --------------------------------------------------
// No vendor verification material covers vSAN stretched clusters at all. All of
// TP-3 is original.

const TP3: Entry[] = [
  {
    id: 'TP-301',
    title: 'Inter-AZ link meets latency, bandwidth and MTU requirements',
    epic: 'E7',
    story: '7.1',
    critical: true,
    steps: [
      'Measure latency over a sustained run, not a single ping. From an AZ1 host to an AZ2 host, 500 packets at 200 ms: `ping -c 500 -i 0.2 <az2-host-vmk-ip>` — read the min/avg/max/mdev summary line at the end.',
      'The average must be under 5 ms AND the maximum must stay under it too. A link averaging 3 ms that spikes to 12 ms under load causes vSAN problems that are very hard to attribute later, so run this while the link has some traffic on it.',
      'Measure bandwidth with iperf3 between a VM in each AZ, multi-stream: `iperf3 -s` in AZ2, then `iperf3 -c <az2-vm-ip> -P 8 -t 60` from AZ1, then `-R` for the reverse.',
      'Confirm at least 10 Gbps in both directions.',
      'Prove MTU 9000 end to end between the AZs: `vmkping -I vmk1 -d -s 8972 <az2-host-vmk-ip>` — do this for the vSAN and host-overlay VMkernels, not just management.',
      'Confirm the inter-AZ L3 gateway is itself redundant (HSRP/VRRP or an MLAG pair), so one gateway failure does not partition the cluster. On the ToRs: `show standby brief` (HSRP) or `show vrrp`.',
      'Record the measured latency, bandwidth and MTU results in the actual-result box — these numbers are the evidence.',
    ],
    expected:
      'Round-trip latency stays under 5 ms, bandwidth is at least 10 Gbps, MTU 9000 passes unfragmented end to end, and the inter-AZ L3 gateway is HA.',
    note: 'Measure over time. A link that averages 3 ms but spikes to 12 ms under load will cause vSAN problems that are extremely hard to attribute later.',
  },
  {
    id: 'TP-302',
    title: 'Second-AZ hosts are imaged, networked and commissioned',
    epic: 'E7',
    story: '7.2',
    steps: [
      'Confirm the AZ2 hosts run the SAME build as AZ1: `Get-VMHost | Select Name,Version,Build | Sort Name` — one build across both AZs.',
      'On each AZ2 host, confirm the per-AZ management network: `esxcli network ip interface ipv4 get` and `esxcli network ip route ipv4 list` — AZ2 has its own subnet and gateway.',
      'Confirm DNS and NTP: `esxcli network ip dns server list`, `esxcli system ntp get`, `esxcli system ntp stats get`',
      'Confirm forward and reverse DNS for every AZ2 host from the management network.',
      '**SDDC Manager → Inventory → Hosts** — confirm the AZ2 hosts are commissioned and show as **Unassigned** / available for the stretch.',
      '**SDDC Manager → Administration → Network Settings** — confirm the AZ2 network pool exists with the per-AZ vMotion and vSAN ranges the stretch needs.',
    ],
    expected: 'AZ2 hosts run the matched build, are reachable on their per-AZ networks, and are commissioned and available with a network pool ready.',
  },
  {
    id: 'TP-303',
    title: 'Witness is deployed at the third site and serves only this cluster',
    epic: 'E7',
    story: '7.3',
    critical: true,
    steps: [
      'Confirm the witness appliance is at the THIRD site, not quietly running inside either AZ: `Get-VMHost <witness> | Select Name,ConnectionState,@{n="Parent";e={$_.Parent}}` — and confirm its physical location with the customer, since nothing in vCenter will tell you it is in the wrong rack.',
      'From an AZ1 host: `vmkping -I vmk1 <witness-ip>`. From an AZ2 host: the same. Both must work.',
      'From the witness back to each AZ: `vmkping -I vmk1 <az1-host-ip>` and `vmkping -I vmk1 <az2-host-ip>` — return path included.',
      'Measure latency to the witness from each AZ: `ping -c 100 <witness-ip>` — witness latency is allowed to be much higher than inter-AZ, but confirm it is within the supported bound for your topology.',
      'Confirm this witness serves only this cluster: vSphere Client → the witness host → **Configure → vSAN → Cluster** — it should reference exactly one. A vSAN witness serves one stretched cluster; the shared-witness feature is 2-node clusters only.',
    ],
    expected: 'The witness is at the third site, reachable from both AZs within the supported latency, and dedicated to this cluster.',
    note: 'The shared-witness feature applies to 2-node clusters only, not stretched clusters. Every stretched cluster needs its own.',
  },
  {
    id: 'TP-304',
    title: 'Cluster is stretched with correct fault domains and storage policy',
    epic: 'E7',
    story: '7.4',
    critical: true,
    steps: [
      '**SDDC Manager → Inventory → Workload Domains** → the domain → **Clusters** → confirm the cluster shows as stretched.',
      'Confirm the fault domains: vSphere Client → **Cluster → Configure → vSAN → Fault Domains** — AZ1 **Preferred**, AZ2 **Secondary**, witness assigned.',
      'From the CLI: `esxcli vsan cluster get` and `esxcli vsan faultdomain get`',
      'On the same Fault Domains page, confirm hosts are balanced evenly across the AZs.',
      'Confirm the storage policy is site mirroring: vSphere Client → **Policies and Profiles → VM Storage Policies**, or `Get-SpbmStoragePolicy | Select Name,AnyOfRuleSets`',
      'Confirm objects are COMPLIANT, not merely that the policy exists: **Cluster → Monitor → vSAN → Virtual Objects**, or `Get-VM | Get-SpbmEntityConfiguration | Select Entity,StoragePolicy,ComplianceStatus`',
      'Confirm capacity reflects the roughly doubled footprint site mirroring implies: **Cluster → Monitor → vSAN → Capacity**.',
      'If this cluster hosts an NSX Edge cluster, confirm `isEdgeClusterConfiguredForMultiAZ` was **true** in the stretch spec you submitted. If it was wrong the edge-specific AZ configuration was silently skipped, and nothing in the UI will flag it.',
    ],
    expected:
      'The cluster reports stretched with correct fault domains, balanced hosts, a compliant site-mirroring policy, and correct edge handling if applicable.',
  },
  {
    id: 'TP-305',
    title: 'Isolating one availability zone keeps workloads running',
    epic: 'E7',
    story: '7.4',
    critical: true,
    steps: [
      'Agree the window with the customer first — this is disruptive, and it is the only test that actually proves the stretch.',
      'Place test workloads in both AZs and note where each sits: `Get-VM TestVM-A,TestVM-B | Select Name,VMHost`',
      'Start continuous pings to both from a third location so you can time the outage: `ping -t <testvm-ip>`',
      'Isolate the secondary AZ. Cleanest is at the network layer (shut the inter-site links on the ToRs: `interface <port-channel>` then `shutdown`), which is closer to a real failure than powering hosts off.',
      'Confirm workloads on the surviving AZ keep running, and workloads from the isolated AZ restart there: `while ($true) { Get-VM TestVM-A,TestVM-B | Select Name,VMHost,PowerState; Start-Sleep 15 }`',
      'Confirm the datastore stayed accessible and the witness held quorum: **Cluster → Monitor → vSAN → Skyline Health**, and `esxcli vsan cluster get` on a surviving host.',
      'Restore the link (`no shutdown`) and confirm the AZ rejoins.',
      'Watch resync to completion before declaring the test done: **Cluster → Monitor → vSAN → Resyncing Objects** must reach zero, and objects return to **Compliant**.',
      'Record the measured recovery time and resync duration in the actual-result box.',
    ],
    expected:
      'The surviving AZ keeps its workloads and restarts the failed ones; the datastore stays available throughout; after restore, resync completes and all objects return to compliant.',
    note: 'If the customer will not accept a disruptive test, mark this F2 rather than P and record explicitly that the stretch is unproven. Do not tick a pass on a test that was not run.',
  },
];

// --- TP-4 — Day-2 fleet (E8) ----------------------------------------------

const day2 = (sel: Selection) => sel.day2;
const automation = (sel: Selection) => sel.day2 && sel.automation.deploy;

const TP4: Entry[] = [
  {
    id: 'TP-401',
    title: 'Fleet component network placement is built and reachable',
    epic: 'E8',
    story: '8.1',
    when: day2,
    steps: [
      'Confirm the chosen placement exists — shared management, dedicated management, an NSX overlay segment, or an NSX VLAN segment. For an NSX-backed placement: NSX Manager → **Networking → Segments**.',
      'If a non-shared network was built, confirm it is routed and reachable from the management network: `Test-NetConnection <an-ip-on-that-network> -Port 443`, and `tracert` to confirm the path is what you expect.',
      'Confirm every Day-2 appliance FQDN resolves forward AND reverse onto that network: `@("<vcfa-fqdn>","<log-vip-fqdn>","<vcfon-fqdn>") | ForEach-Object { $a=(Resolve-DnsName $_ -Type A -ErrorAction SilentlyContinue).IPAddress; $p=if($a){(Resolve-DnsName $a -Type PTR -ErrorAction SilentlyContinue).NameHost}; "{0,-40} {1,-16} {2}" -f $_,$a,$p }`',
    ],
    expected: 'The chosen placement is built and routed, and all Day-2 FQDNs resolve both ways onto it.',
    note: 'An overlay-segment placement needs an edge cluster and a Tier-0. Under Distributed connectivity there is none, so either build one for the fleet segment or pick a VLAN-backed placement.',
  },
  {
    id: 'TP-402',
    title: 'Automation appliances: identity, time and cluster state',
    epic: 'E8',
    story: '8.2',
    when: automation,
    steps: [
      'SSH to each appliance with the expected credential: `ssh root@<vcfa-appliance>`',
      'Confirm time zone and NTP: `vracli ntp status` — check the configured server and that it is synced, not just set.',
      'Confirm the hostname is the correct FQDN: `vracli status` and read `hostname` under the `host Nodes` section.',
      'Confirm that name resolves both ways from a client: `Resolve-DnsName <vcfa-fqdn>` then `Resolve-DnsName <its-ip>`',
      'Confirm the cluster is ready: `vracli status` and look for a `status` entry of type `Ready` with `"status": "True"`.',
    ],
    expected: 'Every appliance authenticates, is time-synced, carries the correct FQDN resolving both ways, and the cluster reports ready.',
  },
  {
    id: 'TP-403',
    title: 'Automation is reachable on its cluster VIP',
    epic: 'E8',
    story: '8.2',
    critical: true,
    when: automation,
    steps: [
      'Open the provider portal through the VIP: `https://<vcfa-fqdn>/provider` — log in as a system administrator. The built-in load balancer is configured automatically for both the single-node and the HA model; no external load balancer is required to reach this.',
      'Confirm the VIP is what you connected to, not one node: `Resolve-DnsName <vcfa-fqdn>` should return the cluster VIP.',
      'On an HA cluster, prove the VIP survives a node loss: `Stop-VM -VM <one-vcfa-node> -Confirm:$false`, then reload the portal. It must keep serving.',
      'Power the node back on and confirm it rejoins: `vracli status` shows all three nodes ready again.',
      'Confirm the services-runtime cluster CIDR is set and overlaps nothing — cross-check against the subnet list from TP-002.',
    ],
    expected: 'The portal is reachable and serving through the cluster VIP, survives the loss of one node on HA, and the services-runtime CIDR is unique.',
  },
  {
    id: 'TP-404',
    title: 'Provider plane matches the design',
    epic: 'E8',
    story: '8.2',
    when: automation,
    steps: [
      'Provider portal → **Infrastructure → Networking → Provider Gateways** — confirm the gateway is discovered, its type shows as the expected T0/VRF, and its status is **Normal**.',
      'Click **Associated IP Spaces** on that gateway — confirm each IP space reports **Normal**.',
      'Provider portal → **Infrastructure → Regions** — confirm each region reports **Normal** and shows the expected supervisor and NSX Manager.',
      'Provider portal → **Infrastructure → Networking → Edge Clusters** — confirm health is **Healthy** where applicable.',
      '**Administration → Connections → Virtual Centers** — confirm each vCenter is **Enabled**, **Connected**, and **Licensed** (not just connected — an unlicensed vCenter connects fine and fails later).',
      '**Administration → Connections → NSX Managers** — confirm status **Normal**. These are auto-discovered through VCF Operations, so an absent one means the discovery path is broken rather than that you forgot to add it.',
      '**Administration → VCF Instances** — confirm the VCF name, hostname and version are as expected.',
    ],
    expected: 'Provider gateway, IP spaces, regions and connections all report normal, and the vCenter connections report licensed.',
  },
  {
    id: 'TP-405',
    title: 'Content libraries and their items are ready',
    epic: 'E8',
    story: '8.2',
    when: automation,
    steps: [
      'Provider portal → **Infrastructure → Content Libraries** — confirm the expected libraries are present, with the correct local or subscribed type, and status **Ready**.',
      '**Content Library Items** — confirm the expected templates/OVAs are discovered and each shows **Ready**.',
      'On a subscribed library, trigger a sync: the three-dot menu → **Sync Library** — and confirm it completes rather than erroring on the subscription URL or its certificate.',
    ],
    expected: 'Libraries and their items are present and ready, and a subscribed library syncs successfully.',
  },
  {
    id: 'TP-406',
    title: 'Organizations, projects, quotas and membership are configured',
    epic: 'E8',
    story: '8.2',
    when: automation,
    steps: [
      'Provider portal → **Infrastructure → Organizations** — confirm the expected organizations exist with their allocated regions and resources.',
      'Organization portal (`https://<vcfa-fqdn>/org/<org-name>`) → **Manage & Govern → Projects** — confirm projects exist with the intended type, quotas and resource limits.',
      '**Administer → Access Control → Users** and **Groups** — confirm they come from the identity provider rather than being local accounts, and land on the intended roles.',
      '**Administer → Access Control → Roles** — confirm the role set matches the design, including any custom roles and their rights.',
      '**Manage & Govern → Policies → Definitions** — confirm quota, lease and approval policies are configured as designed.',
    ],
    expected: 'Organizations, projects, quotas and role assignments all match the design, sourced from the identity provider.',
  },
  {
    id: 'TP-407',
    title: 'End-to-end provisioning: request, deploy and decommission',
    epic: 'E8',
    story: '8.2',
    critical: true,
    when: automation,
    steps: [
      'Note the current IP pool usage BEFORE you start, so you can prove the cleanup later: **Manage & Govern → Networking → IP Management → IP Address Blocks** — record the allocated count.',
      'As an end user: **Consume → Catalog** → pick an item → **Request** → fill in the deployment name and inputs → **Submit**.',
      'Watch it through: **Consume → Deployments** → the deployment → **History**. Check for warnings, not just the final success.',
      'Confirm the workload is actually usable, not merely created: ping it, confirm it has the right address on the right network, and confirm CPU/RAM/disk match what the blueprint specified.',
      'Perform a day-2 action from **Consume → Deployments → Actions** — a power off and power on is enough.',
      'Now DELETE the deployment: **Actions → Delete**.',
      'Confirm the cleanup is complete: the VMs are gone from vCenter (`Get-VM <deployment-name>*`), any created networks are gone, and — the one people miss — the IP allocation count is back to where you noted it.',
    ],
    expected:
      'A catalog request deploys a working workload, day-2 actions succeed, and deletion removes every resource it created with no orphans left behind.',
    note: 'Decommission is the half people skip. A blueprint that deploys but leaks IP allocations on delete will exhaust the pool weeks after handover.',
  },
  {
    id: 'TP-408',
    title: 'License Hub is deployed, registered and holding licences',
    epic: 'E8',
    story: '8.2a',
    critical: true,
    when: licenseHubNeeded,
    steps: [
      'Confirm the SSP Installer appliance is up on a real FQDN with forward and reverse DNS: `Resolve-DnsName <ssp-installer-fqdn>` then `Resolve-DnsName <its-ip>`',
      'Open the SSP Installer UI at `https://<ssp-installer-fqdn>` and confirm its vCenter connection succeeded. It needs an administrator credential PLUS the vSphere root CA certificate — there is no thumbprint prompt, so a missing CA cert shows up as a connection failure.',
      'In the SSP Installer, confirm the License Hub instance is deployed and reports **Healthy**.',
      'Confirm all three FQDNs resolve, and that the instance and messaging names map to the FIRST and SECOND addresses of the service pool: `Resolve-DnsName <hub-instance-fqdn>` and `Resolve-DnsName <hub-messaging-fqdn>`',
      'Open the License Hub UI and confirm it shows as registered.',
      'Now go to **Licenses** and READ THE LIST. Registration brings no entitlement on its own — the licence file is downloaded separately from the Avi Cloud Console (`portal.pulse.broadcom.com`, outbound 443) and added by hand. An empty licence list is not a pass, however green the registration looks.',
    ],
    expected: 'The SSP Installer and License Hub instance are healthy, the hub is registered, and the licence list is populated.',
    note: 'Registration brings no entitlement on its own. The licence file is downloaded separately from the vendor cloud console and added by hand.',
  },
  {
    id: 'TP-409',
    title: 'License Hub VMs are excluded from the distributed firewall',
    epic: 'E8',
    story: '8.2a',
    when: licenseHubNeeded,
    steps: [
      'NSX Manager → **Security → Distributed Firewall → Settings → Exclusion List** — confirm the License Hub VMs (or a group containing them) are listed.',
      'Confirm this is an EXCLUSION, not an allow rule in the policy. They behave differently and only the exclusion is correct here.',
      'Confirm the carve-out is documented with the vDefend policy owner, so a later policy review does not quietly remove it and break licensing.',
    ],
    expected: 'The License Hub VMs are on the firewall exclusion list and the carve-out is documented.',
  },
  {
    id: 'TP-410',
    title: 'SSP Installer is backed up',
    epic: 'E8',
    story: '8.2a',
    critical: true,
    when: licenseHubNeeded,
    steps: [
      'SSP Installer UI → **Settings → Backup** (or the appliance\'s backup action) — take a backup and download it.',
      'Store it with the engagement records, alongside the SSP Installer credentials.',
      'Confirm the file is retrievable and non-trivial in size — not a zero-byte artefact of a failed export.',
    ],
    expected: 'An SSP Installer backup exists, is retrievable, and is stored with the engagement records.',
    note: 'That backup is the only migration path if the vCenter FQDN or IP ever changes. Several properties of the deployment — instance name, instance FQDN, storage policy, and both pools — cannot be changed afterwards.',
  },
  {
    id: 'TP-411',
    title: 'Brownfield Avi licence entitlement was migrated before upgrade',
    epic: 'E8',
    story: '8.2a',
    critical: true,
    when: aviInScope,
    steps: [
      'Establish whether the site already ran Avi on a pre-32.1.1 version. Greenfield sites: mark this NA and move on.',
      'If brownfield, confirm the entitlement was migrated on the **Broadcom Support Portal BEFORE the upgrade** — the migration is one-way and cannot be undone afterwards.',
      'Controller UI → **Administration → Licensing** — check the licence format. 25-character keys and YAML licences are deprecated in 32.1.1.',
      'If a deprecated format is present, find the grace-period expiry: it runs **90 days from first boot / upgrade completion** and OVERRIDES the stated validity date. A licence marked valid until 2029 will still stop.',
      'Put that expiry date on the customer calendar with a named owner.',
    ],
    expected: 'Entitlement is on the current format with no grace period running, or the grace period is known, dated and owned.',
    note: 'Deprecated licence formats get a strict 90-day grace period from first boot that OVERRIDES the stated validity date — a licence marked valid until 2029 will still stop. Mark NA on a greenfield site.',
  },
  {
    id: 'TP-412',
    title: 'Load-balancer controller cluster is healthy and initialised',
    epic: 'E8',
    story: '8.3',
    critical: true,
    when: aviInScope,
    steps: [
      'Confirm the controller VMs live in the MANAGEMENT domain, never in a workload domain: `Get-VM | Where-Object Name -match "avi|controller" | Select Name,PowerState,VMHost,@{n="Cluster";e={(Get-VMHost $_.VMHost | Get-Cluster).Name}}`',
      'Log in to the controller UI at `https://<avi-controller-vip>` and confirm the cluster reports healthy on all nodes: **Administration → Controller → Nodes**.',
      'Confirm the first-login wizard was actually completed — it asks for things nothing on the VCF side collects: the passphrase, the controller\'s own DNS resolvers and search domain, the SMTP choice (defaults to None), and the multi-tenancy model.',
      'Check DNS and NTP landed: **Administration → Settings → DNS/NTP**.',
      'Confirm the multi-tenancy model matches the design: **Administration → Settings → Tenant Settings** — service engines provider-shared vs per-tenant. This is awkward to change after the fact, so verify it now rather than discovering it later.',
      'Confirm the PASSPHRASE is in the secret store. It protects the controller configuration backups and is restore-critical — losing it means losing the ability to restore the controller.',
      'Confirm the controller version meets the VCF 9.1 requirement (Avi 32.1.1+) and that its binaries came from the depot: **Administration → Controller → Software**.',
    ],
    expected:
      'The controller cluster is healthy in the management domain, its first-login wizard is complete, and the passphrase is in the secret store.',
    note: 'The multi-tenancy model — service engines shared by the provider versus per-tenant — is an architecture decision that is awkward to change after first login. Settle it beforehand.',
  },
  {
    id: 'TP-413',
    title: 'Controller is onboarded to License Hub with a non-zero licence count',
    epic: 'E8',
    story: '8.3a',
    critical: true,
    when: aviInScope,
    steps: [
      'License Hub → **Endpoint Management → Onboard an Endpoint** — supply the type, endpoint name, connection type, the controller cluster IP/VIP/FQDN, and that endpoint\'s admin credential AND its certificate. The hub logs in to the controller, so both are needed.',
      'License Hub → **Licenses** → assign licences to that endpoint.',
      'On the controller: **Administration → Licensing** → switch to **On-prem License Hub**. The controller does NOT discover the hub by itself, so this step is easy to skip and leaves everything looking connected.',
      'Now open **LICENSE USAGE** on the controller and read the actual numbers.',
      'Do not accept a green connectivity indicator as the result. A **Connected** status with a fresh refresh timestamp still reads **0 Used / 0 Available** when no licence file was ever loaded. The usage count is the test.',
    ],
    expected:
      'The controller is listed as an endpoint with licences assigned, is switched to the on-premises hub, and licence usage shows a NON-ZERO used and available count.',
    note: 'This is a documented false-pass: a connected status with a fresh refresh timestamp still reads zero used and zero available if no licence file was ever loaded. Verify the usage numbers, not the connectivity indicator.',
  },
  {
    id: 'TP-414',
    title: 'Load balancer fronts Automation and its published name resolves to the VIP',
    epic: 'E8',
    story: '8.3',
    when: (sel) => sel.day2 && sel.automation.deploy && sel.automation.aviLb,
    steps: [
      'Controller UI → **Applications → Virtual Services** → confirm the VS exists and is green, and that its pool members point at the CLUSTER VIP of Automation\'s built-in load balancer. The built-in VIP stays the ingress; the external LB sits in front of it.',
      'Controller UI → **Applications → Pools** → confirm the pool health is green and the members are up.',
      'Confirm the published FQDN resolves to the virtual service address, not to an Automation node: `Resolve-DnsName <published-fqdn>`',
      'Confirm SSL terminates on the VS with the intended certificate: `openssl s_client -connect <published-fqdn>:443 -servername <published-fqdn> < NUL 2>NUL | openssl x509 -noout -issuer -subject -dates`',
      'Open `https://<published-fqdn>` in a browser, confirm no trust warning, and log in.',
      'Confirm tenant traffic no longer traverses the management network: `tracert <published-fqdn>` from a user-side client, and confirm the path goes to the VS address rather than to a management-network address.',
    ],
    expected:
      'The published FQDN resolves to the virtual service, SSL terminates cleanly, the portal is usable through it, and tenant traffic stays off the management network.',
    note: 'The built-in load balancer is L4-only. Putting a load balancer in front is what adds SSL termination and traffic separation — it is an optional addition, never a requirement.',
  },
  {
    id: 'TP-415',
    title: 'Log Management appliances are deployed, networked and resolvable',
    epic: 'E8',
    story: '8.4',
    when: (sel) => sel.day2 && sel.day2Components.logs,
    steps: [
      'Confirm every appliance is powered on and on the right network: `Get-VM | Where-Object Name -match "<log-appliance-prefix>" | Select Name,PowerState,@{n="Network";e={($_ | Get-NetworkAdapter).NetworkName}},@{n="HW";e={$_.HardwareVersion}}`',
      'Confirm forward and reverse DNS for the cluster VIP AND for every individual node — both matter, because clients hit the VIP but the nodes talk to each other by name: `@("<vip-fqdn>","<node1-fqdn>","<node2-fqdn>","<node3-fqdn>") | ForEach-Object { $a=(Resolve-DnsName $_ -Type A -ErrorAction SilentlyContinue).IPAddress; $p=if($a){(Resolve-DnsName $a -Type PTR -ErrorAction SilentlyContinue).NameHost}; "{0,-40} {1,-16} {2}" -f $_,$a,$p }`',
      'Confirm the virtual hardware version suits the appliance size — a large appliance needs a version that supports its vCPU count.',
      'Open `https://<log-vip-fqdn>` and confirm the integrated load balancer is serving it. Unlike VCF Operations, this product genuinely has a cluster VIP.',
    ],
    expected: 'All nodes are up on the correct network, the VIP and every node resolve both ways, and the VIP serves the interface.',
    note: 'This product has an integrated load balancer and a genuine cluster VIP. VCF Operations does not — do not confuse the two.',
  },
  {
    id: 'TP-416',
    title: 'Log Management access control and integrations are correct',
    epic: 'E8',
    story: '8.4',
    when: (sel) => sel.day2 && sel.day2Components.logs,
    steps: [
      '**Administration → Authentication → Active Directory** — confirm the configuration and click **Test Connection**, if directory integration is in scope.',
      '**Administration → Access Control → Users** and **Groups** — confirm the expected accounts and groups exist.',
      'Check membership of EVERY role group, not just the admin one: Super Admin, View Only Admin, Dashboard User, and User. An over-broad membership here is the finding.',
      '**Administration → Time** — confirm the NTP servers match the customer\'s.',
      '**Administration → SMTP** — confirm server, port, SSL/STARTTLS and sender, then send a test message.',
      '**Administration → Archiving** — confirm archiving is enabled and the NFS archive location is set and writable.',
      '**Administration → SSL** — confirm the certificate is the intended one, not the self-signed default (unless a self-signed cert was the agreed outcome).',
      '**Administration → Event Forwarding** — confirm each destination\'s protocol, port, SSL, filter, tag, disk cache and worker count match the design.',
    ],
    expected: 'Directory integration, group membership, NTP, SMTP, archiving, SSL and event forwarding all match the design.',
  },
  {
    id: 'TP-417',
    title: 'Every source is actually shipping logs',
    epic: 'E8',
    story: '8.4',
    critical: true,
    when: (sel) => sel.day2 && sel.day2Components.logs,
    steps: [
      '**Administration → vSphere Integration** — confirm each vCenter is configured against the cluster VIP.',
      'Confirm EVERY ESX host points at the VIP, not a sample: `Get-VMHost | Select Name,@{n="Syslog";e={($_ | Get-AdvancedSetting -Name Syslog.global.logHost).Value}} | Sort Name`',
      'Any host with a blank or wrong `Syslog.global.logHost` is a silent gap — it will be invisible until the day you need that host\'s logs.',
      'Now prove delivery, which is a different claim from configuration. In the UI go to **Explore Logs**, filter by `hostname` for a specific ESX host, and confirm events from the last few minutes.',
      'Repeat the check for a vCenter source.',
      'Generate a real event to test end to end: restart syslog on a host (`esxcli system syslog reload`) or log a test message, then find it in **Explore Logs**.',
      'Create a test alert query under **Explore Logs → Alerts**, trigger it, and confirm the email or integration notification actually arrives.',
    ],
    expected:
      'Every vCenter and every ESX host is shipping logs to the VIP with recent events visible, and a triggered test alert is delivered.',
    note: 'Configuration and delivery are different things. Check for arriving events per source, because one silently missing host is invisible until the day you need its logs.',
  },
  {
    id: 'TP-418',
    title: 'Operations for Networks is paired, collecting and healthy',
    epic: 'E8',
    story: '8.4',
    when: (sel) => sel.day2 && sel.day2Components.networks,
    steps: [
      'Confirm the platform and collector VMs are up on the right network: `Get-VM | Where-Object Name -match "<vcfon-prefix>" | Select Name,PowerState,@{n="Network";e={($_ | Get-NetworkAdapter).NetworkName}}`',
      'Confirm forward and reverse DNS for every appliance address.',
      '**Settings → Install and Support** — confirm every collector (proxy) VM is listed under **Collector VMs** and paired with the platform, with no warnings.',
      'Same page — confirm the **Overview** health indicator is green, and that platform VMs are listed without warnings if running clustered.',
      '**Settings → Data Sources** — confirm every intended source is connected and collecting, with no warning icons. A source added but failing to collect shows here, not on the health page.',
      '**Settings → Licensing** — confirm a real licence is applied. The specific check is that you CANNOT switch to assessment mode; if you can, the instance is running on an evaluation licence.',
      'Confirm NTP, SMTP and the SSL certificate under **Settings** match the design.',
    ],
    expected: 'Platform and collectors are paired and healthy, all data sources collect without warnings, and the instance is licensed rather than in assessment mode.',
  },
  {
    id: 'TP-419',
    title: 'Operations for Networks detects a real change and is usable for analysis',
    epic: 'E8',
    story: '8.4',
    when: (sel) => sel.day2 && sel.day2Components.networks,
    steps: [
      'Make a small, reversible change on a monitored object — a dummy port group is the easiest: `New-VirtualPortGroup -VirtualSwitch <vds> -Name "vcfon-test-pg" -VLanId 999`',
      'Wait for the next collection cycle, then find it: **Search** → query for change events in the last hour, or open **Events** and filter for Configuration Change.',
      'Confirm the configured notification (email or SNMP trap) actually arrived.',
      'Revert the change: `Remove-VirtualPortGroup -VirtualPortGroup "vcfon-test-pg" -Confirm:$false`',
      'Run a representative search in **Search**, e.g. `vms where cpu count > 1`, then pin the result and confirm it appears under **Pinboards**.',
      'Run **Path and Topology** between two workloads and confirm the path renders end to end.',
    ],
    expected: 'A real configuration change is detected and notified, and search, pinboards and path analysis all work.',
  },
  {
    id: 'TP-420',
    title: 'Fleet certificates are CA-signed with no trust warnings',
    epic: 'E8',
    story: '8.5',
    critical: true,
    steps: [
      'Confirm the replacement was run in STAGGERED batches, letting each finish before starting the next. Each rotation triggers automated retrust across dependent components, and the UI makes you acknowledge exactly that.',
      'Check every endpoint from the command line rather than clicking through browsers — issuer, subject, SANs and expiry in one pass: `@("<vcenter>","<nsx-vip>","<sddc-manager>","<vcf-ops>","<vcfa>") | ForEach-Object { $u=$_; try { $t=[Net.Sockets.TcpClient]::new($u,443); $s=[Net.Security.SslStream]::new($t.GetStream(),$false,{$true}); $s.AuthenticateAsClient($u); $c=[Security.Cryptography.X509Certificates.X509Certificate2]$s.RemoteCertificate; "{0,-35} {1,-45} {2}" -f $u,$c.Issuer,$c.NotAfter; $s.Dispose(); $t.Close() } catch { "{0,-35} ** FAILED: $($_.Exception.Message)" -f $u } }`',
      'Confirm the issuer is the intended CA on every line — anything still showing a self-signed or VMCA issuer was missed by the batch.',
      'Check the SANs carried through, especially any load-balancer VIP FQDN: `openssl s_client -connect <fqdn>:443 -servername <fqdn> < NUL 2>NUL | openssl x509 -noout -text | findstr /i "DNS:"`',
      'Confirm no browser trust warning on each endpoint (this is what the customer will see).',
      'Now confirm inter-component trust SURVIVED the rotation, which browsers cannot tell you: **VCF Operations → Fleet Management → Lifecycle** should still show every instance connected, and **Administration → Connections** in VCF Automation should still show vCenter and NSX connected.',
    ],
    expected: 'Every endpoint presents a CA-signed certificate with correct SANs and no trust warning, and all inter-component integrations still report connected.',
    note: 'Where the load balancer is managed through VCF Operations, drive its certificate from there. Swapping it directly in the product UI breaks NSX trust.',
  },
  {
    id: 'TP-421',
    title: 'Certificate auto-renewal is configured',
    epic: 'E8',
    story: '8.5',
    steps: [
      '**VCF Operations → Fleet Management → Fleet Management → Certificates** — confirm the expected certificate authority is configured.',
      'On the same page, confirm auto-renewal is enabled where intended.',
      'Record the EARLIEST expiry date across the fleet — from the sweep in TP-420 — and confirm it is diarised with the customer.',
      'If the list looks empty, wait before calling it a failure: objects can take six hours or more to appear under certificate management after deployment.',
    ],
    expected: 'The CA is configured, auto-renewal is enabled where intended, and the earliest expiry date is known and diarised.',
    note: 'Objects can take several hours to appear under certificate management after deployment. Do not read an empty list as a failure straight away.',
  },
  {
    id: 'TP-422',
    title: 'Fleet SSO through the identity broker works end to end',
    epic: 'E8',
    story: '8.5',
    when: (sel) => sel.day2 && sel.day2Components.identityBroker,
    steps: [
      '**VCF Operations → Fleet Management → Fleet Management → Identity & Access** — confirm every VCF instance (vCenter and NSX) and every VCF management appliance is configured against the intended identity broker. A component missing from this list is not covered by fleet SSO.',
      'Log in as a directory user and confirm single sign-on carries across the fleet components without re-prompting.',
      'Confirm group-to-role mapping: log in as one test user per role (admin, operator, viewer) and confirm each lands on the intended role in each component. Mapping that looks right in configuration and lands wrong in practice is common.',
      'Confirm the break-glass LOCAL account works — log in with it once, right now, while everything is healthy. The moment you need it is the moment you cannot test it.',
      'Confirm the break-glass credential is recorded in the secret store, out of band from the identity provider it exists to work around.',
    ],
    expected:
      'Directory users sign on once and reach every fleet component on the intended role, and a working break-glass local account is recorded.',
    note: 'The identity broker itself is deployed at bring-up with the management services. This is its configuration, not its deployment.',
  },
  {
    id: 'TP-423',
    title: 'Negative test: an unprivileged user cannot administer',
    epic: 'E8',
    story: '8.5',
    critical: true,
    steps: [
      'Log in as a deliberately NON-administrative user. WRITE DOWN which account you used in the actual-result box — this is the step most often got wrong, and a negative test run as admin passes vacuously and proves nothing.',
      'VCF Operations → **Administration → Solutions → Policies** — attempt to create or modify a policy. It must be refused.',
      'VCF Operations → **Administration → Access → Access Control → User Accounts** — attempt to create a user, and then a group. Both must be refused.',
      'Confirm the user cannot see objects outside their intended scope — check the inventory shows only what their role permits.',
      'In vCenter, confirm the same user cannot see the VCF Operations plug-in menu or objects they have no rights to.',
      'Repeat on each component with its own role system: vCenter, NSX, VCF Operations, VCF Automation, and the log and network products if deployed.',
    ],
    expected: 'Every administrative action is refused for the non-administrative user, on every component tested.',
    note: 'Write down which account was used. A negative test executed with an admin account passes vacuously and proves nothing.',
  },
  {
    id: 'TP-424',
    title: 'Licensing is applied across the fleet',
    epic: 'E8',
    story: '8.5',
    steps: [
      '**VCF Operations → Manage → Licensing → Registration** — confirm the environment is registered.',
      '**Manage → Licensing → License Keys** — confirm every key is installed and valid, and that the type, capacity, usage and expiry match the customer\'s entitlement.',
      '**Manage → Licensing → License Groups** — confirm the groups exist and hold the right members and member types.',
      'Confirm each vCenter carries its primary licence and any add-ons: `Get-VIServer | ForEach-Object { $_.Name }` then check each in **vCenter → Administration → Licensing → Assets**.',
      'Confirm NOTHING is still in evaluation. The 90-day window started at bring-up, so check the actual expiry rather than assuming there is time.',
      'Check the other products separately — they license independently: the log platform under **Administration → Licensing**, and the network platform under **Settings → Licensing**.',
    ],
    expected: 'All licences are installed and valid, groups are correct, and nothing is left in evaluation.',
    note: 'The evaluation window starts at bring-up and is 90 days. Confirm the expiry date rather than assuming there is time.',
  },
  {
    id: 'TP-425',
    title: 'Operations alerting and self-health are sound',
    epic: 'E8',
    story: '8.5',
    steps: [
      '**VCF Operations → Alerts** — review what is active. Either there are none, or every one has a written explanation.',
      'Exercise the workflow on one alert: **take ownership** (control state becomes Assigned, assigned user becomes you), **release ownership** (returns to Open), then **cancel** one (status becomes Inactive).',
      'If a ticketing integration is in scope, configure an alert rule with that notification method, trigger a matching alert, and confirm the incident is actually raised in the target system.',
      '**Dashboards → Self Health**, **Self Cluster Statistics**, **Self Performance Details** and **Self Services Communications** — confirm each reports green, and explain anything that does not.',
      'If those dashboards are missing, enable them: **Dashboards → VCF Operations** section.',
      '**Administration → Management → Log Forwarding** — confirm forwarding to the log platform is configured, then confirm events are ARRIVING there, not just that the config exists.',
      '**Administration → Management → Outbound Settings** — confirm the automated actions plug-in shows active if it is in scope.',
    ],
    expected: 'No unexplained active alerts, the alert workflow and any ticketing integration work, self-health is green, and log forwarding is arriving.',
  },
  {
    id: 'TP-426',
    title: 'Operations content is usable by the customer',
    epic: 'E8',
    story: '8.5',
    steps: [
      '**Dashboards → Create Dashboard** — drag a few widgets on, name it, save.',
      'Select it → **Export** — confirm a dashboard file downloads.',
      '**Import** it back and confirm it succeeds.',
      'Select it → **Share** → drag it to a group. Log in as a member of that group and confirm they can SEE it but not edit or delete it.',
      'Back as admin, **Stop Sharing**, then confirm the member has lost access.',
      'Save it as a template and confirm it appears for other users to create from.',
      '**Administration → Solutions → Policies** — confirm the expected policies exist, are active, and are assigned to the right groups. Check the policy library tree structure matches the design.',
      '**Administration → Configuration → Maintenance Schedules** — confirm the schedules match what the customer agreed, and that they have confirmed them.',
      '**Administration → Management → Global Settings → Currency** — confirm it is set correctly for the customer, since it cannot be changed once cost data accumulates.',
    ],
    expected: 'Dashboards create, export, import and share correctly; policies are active and correctly assigned; maintenance schedules match the agreement.',
  },
];

// --- TP-5 — Workload domain (E9), repeated per WLD -------------------------

const TP5: WldEntry[] = [
  {
    id: 'TP-501',
    title: 'Workload domain network prep is complete',
    epic: 'E9',
    story: '9.1',
    steps: [
      'Confirm this domain\'s VLANs are trunked to ITS hosts at the correct MTU — on the ToRs `show interface trunk`, then prove the MTU from a host: `vmkping -I vmk1 -d -s 8972 <peer-vmk-ip>` (across both AZs if this domain is stretched).',
      'Confirm the addresses this domain consumes on the management VM-management subnet are reserved in IPAM — a workload domain takes several.',
      'Confirm forward AND reverse DNS for this domain\'s vCenter, NSX components and hosts: `@("<wld-vcenter>","<wld-nsx-vip>","<wld-esxi-1>") | ForEach-Object { $a=(Resolve-DnsName $_ -Type A -ErrorAction SilentlyContinue).IPAddress; $p=if($a){(Resolve-DnsName $a -Type PTR -ErrorAction SilentlyContinue).NameHost}; "{0,-40} {1,-16} {2}" -f $_,$a,$p }`',
    ],
    expected: 'This domain’s VLANs, subnets, reservations and DNS records are all in place and resolve both ways.',
  },
  {
    id: 'TP-502',
    title: 'Workload domain hosts are imaged and commissioned',
    epic: 'E9',
    story: '9.2',
    steps: [
      'Confirm each host runs the BOM build: `esxcli system version get` per host, or `Get-VMHost | Select Name,Version,Build | Sort Name` once they are in an inventory.',
      'Confirm the model, controller and NICs are on the compatibility guide at their installed firmware/driver level.',
      'Confirm the management network, DNS and NTP on each — per AZ if this domain is stretched: `esxcli network ip interface ipv4 get`, `esxcli network ip dns server list`, `esxcli system ntp stats get`',
      '**SDDC Manager → Inventory → Hosts** — confirm they are commissioned and show as available for this domain.',
    ],
    expected: 'All hosts run the matched build, are correctly networked and time-synced, and are commissioned and available.',
  },
  {
    id: 'TP-503',
    title: 'Workload domain is deployed and healthy',
    epic: 'E9',
    story: '9.3',
    critical: true,
    steps: [
      '**SDDC Manager → Inventory → Workload Domains → View Details** — confirm this domain appears with its CPU, memory and storage allocation.',
      'Open its vCenter and confirm it is reachable and healthy: `Connect-VIServer <wld-vcenter-fqdn>` then `Get-VMHost | Select Name,ConnectionState,PowerState`',
      'Confirm its NSX — shared or dedicated per the design — is healthy: NSX Manager → **System → Appliances**, all nodes stable and the VIP answering.',
      'Confirm the first cluster is online with every host joined: **Workload Domains → the domain → Clusters** → the cluster → **Hosts**.',
      'Run the platform health check and review: `ssh vcf@<sddc-manager>`, then `cd /opt/vmware/sddc-support` and `./sos --health-check --domain-name <wld-name>`',
    ],
    expected: 'The domain, its vCenter, its NSX and its first cluster are all deployed and healthy.',
  },
  {
    id: 'TP-504',
    title: 'Workload domain principal storage is healthy',
    epic: 'E9',
    story: '9.3',
    critical: true,
    steps: [
      'vSAN — **Cluster → Monitor → vSAN → Skyline Health** → **Retest**, then resolve or document every failure. Run **Proactive Tests → VM Creation Test** and **Network Performance Test**.',
      'NFS or FC — confirm the datastore mounts on every host in THIS cluster: `Get-Cluster <wld-cluster> | Get-VMHost | ForEach-Object { $m = $_ | Get-Datastore | Where-Object Name -eq "<datastore>"; "{0,-30} {1}" -f $_.Name, $(if ($m) { "MOUNTED" } else { "** MISSING **" }) }`',
      'FC — confirm full path redundancy: `esxcli storage core path list -d <naa.id> | grep -E "Runtime Name|State"`',
      'Confirm capacity matches the sizing for this domain: `Get-Cluster <wld-cluster> | Get-Datastore | Select Name,CapacityGB,FreeSpaceGB`',
    ],
    expected: 'The principal datastore is healthy and writable across every host in the cluster, with capacity matching sizing.',
  },
  {
    id: 'TP-505',
    title: 'Workload domain north-south via edge cluster and BGP',
    epic: 'E9',
    story: '9.4 / 9.6',
    critical: true,
    when: (w) => w.connectivity === 'centralized',
    steps: [
      'NSX Manager → **System → Fabric → Nodes** — confirm THIS domain\'s hosts are transport nodes and this domain\'s edge cluster is deployed.',
      'NSX Manager → **Networking → Tier-0 Gateways** — confirm this domain\'s T0 is **Up** on the planned uplinks.',
      'SSH to this domain\'s edge node and check both directions: `get bgp neighbor summary` for Established sessions, `get route bgp` for received prefixes, `get bgp neighbor <peer-ip> advertised-routes` for what is being sent.',
      'From a VM on this domain\'s overlay, reach past the ToRs and back: `ping <upstream-ip>` and `tracert <upstream-ip>`.',
    ],
    expected: 'This domain’s edge cluster and Tier-0 are up, BGP is exchanging prefixes both ways, and north-south works end to end.',
    note: 'Connectivity is chosen per workload domain, independently of the management domain. This domain gets its own edge cluster.',
  },
  {
    id: 'TP-506',
    title: 'Workload domain north-south via transit gateway and VNA',
    epic: 'E9',
    story: '9.4 / 9.6',
    critical: true,
    when: (w) => w.connectivity === 'distributed',
    steps: [
      'Confirm THIS domain\'s own external VLAN reaches every host in THIS domain: `Get-Cluster <wld-cluster> | Get-VMHost | Get-VirtualPortGroup | Where-Object VLanId -eq <this-wld-external-vlan> | Select VMHost,Name` — every host must appear. A second Distributed domain does not share the management domain\'s VLAN.',
      'Confirm this domain\'s gateway CIDR is routed by the fabric and its OWN external IP block is advertised upstream — on the ToRs `show ip route <this-wld-external-block>`.',
      'NSX Manager → **Networking → Transit Gateway** → confirm this domain\'s private transit block is a **/16** and overlaps nothing.',
      'Confirm this domain\'s VNA cluster: at least two appliances, each with its own FQDN and IP on the ESX management subnet, all reporting healthy.',
      'Prove NAT/SNAT from a workload in this domain out to an external destination, and confirm the source translates to an address from THIS domain\'s external IP block.',
    ],
    expected:
      'This domain has its own external VLAN, IP block, /16 transit block and healthy 2+ node VNA cluster, with north-south and NAT/SNAT working.',
    note: 'The per-domain point matters: external VLAN, external IP block and VNA cluster are all per-domain inputs, not a share of the management domain’s.',
  },
  {
    id: 'TP-507',
    title: 'Workload domain datapath and availability',
    epic: 'E9',
    story: '9.4 / 9.6',
    steps: [
      'Deploy two test VMs into this domain and apply an anti-affinity rule: `New-DrsRule -Cluster <wld-cluster> -Name "TestVMs-AntiAffinity" -KeepTogether $false -VM (Get-VM TestVM-A,TestVM-B)`',
      'Walk a running VM round every host so each both sends and receives: `Get-Cluster <wld-cluster> | Get-VMHost | ForEach-Object { Move-VM -VM TestVM-A -Destination $_ -Confirm:$false; "moved to $($_.Name)" }` — with a `ping -t` running to confirm no interruption.',
      'HARD-power a host off from its out-of-band console, confirm HA restarts its workload on a survivor, then power it back on and confirm it rejoins: `Get-VMHost <host> | Select Name,ConnectionState`',
      'Measure throughput with iperf3, same host and different hosts, on both VDS-backed and overlay-backed networks: `iperf3 -s` on the receiver, `iperf3 -c <receiver-ip> -P 4 -t 30` then `-R` on the sender.',
      'Record all the measured throughput figures in the actual-result box.',
    ],
    expected:
      'Migrations succeed across every host, HA restarts workloads after a hard failure, and throughput meets the agreed level on both same-host and cross-host paths.',
  },
  {
    id: 'TP-508',
    title: 'Workload domain witness is deployed and dedicated',
    epic: 'E9',
    story: '9.4',
    critical: true,
    when: (w) => w.stretched,
    steps: [
      'Confirm a witness DEDICATED to this domain exists at the third site — separate from the management witness and from any other domain\'s. A vSAN witness serves exactly one stretched cluster.',
      'Confirm it is reachable from both AZs: from an AZ1 host `vmkping -I vmk1 <this-wld-witness-ip>`, and the same from an AZ2 host.',
      'Confirm the return path: from the witness, `vmkping -I vmk1 <az1-host-ip>` and `vmkping -I vmk1 <az2-host-ip>`',
      'Measure latency from each AZ: `ping -c 100 <this-wld-witness-ip>` — confirm it is within the supported bound for your topology.',
      'Confirm this witness is bound to THIS cluster only: vSphere Client → the witness host → **Configure → vSAN → Cluster**.',
    ],
    expected: 'A dedicated witness for this domain is at the third site, reachable from both AZs within the supported latency.',
    note: 'A vSAN witness serves exactly one stretched cluster. Shared-witness applies to 2-node clusters only.',
  },
  {
    id: 'TP-509',
    title: 'Workload domain cluster is stretched and compliant',
    epic: 'E9',
    story: '9.5',
    critical: true,
    when: (w) => w.stretched,
    steps: [
      'Confirm the MANAGEMENT domain was stretched first — TP-304 must be green. A workload-domain cluster cannot be stretched before it.',
      '**SDDC Manager → Inventory → Workload Domains** → this domain → **Clusters** — confirm the cluster shows as stretched.',
      'Confirm fault domains and balanced per-AZ hosts: **Cluster → Configure → vSAN → Fault Domains**, or `esxcli vsan faultdomain get`',
      'Confirm the storage policy is site mirroring and objects are COMPLIANT: **Cluster → Monitor → vSAN → Virtual Objects**.',
      'If this WLD\'s stretch spec was built by hand, confirm `networkProfiles[].isDefault` was set to **false** — `true` is the management domain, and getting it wrong here misconfigures the profile.',
      'Isolate the secondary AZ (shut the inter-site links, or power its hosts off), confirm workloads survive on the primary, then restore and confirm resync completes: **Cluster → Monitor → vSAN → Resyncing Objects** back to zero and objects **Compliant**.',
    ],
    expected:
      'The cluster reports stretched with correct fault domains and a compliant site-mirroring policy, and survives an AZ isolation with a clean resync afterwards.',
  },
  {
    id: 'TP-510',
    title: 'Supervisor prerequisites are routed and reserved',
    epic: 'E9',
    story: '9.4 / 9.6',
    critical: true,
    when: (w) => w.supervisor,
    steps: [
      'Confirm this domain\'s north-south connectivity is already up — TP-505 or TP-506 must be green first. Activation requires it and will fail without it.',
      'Centralized: confirm the Supervisor **ingress** and **egress** CIDRs are reserved, overlap nothing (cross-check TP-002), and are routed by the fabric — on the ToRs `show ip route <ingress-cidr>`.',
      'Distributed: confirm the routable external IP block and the **/16** private transit-gateway block are in place. A /24 transit block does not error, it just never completes.',
      'Confirm FIVE CONSECUTIVE free addresses for the control plane, on the management network. Consecutive is the requirement — five scattered addresses will not do.',
      'Confirm the API FQDN resolves to the planned address: `Resolve-DnsName <supervisor-api-fqdn>`',
      'Confirm DRS is on and fully automated, and HA is on: `Get-Cluster <wld-cluster> | Select Name,DrsEnabled,DrsAutomationLevel,HAEnabled`',
      'Confirm the required storage policies exist and are assignable: `Get-SpbmStoragePolicy | Select Name`',
    ],
    expected:
      'North-south is up, the per-model IP blocks are reserved and routed, five consecutive control-plane addresses and the API FQDN are in place, and DRS/HA/storage policies are ready.',
  },
  {
    id: 'TP-511',
    title: 'Supervisor load balancer is serving',
    epic: 'E9',
    story: '9.4 / 9.6',
    critical: true,
    when: (w) => w.supervisor,
    steps: [
      'Built-in NSX/VPC load balancer: NSX Manager → **Networking → Load Balancing** (or the VPC\'s built-in LB) — confirm the virtual server for the Supervisor API exists and is **Up**.',
      'Foundation Load Balancer: confirm the appliance pair is deployed active/passive (`Get-VM | Where-Object Name -match "flb|foundation" | Select Name,PowerState,VMHost`), then power off the ACTIVE one and confirm the API endpoint keeps serving. Power it back on afterwards.',
      'Avi: confirm the controller set for THIS NSX instance is in place — a WLD sharing an existing NSX instance reuses that set rather than getting a new one.',
      'Avi: confirm the cloud connector matches the networking model — NSX Cloud with VPC mode under Distributed/VPC, NSX Cloud otherwise, or a vCenter cloud for VDS networking. Controller UI → **Infrastructure → Clouds** — status must be green.',
      'Avi: confirm the Service Engines run PER CLUSTER in this workload domain, at least two per cluster for HA: controller UI → **Infrastructure → Service Engines**. Controllers stay in the management domain; only the SEs distribute.',
      'Avi on a VPC path: confirm the SE management network exists on NSX and is selected in the cloud. You must build this yourself — IPAM is not needed and the VIP comes from the VPC external IP block, but without the SE management network the SEs never come up.',
      'Whatever the choice: confirm the Supervisor API address answers — `Test-NetConnection <supervisor-api-fqdn> -Port 443` and then an actual `kubectl` login as in TP-512.',
    ],
    expected: 'The chosen load balancer is deployed and serving the Supervisor API address, with redundancy proven where the model provides it.',
    note: 'Supervisor needs A load balancer, not specifically a premium one. The built-in NSX/VPC option and the Foundation load balancer both satisfy it. Controllers, where used, always live in the management domain — only service engines distribute.',
  },
  {
    id: 'TP-512',
    title: 'Supervisor is enabled and the control plane is usable',
    epic: 'E9',
    story: '9.4 / 9.6',
    critical: true,
    when: (w) => w.supervisor,
    steps: [
      'vSphere Client → **Hosts and Clusters** → the WLD cluster → the **Namespaces** resource pool — confirm three `SupervisorControlPlaneVM` VMs are running.',
      'vSphere Client → **Workload Management → Supervisors** — confirm the Supervisor reports **Running** / **Ready** and the control-plane size matches the design.',
      'Log in from the jumphost over the PUBLISHED FQDN, not an IP, so DNS and the certificate are both exercised: `kubectl vsphere login --server=<supervisor-api-fqdn> --vsphere-username=<user> --insecure-skip-tls-verify=false`',
      'If the certificate is rejected, that is a real finding (SAN missing the API FQDN), not a reason to add `--insecure-skip-tls-verify`.',
      'Confirm the control plane answers: `kubectl get nodes` and `kubectl get ns`',
      'Create a namespace from **Workload Management → Namespaces → New Namespace**, then assign permissions, a storage policy and resource limits to it.',
      'Switch to it and run something real: `kubectl config use-context <namespace>` then `kubectl run test-nginx --image=<your-registry>/nginx --port=80`',
      'Confirm the pod actually starts and gets an address: `kubectl get pods -o wide`. On an air-gapped site use an image from the local registry — a pod stuck in `ImagePullBackOff` is a registry finding worth recording.',
      'Expose it and confirm the load balancer allocates an external address: `kubectl expose pod test-nginx --type=LoadBalancer --port=80` then `kubectl get svc` — the `EXTERNAL-IP` must populate rather than stay `<pending>`.',
      'Reach that external address from OUTSIDE the cluster — this proves the whole ingress chain, not just Kubernetes.',
      'Clean up: `kubectl delete svc,pod test-nginx`, then delete the namespace and confirm it fully clears.',
    ],
    expected:
      'The control plane is running, command-line login over the published FQDN works, and a namespace can be created, run a reachable workload, and be deleted cleanly.',
    note: 'Confirming three VMs are powered on is not evidence the Supervisor is usable — log in and run something. Note `kubectl` and the `kubectl-vsphere` plug-in are separate from the VCF Consumption CLI; on an air-gapped site the Supervisor landing page cannot serve the CLI download, so fetch it from the Broadcom Support Portal and install it on the jumphost beforehand. That download failure is an offline-content gap, not a missed deployment step.',
  },
  {
    id: 'TP-513',
    title: 'Kubernetes content is available and a guest cluster lifecycles cleanly',
    epic: 'E9',
    story: '9.4 / 9.6',
    when: (w) => w.supervisor,
    steps: [
      'vSphere Client → **Content Libraries** — confirm the Kubernetes library exists, is associated with the Supervisor, and has synced. On an air-gapped site confirm the images were imported locally instead.',
      'Confirm the expected image versions are actually available: `kubectl get tkr` (or `kubectl get virtualmachineimages -n <namespace>`). An empty list here is the finding.',
      'Provision a guest cluster by applying a cluster manifest: `kubectl apply -f tkc.yaml -n <namespace>`',
      'Watch it come up — this takes a while: `kubectl get tkc -n <namespace> -w` until the ready condition is True.',
      'Confirm all nodes joined: `kubectl get machines -n <namespace>`',
      'Log in to the guest cluster and run a workload: `kubectl vsphere login --server=<supervisor-api-fqdn> --tanzu-kubernetes-cluster-name <cluster> --tanzu-kubernetes-cluster-namespace <namespace>` then `kubectl run test --image=<registry>/nginx` and `kubectl get pods -o wide`.',
      'Now DELETE it: `kubectl delete tkc <cluster> -n <namespace>`',
      'Confirm everything was released, which is the half that gets skipped: node VMs gone from vCenter (`Get-VM <cluster>*`), load-balancer addresses returned, and persistent volumes cleaned up (`kubectl get pv,pvc -n <namespace>`).',
    ],
    expected: 'The content library is synced with the expected images, and a guest cluster provisions, runs a workload, and deletes cleanly with nothing left behind.',
  },
];

// --- TP-6 — Validation & handover (E10) -----------------------------------

const TP6: Entry[] = [
  {
    id: 'TP-601',
    title: 'Final health check of the complete environment',
    epic: 'E10',
    story: '10.1',
    critical: true,
    steps: [
      'Re-run the platform health check against the FINAL state — an early clean run does not describe the environment being handed over: `ssh vcf@<sddc-manager>`, `cd /opt/vmware/sddc-support`, `./sos --health-check`',
      'Re-check storage health on EVERY cluster in EVERY domain: vSphere Client → **Cluster → Monitor → vSAN → Skyline Health** → **Retest**, per cluster.',
      'Confirm no version or build inconsistency across the estate: `Get-VMHost | Group-Object Version,Build | Select Count,Name` — more than one group inside a cluster is a finding.',
      '**VCF Operations → Fleet Management → Lifecycle** — confirm every component is at its expected version and nothing is mid-upgrade.',
      'Triage every finding: fixed, accepted with a written reason, or scheduled with a named owner. Nothing left unexplained.',
    ],
    expected: 'The final-state health check is clean, or every finding is triaged with an owner and a decision.',
  },
  {
    id: 'TP-602',
    title: 'No unexplained active alerts',
    epic: 'E10',
    story: '10.1',
    steps: [
      '**VCF Operations → Alerts** — review everything active across the fleet, filtered to Critical and Immediate first.',
      'For each, either resolve it or record why it is expected and accepted. "It was there yesterday too" is not a reason.',
      '**Dashboards → Self Health** — confirm green, and explain anything that is not.',
      'Check the per-component alert views too, since they do not all roll up: vCenter → **Monitor → Issues and Alarms**, NSX Manager → **System → Alarms**, and the log and network products if deployed.',
    ],
    expected: 'Every active alert is either resolved or explicitly accepted with a written reason.',
  },
  {
    id: 'TP-603',
    title: 'As-built is complete',
    epic: 'E10',
    story: '10.2',
    steps: [
      'Confirm the as-built records every FQDN, IP, VLAN and subnet actually deployed — the as-deployed state, not the plan.',
      'Confirm the deployment JSON specification and any stretch specification are stored with the engagement records.',
      'Confirm the network and connectivity model is documented, including the per-domain choices.',
      'Confirm the backup configuration, its target and its schedule are documented.',
    ],
    expected: 'The as-built reflects the deployed environment, with specifications and backup configuration stored alongside.',
  },
  {
    id: 'TP-604',
    title: 'Every credential is in the secret store',
    epic: 'E10',
    story: '10.2',
    critical: true,
    steps: [
      'Confirm all auto-generated component passwords from bring-up are stored (captured via **Review Passwords** at TP-106).',
      'Cross-check the inventory of what VCF manages against what you have stored, using `tools/Get-VCFCredentials.ps1` from this repo: `.\\Get-VCFCredentials.ps1 -SDDCManager <fqdn> -Credential (Get-Credential)` lists the accounts SDDC Manager holds for ESXi, vCenter, NSX and backup.',
      'Confirm the host root passwords, appliance shell credentials and the directory bind account are stored.',
      'Confirm the backup encryption passphrase is stored — and that it was actually proven to open an archive at TP-214.',
      'Where in scope, confirm the load-balancer controller PASSPHRASE (restore-critical) and the SSP Installer credentials are stored.',
      'Confirm the break-glass local account is stored, documented, and held out of band from the identity provider.',
      'Spot-check several entries by logging in with them right now. A stored credential that was mistyped is indistinguishable from a correct one until you try it.',
    ],
    expected: 'Every credential the environment depends on is in the secret store and spot-checked as working.',
    note: 'There is no reveal API for VCF-managed passwords — management is rotate-and-expire only. Anything not captured here is unrecoverable without a rotation.',
  },
  {
    id: 'TP-605',
    title: 'Test results are complete and evidenced',
    epic: 'E10',
    story: '10.3',
    critical: true,
    steps: [
      'Confirm every in-scope case has a status, a date and an actual result.',
      'Confirm every pass has filed evidence — a screenshot, log excerpt or API response.',
      'Confirm every non-critical failure has a named owner and an agreed date.',
      'Confirm every not-applicable has a written reason.',
      'Confirm no critical failure remains open.',
    ],
    expected: 'All cases are executed and evidenced, no critical failure is open, and every non-critical failure and exclusion is owned and explained.',
  },
  {
    id: 'TP-606',
    title: 'Security baseline is applied or its deviations are accepted',
    epic: 'E10',
    story: '10.3',
    steps: [
      'Confirm the highest-priority hardening controls are applied or carry a documented, accepted deviation.',
      'Confirm the VCF Installer appliance was powered off or removed after bring-up — UNLESS it became SDDC Manager (the host-resident route), in which case it must stay: `Get-VM | Where-Object Name -match "installer" | Select Name,PowerState`',
      'Spot-check a few ESX controls against the baseline: `Get-VMHost | Get-AdvancedSetting -Name Security.AccountUnlockTime,Security.AccountLockFailures,Security.PasswordHistory | Select @{n="Host";e={$_.Entity}},Name,Value`',
      'Confirm every deviation records the parameter, the chosen value, the business reason, and any compensating control. Undocumented deviations are indistinguishable from misconfiguration at the next audit.',
    ],
    expected: 'Top-priority controls are compliant or carry an accepted, documented deviation, and the installer has been dealt with correctly.',
    note: 'Sequence hardening against this plan: powering off the installer belongs after bring-up is verified, and disabling API basic authentication will break any tooling that still uses it.',
  },
  {
    id: 'TP-607',
    title: 'Operations team walkthrough and sign-off',
    epic: 'E10',
    story: '10.3',
    critical: true,
    steps: [
      'Walk the operations team through the platform: topology, the connectivity model per domain, where to look when something breaks.',
      'Walk through backup and restore, including where the passphrase lives.',
      'Walk through lifecycle: the depot, how updates are applied, and the certificate and licence expiry dates.',
      'Hand over the as-built and the completed test results.',
      'Obtain written sign-off.',
    ],
    expected: 'The operations team has been walked through the platform and its lifecycle, has the as-built and results, and has signed off.',
  },
];

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function pick(entries: Entry[], sel: Selection): TestCase[] {
  return entries.filter((e) => !e.when || e.when(sel)).map(({ when: _when, ...c }) => c);
}

function pickWld(entries: WldEntry[], w: Wld, sel: Selection): TestCase[] {
  return entries.filter((e) => !e.when || e.when(w, sel)).map(({ when: _when, ...c }) => c);
}

/** The phases — and within them, the cases — that apply to this scope. */
export function selectedPhases(raw: Selection): TestPhase[] {
  const sel = normalizeSelection(raw);
  const phases: TestPhase[] = [
    {
      id: 'TP-0',
      title: 'Readiness',
      gate: 'The pre-bring-up go/no-go. Everything the plan called for has actually been built.',
      epics: 'E1–E4',
      cases: pick(TP0, sel),
    },
    {
      id: 'TP-1',
      title: 'Management bring-up',
      gate: 'Bring-up completed and the management fleet is healthy.',
      epics: 'E5',
      cases: pick(TP1, sel),
    },
    {
      id: 'TP-2',
      title: 'Management configuration',
      gate: 'North-south connectivity, availability, and backup are proven.',
      epics: 'E6',
      cases: pick(TP2, sel),
    },
  ];

  if (sel.mgmtStretched) {
    phases.push({
      id: 'TP-3',
      title: 'Stretch the management domain',
      gate: 'The management cluster survives the loss of an availability zone.',
      epics: 'E7',
      cases: pick(TP3, sel),
    });
  }

  const tp4 = pick(TP4, sel);
  if (tp4.length) {
    phases.push({
      id: 'TP-4',
      title: 'Day-2 fleet',
      gate: 'Every deferred and added component is healthy, certified, licensed and integrated.',
      epics: 'E8',
      cases: tp4,
    });
  }

  sel.wlds.forEach((w, i) => {
    phases.push({
      id: `TP-5.${i + 1}`,
      title: `Workload domain — ${w.name}`,
      gate: 'The domain is healthy, north-south works, and workloads can be placed.',
      epics: 'E9',
      wld: { index: i, name: w.name },
      cases: pickWld(TP5, w, sel),
    });
  });

  phases.push({
    id: 'TP-6',
    title: 'Validation & handover',
    gate: 'The complete environment is verified, evidenced, and signed off.',
    epics: 'E10',
    cases: pick(TP6, sel),
  });

  return phases;
}

/** Total in-scope cases, counting a per-WLD case once per domain. */
export function caseCount(sel: Selection): number {
  return selectedPhases(sel).reduce((n, p) => n + p.cases.length, 0);
}

export interface TestStats {
  total: number;
  executed: number;
  passed: number;
  criticalOpen: number;
  perPhase: Record<string, { total: number; executed: number; passed: number; criticalOpen: number }>;
}

export function testStats(sel: Selection, results: TestResults): TestStats {
  const stats: TestStats = { total: 0, executed: 0, passed: 0, criticalOpen: 0, perPhase: {} };
  for (const p of selectedPhases(sel)) {
    const per = { total: 0, executed: 0, passed: 0, criticalOpen: 0 };
    for (const c of p.cases) {
      const r = results[caseKey(p, c)];
      per.total++;
      if (r?.status) per.executed++;
      if (r?.status === 'P' || r?.status === 'NA') per.passed++;
      if (r?.status === 'F1') per.criticalOpen++;
    }
    stats.perPhase[p.id] = per;
    stats.total += per.total;
    stats.executed += per.executed;
    stats.passed += per.passed;
    stats.criticalOpen += per.criticalOpen;
  }
  return stats;
}

export const RESULTS_STORE_KEY = 'vcf9-test-results-v1';

/** Defensive load of a results object from untrusted JSON. */
export function coerceResults(data: unknown): TestResults {
  const out: TestResults = {};
  if (!data || typeof data !== 'object') return out;
  const valid: TestStatus[] = ['P', 'F1', 'F2', 'NA'];
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.status !== 'string' || !valid.includes(r.status as TestStatus)) continue;
    out[k] = {
      status: r.status as TestStatus,
      date: typeof r.date === 'string' ? r.date : '',
      actual: typeof r.actual === 'string' ? r.actual : undefined,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<TestStatus, string> = {
  P: 'Pass',
  F1: 'Critical fail',
  F2: 'Non-critical fail',
  NA: 'N/A',
};

export function buildTestMarkdown(raw: Selection, results: TestResults = {}): string {
  const sel = normalizeSelection(raw);
  const phases = selectedPhases(sel);
  const stats = testStats(sel, results);
  const out: string[] = [];

  out.push('# VCF 9.1 — Test Plan', '');
  out.push(
    `Generated from the deployment scope. **${stats.total}** cases across **${phases.length}** phases; ` +
      `**${stats.executed}** executed, **${stats.passed}** passed or N/A, **${stats.criticalOpen}** critical failures open.`,
    '',
  );
  out.push(
    'Status codes: `P` pass · `F1` critical failure (blocks the phase gate and handover) · ' +
      '`F2` non-critical failure (proceed with a named owner and a date) · `NA` not applicable (record why).',
    '',
    'A phase does not start until the prior phase has no open `F1`. A pass needs an actual result and filed evidence — a tick on its own is not a pass.',
    '',
  );

  for (const p of phases) {
    const per = stats.perPhase[p.id];
    out.push(`## ${p.id} — ${p.title}`, '');
    out.push(`*Covers ${p.epics}. Gate: ${p.gate}*`, '');
    out.push(`${per.executed}/${per.total} executed · ${per.passed} passed or N/A · ${per.criticalOpen} critical open`, '');
    for (const c of p.cases) {
      const r = results[caseKey(p, c)];
      const status = r?.status ? `${STATUS_LABEL[r.status]}${r.date ? ` (${r.date})` : ''}` : 'Not executed';
      out.push(`### ${c.id} — ${c.title}`, '');
      out.push(`**Epic ${c.epic} · Story ${c.story}**${c.critical ? ' · **Critical**' : ''} · Status: ${status}`, '');
      out.push('Steps:', '');
      for (const s of c.steps) out.push(`1. ${s}`);
      out.push('', `**Expected:** ${c.expected}`, '');
      if (c.note) out.push(`> ${c.note}`, '');
      if (r?.actual) out.push(`**Actual:** ${r.actual}`, '');
    }
  }

  out.push('---', '');
  out.push(
    '## Exit criteria',
    '',
    '- Every in-scope case is `P`, `F2` or `NA` — no open `F1`.',
    '- Every `F2` has a named owner and an agreed date.',
    '- Every `NA` has a written reason.',
    '- Every `P` has an actual result and filed evidence.',
    '- The as-built is complete and every credential is in the secret store.',
    '',
  );
  return out.join('\n');
}

/**
 * Exit-criteria audit. The plan's own rule is that a tick on its own is not a
 * pass and an exclusion needs a reason, so the report checks its own evidence
 * rather than reporting a clean sheet that nobody can stand behind.
 */
export interface ReportIssues {
  /** Cases marked P with no actual result / evidence reference recorded. */
  passNoEvidence: { id: string; title: string; phase: string }[];
  /** F2 / NA with no reason recorded — an unowned action or an unexplained exclusion. */
  noReason: { id: string; title: string; phase: string; status: TestStatus }[];
  /** In-scope cases never executed. */
  notExecuted: { id: string; title: string; phase: string; critical: boolean }[];
}

export function reportIssues(raw: Selection, results: TestResults): ReportIssues {
  const sel = normalizeSelection(raw);
  const out: ReportIssues = { passNoEvidence: [], noReason: [], notExecuted: [] };
  for (const p of selectedPhases(sel)) {
    for (const c of p.cases) {
      const r = results[caseKey(p, c)];
      const where = `${p.id} — ${p.title}`;
      if (!r?.status) {
        out.notExecuted.push({ id: c.id, title: c.title, phase: where, critical: !!c.critical });
        continue;
      }
      const hasReason = !!r.actual && r.actual.trim().length > 0;
      if (r.status === 'P' && !hasReason) out.passNoEvidence.push({ id: c.id, title: c.title, phase: where });
      if ((r.status === 'F2' || r.status === 'NA') && !hasReason)
        out.noReason.push({ id: c.id, title: c.title, phase: where, status: r.status });
    }
  }
  return out;
}

/**
 * Delivery report. Shaped for handover: verdict, per-phase summary, the open
 * items someone has to act on, and a full results appendix — WITHOUT the test
 * steps, which belong in the runbook export rather than in a report.
 */
export function buildTestReport(raw: Selection, results: TestResults = {}, preparedOn = ''): string {
  const sel = normalizeSelection(raw);
  const phases = selectedPhases(sel);
  const stats = testStats(sel, results);
  const issues = reportIssues(sel, results);
  const out: string[] = [];

  const notExecuted = stats.total - stats.executed;
  const f2 = phases.reduce(
    (n, p) => n + p.cases.filter((c) => results[caseKey(p, c)]?.status === 'F2').length,
    0,
  );
  const na = phases.reduce(
    (n, p) => n + p.cases.filter((c) => results[caseKey(p, c)]?.status === 'NA').length,
    0,
  );
  const passed = stats.passed - na;

  out.push('# VCF 9.1 — Verification Report', '');
  if (preparedOn) out.push(`**Prepared:** ${preparedOn}  `);
  out.push(`**Scope:** ${typeLabel(sel)}  `, `**Deployment plan epics:** ${includedEpicList(sel)}`, '');

  // Verdict first — the reader wants to know whether this environment is signed off.
  const verdict =
    stats.criticalOpen > 0
      ? `**NOT ACCEPTED** — ${stats.criticalOpen} critical failure${stats.criticalOpen === 1 ? '' : 's'} open.`
      : notExecuted > 0
        ? `**INCOMPLETE** — ${notExecuted} of ${stats.total} case${stats.total === 1 ? '' : 's'} not executed.`
        : f2 > 0
          ? `**ACCEPTED WITH ACTIONS** — all critical cases pass; ${f2} non-critical failure${f2 === 1 ? ' carried as an action' : 's carried as actions'}.`
          : '**ACCEPTED** — all in-scope cases pass or are recorded as not applicable.';
  out.push('## Verdict', '', verdict, '');

  out.push('| Result | Cases |', '| --- | ---: |');
  out.push(`| Passed | ${passed} |`);
  out.push(`| Critical failures (F1) | ${stats.criticalOpen} |`);
  out.push(`| Non-critical failures (F2) | ${f2} |`);
  out.push(`| Not applicable | ${na} |`);
  out.push(`| Not executed | ${notExecuted} |`);
  out.push(`| **Total in scope** | **${stats.total}** |`, '');

  out.push('## Results by phase', '');
  out.push('| Phase | Covers | Executed | Passed / N/A | Critical open |', '| --- | --- | ---: | ---: | ---: |');
  for (const p of phases) {
    const per = stats.perPhase[p.id];
    out.push(
      `| ${p.id} — ${p.title} | ${p.epics} | ${per.executed}/${per.total} | ${per.passed} | ${per.criticalOpen} |`,
    );
  }
  out.push('');

  // Everything below is an action list: what someone still has to do.
  const section = (heading: string, lead: string, rows: string[]) => {
    if (!rows.length) return;
    out.push(`## ${heading}`, '', lead, '', '| Case | Phase | Detail |', '| --- | --- | --- |', ...rows, '');
  };

  section(
    'Open critical failures',
    'These block handover. Each must be resolved and retested.',
    phases.flatMap((p) =>
      p.cases
        .filter((c) => results[caseKey(p, c)]?.status === 'F1')
        .map((c) => `| ${c.id} — ${c.title} | ${p.id} | ${results[caseKey(p, c)]?.actual || '_(no detail recorded)_'} |`),
    ),
  );
  section(
    'Non-critical failures carried as actions',
    'Handover proceeds, but each needs a named owner and an agreed date.',
    phases.flatMap((p) =>
      p.cases
        .filter((c) => results[caseKey(p, c)]?.status === 'F2')
        .map((c) => `| ${c.id} — ${c.title} | ${p.id} | ${results[caseKey(p, c)]?.actual || '_(no owner or date recorded)_'} |`),
    ),
  );
  section(
    'Not applicable',
    'Cases excluded from scope, with the reason recorded.',
    phases.flatMap((p) =>
      p.cases
        .filter((c) => results[caseKey(p, c)]?.status === 'NA')
        .map((c) => `| ${c.id} — ${c.title} | ${p.id} | ${results[caseKey(p, c)]?.actual || '_(no reason recorded)_'} |`),
    ),
  );
  section(
    'Not executed',
    'In-scope cases with no result. The report is incomplete until these are run or explicitly excluded.',
    issues.notExecuted.map((i) => `| ${i.id} — ${i.title} | ${i.phase.split(' — ')[0]} | ${i.critical ? 'Critical' : ''} |`),
  );

  if (issues.passNoEvidence.length || issues.noReason.length) {
    out.push('## Report quality', '');
    out.push(
      'The plan requires an actual result or evidence reference behind every pass, and a written reason behind every action or exclusion. The following entries are incomplete.',
      '',
    );
    if (issues.passNoEvidence.length) {
      out.push(`- **${issues.passNoEvidence.length} pass${issues.passNoEvidence.length === 1 ? '' : 'es'} with no evidence recorded:** ${issues.passNoEvidence.map((i) => i.id).join(', ')}`);
    }
    if (issues.noReason.length) {
      out.push(`- **${issues.noReason.length} action${issues.noReason.length === 1 ? '' : 's'} or exclusion${issues.noReason.length === 1 ? '' : 's'} with no reason recorded:** ${issues.noReason.map((i) => i.id).join(', ')}`);
    }
    out.push('');
  }

  out.push('## Full results', '');
  for (const p of phases) {
    out.push(`### ${p.id} — ${p.title}`, '');
    out.push('| Case | Title | Status | Date | Actual result / evidence |', '| --- | --- | --- | --- | --- |');
    for (const c of p.cases) {
      const r = results[caseKey(p, c)];
      const status = r?.status ? STATUS_LABEL[r.status] : 'Not executed';
      const title = `${c.title}${c.critical ? ' _(critical)_' : ''}`;
      out.push(`| ${c.id} | ${title} | ${status} | ${r?.date || ''} | ${(r?.actual || '').replace(/\|/g, '\\|')} |`);
    }
    out.push('');
  }

  out.push('---', '');
  out.push(
    '_Test steps are omitted here by design; the executed procedure is in the runbook export. ' +
      'Status codes: Pass · Critical fail (blocks handover) · Non-critical fail (action) · N/A (out of scope)._',
    '',
  );
  return out.join('\n');
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildTestCsv(raw: Selection, results: TestResults = {}): string {
  const sel = normalizeSelection(raw);
  const rows: string[] = [
    ['Phase', 'Phase Title', 'Domain', 'Case ID', 'Title', 'Epic', 'Story', 'Critical', 'Steps', 'Expected', 'Note', 'Status', 'Date', 'Actual Results']
      .map(csvCell)
      .join(','),
  ];
  for (const p of selectedPhases(sel)) {
    for (const c of p.cases) {
      const r = results[caseKey(p, c)];
      rows.push(
        [
          p.id,
          p.title,
          p.wld?.name ?? '',
          c.id,
          c.title,
          c.epic,
          c.story,
          c.critical ? 'Yes' : 'No',
          c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
          c.expected,
          c.note ?? '',
          r?.status ?? '',
          r?.date ?? '',
          r?.actual ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return rows.join('\n');
}
