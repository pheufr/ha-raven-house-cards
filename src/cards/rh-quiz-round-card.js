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
    const position = this._roundPositionIndex();
    return `${active ?? "null"}|${position ?? "null"}|${rounds.join(",")}`;
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

  _roundPositionIndex() {
    const value = this._roundState()?.attributes?.round_position_index;
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
      `font-size:${this._scaledPx(14, 10)}`,
      "font-weight:600",
      "cursor:pointer",
      "min-height:40px",
      "flex:1 1 0",
      "box-sizing:border-box",
    ].join(";");
  }

  async _saveRounds(rounds, activeRoundIndex, roundPositionIndex) {
    await this._hass.callService("raven_house_tools", "set_quiz_rounds", {
      rounds,
      active_round_index: activeRoundIndex,
      round_position_index: roundPositionIndex,
    });
  }


  async _handleAction(action, index) {
    const rounds = this._rounds();
    const activeRoundIndex = this._activeRoundIndex();
    const roundPositionIndex = this._roundPositionIndex();
    if (!Number.isInteger(index) || index < 0 || index >= rounds.length) {
      return;
    }

    if (action === "delete") {
      const nextRounds = rounds.filter((_, itemIndex) => itemIndex !== index);
      let nextActive = activeRoundIndex;
      let nextPosition = roundPositionIndex;
      if (activeRoundIndex === index) nextActive = null;
      else if (activeRoundIndex !== null && activeRoundIndex > index) nextActive = activeRoundIndex - 1;
      if (roundPositionIndex === index) nextPosition = null;
      else if (roundPositionIndex !== null && roundPositionIndex > index) nextPosition = roundPositionIndex - 1;
      await this._saveRounds(nextRounds, nextActive, nextPosition);
      return;
    }

    if (action === "activate") {
      await this._saveRounds(rounds, activeRoundIndex === index ? null : index, index);
      return;
    }

    if (action === "position") {
      await this._saveRounds(rounds, activeRoundIndex, roundPositionIndex === index ? null : index);
      return;
    }

    if (action === "move-up" || action === "move-down") {
      const targetIndex = action === "move-up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= rounds.length) return;
      const nextRounds = [...rounds];
      [nextRounds[index], nextRounds[targetIndex]] = [nextRounds[targetIndex], nextRounds[index]];
      let nextActive = activeRoundIndex;
      let nextPosition = roundPositionIndex;
      if (activeRoundIndex === index) nextActive = targetIndex;
      else if (activeRoundIndex === targetIndex) nextActive = index;
      if (roundPositionIndex === index) nextPosition = targetIndex;
      else if (roundPositionIndex === targetIndex) nextPosition = index;
      await this._saveRounds(nextRounds, nextActive, nextPosition);
    }
  }

  _render() {
    if (!this._hass) return;
    const rounds = this._rounds();
    const activeRoundIndex = this._activeRoundIndex();
    const roundPositionIndex = this._roundPositionIndex();

    this.innerHTML = `
      <ha-card${this._renderHeader()}>
        <div style="padding:16px;display:grid;gap:14px;">
          <div style="display:flex;gap:10px;align-items:center;">
            <input data-role="round-input" type="text" placeholder="Add round name" style="flex:1;min-width:0;border:1px solid var(--divider-color);border-radius:12px;padding:10px 12px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit;font-size:${this._scaledPx(14, 10)};" />
            <button data-action="add" style="${this._buttonStyle(true)};flex:0 0 auto;min-width:92px;">Add</button>
          </div>
          <div style="display:grid;gap:10px;">
            ${rounds.map((round, index) => `
              <div style="padding:12px;border-radius:14px;background:var(--secondary-background-color);display:grid;gap:10px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                  <div style="min-width:0;display:flex;gap:10px;align-items:center;">
                    <div style="font-weight:700;font-size:${this._scaledPx(13, 10)};opacity:0.7;min-width:20px;">${index + 1}.</div>
                    <div style="font-weight:600;font-size:${this._scaledPx(15, 11)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${round}</div>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center;">
                    ${roundPositionIndex === index ? `<div style="font-size:${this._scaledPx(12, 10)};font-weight:700;opacity:0.75;">Position</div>` : ""}
                    ${activeRoundIndex === index ? `<div style="font-size:${this._scaledPx(12, 10)};font-weight:700;color:var(--primary-color);">Active</div>` : ""}
                  </div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <button data-action="activate" data-index="${index}" style="${this._buttonStyle(activeRoundIndex === index)};">${activeRoundIndex === index ? 'Clear Active' : 'Set Active'}</button>
                  <button data-action="position" data-index="${index}" style="${this._buttonStyle(roundPositionIndex === index && activeRoundIndex !== index)};">${roundPositionIndex === index ? 'Clear Position' : 'Set Position'}</button>
                  <button data-action="move-up" data-index="${index}" style="${this._buttonStyle()};" ${index === 0 ? 'disabled' : ''}>Up</button>
                  <button data-action="move-down" data-index="${index}" style="${this._buttonStyle()};" ${index === rounds.length - 1 ? 'disabled' : ''}>Down</button>
                  <button data-action="delete" data-index="${index}" style="${this._buttonStyle()};">Delete</button>
                </div>
              </div>
            `).join("") || `<div style="padding:12px 0;opacity:0.7;font-size:${this._scaledPx(14, 10)};">No quiz rounds yet</div>`}
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
    await this._saveRounds([...rounds, name], this._activeRoundIndex(), this._roundPositionIndex());
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



