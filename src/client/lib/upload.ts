import { LIMITS, type Mode } from "../../shared/limits";
import { planParts } from "../../shared/parts";
import { api, viewerId } from "./api";

function putPart(url: string, blob: Blob, onProgress: (loaded: number) => void): Promise<{ partNumber: number; etag: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-viewer", viewerId());
    xhr.upload.onprogress = e => onProgress(e.loaded);
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new Error(data.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.send(blob);
  });
}

/** Uploads a Blob in multipart parts (3 at a time, each retried twice) to `${base}/parts/{n}`; returns the sorted part list. */
async function uploadParts(base: string, blob: Blob, onProgress: (fraction: number) => void, signal?: { cancelled: boolean } | AbortSignal) {
  const cancelled = () => !!signal && ("aborted" in signal ? signal.aborted : signal.cancelled);
  const plan = planParts(blob.size, LIMITS.partBytes);
  const loaded = new Map<number, number>();
  const report = () => onProgress(Math.min(0.99, [...loaded.values()].reduce((a, b) => a + b, 0) / blob.size));
  const parts: { partNumber: number; etag: string }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < plan.length) {
      if (cancelled()) throw new DOMException("Upload cancelled", "AbortError");
      const p = plan[next++];
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await putPart(`${base}/parts/${p.partNumber}`, blob.slice(p.start, p.end), n => { loaded.set(p.partNumber, n); report(); });
          parts.push(r); loaded.set(p.partNumber, p.end - p.start); report();
          break;
        } catch (e) { if (attempt >= 2) throw e; }
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

/** Creates the video, uploads it in parts, then completes it. */
export async function uploadRecording(rec: { blob: Blob; durationMs: number; width: number; height: number; mimeType: string; mode: Mode; thumbnail: Blob | null; title: string },
  onProgress: (fraction: number) => void, signal?: { cancelled: boolean } | AbortSignal): Promise<string> {
  if (rec.blob.size > LIMITS.maxVideoBytes) throw new Error("This recording is larger than 500 MB");
  const { id } = await api<{ id: string }>("/api/videos", { method: "POST", body: { title: rec.title, contentType: rec.mimeType, mode: rec.mode, width: rec.width, height: rec.height } });
  try {
    const parts = await uploadParts(`/api/videos/${id}`, rec.blob, onProgress, signal);
    if (rec.thumbnail) await fetch(`/api/videos/${id}/thumbnail`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: rec.thumbnail });
    await api(`/api/videos/${id}/complete`, { method: "POST", body: { parts, durationMs: Math.round(rec.durationMs) } });
    onProgress(1);
    return id;
  } catch (e) {
    await api(`/api/videos/${id}/upload`, { method: "DELETE" }).catch(() => {});
    throw e;
  }
}

/** Downloads a video's stored file, reporting progress. */
export async function downloadMedia(id: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Blob> {
  const r = await fetch(`/api/videos/${id}/media`, { signal });
  if (!r.ok || !r.body) throw new Error(`Couldn't download the video (${r.status})`);
  const total = Number(r.headers.get("content-length")) || 0;
  const reader = r.body.getReader(); const chunks: Uint8Array[] = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; if (total) onProgress(Math.min(1, got / total));
  }
  return new Blob(chunks as BlobPart[], { type: (r.headers.get("content-type") ?? "video/mp4").split(";")[0] });
}

/**
 * Replaces a saved video's file with a cut copy: uploads it as a new object, then the server swaps to it,
 * moves comments, reactions and chapters by the removed time, and deletes the old object. Can't be undone.
 */
export async function replaceVideo(id: string, cut: { blob: Blob; durationMs: number; width: number; height: number; mimeType: string; thumbnail: Blob | null },
  removed: { start: number; end: number }[], onProgress: (fraction: number) => void, signal?: AbortSignal) {
  if (cut.blob.size > LIMITS.maxVideoBytes) throw new Error("The cut video is larger than 500 MB");
  await api(`/api/videos/${id}/replace`, { method: "POST", body: { contentType: cut.mimeType, width: cut.width, height: cut.height } });
  let parts;
  try { parts = await uploadParts(`/api/videos/${id}/replace`, cut.blob, onProgress, signal); }
  catch (e) { await api(`/api/videos/${id}/replace`, { method: "DELETE" }).catch(() => {}); throw e; }
  // From here on the swap is one server call; cancelling no longer applies.
  await api(`/api/videos/${id}/replace/complete`, { method: "POST", body: { parts, durationMs: Math.round(cut.durationMs), removed } });
  if (cut.thumbnail) await fetch(`/api/videos/${id}/thumbnail`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: cut.thumbnail }).catch(() => {});
  onProgress(1);
}
