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
   * Convert a vertical drag (in px) into an octave bend. Up is positive
   * (higher), down is negative (lower), clamped to +/- maxOctaves.
   */
  function bendOffset(startY, clientY, pixelsPerOctave, maxOctaves) {
    const offset = (startY - clientY) / pixelsPerOctave;
    return clamp(offset, -maxOctaves, maxOctaves);
  }

  /**
   * The whole octave a hole sounds at, given its base octave and current
   * fractional bend, clamped to the range covered by the samples (1..7).
   */
  function soundingOctave(base, bend) {
    return clamp(Math.round(base + bend), 1, 7);
  }

  return { clamp, midiNoteName, bendOffset, soundingOctave };
}));
