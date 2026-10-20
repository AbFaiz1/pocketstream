const status = document.querySelector("#status");
const videoList = document.querySelector("#video-list");
const seriesList = document.querySelector("#series-list");
const seriesSection = document.querySelector("#series");
const librarySection = document.querySelector("#library");
const episodePanel = document.querySelector("#episode-panel");
const episodeList = document.querySelector("#episode-list");
const episodeSeriesTitle = document.querySelector("#episode-series-title");
const player = document.querySelector("#player");
const nowPlaying = document.querySelector("#now-playing");
const searchInput = document.querySelector("#video-search");
const videoCount = document.querySelector("#video-count");
const statVideos = document.querySelector("#stat-videos");
const statSize = document.querySelector("#stat-size");
const featuredPlay = document.querySelector("#featured-play");
const featuredPlayLabel = document.querySelector("#featured-play-label");
const featuredDescription = document.querySelector("#hero-description");
const playerPlaceholder = document.querySelector("#player-placeholder");
const playingIndicator = document.querySelector(".playing-indicator");
const playerOptions = document.querySelector("#player-options");
const audioTrack = document.querySelector("#audio-track");
const subtitlePicker = document.querySelector("#subtitle-picker");
const subtitleTrack = document.querySelector("#subtitle-track");
const externalPlay = document.querySelector("#external-play");

let videos = [];
let currentVideo = null;
let currentMetadata = null;
let currentAudio = 0;
let usingCompatibleStream = false;
let hlsPlayer = null;
let compatibilityTransport = "mp4";
const artSymbols = ["✧", "◈", "☾", "✦", "❋", "◇", "✺", "⌁", "✳"];

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(2)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function getKey(video) { return video.relative_path || video.name; }
function getExtension(filename) {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index + 1).toUpperCase() : "VIDEO";
}
function encodePath(video) { return getKey(video).split("/").map(encodeURIComponent).join("/"); }
function fileUrl(video) { return `/api/file/${encodePath(video)}`; }
function metadataUrl(video) { return `/api/videos/${encodePath(video)}/metadata`; }
function compatibleMp4Url(video, audio = 0) { return `/api/videos/${encodePath(video)}/compatible/video.mp4?audio=${audio}`; }
function compatibleHlsUrl(video, audio = 0) { return `/api/videos/${encodePath(video)}/compatible/stream.m3u8?audio=${audio}`; }
function subtitleUrl(video, track) { return `/api/videos/${encodePath(video)}/subtitles/${track}.vtt`; }
function isSeries(video) { return getKey(video).includes("/"); }
function seriesName(video) { return getKey(video).split("/")[0]; }
function cleanTitle(name) { return name.replace(/\.(mkv|mp4|mov|webm|m4v)$/i, "").replace(/[._]/g, " "); }

function updateStats() {
  const total = videos.reduce((sum, video) => sum + (video.size_bytes || 0), 0);
  videoCount.textContent = videos.length;
  statVideos.textContent = videos.length;
  statSize.textContent = formatSize(total);
}

function createVideoCard(video, index, compact = false) {
  const card = document.createElement("article");
  card.className = compact ? "episode-card" : "video-card";
  card.dataset.filename = getKey(video);
  const art = document.createElement("div");
  art.className = `${compact ? "episode-art" : "card-art"} art-${index % 9}`;
  art.innerHTML = `<span class="art-type">${getExtension(video.name)}</span><span class="art-symbol" aria-hidden="true">${artSymbols[index % artSymbols.length]}</span>`;
  const body = document.createElement("div");
  body.className = compact ? "episode-body" : "card-body";
  const title = document.createElement("h3");
  title.className = compact ? "episode-title" : "card-title";
  title.textContent = cleanTitle(video.name);
  title.title = getKey(video);
  const details = document.createElement("div");
  details.className = "card-details";
  details.innerHTML = `<span>${formatSize(video.size_bytes)}</span><span>${getExtension(video.name)}</span>`;
  body.append(title, details);
  if (!compact && isSeries(video)) {
    const folder = document.createElement("p");
    folder.className = "card-folder";
    folder.textContent = seriesName(video);
    body.append(folder);
  }
  card.append(art, body);
  card.addEventListener("click", () => playVideo(video));
  return card;
}

function renderMovies() {
  const query = searchInput.value.trim().toLowerCase();
  const movies = videos.filter((video) => !isSeries(video) && `${video.name} ${getKey(video)}`.toLowerCase().includes(query));
  videoList.replaceChildren();
  if (!movies.length) {
    videoList.innerHTML = `<div class="empty-state"><strong>${videos.length ? "No movies found." : "Your cinema starts here."}</strong><p>Add movie files directly inside your media folder.</p></div>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  movies.forEach((video, index) => fragment.append(createVideoCard(video, index)));
  videoList.append(fragment);
}

function renderSeries() {
  const query = searchInput.value.trim().toLowerCase();
  const groups = new Map();
  videos.filter(isSeries).forEach((video) => {
    const name = seriesName(video);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(video);
  });
  seriesList.replaceChildren();
  [...groups.entries()].filter(([name]) => name.toLowerCase().includes(query)).forEach(([name, episodes], index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `series-card art-${index % 9}`;
    card.innerHTML = `<span class="series-symbol">${artSymbols[index % artSymbols.length]}</span><span class="series-card-copy"><strong>${name}</strong><span>${episodes.length} episode${episodes.length === 1 ? "" : "s"}</span></span><span class="series-arrow">→</span>`;
    card.addEventListener("click", () => openSeries(name, episodes));
    seriesList.append(card);
  });
  if (!seriesList.children.length) seriesList.innerHTML = '<div class="empty-state"><strong>No series found.</strong><p>Put each show in its own folder inside media.</p></div>';
}

function openSeries(name, episodes) {
  episodeSeriesTitle.textContent = name;
  episodeList.replaceChildren();
  episodes.sort((a, b) => getKey(a).localeCompare(getKey(b), undefined, { numeric: true })).forEach((video, index) => episodeList.append(createVideoCard(video, index, true)));
  episodePanel.hidden = false;
  episodePanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showLibrary(view) {
  const series = view === "series";
  librarySection.hidden = series;
  seriesSection.hidden = !series;
  document.querySelectorAll(".library-tab").forEach((tab) => {
    const active = tab.dataset.libraryView === view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  if (series) renderSeries(); else renderMovies();
}

function updateNowPlaying(video) {
  nowPlaying.textContent = cleanTitle(video.name);
  featuredPlayLabel.textContent = "Play again";
}

function setSubtitle(trackIndex) {
  player.querySelectorAll("track").forEach((track) => track.remove());
  if (trackIndex === "off") return;
  const track = document.createElement("track");
  track.kind = "subtitles";
  track.label = currentMetadata.subtitle_tracks.find((item) => String(item.index) === String(trackIndex))?.label || "Subtitles";
  track.srclang = "en";
  track.src = subtitleUrl(currentVideo, trackIndex);
  track.default = true;
  player.append(track);
}

function loadSource({ compatible = false, audio = 0, fallbackHls = false } = {}) {
  usingCompatibleStream = compatible;
  currentAudio = audio;
  compatibilityTransport = fallbackHls ? "hls" : "mp4";
  if (hlsPlayer) {
    hlsPlayer.destroy();
    hlsPlayer = null;
  }

  player.removeAttribute("src");
  player.load();
  if (!compatible) {
    player.src = fileUrl(currentVideo);
    playbackNote.textContent = "Original quality";
    player.load();
    player.play().catch(() => {});
    return;
  }

  const streamUrl = compatibleHlsUrl(currentVideo, audio);
  playbackNote.textContent = "Starting compatible stream…";

  // Safari plays HLS itself; Chromium browsers need the bundled HLS player.
  if (player.canPlayType("application/vnd.apple.mpegurl")) {
    player.src = streamUrl;
    player.load();
    player.play().catch(() => {});
  } else if (window.Hls && window.Hls.isSupported()) {
    player.removeAttribute("src");
    player.load();
    hlsPlayer = new window.Hls({ enableWorker: true });
    hlsPlayer.loadSource(streamUrl);
    hlsPlayer.attachMedia(player);
    hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, () => {
      player.play().catch(() => {});
    });
    hlsPlayer.on(window.Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        playbackNote.textContent = "Preparing compatible stream…";
        setTimeout(() => loadSource({ compatible: true, audio, fallbackHls: true }), 3000);
      }
    });
  } else {
    playbackNote.textContent = "This browser does not support compatible streaming.";
  }
}

async function loadTracks(video) {
  playerOptions.hidden = true;
  currentMetadata = null;
  try {
    const response = await fetch(metadataUrl(video));
    if (!response.ok) throw new Error("Tracks unavailable");
    currentMetadata = await response.json();
    const audio = currentMetadata.audio_tracks || [];
    const subtitles = currentMetadata.subtitle_tracks || [];
    audioTrack.replaceChildren();
    (audio.length ? audio : [{ index: 0, label: "Default audio" }]).forEach((item) => audioTrack.add(new Option(item.label, item.index)));
    subtitleTrack.replaceChildren(new Option("Off", "off"));
    subtitles.forEach((item) => subtitleTrack.add(new Option(item.label, item.index)));
    subtitlePicker.hidden = !subtitles.length;
    playerOptions.hidden = false;
    return currentMetadata;
  } catch (error) {
    console.warn("Track information unavailable", error);
    return null;
  }
}

async function playVideo(video) {
  if (!video) return;
  currentVideo = video;
  window.currentVideo = video;
  player.classList.add("is-visible");
  playerPlaceholder.hidden = true;
  updateNowPlaying(video);
  const metadata = await loadTracks(video);
  // An extension rename does not convert the file: detect Matroska/WebM from
  // ffprobe and use the compatible path even when its filename ends in .mp4.
  const container = metadata?.container || "";
  const needsCompatibility = getExtension(video.name) === "MKV" ||
    container.includes("matroska") || container.includes("webm");
  loadSource({ compatible: needsCompatibility, fallbackHls: false });
  document.querySelector("#player-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadVideos() {
  status.textContent = "Preparing your cinema...";
  try {
    const response = await fetch("/api/videos");
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const data = await response.json();
    videos = (data.videos || []).filter((video) => video && typeof video.name === "string" && Number.isFinite(video.size_bytes)).sort((a, b) => getKey(a).localeCompare(getKey(b), undefined, { numeric: true, sensitivity: "base" }));
    updateStats(); renderMovies(); renderSeries();
    status.textContent = `${videos.length} video${videos.length === 1 ? "" : "s"} ready — movies and series are organised separately.`;
    featuredDescription.textContent = `${videos.length} titles in your personal collection. Your next great escape is waiting.`;
    featuredPlay.disabled = !videos.length;
  } catch (error) {
    status.textContent = `Unable to load your library: ${error.message}`;
  }
}

searchInput.addEventListener("input", () => { renderMovies(); renderSeries(); });
document.querySelectorAll(".library-tab").forEach((tab) => tab.addEventListener("click", () => showLibrary(tab.dataset.libraryView)));
document.querySelector('a[href="#series"]').addEventListener("click", () => showLibrary("series"));
document.querySelector('a[href="#library"]').addEventListener("click", () => showLibrary("movies"));
document.querySelector("#close-episodes").addEventListener("click", () => { episodePanel.hidden = true; });
featuredPlay.addEventListener("click", () => playVideo(currentVideo || videos[0]));
audioTrack.addEventListener("change", () => { if (currentVideo) loadSource({ compatible: true, audio: Number(audioTrack.value) }); });
subtitleTrack.addEventListener("change", () => setSubtitle(subtitleTrack.value));
player.addEventListener("play", () => playingIndicator.classList.add("is-active"));
player.addEventListener("pause", () => playingIndicator.classList.remove("is-active"));
player.addEventListener("ended", () => playingIndicator.classList.remove("is-active"));
player.addEventListener("error", () => {
  if (!currentVideo) return;
  if (!usingCompatibleStream) { loadSource({ compatible: true, audio: currentAudio }); return; }
  if (compatibilityTransport === "mp4") {
    loadSource({ compatible: true, audio: currentAudio, fallbackHls: true });
    return;
  }
  nowPlaying.textContent = `Unable to play: ${cleanTitle(currentVideo.name)}`;
  playbackNote.textContent = "This file could not be converted. Check its video/audio codec.";
  playingIndicator.classList.remove("is-active");
});
externalPlay.addEventListener("click", async () => { if (!currentVideo) { alert("Pehle video play karo"); return; } const url = `${location.origin}${fileUrl(currentVideo)}`; try { await navigator.clipboard.writeText(url); } catch(e){} playbackNote.textContent = `Copied: ${url} — paste in VLC`; alert(url); });
loadVideos();
