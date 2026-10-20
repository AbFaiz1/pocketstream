const status = document.querySelector("#status");
const videoList = document.querySelector("#video-list");
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

let videos = [];
let currentVideo = null;

const artSymbols = [
  "✧", "◈", "☾", "✦", "❋", "◇", "✺", "⌁", "✳"
];

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "Unknown size";
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getExtension(filename) {
  const index = filename.lastIndexOf(".");

  return index >= 0
    ? filename.slice(index + 1).toUpperCase()
    : "VIDEO";
}

function getVideoUrl(filename) {
  return `/api/videos/${encodeURIComponent(filename)}`;
}

function updateStats() {
  const totalBytes = videos.reduce(
    (total, video) => total + (video.size_bytes || 0),
    0
  );

  videoCount.textContent = videos.length;
  statVideos.textContent = videos.length;
  statSize.textContent = formatSize(totalBytes);
}

function createVideoCard(video, index) {
  const card = document.createElement("article");
  card.className = "video-card";
  card.dataset.filename = video.name;

  const art = document.createElement("div");
  art.className = `card-art art-${index % 9}`;

  const type = document.createElement("span");
  type.className = "art-type";
  type.textContent = getExtension(video.name);

  const symbol = document.createElement("span");
  symbol.className = "art-symbol";
  symbol.textContent = artSymbols[index % artSymbols.length];
  symbol.setAttribute("aria-hidden", "true");

  const playButton = document.createElement("button");
  playButton.className = "card-play";
  playButton.type = "button";
  playButton.textContent = "▶";
  playButton.setAttribute("aria-label", `Play ${video.name}`);

  art.append(type, symbol, playButton);

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = video.name;
  title.title = video.name;

  const details = document.createElement("div");
  details.className = "card-details";

  const size = document.createElement("span");
  size.textContent = formatSize(video.size_bytes);

  const format = document.createElement("span");
  format.textContent = getExtension(video.name);

  details.append(size, format);

  const progress = document.createElement("div");
  progress.className = "card-progress";
  progress.setAttribute("aria-hidden", "true");

  const progressFill = document.createElement("span");
  progress.appendChild(progressFill);

  body.append(title, details, progress);
  card.append(art, body);

  playButton.addEventListener("click", () => {
    playVideo(video);
  });

  // Clicking the card also plays the video.
  card.addEventListener("click", (event) => {
    if (event.target.closest("button")) {
      return;
    }

    playVideo(video);
  });

  return card;
}

function renderVideos() {
  const query = searchInput.value.trim().toLowerCase();

  const filteredVideos = videos.filter((video) =>
    video.name.toLowerCase().includes(query)
  );

  videoList.replaceChildren();

  if (filteredVideos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";

    const title = document.createElement("strong");
    const description = document.createElement("p");

    if (videos.length === 0) {
      title.textContent = "Your cinema starts here.";
      description.textContent =
        "Add video files to your media folder and refresh this page.";
    } else {
      title.textContent = "No matches this time.";
      description.textContent =
        "Try another search to find your favorite video.";
    }

    empty.append(title, description);
    videoList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  filteredVideos.forEach((video, index) => {
    const card = createVideoCard(video, index);

    if (currentVideo?.name === video.name) {
      card.classList.add("is-playing");
    }

    card.style.animationDelay = `${Math.min(index * 45, 350)}ms`;
    fragment.appendChild(card);
  });

  videoList.appendChild(fragment);
}

function updateNowPlaying(video) {
  nowPlaying.textContent = video.name;
  featuredPlayLabel.textContent = "Play again";

  document.querySelectorAll(".video-card").forEach((card) => {
    card.classList.toggle(
      "is-playing",
      card.dataset.filename === video.name
    );
  });
}

function playVideo(video) {
  if (!video) {
    status.textContent = "Add videos to your media folder to get started.";
    return;
  }

  currentVideo = video;

  player.src = getVideoUrl(video.name);
  player.classList.add("is-visible");
  playerPlaceholder.hidden = true;

  updateNowPlaying(video);

  // Update the visible card selection.
  renderVideos();

  document.querySelector("#player-section").scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "start"
  });

  player.play().catch(() => {
    // Autoplay can be blocked by the browser.
    // The built-in video controls remain available.
  });
}

async function loadVideos() {
  status.textContent = "Preparing your cinema...";
  videoList.replaceChildren();

  try {
    const response = await fetch("/api/videos");

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data.videos)) {
      throw new Error("Unexpected response from the server");
    }

    videos = data.videos
      .filter((video) =>
        video &&
        typeof video.name === "string" &&
        Number.isFinite(video.size_bytes)
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    updateStats();
    renderVideos();

    if (videos.length === 0) {
      status.textContent = "Your library is waiting for its first video.";
      featuredDescription.textContent =
        "Drop your video files into the media folder to get started.";
      featuredPlayLabel.textContent = "No videos yet";
      featuredPlay.disabled = true;
      return;
    }

    status.textContent = `${videos.length} video${videos.length === 1 ? "" : "s"} ready for your next movie night.`;

    featuredDescription.textContent =
      `${videos.length} video${videos.length === 1 ? "" : "s"} in your personal collection. Your next great escape is waiting.`;

    featuredPlay.disabled = false;
    featuredPlayLabel.textContent = "Play your first video";
  } catch (error) {
    console.error("Unable to load videos:", error);

    status.textContent =
      `Unable to load your library: ${error.message}`;

    videoList.replaceChildren();

    const empty = document.createElement("div");
    empty.className = "empty-state";

    const title = document.createElement("strong");
    title.textContent = "We couldn't reach your library.";

    const description = document.createElement("p");
    description.textContent =
      "Check that PocketStream is running and try refreshing the page.";

    empty.append(title, description);
    videoList.appendChild(empty);
  }
}
async function loadConnectionInfo() {
  const status = document.querySelector("#connection-status");
  const instructions = document.querySelector(
    "#connection-instructions"
  );

  try {
    const response = await fetch("/api/connection");

    if (!response.ok) {
      throw new Error("Unable to retrieve connection information");
    }

    const data = await response.json();

    if (!data.local_ip) {
      status.textContent =
        "Could not detect the local IP address.";
      instructions.textContent =
        "Check your Wi-Fi settings and find the Mac's local IP.";
      return;
    }

    const address = `http://${data.local_ip}:${data.port}`;

    status.textContent = `Open on your phone: ${address}`;
    instructions.textContent = data.instructions;
  } catch (error) {
    status.textContent =
      `Connection information unavailable: ${error.message}`;
  }
}

loadConnectionInfo();

// Search videos as the user types.
searchInput.addEventListener("input", renderVideos);

// The featured button plays the first video in the library.
featuredPlay.addEventListener("click", () => {
  if (currentVideo && !player.paused) {
    document.querySelector("#player-section").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    return;
  }

  playVideo(currentVideo || videos[0]);
});

// Keep playback indicator synchronized with the video player.
player.addEventListener("play", () => {
  playingIndicator.classList.add("is-active");
});

player.addEventListener("pause", () => {
  playingIndicator.classList.remove("is-active");
});

player.addEventListener("ended", () => {
  playingIndicator.classList.remove("is-active");
});

player.addEventListener("error", () => {
  if (!currentVideo) return;

  nowPlaying.textContent = `Unable to play: ${currentVideo.name}`;
  playingIndicator.classList.remove("is-active");
});

// Initial load.
loadVideos();