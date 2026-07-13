# Piano.JS

A basic piano synth, using University of Iowa public domain samples, implemented in CSS/JS.

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
  partials over the sampled note. A green (up) / amber (down) wash shows the
  emphasis. Splitting the axes means gliding along the row keeps a neutral
  tone while deliberate up/down movement colors it.
- **Register stepper** — the `−` / `+` control shifts the base octave (2–6)
  so you can roam the whole range.
- **Volume + test tone** — a master volume slider, and a **Test tone** button
  that plays a sample-free 440Hz tone. If you can hear the tone but not the
  piano it's a sample/loading issue; if you hear neither it's system output
  (muted tab, output device, or OS volume).

MIDI and computer-keyboard input work too.

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
