/**
 * Pure, side-effect-free note/pitch helpers shared by the app and the unit
 * tests. Written as a UMD module so it works both as a plain <script> (it
 * attaches to window.PianoNotes) and as a CommonJS require() in Node, which
 * means it can be unit tested without a browser, a bundler, or a build step.
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PianoNotes = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * Map a MIDI note number to a sample key name (e.g. 36 => "C2"), using the
   * given 12-entry chromatic key table. Returns undefined below MIDI 21 (the
   * lowest piano key), matching the available samples.
   */
  function midiNoteName(value, keys) {
    if (value < 21) return undefined;
    const octave = Math.floor(value / 12) - 1;
    const step = value % 12;
    return keys[step] + String(octave);
  }

  /**
   * Normalize a vertical drag (in px) to a signed amount. Up is positive,
   * down is negative, clamped to +/- max. Used to drive the harmonic tilt.
   */
  function dragAmount(startY, clientY, pixelsPerUnit, max) {
    const offset = (startY - clientY) / pixelsPerUnit;
    return clamp(offset, -max, max);
  }

  /**
   * Fundamental frequency (Hz) of a note, from equal temperament with A4=440.
   * `keys` is the 12-entry chromatic table; MIDI middle C (C4) = 60.
   */
  function noteFrequency(note, octave, keys) {
    const midi = (octave + 1) * 12 + keys.indexOf(note);
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /**
   * Fundamental frequency (Hz) of a key name like "C4" or "Db5". Returns null
   * if the key can't be parsed.
   */
  function keyFrequency(key, keys) {
    const match = /^([A-G]b?)(-?\d+)$/.exec(key);
    if (!match) return null;
    return noteFrequency(match[1], Number(match[2]), keys);
  }

  /**
   * Split a tilt value (-1..1) into gains for the added 3rd and 5th harmonic
   * partials: tilting up (positive) raises the 3rd, down (negative) the 5th.
   */
  function harmonicGains(tilt, maxGain) {
    return {
      h3: Math.max(0, tilt) * maxGain,
      h5: Math.max(0, -tilt) * maxGain,
    };
  }

  return { clamp, midiNoteName, dragAmount, noteFrequency, keyFrequency, harmonicGains };
}));
