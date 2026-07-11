'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clamp, midiNoteName, bendOffset, soundingOctave } =
  require('../../assets/javascripts/notes.js');

const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

test('clamp keeps values within range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(42, 0, 10), 10);
});

test('midiNoteName maps MIDI numbers to sample keys', () => {
  assert.equal(midiNoteName(24, KEYS), 'C1');
  assert.equal(midiNoteName(36, KEYS), 'C2');
  assert.equal(midiNoteName(60, KEYS), 'C4'); // middle C
  assert.equal(midiNoteName(69, KEYS), 'A4'); // A440
  assert.equal(midiNoteName(21, KEYS), 'A0'); // lowest piano key
});

test('midiNoteName returns undefined below the lowest piano key', () => {
  assert.equal(midiNoteName(20, KEYS), undefined);
  assert.equal(midiNoteName(0, KEYS), undefined);
});

test('bendOffset: up is positive, down is negative', () => {
  // dragged up a full octave's worth of pixels
  assert.equal(bendOffset(200, 60, 140, 1), 1);
  // dragged down a full octave's worth
  assert.equal(bendOffset(200, 340, 140, 1), -1);
  // no movement
  assert.equal(bendOffset(200, 200, 140, 1), 0);
});

test('bendOffset clamps to +/- maxOctaves', () => {
  assert.equal(bendOffset(200, -400, 140, 1), 1);   // way up
  assert.equal(bendOffset(200, 900, 140, 1), -1);   // way down
});

test('bendOffset returns fractional bends mid-drag', () => {
  assert.equal(bendOffset(200, 130, 140, 1), 0.5);  // half an octave up
});

test('soundingOctave rounds base+bend and clamps to sample range', () => {
  assert.equal(soundingOctave(4, 0), 4);
  assert.equal(soundingOctave(4, 1), 5);
  assert.equal(soundingOctave(4, -1), 3);
  assert.equal(soundingOctave(6, 1), 7);   // top of range
  assert.equal(soundingOctave(2, -1), 1);  // bottom of range
  assert.equal(soundingOctave(4, 0.6), 5); // rounds up
});
