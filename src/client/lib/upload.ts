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

/** Creates the video, uploads it in multipart parts (3 at a time, each retried twice), then completes it. */
export async function uploadRecording(rec: { blob: Blob; durationMs: number; width: number; height: number; mimeType: string; mode: Mode; thumbnail: Blob | null; title: string },
  onProgress: (fraction: number) => void, signal?: { cancelled: boolean }): Promise<string> {
  if (rec.blob.size > LIMITS.maxVideoBytes) throw new Error("This recording is larger than 500 MB");
  const { id } = await api<{ id: string }>("/api/videos", { method: "POST", body: { title: rec.title, contentType: rec.mimeType, mode: rec.mode, width: rec.width, height: rec.height } });
  try {
    const plan = planParts(rec.blob.size, LIMITS.partBytes);
    const loaded = new Map<number, number>();
    const report = () => onProgress(Math.min(0.99, [...loaded.values()].reduce((a, b) => a + b, 0) / rec.blob.size));
    const parts: { partNumber: number; etag: string }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < plan.length) {
        if (signal?.cancelled) throw new Error("cancelled");
        const p = plan[next++];
        for (let attempt = 0; ; attempt++) {
          try {
            const r = await putPart(`/api/videos/${id}/parts/${p.partNumber}`, rec.blob.slice(p.start, p.end), n => { loaded.set(p.partNumber, n); report(); });
            parts.push(r); loaded.set(p.partNumber, p.end - p.start); report();
            break;
          } catch (e) { if (attempt >= 2) throw e; }
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    parts.sort((a, b) => a.partNumber - b.partNumber);
    if (rec.thumbnail) await fetch(`/api/videos/${id}/thumbnail`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: rec.thumbnail });
    await api(`/api/videos/${id}/complete`, { method: "POST", body: { parts, durationMs: Math.round(rec.durationMs) } });
    onProgress(1);
    return id;
  } catch (e) {
    await api(`/api/videos/${id}/upload`, { method: "DELETE" }).catch(() => {});
    throw e;
  }
}
