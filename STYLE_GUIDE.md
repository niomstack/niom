# NIOM Style Guide

> HUD-inspired design system built on **Tailwind CSS v4** + **shadcn/ui**.  
> Zero custom CSS classes — everything is Tailwind utilities + design tokens.

---

## Core Principles

1. **Tailwind-only** — No custom CSS classes. All styling happens via Tailwind utilities in component TSX files.
2. **Token-driven** — Colors come from CSS variables defined in `src/index.css`. Components use semantic tokens (`bg-background`, `text-primary`, `border-border`) not raw values.
3. **shadcn as base** — Install components via `npx shadcn@latest add <component>`, then modify their Tailwind classes to match HUD guidelines.
4. **Dark-first** — Dark mode is the primary experience. Light mode is the secondary, clean fallback.
5. **Full-strength readability** — Never use opacity modifiers on text or borders (no `text-foreground/50`, no `border-border/30`). The base tokens are already calibrated for proper hierarchy. Stacking opacity makes things invisible.

---

## Color Palette

All colors use **oklch** for perceptual uniformity.

### Brand Colors

| Role            | Dark Mode                                 | Light Mode                         | Usage                                 |
| --------------- | ----------------------------------------- | ---------------------------------- | ------------------------------------- |
| **Primary**     | Soft violet-indigo `oklch(0.74 0.14 290)` | Deep violet `oklch(0.55 0.16 290)` | Buttons, links, active states, glows  |
| **Accent**      | Warm peach `oklch(0.75 0.10 55)`          | Deep peach `oklch(0.60 0.12 55)`   | Highlights, secondary emphasis        |
| **Destructive** | Soft red `oklch(0.65 0.18 15)`            | Deep red `oklch(0.55 0.18 15)`     | Errors, warnings, destructive actions |

### Surfaces

| Token        | Dark Mode                                  | Light Mode                          | Notes                                   |
| ------------ | ------------------------------------------ | ----------------------------------- | --------------------------------------- |
| `background` | Warm dark charcoal `oklch(0.14 0.012 285)` | Warm white `oklch(0.98 0.004 290)`  | Violet-tinted, not pure black/white     |
| `card`       | Lifted charcoal `oklch(0.18 0.015 285)`    | Near-white `oklch(0.995 0.002 290)` | Use solid `bg-card` — no opacity needed |
| `secondary`  | Dark surface `oklch(0.22 0.015 285)`       | Light grey `oklch(0.94 0.008 290)`  | Subtle backgrounds                      |
| `muted`      | Dim surface `oklch(0.24 0.01 285)`         | Soft grey `oklch(0.93 0.006 290)`   | Disabled states, subtle fills           |

### Text

| Token              | Dark Mode                              | Light Mode                           | Notes                                              |
| ------------------ | -------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| `foreground`       | Warm off-white `oklch(0.93 0.008 280)` | Deep charcoal `oklch(0.20 0.02 285)` | Primary text — always use at full strength         |
| `muted-foreground` | Readable grey `oklch(0.65 0.012 285)`  | Mid grey `oklch(0.46 0.015 285)`     | Secondary text — already dim, never add `/50` etc. |

### Borders

| Token    | Dark Mode                           | Light Mode                              | Notes                                         |
| -------- | ----------------------------------- | --------------------------------------- | --------------------------------------------- |
| `border` | Violet-grey `oklch(0.34 0.012 285)` | Light warm grey `oklch(0.90 0.006 290)` | Use `border-border` at full strength — no `/` |
| `input`  | Dark input `oklch(0.26 0.015 285)`  | Light input `oklch(0.91 0.005 290)`     | Input bg slightly darker than card            |
| `ring`   | Matches primary violet              | Matches primary violet                  |                                               |

### Chart Colors (Data Visualization)

| Token     | Dark   | Light  | Hue |
| --------- | ------ | ------ | --- |
| `chart-1` | Violet | Violet | 290 |
| `chart-2` | Peach  | Peach  | 55  |
| `chart-3` | Mint   | Mint   | 170 |
| `chart-4` | Blue   | Blue   | 230 |
| `chart-5` | Rose   | Rose   | 350 |

---

## Typography

### Font Families

| Token       | Font           | Usage                                                  |
| ----------- | -------------- | ------------------------------------------------------ |
| `font-sans` | Inter          | Body text, headings, UI labels                         |
| `font-mono` | JetBrains Mono | Data readouts, status text, badges, code, input values |

Loaded via Google Fonts in `src/index.html`.

### HUD Text Patterns

Use these Tailwind class combinations for the HUD aesthetic:

```
Section headers:  font-mono text-xs uppercase tracking-widest text-muted-foreground
Status readouts:  font-mono text-xs text-primary
Data values:      font-mono (applied to specific spans)
Body text:        Default (font-sans, no extra classes)
```

---

## ⚠️ Opacity Rules (Critical)

These rules exist because we learned the hard way that stacking opacity on already-dim tokens makes everything invisible.

| Element          | Rule                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| **Text**         | Always full-strength: `text-foreground`, `text-muted-foreground`, `text-primary`           |
| **Borders**      | Always full-strength: `border-border`, `border-primary`                                    |
| **Glow shadows** | Opacity is fine here — these are decorative: `shadow-[0_0_12px_oklch(0.74_0.14_290/0.25)]` |
| **Backgrounds**  | Mild opacity OK for glassmorphism only: `bg-card/80`, never below `/80`                    |
| **Hover states** | `hover:bg-primary/10` is fine — these are overlays, not readable content                   |

**Never do**: `text-muted-foreground/50`, `border-border/30`, `text-foreground/60`  
**Always do**: `text-muted-foreground`, `border-border`, `text-foreground`

---

## Component Styling Guidelines

When installing new shadcn components, apply these modifications:

### Buttons (`button.tsx`)

- **Base**: `text-xs font-medium uppercase tracking-wider transition-all duration-200`
- **Default variant (dark)**: Add violet glow → `shadow-[0_0_12px_oklch(0.74_0.14_290/0.25)]`, intensify on hover → `hover:shadow-[0_0_20px_oklch(0.74_0.14_290/0.4)]`
- **Outline variant (dark)**: Frosted glass → `dark:border-primary dark:bg-card dark:backdrop-blur-sm`, hover glow → `dark:hover:border-primary dark:hover:bg-primary/10 dark:hover:shadow-[0_0_15px_oklch(0.74_0.14_290/0.15)]`
- **Ghost variant (dark)**: Subtle primary tint on hover → `dark:hover:bg-primary/10`
- **Secondary variant (dark)**: Add border → `dark:border dark:border-border`

### Cards (`card.tsx`)

- **Base**: Add `transition-all duration-300`
- **Dark mode**: Solid card bg → `dark:bg-card dark:ring-border dark:backdrop-blur-md`
- **Dark glow**: `dark:shadow-[0_0_1px_oklch(0.74_0.14_290/0.15),0_4px_24px_oklch(0_0_0/0.3)]`
- **Dark hover**: Border brightens → `dark:hover:ring-primary`, glow intensifies → `dark:hover:shadow-[0_0_1px_oklch(0.74_0.14_290/0.25),0_0_15px_oklch(0.74_0.14_290/0.08),0_8px_32px_oklch(0_0_0/0.35)]`

### Badges (`badge.tsx`)

- **Base**: `font-mono text-[0.65rem] font-medium uppercase tracking-widest`
- **Default (dark)**: Primary tinted → `dark:bg-primary/15 dark:text-primary dark:border-primary`
- **Outline (dark)**: Primary border → `dark:border-primary dark:text-primary`
- **Secondary (dark)**: Add border → `dark:border-border`

### Inputs (`input.tsx`)

- **Base**: `transition-all duration-200` (replace `transition-colors`)
- **Dark mode**: Solid card bg → `dark:bg-card dark:backdrop-blur-sm`
- **Dark focus**: Violet glow → `dark:focus-visible:border-primary dark:focus-visible:shadow-[0_0_0_2px_oklch(0.74_0.14_290/0.15),0_0_15px_oklch(0.74_0.14_290/0.1)]`

### Separators (`separator.tsx`)

- **Dark mode**: Gradient fade → `dark:bg-transparent dark:data-horizontal:bg-gradient-to-r dark:data-horizontal:from-transparent dark:data-horizontal:via-primary/30 dark:data-horizontal:to-transparent`

### General Rules for New Components

1. Replace `transition-colors` with `transition-all duration-200` (or `duration-300` for larger elements)
2. Use `bg-card` solid for surfaces. Only use opacity (`bg-card/80`) when intentional glassmorphism is needed over content — never below `/80`
3. Add `dark:backdrop-blur-md` to panel-like components (cards, popovers, dropdowns, dialogs)
4. Use `border-border` or `border-primary` at full strength — never `/20` or `/30`
5. Add hover glow via `dark:hover:shadow-[0_0_15px_oklch(0.74_0.14_290/0.15)]` on interactive surfaces
6. Never use raw color values in components — always use tokens (`text-primary`, `bg-muted`, etc.)
7. Text must always be readable — use `text-foreground`, `text-muted-foreground`, or `text-primary` at full strength

---

## Common UI Patterns (Tailwind only)

### Status Indicator Dot (pulsing glow)

```tsx
// Nominal (violet) — primary
<div className="size-1.5 rounded-full bg-primary shadow-[0_0_6px_oklch(0.74_0.14_290)] animate-pulse" />

// Warning (mint) — uses chart-3
<div className="size-1.5 rounded-full bg-chart-3 shadow-[0_0_6px_oklch(0.76_0.13_170)] animate-pulse" />

// Error (red) — uses destructive
<div className="size-1.5 rounded-full bg-destructive shadow-[0_0_6px_oklch(0.65_0.18_15)] animate-pulse" />
```

### Section Header

```tsx
<h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
  Section Title
</h2>
```

### Panel (solid surface, no custom class)

```tsx
<div className="rounded-xl border border-border bg-card p-4 dark:backdrop-blur-md">
  {/* content */}
</div>
```

### Data Row

```tsx
<div className="flex justify-between text-xs">
  <span className="text-muted-foreground">Label</span>
  <span className="font-mono">Value</span>
</div>
```

---

## File Structure

```
src/
├── index.css              ← Design tokens ONLY (colors, fonts, radii)
├── index.html             ← Google Fonts (Inter + JetBrains Mono)
├── lib/utils.ts           ← cn() utility
├── components/ui/         ← shadcn components (modified with HUD styles)
│   ├── button.tsx
│   ├── card.tsx
│   ├── badge.tsx
│   ├── input.tsx
│   └── separator.tsx
└── ...
```

---

## Adding New shadcn Components

```bash
npx shadcn@latest add <component> --yes --overwrite
```

After installing, open the generated file in `src/components/ui/` and apply the HUD modifications per the guidelines above. Key checklist:

- [ ] `transition-all duration-200` on interactive elements
- [ ] `dark:backdrop-blur-md` on panel surfaces
- [ ] Full-strength borders: `border-border` or `border-primary` — no opacity
- [ ] Full-strength text: `text-foreground`, `text-muted-foreground` — no opacity
- [ ] Glow shadows on hover/focus where appropriate (opacity OK in shadows)
- [ ] `font-mono` + `uppercase tracking-widest` for data-display text
- [ ] All colors via semantic tokens, never raw values
- [ ] Background opacity never below `/80` — prefer solid `bg-card`

---

## Theme Toggle

Dark mode is controlled via a `.dark` class on the root wrapper:

```tsx
<div className={isDark ? "dark" : ""}>
  <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
    {/* app */}
  </div>
</div>
```
