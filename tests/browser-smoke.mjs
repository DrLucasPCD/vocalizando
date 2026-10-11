import assert from "node:assert/strict";
const engines = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.BROWSER_ENGINE || "chromium";
const browser = await engines[engine].launch({
  ...(engine === "chromium" && process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: true,
  ...(engine === "chromium" ? { args: ["--autoplay-policy=no-user-gesture-required"] } : {})
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
const warnings = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
try {
  await page.goto(process.env.APP_URL || "http://localhost:8765/Index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".functional-report-row").length === 9);
  const ids = ["respiracao", "voz", "articulacao", "vogais", "consoantes", "ritmo", "prosodia", "sequenciamento", "transferencia"];
  for (const id of ids) {
    await page.selectOption("#functional-exercise", id);
    await page.click("#functional-add-attempt");
  }
  await page.click('[data-adjust="tara"][data-delta="1"]');
  await page.click('[data-adjust="iii"][data-delta="1"]');
  await page.evaluate(async () => {
    const attempt = JSON.parse(localStorage.getItem("vocalizing-functional-v1"))[0];
    await window.vocalizandoData.saveRecording({ id: "linked-clip", kind: "functional", exercise: attempt.exercise, prompt: attempt.prompt, at: attempt.at, attemptIds: [attempt.id], blob: new Blob(["test"], { type: "audio/webm" }) });
  });
  assert.equal(await page.locator(".week-day:last-child .week-value").textContent(), "11");
  await page.evaluate(async () => {
    await window.vocalizandoData.saveRecording({ id: "twister-clip", kind: "twister", at: new Date().toISOString(), prompt: "Frase de teste", blob: new Blob(["test"], { type: "audio/webm" }) });
  });
  await page.waitForFunction(() => document.getElementById("overall-score").textContent === "12");
  assert.equal(await page.locator(".week-day:last-child .week-value").textContent(), "12");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("overall-score").textContent === "12");
  await page.selectOption("#functional-exercise", "voz");
  await page.evaluate(() => {
    const signature = { frames: Array.from({ length: 12 }, () => [0.1, 0.2, 0.2, 0.1, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05]), durationMs: 1200, voicedMs: 1000, pauseMs: 200, quality: { snrDb: 20, clipping: 0, usable: true } };
    functionalCountAttempt("auto", 1000, signature);
    functionalSetReference();
    functionalCountAttempt("auto", 1000, signature);
    functionalCountAttempt("auto", 1000, signature);
  });
  assert.equal(await page.locator("#functional-score").textContent(), "100/100");
  assert.match(await page.locator("#functional-attempt-measures").textContent(), /Duração1,2 s/);
  assert.match(await page.locator("#functional-comparison").textContent(), /Mesma frase e referência/);
  await page.evaluate(() => functionalCountAttempt("auto", 1000, { frames: Array(12).fill(Array(10).fill(0.1)), durationMs: 1200, voicedMs: 1000, pauseMs: 200, quality: { usable: false } }));
  assert.equal(await page.locator("#functional-score").textContent(), "—");
  assert.match(await page.locator("#functional-score-detail").textContent(), /sem nota/);
  await page.selectOption("#functional-exercise", "transferencia");
  await page.evaluate(() => functionalCountAttempt("auto", 2000, { frames: Array(12).fill(Array(10).fill(0.1)), durationMs: 2500, voicedMs: 2000, pauseMs: 500, quality: { usable: true } }));
  assert.equal(await page.locator("#functional-set-reference").isDisabled(), true);
  assert.match(await page.locator("#functional-score-detail").textContent(), /resposta livre/);

  await page.evaluate(() => {
    Object.getPrototypeOf(navigator.mediaDevices).getUserMedia = async () => {
      const context = new AudioContext();
      const source = context.createOscillator();
      source.frequency.value = 220;
      const gain = context.createGain();
      gain.gain.value = 0;
      const output = context.createMediaStreamDestination();
      source.connect(gain).connect(output);
      const muted = context.createGain();
      muted.gain.value = 0;
      gain.connect(muted).connect(context.destination);
      source.start();
      await context.resume();
      window.testMicrophone = { context, gain, stream: output.stream };
      return output.stream;
    };
  });
  await page.click("#functional-calibrate");
  await page.waitForFunction(() => document.getElementById("functional-calibration-status").textContent.startsWith("Agora diga"));
  await page.evaluate(() => { window.testMicrophone.gain.gain.value = 0.01; });
  await page.waitForFunction(() => document.getElementById("functional-calibration-status").textContent.startsWith("Voz calibrada"), { timeout: 10000 });
  await page.evaluate(() => window.testMicrophone.context.close());
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("vocalizing-mic-calibration-v1")).threshold > 0));

  await page.selectOption("#functional-exercise", "voz");
  const before = Number(await page.locator('#report-functional-list [data-exercise-id="voz"] dd').first().textContent());
  await page.click("#functional-record");
  await page.waitForFunction(() => functionalListening);
  await page.evaluate(() => { window.testMicrophone.gain.gain.value = 0.01; });
  await page.waitForTimeout(900);
  await page.evaluate(() => { window.testMicrophone.gain.gain.value = 0; });
  await page.waitForFunction(count => Number(document.querySelector('[data-exercise-id="voz"] dd').textContent) === count + 1, before);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert.equal(await page.evaluate(() => functionalListening), false);
  await page.waitForFunction(() => document.querySelector("#functional-audio-list audio"));
  await page.check("#functional-consent-audio");
  const totalBeforeSaving = await page.locator(".week-day:last-child .week-value").textContent();
  await page.locator("#functional-audio-list button").click();
  await page.waitForFunction(() => document.querySelector("#functional-audio-list button").textContent === "Áudio guardado");
  assert.equal(await page.locator(".week-day:last-child .week-value").textContent(), totalBeforeSaving);
  await page.evaluate(() => window.testMicrophone.context.close());

  await page.evaluate(() => {
    Object.getPrototypeOf(navigator.mediaDevices).getUserMedia = () => new Promise(resolve => { window.resolveTestPermission = resolve; });
    functionalStartRecording();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.evaluate(() => {
    const context = new AudioContext();
    const output = context.createMediaStreamDestination();
    window.pendingTestStream = output.stream;
    window.resolveTestPermission(output.stream);
    context.close();
  });
  await page.waitForFunction(() => window.pendingTestStream.getTracks().every(track => track.readyState === "ended"));
  assert.equal(await page.evaluate(() => functionalListening), false);
  await page.evaluate(() => {
    const savedCreateModel = createModel;
    createModel = () => new Promise(resolve => { window.resolveTestModel = () => { createModel = savedCreateModel; resolve(); }; });
    recognizer = null;
    modelLoadPromise = null;
    startRecognition();
  });
  await page.evaluate(() => { window.dispatchEvent(new Event("pagehide")); window.resolveTestModel(); });
  await page.waitForFunction(() => !recognitionInFlight);
  assert.equal(await page.evaluate(() => modelListening), false);
  await page.evaluate(() => {
    window.vocalizandoHistory.write(todayKey(), { ...state, tara: 17 });
    loadCounts();
    adjustExerciseCount("tara", 1);
  });
  assert.equal(await page.evaluate(() => state.tara), 17);
  await page.evaluate(() => adjustExerciseCount("tara", -1));
  assert.equal(await page.evaluate(() => state.tara), 16);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator(".functional-listening-settings").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/vocalizando-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".functional-listening-settings").scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "/tmp/vocalizando-desktop.png" });
  assert.deepEqual(errors, []);
  console.log("Browser checks passed: all exercises, linked audio, scores, calibration, interruptions, persistence and responsive layouts.");
} catch (error) {
  console.error(await page.evaluate(() => ({ calibration: document.getElementById("functional-calibration-status")?.textContent, status: document.getElementById("functional-status")?.textContent, audioState: window.testMicrophone?.context.state, calibrationState: functionalCalibration?.context?.state, errors: [] })));
  console.error(errors);
  console.error(warnings);
  throw error;
} finally { await browser.close(); }
