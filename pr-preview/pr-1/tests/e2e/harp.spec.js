// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Injected before any app code: records console errors, uncaught page errors,
 * whether the AudioContext resumes, and whether a buffer source ever starts
 * (i.e. a note actually plays). This is what catches the "no audio" class of
 * regression — a suspended context, or a note that never reaches playback.
 */
function installAudioSpy() {
  window.__spy = { starts: 0 };
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
        window.__spy.starts++;
        return origStart(...a);
      };
      return src;
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

  test('tapping a hole resumes audio and plays a note', async ({ page }) => {
    const hole = page.locator('.hole-C');
    // Context starts suspended under the browser autoplay policy...
    expect(await page.evaluate(() => window.__audioCtx.state)).toBe('suspended');

    await hole.dispatchEvent('pointerdown');

    // ...and the tap gesture must resume it.
    await expect
      .poll(() => page.evaluate(() => window.__audioCtx.state))
      .toBe('running');
    // A buffer source actually starts once the sample decodes (the sound).
    await expect
      .poll(() => page.evaluate(() => window.__spy.starts), { timeout: 15000 })
      .toBeGreaterThan(0);

    expect(errors, 'no errors while playing').toEqual([]);
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

  test('falls back to mp3 when Ogg is unsupported (Safari)', async ({ page }) => {
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

    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.hole-C').dispatchEvent('pointerdown');

    await expect
      .poll(() => sampleExts.includes('mp3'))
      .toBe(true);
    expect(sampleExts, 'must not request Ogg on a non-Ogg browser').not.toContain('ogg');
    // And a note still reaches playback via the mp3 sample.
    await expect
      .poll(() => page.evaluate(() => window.__spy.starts), { timeout: 15000 })
      .toBeGreaterThan(0);
  });

  test('vertical drag bends the hole octave', async ({ page }) => {
    const hole = page.locator('.hole-C');
    const box = /** @type {{x:number,y:number,width:number,height:number}} */ (
      await hole.boundingBox()
    );
    const cx = box.x + box.width / 2;
    const startY = box.y + box.height - 20;
    const label = hole.locator('.hole-label');

    await hole.dispatchEvent('pointerdown', { clientX: cx, clientY: startY });
    await expect(label).toHaveText('C4');

    // Slide up a full octave's worth of pixels (>140px) -> C5.
    await hole.dispatchEvent('pointermove', { clientX: cx, clientY: startY - 150 });
    await expect(label).toHaveText('C5');

    // Slide well below the start -> clamps at one octave down -> C3.
    await hole.dispatchEvent('pointermove', { clientX: cx, clientY: startY + 300 });
    await expect(label).toHaveText('C3');

    // Release resets the label to the bare note name.
    await hole.dispatchEvent('pointerup', { clientX: cx, clientY: startY + 300 });
    await expect(label).toHaveText('C');

    expect(errors).toEqual([]);
  });
});
