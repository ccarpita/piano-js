# Piano.JS

A basic piano synth, using University of Iowa public domain samples, implemented in CSS/JS.

See: https://ccarpita.github.io/piano-js/

## Harp Mode

A harmonica-inspired, tap-first interface designed for touch. Instead of
aiming at 88 tiny keys, you get:

- **One octave of large "holes"** — big, thumb-sized chromatic tap targets.
- **Bend by sliding the same finger** — the breath that sounds a hole on a
  harmonica also bends it, so there's no separate control here. Tap and hold
  a hole, then slide your finger **up to raise** or **down to lower** its
  octave. The note's label updates (e.g. `C4` → `C5`) and a colored wash
  shows the bend direction.
- **Continuous, per-hole bending** — each held finger detunes its own note
  independently across up to a full octave, the digital cousin of a
  draw/overblow bend, gliding back to pitch as you slide home.
- **Register stepper** — the `−` / `+` control shifts the base octave (2–6)
  for new taps, so you can roam the whole keyboard, not just the three
  octaves the bend can reach on its own.
- **Volume + test tone** — a master volume slider, and a **Test tone** button
  that plays a sample-free 440Hz tone. If you can hear the tone but not the
  piano it's a sample/loading issue; if you hear neither it's system output
  (muted tab, output device, or OS volume).

The full multi-octave keyboard, MIDI, and computer-keyboard input all still
work below.

Works in Chrome, Firefox, Edge, and Safari (desktop and iOS). Samples are
served as Ogg Vorbis where supported and fall back to MP3 on Safari, which
can't decode Ogg. Audio is unlocked on the first tap (iOS autoplay policy);
note that iOS routes Web Audio through the ringer channel, so the hardware
mute switch will silence it.

## Development

The app is plain HTML/CSS/JS with **no build step** — open `index.html` or
serve the folder:

```sh
npm run serve        # static server at http://localhost:8080
```

### Tests

```sh
npm install
npm run test:unit    # node:test — pure note/pitch math (assets/javascripts/notes.js)
npm run test:e2e     # Playwright — loads the app in Chromium, asserts no JS
                     # errors and that audio actually resumes + plays
npm test             # both
```

The e2e suite guards the "no sound" class of bug: it checks the `AudioContext`
resumes on a user gesture and that a note reaches playback, with zero console
or page errors. Both suites run in CI on every PR (`.github/workflows/test.yml`).

## TODO

- Investigate integration of UIOWA samples with MIDI.js, remove unused boilerplate
- Package for distribution, download sound-font as postinstall
- Better browser support with Babel

## License

MIT
