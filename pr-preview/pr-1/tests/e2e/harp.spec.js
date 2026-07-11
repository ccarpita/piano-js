// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Injected before any app code: records console errors, uncaught page errors,
 * whether the AudioContext resumes, and whether a buffer source ever starts
 * (i.e. a note actually plays). This is what catches the "no audio" class of
 * regression — a suspended context, or a note that never reaches playback.
 */
function installAudioSpy() {
  window.__spy = { starts: 0, oscFreqs: [] };
  const OrigContext = window.AudioContext;
  window.AudioContext = class extends OrigContext {
    constructor(...args) {
      super(...args);
      window.__audioCtx = this;
      // Analyser tap so tests can read the real signal reaching the output.
      window.__analyser = this.createAnalyser();
      window.__analyser.fftSize = 2048;
    }
    createBufferSource() {
      const src = super.createBufferSource();
      const origStart = src.start.bind(src);
      src.start = (...a) => {
        // Ignore the 1-sample silent buffer used to unlock iOS audio; only
        // real (long) sample buffers count as a note reaching playback.
        if (src.buffer && src.buffer.length > 1) window.__spy.starts++;
        return origStart(...a);
      };
      return src;
    }
    createOscillator() {
      const osc = super.createOscillator();
      const origStart = osc.start.bind(osc);
      osc.start = (...a) => {
        window.__spy.oscFreqs.push(osc.frequency.value);
        return origStart(...a);
      };
      return osc;
    }
  };
  // Mirror anything connected to the destination into the analyser so we can
  // measure the master output amplitude.
  const proto = window.AudioNode.prototype;
  const origConnect = proto.connect;
  proto.connect = function (dest, ...rest) {
    const result = origConnect.call(this, dest, ...rest);
    try {
      if (window.__audioCtx && dest === window.__audioCtx.destination && window.__analyser) {
        origConnect.call(this, window.__analyser);
      }
    } catch (e) { /* not an audio-node destination */ }
    return result;
  };
  window.__outputPeak = () => {
    const a = window.__analyser;
    if (!a) return -1;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) { const x = Math.abs(v); if (x > peak) peak = x; }
    return peak;
  };
}

/** Errors we consider benign and unrelated to the app under test. */
function isBenign(text) {
  return /favicon/i.test(text);
}

test.describe('Piano.js Harp Mode', () => {
  /** @type {string[]} */
  let errors;

  test.beforeEach(async ({ page, context }) => {
    errors = [];
    await context.grantPermissions(['midi']).catch(() => {});
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const url = (msg.location() && msg.location().url) || '';
      if (isBenign(msg.text()) || isBenign(url)) return;
      errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));
    await page.addInitScript(installAudioSpy);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    // Give app init and MIDI probing a moment to run and surface any errors.
    await page.waitForTimeout(500);
  });

  test('loads and renders the harp without JS errors', async ({ page }) => {
    await expect(page.locator('.harp')).toBeVisible();
    // One octave of holes = 12 chromatic tap targets.
    await expect(page.locator('.harp .hole')).toHaveCount(12);
    await expect(page.locator('.harp-stepper .step-value')).toHaveText('Octave 4');
    expect(errors, 'no console/page errors on load').toEqual([]);
  });

  /** Center point of a hole, for driving the real mouse/pointer. */
  async function holeCenter(page, note) {
    const box = await page.locator('.hole-' + note).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  }

  test('pressing a hole resumes audio and plays a note', async ({ page }) => {
    const c = await holeCenter(page, 'C');
    // Context starts suspended under the browser autoplay policy...
    expect(await page.evaluate(() => window.__audioCtx.state)).toBe('suspended');

    await page.mouse.move(c.x, c.y);
    await page.mouse.down();

    // ...and the gesture must resume it.
    await expect
      .poll(() => page.evaluate(() => window.__audioCtx.state))
      .toBe('running');
    // A buffer source actually starts once the sample decodes (the sound).
    await expect
      .poll(() => page.evaluate(() => window.__spy.starts), { timeout: 15000 })
      .toBeGreaterThan(0);
    await page.mouse.up();

    expect(errors, 'no errors while playing').toEqual([]);
  });

  test('gliding across holes plays each one without a separate tap', async ({ page }) => {
    const c = await holeCenter(page, 'C');
    const e = await holeCenter(page, 'E');
    const y = c.y;

    await page.mouse.move(c.x, y);
    await page.mouse.down();
    // Slide sideways from C to E; every column crossed should sound.
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(c.x + ((e.x - c.x) * i) / steps, y);
    }
    await page.mouse.up();

    // C, Db, D, Eb, E => several distinct notes triggered from one gesture.
    await expect
      .poll(() => page.evaluate(() => window.__spy.starts), { timeout: 15000 })
      .toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  });

  test('the test tone produces audible master output', async ({ page }) => {
    await page.getByRole('button', { name: 'Test tone' }).click();
    // The oscillator needs no samples, so output should appear promptly.
    let peak = 0;
    await expect
      .poll(async () => {
        const p = await page.evaluate(() => window.__outputPeak());
        if (p > peak) peak = p;
        return peak;
      }, { timeout: 5000 })
      .toBeGreaterThan(0.01);
    expect(errors).toEqual([]);
  });

  test('the volume slider mutes the master output', async ({ page }) => {
    // Turn the master volume to zero, then the test tone should stay silent.
    await page.getByLabel('Master volume').evaluate((el) => {
      el.value = '0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(150); // let the gain ramp settle to zero
    await page.getByRole('button', { name: 'Test tone' }).click();

    let peak = 0;
    for (let i = 0; i < 20; i++) {
      peak = Math.max(peak, await page.evaluate(() => window.__outputPeak()));
      await page.waitForTimeout(50);
    }
    expect(peak, 'output stays silent at zero volume').toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });

  test('falls back to mp3 when Ogg is unsupported (Safari)', async ({ browser, baseURL }) => {
    // Use a dedicated page so no Ogg load from the shared page's navigation can
    // contaminate the request log.
    const page = await browser.newPage();
    try {
      await page.addInitScript(installAudioSpy);
      // Simulate a browser (Safari) that cannot decode Ogg Vorbis.
      await page.addInitScript(() => {
        const proto = window.HTMLMediaElement.prototype;
        const orig = proto.canPlayType;
        proto.canPlayType = function (type) {
          return /ogg/i.test(type) ? '' : orig.call(this, type);
        };
      });
      const sampleExts = [];
      page.on('request', (req) => {
        const m = req.url().match(/Piano\.ff\.[^/]+\.(ogg|mp3)$/);
        if (m) sampleExts.push(m[1]);
      });

      await page.goto(baseURL + '/index.html', { waitUntil: 'domcontentloaded' });
      const box = await page.locator('.hole-C').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();

      await expect.poll(() => sampleExts.includes('mp3')).toBe(true);
      expect(sampleExts, 'must not request Ogg on a non-Ogg browser').not.toContain('ogg');
      // And a note still reaches playback via the mp3 sample.
      await expect
        .poll(() => page.evaluate(() => window.__spy.starts), { timeout: 15000 })
        .toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  test('vertical drag mixes in the 3rd and 5th harmonics', async ({ page }) => {
    const box = (await holeCenter(page, 'C')).box;
    const cx = box.x + box.width / 2;
    const startY = box.y + box.height - 20;
    const label = page.locator('.hole-C .hole-label');
    const tilt = () =>
      page.evaluate(() =>
        Number(document.querySelector('.hole-C').style.getPropertyValue('--tilt') || '0'));

    await page.mouse.move(cx, startY);
    await page.mouse.down();
    await expect(label).toHaveText('C4');

    // Two partials are layered at 3x and 5x the fundamental (C4 ~261.63 Hz).
    const f = 261.6256;
    const freqs = await page.evaluate(() => window.__spy.oscFreqs);
    expect(freqs.some((x) => Math.abs(x - 3 * f) < 1), 'a 3rd-harmonic partial').toBe(true);
    expect(freqs.some((x) => Math.abs(x - 5 * f) < 1), 'a 5th-harmonic partial').toBe(true);

    // Slide up -> positive tilt (3rd-harmonic emphasis).
    await page.mouse.move(cx, startY - 130);
    await expect.poll(tilt).toBeGreaterThan(0.5);

    // Slide down past the start (same column) -> negative tilt (5th harmonic).
    await page.mouse.move(cx, startY + 130);
    await expect.poll(tilt).toBeLessThan(-0.5);

    // The pitch never changes — the label stays at the base octave throughout.
    await expect(label).toHaveText('C4');

    await page.mouse.up();
    await expect(label).toHaveText('C');
    expect(errors).toEqual([]);
  });
});
