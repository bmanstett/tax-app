/* =========================================================
   pdftext.js — minimal in-browser PDF text extractor.
   Zero dependencies: inflates FlateDecode streams with the
   browser's built-in DecompressionStream, then pulls text
   from content-stream operators (Tj / TJ / ' / ").
   Handles ToUnicode CMaps for CID (Identity-H) fonts.

   Works well on digitally-generated PDFs (like FCGA work
   orders). Scanned/image PDFs yield no text — callers should
   offer a paste-text fallback.
   ========================================================= */
"use strict";

const PDFText = (() => {

  /** Inflate zlib data via DecompressionStream; returns Uint8Array or null.
      PDF streams often have EOL padding before "endstream", and
      DecompressionStream rejects trailing junk — so trim whitespace and
      read tolerantly, keeping whatever was decompressed before an error. */
  async function inflate(bytes) {
    let end = bytes.length;
    while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d ||
           bytes[end - 1] === 0x20 || bytes[end - 1] === 0x09 || bytes[end - 1] === 0x00)) end--;
    const trimmed = bytes.subarray(0, end);
    if (trimmed.length < 2 || trimmed[0] !== 0x78) return tolerantInflate(trimmed); // zlib magic usually 0x78
    return tolerantInflate(trimmed);
  }

  async function tolerantInflate(bytes) {
    try {
      const ds = new DecompressionStream("deflate");
      const reader = new Blob([bytes]).stream().pipeThrough(ds).getReader();
      const chunks = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); total += value.length;
        }
      } catch (e) { /* trailing junk after final block — keep what we got */ }
      if (!total) return null;
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return out;
    } catch (e) { return null; }
  }

  /** Find every stream…endstream chunk; return inflated (or raw) bytes. */
  async function getStreams(data) {
    const out = [];
    // scan for "stream" keyword followed by EOL
    for (let i = 0; i < data.length - 6; i++) {
      if (data[i] === 0x73 /*s*/ && data[i + 1] === 0x74 && data[i + 2] === 0x72 &&
          data[i + 3] === 0x65 && data[i + 4] === 0x61 && data[i + 5] === 0x6d) {
        let start = i + 6;
        if (data[start] === 0x0d) start++;
        if (data[start] === 0x0a) start++;
        // find "endstream"
        let end = -1;
        for (let j = start; j < data.length - 8; j++) {
          if (data[j] === 0x65 && data[j + 1] === 0x6e && data[j + 2] === 0x64 &&
              data[j + 3] === 0x73 && data[j + 4] === 0x74 && data[j + 5] === 0x72 &&
              data[j + 6] === 0x65 && data[j + 7] === 0x61 && data[j + 8] === 0x6d) { end = j; break; }
        }
        if (end < 0) continue;
        const chunk = data.slice(start, end);
        const inflated = await inflate(chunk);
        out.push(inflated || chunk);
        i = end + 8;
      }
    }
    return out;
  }

  // windows-1252 decoding gives us WinAnsi punctuation (curly quotes etc.) for free
  const decoder = new TextDecoder("windows-1252");

  /** Parse ToUnicode CMaps (bfchar/bfrange) into one merged CID→string map. */
  function parseCMaps(texts) {
    const map = new Map();
    for (const txt of texts) {
      if (!txt.includes("beginbfchar") && !txt.includes("beginbfrange")) continue;
      let m;
      const charBlocks = txt.match(/beginbfchar[\s\S]*?endbfchar/g) || [];
      for (const block of charBlocks) {
        const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
        while ((m = re.exec(block))) {
          const src = parseInt(m[1], 16);
          let dst = "";
          for (let i = 0; i < m[2].length; i += 4) dst += String.fromCharCode(parseInt(m[2].slice(i, i + 4), 16));
          map.set(src, dst);
        }
      }
      const rangeBlocks = txt.match(/beginbfrange[\s\S]*?endbfrange/g) || [];
      for (const block of rangeBlocks) {
        const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
        while ((m = re.exec(block))) {
          const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16), dst = parseInt(m[3], 16);
          for (let i = 0; i <= hi - lo && i < 65536; i++) map.set(lo + i, String.fromCharCode(dst + i));
        }
      }
    }
    return map;
  }

  function unescapeLiteral(s) {
    let out = "", i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === "\\") {
        i++;
        const n = s[i];
        if (n === "n") out += "\n";
        else if (n === "r" || n === "t" || n === "b" || n === "f") out += " ";
        else if (n >= "0" && n <= "7") {
          let oct = n;
          while (i + 1 < s.length && s[i + 1] >= "0" && s[i + 1] <= "7" && oct.length < 3) { i++; oct += s[i]; }
          out += String.fromCharCode(parseInt(oct, 8));
        } else if (n !== undefined) out += n;
      } else out += ch;
      i++;
    }
    return out;
  }

  function hexToText(hex, cmap) {
    const h = hex.replace(/\s/g, "");
    let out = "";
    // try 2-byte CIDs through the ToUnicode map first
    if (cmap.size && h.length % 4 === 0) {
      let allMapped = true, mapped = "";
      for (let i = 0; i < h.length; i += 4) {
        const cid = parseInt(h.slice(i, i + 4), 16);
        if (!cmap.has(cid)) { allMapped = false; break; }
        mapped += cmap.get(cid);
      }
      if (allMapped) return mapped;
    }
    for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
    return out;
  }

  /** Extract readable text from one decoded content stream. */
  function extractFromStream(txt, cmap, pieces) {
    // literal strings, hex strings, TJ arrays, and position ops (→ newlines)
    const tokenRe = /\(((?:\\[\s\S]|[^\\()])*)\)\s*(Tj|'|")?|<([0-9A-Fa-f][0-9A-Fa-f\s]*)>\s*(Tj)?|\[((?:\\[\s\S]|\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]*>|[^\]\\])*)\]\s*TJ|(T\*|Td|TD|Tm|ET)/g;
    let m;
    while ((m = tokenRe.exec(txt))) {
      if (m[1] !== undefined) {                 // (literal) Tj / ' / "
        pieces.push(unescapeLiteral(m[1]));
        if (m[2] === "'" || m[2] === '"') pieces.push("\n");
      } else if (m[3] !== undefined) {          // <hex> Tj
        pieces.push(hexToText(m[3], cmap));
      } else if (m[5] !== undefined) {          // [ … ] TJ
        const arrRe = /\(((?:\\[\s\S]|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g;
        let t;
        while ((t = arrRe.exec(m[5]))) {
          if (t[1] !== undefined) pieces.push(unescapeLiteral(t[1]));
          else if (t[2] !== undefined) pieces.push(hexToText(t[2], cmap));
          else if (parseFloat(t[3]) < -180) pieces.push(" "); // big kern gap ≈ space
        }
      } else if (m[6]) {                        // Td / TD / Tm / T* / ET
        pieces.push("\n");
      }
    }
  }

  /**
   * extract(arrayBuffer) → Promise<string>
   * Returns normalized text with one logical line per text run.
   */
  async function extract(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    // quick sanity: %PDF header
    if (!(data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46)) {
      throw new Error("Not a PDF file.");
    }
    const streams = await getStreams(data);
    const texts = streams.map(s => decoder.decode(s));
    const cmap = parseCMaps(texts);
    const pieces = [];
    for (const txt of texts) {
      if (!txt.includes("BT") || (!txt.includes("Tj") && !txt.includes("TJ"))) continue;
      extractFromStream(txt, cmap, pieces);
    }
    let text = pieces.join("");
    // normalize: fancy punctuation → plain, collapse whitespace
    text = text
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/•|●/g, "*")
      .replace(/ /g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();
    return text;
  }

  const supported = () => typeof DecompressionStream !== "undefined";

  return { extract, supported };
})();
