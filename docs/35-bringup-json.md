# Bring-up JSON — Generate, Validate, Review

The VCF Installer can deploy from a **JSON specification file** instead of the
wizard. This guide covers the step between the filled planning workbook and the
first bring-up: producing that file, proving it is well-formed, and checking it
against your plan before it touches the hosts. It is story 3.2 of the
[deployment plan](06-deployment-plan.md).

> **Status: TechDocs- and OpenAPI-sourced, not lab-verified.** The wizard and
> JSON pages are the 9.1 TechDocs (*Last Updated October 26, 2026*, read
> 2026-10-29). Field names and endpoints come from the **9.1.0.0** VCF Installer
> OpenAPI specification; the 9.1.1 bundle was not read, so check a field against
> the bundle that matches your Installer build ([§9](#9-sources)). Every API
> snippet is **untested** until someone runs it against a lab.

---

## 1. Where this sits

```
intake  →  workbook (story 3.1)  →  JSON (this page, story 3.2)  →  validate  →  bring-up
```

The JSON route has one requirement on the Installer itself: the 9.1 TechDocs say
to *"Verify that you deployed VCF Installer version 9.1.1 or later"* before using
a JSON specification file. The same page lists what the file can deploy: a new
VCF fleet or instance, a new vSphere Foundation platform, deferred components,
convergence of existing infrastructure, and VCF management services plus the
License Server for vSphere Foundation.

---

## 2. Pick the route

| Route | What you do | Good for | Watch out |
| ----- | ----------- | -------- | --------- |
| **A. Wizard, then download** | Fill the wizard, download the JSON template or the spec from the review page, edit it, upload it from the Installer homepage | A first deployment; a second one that is mostly a copy of the first | The downloaded file has no passwords ([§3](#3-route-a-the-wizard-as-a-spec-editor)) |
| **B. Generate from the workbook** | Run VCF.JSONGenerator over the filled P&P workbook | Many values already live in the workbook; repeatable runs | The module is tightly coupled to the workbook version ([§4](#4-route-b-generate-from-the-workbook)) |
| **C. Hand-built from the API schema** | Write the file against the Installer's `SddcSpec` | A scenario neither of the others expresses; reviewing what A or B produced | Field names depend on the Installer version ([§5](#5-route-c-hand-built-from-the-api-schema)) |

They combine well: generate (B) or download (A), then read the result as a
route-C reviewer would.

---

## 3. Route A: the wizard as a spec editor

All of this is **[documented]** on the 9.1
[deployment wizard page][td-wizard] and the [JSON specification page][td-json]:

- On the wizard's prerequisites screen you can **download a JSON template** *"based
  on your choices in the VCF Installer so far"*, populate it, and deploy with it.
- On the review screen you can *"download the JSON specification file, make the
  necessary changes, and then upload the modified JSON specification file from the
  VCF Installer homepage"*.
- Upload it with **Deploy Using JSON Spec**, review the *Summary* and *JSON
  Preview*, then the validation results ([§6](#6-validate-before-bring-up)).
- **Passwords:** after a deployment, *"Download the JSON specification file. The
  JSON specification file does not include passwords."* Anything you re-upload
  needs its passwords put back by you. The Installer's **Review Passwords** page,
  or **Deployments** under the user menu, shows them for past deployments.

---

## 4. Route B: generate from the workbook

**VCF.JSONGenerator** is Ken Gould's cross-platform PowerShell module, a companion
to the Planning and Preparation workbook:
[GitHub][jsongen-gh] · [PowerShell Gallery][jsongen-psg]. Credit and thanks to
the author; this repo only points at it.

What its README says **[documented]**:

- Run it from the folder that holds the workbook: `Start-VCFJsonGeneration`, then
  choose the option that discovers and loads a workbook. `Set-VCFJsonGenerationPrequisites`
  detects and installs the dependencies (ImportExcel and VMware.PowerCLI or
  VCF.PowerCLI).
- *"very tight coupling between the version of the Planning & Preparation file"*
  and the module version. Use the module release that matches the workbook
  revision you filled in; the README names VCF 9.0, so confirm in the module's
  own release notes that your 9.1 / 9.1.1 workbook is supported before you trust
  its output.
- It **only generates** the files: it does not configure prerequisites and does not
  submit anything to an API endpoint. You still validate and upload.

The workbook fields it reads are the named ranges mapped in
[`workbook-cell-mapping.md`](workbook-cell-mapping.md#how-the-downstream-tooling-reads-the-workbook-named-ranges),
which is why filling the workbook from the intake first (story 3.1) matters.

---

## 5. Route C: hand-built from the API schema

TechDocs sends you to the *VMware Cloud Foundation Installer API Reference Guide*
for the properties, and offers example JSON files for new deployments,
convergence, deferred components and the vSphere Foundation services install.

**What the schema says** (9.1.0.0 specification, `SddcSpec`) **[spec]**:

- Required at the top level: `dnsSpec`, `networkSpecs`, `sddcId`, `vcenterSpec`.
- `workflowType` is one of `VCF`, `VCF_COMPLETE`, `VCF_EXTEND`, `VVF`,
  `VCF_BOOTSTRAP`. For a secondary instance joining a fleet it is `VCF_EXTEND`.
- Component blocks: `nsxtSpec`, `vcfOperationsSpec`, `vcfOperationsCollectorSpec`,
  `vcfAutomationSpec`, `vspClusterSpec` (VCF management services),
  `licenseServerSpec`, `vidbSpec` (Identity Broker), `fleetLcmSpec`,
  `sddcLcmSpec`, `fleetDepotSpec`, `datastoreSpec`, `dvsSpecs`, `hostSpecs`,
  `clusterSpec`, `securitySpec` and others.
- Flags worth deciding on purpose rather than inheriting from a template:
  `ceipEnabled`, `skipEsxThumbprintValidation`, `skipGatewayPingValidation`.

**Which blocks you need** depends on the scenario. The TechDocs table, condensed to
the properties it names (values as the page gives them; `useExistingDeployment`
is the property on each component block):

| I want to… | `workflowType` | `vcfOperationsSpec`<br>`useExistingDeployment` | `vcenterSpec`<br>`useExistingDeployment` | `vspClusterSpec` (VCF management services) | `vidbSpec` (Identity Broker) |
| ---------- | -------------- | ------------------------------------------- | ------------------------------------- | ------------------------------------------ | ---------------------------- |
| Deploy a new VCF fleet | `VCF` | false | false | true | true |
| Deploy a new VCF instance | `VCF_EXTEND` | true | false | true | true / false (mandatory for the primary instance only) |
| Deploy deferred components | `VCF_COMPLETE` | true | false | false | n/a |
| Deploy a new vSphere Foundation platform | `VVF` | false | false | true / false (see below) | true |

The page has more rows (convergence, the VVF services install, existing NSX and
VCF Automation); read the table there for those.

**`vspClusterSpec` takes an address pool three ways** **[documented]**: a CIDR
(`ipv4Pool.cidr`), a range (`ipv4Pool.ipRange.startIpAddress` / `endIpAddress`),
or a list (`ipv4Pool.addresses`), each with optional `excludedAddresses`, plus
`internalClusterCidrIpv4`. The services runtime's internal block is
`198.18.0.0/15`; *"If this subnet is currently in use on your network, you must
change the internal CIDR block … to 240.0.0.0/15 or 250.0.0.0/15"*. The other
internal blocks are in [`34-internal-cidrs.md`](34-internal-cidrs.md).

**Without VCF management services (VVF)** the page requires one change on the
Installer appliance first (`explicit.management.components.deployment=true` in
`/etc/vmware/vcf/domainmanager/application.properties`, then restart
`domainmanager`); use the exact commands on the page for your build.

**Use the version-pinned spec bundle for field names**, not the "latest" page on
developer.broadcom.com, which can silently show an older major line. The bundle
is a download behind Broadcom's SDK licence agreement; do not commit it to a
repository.

---

## 6. Validate before bring-up

### In the Installer

After upload, the Installer *"validates the information that you provided in the
JSON specification and reports any errors or warnings"* **[documented]**:

- **Warnings** — address them or **Acknowledge** to proceed.
- **Errors** — resolve them with the remediation text in the message, then
  *"modify and reupload the JSON specification file"*. Repeat until clean, then
  **Deploy**.

### Through the API (before you open the UI) — untested

The 9.1.0.0 specification offers a dry run **[spec]**. Authenticate, submit the
same body the UI would, and poll the result:

```powershell
# UNTESTED. Windows PowerShell 5.1-safe (no -SkipCertificateCheck): trust the
# Installer's certificate on this machine first, or run it from PowerShell 7
# and add -SkipCertificateCheck to each call.
$installer = 'https://vcf-installer.sfo.example.io'
$cred  = Get-Credential -Message 'VCF Installer admin@local'
$login = @{ username = $cred.UserName
            password = $cred.GetNetworkCredential().Password } | ConvertTo-Json
$token = (Invoke-RestMethod -Method Post -Uri "$installer/v1/tokens" `
          -ContentType 'application/json' -Body $login).accessToken
$h = @{ Authorization = "Bearer $token" }

$spec = Get-Content -Raw -Path .\bringup.json          # keep this file private, section 8
$val  = Invoke-RestMethod -Method Post -Uri "$installer/v1/sddcs/validations" `
          -Headers $h -ContentType 'application/json' -Body $spec
Invoke-RestMethod -Uri "$installer/v1/sddcs/validations/$($val.id)" -Headers $h |
  Select-Object id, executionStatus, resultStatus
```

What the specification says to expect:

- **A malformed body is refused at submission** (the endpoint lists `400` among its
  responses). That is the **schema** failing: a wrong or unknown field, a missing
  required block. Fix the file; nothing was checked about your environment yet.
- **An accepted body returns `202` with a `Validation`**, which you poll at
  `GET /v1/sddcs/validations/{id}`. `executionStatus` is `IN_PROGRESS`,
  `FAILED`, `COMPLETED`, …; `resultStatus` is `SUCCEEDED`, `FAILED` or `WARNING`
  once it has completed. Each entry in `validationChecks` carries a `severity`
  (`ERROR`, `WARNING`, `INFO`) and, for warnings, whether it needs
  acknowledgement. That is the **content** failing: DNS, addresses, hosts,
  credentials — the remediation text names the fix.
- Related endpoints in the same specification: `POST /v1/sddcs/resources-calculation`
  (the infrastructure the spec would need, useful next to
  [`04-sizing.md`](04-sizing.md)) and `GET /v1/sddcs/{id}/spec` (the input spec of
  an installation that has already started).

For the fake-UUID trick that proves a spec's *shape* without real hosts (used for
domain and cluster specs), see
[`21-config-artifacts.md` §4](21-config-artifacts.md#4-validate-before-reuse). It
is not established for the bring-up endpoint; use the Installer's own validation.

---

## 7. Review against the plan

Machine validation proves the file is consistent, not that it is *your* design.
Read the file against the plan:

| Check | Against |
| ----- | ------- |
| Every FQDN and IP in the file | [`01-network-dns-plan.md`](01-network-dns-plan.md): forward **and** reverse DNS resolve, addresses sit in the planned subnets |
| NTP and DNS servers | The same plan; every component gets the same time source |
| Deployment model and sizes | [`04-sizing.md`](04-sizing.md) and the sizer result you signed off |
| Services-runtime pool and internal CIDR | [`30-ops-logs-sizing.md`](30-ops-logs-sizing.md), [`34-internal-cidrs.md`](34-internal-cidrs.md): room for Day-N workers, no overlap with a routed network |
| Principal storage type and datastore | The workbook / intake answer; the datastore exists and is mounted where the type requires it |
| NSX connectivity and VPC choices | The management-domain answers in [`02-intake.md`](02-intake.md) |
| Which components are *existing* vs *new* | The scenario table in [§5](#5-route-c-hand-built-from-the-api-schema) |
| Passwords | Present for every component the Installer asks for, stored in your secret store, meeting the rules the Installer reports |
| License Server, Identity Broker, CEIP, skip flags | Deliberate values, written down |

If you generated the file ([§4](#4-route-b-generate-from-the-workbook)), a quick
way to find a wrong cell is to diff the JSON against the workbook value by value
for the first run; later runs only need the changed rows.

---

## 8. Handle the file as a secret

The spec you upload holds **every bring-up password**, plus FQDNs, addresses and
account names: the same sensitivity as a filled planning workbook.

- Keep it in an encrypted, access-controlled store, never in a public or shared
  repository, and never in a chat or ticket. Put its folder in `.gitignore`.
- The Installer's *download* has no passwords ([§3](#3-route-a-the-wizard-as-a-spec-editor)),
  so the **downloaded** copy is the one to keep as a template; keep the filled
  copy only as long as you need it.
- Repeat runs: re-upload the edited file from the Installer homepage rather than
  retyping the wizard.
- More on handling captures and templates:
  [`21-config-artifacts.md` §5](21-config-artifacts.md#5-handle-the-output-as-sensitive-data).

---

## 9. Sources

- [Use a JSON Specification File to Deploy VMware Cloud Foundation or vSphere Foundation][td-json] (9.1)
- [Start a New VCF Fleet or a New VCF Instance by Using the VCF Installer Deployment Wizard][td-wizard] (9.1)
- VCF Installer OpenAPI specification, 9.1.0.0, from the
  [VCF API specification bundle](https://developer.broadcom.com/sdks/vcf-api-specification/latest)
- [VCF.JSONGenerator on GitHub][jsongen-gh] and [PowerShell Gallery][jsongen-psg]

[td-json]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/use-a-json-specification-to-deploy-vmware-cloud-foundation-or-vmware-vsphere-foundation.html
[td-wizard]: https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-1/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/deploy-a-new-vcf-fleet-or-a-new-vcf-instance.html
[jsongen-gh]: https://github.com/vmware/powershell-module-for-vmware-cloud-foundation-jsongenerator
[jsongen-psg]: https://www.powershellgallery.com/packages/VCF.JSONGenerator/
