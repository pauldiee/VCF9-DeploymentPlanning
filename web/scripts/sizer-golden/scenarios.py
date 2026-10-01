# Generates golden-test scenarios for the sizing engine (see Get-SizerGolden.ps1).
# Written against workbook v1.9.1.102 (VCF 9.1.1).
# Each scenario is a dict of workbook cell -> value on 'Management Domain Sizing'.
# Cells not listed keep the workbook's saved defaults (baseline below), which
# Get-SizerGolden.ps1 resets before every scenario.
import json, itertools, os

BASE = {
    'E8': 30, 'E9': 10, 'E13': 128, 'E14': 1024, 'E15': 1, 'E16': 1, 'R13': 'vSAN-ESA',
    'E20': 'First Instance', 'E21': 'High Availability', 'E22': 'Small',
    'E25': 'Exclude', 'E26': 'Exclude', 'E27': 'Exclude', 'E28': 'Exclude', 'E29': 'Exclude',
    'E31': 'Exclude', 'E32': 'Exclude', 'E33': 'Exclude', 'E34': 'Exclude', 'E35': 'Exclude', 'E36': 'Exclude',
    'R24': 'Unselected',
    'L40': 'Excluded', 'O40': 'Excluded', 'P40': 'Medium', 'Q40': 'Excluded', 'S40': 'Excluded', 'W40': 'Excluded',
    'B82': 'Exclude', 'B83': 'Exclude',
}
# workload-domain row 44.. defaults (Excluded)
for i in range(35):
    r = 44 + i
    BASE.update({f'C{r}': 'Excluded', f'D{r}': 'Medium', f'F{r}': 'Default', f'H{r}': 'Dedicated - HA Cluster',
                 f'I{r}': 'Large', f'L{r}': 'Excluded', f'M{r}': 'Medium', f'R{r}': 'Exclude',
                 f'U{r}': 'Excluded', f'X{r}': 'Excluded'})

PROFILES = [('Simple', 'Small'), ('High Availability', 'Small'), ('High Availability', 'Medium'), ('High Availability', 'Large')]
S = []
def add(name, **cells):
    S.append({'name': name, 'cells': cells})

# 1. bare profiles, both instance models
for inst in ('First Instance', 'Additional Instance'):
    for m, z in PROFILES:
        add(f'bare {inst} {m} {z}', E20=inst, E21=m, E22=z)
# 2. typical fleet: Ops + collector + VCFA
for m, z in PROFILES:
    add(f'fleet {m} {z}', E21=m, E22=z, E31='Include', E33='Include', E34='Include')
    add(f'fleet ops-only {m} {z}', E21=m, E22=z, E31='Include')
    add(f'fleet collector-only {m} {z}', E21=m, E22=z, E33='Include')
# 3. Log Management sizes x replicas, RTM, both
for m, z in PROFILES:
    for ls, reps in (('Small', 1), ('Small', 3), ('Medium', 3), ('Medium', 5), ('Large', 6), ('Large', 9)):
        add(f'logs {ls}x{reps} {m} {z}', E21=m, E22=z, E25=ls, E26=reps)
    add(f'rtm {m} {z}', E21=m, E22=z, E27='Include')
    add(f'logs+rtm {m} {z}', E21=m, E22=z, E25='Medium', E26=3, E27='Include')
    add(f'logs+rtm+fleet {m} {z}', E21=m, E22=z, E25='Small', E26=3, E27='Include', E31='Include', E33='Include', E34='Include')
# 4. additional instance services
for m, z in PROFILES:
    add(f'addl sd {m} {z}', E20='Additional Instance', E21=m, E22=z, E28='Include')
    add(f'addl idb {m} {z}', E20='Additional Instance', E21=m, E22=z, E29='Include')
    add(f'addl sd+idb+logs+rtm {m} {z}', E20='Additional Instance', E21=m, E22=z, E28='Include', E29='Include', E25='Small', E26=2, E27='Include')
# 5. NSX edges / VNA / supervisor / GM / Avi / SSP / License Hub / OpsNet
for e in ('NSX Edge Small', 'NSX Edge Medium', 'NSX Edge Large', 'NSX Edge XLarge', 'VNA Small', 'VNA Large', 'VNA XLarge'):
    add(f'edge {e}', L40=e)
for mode, size in (('Single Node', 'Tiny'), ('Single Node', 'Medium'), ('High Availability', 'Small'), ('High Availability', 'Xlarge')):
    add(f'supervisor {mode} {size}', O40=mode, P40=size)
for g in ('Small', 'Medium', 'XLarge'):
    add(f'gm {g}', Q40=g)
for a in ('Small', 'Large', 'X-Large'):
    add(f'avi {a}', S40=a)
for m, z in PROFILES:
    add(f'ssp {m} {z}', E21=m, E22=z, W40='Include')
add('license hub', E36='Include')
for n in ('Small', 'Medium', 'Large', 'XL', 'XXL'):
    add(f'opsnet {n}', E35=n)
    add(f'opsnet {n} additional', E20='Additional Instance', E35=n)
# 6. workload domains
add('wld 1 dedicated HA', C44='Included', D44='Medium', F44='Default', H44='Dedicated - HA Cluster', I44='Large')
add('wld 2 mixed', C44='Included', D44='Small', F44='Large', H44='Dedicated - Single Node', I44='Medium',
    C45='Included', D45='Large', F45='XLarge', H45='Shared', I45='Large')
add('wld gm + avi + ssp', C44='Included', D44='Medium', H44='Dedicated - HA Cluster', I44='Large', L44='Active GM', M44='Medium',
    U44='Large', X44='Include')
add('wld 6 ssp (installer every 5)', **{k: v for i in range(6) for k, v in
    ((f'C{44+i}', 'Included'), (f'H{44+i}', 'Dedicated - HA Cluster'), (f'I{44+i}', 'Medium'), (f'X{44+i}', 'Include'))})
add('mgmt ssp + wld ssp', W40='Include', C44='Included', H44='Dedicated - HA Cluster', I44='Large', X44='Include')
# 7. protection
add('spr mgmt only', B82='Management Only')
add('spr mgmt+wld', B82='Management & Workload', C44='Included', R44='Include', C45='Included', R45='Include')
add('spr wld only', B82='Workload Only', C44='Included', R44='Include')
add('rwr', B83='Include')
add('spr+rwr', B82='Management & Workload', B83='Include', C44='Included', R44='Include')
# 8. storage types + host params
for st in ('vSAN-ESA', 'vSAN-OSA', 'NFS', 'FC'):
    for m, z in (('Simple', 'Small'), ('High Availability', 'Large')):
        add(f'storage {st} {m} {z}', R13=st, E21=m, E22=z, E31='Include', E33='Include')
add('oversub 2/1.5 small hosts', E13=32, E14=256, E15=2, E16=1.5, E31='Include', E34='Include')
add('reserve 50 growth 25', E8=50, E9=25, E31='Include')
# 9. existing ops / vcfa
add('ops existing', E31='Existing', E33='Include')
add('vcfa existing', E34='Existing')
add('ops ca', E31='Include', E32='Include')
# 10. kitchen sink
for m, z in PROFILES:
    add(f'kitchen sink {m} {z}', E21=m, E22=z, E25='Medium' if z != 'Small' else 'Small', E26=3, E27='Include',
        E31='Include', E33='Include', E34='Include', E35='Medium', E36='Include', L40='NSX Edge Large', O40='High Availability',
        P40='Medium', S40='Large', W40='Include', B82='Management Only', B83='Include',
        C44='Included', D44='Medium', H44='Dedicated - HA Cluster', I44='Large', U44='Small')

here = os.path.dirname(os.path.abspath(__file__))
json.dump({'base': BASE, 'scenarios': S}, open(os.path.join(here, 'scenarios.json'), 'w'), indent=0)
print(len(S), 'scenarios')
