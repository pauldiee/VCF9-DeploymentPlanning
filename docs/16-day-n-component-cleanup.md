# Day-N Component Cleanup and Reinstall

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

## What this covers

| Component | List/delete type | Notes |
| --- | --- | --- |
| Log Management (formerly VCF Operations for Logs) | `vsp-component` | Primary instance only |
| Real-time Metrics | `vsp-component` | **Two** components — the metrics service and its store; both must be removed |
| VCF Operations for Networks (VON) | `ova-component` | Deployed as a plain OVA, not on VCFMS; needs vCenter credentials to clean up the VMs |
| Depot Service | `vsp-component` | Non-primary VCF instances only |
| Identity Broker | `vsp-component` | Non-primary VCF instances only |
| VCF Automation (VCFA) | `vsp-component` + `vsp-cluster` | Two components to unregister, then VCFA's own VCFMS cluster to delete — see [Uninstalling VCF Automation](#uninstalling-vcf-automation) below |

The `list vsp-component` command only ever shows components that are
actually eligible for removal on that instance: on the first/primary VCF
Instance that's Log Management, Real-time Metrics, VON and VCFA; on an
additional/non-primary VCF Instance it's Real-time Metrics, Depot Service and
Identity Broker instead, since those are the components that ship as
optional there.

Download `cleanup_component.py` from the KB and run it on any system with a
Python runtime and network connectivity to your VCF environment. **Double-quote
every substituted value**, even the ones that look safe — a password or FQDN
containing a special character (`$`, spaces, `&`) silently mangles the
argument rather than erroring, the same class of trap as the
`$`-interpolation lockout documented elsewhere in this repo.

## Setup: credentials

```bash
VCF_FLEET_FQDN="<fleet-fqdn>"
VCFMS_RUNTIME_FQDN="<vcfms-runtime-fqdn>"
VCFMS_USERNAME="admin@vsp.local"
VCFMS_PASSWORD="<vcfms-password>"
VCENTER_USERNAME="<vcenter-username>"
VCENTER_PASSWORD="<vcenter-password>"
```

The vCenter credentials are only needed for components the script cleans up
VMs for directly — VON and VCFA's `vsp-cluster` delete. Plain `vsp-component`
deletes (Log Management, Real-time Metrics, Depot Service, Identity Broker)
don't touch vCenter.

## Uninstalling Log Management, Real-time Metrics, Depot Service, or Identity Broker

These are all plain `vsp-component` types — list to find the ID, then delete
it:

```bash
python cleanup_component.py list vsp-component --fleet-fqdn="${VCF_FLEET_FQDN}" --vcf-services-runtime-fqdn="${VCFMS_RUNTIME_FQDN}" --vcf-services-runtime-username="${VCFMS_USERNAME}" --vcf-services-runtime-password="${VCFMS_PASSWORD}"
```

```bash
python cleanup_component.py delete vsp-component --fleet-fqdn="${VCF_FLEET_FQDN}" --vcf-services-runtime-fqdn="${VCFMS_RUNTIME_FQDN}" --vcf-services-runtime-username="${VCFMS_USERNAME}" --vcf-services-runtime-password="${VCFMS_PASSWORD}" --component-id="<component-id-from-list-output>"
```

**Real-time Metrics is two components** — "Real-time metrics" and the
"Real-time metrics store" — both show up separately in the `list` output and
both need their own `delete` run to fully remove the service.

## Uninstalling VCF Operations for Networks (VON)

VON doesn't run on top of VCFMS — it's a traditional OVA appliance, so it
uses the `ova-component` type instead:

```bash
python cleanup_component.py list ova-component --fleet-fqdn="${VCF_FLEET_FQDN}" --vcf-services-runtime-fqdn="${VCFMS_RUNTIME_FQDN}" --vcf-services-runtime-username="${VCFMS_USERNAME}" --vcf-services-runtime-password="${VCFMS_PASSWORD}"
```

```bash
python cleanup_component.py delete ova-component --fleet-fqdn="${VCF_FLEET_FQDN}" --vcf-services-runtime-fqdn="${VCFMS_RUNTIME_FQDN}" --vcf-services-runtime-username="${VCFMS_USERNAME}" --vcf-services-runtime-password="${VCFMS_PASSWORD}" --vcenter-username="${VCENTER_USERNAME}" --vcenter-password="${VCENTER_PASSWORD}" --component-id="<von-component-id-from-list-output>"
```

This delete also cleans up VON's VMs in vCenter, which is why it needs the
vCenter credentials. After it succeeds, one manual step is still required:
remove the VON integration from inside VCF Operations at **Operate →
Administration → Integrations → Accounts → Networks Adapter** — the script
doesn't reach into VCF Operations' own integration registry.

## Uninstalling VCF Automation

VCF Automation removal is **three deletes, in order** — the first two use
`vsp-component`, the last uses `vsp-cluster`. This applies regardless of
which network VCFA was deployed to — the [non-management-network deployment
method](05-day2-deployments.md#deploying-vcf-automation-to-a-non-management-network--api-only)
in `05-day2-deployments.md` links here as its fallback when the
`admin@vsp.local` credential cannot be recovered, but the procedure itself is
general-purpose.

### The credential: `--vcf-services-runtime-username` / `--vcf-services-runtime-password`

The username is `admin@vsp.local` here too, but **this is VCFA's own,
separate VCFMS instance — not the fleet-wide one**, and its password is
**not** assumed to be the same as the fleet-wide instance's. (The
"`admin@vsp.local` shares its password with `vmware-system-user`" fact
documented for the **fleet-wide** runtime's `$`-interpolation lockout in
`05-day2-deployments.md` is about that *other* instance — don't carry it
over here without separately confirming it holds for VCFA's own instance
too.) Source the password from wherever VCFA's own deployment recorded it.

> Field-verified 2026-07-27. VCFA brings its own Services Runtime with its
> own `admin@vsp.local`, distinct from the fleet-wide VCF Management Services
> runtime used elsewhere in this repo (the one behind the `$`-interpolation
> lockout documented in `05-day2-deployments.md`). If that *other* runtime's
> `admin@vsp.local` is broken, it does **not** block this cleanup — the
> `--vcf-services-runtime-username`/`--vcf-services-runtime-password` values
> here authenticate against VCFA's own instance. Confirm which FQDN
> `--vcf-services-runtime-fqdn` actually points at before assuming either
> way.

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
4. **Delete VCFA's own VCFMS cluster**, as **root**, from inside the SDDC
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
