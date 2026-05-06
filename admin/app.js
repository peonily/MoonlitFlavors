const form = document.querySelector("#uploadForm");
const imageInput = document.querySelector("#imageInput");
const dropzone = document.querySelector(".dropzone");
const previewWrap = document.querySelector("#previewWrap");
const statusEl = document.querySelector("#status");
const submitButton = document.querySelector("#submitButton");
const clearButton = document.querySelector("#clearButton");
const summary = document.querySelector("#summary");
const queueList = document.querySelector("#queueList");

const PROCESS_DELAY_MS = 5000;
const FAILED_ITEM_RETRY_DELAY_MS = 30000;
const MAX_ITEM_ATTEMPTS = 2;

let queuedFiles = [];
let previewUrls = [];
let isProcessing = false;

imageInput.addEventListener("change", () => {
  setQueuedFiles(Array.from(imageInput.files || []));
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragging");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");

  const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
  setQueuedFiles(files);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!queuedFiles.length) {
    setStatus("Choose one or more images first.", "error");
    return;
  }

  isProcessing = true;
  setLoading(true);
  summary.textContent = `Processing 0 of ${queuedFiles.length}. Each image runs one at a time.`;
  summary.classList.remove("empty");

  let completed = 0;
  let failed = 0;

  for (let index = 0; index < queuedFiles.length; index += 1) {
    const file = queuedFiles[index];
    const row = queueList.querySelector(`[data-index="${index}"]`);

    updateQueueRow(row, {
      state: "loading",
      status: `Processing ${index + 1} of ${queuedFiles.length}...`,
    });
    setStatus(`Generating ${index + 1} of ${queuedFiles.length}: ${file.name}`, "loading");

    try {
      const result = await generateRecipeWithRetry(file, row, index, queuedFiles.length);
      completed += 1;
      updateQueueRow(row, {
        state: "success",
        status: "Done",
        result,
      });
    } catch (error) {
      failed += 1;
      updateQueueRow(row, {
        state: "error",
        status: "Failed",
        error: error.message || "Recipe generation failed.",
      });
    }

    summary.textContent = `Completed ${completed} of ${queuedFiles.length}. Failed ${failed}.`;

    if (index < queuedFiles.length - 1) {
      setStatus("Moving to the next image. Backend pacing is adaptive and only slows down after provider errors.", "loading");
      await sleep(PROCESS_DELAY_MS);
    }
  }

  isProcessing = false;
  setLoading(false);
  setStatus(`Batch finished. ${completed} done, ${failed} failed.`, failed ? "error" : "success");
});

clearButton.addEventListener("click", () => {
  if (isProcessing) {
    setStatus("Batch is running. Wait for it to finish before clearing.", "error");
    return;
  }

  imageInput.value = "";
  queuedFiles = [];
  renderQueue();
  summary.textContent = "Generated recipe pages, R2 image URLs, and run logs will appear here.";
  summary.classList.add("empty");
  setStatus("", "");
});

function renderQueue() {
  revokePreviewUrls();
  queueList.textContent = "";

  if (!queuedFiles.length) {
    previewWrap.hidden = true;
    queueList.hidden = true;
    return;
  }

  previewWrap.hidden = false;
  queueList.hidden = false;

  queuedFiles.forEach((file, index) => {
    const previewUrl = URL.createObjectURL(file);
    previewUrls.push(previewUrl);

    const preview = document.createElement("div");
    const previewImage = document.createElement("img");
    const previewName = document.createElement("span");
    previewImage.src = previewUrl;
    previewImage.alt = file.name;
    previewName.textContent = file.name;
    preview.append(previewImage, previewName);
    previewWrap.appendChild(preview);

    queueList.appendChild(createQueueRow({ file, index, previewUrl }));
  });

  summary.textContent = `${queuedFiles.length} image${queuedFiles.length === 1 ? "" : "s"} queued.`;
  summary.classList.remove("empty");
}

function setQueuedFiles(files) {
  if (isProcessing) {
    setStatus("Batch is running. Wait for it to finish before changing the queue.", "error");
    return;
  }

  queuedFiles = files;
  renderQueue();
}

function createQueueRow({ file, index, previewUrl }) {
  const row = document.createElement("article");
  row.className = "queue-row";
  row.dataset.index = String(index);
  row.dataset.state = "queued";

  row.innerHTML = `
    <img class="queue-thumb" src="${previewUrl}" alt="">
    <div class="queue-main">
      <div class="queue-topline">
        <h3>${escapeHtml(file.name)}</h3>
        <span class="queue-state">Queued</span>
      </div>
      <p class="queue-meta">${formatBytes(file.size)}</p>
      <div class="queue-links" hidden></div>
      <pre class="queue-log" hidden></pre>
    </div>
  `;

  return row;
}

async function generateRecipe(file) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("/api/generate-recipe", {
    method: "POST",
    body: formData,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Recipe generation failed.");
  }

  return data;
}

async function generateRecipeWithRetry(file, row, index, total) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ITEM_ATTEMPTS; attempt += 1) {
    try {
      updateQueueRow(row, {
        state: "loading",
        status: `Processing ${index + 1} of ${total} - attempt ${attempt}/${MAX_ITEM_ATTEMPTS}`,
      });
      return await generateRecipe(file);
    } catch (error) {
      lastError = error;

      if (attempt < MAX_ITEM_ATTEMPTS) {
        updateQueueRow(row, {
          state: "loading",
          status: `Retrying in ${Math.round(FAILED_ITEM_RETRY_DELAY_MS / 1000)}s`,
        });
        await sleep(FAILED_ITEM_RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

function updateQueueRow(row, { state, status, result, error }) {
  if (!row) return;

  row.dataset.state = state;
  row.querySelector(".queue-state").textContent = status;

  const links = row.querySelector(".queue-links");
  const log = row.querySelector(".queue-log");

  if (result) {
    links.hidden = false;
    links.innerHTML = `
      <a href="${escapeHtml(toSitePreviewUrl(result.pageUrl) || "#")}" target="_blank" rel="noreferrer">${escapeHtml(
        result.title || result.pagePath || "Recipe page"
      )}</a>
      <a href="/site/" target="_blank" rel="noreferrer">Homepage</a>
      <a href="${escapeHtml(result.uploadedImageUrl || "#")}" target="_blank" rel="noreferrer">R2 image</a>
      <button class="copy copy-row-log" type="button">Copy Log</button>
    `;
    log.hidden = false;
    log.textContent = result.output || "";
    links.querySelector(".copy-row-log").addEventListener("click", async (event) => {
      await navigator.clipboard.writeText(log.textContent || "");
      event.currentTarget.textContent = "Copied";
      setTimeout(() => {
        event.currentTarget.textContent = "Copy Log";
      }, 900);
    });
  }

  if (error) {
    log.hidden = false;
    log.textContent = error;
  }
}

function setStatus(message, state) {
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  clearButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Batch Running..." : "Start Batch";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSitePreviewUrl(value) {
  if (!value) {
    return "";
  }

  return `/site/${String(value).replace(/^\/+/, "")}`;
}

function revokePreviewUrls() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  previewWrap.textContent = "";
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
