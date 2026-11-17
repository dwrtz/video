import type { Chapter } from "./time";
import type { Mode } from "./limits";
export type Me = { id: string; email: string; name: string };
export type VideoSummary = {
  id: string; title: string; status: "uploading" | "ready"; mode: Mode; durationMs: number;
  createdAt: number; viewCount: number; commentCount: number; hasThumbnail: boolean; size: number;
};
export type Reaction = { id: string; emoji: string; timeMs: number };
export type Comment = { id: string; authorName: string; body: string; timeMs: number | null; createdAt: number; mine: boolean; byOwner: boolean };
export type VideoDetail = VideoSummary & {
  ownerName: string; isOwner: boolean; contentType: string; width: number; height: number;
  chapters: Chapter[]; allowComments: boolean; allowDownload: boolean; reactions: Reaction[];
};
