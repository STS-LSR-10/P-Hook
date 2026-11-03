"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

/**
 * How far the opening video got, kept while the app moves from one page to the next (the module stays
 * alive across in-app navigation), so the next opening screen carries on instead of starting over.
 */
let resumeAt = 0;

/** The background colour of the opening video (and of its first-frame picture). */
const SPLASH_BG = "#F9F3DF";

/**
 * Full-screen opening screen while the app signs in. The first frame of the opening video shows at
 * once (same size and place as the video, so nothing jumps); the muted video fades in over it, plays
 * once and rests on its last frame. People who asked their device for less motion keep the still
 * frame. Cream on purpose: the owl video is on cream (#F9F3DF), so the whole screen takes that colour
 * (in dark mode too) and the video has no visible edges.
 */
export function Splash() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  // carrying on from a previous screen: no first-frame flash underneath
  const [carrying] = useState(() => resumeAt > 0);

  function onLoadedMetadata() {
    const v = video.current;
    if (!v) return;
    if (resumeAt > 0) v.currentTime = Math.min(resumeAt, v.duration);
    // already finished on the previous screen: stay on the last frame
    if (resumeAt < v.duration - 0.1) void v.play().catch(() => undefined);
    else setPlaying(true);
  }

  // the video can have its metadata before this page is hydrated (cached): its event is gone by then
  useEffect(() => {
    if (video.current && video.current.readyState >= 1) onLoadedMetadata();
  }, []);

  return (
    <div
      role="status"
      aria-label={t("กำลังเปิดแอป")}
      suppressHydrationWarning
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: SPLASH_BG }}
    >
      <div className="relative aspect-video w-full max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/loading-poster.jpg"
          alt=""
          aria-hidden
          className={cn("absolute inset-0 h-full w-full object-contain", carrying && "opacity-0")}
        />
        <video
          ref={video}
          src="/loading.mp4"
          muted
          playsInline
          preload="auto"
          aria-hidden
          tabIndex={-1}
          onLoadedMetadata={onLoadedMetadata}
          onPlaying={() => setPlaying(true)}
          onTimeUpdate={(e) => {
            resumeAt = e.currentTarget.currentTime;
          }}
          onEnded={(e) => {
            resumeAt = e.currentTarget.duration;
          }}
          className={cn(
            "absolute inset-0 h-full w-full object-contain transition-opacity duration-300 motion-reduce:hidden",
            playing ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    </div>
  );
}
