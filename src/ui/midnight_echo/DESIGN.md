# Design System Document: Audio-First Social Architecture

## 1. Overview & Creative North Star: "The Celestial Salon"
This design system moves away from the sterile, grid-locked nature of traditional social apps. Our Creative North Star is **"The Celestial Salon"**—an immersive, atmospheric environment that mimics the depth of a midnight sky. 

Instead of flat components, we treat the UI as a series of suspended, translucent celestial bodies. We break the "template" look through **atmospheric depth**: elements do not just sit on a background; they float within it. By using intentional asymmetry in room layouts and overlapping "glass" surfaces, we create a premium, editorial feel that prioritizes the human voice over UI clutter.

---

## 2. Colors & Surface Philosophy
The palette is rooted in deep, non-pure blacks and infinite blues, creating a sense of boundless space.

### Core Palette
- **Primary (Electric Blue):** `#b0c6ff` (Source: `#2979FF`). Used for active focus and energy.
- **Secondary (Indigo Violet):** `#bac3ff` (Source: `#5C6BC0`). Used for supportive branding and depth.
- **Tertiary (Neon Emerald):** `#00e475` (Source: `#00E676`). Reserved exclusively for "Live" states and active speakers.
- **Background Gradient:** A linear sweep from `surface_container_lowest` (#070b28) to `surface` (#0c112e).

### The "No-Line" Rule
To maintain an editorial, high-end feel, **1px solid borders for sectioning are prohibited.** Boundaries must be defined by:
1. **Background Shifting:** A `surface_container_low` card sitting on a `surface` background.
2. **Tonal Transitions:** Using the gradient of the background itself to imply a change in context.

### The Glass & Gradient Rule
All primary containers must utilize **Glassmorphism**. 
- **Surface:** `rgba(255, 255, 255, 0.05)` (Mapping to `surface_variant`).
- **Backdrop Blur:** Minimum `20px` to ensure legibility and a "frosted" premium texture.
- **CTA Signature:** Main actions should use a gradient from `primary` to `primary_container` rather than a flat fill to provide "visual soul."

---

## 3. Typography: Editorial Authority
We use a high-contrast scale to differentiate between "Atmosphere" and "Information."

- **Display (Manrope):** Large, airy, and bold. Used for room titles and major headers to give an editorial, magazine-like feel.
- **Body & Labels (Inter):** Highly legible and utilitarian. Used for conversation threads and metadata.
- **Hierarchy Logic:** 
    - **Primary Text:** `on_surface` (White/Off-white) for absolute clarity.
    - **Secondary Text:** `on_surface_variant` (#A0AEC0) for non-essential metadata, creating a natural focus on the content.

---

## 4. Elevation & Depth: Tonal Layering
We do not use drop shadows to indicate height; we use **light and translucency.**

- **The Layering Principle:** Depth is achieved by stacking surface tiers. A user profile card (`surface_container_highest`) should feel physically "closer" to the user than the room background (`surface`).
- **Ambient Shadows:** When an element must float (e.g., the Navigation Pill), use a wide-spread, low-opacity shadow tinted with `primary` (e.g., `rgba(41, 121, 255, 0.08)` with a 30px blur).
- **The "Ghost Border" Fallback:** If a container requires definition against a similar tone, use the `outline_variant` at **10% opacity**. Never use 100% opaque lines.

---

## 5. Components

### Navigation: The Orbital Pill
A floating `xl` (1.5rem) rounded pill bar. 
- **Style:** `surface_container_highest` with 24px backdrop blur.
- **Active State:** The icon glows with a `primary` (Electric Blue) soft outer bloom. No underline or blocky highlights.

### Active Speaker Avatar
Avatars are the heartbeat of the app.
- **Standard:** `lg` (1rem) border radius.
- **Active State:** A `tertiary` (Neon Emerald) 2px ring with a "pulse" animation (expanding 0% to 100% opacity) to mimic sound waves.

### Interactive Buttons
- **Primary CTA:** Gradient fill (`primary` to `primary_container`), `full` (pill) radius, white text.
- **Secondary/Glass:** `surface_variant` with a "Ghost Border."
- **Active State:** On press, the button should emit a `primary_fixed_dim` inner glow.

### Cards & Lists
- **Rule:** Forbid divider lines. Use `1.5rem` (xl) vertical spacing to separate list items. 
- **Room Cards:** Use `lg` (1rem) border radius. Use a subtle background shift (`surface_container_low`) to separate the "Stage" from the "Audience" within a card.

### Audio Visualizers
Small, 4-bar motion components using `primary` color. These replace standard "loading" spinners to reinforce the audio-first nature of the system.

---

## 6. Do’s and Don'ts

### Do:
- **Do** use generous white space (32px+) between major content groups to allow the background gradient to "breathe."
- **Do** use `display-lg` typography for empty states to make them feel like intentional design choices rather than "missing" content.
- **Do** ensure all "Glass" elements have a `backdrop-filter: blur()` to prevent text collisions with the background.

### Don’t:
- **Don’t** use pure black (#000000). It kills the depth of the deep blue "Celestial" atmosphere.
- **Don’t** use standard Material Design "elevated" cards with grey shadows. 
- **Don’t** use hard, 100% opaque borders. They create "visual noise" that distracts from the fluidity of the audio experience.
- **Don’t** crowd the Navigation Pill. Keep it minimal and floating; it should never touch the edges of the screen.