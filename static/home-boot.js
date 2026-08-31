function applyBootCompleteUI({ title, detail }) {
  const headline = String(title || "Booting complete.").trim();
  const detailText = String(detail || "I'm ready and awake.").trim();
  if (
    currentActivitySnapshot.state === "standby" &&
    !resolveListeningIntent() &&
    !hasCustomStandbyActivityCopy()
  ) {
    currentActivitySnapshot = {
      ...currentActivitySnapshot,
      headline,
      detail: detailText,
    };
  }
  renderState();
}

async function syncBootState(snapshot) {
  const boot = snapshot?.boot;
  if (!boot || typeof boot !== "object") {
    rebootPendingFromStatus = false;
    return { freshBoot: false };
  }

  rebootPendingFromStatus = boot.reboot_pending === true;

  if (rebootPendingFromStatus) {
    if (!reconnectInProgress && typeof beginNanoReconnect === "function") {
      void beginNanoReconnect("reboot_pi");
    }
    return { freshBoot: false, rebootPending: true };
  }

  const bootId = String(boot.id || "").trim();
  if (!bootId) {
    return { freshBoot: false };
  }

  let previous = "";
  try {
    previous = window.sessionStorage.getItem(LAST_BOOT_ID_KEY) || "";
  } catch (_error) {
    // Ignore storage read failures.
  }

  const freshBoot = !previous || previous !== bootId;

  if (freshBoot) {
    const bootEvent = findLatestBootEvent(snapshot);
    applyBootCompleteUI({
      title: bootEvent?.title || "Booting complete.",
      detail: bootEvent?.detail || "I'm ready and awake.",
    });
    await refreshStandbyGreeting({ speakOnce: true, bootKey: bootId });
  }

  try {
    window.sessionStorage.setItem(LAST_BOOT_ID_KEY, bootId);
  } catch (_error) {
    // Ignore storage write failures.
  }

  return { freshBoot, rebootPending: false };
}
