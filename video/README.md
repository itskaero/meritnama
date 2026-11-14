# meritNAMA · 30-second film

The film on the entry page (`index.html`, files in `assets/video/`). It is HTML rendered to video with
[HyperFrames](https://hyperframes.heygen.com); the music is synthesised in Python, no samples.

- `synth.py` writes `assets/music.wav` (120 BPM, A minor; drops at 4, 12 and 24 s). Needs `numpy`.
- `index.html` mounts six scenes from `compositions/`; `SPEC.md` has the beats, `REVIEW.md` the frame check.
- The film is built on the new landing page at meritnama.online, section by section, with the values the
  live page showed on 14 Nov 2026 (hero merit card, the free marks check for 22.5 / 30, open jobs, the record).
  `assets/night-study.jpg` is the landing's own photograph.

Re-render (ffmpeg on the PATH):

```sh
cd video
python synth.py
npx hyperframes@0.9.46 check
npx hyperframes@0.9.46 render -q delivery -o meritnama-30s.mp4
# web copies used by the entry page
ffmpeg -i meritnama-30s.mp4 -c:v libx264 -preset slow -crf 24 -movflags +faststart -c:a aac -b:a 160k ../assets/video/meritnama-30s-1080.mp4
ffmpeg -i meritnama-30s.mp4 -vf scale=1280:-2 -c:v libx264 -preset slow -crf 25 -movflags +faststart -c:a aac -b:a 128k ../assets/video/meritnama-30s-720.mp4
```
