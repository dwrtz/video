/**
 * Repairs a WebM header written by a "fix the duration" step that gave the Segment and the
 * first Cluster known sizes reaching the end of the file. Browsers' MediaRecorder writes both
 * with "unknown" size and every later Cluster follows as a sibling; with a known size the later
 * Clusters end up nested inside the first one, which strict WebM parsers reject or cut short.
 *
 * Returns the byte patches (same length, so offsets don't move) that put the unknown sizes back.
 * `head` is the start of the file (4 KB is plenty); `total` is the whole file's size.
 */
export type Patch = { offset: number; bytes: Uint8Array };
const SEGMENT = 0x18538067, CLUSTER = 0x1f43b675, EBML = 0x1a45dfa3;

function readId(b: Uint8Array, i: number) {
  const f = b[i]; let len = 1;
  while (len <= 4 && !(f & (0x80 >> (len - 1)))) len++;
  if (len > 4 || i + len > b.length) return null;
  let v = 0; for (let k = 0; k < len; k++) v = v * 256 + b[i + k];
  return { id: v, len };
}
function readSize(b: Uint8Array, i: number) {
  const f = b[i]; let len = 1;
  while (len <= 8 && !(f & (0x80 >> (len - 1)))) len++;
  if (len > 8 || i + len > b.length) return null;
  let v = f & (0xff >> len);
  let allOnes = v === (0xff >> len);
  for (let k = 1; k < len; k++) { v = v * 256 + b[i + k]; if (b[i + k] !== 0xff) allOnes = false; }
  return { size: v, len, unknown: allOnes };
}
/** The "unknown size" marker in `len` bytes. */
export function unknownSize(len: number): Uint8Array {
  const out = new Uint8Array(len).fill(0xff);
  out[0] = (0x100 >> len) | (0xff >> len);
  return out;
}

export function webmHeaderPatches(head: Uint8Array, total: number): Patch[] {
  const e = readId(head, 0); if (!e || e.id !== EBML) return [];
  const es = readSize(head, e.len); if (!es || es.unknown) return [];
  let i = e.len + es.len + es.size;
  const seg = readId(head, i); if (!seg || seg.id !== SEGMENT) return [];
  const ss = readSize(head, i + seg.len); if (!ss) return [];
  const segSizeAt = i + seg.len, segBody = segSizeAt + ss.len;
  if (ss.unknown || segBody + ss.size !== total) return [];
  // Walk the Segment's children up to the first Cluster.
  i = segBody;
  while (i < head.length - 12) {
    const c = readId(head, i); if (!c) return [];
    const cs = readSize(head, i + c.len); if (!cs) return [];
    const body = i + c.len + cs.len;
    if (c.id === CLUSTER) {
      if (cs.unknown || body + cs.size !== total) return [];
      return [{ offset: segSizeAt, bytes: unknownSize(ss.len) }, { offset: i + c.len, bytes: unknownSize(cs.len) }];
    }
    if (cs.unknown) return [];
    i = body + cs.size;
  }
  return [];
}

/** Applies patches to a chunk that starts at file offset `start`. */
export function applyPatches(chunk: Uint8Array, start: number, patches: Patch[]): Uint8Array {
  let out = chunk;
  for (const p of patches) {
    for (let k = 0; k < p.bytes.length; k++) {
      const at = p.offset + k - start;
      if (at >= 0 && at < chunk.length) { if (out === chunk) out = chunk.slice(); out[at] = p.bytes[k]; }
    }
  }
  return out;
}
