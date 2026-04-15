---
domain: frontend
name: styling
updated: 2025-01-01
confidence: 0.85
tags: [css, tailwind, styling, responsive, accessibility]
---
# Styling Standards

## Rule: Use utility-first CSS with consistent spacing scale

Prefer Tailwind CSS utility classes. Use the design system spacing scale consistently (4px base unit: `p-1`=4px, `p-2`=8px, `p-4`=16px).

```tsx
// ✅ Correct: utility classes, consistent spacing
<div className="flex flex-col gap-4 p-6 rounded-lg shadow-sm border border-gray-200">
  <h2 className="text-xl font-semibold text-gray-900">Title</h2>
  <p className="text-sm text-gray-600">Description</p>
</div>
```

```tsx
// ❌ Anti-pattern: inline styles, arbitrary values
<div style={{ padding: '23px', borderRadius: '7px' }}>
  <h2 style={{ fontSize: '19px', fontWeight: 600 }}>Title</h2>
</div>
```

---

## Rule: Mobile-first responsive design

Always write mobile-first styles. Add breakpoints for larger screens, never the reverse.

```tsx
// ✅ Correct: mobile-first
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
```

```tsx
// ❌ Anti-pattern: desktop-first
<div className="grid grid-cols-3 max-md:grid-cols-2 max-sm:grid-cols-1 gap-4">
```

---

## Rule: Always include focus styles for keyboard accessibility

Every interactive element must have a visible focus ring. Never use `outline-none` without a custom focus style.

```tsx
// ✅ Correct
<button className="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
  Click me
</button>
```

```tsx
// ❌ Anti-pattern: removes focus ring with no replacement
<button className="outline-none focus:outline-none">Click me</button>
```

---

## Rule: Use semantic HTML elements

Always use the most semantically appropriate HTML element. This improves accessibility and SEO.

- Navigation: `<nav>` not `<div className="nav">`
- Buttons: `<button>` not `<div onClick>`
- Article content: `<article>`, `<section>`, `<aside>`
- Form fields: `<label for>` paired with `<input id>`
