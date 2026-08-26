# Remove Components

Cleanly removing an optional Day-N fleet component so it can be redeployed
fresh — using Broadcom's `cleanup_component.py` script (from [KB 441333 —
Scripted components cleanup from VCF
Operations](https://knowledge.broadcom.com/external/article/441333/scripted-components-cleanup-from-vcf-ope.html)).
There is currently no UI workflow for this in the VCF LCM UI — the script is
the only supported path.

> **Credit.** The worked examples and command order below follow William
> Lam's [VCF 9.1 Quick Tip: Uninstalling Optional Day-N
> Components](https://williamlam.com/2026/06/vcf-9-1-quick-tip-uninstalling-optional-day-n-components.html),
> which walks each component's sequence in concrete commands where the KB
> only states the tool in general terms.

Download `cleanup_component.py` from the KB and run it on any system with a
Python runtime and network connectivity to your VCF environment.

> **Recommendation: run it from the SDDC Manager VM.** Copy the script there
> with SCP and run it over SSH as root. SDDC Manager ships with Python by
> default, so there's nothing to install, and the `delete vsp-cluster` step
> under [VCF Automation](#vcf-automation) below already **requires** running
> from inside the SDDC Manager VM as root — using the same VM for every
> component keeps one consistent place to run the script from instead of
> switching machines partway through.

**Double-quote every substituted value**, even the ones that look safe — a
password or FQDN containing a special character (`$`, spaces, `&`) silently
mangles the argument rather than erroring, the same class of trap as the
`$`-interpolation lockout documented elsewhere in this repo.

The `list vsp-component` command only ever shows components that are
actually eligible for removal on that instance: on the first/primary VCF
Instance that's Log Management, Real-time Metrics, VON and VCFA; on an
additional/non-primary VCF Instance it's Real-time Metrics, Depot Service and
Identity Broker instead, since those are the components that ship as
optional there.

## Contents

- [Log Management](#log-management)
- [Real-time Metrics](#real-time-metrics)
- [VCF Operations for Networks (VON)](#vcf-operations-for-networks-von)
- [Depot Service](#depot-service)
- [Identity Broker](#identity-broker)
- [VCF Automation](#vcf-automation)
- [References](#references)

The vCenter credentials (`--vcenter-username` / `--vcenter-password`) are
only needed for components the script cleans up VMs for directly — VON and
VCFA's `vsp-cluster` delete. Plain `vsp-component` deletes (Log Management,
Real-time Metrics, Depot Service, Identity Broker) don't touch vCenter.

## Log Management

Log Management (formerly VCF Operations for Logs) is a plain `vsp-component`
type, visible on the first/primary VCF Instance. List to find its ID, then
delete it:

```bash
python cleanup_component.py list vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>"
```

```bash
python cleanup_component.py delete vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>" --component-id="<log-management-component-id>"
```

## Real-time Metrics

Also a `vsp-component` type, visible on any VCF Instance (primary or
non-primary). **This is two separate components** — "Real-time metrics" and
the "Real-time metrics store" — both show up separately in the `list`
output and **both need their own delete run** to fully remove the service;
deleting only one leaves the other behind.

```bash
python cleanup_component.py list vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>"
```

```bash
python cleanup_component.py delete vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>" --component-id="<real-time-metrics-component-id>"
```

```bash
python cleanup_component.py delete vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>" --component-id="<real-time-metrics-store-component-id>"
```

## VCF Operations for Networks (VON)

VON doesn't run on top of VCFMS — it's a traditional OVA appliance, so it
uses the `ova-component` type instead of `vsp-component`, and needs the
vCenter credentials to clean up its VMs:

```bash
python cleanup_component.py list ova-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>"
```

```bash
python cleanup_component.py delete ova-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>" --vcenter-username="<vcenter-username>" --vcenter-password="<vcenter-password>" --component-id="<von-component-id>"
```

After that delete succeeds, one manual step is still required: remove the
VON integration from inside VCF Operations at **Operate → Administration →
Integrations → Accounts → Networks Adapter** — the script doesn't reach into
VCF Operations' own integration registry.

## Depot Service

A plain `vsp-component` type, but only visible (and only removable) on an
**additional/non-primary VCF Instance** — it's one of the optional
components that ships there:

```bash
python cleanup_component.py list vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>"
```

```bash
python cleanup_component.py delete vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>" --component-id="<depot-service-component-id>"
```

## Identity Broker

Also a plain `vsp-component` type, and also **non-primary-instance only**,
same as Depot Service above:

```bash
python cleanup_component.py list vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>"
```

```bash
python cleanup_component.py delete vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>" --component-id="<identity-broker-component-id>"
```

## VCF Automation

VCF Automation removal is **three deletes, in order** — the first two use
`vsp-component`, the last uses `vsp-cluster`. This applies regardless of
which network VCFA was deployed to — the [non-management-network deployment
method](05-day2-deployments.md#deploying-vcf-automation-to-a-non-management-network--api-only)
in `05-day2-deployments.md` links here as its fallback when the
`admin@vsp.local` credential cannot be recovered, but the procedure itself is
general-purpose.

### The credential: `--vcf-services-runtime-username` / `--vcf-services-runtime-password`

The username is `admin@vsp.local`, and **this is the fleet-wide VCF
Management Services runtime — the same one used for every other component
in this doc** — not a separate VCFA-specific instance. There is no
independent VCFMS runtime tied to VCFA; all four steps below (list/delete
`vsp-component` x2, list/delete `vsp-cluster`) authenticate against the same
fleet-wide runtime and credential, including the "`admin@vsp.local` shares
its password with `vmware-system-user`" fact documented for the
`$`-interpolation lockout in `05-day2-deployments.md`.

> **Correction:** an earlier revision of this doc claimed VCFA brings its own
> separate Services Runtime with its own `admin@vsp.local`, distinct from the
> fleet-wide instance. That was wrong — the fleet-wide runtime is what's
> actually used for this entire procedure. If the fleet-wide `admin@vsp.local`
> is broken (see the `$`-interpolation lockout trap in
> `05-day2-deployments.md`), it **does** block this cleanup and needs
> recovering first.

### The procedure

1. **List `vsp-component` to find the "VCF Automation" and "Migration service
   engine" component IDs:**
   ```bash
   python cleanup_component.py list vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>"
   ```
2. **Delete the "Migration service engine" component first** — VCFA brings
   its own migration engine, which is a separate component from Automation
   itself and does not get removed with it:
   ```bash
   python cleanup_component.py delete vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>" --component-id="<migration-service-engine-component-id>"
   ```
3. **Then delete the "VCF Automation" component**, with its own component ID
   from the list output:
   ```bash
   python cleanup_component.py delete vsp-component --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>" --component-id="<vcf-automation-component-id>"
   ```
4. **Delete VCFA's VCFMS cluster**, as **root**, from inside the SDDC
   Manager VM — list first to get the ID, then delete:
   ```bash
   python cleanup_component.py list vsp-cluster --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>"
   ```
   ```bash
   python cleanup_component.py delete vsp-cluster --fleet-fqdn="<fleet-fqdn>" --vcf-services-runtime-fqdn="<vcfms-runtime-fqdn>" --vcf-services-runtime-username="admin@vsp.local" --vcf-services-runtime-password="<vcfms-password>" --vcenter-username="<vcenter-username>" --vcenter-password="<vcenter-password>" --component-id="<id-from-list-output>"
   ```
   The `delete vsp-cluster` step is the one that actually cleans up the VMs in
   vCenter — steps 1–3 alone leave the VCFMS VMs behind.

After the `delete vsp-cluster` step, confirm in vCenter that the VCFMS VMs
are actually gone before treating the environment as clean for a fresh
deploy — the script's own "success" does not substitute for checking.

## References

TechDocs / KB: [KB 441333 — Scripted components cleanup from VCF
Operations](https://knowledge.broadcom.com/external/article/441333/scripted-components-cleanup-from-vcf-ope.html)
· [William Lam — VCF 9.1 Quick Tip: Uninstalling Optional Day-N
Components](https://williamlam.com/2026/06/vcf-9-1-quick-tip-uninstalling-optional-day-n-components.html).
