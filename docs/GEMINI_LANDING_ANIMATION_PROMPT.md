# meritNAMA intro: colour scheme and Gemini background prompt

## Colour scheme (tokens v1.1, as used on the intro)

| Role | Token | Hex | Used for |
|---|---|---|---|
| Room (page background) | `--mn-navy-950` | `#0b0b0c` | Base of the whole screen |
| Room, raised | `--mn-navy-900` | `#121314` | Lower glow of the room |
| Cool light pool | `--mn-border` | `#2a2b2e` | Soft grey light behind the form before the lights warm up |
| Text | `--mn-text` | `#f4f4f5` | Headline, stems of the logo |
| Text, muted | `--mn-text-muted` | `#a1a1aa` | Link under the bar |
| Text, subtle | `--mn-text-subtle` | `#8a8a93` | Percentage, "Tap for sound" |
| Teal | `--mn-cyan` | `#2dd4bf` | Cool reflections, fog in unlit state, focus ring |
| Teal, light | `--mn-cyan-strong` | `#5eead4` | Highlights |
| Ember | `--mn-ember` | `#ff6a3d` | Logo beam, lit glow, progress bar, warm fog |
| Ember, hot | `--mn-ember-hot` | `#ffb08a` | Brightest glow, arrow tip, dust motes when lit |
| Ember, deep | `--mn-ember-deep` | `#b8321a` | Shadowed glow, base of the beam |
| Ceramic (scene only) | — | `#cccfd1` | Unlit glossy form |
| Flash core (scene only) | — | `#fff4ee` | Centre of the final transition flash |

Rules: teal is for cool light and UI; ember is reserved for the logo, the progress bar and the "lights on" warmth. Fonts: Plus Jakarta Sans (200 for the headline, 600 for "merit"), Archivo 800 at width 125 for "NAMA", IBM Plex Mono for small labels.

---

## Prompt for Gemini (animated background)

Copy everything below the line into Gemini.

---

Build a single self-contained `background.html` (inline CSS and JS, no libraries, no external assets) that renders a **full-screen, immersive animated background** for the intro of **meritNAMA**, a web tool for Pakistani doctors planning postgraduate medical training. The background sits behind a centred logo and one line of text (leave the centre visually calm; do not draw any logo, text or buttons). Mood: a dark, quiet room at night where a warm lamp has just been switched on. Premium, slow and cinematic; never neon, glitchy or busy.

**Palette (use only these):** room `#0b0b0c`, raised room `#121314`, cool grey light `#2a2b2e`, ember `#ff6a3d`, hot ember `#ffb08a`, deep ember `#b8321a`, teal `#2dd4bf` (sparingly, for cool fog only), text-white `#f4f4f5` (dust highlights only).

**Layers, back to front:**
1. **Room:** a solid `#0b0b0c` base with a radial gradient rising from `#121314` at the bottom.
2. **Light pool:** a large soft radial glow centred slightly above the middle (50% x, 42% y). It starts as cool grey (`rgba(120,124,132,.4)`). About 0.6s after load it switches on like a real lamp: a quick flicker (on, off, half, on over ~650ms), then it settles to a warm ember glow (`rgba(255,106,61,.38)` fading through `rgba(184,50,26,.16)` to transparent). It breathes very slowly (±8% brightness over ~6s).
3. **Fog:** two or three huge blurred circles (70vmax, `filter: blur(80px)`, opacity ~0.3) drifting across the screen on 35–50s alternating paths. One is warm ember (`rgba(255,106,61,.16)`), one is hot ember (`rgba(255,176,138,.12)`) and one is faint teal (`rgba(45,212,191,.10)`), so the room has a cool corner.
4. **Dust motes:** a canvas with ~500 tiny particles (260 on screens narrower than 600px) floating in 3D depth. Use parallax: nearer particles are bigger, brighter and faster. They drift slowly upward and sideways on gentle sine paths, twinkle softly, and are coloured hot ember `#ffb08a` near the light pool and fading to dim grey at the edges. Use additive blending.
5. **Floor shadow:** a soft, dark elliptical shadow just below centre (where a floating object would cast it), with a faint ember bounce-light around it.
6. **Vignette:** darken the edges to `rgba(0,0,0,.65)`.
7. **Film grain:** an animated SVG `feTurbulence` noise overlay at ~7% opacity with `mix-blend-mode: overlay`, jittering in 6 steps per second.

**Interaction:**
- Pointer parallax: the fog and dust shift up to ~20px opposite to the cursor, eased.
- Expose `window.bg.setEnergy(0..1)` so music can make the light pool and dust brightness swell gently.
- Expose `window.bg.flash(durationMs)` for the exit transition. It pushes the whole room forward (scale 1→1.25, ease-in), speeds the dust toward the viewer like a warp, and fades in a full-screen radial flash from `#fff4ee` (centre) through `#ffb08a` and `#ff6a3d` to `#b8321a` (edges) over the last 45% of the duration. It returns a Promise that resolves when the flash is complete.

**Technical:**
- `html, body { height: 100%; overflow: hidden }`, `color-scheme: dark`, no horizontal scroll at 360px width.
- Cap the device pixel ratio at 2, pause animation when the tab is hidden, and keep it at 60fps on a mid-range phone.
- With `prefers-reduced-motion: reduce`, skip the flicker and drifting, keep a static lit room and still dust, and make `flash()` a simple 400ms fade.
- Comment the code and deliver only the complete `background.html`.
