function formatPlanDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function isPlanReaderOpen() {
  return activePlanId !== null && planReader && !planReader.hidden;
}

let planCopyResetTimer = null;

function updatePlanCopyButton() {
  if (!planCopyButton) {
    return;
  }
  const hasBody = Boolean(planReaderBody?.textContent?.trim());
  planCopyButton.disabled = !isPlanReaderOpen() || !hasBody;
}

function resetPlanCopyButtonLabel() {
  if (!planCopyButton) {
    return;
  }
  planCopyButton.setAttribute("aria-label", "Copy plan");
}

function clearPlanReaderStatus() {
  if (!planReaderStatus) {
    return;
  }
  planReaderStatus.hidden = true;
  planReaderStatus.textContent = "";
}

function showPlanReaderStatus(message) {
  if (!planReaderStatus) {
    return;
  }
  planReaderStatus.textContent = message;
  planReaderStatus.hidden = false;
}

function closePlanReader() {
  activePlanId = null;
  activePlanKind = "drafted";
  planReader.hidden = true;
  plansList.hidden = false;
  nanoPanelPlans.classList.remove("reading");
  if (planCopyResetTimer) {
    clearTimeout(planCopyResetTimer);
    planCopyResetTimer = null;
  }
  resetPlanCopyButtonLabel();
  updatePlanCopyButton();
  clearPlanReaderStatus();
}

function isPlanProcessable(plan) {
  if (!plan) {
    return false;
  }
  if (plan.kind === "suggestion") {
    return plan.status === "waiting";
  }
  return plan.status === "pending";
}

function updatePlanProcessButton(plan) {
  if (!planProcessButton) {
    return;
  }
  const processable = isPlanProcessable(plan);
  planProcessButton.hidden = !processable;
  planProcessButton.disabled = !processable;
}

function updatePlanImplementButton(plan) {
  if (!planImplementButton) {
    return;
  }
  const implementable = Boolean(
    plan && plan.kind === "drafted" && plan.status === "pending",
  );
  planImplementButton.hidden = !implementable;
  planImplementButton.disabled = !implementable;
}

function updatePlanResetButton(plan) {
  if (!planResetButton) {
    return;
  }
  const resettable = Boolean(
    plan && plan.kind === "drafted" && plan.status === "implementing",
  );
  planResetButton.hidden = !resettable;
  planResetButton.disabled = !resettable;
}

function openPlanReader(plan) {
  activePlanId = plan.id;
  activePlanKind = plan.kind || "drafted";
  planReaderTitle.textContent = planCardLabel(plan);
  planReaderBody.textContent = plan.body || "";
  updatePlanProcessButton(plan);
  updatePlanImplementButton(plan);
  updatePlanResetButton(plan);
  clearPlanReaderStatus();
  plansList.hidden = true;
  planReader.hidden = false;
  nanoPanelPlans.classList.add("reading");
  resetPlanCopyButtonLabel();
  updatePlanCopyButton();
}

async function openPlanById(planId, kind = "drafted") {
  const path =
    kind === "suggestion"
      ? `/api/improvement-plans/suggestions/${planId}`
      : `/api/improvement-plans/${planId}`;
  const response = await nanoFetch(path);
  if (!response.ok) {
    return;
  }
  const plan = await response.json();
  openPlanReader(plan);
}

function planCardLabel(plan) {
  const raw = plan.title || plan.goal || "Improvement plan";
  const cleaned = String(raw).replace(/\s+/g, " ").trim();
  if (cleaned.length <= 96) {
    return cleaned;
  }
  return `${cleaned.slice(0, 93)}...`;
}

function updatePlansTabCount(plans) {
  if (!plansTabCount) {
    return;
  }
  const pending = Array.isArray(plans)
    ? plans.filter(
        (plan) =>
          plan.status === "pending" ||
          plan.status === "waiting" ||
          plan.status === "implementing",
      ).length
    : 0;
  plansTabCount.hidden = pending === 0;
  plansTabCount.textContent = String(pending);
  plansTabCount.setAttribute(
    "aria-label",
    pending === 1 ? "1 pending plan" : `${pending} pending plans`,
  );
}

function renderPlans(plans) {
  updatePlansTabCount(plans);
  if (!plansList) {
    return;
  }
  plansList.replaceChildren();
  if (!Array.isArray(plans) || plans.length === 0) {
    if (!isPlanReaderOpen()) {
      plansList.hidden = false;
    }
    const empty = document.createElement("p");
    empty.className = "plans-empty";
    empty.textContent =
      "No improvement topics yet. Nano will suggest one idea at a time when idle.";
    plansList.appendChild(empty);
    return;
  }

  for (const plan of plans) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "plan-card";
    button.setAttribute("role", "listitem");

    const title = document.createElement("span");
    title.className = "plan-card-title";
    title.textContent = planCardLabel(plan);

    const meta = document.createElement("span");
    meta.className = "plan-card-meta";
    meta.textContent = formatPlanDate(plan.created_at);

    const status = document.createElement("span");
    const isPending = plan.status === "pending";
    const isWaiting = plan.status === "waiting";
    const isImplementing = plan.status === "implementing";
    status.className = `plan-card-status ${
      isPending ? "pending" : isWaiting ? "waiting" : isImplementing ? "pending" : "processed"
    }`;
    status.textContent = isPending
      ? "Pending"
      : isWaiting
        ? "Waiting"
        : isImplementing
          ? "Implementing"
          : "Done";

    button.append(title, meta, status);
    button.addEventListener("click", () => {
      void openPlanById(plan.id, plan.kind || "drafted");
    });
    plansList.appendChild(button);
  }
  plansList.hidden = isPlanReaderOpen();
}

async function loadPlans() {
  if (!plansList) {
    return;
  }
  try {
    const response = await nanoFetch("/api/improvement-plans");
    if (!response.ok) {
      renderPlans([]);
      return;
    }
    const plans = await response.json();
    renderPlans(plans);
  } catch (_error) {
    renderPlans([]);
  }
}

async function processActivePlan() {
  if (activePlanId === null || !planProcessButton || planProcessButton.disabled) {
    return;
  }
  const path =
    activePlanKind === "suggestion"
      ? `/api/improvement-plans/suggestions/${activePlanId}/process`
      : `/api/improvement-plans/${activePlanId}/process`;
  const response = await nanoFetch(path, {
    method: "POST",
  });
  if (!response.ok) {
    return;
  }
  closePlanReader();
  await loadPlans();
}

async function resetActivePlan() {
  if (
    activePlanId === null ||
    activePlanKind !== "drafted" ||
    !planResetButton ||
    planResetButton.disabled
  ) {
    return;
  }

  clearPlanReaderStatus();
  planResetButton.disabled = true;

  try {
    const response = await nanoFetch(`/api/improvement-plans/${activePlanId}/reset`, {
      method: "POST",
    });

    if (response.status === 204) {
      await openPlanById(activePlanId, activePlanKind);
      await loadPlans();
      return;
    }

    let message = "Could not reset implementation.";
    try {
      const payload = await response.json();
      if (payload?.detail) {
        message = String(payload.detail);
      }
    } catch (_error) {
      // Keep default message when the response is not JSON.
    }
    showPlanReaderStatus(message);
    await openPlanById(activePlanId, activePlanKind);
  } catch (_error) {
    showPlanReaderStatus("Could not reset implementation.");
    planResetButton.disabled = false;
  }
}

async function implementActivePlan() {
  if (
    activePlanId === null ||
    activePlanKind !== "drafted" ||
    !planImplementButton ||
    planImplementButton.disabled
  ) {
    return;
  }

  clearPlanReaderStatus();
  try {
    const preflightResponse = await nanoFetch(
      `/api/improvement-plans/${activePlanId}/preflight`,
    );
    if (!preflightResponse.ok) {
      let message = "Could not check whether implementation can start.";
      try {
        const payload = await preflightResponse.json();
        if (payload?.detail) {
          message = String(payload.detail);
        }
      } catch (_error) {
        // Keep default message when the response is not JSON.
      }
      showPlanReaderStatus(message);
      return;
    }

    const preflight = await preflightResponse.json();
    if (!preflight?.ok) {
      showPlanReaderStatus(
        preflight?.error || "Implementation cannot start right now.",
      );
      return;
    }
  } catch (_error) {
    showPlanReaderStatus("Could not check whether implementation can start.");
    return;
  }

  if (
    !window.confirm("This will edit code and open a pull request. Continue?")
  ) {
    return;
  }

  planImplementButton.disabled = true;
  if (planProcessButton) {
    planProcessButton.disabled = true;
  }

  try {
    const response = await nanoFetch(`/api/improvement-plans/${activePlanId}/implement`, {
      method: "POST",
    });

    if (response.status === 202) {
      closePlanReader();
      await loadPlans();
      return;
    }

    let message = "Could not start implementation.";
    try {
      const payload = await response.json();
      if (payload?.detail) {
        message = String(payload.detail);
      }
    } catch (_error) {
      // Keep default message when the response is not JSON.
    }
    showPlanReaderStatus(message);
    updatePlanImplementButton({ kind: "drafted", status: "pending" });
    if (planProcessButton) {
      planProcessButton.disabled = false;
    }
  } catch (_error) {
    showPlanReaderStatus("Could not start implementation.");
    updatePlanImplementButton({ kind: "drafted", status: "pending" });
    if (planProcessButton) {
      planProcessButton.disabled = false;
    }
  }
}

async function copyActivePlan() {
  if (!planReaderBody?.textContent?.trim() || !planCopyButton) {
    return;
  }
  try {
    await navigator.clipboard.writeText(planReaderBody.textContent);
    planCopyButton.setAttribute("aria-label", "Copied");
    if (planCopyResetTimer) {
      clearTimeout(planCopyResetTimer);
    }
    planCopyResetTimer = setTimeout(() => {
      resetPlanCopyButtonLabel();
      planCopyResetTimer = null;
    }, 1500);
  } catch (_error) {
    planCopyButton.setAttribute("aria-label", "Copy failed");
    if (planCopyResetTimer) {
      clearTimeout(planCopyResetTimer);
    }
    planCopyResetTimer = setTimeout(() => {
      resetPlanCopyButtonLabel();
      planCopyResetTimer = null;
    }, 1500);
  }
}

planProcessButton.addEventListener("click", () => {
  void processActivePlan();
});

if (planImplementButton) {
  planImplementButton.addEventListener("click", () => {
    void implementActivePlan();
  });
}

if (planResetButton) {
  planResetButton.addEventListener("click", () => {
    void resetActivePlan();
  });
}

if (planCopyButton) {
  planCopyButton.addEventListener("click", () => {
    void copyActivePlan();
  });
}
