/**
 * RH Map Card
 *
 * Renders a GPS route from a polyline-encoded entity (Google Encoded Polyline
 * Algorithm Format) as an SVG path.  Optionally overlays a tile-map background.
 * Supports primary / secondary text templates and an optional MDI icon, styled
 * to match the rest of the RH card series.
 *
 * Configuration
 * ─────────────────────────────────────────────────────────────
 * primary_entity    – entity for the top "primary" info block.  Templates in
 *                     icon / primary / secondary may use {{ entity }} to
 *                     reference it and {{ attr_name }} for its attributes.
 * history_entity    – entity whose state (or attribute) holds a JSON array of
 *                     activity objects.  Each item is rendered in the history
 *                     list below the map.  Templates may use {{ entity }} to
 *                     reference the array item being rendered.
 * map_entity        – entity whose state (or `polyline` attribute) holds the
 *                     encoded polyline.  The card also checks `has_polyline`
 *                     and `polyline` attributes automatically.
 * polyline_attribute – override the attribute name read from map_entity
 *                     (default: auto-detect from state → "polyline" attribute)
 * title             – card header text (omit or "" to suppress)
 * color / fg_color  – foreground / route colour  (default: var(--primary-color))
 * route_width       – stroke width of the route line  (default: 3)
 * show_map          – true/false – whether to render the tile map background
 *                     (default: true)
 * map_tile_url      – tile server URL template using {z}/{x}/{y}
 *                     (default: OpenStreetMap)
 * zoom              – tile zoom level used for the background map  (default: 13)
 * bg_color          – explicit card background colour
 * icon              – MDI icon template for the primary section  (optional)
 * primary           – template string for primary section primary text
 * secondary         – template string for primary section secondary text
 * history_icon      – MDI icon template for each history row  (optional)
 * history_primary   – template for each history row primary text  (optional)
 * history_secondary – template for each history row secondary text  (optional)
 * history_limit     – max number of history items to show  (default: 5)
 *
 * In all templates {{ entity }} resolves to the relevant entity id (primary or
 * history item), {{ states(entity) }} to its state, {{ state_attr(entity,'x') }}
 * to an attribute, and {{ bare_name }} to an attribute value directly.
 *
 * Special computed values available inside history templates:
 *   {{ pace }}   – distance/duration as MM:SS per km  (duration in seconds, distance in km)
 *   {{ duration_fmt }} – duration formatted as HH:MM:SS
 */
class RHMapCard extends HTMLElement {
  constructor() {
    super();
    this._lastRenderKey = "";
    this._tileCache = new Map();
    this._pendingTiles = new Set();
    this._rafPending = false;
  }

  // ─── lifecycle ────────────────────────────────────────────────────────────

  setConfig(config) {
    const safe = config && typeof config === "object" ? config : {};
    if (!safe.primary_entity && !safe.history_entity && !safe.map_entity) {
      throw new Error("rh-map-card: at least one of 'primary_entity', 'history_entity', or 'map_entity' is required");
    }
    this._config = {
      show_map: safe.show_map !== false,
      zoom: Number(safe.zoom) > 0 ? Number(safe.zoom) : 13,
      route_width: Number(safe.route_width) > 0 ? Number(safe.route_width) : 3,
      map_tile_url: typeof safe.map_tile_url === "string"
        ? safe.map_tile_url
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      history_limit: Number(safe.history_limit) > 0 ? Number(safe.history_limit) : 5,
      ...safe,
    };
  }

  set hass(hass) {
    this._hass = hass;
    this._scheduleRender();
  }

  connectedCallback() {
    if (this._hass) {
      this._scheduleRender();
    }
  }

  // ─── async render scheduling ─────────────────────────────────────────────

  _scheduleRender() {
    const token = Symbol();
    this._renderToken = token;
    const run = async () => {
      // Evaluate primary section templates
      const primaryAttrs = this._primaryAttributes();
      const [primary, secondary, icon] = await Promise.all([
        this._evalTemplateAsyncWith(this._config?.primary, this._config?.primary_entity, primaryAttrs),
        this._evalTemplateAsyncWith(this._config?.secondary, this._config?.primary_entity, primaryAttrs),
        this._evalTemplateAsyncWith(this._config?.icon, this._config?.primary_entity, primaryAttrs),
      ]);

      // Evaluate history section templates for each item
      const historyItems = this._historyArray();
      const historyRows = await Promise.all(
        historyItems.map(async (item) => {
          const computed = this._computedFields(item);
          const merged = { ...item, ...computed };
          const [hIcon, hPrimary, hSecondary] = await Promise.all([
            this._evalTemplateAsyncWith(this._config?.history_icon, this._config?.history_entity, merged),
            this._evalTemplateAsyncWith(this._config?.history_primary, this._config?.history_entity, merged),
            this._evalTemplateAsyncWith(this._config?.history_secondary, this._config?.history_entity, merged),
          ]);
          return { icon: hIcon, primary: hPrimary, secondary: hSecondary };
        })
      );

      if (this._renderToken !== token) return;
      const key = this._buildRenderKey(primary, secondary, icon, historyRows);
      if (key === this._lastRenderKey) return;
      this._lastRenderKey = key;
      this._render(primary, secondary, icon, historyRows);
    };
    run();
  }

  // ─── config helpers ───────────────────────────────────────────────────────

  _fgColor() {
    return (
      this._config?.color ||
      this._config?.fg_color ||
      "var(--primary-color, #03a9f4)"
    );
  }

  /** Attributes for the primary entity section. */
  _primaryAttributes() {
    const entityId = this._config?.primary_entity;
    if (!entityId) return {};
    return this._hass?.states?.[entityId]?.attributes || {};
  }

  /**
   * Returns the history array from history_entity.  Tries entity state (JSON),
   * then searches attributes for an array value.
   */
  _historyArray() {
    const entityId = this._config?.history_entity;
    if (!entityId) return [];
    const state = this._hass?.states?.[entityId];
    if (!state) return [];

    let raw;
    // Try entity state as JSON array
    const stateStr = state.state;
    if (typeof stateStr === "string" && stateStr.trimStart().startsWith("[")) {
      try { raw = JSON.parse(stateStr); } catch (_) { /* fall through */ }
    }
    // Try attributes for an array
    if (!Array.isArray(raw)) {
      for (const val of Object.values(state.attributes || {})) {
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object") {
          raw = val;
          break;
        }
      }
    }
    if (!Array.isArray(raw)) return [];
    const limit = this._config?.history_limit || 5;
    return raw.slice(0, limit);
  }

  /**
   * Extracts the polyline string from map_entity.
   * Checks: state, `polyline` attribute, respects `has_polyline` flag.
   */
  _polylineString() {
    const entityId = this._config?.map_entity;
    if (!entityId) return "";
    const state = this._hass?.states?.[entityId];
    if (!state) return "";

    const attrs = state.attributes || {};

    // If a specific attribute is nominated use it
    if (this._config?.polyline_attribute) {
      return String(attrs[this._config.polyline_attribute] || "");
    }

    // Prefer the 'polyline' attribute when has_polyline is truthy
    if (attrs.polyline && (attrs.has_polyline === true || attrs.has_polyline === undefined)) {
      return String(attrs.polyline);
    }

    // Fall back to entity state
    const s = String(state.state || "");
    // Avoid using unavailable/unknown as polyline
    if (s && s !== "unavailable" && s !== "unknown") return s;
    return "";
  }

  // ─── computed helpers ─────────────────────────────────────────────────────

  /** Format seconds as HH:MM:SS */
  _formatDuration(seconds) {
    if (seconds == null || isNaN(Number(seconds))) return "";
    const total = Math.round(Number(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  /** Format pace in seconds/km as MM:SS */
  _formatPace(secondsPerKm) {
    if (secondsPerKm == null || isNaN(Number(secondsPerKm)) || Number(secondsPerKm) <= 0) return "";
    const total = Math.round(Number(secondsPerKm));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  /**
   * Computes derived fields for a history item:
   *   duration_fmt – formatted duration (HH:MM:SS)
   *   pace         – calculated pace as MM:SS/km
   */
  _computedFields(item) {
    const out = {};
    if (item?.duration != null) {
      out.duration_fmt = this._formatDuration(item.duration);
    }
    if (item?.duration != null && item?.distance != null && Number(item.distance) > 0) {
      const paceSecPerKm = Number(item.duration) / Number(item.distance);
      out.pace = this._formatPace(paceSecPerKm);
    }
    return out;
  }

  // ─── template evaluation ──────────────────────────────────────────────────

  /**
   * Lightweight client-side template fallback.
   *
   * Supported patterns:
   *   {{ states('sensor.foo') }}
   *   {{ state_attr('sensor.foo', 'bar') }}
   *   {{ entity }}                   → the relevant entity id
   *   {{ states(entity) }}           → state of the relevant entity
   *   {{ state_attr(entity, 'bar') }}→ attribute from the resolved attrs object
   *   {{ attribute_name }}           → resolved attribute / computed field
   */
  _evalTemplateWith(tmpl, entityId, resolvedAttrs) {
    if (typeof tmpl !== "string" || !tmpl.trim()) return "";
    const attrs = resolvedAttrs || {};

    return tmpl.replace(/\{\{\s*([\s\S]+?)\s*\}\}/g, (_, expr) => {
      // {{ entity }} → entity id
      if (expr.trim() === "entity") return entityId || "";

      // {{ states('sensor.foo') }} or {{ states(entity) }}
      const statesMatch = expr.match(/^states\(\s*(['"]?)([^'")\s]+)\1\s*\)$/);
      if (statesMatch) {
        const id = statesMatch[1] ? statesMatch[2] : entityId;
        return this._hass?.states?.[id]?.state ?? "";
      }

      // {{ state_attr('sensor.foo', 'bar') }} or {{ state_attr(entity, 'bar') }}
      const attrMatch = expr.match(
        /^state_attr\(\s*(['"]?)([^'")\s,]+)\1\s*,\s*['"]([^'"]+)['"]\s*\)$/
      );
      if (attrMatch) {
        const id = attrMatch[1] ? attrMatch[2] : entityId;
        const attrName = attrMatch[3];
        if (!attrMatch[1] || id === entityId) {
          return attrs[attrName] ?? "";
        }
        return this._hass?.states?.[id]?.attributes?.[attrName] ?? "";
      }

      // {{ some_bare_name }} → look up in resolved attributes / computed fields
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(expr.trim())) {
        const val = attrs[expr.trim()];
        if (val !== undefined) return val;
      }

      return `{{ ${expr} }}`;
    });
  }

  async _evalTemplateAsyncWith(tmpl, entityId, resolvedAttrs) {
    if (typeof tmpl !== "string" || !tmpl.trim()) return "";
    const simple = this._evalTemplateWith(tmpl, entityId, resolvedAttrs);
    if (!simple.includes("{{") && !simple.includes("{%")) return simple;
    if (!this._hass?.callApi) return simple;
    try {
      const result = await this._hass.callApi("POST", "template", { template: simple });
      return typeof result === "string" ? result.trim() : String(result ?? "").trim();
    } catch (_) {
      return simple;
    }
  }

  // ─── polyline decoding (Google Encoded Polyline Algorithm) ────────────────

  _decodePolyline(encoded) {
    if (!encoded) return [];
    const coords = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < encoded.length) {
      let b;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      coords.push([lat / 1e5, lng / 1e5]);
    }
    return coords;
  }

  // ─── Mercator tile maths ──────────────────────────────────────────────────

  _latLngToTile(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const x = ((lng + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    return { x, y };
  }

  _tileToLatLng(tx, ty, zoom) {
    const n = Math.pow(2, zoom);
    const lng = (tx / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
    const lat = (latRad * 180) / Math.PI;
    return { lat, lng };
  }

  // ─── render key ───────────────────────────────────────────────────────────

  _buildRenderKey(primary, secondary, icon, historyRows) {
    return [
      this._config?.primary_entity,
      this._config?.history_entity,
      this._config?.map_entity,
      this._polylineString(),
      primary,
      secondary,
      icon,
      JSON.stringify(historyRows),
      this._config?.show_map,
      this._fgColor(),
      this._config?.bg_color,
      this._config?.zoom,
    ].join("~");
  }

  // ─── main render ──────────────────────────────────────────────────────────

  _render(primary, secondary, icon, historyRows) {
    const color = this._fgColor();
    const polylineStr = this._polylineString();
    const coords = this._decodePolyline(polylineStr);
    const showMap = this._config.show_map !== false && this._config.map_entity;
    const iconStr = typeof icon === "string" ? icon.trim() : "";
    const title = this._config.title;
    const headerAttr = (title !== undefined && title !== "") ? ` header="${title}"` : "";

    // Card background
    const noBg = !showMap && !this._config.bg_color;
    const cardStyle = noBg
      ? ""
      : this._config.bg_color
        ? `background:${this._config.bg_color};`
        : "";

    // ── Primary section ────────────────────────────────────────────────────
    const primaryIconHtml = iconStr
      ? `<ha-icon icon="${iconStr}" style="--mdi-icon-size:40px;color:${color};margin-bottom:4px;"></ha-icon>`
      : "";
    const primaryTextHtml = primary
      ? `<div style="font-size:22px;font-weight:800;color:${color};text-align:center;line-height:1.2;margin-bottom:2px;">${primary}</div>`
      : "";
    const primarySecondaryHtml = secondary
      ? `<div style="font-size:14px;font-weight:600;color:${color};text-align:center;opacity:0.75;line-height:1.2;">${secondary}</div>`
      : "";

    const primaryBlock = (primaryIconHtml || primaryTextHtml || primarySecondaryHtml)
      ? `<div style="padding:12px 14px 8px;display:flex;flex-direction:column;align-items:center;gap:2px;">
           ${primaryIconHtml}${primaryTextHtml}${primarySecondaryHtml}
         </div>`
      : "";

    // ── Map section ────────────────────────────────────────────────────────
    let mapHtml = "";
    if (this._config.map_entity) {
      const svgRoute = this._buildRouteSvg(coords, color);
      const mapContainerId = `rh-map-${(this._config.map_entity || "").replace(/[^a-z0-9]/gi, "_")}`;
      mapHtml = `
        <div style="position:relative;width:100%;padding-bottom:75%;overflow:hidden;border-radius:var(--ha-card-border-radius,12px);">
          ${showMap ? `<canvas id="${mapContainerId}" style="position:absolute;top:0;left:0;width:100%;height:100%;"></canvas>` : ""}
          <svg id="${mapContainerId}-svg"
            viewBox="0 0 1000 750" preserveAspectRatio="xMidYMid meet"
            style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;">
            ${svgRoute}
          </svg>
        </div>`;

      // Draw tile map after DOM update
      if (showMap && coords.length >= 2) {
        requestAnimationFrame(() => this._drawMap(coords, mapContainerId));
      }
    }

    // ── History section ────────────────────────────────────────────────────
    let historyHtml = "";
    if (historyRows && historyRows.length > 0) {
      const rowsHtml = historyRows.map((row) => {
        const hIcon = typeof row.icon === "string" ? row.icon.trim() : "";
        const hPrimary = row.primary || "";
        const hSecondary = row.secondary || "";
        const iconCell = hIcon
          ? `<ha-icon icon="${hIcon}" style="--mdi-icon-size:24px;color:${color};grid-row:1/3;align-self:center;"></ha-icon>`
          : `<div style="grid-row:1/3;"></div>`;
        const primaryCell = hPrimary
          ? `<div style="font-size:13px;font-weight:700;color:${color};line-height:1.2;align-self:end;">${hPrimary}</div>`
          : `<div></div>`;
        const secondaryCell = hSecondary
          ? `<div style="font-size:11px;font-weight:500;color:${color};opacity:0.7;line-height:1.2;align-self:start;">${hSecondary}</div>`
          : `<div></div>`;
        return `<div style="display:grid;grid-template-columns:28px 1fr;grid-template-rows:auto auto;column-gap:6px;padding:4px 0;border-top:1px solid var(--divider-color,rgba(255,255,255,0.1));">
          ${iconCell}
          ${primaryCell}
          ${secondaryCell}
        </div>`;
      }).join("");
      historyHtml = `<div style="padding:4px 14px 12px;">${rowsHtml}</div>`;
    }

    this.innerHTML = `
      <ha-card${headerAttr} style="${cardStyle}">
        ${primaryBlock}
        ${mapHtml}
        ${historyHtml}
      </ha-card>
    `;
  }

  // ─── SVG route overlay ────────────────────────────────────────────────────

  _buildRouteSvg(coords, color) {
    if (coords.length < 2) {
      return `<text x="500" y="375" text-anchor="middle" dominant-baseline="middle"
        font-size="24" fill="${color}" opacity="0.5">No route data</text>`;
    }

    const lats = coords.map((c) => c[0]);
    const lngs = coords.map((c) => c[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const W = 1000;
    const H = 750;
    const pad = 40;

    // Use Mercator projection for accurate route shape
    const project = (lat, lng) => {
      const latRad = (lat * Math.PI) / 180;
      const mx = lng;
      const my = (Math.log(Math.tan(Math.PI / 4 + latRad / 2)) * 180) / Math.PI;
      return { mx, my };
    };

    const projected = coords.map(([lat, lng]) => project(lat, lng));
    const mxVals = projected.map((p) => p.mx);
    const myVals = projected.map((p) => p.my);
    const minMx = Math.min(...mxVals);
    const maxMx = Math.max(...mxVals);
    const minMy = Math.min(...myVals);
    const maxMy = Math.max(...myVals);

    const rangeX = maxMx - minMx || 1;
    const rangeY = maxMy - minMy || 1;

    // Keep aspect ratio
    const drawW = W - pad * 2;
    const drawH = H - pad * 2;
    const scaleX = drawW / rangeX;
    const scaleY = drawH / rangeY;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = pad + (drawW - rangeX * scale) / 2;
    const offsetY = pad + (drawH - rangeY * scale) / 2;

    const svgPoints = projected.map((p) => {
      const x = offsetX + (p.mx - minMx) * scale;
      const y = offsetY + (maxMy - p.my) * scale; // flip Y
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    const strokeWidth = Math.max(2, this._config.route_width || 3) * 2; // scaled for viewBox
    const pointsStr = svgPoints.join(" ");

    // Draw a shadow/glow for visual weight
    const shadowWidth = strokeWidth + 4;

    return `
      <filter id="rh-map-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="${color}" flood-opacity="0.35"/>
      </filter>
      <polyline points="${pointsStr}"
        fill="none" stroke="${color}" stroke-opacity="0.25"
        stroke-width="${shadowWidth}" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="${pointsStr}"
        fill="none" stroke="${color}"
        stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"
        filter="url(#rh-map-shadow)"/>
      <circle cx="${svgPoints[0].split(",")[0]}" cy="${svgPoints[0].split(",")[1]}" r="${strokeWidth * 1.4}"
        fill="${color}" opacity="0.9"/>
      <circle cx="${svgPoints[svgPoints.length - 1].split(",")[0]}" cy="${svgPoints[svgPoints.length - 1].split(",")[1]}" r="${strokeWidth * 1.4}"
        fill="${color}"/>
    `;
  }

  // ─── tile map drawing ─────────────────────────────────────────────────────

  _drawMap(coords, containerId) {
    const canvas = this.querySelector(`#${CSS.escape(containerId)}`);
    if (!canvas) return;

    const lats = coords.map((c) => c[0]);
    const lngs = coords.map((c) => c[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const zoom = this._config.zoom;

    // Tile coords of bounding box
    const topLeft = this._latLngToTile(maxLat, minLng, zoom);
    const bottomRight = this._latLngToTile(minLat, maxLng, zoom);

    const tileX0 = Math.floor(topLeft.x);
    const tileY0 = Math.floor(topLeft.y);
    const tileX1 = Math.floor(bottomRight.x);
    const tileY1 = Math.floor(bottomRight.y);

    const TILE_SIZE = 256;
    const tilesX = tileX1 - tileX0 + 1;
    const tilesY = tileY1 - tileY0 + 1;

    const mapW = tilesX * TILE_SIZE;
    const mapH = tilesY * TILE_SIZE;

    // Scale so the route bbox fits with padding (same logic as SVG)
    const pad = 0.1; // 10% padding fraction
    const routeTileX0 = topLeft.x - tileX0;
    const routeTileY0 = topLeft.y - tileY0;
    const routeTileX1 = bottomRight.x - tileX0;
    const routeTileY1 = bottomRight.y - tileY0;

    const routeW = (routeTileX1 - routeTileX0) * TILE_SIZE;
    const routeH = (routeTileY1 - routeTileY0) * TILE_SIZE;
    const routeLeft = routeTileX0 * TILE_SIZE;
    const routeTop = routeTileY0 * TILE_SIZE;

    // Desired display dimensions
    const dispW = canvas.clientWidth || 300;
    const dispH = canvas.clientHeight || 225;

    // Scale to fill display with padding
    const scaleX = dispW / (routeW * (1 + 2 * pad) || 1);
    const scaleY = dispH / (routeH * (1 + 2 * pad) || 1);
    const scale = Math.min(scaleX, scaleY);

    canvas.width = dispW;
    canvas.height = dispH;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, dispW, dispH);

    // Origin of tile grid in canvas coords
    const originX = dispW / 2 - (routeLeft + routeW / 2) * scale;
    const originY = dispH / 2 - (routeTop + routeH / 2) * scale;

    const tileUrl = this._config.map_tile_url;

    for (let tx = tileX0; tx <= tileX1; tx++) {
      for (let ty = tileY0; ty <= tileY1; ty++) {
        const url = tileUrl
          .replace("{z}", zoom)
          .replace("{x}", tx)
          .replace("{y}", ty);
        const cx = originX + (tx - tileX0) * TILE_SIZE * scale;
        const cy = originY + (ty - tileY0) * TILE_SIZE * scale;
        const cw = TILE_SIZE * scale;

        this._getTileImage(url, (img) => {
          if (!img) return;
          try {
            ctx.drawImage(img, cx, cy, cw, cw);
          } catch (_) {
            // cross-origin tile may fail – ignore
          }
        });
      }
    }
  }

  _getTileImage(url, callback) {
    const cached = this._tileCache.get(url);
    if (cached) {
      callback(cached === "error" ? null : cached);
      return;
    }
    if (this._pendingTiles.has(url)) return;
    this._pendingTiles.add(url);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      this._tileCache.set(url, img);
      this._pendingTiles.delete(url);
      callback(img);
    };
    img.onerror = () => {
      this._tileCache.set(url, "error");
      this._pendingTiles.delete(url);
      callback(null);
    };
    img.src = url;
  }
}

customElements.define("rh-map-card", RHMapCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "rh-map-card",
  name: "RH Map",
  description: "Displays a GPS route from an encoded polyline entity.",
  preview: false,
});
