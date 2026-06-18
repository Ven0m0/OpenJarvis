import { useState, useCallback, useRef, useEffect } from 'react';
import { transcribeAudio, fetchSpeechHealth } from '../lib/api';

export type SpeechState = 'idle' | 'recording' | 'transcribing';

interface UseSpeechOptions {
  /** Called with the transcribed text after recording stops (manual or auto). */
  onTranscript?: (text: string) => void;
  /** Auto-stop after this many ms of trailing silence once speech has begun. */
  silenceMs?: number;
  /** Hard cap on a single recording in ms (safety net). */
  maxMs?: number;
}

export function useSpeech(options: UseSpeechOptions = {}) {
  const { onTranscript, silenceMs = 1500, maxMs = 30000 } = options;
  const [state, setState] = useState<SpeechState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Voice-activity-detection plumbing.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Check if the speech backend is available on mount.
  useEffect(() => {
    fetchSpeechHealth()
      .then((health) => setAvailable(health.available))
      .catch(() => setAvailable(false));
  }, []);

  // Release recording resources on unmount: stop the VAD timer/AudioContext,
  // the recorder, and — importantly — the microphone stream, so the mic
  // indicator doesn't stay on after the component goes away.
  useEffect(() => {
    return () => {
      if (vadTimerRef.current != null) clearInterval(vadTimerRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state === 'recording') recorder.stop();
      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, []);

  const teardownVad = useCallback(() => {
    if (vadTimerRef.current != null) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  // Stop the active recorder; its onstop handler runs transcription.
  const finalize = useCallback(() => {
    teardownVad();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
  }, [teardownVad]);

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone not supported in this browser');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        teardownVad();
        setState('transcribing');

        streamRef.current?.getTracks().forEach((track) => {
          track.stop();
        });
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        chunksRef.current = [];

        try {
          const result = await transcribeAudio(blob);
          setState('idle');
          const text = (result.text || '').trim();
          if (text) onTranscriptRef.current?.(text);
        } catch (err) {
          setState('idle');
          setError(err instanceof Error ? err.message : 'Transcription failed');
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setState('recording');

      // ── Silence detection: auto-stop once the user finishes speaking. ──
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);

        const SILENCE_RMS = 0.015; // normalized amplitude; below this is "silence"
        const started = performance.now();
        let lastVoice = started;
        let everSpoke = false;

        vadTimerRef.current = setInterval(() => {
          if (!audioCtxRef.current) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          const now = performance.now();
          if (rms > SILENCE_RMS) {
            lastVoice = now;
            everSpoke = true;
          }
          const trailingSilence = now - lastVoice;
          // Stop when: the user spoke and then went quiet; OR never spoke for a
          // while (gave up); OR the hard duration cap was reached.
          if (
            (everSpoke && trailingSilence > silenceMs) ||
            (!everSpoke && now - started > 8000) ||
            now - started > maxMs
          ) {
            finalize();
          }
        }, 100);
      } catch {
        // VAD is best-effort; manual stop still works without it.
      }
    } catch {
      setError('Microphone access denied');
      setState('idle');
    }
  }, [teardownVad, finalize, silenceMs, maxMs]);

  const stopRecording = useCallback(async (): Promise<void> => {
    finalize();
  }, [finalize]);

  return {
    state,
    error,
    available,
    startRecording,
    stopRecording,
    isRecording: state === 'recording',
    isTranscribing: state === 'transcribing',
  };
}
