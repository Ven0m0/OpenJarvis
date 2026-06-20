"""Faster-Whisper speech-to-text backend (local, CTranslate2-based)."""

from __future__ import annotations

import io
from typing import List, Optional

from openjarvis.core.registry import SpeechRegistry
from openjarvis.speech._stubs import Segment, SpeechBackend, TranscriptionResult

try:
    from faster_whisper import WhisperModel
except ImportError:
    WhisperModel = None  # type: ignore


@SpeechRegistry.register("faster-whisper")
class FasterWhisperBackend(SpeechBackend):
    """Local speech-to-text using Faster-Whisper (CTranslate2)."""

    backend_id = "faster-whisper"

    def __init__(
        self,
        model_size: str = "base",
        device: str = "auto",
        compute_type: str = "float16",
    ) -> None:
        self._model_size = model_size
        self._device = device
        self._compute_type = compute_type
        self._model: Optional[WhisperModel] = None
        self._device_used: str = ""

    def _build_model(self, device: str, compute_type: str) -> WhisperModel:
        """Construct a WhisperModel, normalising CPU-incompatible settings."""
        # float16 is a GPU-only compute type; CTranslate2 rejects it on CPU.
        if device == "cpu" and compute_type in ("float16", "fp16"):
            compute_type = "int8"
        model = WhisperModel(self._model_size, device=device, compute_type=compute_type)  # type: ignore
        self._device_used = device
        return model

    def _ensure_model(self) -> WhisperModel:
        """Lazy-load the Whisper model on first use."""
        if self._model is None:
            if WhisperModel is None:
                raise ImportError(
                    "faster-whisper is not installed. "
                    "Install with: uv sync --extra speech"
                )
            device = self._device
            if device == "auto":
                try:
                    import torch

                    device = "cuda" if torch.cuda.is_available() else "cpu"
                except Exception:  # noqa: BLE001
                    device = "cpu"
            self._model = self._build_model(device, self._compute_type)
        return self._model

    def transcribe(
        self,
        audio: bytes,
        *,
        format: str = "wav",
        language: Optional[str] = None,
    ) -> TranscriptionResult:
        """Transcribe audio bytes using Faster-Whisper."""
        model = self._ensure_model()

        kwargs = {}
        if language:
            kwargs["language"] = language

        # faster-whisper accepts a file-like object directly. Passing an
        # in-memory buffer avoids a temp file — and sidesteps the Windows
        # bug where a still-open NamedTemporaryFile cannot be reopened by
        # the decoder (PermissionError [Errno 13]).
        try:
            segments_iter, info = model.transcribe(io.BytesIO(audio), **kwargs)  # type: ignore
            segments_list = list(segments_iter)
        except RuntimeError as exc:
            # GPU runtime libraries (cuBLAS/cuDNN) may be missing even when a
            # CUDA device is present. Fall back to CPU once, then retry.
            msg = str(exc).lower()
            gpu_lib_error = any(
                k in msg for k in ("cublas", "cudnn", "cuda", "library", "gpu")
            )
            if self._device_used != "cpu" and gpu_lib_error:
                self._model = self._build_model("cpu", "int8")
                segments_iter, info = self._model.transcribe(  # type: ignore
                    io.BytesIO(audio), **kwargs
                )
                segments_list = list(segments_iter)
            else:
                raise

        # Build result
        text = "".join(seg.text for seg in segments_list).strip()
        segments = [
            Segment(
                text=seg.text.strip(),
                start=seg.start,
                end=seg.end,
                confidence=None,
            )
            for seg in segments_list
        ]

        return TranscriptionResult(
            text=text,
            language=getattr(info, "language", None),
            confidence=getattr(info, "language_probability", None),
            duration_seconds=getattr(info, "duration", 0.0),
            segments=segments,
        )

    def health(self) -> bool:
        """Check if model is loaded or loadable."""
        if self._model is not None:
            return True
        return WhisperModel is not None

    def supported_formats(self) -> List[str]:
        """Supported audio formats (same as ffmpeg/Whisper)."""
        return ["wav", "mp3", "m4a", "ogg", "flac", "webm"]
