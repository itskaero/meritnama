# meritNAMA · 30 s launch film

1920×1080, 30 fps, 30.0 s. Music: `assets/music.wav`, synthesised (120 BPM, beat 0.5 s = 15 frames, bar 2 s).
Drops at 4.0, 12.0 and 24.0; breakdown 20–24; closing hit 28.0. Every scene change sits on a bar line.

## Look

- Ground `#0C0C0E` charcoal, navy aurora `#10243A` with teal `#176B67`, amber `#E5A04B` and violet `#6E56FF` blobs (from the site's `.mn-head`).
- Ink ivory `#F3EEE5`; muted `#8B8B93`. Data colours from the product: green `#3DDC97` (safe, fall), amber `#E5A04B` (target, estimate), coral `#FF7A7A` (reach, rise), cyan `#5CE1E6`, violet `#9B87FF`.
- Type: Inter 400/700/900, IBM Plex Mono for marks. Hero words 180–260 px; titles 64–96 px (6–9 % of height); labels ≥ 26 px.
- Logo: the brand's own path from `src/components/brand.tsx` (FULL) and `src/app/icon.svg`; violet rank dot `#9B87FF`.

## Facts on screen (all from the live data, 14 Nov 2026)

14 inductions · 68 rounds · 73,298 allocations · 1,449 seats in induction 21 · median closing R1→R8 21.86 → 21.26 (▼0.04 last round) ·
FCPS · Punjab at 22.50 / 30: 130 safe, 33 target, 214 reach · estimated round 9: 1,207 seats, 87 % of consent replies in.
Merit rows show marks and seat only (no names, no IDs).

## Beats

| t (s) | Scene | What happens |
| --- | --- | --- |
| 0–4 | intro | aurora wakes; logo stroke draws 0.4→1.9 (power2.inOut), rank dot drops 1.9 (back.out 1.6); "Where will your marks land?" per word blur 6→0, 0.07 s apart from 2.3; 3.6 dot grows past the frame (object becomes world, power3.in 0.4 s) |
| 4–8 | words | violet flood clears to charcoal; EVERY / MERIT / LIST. slam on 4.0, 4.5, 5.0 (scale 1.25→1, blur 12→0, 0.18 s expo.out); 6.0 "since 2020" with the year rolling 2020→2026 (0.1 s a roll); real round-8 rows stream behind at 600 px/s |
| 8–12 | numbers | four glass tiles land on 8.0/8.5/9.0/9.5 (y 60→0, expo.out 0.5 s) and count up over 0.9 s; 10.2 line "Every seat. Every round." per word; 11.6 whip left (0.3 s, x blur 20) |
| 12–16 | chart | median closing chart: grid fades in, line draws R1→R8 over 2.2 s (power2.inOut), area fills, end dot lands with "21.26 ▼0.04"; movers ticker slides at 120 px/s |
| 16–20 | chances | "Know where you stand." blurs in; marks field types 22.50; SAFE 130 / TARGET 33 / REACH 214 land on 17.0/17.5/18.0, sparklines draw; 36 standing ticks light to the 50th |
| 20–24 | estimate | breakdown: dashed amber card "Estimated round 9 · not official"; consent ticks fill to 87 % over 1.6 s; three range bands march; "Before PHF publishes it." 21.8; 23.6 zoom through the card (scale 1→3, power3.in) |
| 24–30 | end | drop: logo redraws fast (0.5 s) centred at 24 % of frame width, dot drops 24.55 with a ping; wordmark wipes in 24.9; "Know where you stand. Every merit list, made legible." 25.5; CTA pill "meritnama.online →" 26.2; held still to 30; closing hit 28 lifts the aurora |

## Banned

Breathing or pulsing loops on titles, every element fading up, a title still moving after it lands, invented UI or numbers, the logo in a corner.
