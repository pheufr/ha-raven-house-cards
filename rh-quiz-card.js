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
