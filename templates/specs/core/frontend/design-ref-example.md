---
domain: frontend
specId: SPEC:fe-design-001
name: Example Design Reference Spec
tags: [ui, design, frontend]
design_refs:
  - path: designs/homepage.png
    label: Homepage — desktop layout
    scope: src/app/page**
    fidelity: exact
  - path: designs/homepage-mobile.png
    label: Homepage — mobile breakpoint (375px)
    scope: src/app/page**
    fidelity: structural
  - path: designs/component-library.html
    label: Component library HTML prototype
    scope: src/components/**
    fidelity: reference
rules:
  - type: grep_must_exist
    pattern: "data-testid="
    files: "src/components/**/*.tsx"
    message: "All interactive components must have data-testid attributes for testing"
---

# Example Design Reference Spec

This is a starter template for specs with design references. Design references allow agents to read mockups, wireframes, and prototypes before implementing UI components.

## Design files

Place your design files in a `designs/` directory at the project root. Supported formats:
- **Images** (PNG, JPG, WebP) — Claude reads the image visually
- **HTML/CSS prototypes** — Claude reads the markup and understands structure
- **SVG files** — Claude reads as XML for structure and layout

## Fidelity levels

| Level | Meaning |
|-------|---------|
| `exact` | Pixel-perfect match required — layout, colors, spacing |
| `structural` | Same layout hierarchy and sections, flexible styling |
| `reference` | Inspiration only — key concepts and patterns |

## Usage

When an agent calls `spec_fetch` on this spec, it will also receive the design file content injected automatically.
