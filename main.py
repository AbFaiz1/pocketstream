
from contextlib import asynccontextmanager
import asyncio
import hashlib
import json
import os
from pathlib import Path
import mimetypes
import socket
import subprocess
import time
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles


# Project directories
BASE_DIR = Path(__file__).resolve().parent
MEDIA_DIR = (BASE_DIR / "media").resolve()
FRONTEND_DIR = (BASE_DIR / "frontend").resolve()
TRANSCODE_DIR = (BASE_DIR / ".pocketstream-cache").resolve()

# Video extensions supported by the listing
VIDEO_EXTENSIONS = {
    ".mp4",
    ".mkv",
    ".mov",
    ".webm",
    ".m4v",
}

PROBE_CACHE: dict[Path, dict] = {}
TRANSCODE_JOBS: dict[Path, subprocess.Popen] = {}


def safe_media_path(relative_path: str) -> Path:
    """Resolve a requested library item without leaving MEDIA_DIR."""
    path = (MEDIA_DIR / relative_path).resolve()
    if not path.is_relative_to(MEDIA_DIR):
        raise HTTPException(status_code=403, detail="Access denied")
    if path.suffix.lower() not in VIDEO_EXTENSIONS or not path.is_file():
        raise HTTPException(status_code=404, detail="Video not found")
    return path


def probe_media(path: Path) -> dict:
    """Read embedded audio and subtitle tracks using the locally installed ffprobe."""
    cached = PROBE_CACHE.get(path)
    modified_at = path.stat().st_mtime_ns
    if cached and cached["modified_at"] == modified_at:
        return cached["data"]

    command = [
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        payload = json.loads(result.stdout)
        streams = payload.get("streams", [])
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return {"audio_tracks": [], "subtitle_tracks": [], "container": ""}

    def track_name(stream: dict, fallback: str) -> str:
        tags = stream.get("tags", {})
        language = tags.get("language", "und").upper()
        title = tags.get("title")
        return f"{language} — {title}" if title else f"{language} {fallback}"

    data = {
        "audio_tracks": [],
        "subtitle_tracks": [],
        "container": payload.get("format", {}).get("format_name", ""),
    }
    for stream in streams:
        kind = stream.get("codec_type")
        if kind == "audio":
            data["audio_tracks"].append({
                "index": len(data["audio_tracks"]),
                "label": track_name(stream, "Audio"),
            })
        elif kind == "subtitle":
            data["subtitle_tracks"].append({
                "index": len(data["subtitle_tracks"]),
                "label": track_name(stream, "Subtitles"),
            })

    PROBE_CACHE[path] = {"modified_at": modified_at, "data": data}
    return data


def transcode_folder(path: Path, audio_index: int) -> Path:
    token = hashlib.sha256(f"{path}:{path.stat().st_mtime_ns}:{audio_index}".encode()).hexdigest()[:24]
    return TRANSCODE_DIR / token


def start_hls_transcode(path: Path, audio_index: int) -> Path:
    """Start a compatible H.264/AAC HLS rendition when a browser cannot play a file."""
    output_dir = transcode_folder(path, audio_index)
    playlist = output_dir / "stream.m3u8"
    output_dir.mkdir(parents=True, exist_ok=True)

    job = TRANSCODE_JOBS.get(playlist)
    if playlist.exists() and playlist.stat().st_size:
        return playlist
    if job and job.poll() is None:
        return playlist

    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
        "-map", "0:v:0", "-map", f"0:a:{audio_index}?",
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "23",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
"-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
"-hls_list_size", "0", "-hls_flags", "independent_segments",
"-hls_segment_filename", str(output_dir / "segment-%05d.ts"), str(playlist),
    ]
    TRANSCODE_JOBS[playlist] = subprocess.Popen(command)
    return playlist


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Validate required directories when the server starts.
    if not MEDIA_DIR.is_dir():
        raise RuntimeError(
            f"Media directory does not exist: {MEDIA_DIR}"
        )

    if not (FRONTEND_DIR / "index.html").is_file():
        raise RuntimeError(
            f"Frontend index.html not found: {FRONTEND_DIR}"
        )

    if not (FRONTEND_DIR / "assets").is_dir():
        raise RuntimeError(
            f"Frontend assets directory not found: "
            f"{FRONTEND_DIR / 'assets'}"
        )

    yield

    # Stop any in-progress conversions when the app is shut down.
    for process in TRANSCODE_JOBS.values():
        if process.poll() is None:
            process.terminate()


app = FastAPI(
    title="PocketStream",
    description="Local wireless media streaming",
    lifespan=lifespan,
)


# Serve CSS and JavaScript files.
app.mount(
    "/assets",
    StaticFiles(directory=FRONTEND_DIR / "assets"),
    name="assets",
)


# Homepage
@app.get("/")
async def home():
    return FileResponse(
        FRONTEND_DIR / "index.html",
        media_type="text/html",
    )


# List authorised video files.

@app.get("/api/videos")
async def list_videos():
    videos = []

    try:
        for path in MEDIA_DIR.rglob("*"):
            try:
                # Resolve the actual path before exposing a file.
                resolved_path = path.resolve()

                # Keep access inside the authorised media directory.
                if not resolved_path.is_relative_to(MEDIA_DIR):
                    continue

                if not resolved_path.is_file():
                    continue

                if resolved_path.suffix.lower() not in VIDEO_EXTENSIONS:
                    continue

                videos.append({
                    "name": resolved_path.name,
                    "relative_path": path.relative_to(
                        MEDIA_DIR
                    ).as_posix(),
                    "size_bytes": resolved_path.stat().st_size,
                })

            except (OSError, RuntimeError, ValueError):
                # Skip entries that cannot safely be inspected.
                continue

    except OSError:
        raise HTTPException(
            status_code=500,
            detail="Unable to read the media directory",
        )

    videos.sort(
        key=lambda video: video["relative_path"].lower()
    )

    return {"videos": videos}


# Serve a selected video.

@app.get("/api/file/{relative_path:path}")
async def stream_video(relative_path: str):
    try:
        requested_path = safe_media_path(relative_path)

        media_type = (
            mimetypes.guess_type(requested_path.name)[0]
            or "application/octet-stream"
        )

    except HTTPException:
        raise

    except (OSError, RuntimeError, ValueError):
        raise HTTPException(
            status_code=404,
            detail="Video is unavailable",
        )

    return FileResponse(
        path=requested_path,
        media_type=media_type,
        filename=None,
    )


@app.get("/api/videos/{relative_path:path}/metadata")
async def video_metadata(relative_path: str):
    """Return selectable embedded tracks for a library item."""
    path = safe_media_path(relative_path)
    return probe_media(path)


@app.get("/api/videos/{relative_path:path}/subtitles/{track_index}.vtt")
async def subtitle_track(relative_path: str, track_index: int):
    """Extract one embedded subtitle stream as a browser-readable WebVTT file."""
    path = safe_media_path(relative_path)
    tracks = probe_media(path)["subtitle_tracks"]
    if track_index < 0 or track_index >= len(tracks):
        raise HTTPException(status_code=404, detail="Subtitle track not found")

    token = hashlib.sha256(f"{path}:{path.stat().st_mtime_ns}:sub:{track_index}".encode()).hexdigest()[:24]
    output = TRANSCODE_DIR / token / "subtitle.vtt"
    output.parent.mkdir(parents=True, exist_ok=True)
    if not output.exists():
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
            "-map", f"0:s:{track_index}", "-f", "webvtt", str(output),
        ]
        try:
            await asyncio.to_thread(subprocess.run, command, check=True, capture_output=True)
        except (OSError, subprocess.SubprocessError):
            raise HTTPException(status_code=422, detail="This subtitle format cannot be converted")
    return FileResponse(output, media_type="text/vtt")


@app.get("/api/videos/{relative_path:path}/compatible/stream.m3u8")
async def compatible_stream(relative_path: str, audio: int = 0):
    """Provide an H.264/AAC fallback for MKV, HEVC, and other phone-incompatible files."""
    path = safe_media_path(relative_path)
    audio_count = len(probe_media(path)["audio_tracks"])
    if audio < 0 or (audio_count and audio >= audio_count):
        raise HTTPException(status_code=404, detail="Audio track not found")
    playlist = start_hls_transcode(path, audio)

    # Wait briefly for ffmpeg to create the initial manifest/segment.  This keeps
    # iPhone Safari from seeing a transient 404 on its first playlist request.
    for _ in range(300):
        if playlist.exists() and playlist.stat().st_size:
            manifest = playlist.read_text(encoding="utf-8")
            manifest = manifest.replace(
                "segment-", f"/api/compatible/{playlist.parent.name}/segment-"
            )
            return Response(manifest, media_type="application/vnd.apple.mpegurl")
        await asyncio.sleep(0.25)
    raise HTTPException(status_code=503, detail="Preparing compatible stream; please try again shortly")


@app.get("/api/videos/{relative_path:path}/compatible/video.mp4")
async def compatible_video(relative_path: str, audio: int = 0):
    """Create a seekable MP4: retain the video stream and convert audio to AAC.

    Unlike a growing HLS event playlist, this is a finished VOD file, so iPhone
    controls show a regular timeline and support seeking/forwarding.
    """
    path = safe_media_path(relative_path)
    audio_count = len(probe_media(path)["audio_tracks"])
    if audio < 0 or (audio_count and audio >= audio_count):
        raise HTTPException(status_code=404, detail="Audio track not found")

    output_dir = transcode_folder(path, audio)
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "compatible.mp4"
    if not output.exists() or not output.stat().st_size:
        temporary_output = output_dir / "compatible.part.mp4"
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
            "-map", "0:v:0", "-map", f"0:a:{audio}?",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", str(temporary_output),
        ]
        try:
            # Copying video makes this much faster than the old H.264 re-encode.
            await asyncio.to_thread(subprocess.run, command, check=True, capture_output=True)
            os.replace(temporary_output, output)
        except (OSError, subprocess.SubprocessError):
            raise HTTPException(status_code=422, detail="This file could not be prepared")
    return FileResponse(output, media_type="video/mp4", filename=None)


@app.get("/api/compatible/{stream_id}/{filename}")
async def compatible_segment(stream_id: str, filename: str):
    """Serve only files generated inside the private transcode cache."""
    if not filename.endswith((".ts", ".m4s", ".m3u8")):
        raise HTTPException(status_code=404, detail="Stream file not found")
    path = (TRANSCODE_DIR / stream_id / filename).resolve()
    if not path.is_relative_to(TRANSCODE_DIR) or not path.is_file():
        raise HTTPException(status_code=404, detail="Stream file not ready")
    return FileResponse(path)

@app.get("/api/connection")
async def connection_info():
    local_ip = None

    try:
        with socket.socket(
            socket.AF_INET,
            socket.SOCK_DGRAM,
        ) as sock:
            sock.connect(("192.0.2.1", 80))
            local_ip = sock.getsockname()[0]

    except OSError:
        pass

    return {
        "local_ip": local_ip,
        "port": 8000,
        "instructions": (
            "Connect your phone to the same accessible "
            "Wi-Fi or hotspot, then open the address below."
        ),
    }
