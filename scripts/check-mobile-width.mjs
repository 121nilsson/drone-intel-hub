/**
 * Opens the running app at a phone width and fails when a page is wider than the screen or the
 * menu does not open inside it.
 *
 * jsdom does no layout, so this cannot be a unit test: it drives a real Chrome or Edge against a
 * running app (puppeteer-core brings no browser of its own). It is not part of `npm run green`
 * because it needs the app and its data up; run it after a UI change.
 *
 *   npm run check:mobile                      # http://localhost:3010, 375 px, 12 systems
 *   npm run check:mobile -- --base=http://localhost:3000 --width=360 --systems=30
 *   CHROME_PATH="C:\path\to\chrome.exe" npm run check:mobile
 *
 * Every route is checked, plus the first N systems linked from /catalog (a dossier's width depends
 * on the data it shows, so a sample catches what one page cannot). A finding names the element
 * that reaches past the screen. A scroll container (overflow auto, scroll or hidden) is the
 * intended way to hold something wide and is not a finding.
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const BASE = arg("base", "http://localhost:3010").replace(/\/$/, "");
const WIDTH = Number(arg("width", "375"));
const SYSTEMS = Number(arg("systems", "12"));
const SETTLE_MS = Number(arg("settle", "4000"));

const ROUTES = [
  "/",
  "/catalog",
  "/dispatches",
  "/intake",
  "/audit",
  "/evaluation",
  "/autonomy",
  "/sources",
  "/specs",
  "/spectrum",
  "/taxonomy",
  "/counterparts",
  "/procurement",
  "/families",
  "/settings",
];

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const executablePath = CANDIDATES.find((p) => p && existsSync(p));
if (!executablePath) {
  console.error("No Chrome or Edge found. Set CHROME_PATH to its executable.");
  process.exit(2);
}

/** Runs in the page: how far past the screen things reach, and which element does it. */
function measure() {
  const screenW = document.documentElement.clientWidth;
  const main = document.querySelector("main");
  const scrolls = (el) => {
    const o = getComputedStyle(el).overflowX;
    return o === "auto" || o === "scroll" || o === "hidden";
  };
  const culprits = [];
  for (const el of document.body.querySelectorAll("*")) {
    const box = el.getBoundingClientRect();
    if (!box.width || box.right <= screenW + 1) continue;
    if (getComputedStyle(el).position === "fixed") continue;
    let held = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
      if (scrolls(p)) {
        held = true;
        break;
      }
    if (held || culprits.some((c) => c.el.contains(el))) continue;
    culprits.push({ el, box });
  }
  return {
    screenW,
    page: document.documentElement.scrollWidth,
    // main clips sideways overflow, so the page can look fine while content is cut off.
    main: main ? main.scrollWidth : 0,
    mainW: main ? main.clientWidth : 0,
    culprits: culprits.slice(0, 3).map(({ el, box }) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute("class") || "").slice(0, 90),
      right: Math.round(box.right),
      text: (el.textContent || "").trim().slice(0, 60),
    })),
  };
}

const browser = await puppeteer.launch({ executablePath, headless: true });
const findings = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(page, path) {
  await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60_000 });
  await pause(SETTLE_MS);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: 812, isMobile: true, hasTouch: true });

  await open(page, "/catalog");
  const systems = await page.$$eval('a[href^="/systems/"]', (links) => [
    ...new Set(links.map((a) => a.getAttribute("href"))),
  ]);
  const paths = [...ROUTES, ...systems.slice(0, SYSTEMS)];

  for (const path of paths) {
    try {
      await open(page, path);
      const m = await page.evaluate(measure);
      const wide = m.page > m.screenW + 1 || m.main > m.mainW + 1;
      console.log(
        `${wide ? "WIDE" : "ok  "} ${path}  page ${m.page}/${m.screenW}  main ${m.main}/${m.mainW}`,
      );
      if (wide) findings.push({ path, ...m });
    } catch (e) {
      console.log(`FAIL ${path}  ${e.message}`);
      findings.push({ path, error: e.message });
    }
  }

  // The menu has to open inside the screen, on a short page and on the widest one found.
  for (const path of ["/", ...findings.filter((f) => !f.error).map((f) => f.path)].slice(0, 2)) {
    await open(page, path);
    await page.click('button[aria-label="Open menu"]');
    await pause(700);
    const drawer = await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"]');
      const b = el?.getBoundingClientRect();
      return b ? { left: Math.round(b.left), right: Math.round(b.right) } : null;
    });
    const inside = drawer && drawer.left >= 0 && drawer.right <= WIDTH + 1;
    console.log(`${inside ? "ok  " : "MENU"} menu on ${path}  ${JSON.stringify(drawer)}`);
    if (!inside) findings.push({ path, menu: drawer });
  }
} finally {
  await browser.close();
}

if (findings.length) {
  console.log(`\n${findings.length} finding(s) at ${WIDTH} px:`);
  for (const f of findings) {
    console.log(`- ${f.path}`);
    if (f.error) console.log(`    ${f.error}`);
    if (f.menu !== undefined)
      console.log(`    the menu is not inside the screen: ${JSON.stringify(f.menu)}`);
    for (const c of f.culprits ?? [])
      console.log(`    <${c.tag}> reaches ${c.right}px: "${c.text}"  ${c.cls}`);
  }
  process.exit(1);
}
console.log(`\nAll ${WIDTH} px checks passed.`);
