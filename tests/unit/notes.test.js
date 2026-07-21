'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clamp, midiNoteName, dragAmount, noteFrequency, keyFrequency, harmonicGains } =
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

test('dragAmount: up is positive, down is negative, clamped', () => {
  assert.equal(dragAmount(200, 80, 120, 1), 1);    // full up
  assert.equal(dragAmount(200, 320, 120, 1), -1);  // full down
  assert.equal(dragAmount(200, 200, 120, 1), 0);   // no movement
  assert.equal(dragAmount(200, 140, 120, 1), 0.5); // half up
  assert.equal(dragAmount(200, -400, 120, 1), 1);  // clamps way up
  assert.equal(dragAmount(200, 900, 120, 1), -1);  // clamps way down
});

test('noteFrequency uses equal temperament with A4=440', () => {
  assert.ok(Math.abs(noteFrequency('A', 4, KEYS) - 440) < 1e-9);
  assert.ok(Math.abs(noteFrequency('C', 4, KEYS) - 261.6256) < 1e-3); // middle C
  assert.ok(Math.abs(noteFrequency('A', 5, KEYS) - 880) < 1e-9);      // octave up
  assert.ok(Math.abs(noteFrequency('A', 3, KEYS) - 220) < 1e-9);      // octave down
});

test('keyFrequency parses a key name and returns its pitch', () => {
  assert.ok(Math.abs(keyFrequency('A4', KEYS) - 440) < 1e-9);
  assert.ok(Math.abs(keyFrequency('C4', KEYS) - 261.6256) < 1e-3);
  assert.ok(Math.abs(keyFrequency('Db5', KEYS) - noteFrequency('Db', 5, KEYS)) < 1e-9);
  assert.equal(keyFrequency('H9', KEYS), null); // unparseable
});

test('harmonicGains: up feeds the 3rd, down feeds the 5th', () => {
  assert.deepEqual(harmonicGains(1, 0.2), { h3: 0.2, h5: 0 });
  assert.deepEqual(harmonicGains(-1, 0.2), { h3: 0, h5: 0.2 });
  assert.deepEqual(harmonicGains(0, 0.2), { h3: 0, h5: 0 });
  assert.deepEqual(harmonicGains(0.5, 0.2), { h3: 0.1, h5: 0 });
});
