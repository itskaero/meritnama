# Prompt: MeritNama landing animation (for Gemini)

Copy everything below the line into Gemini.

---

Build a single, self-contained `index.html` (inline CSS and JS, no frameworks, no build step, no external assets except Google Fonts) for the landing page of **meritNAMA**. It's an independent web tool for Pakistani doctors applying to postgraduate medical training in Punjab: it shows historical merit cutoffs, seat competition and induction simulations. The site is being rebuilt, so this page is a minimal, highly animated "coming back soon" screen with a progress bar. It must feel calm, premium and alive, like looking up at the northern lights late at night.

## Content (keep text minimal, no buttons)

Centred vertically and horizontally, in this order:

1. **Logo mark: the "Beam M"** (exact SVG below), about 64px. Animate it in this order: the two white stems draw in (stroke-dashoffset), then the ember beam rises from the bottom (scaleY 0→1, ease-out), then the arrow tip fades and slides into place. After that, the tip nudges up ~2px every few seconds, a soft ember halo breathes behind the beam, and the whole mark floats gently.
2. **Wordmark "meritNAMA"**: "merit" in Plus Jakarta Sans 600; "NAMA" in Archivo 800 at `font-stretch: 125%` (`wdth` 125) with letter-spacing 0.02em, both in the text colour. A slow band of light (`#5eead4`) passes across NAMA every ~7s. On load, the letters enter one by one (blur + rise + slight rotation, staggered about 60ms), then keep a very subtle idle bob.
3. **One rotating status line** in small uppercase mono with wide letter spacing. It cycles every ~3s with a blur/slide crossfade through:
   - A new MeritNama is on its way
   - Recomputing closing merit
   - Redrawing seat maps
   - Tuning the simulator
   - Polishing every page
4. **Progress bar**, max-width ~460px, height 12px, pill-shaped:
   - Fills from 0 to `window.MERITNAMA_CONFIG?.buildProgress ?? 64` percent over ~2.6s with an ease-out-quart curve, starting 0.6s after load.
   - The fill is the brand **ember** gradient (`#b8321a` → `#ff6a3d` → `#ffb08a`), drifting slowly, with faint diagonal stripes sliding continuously, a white sheen sweeping across, and a soft ember glow.
   - A glowing warm-white dot (ember halo) sits at the leading edge and pulses like a heartbeat (lub-dub scale rhythm, ~1.1s).
   - A small canvas behind the bar emits small ember sparks from the leading edge, drifting backwards and fading (additive blending).
   - Beneath it in mono: `64% built`, with the number counting up alongside the fill. Use tabular numerals.

There are no buttons, links, nav, footer or countdown. The only extra UI is a tiny 5-bar equalizer glyph fixed in the top-right corner that toggles the music (see below), plus a faint "Tap anywhere for sound" hint at the bottom that pulses softly and fades out after the first tap or after 12s.

## Background: aurora night sky (no desk, no table, no furniture, no study props)

Full-viewport, fixed, layered:

- **Base:** radial gradient from `#121314` near the bottom to `#0b0b0c` (neutral charcoal, not navy).
- **Starfield canvas:** density ~1 star per 4,000px², varied sizes, each twinkling on its own sine phase. Every few seconds a shooting star streaks diagonally with a fading tail.
- **Aurora canvas:** it must look **smooth and soft, never neon, glitchy or flickering**. Draw 4 wide, filled curtain bands on a canvas at ~1/4 resolution, then apply CSS `filter: blur(28px)` and `mix-blend-mode: screen`. Each band's lower edge follows two slow summed sine waves (a full cycle takes minutes, not seconds). It fades upward with a vertical gradient and has its brightest part just above the lower edge. Opacity breathes very slowly (±20% over ~30s). Do not use per-pixel rays, strobing or fast noise. Fade the bands out towards the left and right edges. Colours: `#2dd4bf`, `#4ade80`, `#5eead4` and a deep teal `#146e64`, at low alpha. The aurora occupies roughly the top 55% of the screen.
- **Drifting data glyphs:** ~24 (12 on mobile) tiny mono labels float slowly upward with slight sideways drift and rotation, at 20–50% opacity in `#8a8a93`, each with a random duration of 18–40s and a negative delay so the screen is populated at once. Use subject-specific labels: `Δ merit +0.84`, `78.215`, `Round 2 → 3`, `FCPS`, `MS · MD`, `σ = 2.1`, `Σ score`, `x̄ ± SD`, `P < 0.05`, `MCQ 180`, `♥ 72 bpm`, `SpO₂ 98%`, `pH 7.40`, `Na⁺ 140`.
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

## Design system (meritNAMA tokens v1.1, use exactly)

```css
--mn-navy-950: #0b0b0c;  /* page background (charcoal) */
--mn-navy-900: #121314;
--mn-navy-800: #1a1b1d;
--mn-border:   #2a2b2e;
--mn-text:        #f4f4f5;
--mn-text-muted:  #a1a1aa;
--mn-text-subtle: #8a8a93;
--mn-cyan:        #2dd4bf;  /* teal signal: aurora, focus, equalizer */
--mn-cyan-strong: #5eead4;
--mn-teal-deep:   #0f3d38;
--mn-success:     #4ade80;
--mn-ember:       #ff6a3d;  /* brand beam: logo + progress only */
--mn-ember-hot:   #ffb08a;
--mn-ember-deep:  #b8321a;
--mn-font-sans:    "Plus Jakarta Sans", system-ui, sans-serif;  /* 500–800 */
--mn-font-display: "Archivo", "Arial Black", sans-serif;        /* wdth 125, 800: NAMA */
--mn-font-mono:    "IBM Plex Mono", ui-monospace, monospace;    /* 400–500 */
--mn-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
```

- Dark theme only; set `color-scheme: dark`.
- Wordmark size: `clamp(2.6rem, 6.4vw, 5rem)`. Load fonts with `family=Plus+Jakarta+Sans:wght@500;600;800&family=Archivo:wdth,wght@125,800&family=IBM+Plex+Mono:wght@400;500`.
- Teal is for the sky and UI; ember is reserved for the logo beam and the progress bar.
- Status line and percentage: IBM Plex Mono.

## Logo mark: "Beam M" (use this SVG exactly)

Two stems form the M; its valley rises as an ember beam with an arrow tip (merit moving up). The stems are `currentColor` (`--mn-text`).

```html
<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="beam" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#b8321a"/><stop offset=".55" stop-color="#ff6a3d"/><stop offset="1" stop-color="#ffb08a"/>
    </linearGradient>
  </defs>
  <path class="stem" d="M8 56V14a4 4 0 0 1 7.3-2.3L27 28.6" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="stem" d="M56 56V14a4 4 0 0 0-7.3-2.3L37 28.6" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <rect class="beam" x="28.5" y="15" width="7" height="41" rx="3.5" fill="url(#beam)"/>
  <path class="tip" d="M24.5 17 32 7l7.5 10" fill="none" stroke="#ffb08a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

For the beam, use `transform-box: view-box; transform-origin: 32px 56px;`.

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
  - Wordmark: `aria-label="meritNAMA"` on the `<h1>`, with the per-letter spans `aria-hidden`.
- **Reduced motion** (`prefers-reduced-motion: reduce`): show a static aurora frame, hide the glyphs and sparks, skip the per-letter entrance, and render the bar fully filled immediately.
- **Meta:** set `<title>meritNAMA</title>`, `theme-color #0b0b0c`, a meta description, and Open Graph tags ("meritNAMA is being rebuilt").
- **Code:** clean and commented, no external JS libraries, ES5-compatible enough for older Android Chrome.

Deliver only the complete `index.html`.
