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

  _textScale() {
    const configured = Number(this._config.text_size);
    if (!Number.isFinite(configured) || configured <= 0) {
      return 1;
    }
    return Math.max(0.6, Math.min(3, configured));
  }

  _scaledPx(basePx, minimumPx = 10) {
    const scaled = Math.round(basePx * this._textScale());
    return `${Math.max(minimumPx, scaled)}px`;
  }

  connectedCallback() {
    this.addEventListener("click", (e) => this._handleClick(e));
  }

  _buildRenderKey() {
    if (!this._hass) return "";
    const players = this._players();
    const roundState = this._hass.states["sensor.rh_quiz_rounds"] || null;
    const roundKey = roundState
      ? `${roundState.attributes?.active_round_index ?? ""}:${roundState.attributes?.round_position_index ?? ""}`
      : "";
    return [
      this._confirmNewQuiz ? "confirm" : "normal",
      roundKey,
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

  _hasActiveRound() {
    const value = this._hass.states["sensor.rh_quiz_rounds"]?.attributes?.active_round_index;
    return Number.isInteger(value);
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
      return this._normalizeResolvedUrl(trimmed);
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
      if (this._hass && typeof this._hass.hassUrl === "function" && /^\//.test(url)) {
        return this._hass.hassUrl(url);
      }
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
      `font-size:${this._scaledPx(compact ? 12 : 14, 10)}`,
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
             <div style="font-weight:700;font-size:${this._scaledPx(14, 11)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${player.alias || "No alias"}</div>
             <div style="font-size:${this._scaledPx(13, 10)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.75;">${player.name}</div>
             <div style="opacity:0.65;font-size:${this._scaledPx(10, 9)};white-space:nowrap;">· Total: <strong>${player.total}</strong></div>
           </div>
         </div>`
      : `<div style="min-width:0;">
           <div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;">
             <div style="font-weight:700;font-size:${this._scaledPx(15, 11)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${player.alias || "No alias"}</div>
             <div style="font-size:${this._scaledPx(14, 10)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${player.name}</div>
           </div>
           <div style="font-size:${this._scaledPx(12, 10)};opacity:0.75;">Total Points: <strong>${player.total}</strong></div>
         </div>`;

    const photoSize = compact ? 18 : 24;

    return `
      <div style="padding:${compact ? "7px" : "9px"} 0;display:grid;gap:${compact ? "5px" : "8px"};${player.enabled ? "" : "opacity:0.45;"}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
            ${this._renderPhoto(player.photo, player.name, photoSize)}
            ${nameBlock}
          </div>
          <div style="font-size:${this._scaledPx(compact ? 18 : 24, 12)};font-weight:800;line-height:1;">${player.round >= 0 ? "+" : ""}${player.round}</div>
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
        <span style="flex:1;font-weight:600;font-size:${this._scaledPx(13, 10)};">Reset all scores and start a new quiz?</span>
        <button data-action="new-quiz-confirm" style="${this._buttonStyle(true)}">Confirm</button>
        <button data-action="new-quiz-cancel" style="${this._buttonStyle()}">Cancel</button>
      </div>
    `;
  }

  _render() {
    if (!this._hass) return;
    const compact = Boolean(this._config.compact);
    const players = this._players();
    const hasActiveRound = this._hasActiveRound();
    const roundAction = hasActiveRound ? "end-round" : "start-round";
    const roundActionLabel = hasActiveRound ? "End Round" : "Start Round";

    this.innerHTML = `
      <ha-card${this._renderHeader()}>
        <div style="padding:12px;">
          ${this._confirmNewQuiz ? this._renderNewQuizConfirm() : `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            <button data-action="${roundAction}" style="${this._buttonStyle()}">${roundActionLabel}</button>
            <button data-action="new-quiz" style="${this._buttonStyle(true)}">Start New Quiz</button>
          </div>`}
          <div style="font-size:${this._scaledPx(compact ? 12 : 14, 10)};">
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

    if (action === "end-round") {
      this._call("end_round");
      return;
    }

    if (action === "start-round") {
      this._call("start_round");
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



