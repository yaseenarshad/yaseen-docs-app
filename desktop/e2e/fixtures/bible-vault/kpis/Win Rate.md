---
page_type: kpi
funnel_stages: ["[[Sales-Conversion]]"]
kpi_category: lagging
unit: percent
---

# Win Rate

Closed-won as a share of closed pipeline. The headline number for [[Sales-Conversion]].

## Problems impacting this KPI

```base
filters:
  and:
    - page_type == "problem"
    - file.hasLink(this)
views:
  - type: table
    name: Impacting problems
    order:
      - file.name
      - sku_tag
    sort:
      - property: file.name
        direction: ASC
```
