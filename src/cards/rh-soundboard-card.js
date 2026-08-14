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
