class RHNotesCard extends HTMLElement {
  constructor() {
    super();
    this._lastRenderKey = "";
    this._fitRaf = 0;
    this._resizeObserver = null;
  }

  setConfig(config) {
    const safeConfig = config && typeof config === "object" ? config : {};
    const entityId = typeof safeConfig.entity_id === "string"
      ? safeConfig.entity_id.trim()
      : typeof safeConfig.entity === "string"
        ? safeConfig.entity.trim()
        : "";

    if (!entityId) {
      throw new Error("RH Notes card requires entity_id");
    }

    this._config = {
      ...safeConfig,
      entity_id: entityId,
      edit_on_click: safeConfig.edit_on_click !== false,
      fg_color: typeof safeConfig.fg_color === "string"
        ? safeConfig.fg_color
        : typeof safeConfig.foreground_color === "string"
          ? safeConfig.foreground_color
          : "",
    };
  }

  set hass(hass) {
    this._hass = hass;
    const key = this._buildRenderKey();
    if (key === this._lastRenderKey) {
      this._scheduleFit();
      return;
    }
    this._lastRenderKey = key;
    this._render();
  }

  connectedCallback() {
    if (!this._resizeObserver && typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver(() => this._scheduleFit());
    }
    if (this._resizeObserver) {
      this._resizeObserver.observe(this);
    }
    this._scheduleFit();
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    if (this._fitRaf) {
      cancelAnimationFrame(this._fitRaf);
      this._fitRaf = 0;
    }
  }

  _entityId() {
    return this._config?.entity_id || this._config?.entity || "";
  }

  _entityState() {
    return this._hass?.states?.[this._entityId()] || null;
  }

  _title() {
    if (this._config?.title === undefined) {
      return "RH Notes";
    }
    return this._config.title;
  }

  _renderHeader() {
    const title = this._title();
    return title === "" ? "" : ` header="${title}"`;
  }

  _fgColor() {
    return this._config?.fg_color || "var(--primary-text-color)";
  }

  _isEditOnClickEnabled() {
    return this._config?.edit_on_click !== false;
  }

  _textValue() {
    const value = this._entityState()?.state;
    if (value === undefined || value === null || value === "") {
      return "—";
    }
    return String(value);
  }

  _buildRenderKey() {
    const state = this._entityState();
    const attrs = state?.attributes || {};
    return [
      this._entityId(),
      state?.state ?? "missing",
      attrs.friendly_name || "",
      this._title(),
      this._fgColor(),
    ].join("~");
  }

  _scheduleFit() {
    if (!this.isConnected) {
      return;
    }

    if (this._fitRaf) {
      cancelAnimationFrame(this._fitRaf);
    }

    this._fitRaf = requestAnimationFrame(() => {
      this._fitRaf = 0;
      this._fitText();
    });
  }

  _fitText() {
    const stage = this.querySelector('[data-role="note-stage"]');
    const text = this.querySelector('[data-role="note-text"]');
    if (!stage || !text) {
      return;
    }

    const maxWidth = Math.max(0, stage.clientWidth - 8);
    const maxHeight = Math.max(0, stage.clientHeight - 8);
    if (!maxWidth || !maxHeight) {
      return;
    }

    const squareSize = Math.max(0, Math.min(maxWidth, maxHeight));
    text.style.width = `${squareSize}px`;
    text.style.height = `${squareSize}px`;

    const minFont = 14;
    const maxFont = Math.max(minFont, Math.min(220, Math.floor(Math.min(maxWidth, maxHeight) * 1.75)));
    let low = minFont;
    let high = maxFont;
    let best = minFont;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      text.style.fontSize = `${mid}px`;

      if (text.scrollWidth <= maxWidth && text.scrollHeight <= maxHeight) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    text.style.fontSize = `${best}px`;
    text.style.opacity = "1";
  }

  _openEntityEditor() {
    const entityId = this._entityId();
    if (!entityId) {
      return;
    }
    const event = new Event("hass-more-info", { bubbles: true, composed: true });
    event.detail = { entityId };
    this.dispatchEvent(event);
  }

  _handleStageKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    this._openEntityEditor();
  }

  _render() {
    if (!this._hass || !this._config) {
      return;
    }

    const fgColor = this._fgColor();
    const noteText = this._textValue();
    const editOnClick = this._isEditOnClickEnabled();
    const stageCursor = editOnClick ? "cursor:pointer;" : "";

    this.innerHTML = `
      <ha-card${this._renderHeader()} style="background:transparent;box-shadow:none;border:none;color:${fgColor};--paper-card-header-color:${fgColor};--paper-card-header-text-color:${fgColor};">
        <div style="padding:16px;min-height:220px;box-sizing:border-box;display:flex;align-items:stretch;justify-content:stretch;">
          <div data-role="note-stage" style="position:relative;flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;${stageCursor}">
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;transform:rotate(-5deg) skew(-2deg, 0deg);transform-origin:center;">
              <div data-role="note-text" style="max-width:100%;max-height:100%;width:100%;display:flex;align-items:center;justify-content:center;text-align:center;white-space:normal;overflow-wrap:anywhere;word-break:break-word;line-height:0.95;font-family:'Segoe Print','Bradley Hand','Comic Sans MS','Chalkboard SE',cursive;font-weight:700;letter-spacing:0.01em;color:${fgColor};opacity:0;">
                ${noteText}
              </div>
            </div>
          </div>
        </div>
      </ha-card>
    `;

    const stage = this.querySelector('[data-role="note-stage"]');
    if (stage && editOnClick) {
      stage.setAttribute("tabindex", "0");
      stage.setAttribute("role", "button");
      stage.setAttribute("aria-label", "Edit note");
      stage.addEventListener("click", () => this._openEntityEditor());
      stage.addEventListener("keydown", (event) => this._handleStageKeydown(event));
    }

    this._scheduleFit();
  }

  getCardSize() {
    return 4;
  }
}

if (!customElements.get("rh-notes-card")) {
  customElements.define("rh-notes-card", RHNotesCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((card) => card.type === "rh-notes-card")) {
  window.customCards.push({
    type: "rh-notes-card",
    name: "RH Notes Card",
    description: "Display a note-style entity state with live updates",
  });
}