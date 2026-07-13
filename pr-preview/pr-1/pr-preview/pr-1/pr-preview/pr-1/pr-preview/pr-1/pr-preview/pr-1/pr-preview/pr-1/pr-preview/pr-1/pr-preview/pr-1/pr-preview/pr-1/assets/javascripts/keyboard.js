(function(global) {

  const context = new AudioContext();
  const compressor = context.createDynamicsCompressor();
  compressor.connect(context.destination);

  /**
   * Number of seconds of release for the closing envelope of the sample.
   */
  const NOTE_RELEASE_SECONDS = 0.25;

  /**
   * Number of seconds to ramp note attack.
   */
  const NOTE_ATTACK_SECONDS = 0.0001;

  const KEYS = [
    'C', 'Db', 'D', 'Eb', 'E', 'F',
    'Gb', 'G', 'Ab', 'A', 'Bb', 'B'
  ];

  function prepend(prefix) {
    return str => String(prefix) + str;
  }
  const KEY_NOTE_MAPPING = (() => {
    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(prepend('Digit'));
    const minusEqual = ['Minus', 'Equal'];
    const brackets = ['Left', 'Right'].map(prepend('Bracket'));
    const topRow = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map(prepend('Key')).concat(brackets);
    const midRow = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'].map(prepend('Key'))
        .concat(['Semicolon', 'Quote', 'Enter']);
    const bottomRow = ['ShiftLeft']
      .concat(['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map(prepend('Key')))
      .concat(['Comma', 'Period', 'Slash', 'ShiftRight']);
    return {
      // Octave => Array<KeyCode>
      2: digits.concat(minusEqual),
      3: topRow,
      4: midRow,
      5: bottomRow,
    };
  })();

  const OCTAVES = [1, 2, 3, 4, 5, 6, 7];

  const KEY_OCTAVES = flatMap(OCTAVES, octave => {
    return KEYS.map(key => [key, octave]);
  });

  const KEY_OCTAVES_STR = KEY_OCTAVES.map(ok => ok[0] + ok[1]);

  function flatMap(arr, fn) {
    const fin = [];
    arr.forEach(item => {
      fn(item).forEach(sub => fin.push(sub));
    });
    return fin;
  }

  const KEY_CODE_NOTES = (function() {
    return flatMap(Object.keys(KEY_NOTE_MAPPING), octave => {
      return KEY_NOTE_MAPPING[octave].map((key, i) => [key, KEYS[i] + octave]);
    }).reduce((map, item) => (map[item[0]] = item[1]) && map, {});
  }());

  const VALID_KEYS = KEY_OCTAVES_STR.reduce((acc, next) => {
    acc[next] = true;
    return acc;
  }, {});

  const state = {
    hasMidiSupport: null,
    hasMidiInput: null,
    keyActive: {}
  };

  const subscriptions = {};
  let subscriberSerial = 0;
  function stateSubscribe(keys, cb) {
    keys.forEach(key => {
      cb.__subscriber_id = ++subscriberSerial;
      cb.__subscriber_keys = keys.slice();
      (subscriptions[key] = subscriptions[key] || []).push(cb);
    });
  }

  function updateState(newState) {
    Object.assign(state, newState);
    const notified = {};
    Object.keys(newState)
      .filter(key => subscriptions[key])
      .map(key => subscriptions[key])
      .forEach(subList => subList.forEach(cb => {
        if (!notified[cb.__subscriber_id]) {
          notified[cb.__subscriber_id] = true;
          const subState = cb.__subscriber_keys.reduce((acc, next) => {
            acc[next] = state[next];
            return acc;
          }, {});
          setTimeout(() => {
            cb(subState);
          }, 0);
        }
      }));
  }


  /**
   * Given a function, return a memoized version of the function which caches the return value
   * the first time it is called and will return the cached value for subsequent calls when
   * the arguments are equivalent.
   *
   * @param {Function} fn The function to memoize.
   */
  function memoize(fn) {
    const slice = [].slice;
    const mem = {};
    return function() {
      const args = slice.apply(arguments);
      const key = args.length === 0 ? '(null)' : (args.length === 1 ? args[0] : JSON.stringify(args));
      if (!(key in mem)) {
        mem[key] = fn.apply(null, args);
      }
      return mem[key];
    };
  }

  function createElement(tag) {
    return global.document.createElement(tag);
  }

  function createAudioTag(key) {
    const audio = createElement('audio');
    audio.src = audioPath(key);
    return audio;
  }

  function audioPath(key) {
    return 'assets/audio/Piano.ff.' + key + '.ogg';
  }

  const getAudioData = memoize(function(key) {
    console.debug('getAudioData', key);
    if (!key) {
      return Promise.reject(new Error('key must be defined'));
    }
    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();
      req.open('GET', audioPath(key));
      req.responseType = 'arraybuffer';
      req.onload = () => {
        const buffer = req.response;
        context.decodeAudioData(buffer, decoded => {
          resolve(decoded);
        });
      };
      req.onerror = reject;
      req.send();
    });
  });

  function playAudioData(key, decodedAudio, gain, detuneCents) {
    console.debug('playAudioData: ', key, gain);
    const audioSource = context.createBufferSource();
    if (gainNodes[key]) {
      diminishGain(gainNodes[key]);
    }
    audioSource.onended = () => {
      state.keyActive[key] = false;
      if (sourceNodes[key] === audioSource) {
        delete sourceNodes[key];
      }
    };
    const gainNode = context.createGain();
    gainNode.gain.value = 0;
    gainNode.gain.linearRampToValueAtTime(gain || 1.0, context.currentTime + NOTE_ATTACK_SECONDS);
    gainNodes[key] = gainNode;
    gainNode.connect(context.destination);
    audioSource.buffer = decodedAudio;
    if (detuneCents) {
      audioSource.detune.value = detuneCents;
    }
    sourceNodes[key] = audioSource;
    audioSource.connect(gainNode);
    audioSource.start(0);
  }

  function playNote(key, velocity = 128, detuneCents = 0) {
    console.debug('playNote: %o', key, velocity);
    state.keyActive[key] = true;
    return getAudioData(key).then(audioData => {
      if (!state.keyActive[key]) return;
      renderKeyActive(key);
      const gain = (0.66 * velocity / 128);
      playAudioData(key, audioData, gain, detuneCents);
    });
  }

  const gainNodes = {};
  const sourceNodes = {};
  function releaseNote(key) {
    if (gainNodes[key]) {
      diminishGain(gainNodes[key]);
    }
    renderKeyInactive(key);
  }

  function diminishGain(gainNode, releaseTime = NOTE_RELEASE_SECONDS) {
    gainNode.gain.setTargetAtTime(0, context.currentTime, releaseTime);
  }

  function makeKey(container, key, oct) {
    const el = createElement('div');
    const cont = createElement('div');
    cont.className = 'key-container';
    el.className = 'key key-' + key;
    el.setAttribute('data-key', key + oct);
    el.id = 'key-' + key + oct;
    container.appendChild(cont);
    cont.appendChild(el);
  }

  function getKeyElement(key) {
    return document.getElementById('key-' + key);
  }


  function renderKeyActive(key) {
    const el = getKeyElement(key);
    if (!el) return;
    el.classList.add('active');
  }

  function renderKeyInactive(key) {
    const el = getKeyElement(key);
    if (!el) return;
    el.classList.remove('active');
  }

  function keyFromEvent(e) {
    return e.target.getAttribute('data-key')
  }

  function parseMidiNote(value) {
    // 24 => "C1"
    // 36 => "C2"
    // todo(carpita): support initial 3 keys to left of C1 (code 21-23)
    if (value < 21) return;
    const octave = Math.floor(value / 12) - 1;
    const step = value % 12;
    return KEYS[step] + String(octave);
  }

  function parseMidiMessage(message) {
    const data = message.data;
    if (!data) {
      console.log('no data', message);
      return;
    }
    let command;
    let noteValue = null;
    let velocity = 0;

    // Mask off midi channel bits
    switch (data[0] & 0xf0) {
      // Note on
      case 0x90:
        velocity = data[2];
        if (velocity > 0) {
          command = 'noteOn';
        } else if (velocity === 0) {
          command = 'noteOff';
        }
        noteValue = data[1];
        break;

      case 0x80:
        velocity = data[2];
        command = 'noteOff';
        noteValue = data[1];
        break;
    }

    if (!command) return null;

    const note = parseMidiNote(noteValue);
    if (!note) return null;

    return {
      command,
      note,
      velocity,
    };
  }

  const getMidiListener = memoize(() => {

    function generateListener(midiAccess) {

      updateState({hasMidiSupport: true});

      let callbacks = [];
      const listener = {
        on: cb => callbacks.push(cb),
        off: cb => {
          callbacks = callbacks.filter(fn => fn !== cb);
        }
      };

      let currentInput = null;

      function updateInput() {
        let currentInput, id;
        for ([id, currentInput] of midiAccess.inputs) {
          break;
        }
        updateState({
          hasMidiInput: !!currentInput
        });
        if (!currentInput) return;

        /**
         * Unfortunately it's possible to get a redundant noteOn midi signal from a device
         * when multiple keys are played and released, so we have to keep track of state
         * and flip the command to "noteOff" when a redundant "noteOn" message is received.
         *
         * This condition is likely due to a faulty MIDI-USB converter owned by the author,
         * but the edge case handling will not be harmful to correct hardware implementations.
         */
        const noteState = {};
        currentInput.onmidimessage = message => {
          const parsed = parseMidiMessage(message);
          if (!parsed) return;
          if (parsed.command === 'noteOn') {
            if (noteState[parsed.note] === 'on') {
              noteState[parsed.note] = 'off';
              parsed.command = 'noteOff';
            } else {
              noteState[parsed.note] = 'on';
            }
          } else {
            noteState[parsed.note] = 'off';
          }

          callbacks.forEach(l => l(parsed));
        };
      }
      midiAccess.onstatechange = updateInput;
      updateInput();

      return listener;
    }

    return navigator.requestMIDIAccess()
      .then(generateListener)
      .catch(e => {
        updateState({hasMidiSupport: false});
        throw e;
      });
  });

  function buildPiano(container) {
    KEY_OCTAVES.forEach(ko => {
      makeKey(container, ko[0], ko[1]);
    });
  }

  /**
   * Harp Mode — a harmonica-inspired, tap-first interface.
   *
   * Design principles borrowed from the harmonica:
   *   1. Few, large "holes" instead of 88 tiny keys. A single octave of
   *      big tap targets sized for thumbs, not a mouse pointer.
   *   2. A second axis of expression living inside the same gesture. On a
   *      harmonica the breath that sounds a hole also bends it — you don't
   *      reach for a separate control. Here, the vertical drag of the very
   *      finger holding a hole bends its octave: tap-and-hold = which note,
   *      slide up/down = bend the octave.
   *   3. Real bending. The bend is continuous and per-hole — each held finger
   *      detunes its own note independently across up to a full octave, the
   *      digital cousin of a draw/overblow bend, snapping back to pitch as you
   *      slide home.
   */

  const CENTS_PER_OCTAVE = 1200;

  // Notes are tapped at this octave; vertical drag bends up to +/- one octave.
  // The stepper shifts baseOctave; the +/-1 bend headroom is why it's clamped
  // to 2..6, keeping every sounding octave inside the 1..7 sample range.
  let baseOctave = 4;
  const BASE_MIN_OCTAVE = 2;
  const BASE_MAX_OCTAVE = 6;
  const MAX_BEND_OCTAVES = 1;

  // How far (px) you drag to reach a full octave of bend.
  const PIXELS_PER_OCTAVE = 140;

  // note-name (e.g. "C") => active-hole state for currently held holes.
  const activeHoles = {};

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function holeDown(note, el, clientY) {
    if (activeHoles[note]) return;
    const key = note + baseOctave;
    activeHoles[note] = { key, note, el, startY: clientY, bend: 0, base: baseOctave };
    el.classList.add('active');
    renderHoleBend(activeHoles[note]);
    playNote(key, 128, 0);
  }

  function holeBend(note, clientY) {
    const hole = activeHoles[note];
    if (!hole) return;
    // Up is positive bend (higher), down is negative (lower).
    const offset = (hole.startY - clientY) / PIXELS_PER_OCTAVE;
    hole.bend = clamp(offset, -MAX_BEND_OCTAVES, MAX_BEND_OCTAVES);
    const source = sourceNodes[hole.key];
    if (source) {
      source.detune.setTargetAtTime(hole.bend * CENTS_PER_OCTAVE, context.currentTime, 0.01);
    }
    renderHoleBend(hole);
  }

  function holeUp(note) {
    const hole = activeHoles[note];
    if (!hole) return;
    delete activeHoles[note];
    hole.el.classList.remove('active');
    hole.el.style.removeProperty('--bend');
    const label = hole.el.querySelector('.hole-label');
    if (label) label.textContent = note;
    releaseNote(hole.key);
  }

  function renderHoleBend(hole) {
    // Drive the fill direction/intensity via a CSS custom property (-1..1).
    hole.el.style.setProperty('--bend', hole.bend.toFixed(3));
    const label = hole.el.querySelector('.hole-label');
    if (!label) return;
    const sounding = clamp(Math.round(hole.base + hole.bend), 1, 7);
    label.textContent = hole.note + sounding;
  }

  function buildHarp(container) {
    const harp = createElement('div');
    harp.className = 'harp';

    // --- register stepper: shift the base octave for new taps ---
    const stepper = createElement('div');
    stepper.className = 'harp-stepper';
    const stepDown = createElement('button');
    stepDown.className = 'step-btn';
    stepDown.textContent = '\u2212'; // U+2212 minus, escaped to stay ASCII-safe
    stepDown.setAttribute('aria-label', 'Octave down');
    const stepValue = createElement('span');
    stepValue.className = 'step-value';
    const stepUp = createElement('button');
    stepUp.className = 'step-btn';
    stepUp.textContent = '+';
    stepUp.setAttribute('aria-label', 'Octave up');
    stepper.appendChild(stepDown);
    stepper.appendChild(stepValue);
    stepper.appendChild(stepUp);

    function renderStepper() {
      stepValue.textContent = 'Octave ' + baseOctave;
      stepDown.disabled = baseOctave <= BASE_MIN_OCTAVE;
      stepUp.disabled = baseOctave >= BASE_MAX_OCTAVE;
    }
    function stepBy(delta) {
      baseOctave = clamp(baseOctave + delta, BASE_MIN_OCTAVE, BASE_MAX_OCTAVE);
      renderStepper();
    }
    stepDown.addEventListener('click', () => stepBy(-1));
    stepUp.addEventListener('click', () => stepBy(1));
    renderStepper();

    const hint = createElement('div');
    hint.className = 'harp-hint';
    hint.textContent = 'Tap a hole, then slide up or down to bend its octave';

    const head = createElement('div');
    head.className = 'harp-head';
    head.appendChild(hint);
    head.appendChild(stepper);
    harp.appendChild(head);

    // --- holes: one octave of large, chromatic tap targets ---
    const holes = createElement('div');
    holes.className = 'harp-holes';
    KEYS.forEach(note => {
      const isSharp = note.length > 1;
      const hole = createElement('div');
      hole.className = 'hole hole-' + (isSharp ? 'sharp' : 'natural') + ' hole-' + note;
      hole.setAttribute('data-note', note);
      const label = createElement('span');
      label.className = 'hole-label';
      label.textContent = note;
      hole.appendChild(label);

      hole.addEventListener('pointerdown', e => {
        e.preventDefault();
        try { hole.setPointerCapture(e.pointerId); } catch (err) {}
        holeDown(note, hole, e.clientY);
      });
      hole.addEventListener('pointermove', e => {
        if (!activeHoles[note]) return;
        holeBend(note, e.clientY);
      });
      const lift = () => holeUp(note);
      hole.addEventListener('pointerup', lift);
      hole.addEventListener('pointercancel', lift);
      holes.appendChild(hole);
    });

    harp.appendChild(holes);
    container.appendChild(harp);
  }

  function bindMouse(container) {

    function require(mesg) {
      return arg => {
        if (!arg) throw new Error(mesg || 'missing argument');
        return arg;
      };
    };

    container.addEventListener('mousedown', e => Promise.resolve(e)
      .then(keyFromEvent)
      .then(require('event key'))
      .then(playNote)
      .catch(e => {}));

    container.addEventListener('mouseout', e => Promise.resolve(e)
      .then(keyFromEvent)
      .then(require('event key'))
      .then(releaseNote)
      .catch(e => {}));

    container.addEventListener('mouseup', e => Promise.resolve(e)
      .then(() => {
        Object.keys(state.keyActive)
          .filter(key => state.keyActive[key])
          .forEach(releaseNote);
      }));

  }

  function bindKeyboard() {
    const keyState = {};
    window.addEventListener('keydown', e => {
      console.log('keydown', e.code);
      const key = KEY_CODE_NOTES[e.code];
      if (!key) return;
      if (key in VALID_KEYS && !keyState[key]) {
        keyState[key] = true;
        playNote(key);
      }
    });
    window.addEventListener('keyup', e => {
      const key = KEY_CODE_NOTES[e.code];
      if (key) {
        keyState[key] = false;
        releaseNote(key);
      }
    });
  }

  function initAudio() {
    KEY_OCTAVES_STR.forEach(keyOctave => {
      getAudioData(keyOctave);
    });
  }

  function initMidi(container) {
    const midiStatus = document.createElement('div');
    const baseClassName = 'midi-status';
    midiStatus.className = baseClassName;
    container.appendChild(midiStatus);
    stateSubscribe(['hasMidiInput', 'hasMidiSupport'], state => {
      let mesg = '';
      let className = baseClassName;
      if (state.hasMidiInput) {
        mesg = 'Device Connected';
        className += ' connected';
      } else if (state.hasMidiSupport) {
        mesg = 'Device Disconnected';
        className += ' disconnected';
      } else if (state.hasMidiSupport === false) {
        mesg = 'Not Supported';
        className += ' unsupported';
      } else {
        mesg = 'Initializing';
        className += ' initializing';
      }
      midiStatus.innerHTML = 'MIDI: ' + mesg;
      midiStatus.className = className;
    });

    getMidiListener().then(listener => {
      listener.on(message => {
        if (message.command === 'noteOn') {
          playNote(message.note, message.velocity);
        } else if (message.command === 'noteOff') {
          releaseNote(message.note);
        }
      });
    }).catch(e => {
      console.error(e);
    });
  }

  function init(container) {
    initAudio();
    buildHarp(container);
    buildPiano(container);
    initMidi(container);
    bindMouse(container);
    bindKeyboard();
  }

  global.keyboard = {
    init,
  };
}(window));
