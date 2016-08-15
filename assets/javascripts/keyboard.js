(function(global) {

  const context = new AudioContext();
  const compressor = context.createDynamicsCompressor();
  compressor.connect(context.destination);

  /**
   * Threshold amplitude for start of sound within a sample.
   */
  const SOUND_START_THRESHOLD = 0.01;

  /**
   * Time subtracted from the time point of the first threshold, which is used
   * to provide a suitable buffer for capturing the attack without introducing
   * excessive delay.
   */
  const SOUND_BUFFER_SECONDS = 0.01;

  /**
   * Number of seconds of release for the closing envelope of the sample.
   */
  const NOTE_RELEASE_SECONDS = 0.15;

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

  const DEFAULT_FORTE = 'mf';
  const FORTE_OVERRIDE = {
    //'B5': 'mf',  // original E5 aiff has distortion in the 'ff' sample
  };
  const GAIN_OVERRIDE = {
    //'B5': 3.0
  };

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

  function audioPath(key, intensity) {
    const forte = FORTE_OVERRIDE[key] || 'ff';
    return 'assets/audio/Piano.' + forte + '.' + key + '.ogg';
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



  /**
   * Given a key, lookup the (memoized) decoded audio data, and take samples through
   * the buffer until an amplitude threshold is found indicating that the piano strike
   * has occurred.  The number of seconds, as a floating point number, will be returned.
   *
   * @return Promise<Float> resolving to the number of seconds within the sample that
   *   the sound actually begins, over the threshold defined in AUDIO_NOISE_THRESHOLD.
   */
  const getAudioStartTime = memoize(function(key) {
    console.debug('getAudioStartTime', key);
    return getAudioData(key).then(decoded => {
      const channelData = decoded.getChannelData(0);
      const numSamples = 5000;
      const step = parseInt((channelData.length / numSamples) - 1, 10);
      for (let i = 0; i < numSamples; i++) {
        const pos = i * step;
        const pt = channelData[pos];
        if (pt >= SOUND_START_THRESHOLD || pt < -SOUND_START_THRESHOLD) {
          // Find the point in the sound, in seconds, and subtract a buffer time
          // to ensure we capture the attack of the sound.
          const startTime = 1.0 * pos / decoded.sampleRate - SOUND_BUFFER_SECONDS;
          return startTime;
        }
      }
      return 0.0;
    });
  });

  function playAudioData(key, decodedAudio, startTime, gain) {
    console.debug('playAudioData: ', key, startTime, gain);
    const audioSource = context.createBufferSource();
    if (gainNodes[key]) {
      diminishGain(gainNodes[key]);
    }
    audioSource.onended = () => {
      state.keyActive[key] = false;
    };
    const gainNode = context.createGain();
    gainNode.gain.value = gain || 1.0;
    gainNode.connect(compressor);
    gainNodes[key] = gainNode;
    audioSource.buffer = decodedAudio;
    audioSource.connect(gainNode);
    audioSource.start(0, startTime);
  }

  function playNote(key, velocity = 128) {
    console.debug('playNote: %o', key, velocity);
    const audioData = getAudioData(key);
    const startTime = getAudioStartTime(key);
    state.keyActive[key] = true;

    return Promise.all([audioData, startTime]).then(res => {
      if (!state.keyActive[key]) return;
      renderKeyActive(key);
      const gain = GAIN_OVERRIDE[key] || (0.66 * velocity / 128);
      playAudioData(key, res[0], res[1], gain);
    });
  }

  const gainNodes = {};
  function releaseNote(key) {
    if (gainNodes[key]) {
      diminishGain(gainNodes[key]);
    }
    renderKeyInactive(key);
  }

  function diminishGain(gainNode, releaseTime = NOTE_RELEASE_SECONDS) {
    gainNode.gain.linearRampToValueAtTime(0, context.currentTime + releaseTime);
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
      getAudioStartTime(keyOctave);
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
    buildPiano(container);
    initMidi(container);
    bindMouse(container);
    bindKeyboard();
  }

  global.keyboard = {
    init,
  };
}(window));
