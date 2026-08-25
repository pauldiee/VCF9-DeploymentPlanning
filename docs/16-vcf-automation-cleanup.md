# VCF Automation — Cleanup and Reinstall

Removing a VCF Automation deployment cleanly so it can be redeployed fresh —
using Broadcom's `cleanup_component.py` script (from [KB 441333 — Scripted
components cleanup from VCF
Operations](https://knowledge.broadcom.com/external/article/441333/scripted-components-cleanup-from-vcf-ope.html)).
This applies regardless of which network VCFA was deployed to — the
[non-management-network deployment
method](05-day2-deployments.md#deploying-vcf-automation-to-a-non-management-network--api-only)
in `05-day2-deployments.md` links here as its fallback when the
`admin@vsp.local` credential cannot be recovered, but the procedure itself is
general-purpose.

> **Credit.** The worked example and command order below follow William Lam's
> [VCF 9.1 Quick Tip: Uninstalling Optional Day-N
> Components](https://williamlam.com/2026/06/vcf-9-1-quick-tip-uninstalling-optional-day-n-components.html),
> which walks the VCFA-specific sequence the KB only states in general terms.

## The credential: `VCFMS_USERNAME` / `VCFMS_PASSWORD`

`VCFMS_USERNAME` is `admin@vsp.local` here too, but **this is VCFA's own,
separate VCFMS instance — not the fleet-wide one**, and its password is
**not** assumed to be the same as the fleet-wide instance's. (The
"`admin@vsp.local` shares its password with `vmware-system-user`" fact
documented for the **fleet-wide** runtime's `$`-interpolation lockout in
`05-day2-deployments.md` is about that *other* instance — don't carry it
over here without separately confirming it holds for VCFA's own instance
too.) Source `VCFMS_PASSWORD` from wherever VCFA's own deployment recorded
it.

> Field-verified 2026-07-27. VCFA brings its own Services Runtime with its
> own `admin@vsp.local`, distinct from the fleet-wide VCF Management Services
> runtime used elsewhere in this repo (the one behind the `$`-interpolation
> lockout documented in `05-day2-deployments.md`). If that *other* runtime's
> `admin@vsp.local` is broken, it does **not** block this cleanup —
> `VCFMS_USERNAME`/`VCFMS_PASSWORD` here authenticate against VCFA's own
> instance. Confirm which FQDN `VCFMS_RUNTIME_FQDN` actually points at before
> assuming either way.

## The procedure

VCF Automation removal is **three deletes, in order** — the first two use
`vsp-component`, the last uses `vsp-cluster`. Double-quote every variable
substitution below; an unquoted value that happens to contain a special
character fails silently rather than erroring, the same class of trap as the
`$`-interpolation lockout documented elsewhere in this repo.

1. **List `vsp-component` to find the "VCF Automation" and "Migration service
   engine" component IDs:**
   ```bash
   python cleanup_component.py list vsp-component --fleet-fqdn="${VCF_FLEET_FQDN}" --vcf-services-runtime-fqdn="${VCFMS_RUNTIME_FQDN}" --vcf-services-runtime-username="${VCFMS_USERNAME}" --vcf-services-runtime-password="${VCFMS_PASSWORD}"
   ```
2. **Delete the "Migration service engine" component first** — VCFA brings
   its own migration engine, which is a separate component from Automation
   itself and does not get removed with it:
   ```bash
   python cleanup_component.py delete vsp-component --fleet-fqdn="${VCF_FLEET_FQDN}" --vcf-services-runtime-fqdn="${VCFMS_RUNTIME_FQDN}" --vcf-services-runtime-username="${VCFMS_USERNAME}" --vcf-services-runtime-password="${VCFMS_PASSWORD}" --component-id="<migration-service-engine-component-id>"
   ```
3. **Then delete the "VCF Automation" component**, with its own component ID
   from the list output:
   ```bash
   python cleanup_component.py delete vsp-component --fleet-fqdn="${VCF_FLEET_FQDN}" --vcf-services-runtime-fqdn="${VCFMS_RUNTIME_FQDN}" --vcf-services-runtime-username="${VCFMS_USERNAME}" --vcf-services-runtime-password="${VCFMS_PASSWORD}" --component-id="<vcf-automation-component-id>"
   ```
4. **Delete VCFA's own VCFMS cluster**, as **root**, from inside the SDDC
   Manager VM — list first to get the ID, then delete:
   ```bash
   python cleanup_component.py list vsp-cluster --fleet-fqdn="${VCF_FLEET_FQDN}" --vcf-services-runtime-fqdn="${VCFMS_RUNTIME_FQDN}" --vcf-services-runtime-username="${VCFMS_USERNAME}" --vcf-services-runtime-password="${VCFMS_PASSWORD}"
   ```
   ```bash
   python cleanup_component.py delete vsp-cluster --fleet-fqdn="${VCF_FLEET_FQDN}" --vcf-services-runtime-fqdn="${VCFMS_RUNTIME_FQDN}" --vcf-services-runtime-username="${VCFMS_USERNAME}" --vcf-services-runtime-password="${VCFMS_PASSWORD}" --vcenter-username="${VCENTER_USERNAME}" --vcenter-password="${VCENTER_PASSWORD}" --component-id="<id-from-list-output>"
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
