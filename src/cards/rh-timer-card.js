/**
 * RH Timer Card
 *
 * Displays a HA timer entity as a circular-arc countdown gauge.
 *
 * States
 * ─────────────────────────────────────────────────────────────
 * idle     → "No Timer Set" + quick-start buttons (1m, 5m, 30m, 60m)
 * active   → circular arc countdown with remaining time in large text
 * paused   → same as active but arc is drawn in a muted colour
 * complete → filled circle with "Complete" label + elapsed-since counter
 *            (cleared by clicking the card or calling timer.cancel)
 *
 * Configuration
 * ─────────────────────────────────────────────────────────────
 * entity          (optional) – timer entity id or array of timer entity ids
 *                   when omitted, all timer entities are discovered automatically
 * default_entity  – timer entity id targeted by quick-start buttons and used as
 *                   the preferred single-timer view in discovery mode
 * title           – optional card header text  (default: entity friendly_name)
 * color           – base foreground colour      (default: auto via CSS vars)
 * quick_buttons   – array of objects { label, duration } for idle buttons
 *                   duration is a string accepted by timer.start, e.g. "00:05:00"
 *                   (default: 1 min, 5 min, 30 min, 60 min)
 * thresholds      – array of { seconds, color } objects, sorted descending.
 *                   When remaining ≤ seconds the arc switches to that colour.
 *                   (default: 60 → orange, 0 → red)
 * complete_color  – colour used when the timer finishes (default: red)
 */
class RHTimerCard extends HTMLElement {
  constructor() {
    super();
    this._lastRenderKey = "";
    this._tickInterval = null;
    this._completedAtByEntity = {}; // local Date when completion was first detected
    this._dismissedEntityIds = new Set(); // entities dismissed in complete mode
    this._prevStateByEntity = {}; // previous HA state by entity id
    this._displayEntityId = null; // entity currently rendered in single-timer views
  }

  setConfig(config) {
    const safeConfig = config && typeof config === "object" ? config : {};
    const hasEntity = safeConfig.entity !== undefined && safeConfig.entity !== null;
    const defaultEntity = typeof safeConfig.default_entity === "string" ? safeConfig.default_entity.trim() : safeConfig.default_entity;
    let entities;

    if (hasEntity) {
      entities = (Array.isArray(safeConfig.entity) ? safeConfig.entity : [safeConfig.entity])
        .map((entityId) => (typeof entityId === "string" ? entityId.trim() : entityId))
        .filter(Boolean);
      if (!entities.length) {
        throw new Error("rh-timer-card: 'entity' must contain at least one timer entity id");
      }
      if (defaultEntity && !entities.includes(defaultEntity)) {
        throw new Error("rh-timer-card: 'default_entity' must match 'entity' or be included in the 'entity' list");
      }
    } else if (!defaultEntity) {
      throw new Error("rh-timer-card: 'default_entity' is required when 'entity' is not defined");
    }

    this._config = {
      quick_buttons: [
        { label: "1m", duration: "00:01:00" },
        { label: "5m", duration: "00:05:00" },
        { label: "30m", duration: "00:30:00" },
        { label: "60m", duration: "01:00:00" },
      ],
      thresholds: [
        { seconds: 60, color: "var(--warning-color, #ff9800)" },
        { seconds: 0, color: "var(--error-color, #f44336)" },
      ],
      complete_color: "var(--error-color, #f44336)",
      ...safeConfig,
    };
    if (hasEntity) {
      this._config.entity = entities;
    } else {
      delete this._config.entity;
    }
    if (defaultEntity) {
      this._config.default_entity = defaultEntity;
    }
  }

  set hass(hass) {
    this._hass = hass;
    const entityIds = this._entityIds();
    for (const entityId of entityIds) {
      const state = this._timerState(entityId);
      const prevState = this._prevStateByEntity[entityId];

      if (state) {
        if (state.state === "idle" && (prevState === "active" || prevState === "paused")) {
          if (!this._dismissedEntityIds.has(entityId) && !this._completedAtByEntity[entityId]) {
            this._completedAtByEntity[entityId] = new Date();
          }
        } else if (state.state === "active" || state.state === "paused") {
          this._dismissedEntityIds.delete(entityId);
          if (this._remainingSeconds(state) > 0) {
            this._completedAtByEntity[entityId] = null;
          }
        }
        this._prevStateByEntity[entityId] = state.state;
      } else {
        this._prevStateByEntity[entityId] = null;
        this._completedAtByEntity[entityId] = null;
        this._dismissedEntityIds.delete(entityId);
      }
    }

    this._scheduleRender();
  }

  _entityIds() {
    if (!this._config) return [];
    if (Array.isArray(this._config.entity) && this._config.entity.length) {
      return this._config.entity;
    }
    return Object.entries(this._hass?.states || {})
      .filter(([entityId]) => entityId.startsWith("timer."))
      .sort(([aEntityId, a], [bEntityId, b]) => {
        const aName = a?.attributes?.friendly_name || aEntityId;
        const bName = b?.attributes?.friendly_name || bEntityId;
        return aName.localeCompare(bName) || aEntityId.localeCompare(bEntityId);
      })
      .map(([entityId]) => entityId);
  }

  _primaryEntityId() {
    return this._config?.default_entity || this._entityIds()[0] || null;
  }

  _timerState(entityId) {
    if (!this._hass || !this._config) return null;
    return this._hass.states[entityId] || null;
  }

  _timerStates() {
    return this._entityIds()
      .map((entityId) => ({ entityId, state: this._timerState(entityId) }))
      .filter((entry) => !!entry.state);
  }

  _buildRenderKey() {
    const now = Math.floor(Date.now() / 1000);
    const entityIds = this._entityIds();
    if (!entityIds.length) return "missing";
    const chunks = [];
    for (const entityId of entityIds) {
      const s = this._timerState(entityId);
      if (!s) {
        chunks.push(`${entityId}|missing`);
        continue;
      }
      const elapsed = this._completedAtByEntity[entityId]
        ? Math.floor((Date.now() - this._completedAtByEntity[entityId]) / 1000)
        : 0;
      chunks.push(
        `${entityId}|${s.state}|${s.attributes.remaining || ""}|${s.attributes.finishes_at || ""}|${elapsed}|${this._dismissedEntityIds.has(entityId)}`
      );
    }
    return `${chunks.join("||")}|${now}`;
  }

  _scheduleRender() {
    const key = this._buildRenderKey();
    if (key === this._lastRenderKey) return;
    this._lastRenderKey = key;
    this._render();
  }

  _startTick() {
    if (this._tickInterval) return;
    this._tickInterval = setInterval(() => {
      this._lastRenderKey = ""; // force re-render
      this._scheduleRender();
    }, 500);
  }

  _stopTick() {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }

  connectedCallback() {
    this._clickHandler = (e) => this._handleClick(e);
    this.addEventListener("click", this._clickHandler);
    this._scheduleRender();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this._clickHandler);
    this._stopTick();
  }

  // ─── rendering ────────────────────────────────────────────────────────────

  _render() {
    const entries = this._timerStates();
    if (!entries.length) {
      this._stopTick();
      this.innerHTML = this._renderMissing();
      return;
    }

    const activeEntries = entries.filter((entry) => entry.state.state === "active" || entry.state.state === "paused");
    const completeEntries = entries.filter(
      (entry) => entry.state.state === "idle" && this._completedAtByEntity[entry.entityId] && !this._dismissedEntityIds.has(entry.entityId)
    );

    if (activeEntries.length > 1) {
      this._startTick();
      this._displayEntityId = null;
      this.innerHTML = this._renderMultiActive(activeEntries);
      return;
    }

    if (activeEntries.length === 1) {
      const activeEntry = activeEntries[0];
      const remaining = this._remainingSeconds(activeEntry.state);
      if (remaining <= 0 && activeEntry.state.state === "active") {
        if (!this._completedAtByEntity[activeEntry.entityId]) {
          this._completedAtByEntity[activeEntry.entityId] = new Date();
        }
        this._displayEntityId = activeEntry.entityId;
        this._startTick();
        this.innerHTML = this._renderComplete(activeEntry.entityId);
        return;
      }
      this._displayEntityId = activeEntry.entityId;
      this._startTick();
      this.innerHTML = this._renderActive(activeEntry.state, remaining, activeEntry.state.state === "paused");
      return;
    }

    if (completeEntries.length) {
      const primaryEntity = this._primaryEntityId();
      const selected =
        completeEntries.find((entry) => entry.entityId === primaryEntity) ||
        completeEntries[0];
      this._displayEntityId = selected.entityId;
      this._startTick();
      this.innerHTML = this._renderComplete(selected.entityId);
      return;
    }

    const primaryEntity = this._primaryEntityId();
    const idleEntry = entries.find((entry) => entry.entityId === primaryEntity) || entries[0];
    this._displayEntityId = idleEntry.entityId;
    this._stopTick();
    this.innerHTML = this._renderIdle(idleEntry.state);
  }

  _remainingSeconds(state) {
    // When the timer is active, use finishes_at for a live countdown.
    if (state.state === "active" && state.attributes.finishes_at) {
      const finishMs = new Date(state.attributes.finishes_at).getTime();
      return Math.max(0, (finishMs - Date.now()) / 1000);
    }
    // For paused / idle, fall back to the static remaining attribute.
    const remaining = state.attributes.remaining; // e.g. "0:05:00" or "0:00:30"
    if (!remaining) return 0;
    const parts = String(remaining).split(":").map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return Number(parts[0]) || 0;
  }

  _durationSeconds(state) {
    // HA timer stores the configured duration in attributes.duration
    const dur = state.attributes.duration;
    if (!dur) return 0;
    const parts = String(dur).split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return Number(parts[0]) || 0;
  }

  _formatTime(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  _arcColor(remaining) {
    const thresholds = [...(this._config.thresholds || [])].sort((a, b) => b.seconds - a.seconds);
    for (const t of thresholds) {
      if (remaining <= t.seconds) {
        return t.color;
      }
    }
    return this._config.color || "var(--primary-color, #03a9f4)";
  }

  // Build SVG arc path for remaining fraction of a circle (clockwise from top).
  _arcPath(fraction) {
    const r = 90; // radius
    const cx = 100;
    const cy = 100;
    // fraction: 1 = full circle, 0 = no arc
    const clamped = Math.max(0, Math.min(1, fraction));
    if (clamped >= 0.9999) {
      // Full circle – use two arcs
      return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`;
    }
    const angle = clamped * 2 * Math.PI;
    const startX = cx;
    const startY = cy - r;
    const endX = cx + r * Math.sin(angle);
    const endY = cy - r * Math.cos(angle);
    const largeArc = clamped > 0.5 ? 1 : 0;
    return `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX.toFixed(3)} ${endY.toFixed(3)}`;
  }

  _friendlyName(state) {
    return state.attributes.friendly_name || state.entity_id;
  }

  _cardTitle(state) {
    if (this._config.title !== undefined) return this._config.title;
    return this._friendlyName(state);
  }

  // ─── idle view ────────────────────────────────────────────────────────────

  _renderIdle(state) {
    const title = this._cardTitle(state);
    const buttons = (this._config.quick_buttons || [])
      .map(
        (btn) =>
          `<button class="rh-timer-quick" data-duration="${btn.duration}"
            style="padding:10px 18px;border:none;border-radius:10px;cursor:pointer;
              font:inherit;font-size:15px;font-weight:700;
              background:var(--secondary-background-color,rgba(128,128,128,0.12));
              color:var(--primary-text-color);">
            ${btn.label}
          </button>`
      )
      .join("");

    return `
      <ha-card${title ? ` header="${title}"` : ""}>
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
          padding:24px 16px;gap:20px;min-height:160px;">
          <div style="opacity:0.6;font-size:15px;">No Timer Set</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;">
            ${buttons}
          </div>
        </div>
      </ha-card>
    `;
  }

  // ─── active / paused view ─────────────────────────────────────────────────

  _renderActive(state, remaining, paused) {
    const title = this._cardTitle(state);
    const duration = this._durationSeconds(state) || remaining;
    const fraction = duration > 0 ? remaining / duration : 1;
    const arcColor = paused
      ? "var(--disabled-color, rgba(128,128,128,0.5))"
      : this._arcColor(remaining);
    const trackColor = "var(--divider-color, rgba(128,128,128,0.2))";
    const timeText = this._formatTime(remaining);

    const arcPath = this._arcPath(fraction);

    return `
      <ha-card${title ? ` header="${title}"` : ""}>
        <div style="display:flex;align-items:center;justify-content:center;padding:20px 16px;">
          <div style="position:relative;width:200px;height:200px;">
            <svg viewBox="0 0 200 200" width="200" height="200" style="display:block;">
              <!-- track circle -->
              <circle cx="100" cy="100" r="90" fill="none" stroke="${trackColor}" stroke-width="12"/>
              <!-- remaining arc -->
              <path d="${arcPath}" fill="none" stroke="${arcColor}" stroke-width="12"
                stroke-linecap="round"/>
            </svg>
            <!-- centred text overlay -->
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;
              align-items:center;justify-content:center;gap:4px;pointer-events:none;">
              <div style="font-size:36px;font-weight:800;line-height:1;color:${arcColor};">
                ${timeText}
              </div>
              ${paused ? `<div style="font-size:12px;opacity:0.6;text-transform:uppercase;letter-spacing:0.1em;">Paused</div>` : ""}
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  // ─── complete view ────────────────────────────────────────────────────────

  _renderComplete(entityId) {
    const state = this._timerState(entityId);
    const title = state ? this._cardTitle(state) : "";
    const color = this._config.complete_color || "var(--error-color, #f44336)";
    const trackColor = "var(--divider-color, rgba(128,128,128,0.2))";
    const completedAt = this._completedAtByEntity[entityId];
    const elapsedSec = completedAt
      ? Math.floor((Date.now() - completedAt) / 1000)
      : 0;
    const elapsedText = this._formatTime(elapsedSec);

    return `
      <ha-card${title ? ` header="${title}"` : ""}>
        <div class="rh-timer-complete-area"
          style="display:flex;align-items:center;justify-content:center;padding:20px 16px;cursor:pointer;">
          <div style="position:relative;width:200px;height:200px;">
            <svg viewBox="0 0 200 200" width="200" height="200" style="display:block;">
              <circle cx="100" cy="100" r="84" fill="${color}12"/>
              <circle cx="100" cy="100" r="90" fill="none" stroke="${trackColor}" stroke-width="12"/>
              <circle cx="100" cy="100" r="90" fill="none" stroke="${color}" stroke-width="12"/>
            </svg>
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;
              align-items:center;justify-content:center;gap:6px;pointer-events:none;">
              <div style="font-size:30px;font-weight:800;color:${color};line-height:1;">Complete</div>
              <div style="font-size:18px;font-weight:600;color:${color};opacity:0.85;line-height:1;">${elapsedText}</div>
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  _renderMultiActive(entries) {
    const title = this._config.title !== undefined ? this._config.title : "";
    const trackColor = "var(--divider-color, rgba(128,128,128,0.2))";
    const items = entries
      .map((entry) => {
        const remaining = this._remainingSeconds(entry.state);
        const duration = this._durationSeconds(entry.state) || remaining;
        const fraction = duration > 0 ? remaining / duration : 1;
        const paused = entry.state.state === "paused";
        const arcColor = paused
          ? "var(--disabled-color, rgba(128,128,128,0.5))"
          : this._arcColor(remaining);
        const arcPath = this._arcPath(fraction);
        return `
          <div style="display:flex;flex-direction:column;align-items:center;gap:8px;min-width:150px;">
            <div style="position:relative;width:150px;height:150px;">
              <svg viewBox="0 0 200 200" width="150" height="150" style="display:block;">
                <circle cx="100" cy="100" r="90" fill="none" stroke="${trackColor}" stroke-width="12"/>
                <path d="${arcPath}" fill="none" stroke="${arcColor}" stroke-width="12" stroke-linecap="round"/>
              </svg>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;
                align-items:center;justify-content:center;gap:4px;pointer-events:none;">
                <div style="font-size:28px;font-weight:800;line-height:1;color:${arcColor};">
                  ${this._formatTime(remaining)}
                </div>
                ${paused ? `<div style="font-size:11px;opacity:0.6;text-transform:uppercase;letter-spacing:0.1em;">Paused</div>` : ""}
              </div>
            </div>
            <div style="font-size:13px;opacity:0.8;text-align:center;line-height:1.2;">
              ${this._friendlyName(entry.state)}
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <ha-card${title ? ` header="${title}"` : ""}>
        <div style="display:flex;gap:12px;overflow-x:auto;padding:18px 16px 16px;align-items:flex-start;">
          ${items}
        </div>
      </ha-card>
    `;
  }

  // ─── missing entity ────────────────────────────────────────────────────────

  _renderMissing() {
    if (!this._config?.entity) {
      return `
        <ha-card>
          <div style="padding:20px;opacity:0.6;font-size:14px;">
            No timer entities found
          </div>
        </ha-card>
      `;
    }
    const entity = this._primaryEntityId() || "";
    return `
      <ha-card>
        <div style="padding:20px;opacity:0.6;font-size:14px;">
          Timer entity not found: ${entity}
        </div>
      </ha-card>
    `;
  }

  // ─── interaction ──────────────────────────────────────────────────────────

  _handleClick(e) {
    // Quick-start buttons (idle view)
    const quickBtn = e.target.closest(".rh-timer-quick");
    if (quickBtn) {
      const duration = quickBtn.dataset.duration;
      const entityId = this._primaryEntityId();
      if (!entityId) return;
      this._hass.callService("timer", "start", {
        entity_id: entityId,
        duration,
      });
      return;
    }

    // Dismiss complete state
    const completeArea = e.target.closest(".rh-timer-complete-area");
    if (completeArea) {
      const entityId = this._displayEntityId || this._primaryEntityId();
      if (!entityId) return;
      this._dismissedEntityIds.add(entityId);
      this._completedAtByEntity[entityId] = null;
      this._hass.callService("timer", "cancel", {
        entity_id: entityId,
      });
      this._lastRenderKey = "";
      this._render();
      return;
    }
  }

  getCardSize() {
    return 4;
  }
}

if (!customElements.get("rh-timer-card")) {
  customElements.define("rh-timer-card", RHTimerCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.find((card) => card.type === "rh-timer-card")) {
  window.customCards.push({
    type: "rh-timer-card",
    name: "RH Timer Card",
    description: "Circular countdown timer with arc gauge and quick-start buttons",
  });
}
