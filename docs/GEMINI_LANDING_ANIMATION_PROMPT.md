# Prompt: MeritNama landing animation (for Gemini)

Copy everything below the line into Gemini.

---

Build a single, self-contained `index.html` (inline CSS and JS, no frameworks, no build step, no external assets except Google Fonts) for the landing page of **MeritNama**. It's an independent web tool for Pakistani doctors applying to postgraduate medical training in Punjab: it shows historical merit cutoffs, seat competition and induction simulations. The site is being rebuilt, so this page is a minimal, highly animated "coming back soon" screen with a progress bar. It must feel calm, premium and alive, like looking up at the northern lights late at night.

## Content (keep text minimal, no buttons)

Centred vertically and horizontally, in this order:

1. **Logo mark** (exact SVG below), about 56px, gently floating, with its three bars rising and falling in a staggered loop.
2. **Wordmark** "Merit" + "Nama". "Merit" is in the text colour; "Nama" is in cyan with a slow-moving cyan→green gradient. On load, the letters enter one by one (blur + rise + slight rotation, staggered about 60ms), then keep a very subtle idle bob.
3. **One rotating status line** in small uppercase mono with wide letter spacing. It cycles every ~3s with a blur/slide crossfade through:
   - A new MeritNama is on its way
   - Recomputing closing merit
   - Redrawing seat maps
   - Tuning the simulator
   - Polishing every page
4. **Progress bar**, max-width ~460px, height 12px, pill-shaped:
   - Fills from 0 to `window.MERITNAMA_CONFIG?.buildProgress ?? 64` percent over ~2.6s with an ease-out-quart curve, starting 0.6s after load.
   - The fill has a moving cyan→green gradient, diagonal stripes sliding continuously, a white sheen sweeping across, and an outer glow.
   - A glowing white dot sits at the leading edge and pulses like a heartbeat (lub-dub scale rhythm, ~1.1s).
   - A small canvas behind the bar emits particle sparks from the leading edge, drifting backwards and fading (additive blending).
   - Beneath it in mono: `64% built`, with the number counting up alongside the fill. Use tabular numerals.

There are no buttons, links, nav, footer or countdown. The only extra UI is a tiny 5-bar equalizer glyph fixed in the top-right corner that toggles the music (see below), plus a faint "Tap anywhere for sound" hint at the bottom that pulses softly and fades out after the first tap or after 12s.

## Background: aurora night sky (no desk, no table, no furniture, no study props)

Full-viewport, fixed, layered:

- **Base:** radial gradient from `#0e1b2c` near the bottom to `#07111f`.
- **Starfield canvas:** density ~1 star per 4,000px², varied sizes, each twinkling on its own sine phase. Every few seconds a shooting star streaks diagonally with a fading tail.
- **Aurora canvas:** rendered at ~1/3 resolution and upscaled with CSS for natural softness. Use `mix-blend-mode: screen` and additive (`lighter`) compositing. Draw 4 curtain ribbons, each made of thin vertical light rays whose baseline follows two summed sine waves that drift over time. Ray height and brightness flicker with interfering sines so the curtains shimmer. The rays fade to transparent at the top and have a bright lower edge, like real aurora. Ribbon colours come only from the palette: `#42d6d0` (cyan), `#5fd39a` (green), `#1f7f80` (deep teal) and `#6be3de` (light cyan), at low alpha. The aurora occupies roughly the top 55% of the screen.
- **Drifting data glyphs:** ~24 (12 on mobile) tiny mono labels float slowly upward with slight sideways drift and rotation, at 20–50% opacity in `#7d90a6`, each with a random duration of 18–40s and a negative delay so the screen is populated at once. Use subject-specific labels: `Δ merit +0.84`, `78.215`, `Round 2 → 3`, `FCPS`, `MS · MD`, `σ = 2.1`, `Σ score`, `x̄ ± SD`, `P < 0.05`, `MCQ 180`, `♥ 72 bpm`, `SpO₂ 98%`, `pH 7.40`, `Na⁺ 140`.
- **Parallax:** on pointer move, translate the sky layer up to ~18px opposite to the cursor and the centre content ~10px with it, eased with a CSS transition.

## Music (generated live, no audio files)

Use the Web Audio API to synthesize a lo-fi ambient pad. Browsers block autoplay, so start it on the first `pointerdown` anywhere on the page (except on the equalizer itself, which toggles), and let the `M` key toggle it as well.

- **Chords:** a 4-chord loop of Cmaj7 → Am7 → Fmaj7 → G(add9), 8 seconds each. Each note is 2 detuned oscillators (a triangle at −7 cents and a sine at +6 cents) with a 2.4s attack and a long release, plus a sine bass note an octave below the root.
- **Melody:** sparse random pentatonic sine plucks (C5, D5, E5, G5, A5, C6) on ~38% of beats, with a fast attack and a 2.2s decay.
- **Signal chain:** lowpass at 1300Hz with a 0.05Hz LFO sweeping it ±500Hz → algorithmic reverb (convolver with a 5s generated noise impulse, wet 0.7 / dry 0.5) → compressor → analyser → output.
- **Background texture:** a soft brown-noise bed through a bandpass filter (rain/vinyl feel) at very low gain.
- **Volume:** fade the master gain in to 0.55 over 2.5s and out over 1s. Suspend the context when paused.
- **Audio-reactive visuals:** read the analyser's low-frequency energy each frame and smooth it. Use it to boost the aurora's brightness (up to ~2.4×) and ray length, so the sky breathes with the music.
- **Remembering the choice:** store `on`/`off` in `localStorage` (wrapped in try/catch). The equalizer bars animate only while music is playing.

## Design system (use exactly)

```css
--mn-navy-950: #07111f;  /* page background */
--mn-navy-900: #0e1b2c;
--mn-navy-800: #14253a;
--mn-border:   #26394e;
--mn-text:        #f2f6fc;
--mn-text-muted:  #a8b8ca;
--mn-text-subtle: #7d90a6;
--mn-cyan:        #42d6d0;  /* primary signal */
--mn-cyan-strong: #6be3de;
--mn-success:     #5fd39a;
--mn-amber:       #e8b878;  /* use sparingly or not at all */
--mn-font-sans: "Plus Jakarta Sans", system-ui, sans-serif;  /* weights 400–800 */
--mn-font-mono: "IBM Plex Mono", ui-monospace, monospace;    /* weights 400–600 */
--mn-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
```

- Dark theme only; set `color-scheme: dark`.
- Wordmark: Plus Jakarta Sans 800, `clamp(2.6rem, 6.4vw, 5rem)`, letter-spacing −0.04em.
- Status line and percentage: IBM Plex Mono.

## Logo mark (use this SVG exactly; colour it `--mn-cyan`)

```html
<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
  <rect x="3" y="18" width="5" height="10" rx="1.5" opacity=".55"/>
  <rect x="10" y="12" width="5" height="16" rx="1.5" opacity=".75"/>
  <rect x="17" y="7" width="5" height="21" rx="1.5"/>
  <path d="M24 4h5v5M29 4l-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

Animate the three bars with `transform-box: fill-box; transform-origin: bottom;` scaling from 0.35 to 1, staggered, alternating. Add a cyan drop-shadow glow.

## Technical requirements

- Keep this script at the top of `<head>`, unchanged. It sends signed-in users of the current app straight to it:
  ```html
  <script src="site.config.js"></script>
  <script>
  (function () {
    var cfg = window.MERITNAMA_CONFIG || {};
    if (!cfg.legacySessionRedirect || /[?&]home\b/.test(location.search)) return;
    try {
      var s = JSON.parse(localStorage.getItem('meritnama_auth_session'));
      if (s && s.email && typeof s.ts === 'number' && (Date.now() - s.ts) < 86400000) {
        location.replace(cfg.appUrl || 'app.html');
      }
    } catch (e) {}
  })();
  </script>
  ```
- **Single screen:** `html, body { height: 100%; overflow: hidden }`, with no horizontal scroll at 360px width. Use 20px side gutters with `env(safe-area-inset-*)`.
- **Performance:** cap the device pixel ratio at 2, pause `requestAnimationFrame` when the tab is hidden, and target 60fps on a mid-range phone.
- **Accessibility:**
  - Progress bar: `role="progressbar"` with `aria-valuenow`.
  - Status line: `aria-live="polite"`.
  - Equalizer: a `<button>` with `aria-pressed` and an `aria-label` that switches between "Play background music" and "Pause background music", plus a visible focus ring.
  - Wordmark: `aria-label="MeritNama"` on the `<h1>`, with the per-letter spans `aria-hidden`.
- **Reduced motion** (`prefers-reduced-motion: reduce`): show a static aurora frame, hide the glyphs and sparks, skip the per-letter entrance, and render the bar fully filled immediately.
- **Meta:** set `<title>MeritNama</title>`, `theme-color #07111f`, a meta description, and Open Graph tags ("MeritNama is being rebuilt").
- **Code:** clean and commented, no external JS libraries, ES5-compatible enough for older Android Chrome.

Deliver only the complete `index.html`.
