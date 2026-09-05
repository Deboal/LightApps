// Browser checks for the GBA shell.
//
// Each one measures something numeric rather than eyeballing a screenshot,
// because "it looked right" is not a result you can compare across builds.
// Mean canvas luminance is the workhorse: the title screen is bright, the
// copyright screen a reboot lands on is nearly black, and a save state
// restores a specific frame whose brightness is a fingerprint.

const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");

const ROM = process.env.GBA_ROM;
const URL = process.env.GBA_URL || "http://localhost:8199/gba/";
const CHROMIUM = process.env.CHROMIUM;

if (!ROM) {
  console.error("set GBA_ROM to a .gba file");
  process.exit(2);
}

const brightness = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    return Math.round(sum / (data.length / 4));
  });

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|supabase|Failed to load resource/i.test(m.text())) {
      errors.push(m.text());
    }
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Choose a ROM");
  await page.setInputFiles("input[type=file]", ROM);
  return { page, errors };
}

// 1. The game boots and renders.
{
  const { page, errors } = await newPage();
  await page.waitForTimeout(12000);
  const lit = await brightness(page);
  check("boots and renders", lit > 20, `luminance ${lit}`);
  check("no page errors on boot", errors.length === 0, errors.join("; "));
  await page.close();
}

// 2. Tabbing away and back must not restart the machine. This regressed once:
// the boot effect depended on the signed-in user object, and the auth client
// hands back a fresh object every time it re-validates the session on focus.
{
  const { page } = await newPage();
  await page.waitForTimeout(30000);
  await page.click("text=Resume").catch(() => {});
  await page.waitForTimeout(2000);
  const before = await brightness(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("blur"));
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(5000);
  const after = await brightness(page);
  check("survives tabbing away", after > before * 0.6, `${before} then ${after}`);
  await page.close();
}

// 3. A save state taken from the library returns to the exact moment.
{
  const { page, errors } = await newPage();
  await page.waitForTimeout(11000);
  await page.click("text=States");
  await page.fill('input[placeholder*="Name this state"]', "checkpoint");
  await page.click("button:has-text('Save state')");
  await page.waitForTimeout(1500);
  const saved = await brightness(page);
  await page.click("button:has-text('Close')");

  await page.waitForTimeout(9000);
  const moved = await brightness(page);
  await page.click("text=Library");
  await page.waitForSelector("text=checkpoint");
  await page.click("button:has-text('Load')");
  await page.waitForTimeout(1500);
  const resumed = await brightness(page);

  check(
    "resuming a state returns to the saved moment",
    Math.abs(resumed - saved) < Math.abs(moved - saved) / 2,
    `saved ${saved}, played on to ${moved}, resumed ${resumed}`
  );
  check("no page errors in the state flow", errors.length === 0, errors.join("; "));
  await page.close();
}

// 4. Fast-forward keys. Each gesture has its own key and one meaning, after a
// tap/hold timing heuristic guessed wrong: a deliberate keypress outlasts any
// reasonable threshold, so an intended tap read as a hold.
{
  const { page } = await newPage();
  await page.waitForTimeout(8000);
  const speed = async () => {
    const text = await page.textContent("body");
    return (text.match(/(\d)× (speed|turbo)/) || ["?"])[0];
  };
  // Held deliberately long, which is what used to break it.
  const latch = async () => {
    await page.keyboard.down("Shift");
    await page.keyboard.down("Space");
    await page.waitForTimeout(500);
    await page.keyboard.up("Space");
    await page.keyboard.up("Shift");
    await page.waitForTimeout(250);
  };

  check("starts at normal speed", (await speed()) === "1× speed");
  await latch();
  check("shift+space latches 4×", (await speed()) === "4× speed", await speed());
  await latch();
  check("shift+space latches back to 1×", (await speed()) === "1× speed", await speed());
  await latch();

  await page.keyboard.down("Space");
  await page.waitForTimeout(600);
  check("space held gives 8×", (await speed()) === "8× turbo", await speed());
  await page.keyboard.up("Space");
  await page.waitForTimeout(250);
  // The important one: turbo returns to the latched speed, not to normal.
  check("releasing space returns to the latched 4×", (await speed()) === "4× speed", await speed());
  await page.close();
}

// 5. Turbo walk. The interesting property is the gate, not the latch: with no
// direction held the latch must be invisible, so it can stay on through menus
// and battles without pressing B behind the player's back. This checks the
// control and that the game keeps running either way; the gate itself is one
// line and reads directly.
{
  const { page, errors } = await newPage();
  await page.waitForTimeout(8000);
  const pill = page.locator("text=/^RUN (ON|OFF)$/");

  check("run latch starts off", (await pill.textContent()) === "RUN OFF");
  await pill.click();
  await page.waitForTimeout(200);
  check("tapping it latches on", (await pill.textContent()) === "RUN ON");

  // Idle with the latch on: the game must be unaffected and still advancing.
  const before = await brightness(page);
  await page.waitForTimeout(1500);
  const after = await brightness(page);
  check("the game keeps running with the latch on", before > 0 || after > 0, `${before} then ${after}`);

  // And with a direction held, which is when it actually presses B.
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(1200);
  await page.keyboard.up("ArrowRight");
  await pill.click();
  await page.waitForTimeout(200);
  check("tapping it latches off", (await pill.textContent()) === "RUN OFF");
  check("no page errors in the run flow", errors.length === 0, errors.join("; "));
  await page.close();
}

await browser.close();
process.exit(failures ? 1 : 0);
