
from contextlib import asynccontextmanager
from pathlib import Path
import mimetypes
import socket
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


# Project directories
BASE_DIR = Path(__file__).resolve().parent
MEDIA_DIR = (BASE_DIR / "media").resolve()
FRONTEND_DIR = (BASE_DIR / "frontend").resolve()

# Video extensions supported by the listing
VIDEO_EXTENSIONS = {
    ".mp4",
    ".mkv",
    ".mov",
    ".webm",
    ".m4v",
}


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
        for path in MEDIA_DIR.iterdir():
            if not path.is_file():
                continue

            if path.suffix.lower() not in VIDEO_EXTENSIONS:
                continue

            videos.append({
                "name": path.name,
                "size_bytes": path.stat().st_size,
            })

    except OSError:
        raise HTTPException(
            status_code=500,
            detail="Unable to read the media directory",
        )

    videos.sort(key=lambda video: video["name"].lower())

    return {"videos": videos}


# Serve a selected video.
@app.get("/api/videos/{filename}")
async def stream_video(filename: str):
    requested_path = (MEDIA_DIR / filename).resolve()

    # Prevent access outside the authorised media directory.
    if not requested_path.is_relative_to(MEDIA_DIR):
        raise HTTPException(
            status_code=403,
            detail="Access denied",
        )

    if requested_path.suffix.lower() not in VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=404,
            detail="Unsupported media file",
        )

    if not requested_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Video not found",
        )

    media_type = (
        mimetypes.guess_type(requested_path.name)[0]
        or "application/octet-stream"
    )

    return FileResponse(
        path=requested_path,
        media_type=media_type,
        filename=None,
    )
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