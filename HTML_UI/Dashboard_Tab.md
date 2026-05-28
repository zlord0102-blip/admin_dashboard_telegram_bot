---
name: Operational Cockpit
colors:
  surface: '#fcf8ff'
  surface-dim: '#dcd8e5'
  surface-bright: '#fcf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f2ff'
  surface-container: '#f0ecf9'
  surface-container-high: '#eae6f4'
  surface-container-highest: '#e4e1ee'
  on-surface: '#1b1b24'
  on-surface-variant: '#464555'
  inverse-surface: '#302f39'
  inverse-on-surface: '#f3effc'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#7e3000'
  on-tertiary: '#ffffff'
  tertiary-container: '#a44100'
  on-tertiary-container: '#ffd2be'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#ffdbcc'
  tertiary-fixed-dim: '#ffb695'
  on-tertiary-fixed: '#351000'
  on-tertiary-fixed-variant: '#7b2f00'
  background: '#fcf8ff'
  on-background: '#1b1b24'
  surface-variant: '#e4e1ee'
  success-emerald: '#10B981'
  warning-amber: '#F59E0B'
  danger-rose: '#E11D48'
  bg-slate: '#F8FAFC'
  border-subtle: '#E2E8F0'
  text-main: '#0F172A'
  text-muted: '#64748B'
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  mono-data:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  stack-xs: 4px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
  gutter: 16px
  table-row-height: 40px
  sidebar-width: 240px
---

## Brand & Style

The design system is engineered for **Admin Operators** who manage high-volume, high-risk data environments. The brand personality is **Technical, Precise, and Utilitarian**, prioritizing "Scan Speed" and "Operational Clarity" over decorative whitespace. It functions as a cockpit for the user, where every pixel serves a functional purpose.

The chosen style is **Corporate / Modern** with a lean toward **Minimalism**. It utilizes a "neutral-plus-primary" approach where the interface recedes into the background to let data take center stage. Key characteristics include:
- **High Data Density:** Compact spacing and reduced vertical heights to maximize information density.
- **Contextual Differentiation:** Using distinct primary color shifts to signal whether the user is in the "Bot Admin" or "Website Dashboard" environment.
- **Safety-First Interaction:** Distinct visual treatments for destructive actions and sensitive data (API keys, secrets).

## Colors

This design system uses a dual-primary strategy to provide instant environmental context. **Deep Indigo (#4F46E5)** is reserved for Bot Admin operations, while **Teal (#0D9488)** distinguishes the Website Dashboard.

The foundation is built on a **Slate** neutral scale. The application background is fixed at `#F8FAFC`, providing a cool-toned, low-strain canvas. Surfaces (cards, modals, panels) are pure `#FFFFFF` to create clear separation.

Functional colors are highly saturated to ensure status pills and alerts are immediately scannable:
- **Success:** Emerald, for "Active" or "Confirmed" states.
- **Warning:** Amber, for "Pending" or "Low Stock" alerts.
- **Danger:** Rose, for "Failed," "Cancelled," or destructive triggers.

## Typography

The system utilizes **Geist** for structural elements (headings, labels) to provide a technical, modern edge, and **Inter** for body content and data-heavy tables to ensure maximum legibility. **JetBrains Mono** is introduced specifically for technical data points like User IDs, API keys, and transaction hashes.

Scale is kept tight to maintain density. Headings do not exceed 24px on desktop to prevent them from pushing critical data below the fold. "Body-sm" (13px) is the workhorse size for data tables and side-panels.

## Layout & Spacing

This design system uses a **Fixed Grid** philosophy for desktop, with a standard sidebar width of 240px and a fluid main content area that caps at 1440px to ensure line lengths remain readable. 

Spacing follows a strict 4px/8px baseline grid:
- **Tables:** Use a condensed 40px row height with 12px horizontal padding.
- **Margins:** Global page margins are 24px, while internal card padding is 16px.
- **Breakpoints:** 
  - **Desktop (1024px+):** Sidebar is permanent.
  - **Tablet (768px - 1023px):** Sidebar collapses to an icon-only rail.
  - **Mobile (<767px):** Sidebar becomes a full-screen overlay; data tables transition to a horizontal-scroll model to preserve column relationships.

## Elevation & Depth

To maintain a clean, operational feel, depth is communicated through **Tonal Layers** and **Low-Contrast Outlines** rather than heavy shadows.

- **Level 0 (Background):** `#F8FAFC` (Slate-50).
- **Level 1 (Cards/Tables):** White surface with a 1px solid border of `#E2E8F0`. No shadow.
- **Level 2 (Modals/Side-Drawers):** White surface with a sharp 4px/12px/0px shadow at 5% opacity and a `#CBD5E1` border.
- **Sticky Elements:** Table headers and top toolbars use a subtle backdrop-blur (10px) with 90% opacity white to maintain context while scrolling.

## Shapes

The shape language is **Soft (0.25rem)**. This provides a professional, structured appearance that remains efficient for data-heavy layouts. 

- **Components:** Buttons and input fields use a 4px (0.25rem) radius.
- **Containers:** Section cards and modals use 8px (0.5rem) to provide a slightly softer container for the sharp data within.
- **Pills:** Status badges and tags are the exception, using a **full pill radius** (999px) to distinguish them from interactive buttons.

## Components

- **Data Tables:** Headers are sticky with a `#F1F5F9` background. Rows use a 1px bottom border. Hover states trigger a subtle `#F8FAFC` background change. Action menus are hidden until hover to reduce visual noise.
- **Status Pills:** Backgrounds are 10% opacity of the functional color (e.g., Emerald-100) with 100% opacity text.
- **Metric Cards:** Minimalist execution. Value (Headline-md) is primary, Label (Label-md) is secondary. Sparklines are monochromatic (Primary color) and 32px in height.
- **Input Fields:** Use a 1px border. Focus state uses a 2px outer glow of the Primary color at 20% opacity.
- **Side Panels:** Drawers slide from the right, covering 400px of the screen. They include a sticky footer for "Save/Cancel" actions.
- **Buttons:** 
  - **Primary:** Solid color, white text.
  - **Secondary:** White background, 1px border, Slate-700 text.
  - **Ghost:** No border/background until hover; used for row actions.
- **Search/Filter Toolbars:** Integrated directly above tables with no gap. Filters appear as "Filter Chips" that can be dismissed individually.