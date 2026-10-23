import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components/Button";
import { Slider, SliderThumb, SliderTrack } from "react-aria-components/Slider";
import { m } from "../paraglide/messages.js";
import "./student-ui.css";
import "./AudioPlayer.css";

/** Formats `seconds` as minutes and two-digit seconds, such as `2:15`. */
export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The element that is playing, so starting another can pause it. */
let playing: HTMLAudioElement | null = null;

/**
 * A compact player for the audio file at `src`: a play/pause button, the
 * position and length (`0:42 / 2:15`) and a slider that seeks. At most one
 * player plays at a time, and a player pauses when it leaves the page. While
 * the file can't be loaded, such as offline before it was preloaded, it shows
 * a note instead and tries again when `src` changes.
 *
 * Once the element has loaded a URL it keeps it, even if `src` changes, so a
 * recording that is playing from the network is not cut off when the
 * preloaded copy arrives. It takes the new `src` only if it has loaded
 * nothing yet or failed on the URL it has.
 */
export function AudioPlayer({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(src);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (src !== current && (!ready || failed === current)) {
    setCurrent(src);
    setReady(false);
    setFailed(null);
    setPlaying(false);
    setTime(0);
    setDuration(0);
  }

  useEffect(() => {
    const el = audio.current;
    return () => {
      el?.pause();
      if (playing === el) playing = null;
    };
  }, []);

  return (
    <span className="k-audio">
      {/* biome-ignore lint/a11y/useMediaCaption: question audio has no transcript */}
      <audio
        ref={audio}
        src={current}
        preload="metadata"
        onPlay={(e) => {
          if (playing && playing !== e.currentTarget) playing.pause();
          playing = e.currentTarget;
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          setDuration(Number.isFinite(d) ? d : 0);
          setReady(true);
        }}
        onError={() => setFailed(current)}
      />
      {failed === current ? (
        <span className="k-media-wait">{m.media_audio_wait()}</span>
      ) : (
        <>
          <Button
            className="k-audio-btn"
            aria-label={isPlaying ? m.audio_pause() : m.audio_play()}
            onPress={() => {
              const el = audio.current;
              if (!el) return;
              if (el.paused) el.play().catch(() => {});
              else el.pause();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {isPlaying ? (
                <path d="M8 5v14M16 5v14" />
              ) : (
                <path d="M8 5l11 7-11 7z" />
              )}
            </svg>
          </Button>
          <span className="k-audio-time">
            {formatTime(time)} / {formatTime(duration)}
          </span>
          <Slider
            className="k-audio-seek"
            aria-label={m.audio_seek()}
            minValue={0}
            maxValue={duration || 1}
            step={0.1}
            value={Math.min(time, duration || 1)}
            isDisabled={duration === 0}
            onChange={(v) => {
              if (audio.current) audio.current.currentTime = v;
              setTime(v);
            }}
          >
            <SliderTrack className="k-audio-track">
              {({ state }) => (
                <>
                  <span
                    className="k-audio-fill"
                    style={{ width: `${state.getThumbPercent(0) * 100}%` }}
                  />
                  <SliderThumb className="k-audio-thumb" />
                </>
              )}
            </SliderTrack>
          </Slider>
        </>
      )}
    </span>
  );
}
