// Renders the award PNGs (from scripts/.award-jobs.json, written by build.mjs) and the brand
// images (favicons, app icons, default share image) into static/. Needs Playwright + Chromium.
//   node scripts/render-images.mjs          # awards + brand images
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { pinPaths } from "./award.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const font = (f) => "data:font/woff2;base64," + fs.readFileSync(path.join(ROOT, "static/fonts", f)).toString("base64");
const css = `@font-face{font-family:Anton;src:url(${font("anton-latin.woff2")})}
@font-face{font-family:Poppins;font-weight:600;src:url(${font("poppins-latin-600.woff2")})}
@font-face{font-family:Poppins;font-weight:700;src:url(${font("poppins-latin-700.woff2")})}
@font-face{font-family:Poppins;font-weight:800;src:url(${font("poppins-latin-800.woff2")})}
html,body{margin:0;background:transparent}`;

const browser = await chromium.launch();
async function shot(html, out, w, h, scale = 2, opts = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.setContent(`<style>${css}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(ROOT, "static", out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: !opts.background, clip: { x: 0, y: 0, width: w, height: h }, ...(opts.jpeg ? { type: "jpeg", quality: 88 } : {}) });
  await page.close();
}

// Awards
const jobs = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/.award-jobs.json"), "utf8"));
for (const j of jobs) await shot(`<div style="width:${j.w}px;height:${j.h}px">${j.svg.replace("<svg ", `<svg width="${j.w}" height="${j.h}" `)}</div>`, j.out, j.w, j.h, 2);

// Brand images
const pin = (id, w) => `<svg viewBox="0 0 120 160" width="${w}" height="${(w * 160) / 120}">${pinPaths(id)}</svg>`;
fs.writeFileSync(path.join(ROOT, "static/img/favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 0 160 160">${pinPaths("f")}</svg>\n`);
const icon = (size, bg) => `<div style="width:${size}px;height:${size}px;display:grid;place-items:center;${bg ? `background:${bg};` : ""}">${pin("i" + size, size * 0.62)}</div>`;
await shot(icon(32), "img/favicon-32.png", 32, 32, 1);
await shot(icon(180, "#fbf8ef"), "img/apple-touch-icon.png", 180, 180, 1, { background: true });
await shot(icon(512, "#fbf8ef"), "img/icon-512.png", 512, 512, 1, { background: true });

const og = `<div style="width:1200px;height:630px;position:relative;overflow:hidden;background:linear-gradient(115deg,#e8f7f4 0%,#fbf8ef 45%,#fff1df 100%);font-family:Poppins">
  <div style="position:absolute;top:44px;right:60px;width:220px;height:100px;background-image:radial-gradient(#ff8e0a 3px,transparent 3.6px);background-size:24px 24px;opacity:.55"></div>
  <svg viewBox="0 0 1440 140" preserveAspectRatio="none" style="position:absolute;left:0;right:0;bottom:0;width:100%;height:150px"><path d="M0 70c180-40 360-40 540 0s360 40 540 0 270-40 360-20v110H0z" fill="#7fd6cc" opacity=".55"/><path d="M0 100c200-36 420-30 640 4s440 34 800-18v54H0z" fill="#ffd3a1" opacity=".8"/><path d="M0 118c260-20 520-14 760 6s460 14 680-8v24H0z" fill="#2cb6bd" opacity=".35"/></svg>
  <div style="position:absolute;left:90px;top:120px;display:flex;align-items:center;gap:44px">
    ${pin("og", 190)}
    <div>
      <div style="font-family:Anton;font-size:128px;line-height:.95;color:#0b2545;text-transform:uppercase">Local<br>Vibe Check</div>
      <div style="position:relative;width:560px;height:8px;border-radius:4px;margin:28px 0 24px;background:linear-gradient(90deg,#19b3b8,#7fc9b0 45%,#ff8e0a)"><span style="position:absolute;right:-9px;top:-5px;width:18px;height:18px;border-radius:50%;background:#ff8e0a"></span></div>
      <div style="font-family:Anton;font-size:40px;color:#0b7a80;text-transform:uppercase;letter-spacing:.02em">Price guides · Places · Trusted local businesses</div>
    </div>
  </div>
  <div style="position:absolute;left:90px;bottom:44px;background:#0b2545;color:#fbf8ef;font-weight:700;font-size:24px;padding:10px 22px;border-radius:999px;display:flex;gap:12px;align-items:center"><span style="width:14px;height:14px;border-radius:50%;background:#ff8e0a"></span>localvibecheck.site</div>
</div>`;
await shot(og, "img/og-default.jpg", 1200, 630, 1, { background: true, jpeg: true });

await browser.close();
console.log(`Rendered ${jobs.length} award PNGs and brand images`);
