(function(global) {

  // Pure note/pitch math, shared with the unit tests (see notes.js).
  const PianoNotes = global.PianoNotes;
  const clamp = PianoNotes.clamp;

  // Safari (incl. iOS) still ships the prefixed constructor on older versions.
  const AudioContextClass = global.AudioContext || global.webkitAudioContext;
  const context = new AudioContextClass();
  const compressor = context.createDynamicsCompressor();
  compressor.connect(context.destination);

  /**
   * Pick an audio format the browser can actually decode. Safari — desktop and
   * iOS — does NOT support Ogg Vorbis, so requesting .ogg there yields silence.
   * We ship both .ogg and .mp3; prefer ogg where supported, else fall back to
   * mp3 (which every target browser can play).
   */
  const AUDIO_EXT = (function() {
    try {
      const probe = global.document.createElement('audio');
      const canOgg = probe.canPlayType && probe.canPlayType('audio/ogg; codecs="vorbis"');
      if (canOgg === 'probably' || canOgg === 'maybe') return 'ogg';
    } catch (e) { /* no <audio> support; fall through */ }
    return 'mp3';
  }());

  // Single master bus every voice routes through, so one gain controls overall
  // volume (and gives us a place to tap for metering/tests).
  const masterGain = context.createGain();
  masterGain.gain.value = 1.0;
  masterGain.connect(context.destination);

  /**
   * Browsers create an AudioContext in the "suspended" state and will only
   * begin producing sound after resume() is called from within a user
   * gesture. Without this, every note is silent. Resume on the first pointer,
   * touch, or key interaction (and defensively before each note).
   */
  let audioUnlocked = false;
  function unlockAudio() {
    const resumed = context.state === 'suspended' ? context.resume() : Promise.resolve();
    // iOS Safari sometimes needs a real (silent) buffer played inside the first
    // gesture before it will output anything, even once the context is running.
    if (!audioUnlocked) {
      audioUnlocked = true;
      try {
        const buffer = context.createBuffer(1, 1, 22050);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(0);
      } catch (e) { /* best effort */ }
    }
    return resumed;
  }

  /**
   * Play a short 440Hz sine through the master bus. It needs no samples or
   * network, so it isolates the audio path: hear this but not the piano => a
   * sample/loading issue; hear nothing => system output / volume / muted tab.
   */
  function playTestTone() {
    unlockAudio();
    const now = context.currentTime;
    const osc = context.createOscillator();
    const env = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = 440;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.3, now + 0.02);
    env.gain.setTargetAtTime(0, now + 0.4, 0.08);
    osc.connect(env);
    env.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.8);
  }

  function setMasterVolume(fraction) {
    // setTargetAtTime rides the context clock, which is frozen while the
    // context is suspended (before the first gesture) — set directly there,
    // and ramp (to avoid zipper noise) only once the clock is running.
    if (context.state === 'running') {
      masterGain.gain.setTargetAtTime(fraction, context.currentTime, 0.01);
    } else {
      masterGain.gain.value = fraction;
    }
  }

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

  function audioPath(key) {
    return 'assets/audio/Piano.ff.' + key + '.' + AUDIO_EXT;
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

  function playAudioData(key, decodedAudio, gain) {
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
    gainNode.connect(masterGain);
    audioSource.buffer = decodedAudio;
    sourceNodes[key] = audioSource;
    audioSource.connect(gainNode);
    audioSource.start(0);
  }

  function playNote(key, velocity = 128) {
    console.debug('playNote: %o', key, velocity);
    unlockAudio();
    state.keyActive[key] = true;
    return getAudioData(key).then(audioData => {
      if (!state.keyActive[key]) return;
      const gain = (0.66 * velocity / 128);
      playAudioData(key, audioData, gain);
    });
  }

  const gainNodes = {};
  const sourceNodes = {};
  function releaseNote(key) {
    if (gainNodes[key]) {
      diminishGain(gainNodes[key]);
    }
  }

  function diminishGain(gainNode, releaseTime = NOTE_RELEASE_SECONDS) {
    gainNode.gain.setTargetAtTime(0, context.currentTime, releaseTime);
  }


  function parseMidiNote(value) {
    // 24 => "C1", 36 => "C2"
    // todo(carpita): support initial 3 keys to left of C1 (code 21-23)
    return PianoNotes.midiNoteName(value, KEYS);
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

    if (!navigator.requestMIDIAccess) {
      updateState({hasMidiSupport: false});
      return Promise.reject(new Error('Web MIDI API not available'));
    }
    return navigator.requestMIDIAccess()
      .then(generateListener)
      .catch(e => {
        updateState({hasMidiSupport: false});
        throw e;
      });
  });

  /**
   * Harp Mode — a harmonica-inspired, tap-first interface.
   *
   * Design principles borrowed from the harmonica:
   *   1. Few, large "holes" instead of 88 tiny keys. A single octave of
   *      big tap targets sized for thumbs, not a mouse pointer.
   *   2. Glide to play. Press and slide your finger sideways across the holes
   *      and each one sounds as you reach it — no separate tap per note, the
   *      way you slide your mouth across a harp.
   *   3. Timbre lives in the same gesture. Horizontal position picks the hole;
   *      vertical position shapes its tone. Sliding up mixes in the 3rd
   *      harmonic (a bright, reedy fifth-above color), sliding down mixes in
   *      the 5th — the way a harp player brightens or hollows a note by
   *      changing their mouth. Splitting the axes means gliding along the row
   *      keeps a neutral tone while deliberate up/down movement colors it.
   */

  // Notes play at this octave; the stepper shifts it within the sample range.
  let baseOctave = 4;
  const BASE_MIN_OCTAVE = 2;
  const BASE_MAX_OCTAVE = 6;

  // How far (px) you drag vertically to reach full harmonic emphasis, and the
  // peak gain of an added partial relative to the ~0.66 sampled note.
  const PIXELS_PER_HARMONIC = 120;
  const HARMONIC_MAX_GAIN = 0.18;

  // The holes container, set in buildHarp; used to hit-test holes by column.
  let holesEl = null;

  // pointerId => state for each finger currently gliding over the holes.
  const pointerHoles = {};

  /**
   * The hole under a given horizontal position, chosen by column only: we
   * sample at the holes' vertical midline so the current hole doesn't change
   * when the finger moves up or down to color the tone (or past the edges).
   */
  function holeAtX(clientX) {
    if (!holesEl) return null;
    const rect = holesEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const el = global.document.elementFromPoint(clientX, midY);
    return el && el.closest ? el.closest('.hole') : null;
  }

  /**
   * Layer two sine partials — the 3rd and 5th harmonics — over a note, each
   * behind its own gain (starting silent) so the vertical drag can fade them
   * in. Returns the partials so they can be updated and stopped later.
   */
  function createHarmonics(freq) {
    function partial(multiple) {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * multiple;
      const gain = context.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start();
      return { osc, gain };
    }
    return { h3: partial(3), h5: partial(5) };
  }

  function applyHarmonics(state) {
    const gains = PianoNotes.harmonicGains(state.tilt, HARMONIC_MAX_GAIN);
    const t = context.currentTime;
    state.harmonics.h3.gain.gain.setTargetAtTime(gains.h3, t, 0.02);
    state.harmonics.h5.gain.gain.setTargetAtTime(gains.h5, t, 0.02);
  }

  function stopHarmonics(harmonics) {
    const t = context.currentTime;
    [harmonics.h3, harmonics.h5].forEach(partial => {
      try {
        partial.gain.gain.setTargetAtTime(0, t, NOTE_RELEASE_SECONDS / 3);
        partial.osc.stop(t + NOTE_RELEASE_SECONDS);
      } catch (e) { /* already stopped */ }
    });
  }

  function startHole(pointerId, holeEl, clientY) {
    const note = holeEl.getAttribute('data-note');
    const octave = baseOctave;
    const key = note + octave;
    const freq = PianoNotes.noteFrequency(note, octave, KEYS);
    const state = {
      note, key, el: holeEl, startY: clientY, base: octave, tilt: 0,
      harmonics: createHarmonics(freq),
    };
    pointerHoles[pointerId] = state;
    holeEl.classList.add('active');
    renderHoleTilt(state);
    playNote(key, 128);
  }

  function releaseHoleState(state) {
    state.el.classList.remove('active');
    state.el.style.removeProperty('--tilt');
    const label = state.el.querySelector('.hole-label');
    if (label) label.textContent = state.note;
    releaseNote(state.key);
    stopHarmonics(state.harmonics);
  }

  function movePointer(pointerId, clientX, clientY) {
    const state = pointerHoles[pointerId];
    if (!state) return;
    const holeEl = holeAtX(clientX);
    if (holeEl && holeEl !== state.el) {
      // Glissando: crossed into a new column — release the old, sound the new.
      releaseHoleState(state);
      startHole(pointerId, holeEl, clientY);
      return;
    }
    // Same hole (or in a gap): vertical movement colors the tone.
    state.tilt = PianoNotes.dragAmount(state.startY, clientY, PIXELS_PER_HARMONIC, 1);
    applyHarmonics(state);
    renderHoleTilt(state);
  }

  function endPointer(pointerId) {
    const state = pointerHoles[pointerId];
    if (!state) return;
    delete pointerHoles[pointerId];
    releaseHoleState(state);
  }

  function renderHoleTilt(hole) {
    // Drive the fill (up = 3rd harmonic, down = 5th) via a CSS property (-1..1).
    hole.el.style.setProperty('--tilt', hole.tilt.toFixed(3));
    const label = hole.el.querySelector('.hole-label');
    if (label) label.textContent = hole.note + hole.base;
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
    hint.textContent = 'Slide across holes to play; up = 3rd harmonic, down = 5th';

    const head = createElement('div');
    head.className = 'harp-head';
    head.appendChild(hint);
    head.appendChild(stepper);
    harp.appendChild(head);

    // --- audio controls: master volume + a sample-free test tone ---
    const audio = createElement('div');
    audio.className = 'harp-audio';

    const testBtn = createElement('button');
    testBtn.className = 'test-tone';
    testBtn.textContent = 'Test tone';
    testBtn.addEventListener('click', playTestTone);

    const volWrap = createElement('label');
    volWrap.className = 'vol-wrap';
    const volIcon = createElement('span');
    volIcon.className = 'vol-icon';
    volIcon.textContent = '🔊';
    const vol = createElement('input');
    vol.type = 'range';
    vol.className = 'vol';
    vol.min = '0';
    vol.max = '150';
    vol.value = '100';
    vol.setAttribute('aria-label', 'Master volume');
    vol.addEventListener('input', () => setMasterVolume(Number(vol.value) / 100));
    volWrap.appendChild(volIcon);
    volWrap.appendChild(vol);

    audio.appendChild(testBtn);
    audio.appendChild(volWrap);
    harp.appendChild(audio);

    // --- holes: one octave of large, chromatic tap targets ---
    const holes = createElement('div');
    holes.className = 'harp-holes';
    holesEl = holes;
    KEYS.forEach(note => {
      const isSharp = note.length > 1;
      const hole = createElement('div');
      hole.className = 'hole hole-' + (isSharp ? 'sharp' : 'natural') + ' hole-' + note;
      hole.setAttribute('data-note', note);
      const label = createElement('span');
      label.className = 'hole-label';
      label.textContent = note;
      hole.appendChild(label);
      holes.appendChild(hole);
    });

    // Pointer handling lives on the container, not per hole: we capture the
    // pointer here so a finger can glide across columns (and beyond the row's
    // vertical bounds while coloring the tone) and keep sending moves. Each
    // pointerId is tracked independently, so multiple fingers can play at once.
    holes.addEventListener('pointerdown', e => {
      const holeEl = holeAtX(e.clientX);
      if (!holeEl) return;
      e.preventDefault();
      try { holes.setPointerCapture(e.pointerId); } catch (err) {}
      startHole(e.pointerId, holeEl, e.clientY);
    });
    holes.addEventListener('pointermove', e => {
      if (!pointerHoles[e.pointerId]) return;
      e.preventDefault();
      movePointer(e.pointerId, e.clientX, e.clientY);
    });
    const lift = e => endPointer(e.pointerId);
    holes.addEventListener('pointerup', lift);
    holes.addEventListener('pointercancel', lift);

    harp.appendChild(holes);
    container.appendChild(harp);
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

  function preloadOctave(octave) {
    // Returns a promise that settles once every note in the octave has loaded,
    // swallowing per-note failures so one missing sample can't block the rest.
    return Promise.all(KEYS.map(note => getAudioData(note + octave).catch(() => {})));
  }

  function initAudio() {
    // Warm the default octave first so the very first taps sound instantly.
    // Then, queued *behind* that load, warm the neighbouring octaves so the
    // stepper is snappy too. Everything else loads lazily on first use
    // (getAudioData is memoized).
    //
    // These are long (~35s) University of Iowa samples; eagerly decoding all
    // ~80 at once saturates the audio decoder and balloons memory, which can
    // leave early taps silent even though the AudioContext is already running
    // (the tab's "playing" indicator only means the context resumed, not that
    // a note actually sounded).
    preloadOctave(baseOctave).then(() => {
      [baseOctave - 1, baseOctave + 1].forEach(preloadOctave);
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
      // MIDI being unavailable (no support, no device, permission denied) is
      // expected and not an app error — keep it out of the error channel.
      console.warn('MIDI unavailable:', e && e.message ? e.message : e);
    });
  }

  function init(container) {
    // Resume the AudioContext on the first user gesture (autoplay policy).
    ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(evt => {
      window.addEventListener(evt, unlockAudio, { passive: true });
    });
    initAudio();
    buildHarp(container);
    initMidi(container);
    bindKeyboard();
  }

  global.keyboard = {
    init,
  };
}(window));
