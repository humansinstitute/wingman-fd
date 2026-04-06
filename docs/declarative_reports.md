# Design: Declarative Reports for Flight Deck

**Status:** Draft
**Date:** 2026-03-25

---

## Goal

Add a new Flight Deck record family, `report`, for agent-generated dashboard content.

The intent is:

- an agent produces a report payload
- the payload is written as a normal Flight Deck record under the app namespace
- Tower syncs it generically like any other family
- Flight Deck and Yoke both materialize the same payload shape locally
- Flight Deck interprets the declarative payload and renders it on the dashboard

This is not a free-form widget system. The payload is declarative and constrained so the UI can safely and predictably render known report types.

## Non-Goals

- arbitrary HTML or CSS from agents
- arbitrary component trees
- unbounded chart grammar in v1
- layout authored entirely by the agent

## Record Family

The new family is:

- family id: `report`
- family hash: `<FLIGHT_DECK_APP_NPUB>:report`
- collection space: `report`

It should be published alongside the existing Flight Deck manifests in `../sb-publisher/schemas/flightdeck/report-v1.json`.

Tower should treat this the same as the other record families. Per the current architecture, Tower remains generic and stores encrypted opaque payloads plus generic metadata; Flight Deck and Yoke own translation and rendering.

## Transport Shape

The encrypted owner payload should use a clean declarative structure:

```json
{
  "app_namespace": "<flight-deck-app-npub>",
  "collection_space": "report",
  "schema_version": 1,
  "record_id": "report-daily-users",
  "metadata": {
    "title": "Daily Users",
    "generated_at": "2026-03-25T06:10:00Z",
    "record_state": "active",
    "surface": "flightdeck",
    "scope": {
      "id": "scope-123",
      "level": "project",
      "product_id": "product-1",
      "project_id": "project-1",
      "deliverable_id": null
    }
  },
  "data": {
    "declaration_type": "metric",
    "payload": {
      "label": "User Visits",
      "value": 50,
      "unit": "per day"
    }
  }
}
```

## Payload Contract

The report family is structured as:

- record family
- `metadata`
- `data`
- `data.declaration_type`
- `data.payload`

Interpretation rules:

- `metadata` contains cross-cutting information used for sync, filtering, sorting, and placement decisions
- `data.declaration_type` tells the client how to interpret `data.payload`
- `data.payload` contains the actual report declaration for that type

## Metadata Contract

Recommended v1 metadata fields:

- `title`: display title for the report card
- `generated_at`: ISO timestamp for when the report was produced
- `record_state`: `active` or `deleted`
- `surface`: where this report is intended to appear
- `scope`: object representing the associated scope

Recommended metadata shape:

```json
{
  "title": "Daily Users",
  "generated_at": "2026-03-25T06:10:00Z",
  "record_state": "active",
  "surface": "flightdeck",
  "scope": {
    "id": "scope-123",
    "level": "project",
    "product_id": "product-1",
    "project_id": "project-1",
    "deliverable_id": null
  }
}
```

### Notes on Scope

For transport, `scope` should be a nested object.

For local materialization in Flight Deck and Yoke, translators should flatten this into indexed fields such as:

- `scope_id`
- `scope_product_id`
- `scope_project_id`
- `scope_deliverable_id`

This preserves a clean wire format while keeping local filtering fast and aligned with the rest of the app.

## Declaration Types

V1 should start with a small fixed set:

- `metric`
- `timeseries`
- `table`
- `text`

Additional declaration types can be added in later schema versions.

## Common UI Rules

All report renderers should:

- use `metadata.title` as the card title unless a specialized renderer explicitly hides it
- display a generated timestamp where useful
- ignore unknown optional fields
- fail closed for unknown declaration types
- never execute HTML from the payload
- never apply arbitrary CSS from the payload

If a payload is invalid for its `declaration_type`, the UI should render a compact fallback state:

- title
- "Unsupported report payload"
- generated timestamp if available

## Metric

### Purpose

Render a single headline number or KPI.

### Example payload

```json
{
  "data": {
    "declaration_type": "metric",
    "payload": {
      "label": "Daily Users",
      "value": 50,
      "unit": "per day",
      "trend": {
        "direction": "up",
        "value": 12,
        "label": "vs last week"
      }
    }
  }
}
```

### Example schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["label", "value"],
  "properties": {
    "label": { "type": "string" },
    "value": {
      "oneOf": [
        { "type": "number" },
        { "type": "string" }
      ]
    },
    "unit": { "type": ["string", "null"] },
    "trend": {
      "type": "object",
      "additionalProperties": false,
      "required": ["direction", "value"],
      "properties": {
        "direction": {
          "type": "string",
          "enum": ["up", "down", "flat"]
        },
        "value": { "type": ["number", "string"] },
        "label": { "type": ["string", "null"] }
      }
    }
  }
}
```

### UI interpretation

Flight Deck should render:

- large value
- smaller label
- optional unit
- optional trend row

Renderer guidance:

- use a square or compact card treatment
- prioritize legibility of `value`
- if `value` is numeric, format for locale
- if `trend` exists, show directional treatment using UI-owned styling, not payload-owned styling

## Timeseries

### Purpose

Render a line or bar chart over time.

### Example payload

```json
{
  "data": {
    "declaration_type": "timeseries",
    "payload": {
      "x_label": "Day",
      "y_label": "Users",
      "series": [
        {
          "key": "daily_users",
          "label": "Daily Users",
          "points": [
            { "x": "2026-03-05", "y": 43 },
            { "x": "2026-03-06", "y": 47 },
            { "x": "2026-03-07", "y": 45 }
          ]
        }
      ]
    }
  }
}
```

### Example schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["series"],
  "properties": {
    "x_label": { "type": ["string", "null"] },
    "y_label": { "type": ["string", "null"] },
    "series": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["key", "label", "points"],
        "properties": {
          "key": { "type": "string" },
          "label": { "type": "string" },
          "points": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["x", "y"],
              "properties": {
                "x": { "type": ["string", "number"] },
                "y": { "type": ["number", "null"] }
              }
            }
          }
        }
      }
    }
  }
}
```

### UI interpretation

Flight Deck should render:

- chart area
- title from `metadata.title`
- optional axis labels
- optional legend when more than one series exists

Renderer guidance:

- line chart is the default v1 interpretation
- null `y` values should create gaps, not zero-fill
- dates should be treated as ordered labels unless the renderer has explicit date-scale support
- series colors should come from the app theme, not from payload values

## Table

### Purpose

Render compact tabular summaries such as rankings, rollups, or grouped metrics.

### Example payload

```json
{
  "data": {
    "declaration_type": "table",
    "payload": {
      "columns": [
        { "key": "date", "label": "Date" },
        { "key": "users", "label": "Users" },
        { "key": "change", "label": "Change" }
      ],
      "rows": [
        { "date": "2026-03-23", "users": 45, "change": "+2" },
        { "date": "2026-03-24", "users": 47, "change": "+2" },
        { "date": "2026-03-25", "users": 50, "change": "+3" }
      ]
    }
  }
}
```

### Example schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["columns", "rows"],
  "properties": {
    "columns": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["key", "label"],
        "properties": {
          "key": { "type": "string" },
          "label": { "type": "string" },
          "align": {
            "type": "string",
            "enum": ["left", "center", "right"]
          }
        }
      }
    },
    "rows": {
      "type": "array",
      "items": {
        "type": "object"
      }
    }
  }
}
```

### UI interpretation

Flight Deck should render:

- table header from `columns`
- rows using matching column keys
- localized formatting for numbers where appropriate

Renderer guidance:

- missing row values render as empty cells
- unknown extra row keys are ignored
- tables should default to horizontal scrolling on narrow widths
- alignment comes from the limited `align` enum only

## Text

### Purpose

Render a short narrative summary or agent-produced commentary block.

### Example payload

```json
{
  "data": {
    "declaration_type": "text",
    "payload": {
      "body": "Daily users increased 12% week over week. The strongest growth came from returning users on Monday and Tuesday.",
      "tone": "neutral"
    }
  }
}
```

### Example schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["body"],
  "properties": {
    "body": { "type": "string" },
    "tone": {
      "type": "string",
      "enum": ["neutral", "positive", "warning", "critical"]
    }
  }
}
```

### UI interpretation

Flight Deck should render:

- title from `metadata.title`
- short text body

Renderer guidance:

- render as plain text or tightly controlled markdown subset if markdown is later approved
- `tone` may affect accent treatment, but only through app-defined styles
- do not render arbitrary HTML

## Proposed Full Report Schema Shape

This is the recommended top-level schema direction for `report-v1.json`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["app_namespace", "collection_space", "schema_version", "record_id", "metadata", "data"],
  "properties": {
    "app_namespace": { "type": "string" },
    "collection_space": { "const": "report" },
    "schema_version": { "const": 1 },
    "record_id": { "type": "string" },
    "metadata": {
      "type": "object",
      "additionalProperties": false,
      "required": ["title", "generated_at", "record_state"],
      "properties": {
        "title": { "type": "string" },
        "generated_at": { "type": "string" },
        "record_state": { "type": "string" },
        "surface": { "type": ["string", "null"] },
        "scope": {
          "type": ["object", "null"],
          "additionalProperties": false,
          "properties": {
            "id": { "type": ["string", "null"] },
            "level": { "type": ["string", "null"] },
            "product_id": { "type": ["string", "null"] },
            "project_id": { "type": ["string", "null"] },
            "deliverable_id": { "type": ["string", "null"] }
          }
        }
      }
    },
    "data": {
      "type": "object",
      "additionalProperties": false,
      "required": ["declaration_type", "payload"],
      "properties": {
        "declaration_type": {
          "type": "string",
          "enum": ["metric", "timeseries", "table", "text"]
        },
        "payload": { "type": "object" }
      }
    }
  }
}
```

In the published manifest, `data.payload` should be constrained using conditional schema branches keyed by `data.declaration_type`.

## Materialized Local Row

The transport payload should stay nested and declarative. The local materialized row can be flatter.

Suggested local row shape:

```json
{
  "record_id": "report-daily-users",
  "owner_npub": "npub...",
  "title": "Daily Users",
  "declaration_type": "metric",
  "generated_at": "2026-03-25T06:10:00Z",
  "surface": "flightdeck",
  "scope_id": "scope-123",
  "scope_product_id": "product-1",
  "scope_project_id": "project-1",
  "scope_deliverable_id": null,
  "payload": {
    "label": "User Visits",
    "value": 50,
    "unit": "per day"
  },
  "record_state": "active",
  "updated_at": "2026-03-25T06:10:02Z"
}
```

## Renderer Selection

Flight Deck should use a strict renderer map:

- `metric` -> metric card renderer
- `timeseries` -> timeseries renderer
- `table` -> table renderer
- `text` -> text summary renderer

Unknown types should not crash the dashboard. They should render a minimal unsupported state and log a client warning.

## Dashboard Placement

V1 recommendation:

- only render reports where `metadata.surface === "flightdeck"` or `surface` is absent and the product chooses Flight Deck as the default surface
- filter reports by active scope using the materialized scope fields
- sort by `generated_at` descending unless an explicit ordering model is added later

If placement becomes important later, add a constrained metadata field such as `region` with a small enum. Do not add free-form layout instructions in v1.

## Agent Authoring Guidelines

Agents producing reports should:

- choose one supported `declaration_type`
- produce schema-valid payloads only
- keep titles and labels human-readable
- keep units explicit where needed
- update stable `record_id`s for recurring reports instead of creating duplicates
- avoid embedding presentational rules in the payload beyond the approved declarative fields

## Rollout Plan

1. Publish `report-v1.json` in `sb-publisher`
2. Add a `report` translator in Flight Deck
3. Add the `reports` Dexie table and sync family wiring
4. Add report translation and writing in Yoke
5. Add Flight Deck renderers for the v1 declaration types
6. Surface report cards on the Flight Deck page

## Open Questions

- Should `surface` be a required enum or optional?
- Do recurring reports use stable IDs by convention or through an explicit `report_key` field?
- Should `timeseries` support multiple renderer variants in v1, or always default to line charts?
- Should `text` allow a markdown subset, or remain plain text only?
