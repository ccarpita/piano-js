(function(global) {

  const context = new AudioContext();
  const compressor = context.createDynamicsCompressor();
  compressor.connect(context.destination);

  const KEYS = [
    'C', 'Db', 'D', 'Eb', 'E', 'F',
    'Gb', 'G', 'Ab', 'A', 'Bb', 'B'
  ];
  const KEY_NOTE_MAPPING = {
    // OCTAVE => KEYLIST
    2: ['1',   '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
    3: ['q',   'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'],
    4: ['a',   's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', '\'', 'RET'],
    5: ['LSH', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'RSH']
  };

  const DEFAULT_FORTE = 'ff';
  const FORTE_OVERRIDE = {
    'B5': 'mf',  // original E5 aiff has distortion in the 'ff' sample
  };
  const GAIN_OVERRIDE = {
    'B5': 3.0
  };

  const OCTAVES = [1, 2, 3, 4, 5, 6, 7];
  OCTAVES.sort();

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


  function flatMap(arr, fn) {
    const fin = [];
    arr.forEach(item => {
      fn(item).forEach(sub => fin.push(sub));
    });
    return fin;
  }

  function getOctaveKey(name) {
    // The octave character is only a single digit number.
    return [Number(name.charAt(0)), name.substr(1)];
  }

  function codeForKeyPress(e) {
    if (e.keyCode === 16) return e.location === 2 ? 'RSH' : 'LSH';
    if (e.keyCode === 13) return 'ENT';
    return e.key.toLowerCase();
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

  function playAudioData(decodedAudio, startTime, gain) {
    console.debug('playAudioData: %o', startTime, gain);
    const audioSource = context.createBufferSource();
    const gainNode = context.createGain();
    gainNode.gain.value = gain || 1.0;
    gainNode.connect(compressor);
    audioSource.buffer = decodedAudio;
    audioSource.connect(gainNode);
    audioSource.start(0, startTime);
  }

  function playKey(key) {
    console.debug('playKey: %o', key);
    const audioData = getAudioData(key);
    const startTime = getAudioStartTime(key);
    console.log(audioData, startTime);
    return Promise.all([audioData, startTime]).then(res => {
      console.debug('playbackData', res);
      const gain = GAIN_OVERRIDE[key] || 0.5;
      playAudioData(res[0], res[1], gain);
    });
  }

  function makeKey(container, key, oct) {
    const el = createElement('div');
    const cont = createElement('div');
    cont.className = 'key-container';
    el.className = 'key key-' + key;
    el.setAttribute('data-key', key + oct);
    container.appendChild(cont);
    cont.appendChild(el);
  }

  function buildPiano(container) {
    KEY_OCTAVES.forEach(ko => {
      makeKey(container, ko[0], ko[1]);
    });
    container.addEventListener('click', e => Promise.resolve(e)
      .then(e => {
        const key = e.target.getAttribute('data-key')
        return key;
      })
      .then(playKey)
    );
  }

  function bindKeys() {
    const keyState = {};
    window.addEventListener('keydown', e => {
      const key = KEY_CODE_NOTES[codeForKeyPress(e)];
      console.log('keyDown', key, VALID_KEYS);
      if (!key) return;
      if (key in VALID_KEYS && !keyState[key]) {
        keyState[key] = true;
        playKey(key);
        lastKey = key;
      }
    });
    window.addEventListener('keyup', e => {
      const key = KEY_CODE_NOTES[codeForKeyPress(e)];
      if (key) keyState[key] = false;
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
