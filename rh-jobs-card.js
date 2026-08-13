class RHJobsCard extends HTMLElement {
  constructor() {
    super();
    this._resolvedMediaUrls = new Map();
    this._pendingResolutions = new Set();
    this._mediaCacheTtlMs = 60 * 60 * 1000;
    this._lastRenderKey = "";
    this._pendingConfirmEntityId = null;
    this._pendingConfirmJobName = "";
  }

  set hass(hass) {
    this._hass = hass;
    this._requestUpdate();
  }

  _buildRenderKey() {
    if (!this._hass || !this._config) return "";
    const jobEntityIds = this._jobEntityIds();
    const stateKey = jobEntityIds
      .map((id) => {
        const s = this._hass.states[id];
        return s ? `${id}:${s.state}:${s.attributes?.last_triggered || ""}` : `${id}:missing`;
      })
      .join("|");
    return `${stateKey}~confirm:${this._pendingConfirmEntityId || ""}`;
  }

  _requestUpdate() {
    if (!this._hass || !this._config) return;
    const key = this._buildRenderKey();
    if (key === this._lastRenderKey) return;
    this._lastRenderKey = key;
    this.updateCard();
  }

  setConfig(config) {
    this._config = config || {};
  }

  _title() {
    if (this._config.title === undefined) {
      return "RH Jobs";
    }
    return this._config.title;
  }

  _isDueState(state) {
    if (!state) return false;
    return !["off", "unavailable", "unknown", "none"].includes(state.state);
  }

  _orientation() {
    return this._config.orientation === "horizontal" ? "horizontal" : "vertical";
  }

  _formatTriggered(lastTriggered) {
    if (!lastTriggered) {
      return "Never triggered";
    }
    const parsed = new Date(lastTriggered);
    if (Number.isNaN(parsed.getTime())) {
      return "Triggered";
    }
    return `Triggered ${parsed.toLocaleString()}`;
  }

  _displayImage(image) {
    if (typeof image !== "string") {
      return "";
    }
    const trimmed = image.trim();
    if (!trimmed) {
      return "";
    }

    if (!trimmed.startsWith("media-source://")) {
      return trimmed;
    }

    const cached = this._resolvedMediaUrls.get(trimmed);
    if (cached && Date.now() - cached.resolvedAt < this._mediaCacheTtlMs) {
      return cached.url || "";
    }

    this._resolveMediaSource(trimmed);
    return cached?.url || "";
  }

  _normalizeResolvedUrl(url) {
    if (typeof url !== "string" || !url) {
      return "";
    }
    try {
      // Always return a fully-qualified absolute URL so that images load
      // correctly regardless of the page origin (e.g. HA Cast receiver).
      return new URL(url, window.location.origin).href;
    } catch (_err) {
      return url;
    }
  }

  _resolveMediaSource(mediaContentId) {
    if (this._pendingResolutions.has(mediaContentId)) {
      return;
    }
    if (!this._hass || typeof this._hass.callWS !== "function") {
      return;
    }

    this._pendingResolutions.add(mediaContentId);
    this._hass
      .callWS({
        type: "media_source/resolve_media",
        media_content_id: mediaContentId,
      })
      .then((result) => {
        const url = this._normalizeResolvedUrl(typeof result?.url === "string" ? result.url : "");
        this._resolvedMediaUrls.set(mediaContentId, {
          url,
          resolvedAt: Date.now(),
        });
      })
      .catch(() => {
        this._resolvedMediaUrls.set(mediaContentId, {
          url: "",
          resolvedAt: Date.now(),
        });
      })
      .finally(() => {
        this._pendingResolutions.delete(mediaContentId);
        // Reset render key so the newly resolved image is picked up.
        this._lastRenderKey = "";
        this.updateCard();
      });
  }

  _jobEntityIds() {
    if (Array.isArray(this._config.job_entities) && this._config.job_entities.length) {
      return this._config.job_entities;
    }

    return Object.entries(this._hass.states)
      .filter(([entityId, state]) => entityId.startsWith("binary_sensor.rh_jobs_") && state?.attributes?.job_id)
      .map(([entityId]) => entityId)
      .sort();
  }

  async updateCard() {
    if (!this._hass || !this._config) return;

    const jobEntityIds = this._jobEntityIds();
    const showAll = Boolean(this._config.show_all);
    const showImages = this._config.show_images !== false;
    const jobs = [];

    for (const entityId of jobEntityIds) {
      const state = this._hass.states[entityId];
      if (!state) continue;

      const isDue = this._isDueState(state);
      if (!showAll && !isDue) continue;

      const attributes = state.attributes || {};
      const image = showImages ? this._displayImage(attributes.image || "") : "";
      const priority = attributes.priority || 0;

      jobs.push({
        entityId,
        image,
        icon: attributes.job_icon || attributes.icon || state.attributes.icon || "mdi:clipboard-text-clock",
        colour: attributes.job_colour || attributes.colour || "",
        isDue,
        priority,
        name: attributes.friendly_name || entityId,
        lastTriggered: attributes.last_triggered || "",
      });
    }

    jobs.sort((a, b) => Number(b.isDue) - Number(a.isDue) || b.priority - a.priority || a.name.localeCompare(b.name));
    this.innerHTML = this.renderJobs(jobs, showImages);
  }

  _renderHeader() {
    const title = this._title();
    return title === "" ? "" : ` header="${title}"`;
  }

  _renderJobTile(job, showImages) {
    const orientation = this._orientation();
    const tileDirection = showImages ? (orientation === "horizontal" ? "row" : "column") : "row";
    const tileWidth = orientation === "horizontal" ? "min-width:260px;" : "width:100%;";
    const isHorizontal = orientation === "horizontal";
    const imgSize = isHorizontal ? "96px" : "100%";
    const imgMaxWidth = isHorizontal ? "96px" : "320px";
    const iconBg = job.colour || "var(--primary-color)";
    const iconStyle = `color:${iconBg};--mdi-icon-size:28px;`;
    const fallbackIcon = job.icon || "mdi:clipboard-text-clock";

    if (showImages && job.image) {
      return `
        <button style="cursor:pointer;border:0;padding:0;background:transparent;box-shadow:none;font:inherit;display:flex;${tileWidth}" class="job-image-container" data-entity-id="${job.entityId}" data-job-name="${job.name}" title="${job.name}">
          <img src="${job.image}" alt="${job.name}" style="width:${imgSize};max-width:${imgMaxWidth};height:${isHorizontal ? "96px" : "auto"};aspect-ratio:${isHorizontal ? "1 / 1" : "auto"};object-fit:cover;display:block;border-radius:10px;" onerror="this.style.display='none'" />
        </button>
      `;
    }

    if (showImages) {
      const iconBoxStyle = `aspect-ratio:1 / 1;width:${isHorizontal ? "96px" : "100%"};max-width:${isHorizontal ? "96px" : "320px"};min-width:${isHorizontal ? "96px" : "0"};border-radius:12px;background:${iconBg};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px;box-sizing:border-box;`;
      return `
        <button style="cursor:pointer;border:0;padding:0;background:transparent;box-shadow:none;font:inherit;display:flex;${tileWidth}" class="job-image-container" data-entity-id="${job.entityId}" data-job-name="${job.name}" title="${job.name}">
          <div style="${iconBoxStyle}">
            <ha-icon icon="${fallbackIcon}" style="color:#fff;--mdi-icon-size:36px;"></ha-icon>
            <div style="font-weight:700;color:#fff;text-align:center;line-height:1.2;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${job.name}</div>
          </div>
        </button>
      `;
    }

    const baseStyle = job.isDue ? "" : "opacity:0.55;";
    return `
      <button style="cursor:pointer;border:0;border-radius:14px;padding:12px;background:var(--card-background-color, #fff);box-shadow:inset 0 0 0 1px rgba(128,128,128,0.22);font:inherit;text-align:left;display:flex;gap:12px;align-items:center;justify-content:flex-start;flex-direction:${tileDirection};${tileWidth}${baseStyle}" class="job-image-container" data-entity-id="${job.entityId}" data-job-name="${job.name}" title="${job.name}">
        <ha-icon icon="${fallbackIcon}" style="${iconStyle}"></ha-icon>
        <div style="min-width:0;display:grid;gap:4px;">
          <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${job.name}</div>
          <div style="font-size:12px;opacity:0.72;">${this._formatTriggered(job.lastTriggered)}</div>
        </div>
      </button>
    `;
  }

  _renderConfirmBanner() {
    const name = this._pendingConfirmJobName || this._pendingConfirmEntityId;
    return `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 12px;border-radius:12px;background:rgba(var(--rgb-amber-color,255,165,0),0.15);margin-bottom:12px;">
        <span style="flex:1;font-weight:600;font-size:13px;">Mark "${name}" as complete?</span>
        <button data-action="confirm-job" style="appearance:none;border:0;border-radius:999px;background:var(--primary-color);color:var(--text-primary-color,#fff);padding:8px 14px;font:inherit;font-weight:700;cursor:pointer;">Confirm</button>
        <button data-action="cancel-job" style="appearance:none;border:0;border-radius:999px;background:var(--secondary-background-color);color:var(--primary-text-color);padding:8px 14px;font:inherit;font-weight:700;cursor:pointer;">Cancel</button>
      </div>
    `;
  }

  renderJobs(jobs, showImages) {
    if (jobs.length === 0 && !this._pendingConfirmEntityId) {
      return `
        <div style="display:flex;align-items:center;justify-content:center;min-height:160px;color:#666;padding:16px;">
          No due jobs
        </div>
      `;
    }

    const jobsHtml = jobs.map((job) => this._renderJobTile(job, showImages)).join("");

    const orientation = this._orientation();
    const listStyle =
      orientation === "horizontal"
        ? "display:flex;flex-wrap:wrap;gap:12px;padding:4px 0;align-items:flex-start;"
        : "display:flex;flex-direction:column;gap:12px;padding:4px 0;";

    return `
      ${this._pendingConfirmEntityId ? this._renderConfirmBanner() : ""}
      <div style="${listStyle}">
        ${jobsHtml}
      </div>
    `;
  }

  connectedCallback() {
    this._clickHandler = (e) => this.handleImageClick(e);
    this.addEventListener("click", this._clickHandler);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this._clickHandler);
  }

  handleImageClick(e) {
    // Handle confirm/cancel buttons for inline validation prompt.
    const actionBtn = e.target.closest("button[data-action]");
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === "confirm-job") {
        const entityId = this._pendingConfirmEntityId;
        this._pendingConfirmEntityId = null;
        this._pendingConfirmJobName = "";
        if (entityId) {
          this._hass.callService("raven_house_tools", "complete_job", { entity_id: entityId });
        }
        this._lastRenderKey = "";
        this.updateCard();
        return;
      }
      if (action === "cancel-job") {
        this._pendingConfirmEntityId = null;
        this._pendingConfirmJobName = "";
        this._lastRenderKey = "";
        this.updateCard();
        return;
      }
    }

    const container = e.target.closest(".job-image-container");
    if (!container) return;

    const entityId = container.getAttribute("data-entity-id");
    if (!entityId) return;

    const validationRequired = this._config.validation_required === true;
    if (validationRequired) {
      this._pendingConfirmEntityId = entityId;
      this._pendingConfirmJobName = container.getAttribute("data-job-name") || entityId;
      this._lastRenderKey = "";
      this.updateCard();
      return;
    }

    this._hass.callService("raven_house_tools", "complete_job", {
      entity_id: entityId,
    });

    container.style.opacity = "0.5";
    setTimeout(() => {
      container.style.opacity = "1";
    }, 200);
  }
}

if (!customElements.get("rh-jobs-card")) {
  customElements.define("rh-jobs-card", RHJobsCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((card) => card.type === "rh-jobs-card")) {
  window.customCards.push({
    type: "rh-jobs-card",
    name: "RH Jobs Card",
    description: "Shows due Raven House Jobs with images",
  });
}
