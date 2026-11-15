# meritNAMA · 40-second showcase film

The film at the top of the home page (`index.html`, files in `assets/video/`). It is HTML rendered to video with
[HyperFrames](https://hyperframes.heygen.com); the music is synthesised in Python, no samples.

- **0–6 s:** the logo reveal, which fades away.
- **6–16 s:** the six feature cards.
- **16–32 s:** a screen recording of the new site in use (`assets/howto.mp4`).
- **32–40 s:** the motto. `SPEC.md` has the beats and `REVIEW.md` the frame check.
- `synth.py` writes `assets/music.wav` (120 BPM, A minor; drops at 6, 16 and 32 s). It needs `numpy`.
- The recording was made with Playwright on the new site. It shows only pages of overall figures (merit lists, My chances for 22.5 / 30, hospitals), with the account row hidden.

Re-render (ffmpeg on the PATH):

```sh
cd video
python synth.py
npx hyperframes@0.9.46 check
npx hyperframes@0.9.46 render -q delivery -o meritnama-showcase-40s.mp4
# web copies used by the home page
ffmpeg -i meritnama-showcase-40s.mp4 -c:v libx264 -preset slow -crf 24 -movflags +faststart -c:a aac -b:a 160k ../assets/video/meritnama-showcase-1080.mp4
ffmpeg -i meritnama-showcase-40s.mp4 -vf scale=1280:-2 -c:v libx264 -preset slow -crf 25 -movflags +faststart -c:a aac -b:a 128k ../assets/video/meritnama-showcase-720.mp4
```
