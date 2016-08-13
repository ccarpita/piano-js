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
  const SOUND_BUFFER_SECONDS = 0.03;

  /**
   * Number of seconds of release for the closing envelope of the sample.
   */
  const NOTE_RELEASE_SECONDS = 0.15;

  const KEYS = [
    'C', 'Db', 'D', 'Eb', 'E', 'F',
    'Gb', 'G', 'Ab', 'A', 'Bb', 'B'
  ];

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

  const DEFAULT_FORTE = 'ff';
  const FORTE_OVERRIDE = {
    'B5': 'mf',  // original E5 aiff has distortion in the 'ff' sample
  };
  const GAIN_OVERRIDE = {
    'B5': 3.0
  };

  const OCTAVES = [1, 2, 3, 4, 5, 6, 7];

  const KEY_OCTAVES = flatMap(OCTAVES, octave => {
    return KEYS.map(key => [key, octave]);
  });

  const KEY_OCTAVES_STR = KEY_OCTAVES.map(ok => ok[0] + ok[1]);

  const KEY_CODE_NOTES = (function() {
    return flatMap(Object.keys(KEY_NOTE_MAPPING), octave => {
      return KEY_NOTE_MAPPING[octave].map((key, i) => [key, KEYS[i] + octave]);
    }).reduce((map, item) => (map[item[0]] = item[1]) && map, {});
  }());

  const VALID_KEYS = KEY_OCTAVES_STR.reduce((acc, next) => {
    acc[next] = true;
    return acc;
  }, {});


  function prepend(prefix) {
    return str => String(prefix) + str;
  }

  function flatMap(arr, fn) {
    const fin = [];
    arr.forEach(item => {
      fn(item).forEach(sub => fin.push(sub));
    });
    return fin;
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
    const gainNode = context.createGain();
    gainNode.gain.value = gain || 1.0;
    gainNode.connect(compressor);
    gainNodes[key] = gainNode;
    audioSource.buffer = decodedAudio;
    audioSource.connect(gainNode);
    audioSource.start(0, startTime);
  }

  function playNote(key) {
    console.debug('playNote: %o', key);
    const audioData = getAudioData(key);
    const startTime = getAudioStartTime(key);
    return Promise.all([audioData, startTime]).then(res => {
      renderKeyActive(key);
      const gain = GAIN_OVERRIDE[key] || 0.5;
      playAudioData(key, res[0], res[1], gain);
    });
  }

  const gainNodes = {};
  function getGainNode(key) {
    if (gainNodes[key]) {
      return Promise.resolve(gainNodes[key]);
    }
    return Promise.reject(new Error('no gain node for key: ' + key));
  }

  function releaseNote(key) {
    getGainNode(key)
      .then(diminishGain.bind(null, NOTE_RELEASE_SECONDS))
      .catch(() => {});
    renderKeyInactive(key);
  }

  function diminishGain(releaseTime, gainNode) {
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

  function buildPiano(container) {
    KEY_OCTAVES.forEach(ko => {
      makeKey(container, ko[0], ko[1]);
    });
    let mouseKeys = [];
    container.addEventListener('mousedown', e => Promise.resolve(e)
      .then(keyFromEvent)
      .then(key => {
        mouseKeys.push(key);
        return key;
      })
      .then(playNote));
    container.addEventListener('mouseup', e => Promise.resolve(e)
      .then(keyFromEvent)
      .then(() => {
        mouseKeys.forEach(releaseNote);
        mouseKeys = [];
      }));
  }

  function bindKeys() {
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

  function init(container) {
    initAudio();
    buildPiano(container);
    bindKeys();
  }
  global.keyboard = {
    init,
  };
}(window));
