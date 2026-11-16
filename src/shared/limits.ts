export const LIMITS = {
  maxRecordingMs: 10 * 60 * 1000,      // a recording stops itself at 10 minutes
  maxVideoBytes: 500 * 1024 * 1024,    // one video file
  partBytes: 5 * 1024 * 1024,          // multipart part size (R2's minimum for every part but the last)
  maxPartBytes: 10 * 1024 * 1024,      // the largest part the API accepts
  maxThumbnailBytes: 1024 * 1024,
  titleChars: 120,
  commentChars: 2000,
  nameChars: 60,
  chapters: 50,
  chapterTitleChars: 80,
  stuckUploadMs: 24 * 60 * 60 * 1000,  // unfinished uploads older than this are removed
  sessionDays: 30,
  minPasswordChars: 8,
};
export const REACTIONS = ["👍", "❤️", "😂", "😮", "👏", "🔥"] as const;
export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5] as const;
export const MODES = ["screen_camera", "screen", "camera"] as const;
export type Mode = (typeof MODES)[number];
