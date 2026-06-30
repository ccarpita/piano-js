# Piano.JS

A basic piano synth, using University of Iowa public domain samples, implemented in CSS/JS.

See: https://ccarpita.github.io/piano-js/

## Harp Mode

A harmonica-inspired, tap-first interface designed for touch. Instead of
aiming at 88 tiny keys, you get:

- **One octave of large "holes"** — big, thumb-sized chromatic tap targets.
- **An Octave Bender ribbon** — a second, continuous axis of expression
  (the harmonica's "breath"). Slide it to set the register; new taps snap to
  the nearest whole octave.
- **Live bending** — drag the bender while a hole is held and the sustained
  note glides smoothly across octaves before snapping to a detent, the
  digital cousin of a draw/overblow bend.

Built for two thumbs: tap holes with one hand while riding the bender with
the other, the way you cup a harp and modulate breath. The full multi-octave
keyboard, MIDI, and computer-keyboard input all still work below.

Only Chrome/Firefox/Edge is supported, Safari 10+ should work once 2016 MacOS is out of beta.

## TODO

- Investigate integration of UIOWA samples with MIDI.js, remove unused boilerplate
- Package for distribution, download sound-font as postinstall
- Better browser support with Babel

## License

MIT
