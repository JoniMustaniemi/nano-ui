let driveLinks = [];
let driveSelectedLinkId = null;
let drivePreviewRequestId = 0;
let driveControlsBound = false;

function setDriveError(message) {
  if (!driveError) {
    return;
  }
  const text = String(message || "").trim();
  if (!text) {
    driveError.hidden = true;
    driveError.textContent = "";
    return;
  }
  driveError.hidden = false;
  driveError.textContent = text;
}

function setDriveLinkFieldError(message) {
  if (!driveLinkError) {
    return;
  }
  const text = String(message || "").trim();
  if (!text) {
    driveLinkError.hidden = true;
    driveLinkError.textContent = "";
    return;
  }
  driveLinkError.hidden = false;
  driveLinkError.textContent = text;
}

function getSelectedDriveLink() {
  return driveLinks.find((entry) => entry.id === driveSelectedLinkId) || null;
}

function syncDriveAskButton() {
  if (!driveAskButton || !driveQuestionInput) {
    return;
  }
  const question = driveQuestionInput.value.trim();
  const linkText = driveLinkInput ? driveLinkInput.value.trim() : "";
  let linkInvalid = false;
  if (linkText && !parseDriveFileId(linkText)) {
    linkInvalid = true;
  }
  const busy = typeof isBusy === "function" ? isBusy() : false;
  driveAskButton.disabled = !question || linkInvalid || busy || reconnectInProgress;
}

function renderDriveLinkList() {
  if (!driveLinkList) {
    return;
  }
  driveLinkList.innerHTML = "";
  if (driveLinks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "drive-link-list-empty";
    empty.textContent = "No saved links yet.";
    driveLinkList.appendChild(empty);
    return;
  }
  for (const link of driveLinks) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "drive-link-item";
    item.dataset.driveLinkId = link.id;
    item.classList.toggle("active", link.id === driveSelectedLinkId);
    const title = document.createElement("span");
    title.className = "drive-link-item-label";
    title.textContent = link.label;
    const url = document.createElement("span");
    url.className = "drive-link-item-url";
    url.textContent = link.url;
    item.append(title, url);
    driveLinkList.appendChild(item);
  }
  if (driveDeleteButton) {
    driveDeleteButton.disabled = !driveSelectedLinkId;
  }
}

function refreshDriveLinksFromStorage() {
  driveLinks = loadDriveLinks();
  if (driveSelectedLinkId && !driveLinks.some((entry) => entry.id === driveSelectedLinkId)) {
    driveSelectedLinkId = null;
  }
  renderDriveLinkList();
  syncDriveAskButton();
}

async function refreshDrivePreview() {
  if (!drivePreviewMeta && !drivePreviewBody) {
    return;
  }
  const { url, error } = resolveDriveContextUrl({
    linkInput: driveLinkInput?.value || "",
    selectedLink: getSelectedDriveLink(),
  });
  if (error) {
    setDriveLinkFieldError(error);
    if (drivePreviewPanel) {
      drivePreviewPanel.hidden = true;
    }
    return;
  }
  setDriveLinkFieldError("");
  if (!url) {
    if (drivePreviewPanel) {
      drivePreviewPanel.hidden = true;
    }
    if (drivePreviewMeta) {
      drivePreviewMeta.textContent = "";
    }
    if (drivePreviewBody) {
      drivePreviewBody.textContent = "";
    }
    return;
  }
  const fileId = parseDriveFileId(url);
  const requestId = ++drivePreviewRequestId;
  if (drivePreviewPanel) {
    drivePreviewPanel.hidden = false;
  }
  if (drivePreviewMeta) {
    drivePreviewMeta.textContent = "Loading preview…";
  }
  if (drivePreviewBody) {
    drivePreviewBody.textContent = "";
  }
  try {
    const metadata = await fetchDriveMetadata(fileId);
    if (requestId !== drivePreviewRequestId) {
      return;
    }
    const size =
      metadata.size != null && metadata.size !== ""
        ? ` · ${Number(metadata.size).toLocaleString()} bytes`
        : "";
    if (drivePreviewMeta) {
      drivePreviewMeta.textContent = `${metadata.name || fileId} · ${metadata.mime_type || "unknown"}${size}`;
    }
    const content = await fetchDriveContent(fileId);
    if (requestId !== drivePreviewRequestId) {
      return;
    }
    if (drivePreviewBody) {
      drivePreviewBody.textContent = content.text || "(empty file)";
    }
    if (drivePreviewTruncated) {
      drivePreviewTruncated.hidden = !content.truncated;
    }
  } catch (previewError) {
    if (requestId !== drivePreviewRequestId) {
      return;
    }
    if (drivePreviewMeta) {
      drivePreviewMeta.textContent = "Preview unavailable (you can still ask Nano).";
    }
    if (drivePreviewBody) {
      drivePreviewBody.textContent = previewError.message || "Preview failed.";
    }
    if (drivePreviewTruncated) {
      drivePreviewTruncated.hidden = true;
    }
  }
}

function scheduleDrivePreviewRefresh() {
  syncDriveAskButton();
  void refreshDrivePreview();
}

function bindDriveControls() {
  if (driveControlsBound) {
    return;
  }
  driveControlsBound = true;

  if (driveLinkList) {
    driveLinkList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-drive-link-id]");
      if (!button) {
        return;
      }
      driveSelectedLinkId = button.dataset.driveLinkId || null;
      renderDriveLinkList();
      scheduleDrivePreviewRefresh();
    });
  }

  if (driveLinkInput) {
    driveLinkInput.addEventListener("input", () => {
      const linkText = driveLinkInput.value.trim();
      if (!linkText) {
        setDriveLinkFieldError("");
      } else if (!parseDriveFileId(linkText)) {
        setDriveLinkFieldError("Enter a valid Google Drive link or file ID.");
      } else {
        setDriveLinkFieldError("");
      }
      scheduleDrivePreviewRefresh();
    });
  }

  if (driveQuestionInput) {
    driveQuestionInput.addEventListener("input", syncDriveAskButton);
  }

  if (driveAddButton && driveAddLabelInput && driveAddUrlInput) {
    driveAddButton.addEventListener("click", () => {
      const label = driveAddLabelInput.value.trim();
      const urlInput = driveAddUrlInput.value.trim();
      const fileId = parseDriveFileId(urlInput);
      if (!label) {
        setDriveError("Add a label for the bookmark.");
        return;
      }
      if (!fileId) {
        setDriveError("Enter a valid Google Drive link or file ID to save.");
        return;
      }
      const url = driveCanonicalFileUrl(fileId);
      driveLinks = saveDriveLinks([
        ...driveLinks,
        { id: createDriveLinkId(), label, url },
      ]);
      driveAddLabelInput.value = "";
      driveAddUrlInput.value = "";
      setDriveError("");
      refreshDriveLinksFromStorage();
    });
  }

  if (driveDeleteButton) {
    driveDeleteButton.addEventListener("click", () => {
      if (!driveSelectedLinkId) {
        return;
      }
      driveLinks = saveDriveLinks(driveLinks.filter((entry) => entry.id !== driveSelectedLinkId));
      driveSelectedLinkId = null;
      refreshDriveLinksFromStorage();
      scheduleDrivePreviewRefresh();
    });
  }

  if (driveAskButton) {
    driveAskButton.addEventListener("click", () => {
      void submitDriveQuestion();
    });
  }
}

async function submitDriveQuestion() {
  if (!driveQuestionInput || typeof submitMessage !== "function") {
    return;
  }
  const question = driveQuestionInput.value.trim();
  if (!question) {
    return;
  }
  const { url, error } = resolveDriveContextUrl({
    linkInput: driveLinkInput?.value || "",
    selectedLink: getSelectedDriveLink(),
  });
  if (error) {
    setDriveLinkFieldError(error);
    return;
  }
  const message = composeDriveAgentMessage({ url, question });
  setDriveError("");
  driveQuestionInput.value = "";
  syncDriveAskButton();
  await submitMessage(message, "text");
}

async function loadDriveView() {
  if (typeof loadDriveLinks !== "function") {
    throw new Error("Drive UI failed to load. Hard-refresh the page.");
  }
  bindDriveControls();
  setDriveError("");
  setDriveLinkFieldError("");
  refreshDriveLinksFromStorage();
  if (driveQuestionInput) {
    driveQuestionInput.value = "";
  }
  if (driveLinkInput) {
    driveLinkInput.value = "";
  }
  syncDriveAskButton();
  scheduleDrivePreviewRefresh();
  if (driveQuestionInput) {
    driveQuestionInput.focus();
  }
}

window.loadDriveView = loadDriveView;
window.submitDriveQuestion = submitDriveQuestion;
