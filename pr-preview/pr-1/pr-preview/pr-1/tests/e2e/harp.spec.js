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
