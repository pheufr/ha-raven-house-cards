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
 * entity          (required) – timer entity id
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
    this._completedAt = null; // local Date when we first detected completion
    this._dismissedEntityId = null; // track which entity was dismissed
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("rh-timer-card: 'entity' is required");
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
      ...config,
    };
  }

  set hass(hass) {
    this._hass = hass;
    const state = this._timerState();

    // Detect transition to complete so we record the local time once.
    if (state && state.state === "idle" && this._completedAt) {
      // Timer cancelled externally – clear our local completed state too.
      if (this._dismissedEntityId === this._config.entity) {
        this._completedAt = null;
        this._dismissedEntityId = null;
      }
    }

    this._scheduleRender();
  }

  _timerState() {
    if (!this._hass || !this._config) return null;
    return this._hass.states[this._config.entity] || null;
  }

  _buildRenderKey() {
    const s = this._timerState();
    if (!s) return "missing";
    // Include seconds so the key changes each second when active.
    const now = Math.floor(Date.now() / 1000);
    const elapsed = this._completedAt ? Math.floor((Date.now() - this._completedAt) / 1000) : 0;
    return `${s.state}|${s.attributes.remaining || ""}|${now}|${elapsed}`;
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
    const s = this._timerState();
    if (!s) {
      this._stopTick();
      this.innerHTML = this._renderMissing();
      return;
    }

    const timerState = s.state; // idle | active | paused

    // Check if HA says the timer just finished (idle after being active/paused
    // but we haven't dismissed it yet).  We use finishes_at being in the past as
    // the signal – if the timer just expired, finishes_at will equal "now".
    // HA sets state → "idle" when a timer finishes; the only way to distinguish
    // "naturally expired" vs "user cancelled" is through last_changed.  We use
    // our local _completedAt flag instead to keep things simple: the first time
    // we see the timer transition from active → idle we treat it as complete.
    if (timerState === "idle" && this._completedAt && this._dismissedEntityId !== this._config.entity) {
      this._startTick();
      this.innerHTML = this._renderComplete();
      return;
    }

    if (timerState === "active" || timerState === "paused") {
      // Clear any stale completion state for this entity
      if (this._dismissedEntityId === this._config.entity) {
        this._dismissedEntityId = null;
        this._completedAt = null;
      }

      const remaining = this._remainingSeconds(s);
      if (remaining <= 0 && timerState === "active") {
        // Timer just hit zero – record completion time if not yet done.
        if (!this._completedAt) {
          this._completedAt = new Date();
        }
        this._startTick();
        this.innerHTML = this._renderComplete();
        return;
      }

      // Reset completion state if somehow we're active again with time remaining
      this._completedAt = null;
      this._startTick();
      this.innerHTML = this._renderActive(s, remaining, timerState === "paused");
      return;
    }

    // idle – clear completion tracking when dismissed (entity back to clean idle)
    if (this._completedAt && this._dismissedEntityId === this._config.entity) {
      this._completedAt = null;
      this._dismissedEntityId = null;
    }

    this._stopTick();
    this.innerHTML = this._renderIdle(s);
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
    return state.attributes.friendly_name || this._config.entity;
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

  _renderComplete() {
    const state = this._timerState();
    const title = state ? this._cardTitle(state) : "";
    const color = this._config.complete_color || "var(--error-color, #f44336)";
    const elapsedSec = this._completedAt
      ? Math.floor((Date.now() - this._completedAt) / 1000)
      : 0;
    const elapsedText = this._formatTime(elapsedSec);

    return `
      <ha-card${title ? ` header="${title}"` : ""}>
        <div class="rh-timer-complete-area"
          style="display:flex;flex-direction:column;align-items:center;justify-content:center;
            padding:28px 16px;gap:10px;cursor:pointer;aspect-ratio:1 / 1;
            background:${color}1a;border-radius:var(--ha-card-border-radius,12px);">
          <div style="width:160px;height:160px;border-radius:50%;
            background:${color}22;border:8px solid ${color};
            display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;">
            <div style="font-size:26px;font-weight:800;color:${color};line-height:1;">Complete</div>
            <div style="font-size:18px;font-weight:600;color:${color};opacity:0.85;">${elapsedText}</div>
          </div>
          <div style="font-size:11px;opacity:0.55;text-transform:uppercase;letter-spacing:0.1em;">
            Tap to dismiss
          </div>
        </div>
      </ha-card>
    `;
  }

  // ─── missing entity ────────────────────────────────────────────────────────

  _renderMissing() {
    return `
      <ha-card>
        <div style="padding:20px;opacity:0.6;font-size:14px;">
          Timer entity not found: ${this._config ? this._config.entity : ""}
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
      this._hass.callService("timer", "start", {
        entity_id: this._config.entity,
        duration,
      });
      return;
    }

    // Dismiss complete state
    const completeArea = e.target.closest(".rh-timer-complete-area");
    if (completeArea) {
      this._dismissedEntityId = this._config.entity;
      this._completedAt = null;
      this._hass.callService("timer", "cancel", {
        entity_id: this._config.entity,
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
