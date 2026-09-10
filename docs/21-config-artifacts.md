# Capturing Reusable Configuration Artifacts from a Built Environment

Pulling **re-submittable spec JSON** out of a running VCF 9.1 instance — installer
outputs and config templates you can sanitize, parameterise and keep as a
template library for the next build. This is the reverse of the rest of this
repo: instead of feeding the workbook toward a deployment, it turns a deployment
back into inputs.

> **Scope.** VCF has **no single "export the whole environment as JSON" button.**
> Some layers round-trip cleanly (bring-up spec, Fleet LCM components, Supervisor
> export, the NSX policy hierarchy); others you **reconstruct** from a `GET` plus
> the `POST` schema (workload domains, clusters); vCenter / vSAN give only
> partial config-profile JSON. The tables below say which is which.

> **This is not a DR mechanism.** For rebuild-after-loss the supported path is
> **VCF Instance Recovery**, which uses its own stored artifacts. Hand-rolled
> extraction is for **audit, documentation, and building a *new* similar
> environment**.

## Contents

| # | Section | Use it when |
| - | ------- | ----------- |
| 1 | [What is reusable vs reconstructed vs read-only](#1-what-is-reusable-vs-reconstructed-vs-read-only) | Deciding what is worth capturing |
| 2 | [Capture](#2-capture) | Pulling the JSON — per component |
| 3 | [Sanitize and parameterise](#3-sanitize-and-parameterise) | Turning a captured spec into a template |
| 4 | [Validate before reuse](#4-validate-before-reuse) | Proving a template still deploys |
| 5 | [Data hygiene](#5-data-hygiene) | Where the outputs are allowed to live |
| 6 | [Limitations](#6-limitations) | What you cannot get this way |
| 7 | [References](#7-references) | APIs, tools, sister repos |

---

## 1. What is reusable vs reconstructed vs read-only

### Round-trippable — a `GET` gives you (near) the deploy shape

| Artifact | Source | Re-submitted via |
| -------- | ------ | ---------------- |
| **Bring-up / deployment spec** | The **VCF Installer** appliance retains the spec it ran (UI download; the bring-up API). SDDC Manager also exposes it — `GET /v1/sddcs/{id}`. | A fresh VCF Installer bring-up |
| **Fleet LCM component specs** — VCF Automation, VCF Management Services, License Server, Day-N components | `GET /fleet-lcm/v1/components` → `GET /fleet-lcm/v1/components/{id}` **and** `/config` → `VspComponentSpec` / `VspClusterConfigSpec`. **Do this for *every* component whose `componentType` is `VSP`** — there is one per runtime and VCF Automation's is its own (see [`09-binary-depot.md` §5](09-binary-depot.md#5-proxy-for-the-vcf-services-runtime-via-the-fleet-lcm-api)). | `POST /fleet-lcm/v1/components` (same `componentSpecs` shape) |
| **vSphere Supervisor config** | vSphere Client → *Workload Management → Supervisors →* Configure → **Export Configuration** → JSON. Also `GET …/api/vcenter/namespace-management/clusters/{id}`. | *"Deploy a Supervisor by Importing a JSON Configuration File"* ([`10-supervisor-enablement.md` §6, §9.2](10-supervisor-enablement.md#6-activate-the-supervisor)) |
| **NSX policy hierarchy** (per domain) | `GET https://<nsx>/policy/api/v1/infra?base_path=<scope>` — one JSON tree per scope (T0s, T1s, segments, edge clusters, VPC connectivity profiles, gateway policies, groups, services) | `PATCH /policy/api/v1/infra` (the Hierarchical Policy API takes the same document) |
| **VKS cluster + `TkgServiceConfiguration`** | `kubectl get cluster <n> -n <ns> -o json`; `kubectl get tkgserviceconfiguration tkg-service-configuration -o json` (against the Supervisor) | `kubectl apply` |

### Reconstructed — `GET` + the `POST` schema

| Artifact | Get | Rebuild |
| -------- | --- | ------- |
| **Workload domains** | `GET /v1/domains` → `GET /v1/domains/{id}` | Keep only the fields in the API Explorer's `POST /v1/domains` schema. **PowerVCF** (`Get-VcfWorkloadDomain` → `ConvertTo-Json`) reduces the busywork. |
| **Clusters** | `GET /v1/clusters/{id}` | Prune to `POST /v1/clusters` |
| **vCenter / vSAN cluster config** | vSphere 8U2+/9 **Configuration Profiles** — `GET /api/esx/settings/clusters/{id}/configuration` | Import as cluster desired state. Partial coverage — no full "vCenter deployment JSON". |

### Read-only — context, not a spec

Network pools (`GET /v1/network-pools`), license keys (`GET /v1/license-keys` — mask them), the **credentials inventory** (`GET /v1/credentials` — capture component/username/type, **never** the plaintext), hosts, health. Keep these alongside the specs so a template has the reference values it points at.

---

## 2. Capture

Until `tools/Get-VCFDeploymentArtifacts.ps1` lands (see [#295](https://github.com/pauldiee/VCF9-DeploymentPlanning/issues/295)), capture by hand. The pattern is the same everywhere: **token → `GET` → `jq` to prune → save**.

### 2.1 VCF / Fleet API token

```bash
TOKEN=$(curl -sk -X POST https://<sddc-mgr>/v1/tokens \
  -H 'Content-Type: application/json' \
  -d '{"username":"administrator@vsphere.local","password":"<pw>"}' | jq -r .accessToken)
```

For Fleet LCM and VCF Operations use the `OpsToken` → `fleet-lcm` exchange from
[`09-binary-depot.md` §5](09-binary-depot.md#5-proxy-for-the-vcf-services-runtime-via-the-fleet-lcm-api).

### 2.2 Bring-up spec

- **VCF Installer** — the deployment summary page has a **Download** for the spec
  it ran. This is the cleanest artifact — it *is* the fresh-bring-up input
  format.
- **SDDC Manager** — `curl -sk -H "Authorization: Bearer $TOKEN" https://<sddc-mgr>/v1/sddcs | jq .`
  then `GET /v1/sddcs/{id}`.

### 2.3 Domains and clusters

```bash
for d in $(curl -sk -H "Authorization: Bearer $TOKEN" https://<sddc-mgr>/v1/domains | jq -r '.elements[].id'); do
  curl -sk -H "Authorization: Bearer $TOKEN" https://<sddc-mgr>/v1/domains/$d \
    | jq 'del(.status,.tasks,.capacity,.isManagementDomain)' > domains/$d.json
done
```

Then cross-check each against the `POST /v1/domains` request schema in the API
Explorer (*Developer Center* on SDDC Manager) and drop anything not in it.

### 2.4 Fleet LCM component specs

```bash
# for EVERY VSP component, not just the first
for c in $(curl -sk -H "Authorization: Bearer $FLEET_JWT" https://<fleet-lcm>/fleet-lcm/v1/components \
            | jq -r '.[] | select(.componentType=="VSP") | .id'); do
  curl -sk -H "Authorization: Bearer $FLEET_JWT" https://<fleet-lcm>/fleet-lcm/v1/components/$c        > fleet/$c.json
  curl -sk -H "Authorization: Bearer $FLEET_JWT" https://<fleet-lcm>/fleet-lcm/v1/components/$c/config > fleet/$c.config.json
done
```

`tools/Get-VCFProxyConfig.ps1` already does the "read every `VSP`" loop — use it
as the reference for the auth chain.

### 2.5 Supervisor

- **UI export** is the re-importable form: *Workload Management → Supervisors →*
  Configure → **Export Configuration**. Do this per Supervisor.
- API form: `GET https://<vcenter>/api/vcenter/namespace-management/clusters/{cluster}` — reconstructable, not officially re-importable.

### 2.6 NSX policy hierarchy

Pull one tree per scope so the files are diffable and you can pick what to
template:

```bash
for scope in /infra/tier-0s /infra/tier-1s /infra/segments /infra/sites/default/enforcement-points/default/edge-clusters \
             /infra/domains/default/groups /infra/domains/default/gateway-policies /infra/services ; do
  name=$(echo $scope | tr '/' '-' | sed 's/^-//')
  curl -sk -u '<nsx-admin>' "https://<nsx>/policy/api/v1$scope" > nsx/infra-$name.json
done
# whole tree (large): GET /policy/api/v1/infra
```

Strip **realized/operational state** before templating — see
[§3](#3-sanitize-and-parameterise).

### 2.7 vCenter config profiles

```bash
curl -sk -H "vmware-api-session-id: $VC_SID" \
  "https://<vcenter>/api/esx/settings/clusters/<cluster>/configuration" > vcenter/cluster-<name>-config.json
```

---

## 3. Sanitize and parameterise

A captured spec is **customer data** until you clean it. Two passes:

### 3.1 Redact (always)

Replace the value — never delete the key, the shape matters:

| Match | Action |
| ----- | ------ |
| keys matching `*password*`, `*secret*`, `*privateKey*`, `*bearer*`, `*token*`, `bindPassword`, `sshPassword` | → `"__REDACTED__"` |
| license keys | → `XXXXX-XXXXX-XXXXX-XXXXX-<last 5>` |
| certificate PEM bodies, SSH public keys | → `"__REDACTED__"` |
| NSX `GET` output: `_create_time`, `_last_modified_*`, `_system_owned`, `_protection`, `_revision`, `realization_*`, `path` echoes | strip (operational, not spec) |

`jq` sketch:

```bash
jq 'walk(if type=="object"
         then with_entries(.value = (if (.key|test("password|secret|token|privateKey";"i")) then "__REDACTED__" else .value end))
         else . end)' in.json > redacted.json
```

### 3.2 Tokenise (optional, for a true template)

Replace per-environment values with placeholders and keep a **`token-map.json`**
so the template can be re-filled (or reversed):

| Value class | Token |
| ----------- | ----- |
| FQDNs | `{{FQDN_1}}`, `{{FQDN_2}}`, … |
| IPs / CIDRs | `{{IP_1}}` / `{{CIDR_1}}` |
| VLAN IDs, BGP ASNs | `{{VLAN_MGMT}}`, `{{ASN_EDGE}}` |
| datastore / pool / cluster / DC names | `{{DS_1}}`, `{{POOL_1}}`, … |
| SSL thumbprints | `{{THUMBPRINT_1}}` |

Keep **enum values, booleans and array shapes** intact — only the identifiers
change. Render a template back to a concrete spec by substituting the map (a
`jq --argjson map` pass, `envsubst`, or the Phase-2 script).

### 3.3 Manage them like code

One **baseline** template per artifact, a per-engagement **overlay**, `jq -S`
both before diffing. Version the templates — Broadcom shifts schemas between
minor releases (the same reason this repo pins the workbook revision), so a
template is only good until you re-validate it (§4).

---

## 4. Validate before reuse

Every layer has a dry-run — run it against the target *before* trusting a
template:

| Layer | Endpoint |
| ----- | -------- |
| VCF domains / clusters | `POST /v1/domains/validations`, `POST /v1/clusters/validations` |
| Bring-up | the VCF Installer's spec **Validate** step |
| Fleet LCM | `POST /fleet-lcm/v1/components/validations` |
| NSX | `PATCH /policy/api/v1/infra` against a **scratch** scope, or the GET schema |

> **The fake-UUID trick.** Submit the spec with **invented host / resource
> UUIDs**. `"host not found"` (or similar *resource*-not-found) means the
> **schema passed** — the request was well-formed and got as far as looking
> things up. `"Invalid input"` / a `400` on a field means the **schema is
> wrong** — fix the template. Always run a known-good control alongside.

---

## 5. Data hygiene

Per the **Customer data hygiene** section of `CLAUDE.md` (repo root):

- The **`.raw/`** capture (unsanitized) and any **filled** template are customer
  data → `C:/Users/paul/OneDrive - ITQ/<customer>/VCF9-Deployment/` (or the
  engagement's secure store), **never** this repo.
- `artifacts/` and `.raw/` are in `.gitignore`.
- **Sanitised + tokenised** templates (no real FQDNs/IPs/secrets, Rainpole-style
  placeholders only) *may* live in a template library — check them the same way
  you check a sample before committing.
- Re-check after any session that touched a real environment.

---

## 6. Limitations

- **No full vCenter / vSAN deployment JSON** — config profiles cover cluster
  desired state, not the appliance deployment. Use the VCF domain spec for that.
- **NSX GET returns realized state**, path echoes and revisions mixed with the
  spec — you must strip them (§3.1) or the `PATCH` back is rejected or noisy.
- **Reconstructed specs are not byte-identical** to the original `POST` body —
  always diff against the API Explorer schema and validate (§4).
- **Schema drift** — a template captured on `9.1.0` may not validate on a later
  patch. Re-validate per target build.
- **Secrets never come back** — `GET /v1/credentials` returns SDDC-Manager-stored
  plaintext, but VCF Operations password management has no reveal API
  ([`09` / memory](09-binary-depot.md)); plan to re-enter them at deploy time.

---

## 7. References

- **VCF / SDDC Manager API** — *Developer Center* / API Explorer on SDDC Manager;
  `POST /v1/tokens`, `GET /v1/domains|clusters|sddcs|network-pools|license-keys`.
- **Fleet LCM API** — `GET /fleet-lcm/v1/components/{id}` + `/config`; auth chain
  in [`09-binary-depot.md` §5](09-binary-depot.md#5-proxy-for-the-vcf-services-runtime-via-the-fleet-lcm-api).
- **NSX Policy API** — `GET` / `PATCH /policy/api/v1/infra` (Hierarchical API).
- **vSphere** — `GET /api/vcenter/…`, `GET /api/esx/settings/clusters/{id}/configuration` (Config Profiles).
- **PowerVCF** / **PowerValidatedSolutions** — PowerShell wrappers for the VCF
  GETs (`… | ConvertTo-Json`).
- **This repo** — `tools/Get-VCFBackupConfig.ps1` / `Get-VCFProxyConfig.ps1` /
  `Get-VCFCredentials.ps1` (the read-only Fleet LCM pattern to extend).
- **Sister repos** — **VCFJsonSpecCreators** and **VCF.JSONGenerator** (Ken
  Gould) — they *generate* the deploy JSON; use them as the canonical target
  shape when reconstructing.
- **Broadcom P&P workbook** — the *Management Domain As Built* / *Workload Domain
  As Built* sheets are the manual equivalent of this page.
