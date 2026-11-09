// Turns a Local Vibe Check YouTube description into structured blocks for the site.
// The channel writes descriptions in a steady format (intro, 🔗 links, "Heading:" + "• item"
// lists, a 📞/🛠️ call-to-action, "Chapters:", a source note, hashtags), so new uploads get a
// full page without anyone retyping them.

const LINK_EMOJI = /^(🔗|📊|🏆|▶️)\s*/u;
const CTA_START = /^(📞|🛠️|🛠|📍)\s*/u;
const EMOJI_LEAD = /^\p{Extended_Pictographic}️?\s*/u;
const TIME = /^(\d{1,2}:)?\d{1,2}:\d{2}\s+/;
const URL = /^https?:\/\/\S+$/;

const stripEmoji = (s) => s.replace(EMOJI_LEAD, "").trim();

// "Label: $1 – $2 (detail)" -> { label, value, detail }
export function splitItem(text) {
  let label = "", value = text, detail = "";
  const m = text.match(/^([^:$]{1,90}?):\s+(.+)$/);
  if (m) { label = m[1].trim(); value = m[2].trim(); }
  const d = value.match(/^(.*?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\.?$/);
  if (d && d[1]) { value = d[1].trim(); detail = d[2].trim(); }
  return { label, value, detail, text };
}

const NOTE = /^(Prices|National averages|Iowa averages|The AI chat|All prices|Price ranges|Comparison|Every detail in this)|ballpark|as published|placeholder|Map data ©/i;
const isListBlock = (block) => block.length > 1 && block.slice(1).some(isList);
const isList = (l) => /^(•|-|\d+\.)\s+/.test(l) || (EMOJI_LEAD.test(l) && /:/.test(l) && !CTA_START.test(l) && !/^(📍|🌐|✉️|🕗|📞)/u.test(l));

export function parseDescription(desc = "") {
  const out = { intro: [], links: [], sections: [], cta: null, chapters: [], notes: [], hashtags: [], pick: null };
  const blocks = desc.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  let seenStructure = false;
  let inCta = false;

  for (const block of blocks) {
    const first = block[0];

    if (/^chapters:?$/i.test(first) || block.every((l) => TIME.test(l))) {
      inCta = false;
      for (const l of block) {
        const m = l.match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$/);
        if (m) out.chapters.push([m[1], m[2]]);
      }
      seenStructure = true;
      continue;
    }
    if (block.every((l) => /^(#\S+\s*)+$/.test(l))) {
      out.hashtags.push(...block.join(" ").split(/\s+/).map((t) => t.replace(/^#/, "")));
      continue;
    }
    if (/^Local Vibe Check:/i.test(first)) continue;

    // 🔗 Label:\nURL pairs (several can share a block). A 🏆 line names the pick.
    if (LINK_EMOJI.test(first) && block.some((l) => URL.test(l) || /https?:\/\//.test(l))) {
      for (let i = 0; i < block.length; i++) {
        const l = block[i];
        if (!LINK_EMOJI.test(l)) continue;
        const inline = l.match(/(https?:\/\/\S+)/);
        const label = stripEmoji(l.replace(/(https?:\/\/\S+)/, "")).replace(/:\s*$/, "");
        const url = inline ? inline[1] : URL.test(block[i + 1] || "") ? block[++i] : "";
        if (url) out.links.push({ label, url });
        if (/^🏆/u.test(l)) out.pick = label.replace(/^.*?:\s*/, "");
      }
      seenStructure = true;
      continue;
    }

    const startsCta = CTA_START.test(first) || /^🏆/u.test(first);
    if (!startsCta && inCta && NOTE.test(block.join(" "))) { out.notes.push(block.join(" ")); continue; }
    if (!startsCta && inCta && isListBlock(block)) inCta = false;

    // Call to action: starts at 📞/🛠️/📍 and runs until the chapters.
    if (startsCta || inCta) {
      if (!out.cta) out.cta = { heading: "", lines: [], phone: "", website: "", email: "", hours: "", address: [], serving: "", features: [] };
      const c = out.cta;
      for (const l of block) {
        if (/^▶️/u.test(l) && /https?:\/\//.test(l)) {
          out.links.push({ label: stripEmoji(l.replace(/https?:\/\/\S+/, "")).replace(/:\s*$/, ""), url: l.match(/https?:\/\/\S+/)[0] });
        } else if (/^🏆/u.test(l)) {
          out.pick = out.pick || stripEmoji(l).replace(/^.*?:\s*/, "");
          c.heading = c.heading || stripEmoji(l);
        } else if (/^📞/u.test(l)) {
          const ph = l.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}/);
          if (ph) c.phone = c.phone || ph[0];
          const text = stripEmoji(l).replace(/:\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}.*$/, "").trim();
          if (text && !c.heading && !/^\(?\d{3}/.test(text)) c.heading = text;
        } else if (/^🌐/u.test(l)) c.website = c.website || (l.match(/https?:\/\/\S+/) || [""])[0];
        else if (/^✉️/u.test(l)) c.email = stripEmoji(l);
        else if (/^🕗/u.test(l)) c.hours = stripEmoji(l);
        else if (/^📍/u.test(l)) c.address.push(stripEmoji(l));
        else if (/^Serving\b/i.test(l)) c.serving = l.replace(/\.$/, "");
        else if (/ · /.test(l)) c.features.push(...l.split(" · ").map((s) => s.trim()).filter(Boolean));
        else if (CTA_START.test(l) || /^🏆/u.test(l)) c.heading = c.heading || stripEmoji(l);
        else c.lines.push(l);
      }
      inCta = true;
      if (startsCta) seenStructure = true;
      continue;
    }

    // "Heading:" followed by list items, optionally with a value after the colon and a footnote.
    if (isListBlock(block)) {
      const head = first.match(/^(.*?):\s*(.*)$/);
      const items = [], foot = [];
      for (const l of block.slice(1)) {
        if (isList(l)) items.push(splitItem(l.replace(/^(•|-|\d+\.)\s+/, "").replace(EMOJI_LEAD, "")));
        else if (items.length) foot.push(l);
        else items.push(splitItem(l));
      }
      out.sections.push({
        type: "list",
        ordered: block.slice(1).some((l) => /^\d+\.\s/.test(l)),
        heading: head ? head[1] : first,
        value: head ? head[2] : "",
        items, foot,
      });
      seenStructure = true;
      continue;
    }

    // "Heading?" or "Heading:" on its own line, then a paragraph.
    if (block.length > 1 && /[?:]$/.test(first) && first.length < 80) {
      out.sections.push({ type: "text", heading: first.replace(/:$/, ""), text: block.slice(1).join(" ") });
      seenStructure = true;
      continue;
    }

    const para = block.join(" ");
    // "Label: sentence." paragraphs
    const kv = para.match(/^([A-Z][^:]{2,60}):\s+(.+)$/);
    if (kv && seenStructure) {
      out.sections.push({ type: "text", heading: kv[1], text: kv[2] });
      continue;
    }
    if (!seenStructure) { out.intro.push(para); continue; }
    if (NOTE.test(para)) {
      out.notes.push(para);
      continue;
    }
    if (/^Know a local business/i.test(para)) { out.nominate = para; continue; }
    out.sections.push({ type: "text", heading: "", text: para });
  }
  return out;
}

// The first list that carries prices is the headline price table.
export function priceSection(parsed) {
  return parsed.sections.find((s) => s.type === "list" && s.items.filter((i) => /\$/.test(i.value)).length >= 2) || null;
}
