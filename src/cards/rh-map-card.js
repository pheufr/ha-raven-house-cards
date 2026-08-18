/**
 * RH Map Card
 *
 * Renders a GPS route from a polyline-encoded entity (Google Encoded Polyline
 * Algorithm Format) as an SVG path.  Optionally overlays a tile-map background.
 * Supports primary / secondary text templates and an optional MDI icon above
 * the map, styled to match the rest of the RH card series.
 *
 * Configuration
 * ─────────────────────────────────────────────────────────────
 * entity            – required entity whose state (or attribute) holds the
 *                     encoded polyline string.  When the entity's state (or a
 *                     nominated attribute) is a JSON array of activity objects,
 *                     the card automatically selects the most recent entry that
 *                     has hasPolyline=true.
 * polyline_attribute – attribute name to read from (default: uses entity state)
 *                     For array entities this is the attribute on each array
 *                     *member* (default: "polyline").
 * title             – card header text (omit or "" to suppress)
 * color / fg_color  – foreground / route colour
 *                     (default: var(--primary-color))
 * route_width       – stroke width of the route line  (default: 3)
 * show_map          – true/false – whether to render the tile map background
 *                     (default: true)
 * map_tile_url      – tile server URL template using {z}/{x}/{y}
 *                     (default: OpenStreetMap)
 * zoom              – tile zoom level used for the background map  (default: 13)
 * bg_color          – explicit card background colour (only relevant when
 *                     show_map is false; if omitted with show_map:false the
 *                     card is completely transparent)
 * icon              – MDI icon name, e.g. "mdi:run"  (optional)
 * primary           – template string for primary text  (optional)
 * secondary         – template string for secondary text  (optional)
 *
 * Templates in `primary`, `secondary`, and `icon` are evaluated using the HA
 * template engine when available so that any valid Jinja2 expression works,
 * including conditionals ({% if %}/{% else %}/{% endif %}), filters, and all
 * standard HA template functions.  A lightweight client-side fallback handles
 * the common {{ states('sensor.foo') }} / {{ state_attr('sensor.foo','bar') }}
 * patterns when the API is unreachable.
 */
class RHMapCard extends HTMLElement {
  constructor() {
    super();
    this._lastRenderKey = "";
    this._tileCache = new Map();
    this._pendingTiles = new Set();
    this._mapCanvas = null;
    this._mapCtx = null;
    this._currentPolyline = "";
    this._currentZoom = 13;
    this._currentBounds = null;
    this._rafPending = false;
  }

  // ─── lifecycle ────────────────────────────────────────────────────────────

  setConfig(config) {
    const safe = config && typeof config === "object" ? config : {};
    if (!safe.entity) {
      throw new Error("rh-map-card: 'entity' is required");
    }
    this._config = {
      show_map: safe.show_map !== false,
      zoom: Number(safe.zoom) > 0 ? Number(safe.zoom) : 13,
      route_width: Number(safe.route_width) > 0 ? Number(safe.route_width) : 3,
      map_tile_url: typeof safe.map_tile_url === "string"
        ? safe.map_tile_url
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
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
      const [primary, secondary, icon] = await Promise.all([
        this._evalTemplateAsync(this._config?.primary),
        this._evalTemplateAsync(this._config?.secondary),
        this._evalTemplateAsync(this._config?.icon),
      ]);
      if (this._renderToken !== token) return;
      const key = this._buildRenderKey(primary, secondary, icon);
      if (key === this._lastRenderKey) return;
      this._lastRenderKey = key;
      this._render(primary, secondary, icon);
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

  _entityState() {
    return this._hass?.states?.[this._config.entity] || null;
  }

  /**
   * Returns the parsed activity array when the entity holds an array of
   * activities (either as the entity state or via a nominated attribute),
   * otherwise returns null.
   */
  _activityArray() {
    const state = this._entityState();
    if (!state) return null;

    let raw;
    if (this._config.array_attribute) {
      raw = state.attributes?.[this._config.array_attribute];
    } else {
      // Try entity state first (some integrations store JSON in state)
      const stateStr = state.state;
      if (typeof stateStr === "string" && stateStr.trimStart().startsWith("[")) {
        try { raw = JSON.parse(stateStr); } catch (_) { /* fall through */ }
      }
      // Fall back to checking all attributes for a top-level array
      if (!Array.isArray(raw)) {
        for (const val of Object.values(state.attributes || {})) {
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object") {
            raw = val;
            break;
          }
        }
      }
    }

    return Array.isArray(raw) ? raw : null;
  }

  /**
   * Picks the most recent activity with hasPolyline=true from an array, or
   * returns null if no suitable entry exists.
   */
  _chosenActivity() {
    const arr = this._activityArray();
    if (!arr) return null;
    const withPolyline = arr.filter((a) => a && a.hasPolyline === true);
    if (!withPolyline.length) return null;
    // Assume the array is ordered most-recent-first (Garmin Connect ordering).
    // If entries have a startTimeLocal/startTime field, sort descending.
    const dated = withPolyline.filter((a) => a.startTimeLocal || a.startTime);
    if (dated.length) {
      dated.sort((a, b) => {
        const ta = new Date(a.startTimeLocal || a.startTime).getTime();
        const tb = new Date(b.startTimeLocal || b.startTime).getTime();
        return tb - ta;
      });
      return dated[0];
    }
    return withPolyline[0];
  }

  /**
   * Returns the attributes object to use for template resolution.
   * For array entities this is the chosen activity member; otherwise it is
   * the HA entity's attributes.
   */
  _resolvedAttributes() {
    const activity = this._chosenActivity();
    if (activity) return activity;
    return this._entityState()?.attributes || {};
  }

  _polylineString() {
    const activity = this._chosenActivity();
    if (activity) {
      const attr = this._config.polyline_attribute || "polyline";
      return String(activity[attr] || "");
    }
    const state = this._entityState();
    if (!state) return "";
    if (this._config.polyline_attribute) {
      return String(state.attributes?.[this._config.polyline_attribute] || "");
    }
    return String(state.state || "");
  }

  // ─── template evaluation ──────────────────────────────────────────────────

  /**
   * Lightweight client-side template fallback.
   *
   * Supported patterns:
   *   {{ states('sensor.foo') }}
   *   {{ state_attr('sensor.foo', 'bar') }}
   *   {{ entity }}                          → the configured entity id
   *   {{ states(entity) }}                  → state of the configured entity
   *   {{ state_attr(entity, 'bar') }}       → attribute 'bar'; when in array
   *                                           mode this reads from the chosen
   *                                           activity member, not HA attributes
   *   {{ attribute_name }}                  → resolved attribute from the chosen
   *                                           member / entity attributes
   */
  _evalTemplate(tmpl) {
    if (typeof tmpl !== "string" || !tmpl.trim()) return "";
    const entityId = this._config.entity;
    const resolvedAttrs = this._resolvedAttributes();
    const isArrayMode = this._chosenActivity() !== null;

    return tmpl.replace(/\{\{\s*([\s\S]+?)\s*\}\}/g, (_, expr) => {
      // {{ entity }} → entity id
      if (expr.trim() === "entity") return entityId;

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
        if (id === entityId && isArrayMode) {
          // Return from chosen activity member
          return resolvedAttrs[attrName] ?? "";
        }
        return this._hass?.states?.[id]?.attributes?.[attrName] ?? "";
      }

      // {{ some_bare_name }} → look up in resolved attributes
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(expr.trim())) {
        const val = resolvedAttrs[expr.trim()];
        if (val !== undefined) return val;
      }

      return `{{ ${expr} }}`;
    });
  }

  async _evalTemplateAsync(tmpl) {
    if (typeof tmpl !== "string" || !tmpl.trim()) return "";
    const simple = this._evalTemplate(tmpl);
    if (!simple.includes("{{") && !simple.includes("{%")) return simple;
    if (!this._hass?.callApi) return simple;
    // When in array mode the HA template engine won't know about the chosen
    // activity member, so we substitute known {{ entity }} / {{ state_attr(entity, ...) }}
    // patterns before sending to the API (the client-side pass already did this
    // for fully resolvable expressions).
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

  _buildRenderKey(primary, secondary, icon) {
    const activity = this._chosenActivity();
    const state = this._entityState();
    const attrs = state?.attributes || {};
    const polylineKey = activity
      ? activity[this._config.polyline_attribute || "polyline"] || ""
      : this._config.polyline_attribute
        ? attrs[this._config.polyline_attribute]
        : state?.state;
    return [
      this._config?.entity,
      polylineKey,
      primary,
      secondary,
      icon,
      this._config?.show_map,
      this._fgColor(),
      this._config?.bg_color,
      this._config?.zoom,
    ].join("~");
  }

  // ─── main render ──────────────────────────────────────────────────────────

  _render(primary, secondary, icon) {
    const color = this._fgColor();
    const polylineStr = this._polylineString();
    const coords = this._decodePolyline(polylineStr);
    const showMap = this._config.show_map !== false;
    const iconStr = typeof icon === "string" ? icon.trim() : "";
    const title = this._config.title;
    const headerAttr = (title !== undefined && title !== "") ? ` header="${title}"` : "";

    // Card background
    const noBg = !showMap && !this._config.bg_color;
    const cardStyle = noBg
      ? "background:transparent;box-shadow:none;border:none;"
      : this._config.bg_color
        ? `background:${this._config.bg_color};`
        : "";

    // Icon markup
    const iconHtml = iconStr
      ? `<div style="display:flex;justify-content:center;align-items:center;margin-bottom:8px;">
           <ha-icon icon="${iconStr}" style="--mdi-icon-size:32px;color:${color};"></ha-icon>
         </div>`
      : "";

    // Primary / secondary text
    const primaryHtml = primary
      ? `<div style="font-size:22px;font-weight:800;color:${color};text-align:center;line-height:1.2;margin-bottom:2px;">${primary}</div>`
      : "";
    const secondaryHtml = secondary
      ? `<div style="font-size:14px;font-weight:600;color:${color};text-align:center;opacity:0.75;line-height:1.2;">${secondary}</div>`
      : "";

    const textBlock = (primaryHtml || secondaryHtml)
      ? `<div style="padding:10px 12px 0;display:flex;flex-direction:column;align-items:center;gap:2px;">
           ${iconHtml}${primaryHtml}${secondaryHtml}
         </div>`
      : iconHtml
        ? `<div style="padding:10px 12px 0;">${iconHtml}</div>`
        : "";

    // Build SVG route overlay
    const svgRoute = this._buildRouteSvg(coords, color);

    // Map wrapper
    const mapContainerId = `rh-map-${this._config.entity.replace(/[^a-z0-9]/gi, "_")}`;
    const mapHtml = `
      <div style="position:relative;width:100%;padding-bottom:75%;overflow:hidden;border-radius:${noBg ? "0" : "var(--ha-card-border-radius,12px)"};">
        ${showMap ? `<canvas id="${mapContainerId}" style="position:absolute;top:0;left:0;width:100%;height:100%;"></canvas>` : ""}
        <svg id="${mapContainerId}-svg"
          viewBox="0 0 1000 750" preserveAspectRatio="xMidYMid meet"
          style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;">
          ${svgRoute}
        </svg>
      </div>`;

    this.innerHTML = `
      <ha-card${headerAttr} style="${cardStyle}">
        ${textBlock}
        ${mapHtml}
      </ha-card>
    `;

    // Draw tile map if needed
    if (showMap && coords.length >= 2) {
      this._scheduleMapDraw(coords, mapContainerId);
    }
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

  _scheduleMapDraw(coords, containerId) {
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      this._drawMap(coords, containerId);
    });
  }

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
