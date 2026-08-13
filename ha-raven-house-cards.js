// HACS dashboard bundle entrypoint file.
// Keep this file self-contained so a standard HACS install ships all cards.

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




class RHQuizCard extends HTMLElement {
  constructor() {
    super();
    this._resolvedMediaUrls = new Map();
    this._pendingResolutions = new Set();
    this._mediaCacheTtlMs = 60 * 60 * 1000;
    this._lastRenderKey = "";
  }

  setConfig(config) {
    this._config = config || {};
  }

  _buildRenderKey() {
    if (!this._hass) return "";
    const players = this._players();
    const roundState = this._hass.states["sensor.rh_quiz_rounds"] || null;
    const roundKey = roundState
      ? `${roundState.state}:${roundState.attributes?.active_round_index ?? ""}:${roundState.attributes?.active_round_name ?? ""}`
      : "";
    return [
      roundKey,
      players.map((p) => `${p.entityId}:${p.total}:${p.round}:${p.enabled ? 1 : 0}:${p.photo}`).join("|"),
    ].join("~");
  }

  set hass(hass) {
    this._hass = hass;
    const key = this._buildRenderKey();
    if (key === this._lastRenderKey) return;
    this._lastRenderKey = key;
    this._render();
  }

  _title() {
    if (this._config.title === undefined) {
      return "RH Quiz Card";
    }
    return this._config.title;
  }

  _renderHeader() {
    const title = this._title();
    return title === "" ? "" : ` header="${title}"`;
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
      .callWS({ type: "media_source/resolve_media", media_content_id: mediaContentId })
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
        this._render();
      });
  }

  _activeRoundState() {
    return this._hass.states["sensor.rh_quiz_rounds"] || null;
  }

  _roundLeaderboardTitle() {
    const activeRoundName = this._activeRoundState()?.attributes?.active_round_name;
    return typeof activeRoundName === "string" && activeRoundName.trim() ? activeRoundName.trim() : "This Round";
  }

  _players() {
    const showDisabled = this._config.show_disabled ?? false;
    const maxPlayers = this._config.max_players ?? 10;
    const players = [];

    for (const [entityId, state] of Object.entries(this._hass.states)) {
      if (!entityId.startsWith("sensor.rh_quiz_")) {
        continue;
      }

      const attrs = state.attributes || {};
      if (attrs.player_metric !== "total_score") {
        continue;
      }

      const enabled = Boolean(attrs.enabled);
      if (!showDisabled && !enabled) {
        continue;
      }

      const round = Number(attrs.current_round_score || 0);
      const total = Number(state.state) || 0;

      players.push({
        entityId,
        alias: attrs.player_alias || attrs.player_name || entityId,
        photo: attrs.player_photo || "",
        enabled,
        round,
        total,
        overall: total - round,
      });
    }

    return players.slice(0, maxPlayers);
  }

  _rankLabels(players, scoreField) {
    const labels = [];
    let previousRank = 0;

    players.forEach((player, index) => {
      if (index === 0) {
        previousRank = 1;
        labels.push("1st");
        return;
      }

      const previousPlayer = players[index - 1];
      if (player[scoreField] === previousPlayer[scoreField]) {
        labels.push("");
        return;
      }

      previousRank = index + 1;
      if (previousRank === 2) labels.push("2nd");
      else if (previousRank === 3) labels.push("3rd");
      else labels.push(`#${previousRank}`);
    });

    return labels;
  }

  _photo(photo, label, size = 36, radius = "50%") {
    const resolvedPhoto = this._displayImage(photo);
    if (!resolvedPhoto) {
      return `<div style="width:${size}px;height:${size}px;border-radius:${radius};background:#999;color:white;display:flex;align-items:center;justify-content:center;font-size:${Math.max(12, Math.floor(size * 0.33))}px;flex-shrink:0;">${(label || "?").slice(0, 1).toUpperCase()}</div>`;
    }
    return `<img src="${resolvedPhoto}" alt="${label}" style="width:${size}px;height:${size}px;border-radius:${radius};object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'" />`;
  }

  _winnerSection(players, scoreField, photoSize) {
    if (!players.length) {
      return `
        <section>
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.65;margin-bottom:8px;">Winner</div>
          <div style="opacity:0.7;">No winner yet</div>
        </section>
      `;
    }

    const winner = players[0];
    const winnerImage = this._displayImage(winner.photo);
    const score = winner[scoreField];
    const winnerScore = `${score >= 0 ? "+" : ""}${score}`;
    const heroSize = photoSize > 36 ? photoSize : 80;

    return `
      <section>
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.65;margin-bottom:8px;">Current Leader</div>
        <div style="position:relative;min-height:200px;border-radius:14px;overflow:hidden;background:${winnerImage ? "center / cover no-repeat url('" + encodeURI(winnerImage).replace(/'/g, "%27") + "')" : "var(--primary-color)"};">
          <div style="position:absolute;inset:0;background:linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.2));"></div>
          <div style="position:absolute;left:16px;right:16px;bottom:16px;color:#fff;display:flex;align-items:flex-end;gap:14px;">
            ${!winnerImage ? this._photo(winner.photo, winner.alias, heroSize, "14px") : ""}
            <div>
              <div style="font-size:22px;font-weight:800;line-height:1.2;">${winner.alias}</div>
              <div style="font-size:16px;opacity:0.92;font-weight:600;">${winnerScore} pts</div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  _roundInfoSection() {
    const roundState = this._hass.states["sensor.rh_quiz_rounds"] || null;
    if (!roundState) return "";

    const attrs = roundState.attributes || {};
    const rounds = Array.isArray(attrs.quiz_rounds) ? attrs.quiz_rounds : [];
    const activeIndex = typeof attrs.active_round_index === "number" ? attrs.active_round_index : null;
    const activeName = typeof attrs.active_round_name === "string" && attrs.active_round_name.trim()
      ? attrs.active_round_name.trim() : null;
    const totalRounds = typeof attrs.total_rounds === "number" ? attrs.total_rounds : rounds.length;

    const nextIndex = activeIndex !== null ? activeIndex + 1 : null;
    const nextName = nextIndex !== null && nextIndex < rounds.length ? rounds[nextIndex] : null;

    const roundCounter = activeIndex !== null && totalRounds > 0
      ? `Round ${activeIndex + 1} of ${totalRounds}`
      : totalRounds > 0 ? `${totalRounds} rounds` : "";

    return `
      <section style="background:var(--primary-color);border-radius:14px;padding:16px 20px;color:var(--text-primary-color,#fff);">
        ${roundCounter ? `<div style="font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;opacity:0.85;margin-bottom:4px;">${roundCounter}</div>` : ""}
        <div style="font-size:20px;font-weight:800;line-height:1.25;">${activeName || "No active round"}</div>
        ${nextName ? `<div style="font-size:13px;opacity:0.8;margin-top:4px;">Up next: ${nextName}</div>` : ""}
      </section>
    `;
  }

  _leaderboardRows(players, scoreField, withPhoto = true, photoSize = 36) {
    if (!players.length) {
      return '<div style="padding:8px 0;opacity:0.7;">No players to display</div>';
    }

    const labels = this._rankLabels(players, scoreField);
    return players
      .map(
        (player, index) => `
          <div style="display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(128,128,128,0.2);${player.enabled ? "" : "opacity:0.45;"}">
            <div style="min-width:34px;font-weight:700;">${labels[index]}</div>
            ${withPhoto ? this._photo(player.photo, player.alias, photoSize) : ""}
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${player.alias}</div>
            </div>
            <div style="text-align:right;font-weight:700;">${player[scoreField] >= 0 ? "+" : ""}${player[scoreField]}</div>
          </div>
        `
      )
      .join("");
  }

  _render() {
    if (!this._hass) return;

    const photoSize = typeof this._config.photo_size === "number" && this._config.photo_size > 0
      ? this._config.photo_size : 36;
    // winner_score / leaderboard_score: "total" uses grand total; "overall" uses total minus current round
    const winnerScoreField = this._config.winner_score === "total" ? "total" : "overall";
    const leaderboardScoreField = this._config.leaderboard_score === "total" ? "total"
      : this._config.leaderboard_score === "round" ? "round" : "overall";

    const players = this._players();
    const roundPlayers = [...players].sort((a, b) => b.round - a.round || a.alias.localeCompare(b.alias));
    const winnerPlayers = [...players].sort((a, b) => b[winnerScoreField] - a[winnerScoreField] || a.alias.localeCompare(b.alias));
    const leaderboardPlayers = [...players].sort((a, b) => b[leaderboardScoreField] - a[leaderboardScoreField] || a.alias.localeCompare(b.alias));

    const showWinner = this._config.show_winner !== false;
    const showLeaderboard = this._config.show_leaderboard !== false;
    const showRoundLeaderboard = this._config.show_round_leaderboard !== false;
    const showRoundInfo = Boolean(this._config.show_round_info);
    const roundLeaderboardTitle = this._roundLeaderboardTitle();

    this.innerHTML = `
      <ha-card${this._renderHeader()}>
        <div style="padding:16px;display:grid;gap:18px;">
          ${showRoundInfo ? this._roundInfoSection() : ""}
          ${showWinner ? this._winnerSection(winnerPlayers, winnerScoreField, photoSize) : ""}
          ${showLeaderboard ? `
          <section>
            <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.65;margin-bottom:6px;">Leaderboard</div>
            <div>${this._leaderboardRows(leaderboardPlayers, leaderboardScoreField, true, photoSize)}</div>
          </section>` : ""}
          ${showRoundLeaderboard ? `
          <section>
            <div style="display:grid;gap:4px;margin-bottom:6px;">
              <div style="font-size:15px;font-weight:700;line-height:1.25;">${roundLeaderboardTitle}</div>
              <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.65;">Round Leaderboard</div>
            </div>
            <div>${this._leaderboardRows(roundPlayers, "round", true, photoSize)}</div>
          </section>` : ""}
        </div>
      </ha-card>
    `;
  }

  getCardSize() {
    return 6;
  }
}

if (!customElements.get("rh-quiz-card")) {
  customElements.define("rh-quiz-card", RHQuizCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((card) => card.type === "rh-quiz-card")) {
  window.customCards.push({
    type: "rh-quiz-card",
    name: "RH Quiz Card",
    description: "Shows winner, leaderboard and round leaderboard",
  });
}




class RHQuizMasterCard extends HTMLElement {
  constructor() {
    super();
    this._resolvedMediaUrls = new Map();
    this._pendingResolutions = new Set();
    this._mediaCacheTtlMs = 60 * 60 * 1000;
    this._lastRenderKey = "";
    this._confirmNewQuiz = false;
  }

  setConfig(config) {
    this._config = config || {};
    this._pointButtons = Array.isArray(this._config.point_buttons) && this._config.point_buttons.length
      ? this._config.point_buttons
      : [5, 1, -1, -5];
  }

  _title() {
    if (this._config.title === undefined) {
      return "RH Quiz Master Control";
    }
    return this._config.title;
  }

  _renderHeader() {
    const title = this._title();
    return title === "" ? "" : ` header="${title}"`;
  }

  connectedCallback() {
    this.addEventListener("click", (e) => this._handleClick(e));
  }

  _buildRenderKey() {
    if (!this._hass) return "";
    const players = this._players();
    return [
      this._confirmNewQuiz ? "confirm" : "normal",
      players.map((p) => `${p.entityId}:${p.total}:${p.round}:${p.enabled ? 1 : 0}`).join("|"),
    ].join("~");
  }

  set hass(hass) {
    this._hass = hass;
    const key = this._buildRenderKey();
    if (key === this._lastRenderKey) return;
    this._lastRenderKey = key;
    this._render();
  }

  _players() {
    const players = [];
    for (const [entityId, state] of Object.entries(this._hass.states)) {
      if (!entityId.startsWith("sensor.rh_quiz_")) {
        continue;
      }

      const attrs = state.attributes || {};
      if (attrs.player_metric !== "total_score") {
        continue;
      }

      players.push({
        entityId,
        name: attrs.player_name || entityId,
        alias: attrs.player_alias || "",
        photo: attrs.player_photo || "",
        enabled: Boolean(attrs.enabled),
        round: Number(attrs.current_round_score || 0),
        total: Number(state.state || 0),
      });
    }

    players.sort((a, b) => a.name.localeCompare(b.name));
    return players;
  }

  _call(service, data = {}) {
    return this._hass.callService("raven_house_tools", service, data);
  }

  _renderPhoto(photo, name, size = 24) {
    if (!this._config.show_photos) return "";
    const resolvedPhoto = this._displayImage(photo);
    const fontSize = Math.max(9, Math.floor(size * 0.45));
    if (!resolvedPhoto) {
      return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#999;color:white;display:inline-flex;align-items:center;justify-content:center;font-size:${fontSize}px;flex-shrink:0;">${name.slice(0, 1).toUpperCase()}</div>`;
    }
    return `<img src="${resolvedPhoto}" alt="${name}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'" />`;
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
      .callWS({ type: "media_source/resolve_media", media_content_id: mediaContentId })
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
        this._render();
      });
  }

  _buttonStyle(primary = false, compact = false) {
    return [
      "appearance:none",
      "border:0",
      "border-radius:999px",
      `background:${primary ? "var(--primary-color)" : "var(--secondary-background-color)"}`,
      `color:${primary ? "var(--text-primary-color, #fff)" : "var(--primary-text-color)"}`,
      `padding:${compact ? "5px 8px" : "10px 12px"}`,
      "font:inherit",
      "font-weight:700",
      "cursor:pointer",
      `min-height:${compact ? "30px" : "40px"}`,
      "flex:1 1 0",
      "box-sizing:border-box",
      "text-align:center",
    ].join(";");
  }

  _row(player, compact) {
    const actionButtons = this._pointButtons
      .map((points) => {
        const action = points > 0 ? "add" : "remove";
        const label = points > 0 ? `+${points}` : `${points}`;
        return `<button data-action="${action}" data-entity="${player.entityId}" data-points="${Math.abs(points)}" style="${this._buttonStyle(false, compact)}">${label}</button>`;
      })
      .join("");

    // In compact mode, show total score inline with the player name to save vertical space.
    const nameBlock = compact
      ? `<div style="min-width:0;">
           <div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;">
             <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${player.alias || "No alias"}</div>
             <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.75;">${player.name}</div>
             <div style="opacity:0.65;font-size:10px;white-space:nowrap;">· Total: <strong>${player.total}</strong></div>
           </div>
         </div>`
      : `<div style="min-width:0;">
           <div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;">
             <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${player.alias || "No alias"}</div>
             <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${player.name}</div>
           </div>
           <div style="font-size:12px;opacity:0.75;">Total Points: <strong>${player.total}</strong></div>
         </div>`;

    const photoSize = compact ? 18 : 24;

    return `
      <div style="padding:${compact ? "7px" : "9px"} 0;display:grid;gap:${compact ? "5px" : "8px"};${player.enabled ? "" : "opacity:0.45;"}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
            ${this._renderPhoto(player.photo, player.name, photoSize)}
            ${nameBlock}
          </div>
          <div style="font-size:${compact ? "18px" : "24px"};font-weight:800;line-height:1;">${player.round >= 0 ? "+" : ""}${player.round}</div>
        </div>
        <div style="display:flex;gap:${compact ? "4px" : "6px"};flex-wrap:wrap;">
          ${actionButtons}
          <button data-action="joker" data-entity="${player.entityId}" style="${this._buttonStyle(true, compact)}">Joker</button>
        </div>
      </div>
    `;
  }

  _renderNewQuizConfirm() {
    return `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 12px;border-radius:12px;background:rgba(var(--rgb-red-color,255,0,0),0.12);margin-bottom:10px;">
        <span style="flex:1;font-weight:600;font-size:13px;">Reset all scores and start a new quiz?</span>
        <button data-action="new-quiz-confirm" style="${this._buttonStyle(true)}">Confirm</button>
        <button data-action="new-quiz-cancel" style="${this._buttonStyle()}">Cancel</button>
      </div>
    `;
  }

  _render() {
    if (!this._hass) return;
    const compact = Boolean(this._config.compact);
    const players = this._players();

    this.innerHTML = `
      <ha-card${this._renderHeader()}>
        <div style="padding:12px;">
          ${this._confirmNewQuiz ? this._renderNewQuizConfirm() : `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            <button data-action="new-round" style="${this._buttonStyle()}">New Round</button>
            <button data-action="new-quiz" style="${this._buttonStyle(true)}">Start New Quiz</button>
          </div>`}
          <div style="font-size:${compact ? "12px" : "14px"};">
            ${players.map((player, index) => `${this._row(player, compact)}${index < players.length - 1 ? '<hr style="border:none;border-top:1px solid rgba(128,128,128,0.25);margin:0;">' : ""}`).join("") || '<div>No players</div>'}
          </div>
        </div>
      </ha-card>
    `;
  }

  _handleClick(e) {
    const button = e.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const entityId = button.dataset.entity;

    if (action === "new-round") {
      this._call("start_new_round");
      return;
    }

    if (action === "new-quiz") {
      this._confirmNewQuiz = true;
      this._render();
      return;
    }

    if (action === "new-quiz-confirm") {
      this._confirmNewQuiz = false;
      this._call("start_new_quiz");
      return;
    }

    if (action === "new-quiz-cancel") {
      this._confirmNewQuiz = false;
      this._render();
      return;
    }

    if (action === "add" || action === "remove") {
      const points = Number(button.dataset.points || 0);
      this._call(action === "add" ? "add_points" : "remove_points", {
        entity_id: entityId,
        points,
      });
      return;
    }

    if (action === "joker") {
      this._call("use_joker", { entity_id: entityId });
    }
  }

  getCardSize() {
    return 6;
  }
}

if (!customElements.get("rh-quiz-master-card")) {
  customElements.define("rh-quiz-master-card", RHQuizMasterCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((card) => card.type === "rh-quiz-master-card")) {
  window.customCards.push({
    type: "rh-quiz-master-card",
    name: "RH Quiz Master Card",
    description: "Master control panel for Raven House Quiz",
  });
}




class RHQuizRoundCard extends HTMLElement {
  constructor() {
    super();
    this._lastRenderKey = "";
  }

  setConfig(config) {
    this._config = config || {};
  }

  set hass(hass) {
    this._hass = hass;
    const key = this._buildRenderKey();
    if (key === this._lastRenderKey) return;
    this._lastRenderKey = key;
    this._render();
  }

  _buildRenderKey() {
    const rounds = this._rounds();
    const active = this._activeRoundIndex();
    return `${active ?? "null"}|${rounds.join(",")}`;
  }

  connectedCallback() {
    this._clickHandler = (e) => this._handleClick(e);
    this._keydownHandler = (e) => this._handleKeydown(e);
    this.addEventListener("click", this._clickHandler);
    this.addEventListener("keydown", this._keydownHandler);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this._clickHandler);
    this.removeEventListener("keydown", this._keydownHandler);
  }

  _title() {
    if (this._config.title === undefined) {
      return "RH Quiz Rounds";
    }
    return this._config.title;
  }

  _renderHeader() {
    const title = this._title();
    return title === "" ? "" : ` header="${title}"`;
  }

  _roundState() {
    return this._hass?.states?.["sensor.rh_quiz_rounds"] || null;
  }

  _rounds() {
    const rounds = this._roundState()?.attributes?.quiz_rounds;
    return Array.isArray(rounds) ? rounds.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
  }

  _activeRoundIndex() {
    const value = this._roundState()?.attributes?.active_round_index;
    return Number.isInteger(value) ? value : null;
  }

  _buttonStyle(primary = false) {
    return [
      "appearance:none",
      "border:0",
      `border-radius:${primary ? "999px" : "12px"}`,
      `background:${primary ? "var(--primary-color)" : "var(--secondary-background-color)"}`,
      `color:${primary ? "var(--text-primary-color, #fff)" : "var(--primary-text-color)"}`,
      `padding:${primary ? "10px 16px" : "8px 10px"}`,
      "font:inherit",
      "font-weight:600",
      "cursor:pointer",
      "min-height:40px",
      "flex:1 1 0",
      "box-sizing:border-box",
    ].join(";");
  }

  async _saveRounds(rounds, activeRoundIndex) {
    await this._hass.callService("raven_house_tools", "set_quiz_rounds", {
      rounds,
      active_round_index: activeRoundIndex,
    });
  }


  async _handleAction(action, index) {
    const rounds = this._rounds();
    const activeRoundIndex = this._activeRoundIndex();
    if (!Number.isInteger(index) || index < 0 || index >= rounds.length) {
      return;
    }

    if (action === "delete") {
      const nextRounds = rounds.filter((_, itemIndex) => itemIndex !== index);
      let nextActive = activeRoundIndex;
      if (activeRoundIndex === index) nextActive = null;
      else if (activeRoundIndex !== null && activeRoundIndex > index) nextActive = activeRoundIndex - 1;
      await this._saveRounds(nextRounds, nextActive);
      return;
    }

    if (action === "activate") {
      await this._saveRounds(rounds, activeRoundIndex === index ? null : index);
      return;
    }

    if (action === "move-up" || action === "move-down") {
      const targetIndex = action === "move-up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= rounds.length) return;
      const nextRounds = [...rounds];
      [nextRounds[index], nextRounds[targetIndex]] = [nextRounds[targetIndex], nextRounds[index]];
      let nextActive = activeRoundIndex;
      if (activeRoundIndex === index) nextActive = targetIndex;
      else if (activeRoundIndex === targetIndex) nextActive = index;
      await this._saveRounds(nextRounds, nextActive);
    }
  }

  _render() {
    if (!this._hass) return;
    const rounds = this._rounds();
    const activeRoundIndex = this._activeRoundIndex();

    this.innerHTML = `
      <ha-card${this._renderHeader()}>
        <div style="padding:16px;display:grid;gap:14px;">
          <div style="display:flex;gap:10px;align-items:center;">
            <input data-role="round-input" type="text" placeholder="Add round name" style="flex:1;min-width:0;border:1px solid var(--divider-color);border-radius:12px;padding:10px 12px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit;" />
            <button data-action="add" style="${this._buttonStyle(true)};flex:0 0 auto;min-width:92px;">Add</button>
          </div>
          <div style="display:grid;gap:10px;">
            ${rounds.map((round, index) => `
              <div style="padding:12px;border-radius:14px;background:var(--secondary-background-color);display:grid;gap:10px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                  <div style="min-width:0;display:flex;gap:10px;align-items:center;">
                    <div style="font-weight:700;opacity:0.7;min-width:20px;">${index + 1}.</div>
                    <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${round}</div>
                  </div>
                  ${activeRoundIndex === index ? '<div style="font-size:12px;font-weight:700;color:var(--primary-color);">Active</div>' : ''}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <button data-action="activate" data-index="${index}" style="${this._buttonStyle(activeRoundIndex === index)};">${activeRoundIndex === index ? 'Clear Active' : 'Set Active'}</button>
                  <button data-action="move-up" data-index="${index}" style="${this._buttonStyle()};" ${index === 0 ? 'disabled' : ''}>Up</button>
                  <button data-action="move-down" data-index="${index}" style="${this._buttonStyle()};" ${index === rounds.length - 1 ? 'disabled' : ''}>Down</button>
                  <button data-action="delete" data-index="${index}" style="${this._buttonStyle()};">Delete</button>
                </div>
              </div>
            `).join("") || '<div style="padding:12px 0;opacity:0.7;">No quiz rounds yet</div>'}
          </div>
        </div>
      </ha-card>
    `;
  }

  async _handleAddRound() {
    const input = this.querySelector('[data-role="round-input"]');
    if (!input) return;
    const name = input.value.trim();
    if (!name) return;
    const rounds = this._rounds();
    await this._saveRounds([...rounds, name], this._activeRoundIndex());
    input.value = "";
  }

  async _handleClick(e) {
    const button = e.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "add") {
      await this._handleAddRound();
      return;
    }
    const index = Number(button.dataset.index);
    await this._handleAction(action, index);
  }

  async _handleKeydown(e) {
    if (e.target.dataset?.role === "round-input" && e.key === "Enter") {
      e.preventDefault();
      await this._handleAddRound();
    }
  }

  getCardSize() {
    return 5;
  }
}

if (!customElements.get("rh-quiz-round-card")) {
  customElements.define("rh-quiz-round-card", RHQuizRoundCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((card) => card.type === "rh-quiz-round-card")) {
  window.customCards.push({
    type: "rh-quiz-round-card",
    name: "RH Quiz Round Card",
    description: "Manage quiz round names and the active round",
  });
}




class RHSoundboardCard extends HTMLElement {
  constructor() {
    super();
    this._connected = false;
    this._busy = false;
    this._selectedTarget = "";
    this._sessionState = null;
    this._lastRenderKey = "";
  }

  setConfig(config) {
    const safeConfig = config && typeof config === "object" ? config : {};
    this._config = {
      ...safeConfig,
      clips: Array.isArray(safeConfig.clips)
        ? safeConfig.clips.map((clip) => ({ ...clip }))
        : [],
    };
    this._columns = Number(this._config.columns || 4);
  }

  set hass(hass) {
    this._hass = hass;
    this._syncSessionState();
    if (!this._selectedTarget) {
      this._selectedTarget = this._config.target || "";
    }
    this._requestRender();
  }

  _syncSessionState() {
    const state = this._hass?.states?.["sensor.rh_soundboard_session"];
    if (!state) {
      this._sessionState = null;
      this._connected = false;
      return;
    }

    const attrs = state.attributes || {};
    this._sessionState = attrs;

    const activeTarget = attrs.active_target || "";
    if (!this._selectedTarget && activeTarget) {
      this._selectedTarget = activeTarget;
    }

    const selected = this._selectedTarget || activeTarget;
    this._connected = Boolean(attrs.connected) && Boolean(selected) && activeTarget === selected;
  }

  _title() {
    if (this._config.title === undefined) {
      return "RH Soundboard";
    }
    return this._config.title;
  }

  _renderHeader() {
    const title = this._title();
    return title === "" ? "" : ` header="${title}"`;
  }

  _mediaPlayers() {
    const players = [];
    for (const [entityId, state] of Object.entries(this._hass.states || {})) {
      if (!entityId.startsWith("media_player.")) {
        continue;
      }
      players.push({
        entityId,
        name: state.attributes?.friendly_name || entityId,
        available: state.state !== "unavailable",
      });
    }
    players.sort((a, b) => a.name.localeCompare(b.name));
    return players;
  }

  _clips() {
    return this._config.clips
      .map((clip, index) => {
        const media = typeof clip?.media === "string" ? clip.media.trim() : "";
        if (!media) {
          return null;
        }
        const sourceLabel = media.replace("media-source://", "");
        const mediaTypeRaw = String(clip.type || clip.media_type || "audio").trim().toLowerCase();
        const mediaType = mediaTypeRaw || "audio";
        return {
          id: clip.id || `clip_${index}`,
          label: clip.label || clip.name || `Clip ${index + 1}`,
          icon: clip.icon || "mdi:music-note",
          media,
          mediaType,
          sourceLabel,
          fgColor: typeof clip.fg_color === "string" ? clip.fg_color : (typeof clip.text_color === "string" ? clip.text_color : ""),
          bgColor: typeof clip.bg_color === "string" ? clip.bg_color : (typeof clip.background_color === "string" ? clip.background_color : ""),
        };
      })
      .filter((clip) => clip !== null);
  }

  async _call(service, data = {}) {
    await this._hass.callService("raven_house_tools", service, data);
  }

  _serviceDef(domain, service) {
    return this._hass?.services?.[domain]?.[service] || null;
  }

  _hasService(domain, service) {
    return Boolean(this._serviceDef(domain, service));
  }

  _serviceHasField(domain, service, fieldName) {
    const def = this._serviceDef(domain, service);
    if (!def || !def.fields || typeof def.fields !== "object") {
      return false;
    }
    return Object.prototype.hasOwnProperty.call(def.fields, fieldName);
  }

  _statusText() {
    if (!this._selectedTarget) {
      return "Choose a media player";
    }
    if (this._busy) {
      return "Working...";
    }
    if (this._sessionState) {
      const pending = Number(this._sessionState.pending_requests || 0);
      if (pending > 0) {
        return `Queued: ${pending} request(s)`;
      }
    }
    return this._connected ? `Connected to ${this._selectedTarget}` : `Ready: ${this._selectedTarget}`;
  }

  _clipStatusText(clip) {
    if (this._busy) {
      return "Sending...";
    }
    const lastClip = String(this._sessionState?.last_clip || "");
    if (lastClip && lastClip === clip.media) {
      return "Last triggered";
    }
    return this._connected ? "Live" : "Ready";
  }

  _optionInputsDisabled() {
    return this._connected || this._busy;
  }

  _buildRenderKey() {
    const players = this._mediaPlayers()
      .map((player) => `${player.entityId}:${player.available ? 1 : 0}:${player.name}`)
      .join("|");
    const selectedState = this._selectedTarget ? this._hass?.states?.[this._selectedTarget] : null;
    const volumeLevel = Number(selectedState?.attributes?.volume_level);
    const volumeKey = Number.isFinite(volumeLevel) ? volumeLevel.toFixed(3) : "na";
    const session = this._sessionState || {};
    return [
      this._selectedTarget,
      this._connected ? "1" : "0",
      this._busy ? "1" : "0",
      String(session.active_target || ""),
      String(session.pending_requests || 0),
      String(session.last_clip || ""),
      volumeKey,
      players,
    ].join("~");
  }

  _requestRender(force = false) {
    if (!this._hass) {
      return;
    }
    const nextKey = this._buildRenderKey();
    if (!force && nextKey === this._lastRenderKey) {
      return;
    }
    this._lastRenderKey = nextKey;
    this._render();
  }

  async _toggleConnection() {
    if (this._busy) {
      return;
    }
    const target = this._selectedTarget || this._config.target || "";
    if (!target) {
      return;
    }

    this._busy = true;
    this._requestRender(true);

    try {
      if (this._connected) {
        await this._call("soundboard_disconnect", { entity_id: target });
        this._connected = false;
      } else {
        await this._call("soundboard_connect", {
          entity_id: target,
          dead_air_media: this._config.dead_air_media || "",
        });
        this._connected = true;
      }
    } finally {
      this._busy = false;
      this._requestRender(true);
    }
  }

  async _playClip(clip) {
    if (this._busy) {
      return;
    }
    const target = this._selectedTarget || this._config.target || "";
    if (!target) {
      return;
    }

    const payload = {
      entity_id: target,
      media: clip.media,
      connected: false,
      dead_air_media: this._config.dead_air_media || "",
    };

    if (this._serviceHasField("raven_house_tools", "soundboard_play_clip", "mode")) {
      payload.mode = "direct";
    }

    await this._call("soundboard_play_clip", payload);
  }

  _selectedTargetVolumePercent() {
    const state = this._selectedTarget ? this._hass?.states?.[this._selectedTarget] : null;
    const level = Number(state?.attributes?.volume_level);
    if (!Number.isFinite(level)) {
      return 50;
    }
    return Math.max(0, Math.min(100, Math.round(level * 100)));
  }

  async _setVolume(percent) {
    const target = this._selectedTarget || this._config.target || "";
    if (!target) {
      return;
    }
    const level = Math.max(0, Math.min(1, Number(percent) / 100));
    await this._hass.callService("media_player", "volume_set", {
      entity_id: target,
      volume_level: level,
    });
  }

  _renderTargetSelector(players) {
    const allowTargetSwitch = this._config.allow_target_switch !== false;
    if (!allowTargetSwitch) {
      return "";
    }

    const disabledAttr = this._optionInputsDisabled() ? "disabled" : "";

    const options = players
      .map((player) => {
        const selected = player.entityId === this._selectedTarget ? "selected" : "";
        return `<option value="${player.entityId}" ${selected}>${player.name}</option>`;
      })
      .join("");

    return `
      <div style="display:flex;gap:10px;align-items:center;min-width:0;flex:1;">
        <select id="rh-soundboard-target" ${disabledAttr} style="flex:1;min-width:220px;padding:8px 10px;border-radius:8px;">
          <option value="">Select media player</option>
          ${options}
        </select>
      </div>
    `;
  }

  _renderClip(clip, showText, showIcon) {
    const iconOnly = showIcon && !showText;

    const styleParts = [
      "min-height:96px",
      "border:none",
      "border-radius:12px",
      "cursor:pointer",
      "display:flex",
      "font-weight:600",
      "box-sizing:border-box",
      "width:100%",
    ];

    if (iconOnly) {
      // Icon centred and filling the button
      styleParts.push("padding:12px", "flex-direction:column", "align-items:center", "justify-content:center", "gap:0");
    } else {
      styleParts.push("padding:10px", "flex-direction:column", "align-items:flex-start", "justify-content:flex-start", "gap:6px");
    }

    if (clip.bgColor) styleParts.push(`background:${clip.bgColor}`);
    if (clip.fgColor) styleParts.push(`color:${clip.fgColor}`);

    const style = styleParts.join(";");

    if (iconOnly) {
      // Large centred icon; size is chosen so the icon fills ~60% of the button height (96px → ~48px)
      return `
        <button class="rh-soundboard-clip" data-id="${clip.id}" style="${style}" title="${clip.label}">
          <ha-icon icon="${clip.icon}" style="--mdi-icon-size:48px;width:48px;height:48px;display:block;"></ha-icon>
        </button>
      `;
    }

    return `
      <button class="rh-soundboard-clip" data-id="${clip.id}" style="${style}">
        ${showIcon ? `<div style="display:flex;align-items:center;gap:8px;width:100%;">
          <ha-icon icon="${clip.icon}"></ha-icon>
          ${showText ? `<span style="font-size:13px;line-height:1.2;">${clip.label}</span>` : ""}
        </div>` : (showText ? `<span style="font-size:13px;font-weight:600;line-height:1.2;">${clip.label}</span>` : "")}
        ${showText ? `<div style="font-size:11px;opacity:0.78;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;">${clip.sourceLabel} • ${clip.mediaType}</div>
        <div style="font-size:11px;opacity:0.72;line-height:1.2;">${this._clipStatusText(clip)}</div>` : ""}
      </button>
    `;
  }

  _render() {
    if (!this._hass) {
      return;
    }

    const players = this._mediaPlayers();
    const clips = this._clips();
    const columns = Math.max(1, this._columns);
    const buttonLabel = this._connected ? "Disconnect" : "Connect";
    const volumeDisabled = this._busy || !this._selectedTarget;
    const volumePercent = this._selectedTargetVolumePercent();
    const showText = this._config.show_text !== false;
    const showIcon = this._config.show_icon !== false;

    this.innerHTML = `
      <ha-card${this._renderHeader()}>
        <div style="padding:16px;display:grid;gap:14px;">
          <div style="display:grid;gap:10px;padding:12px;border-radius:12px;border:1px solid rgba(128,128,128,0.24);background:rgba(128,128,128,0.06);">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              ${this._renderTargetSelector(players)}
              <button id="rh-soundboard-connect" style="padding:10px 14px;border:none;border-radius:10px;cursor:pointer;font-weight:600;">
                ${buttonLabel}
              </button>
            </div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <label for="rh-soundboard-volume" style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.7;">Volume</label>
              <input id="rh-soundboard-volume" type="range" min="0" max="100" step="1" value="${volumePercent}" ${volumeDisabled ? "disabled" : ""} style="flex:1;min-width:160px;" />
              <span id="rh-soundboard-volume-value" style="font-size:12px;opacity:0.78;min-width:40px;text-align:right;">${volumePercent}%</span>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(${columns}, minmax(0, 1fr));gap:10px;">
            ${
              clips
                .map((clip) => this._renderClip(clip, showText, showIcon))
                .join("") || '<div style="grid-column:1 / -1;opacity:0.7;">No clips configured</div>'
            }
          </div>
        </div>
      </ha-card>
    `;
  }

  connectedCallback() {
    this._clickHandler = (e) => this._handleClick(e);
    this._changeHandler = (e) => this._handleChange(e);
    this._inputHandler = (e) => this._handleInput(e);
    this.addEventListener("click", this._clickHandler);
    this.addEventListener("change", this._changeHandler);
    this.addEventListener("input", this._inputHandler);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this._clickHandler);
    this.removeEventListener("change", this._changeHandler);
    this.removeEventListener("input", this._inputHandler);
  }

  _handleClick(e) {
    const button = e.target.closest("button");
    if (!button) return;

    if (button.id === "rh-soundboard-connect") {
      this._toggleConnection();
      return;
    }

    if (button.classList.contains("rh-soundboard-clip")) {
      const clips = this._clips();
      const id = button.dataset.id;
      const clip = clips.find((c) => c.id === id);
      if (clip) {
        this._playClip(clip);
      }
    }
  }

  _handleChange(e) {
    if (e.target.id === "rh-soundboard-target") {
      this._selectedTarget = e.target.value || "";
      if (this._selectedTarget) {
        this._call("soundboard_set_target", { entity_id: this._selectedTarget });
      }
      this._requestRender(true);
      return;
    }
    if (e.target.id === "rh-soundboard-volume") {
      this._setVolume(e.target.value);
    }
  }

  _handleInput(e) {
    if (e.target.id === "rh-soundboard-volume") {
      const volumeValue = this.querySelector("#rh-soundboard-volume-value");
      if (volumeValue) {
        volumeValue.textContent = `${e.target.value}%`;
      }
    }
  }

  getCardSize() {
    const clips = this._clips();
    const rows = Math.ceil(clips.length / Math.max(1, this._columns));
    return Math.max(3, rows + 3);
  }
}

if (!customElements.get("rh-soundboard-card")) {
  customElements.define("rh-soundboard-card", RHSoundboardCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((card) => card.type === "rh-soundboard-card")) {
  window.customCards.push({
    type: "rh-soundboard-card",
    name: "RH Soundboard Card",
    description: "Grid soundboard with connect/disconnect session playback",
  });
}
