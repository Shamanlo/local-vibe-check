// The "Vibe Check: Passed" award for businesses in the Business Spotlight series.
//   awardSeal - round seal (240x240), for websites, socials and print
//   awardBar  - horizontal badge (360x100), for website footers and email signatures
// Colors and type follow the channel: navy, teal, orange, cream; Anton + Poppins.

export const C = {
  navy: "#0b2545", navy2: "#13345f", teal: "#19b3b8", teal2: "#2fd6c6",
  blue: "#0a55c2", orange: "#ff8e0a", cream: "#fbf8ef",
};
const ANTON = "Anton, Impact, 'Arial Narrow', sans-serif";
const POP = "Poppins, 'Segoe UI', Arial, sans-serif";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fit = (text, base, maxWidth, em) => Math.min(base, maxWidth / (String(text).length * em));

// The channel's map pin (videos/_engine/assets/pin.svg), drawn in a 120x160 box.
export const pinPaths = (id) => `<defs><linearGradient id="${id}-pg" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#2fd6c6"/><stop offset=".55" stop-color="#1388d8"/><stop offset="1" stop-color="#0a4fb8"/></linearGradient></defs>
<path d="M60 4C29 4 6 27 6 57c0 37 46 88 51 97a3.5 3.5 0 0 0 6 0c5-9 51-60 51-97C114 27 91 4 60 4z" fill="url(#${id}-pg)"/>
<circle cx="60" cy="57" r="31" fill="#fff"/>
<path d="M45 58l10 10 21-22" fill="none" stroke="${C.orange}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;

export const pinSvg = (id = "pin", cls = "pin") =>
  `<svg class="${cls}" viewBox="0 0 120 160" aria-hidden="true" focusable="false">${pinPaths(id)}</svg>`;

const check = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.cream}"/>
  <path d="M ${cx - r * 0.45} ${cy + r * 0.02} l ${r * 0.3} ${r * 0.3} l ${r * 0.58} ${-r * 0.6}" fill="none" stroke="${C.orange}" stroke-width="${(r * 0.26).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;

export function awardSeal({ id = "aw", line, year, title }) {
  const lineU = String(line).toUpperCase();
  const lineSize = fit(lineU, 11.5, 190, 0.66);
  const r = 94;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="${esc(title)}" class="award-svg">
  <title>${esc(title)}</title>
  <defs>
    <path id="${id}-top" d="M ${120 - r} 120 A ${r} ${r} 0 0 1 ${120 + r} 120" fill="none"/>
    <path id="${id}-bot" d="M ${120 - r} 120 A ${r} ${r} 0 0 0 ${120 + r} 120" fill="none"/>
    <linearGradient id="${id}-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.teal}"/><stop offset=".5" stop-color="#7fc9b0"/><stop offset="1" stop-color="${C.orange}"/></linearGradient>
    <radialGradient id="${id}-disc" cx="50%" cy="36%" r="72%"><stop offset="0" stop-color="#1a4377"/><stop offset="1" stop-color="${C.navy}"/></radialGradient>
  </defs>
  <circle cx="120" cy="120" r="119" fill="${C.navy}"/>
  <circle cx="120" cy="120" r="113" fill="none" stroke="url(#${id}-ring)" stroke-width="3"/>
  <circle cx="120" cy="120" r="85" fill="url(#${id}-disc)" stroke="url(#${id}-ring)" stroke-width="3"/>
  <circle cx="120" cy="120" r="79" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="1" stroke-dasharray="2 4"/>
  <text font-family="${ANTON}" font-size="16" letter-spacing="2.6" fill="${C.cream}"><textPath href="#${id}-top" startOffset="50%" text-anchor="middle">LOCAL VIBE CHECK</textPath></text>
  <text font-family="${POP}" font-weight="700" font-size="${lineSize.toFixed(1)}" letter-spacing="1.4" fill="${C.teal2}"><textPath href="#${id}-bot" startOffset="50%" text-anchor="middle" dominant-baseline="hanging">${esc(lineU)}</textPath></text>
  <circle cx="17" cy="120" r="4" fill="${C.orange}"/><circle cx="223" cy="120" r="4" fill="${C.orange}"/>
  <g transform="translate(107 47) scale(.215)">${pinPaths(id)}</g>
  <text x="120" y="102" text-anchor="middle" font-family="${POP}" font-weight="800" font-size="13.5" letter-spacing="1.6" fill="${C.cream}">VIBE CHECK:</text>
  <rect x="53" y="109" width="134" height="38" rx="10" fill="${C.teal2}" fill-opacity=".1" stroke="${C.teal2}" stroke-width="3"/>
  ${check(74, 128, 11.5)}
  <text x="137" y="137.5" text-anchor="middle" font-family="${POP}" font-weight="800" font-size="24" textLength="90" lengthAdjust="spacingAndGlyphs" fill="${C.teal2}">PASSED</text>
  <path d="M 58 154 L 182 154 L 175 165.5 L 182 177 L 58 177 L 65 165.5 Z" fill="${C.orange}"/>
  <text x="120" y="170.5" text-anchor="middle" font-family="${ANTON}" font-size="13" textLength="96" lengthAdjust="spacing" fill="${C.navy}">SPOTLIGHT · ${esc(year)}</text>
</svg>`;
}

export function awardBar({ id = "ab", year, title }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 100" role="img" aria-label="${esc(title)}" class="award-bar-svg">
  <title>${esc(title)}</title>
  <defs><linearGradient id="${id}-line" x1="0" x2="1"><stop offset="0" stop-color="${C.teal}"/><stop offset=".45" stop-color="#7fc9b0"/><stop offset="1" stop-color="${C.orange}"/></linearGradient></defs>
  <rect x="1" y="1" width="358" height="98" rx="16" fill="${C.navy}"/>
  <rect x="1" y="1" width="358" height="98" rx="16" fill="none" stroke="url(#${id}-line)" stroke-width="2"/>
  <g transform="translate(18 18) scale(.4)">${pinPaths(id)}</g>
  <text x="80" y="38" font-family="${POP}" font-weight="800" font-size="15" letter-spacing="1" fill="${C.cream}">VIBE CHECK:</text>
  <rect x="196" y="16" width="112" height="31" rx="8" fill="${C.teal2}" fill-opacity=".1" stroke="${C.teal2}" stroke-width="2.4"/>
  ${check(213, 31.5, 9)}
  <text x="266" y="39.5" text-anchor="middle" font-family="${POP}" font-weight="800" font-size="19" textLength="70" lengthAdjust="spacingAndGlyphs" fill="${C.teal2}">PASSED</text>
  <rect x="80" y="57" width="262" height="2.5" rx="1.25" fill="url(#${id}-line)"/>
  <text x="80" y="82" font-family="${ANTON}" font-size="15" textLength="262" lengthAdjust="spacing" fill="${C.cream}">LOCAL VIBE CHECK <tspan fill="${C.orange}">·</tspan> BUSINESS SPOTLIGHT ${esc(year)}</text>
</svg>`;
}
