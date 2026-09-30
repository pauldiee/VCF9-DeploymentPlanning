# Dutch translations (pilot)

Dutch (`nl`) versions of the docs in the parent folder. **English is the
canonical text**; a file here is a translation that tracks its English source.
This is a pilot (issue #290): one doc, to see what the translation and its
upkeep cost before committing to more.

| Dutch file | English source | Translated | Human review |
| ---------- | -------------- | ---------- | ------------ |
| [`11-esx-coredump.md`](11-esx-coredump.md) | [`../11-esx-coredump.md`](../11-esx-coredump.md) | 2026-09-30, machine first pass | **Waiting** |

## Review queue

Every translation is a machine first pass until a Dutch-speaking VCF
practitioner has read it. The reviewer is **Paul van Dieen**, with limited
time, so the queue is kept short on purpose: **no new translation is added
while more than two are waiting for review.**

A file is waiting while its frontmatter says `reviewed: "no"`. The build lists
the queue on every run (`REVIEW   1 awaiting human review: …`). When a file has
been reviewed:

1. Set `reviewed:` to the review date, e.g. `reviewed: "2026-10-14"`.
2. Remove the "machinevertaling, nog niet nagekeken" note at the top of the
   file (keep the pointer to the English version).
3. Update the table above.

A reviewed file that later goes stale and is re-translated goes back to
`reviewed: "no"`.

On the site a Dutch doc is served at `/nl/docs/<slug>/`, and the language
toggle in the header switches between the two versions of a page.

## How a translation stays in sync

Every file here starts with frontmatter that records what it was translated
from:

```yaml
---
lang: nl
source: ../11-esx-coredump.md
source_hash: "0123456789abcdef"   # hash of the English file at translation time
synced: "2026-09-30"              # date of that translation
reviewed: "no"                    # "no", or the date a person reviewed it
---
```

When the English file changes, its hash no longer matches. The site then shows
a "this translation may be out of date" banner on the Dutch page, and the
build prints a warning. To clear it:

1. Bring the Dutch file in line with the English change.
2. Record the new hash: from `web/`, run
   `node scripts/check-nl-sync.mjs --stamp 11-esx-coredump`.

`node scripts/check-nl-sync.mjs` on its own reports which files are stale. It
only warns during the pilot; `--strict` makes it fail.

## Writing rules

- **Links.** A doc that is not translated is linked as `../<file>.md` (the
  English one). A doc that is translated is linked as `<file>.md`. In-page
  anchors follow the **Dutch** headings.
- **Em-dashes are fine**, as in the English docs.
- **Address the reader as "je".**

## Do not translate

- **Product and component names:** VMware Cloud Foundation (VCF), vSphere, ESX,
  vCenter, NSX, vSAN, SDDC Manager, VCF Operations, VCF Automation, VCF
  Installer, Supervisor, VKS, Avi Load Balancer, Service Engine, License Hub,
  License Server, vDefend, SSP, Fleet LCM, Identity Broker, Log Management,
  Dump Collector.
- **Technical terms used as names:** workload domain, management domain,
  bring-up, commissioning, fleet, Tier-0 / Tier-1, Transit Gateway, VPC, TEP,
  vmkernel, PSOD, coredump, depot.
- **Anything a reader types or sees on screen:** commands, parameters, file
  paths, code and YAML/JSON, and **menu paths and button labels quoted from the
  products** (the product UIs are English, so `Actions → Start` stays as is).
- **Evidence labels:** `[field-verified]`, `[lab-verified]`, `[field-reported]`.
- **Quotes from Broadcom documentation**, which stay in the original English.
