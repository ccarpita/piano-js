# Piano.JS

A tap-first, harmonica-inspired synth implemented in plain CSS/JS. Notes are
generated on the fly with the Web Audio API — no samples, no downloads — so
it's light enough for a mobile site.

See: https://ccarpita.github.io/piano-js/

## Harp Mode

A harmonica-inspired, tap-first interface designed for touch. Instead of
aiming at 88 tiny keys, you get:

- **One octave of large "holes"** — big, thumb-sized chromatic tap targets.
- **Glide to play** — press and slide your finger sideways across the holes
  and each one sounds as you reach it, no separate tap per note, the way you
  slide across a harp. Multiple fingers play at once.
- **Shape the tone by sliding up/down** — horizontal position picks the hole,
  vertical position colors it. Sliding **up** fades in the **3rd harmonic**
  (a bright, reedy color) and **down** fades in the **5th**, layered as sine
  partials over the note. A green (up) / amber (down) wash shows the emphasis.
  Splitting the axes means gliding along the row keeps a neutral tone while
  deliberate up/down movement colors it.
- **Register stepper** — the `−` / `+` control shifts the base octave (2–6)
  so you can roam the whole range.
- **Volume + test tone** — a master volume slider, and a **Test tone** button
  that plays a 440Hz tone straight through the master bus. If you can hear the
  tone but not the notes it's a synth bug; if you hear neither it's system
  output (muted tab, output device, or OS volume).

MIDI and computer-keyboard input work too.

## The sound

Each note is synthesized as a **harmonica crossed with a flute**: a
flute-dominant fundamental (a nearly pure tone) with harmonica reediness added
through odd harmonics via a Web Audio `PeriodicWave`, plus a breath of
bandpassed noise and a gentle shared vibrato. There are no audio files to
download, so notes are instant and the whole site is tiny.

Works in Chrome, Firefox, Edge, and Safari (desktop and iOS). Audio is
unlocked on the first tap (iOS autoplay policy); note that iOS routes Web
Audio through the ringer channel, so the hardware mute switch will silence it.

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
