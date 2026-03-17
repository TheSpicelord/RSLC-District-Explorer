import {
  AUTO_SHAPE_URLS,
  BASE_WHEEL_PX_PER_ZOOM_LEVEL,
  BASE_ZOOM_SNAP,
  CHAMBER_INDEX_URLS,
  COUNTY_LABEL_MIN_ZOOM,
  CTRL_FINE_ZOOM_SNAP,
  CTRL_WHEEL_ZOOM_SLOW_FACTOR,
  MAP_VIEW_TYPE_PRIORITY,
  NATIONAL_CENTER,
  NATIONAL_ZOOM,
  OVERSEAS_TERRITORY_ABBR,
  OVERSEAS_TERRITORY_FIPS,
  STATE_NAME_TO_ABBR,
  TARGET_DISTRICTS_JSON_URLS,
  WORKBOOK_URLS,
  XLSX_CDN_URL,
} from "./modules/config.js";
import {
  countyOverlayToggle,
  details,
  detailsTitle,
  exitStateBtn,
  houseChamberBtn,
  mapViewButtons,
  projectionBaseLegBtn,
  projectionBasePresBtn,
  projectionControls,
  projectionShiftSlider,
  projectionShiftValue,
  projectionToggleBtn,
  senateChamberBtn,
  sidebarEl,
  stateSelect,
  statusText,
  targetDistrictsToggle,
  upIn2026Toggle,
} from "./modules/dom.js";
import { state } from "./modules/state.js";

const projectionRangeDem = document.getElementById("projectionRangeDem");
const projectionRangeRep = document.getElementById("projectionRangeRep");
const projectionZeroLabel = document.getElementById("projectionZeroLabel");
const projectionSliderTicks = document.getElementById("projectionSliderTicks");
const projectionSliderShell = document.querySelector(".projection-slider-shell");
const projectionShiftBox = document.querySelector(".projection-shift-box");
const projectionShiftCaption = document.querySelector(".projection-shift-caption");
const projectionSliderFill = document.getElementById("projectionSliderFill");
const projectionSliderThumb = document.getElementById("projectionSliderThumb");

const MODEL_VIEW_META = {
  model_hrcc_hm: { label: "HRCC (H+M)", order: 0, tableTop: "HRCC", tableBottom: "H+M" },
  model_hrcc_all: { label: "HRCC (All)", order: 1, tableTop: "HRCC", tableBottom: "All" },
  model_rslc_hm: { label: "RSLC (H+M)", order: 2, tableTop: "RSLC", tableBottom: "H+M" },
  model_rslc_all: { label: "RSLC (All)", order: 3, tableTop: "RSLC", tableBottom: "All" },
};

const MODEL_SEGMENT_COLOR_CLASSES = {
  HRCC: [
    "color-model-gop-base",
    "color-model-gop-target",
    "color-model-swing",
    "color-model-dem-likely",
    "color-model-dem-base",
  ],
  RSLC: [
    "color-model-rslc-1",
    "color-model-rslc-2",
    "color-model-rslc-3",
    "color-model-rslc-4",
    "color-model-rslc-5",
    "color-model-rslc-6",
    "color-model-rslc-7",
    "color-model-rslc-8",
    "color-model-rslc-9",
  ],
};

const BUILD_VERSION = "20260316a";

function withCacheBust(url) {
  const text = String(url || "").trim();
  if (!text) return text;
  return text.includes("?") ? `${text}&v=${BUILD_VERSION}` : `${text}?v=${BUILD_VERSION}`;
}

let projectionSliderDragging = false;
const PROJECTION_RAIL_INSET_PX = 1;

const map = L.map("map").setView(NATIONAL_CENTER, NATIONAL_ZOOM);
map.boxZoom.disable();
map.options.wheelPxPerZoomLevel = BASE_WHEEL_PX_PER_ZOOM_LEVEL;
map.options.zoomSnap = BASE_ZOOM_SNAP;
map.options.zoomDelta = BASE_ZOOM_SNAP;

map.createPane("statePane");
map.getPane("statePane").style.zIndex = 330;
map.createPane("districtPane");
map.getPane("districtPane").style.zIndex = 420;
map.createPane("floterialPane");
map.getPane("floterialPane").style.zIndex = 430;
map.createPane("countyPane");
map.getPane("countyPane").style.zIndex = 440;
map.createPane("countyLabelPane");
map.getPane("countyLabelPane").style.zIndex = 450;
map.createPane("placeLabelPane");
map.getPane("placeLabelPane").style.zIndex = 460;
map.getPane("placeLabelPane").style.pointerEvents = "none";
map.createPane("districtHoverPane");
map.getPane("districtHoverPane").style.zIndex = 455;
map.createPane("stateHoverPane");
map.getPane("stateHoverPane").style.zIndex = 454;
map.createPane("districtNumberPane");
map.getPane("districtNumberPane").style.zIndex = 452;

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
  maxZoom: 18,
  subdomains: "abcd",
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
}).addTo(map);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", {
  pane: "placeLabelPane",
  maxZoom: 18,
  minZoom: 13,
  subdomains: "abcd",
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  interactive: false,
}).addTo(map);

init().catch((err) => {
  console.error(err);
  setStatus(`Startup error: ${err.message}`);
});

async function init() {
  wireEvents();
  initHoverInfo();
  initChamberOverviewButton();

  detailsTitle.textContent = "National Overview";
  setDetailsLoading("Loading national overview table...");
  resetSidebarScroll();

  const targetsPromise = loadTargetDistricts();
  const chamberNamesPromise = loadChamberNamesFromWorkbook();
  await Promise.all([loadAllChamberData(), autoLoadStateShapes()]);
  enterNationalView();

  chamberNamesPromise
    .then((nameMap) => {
      if (nameMap instanceof Map) {
        state.chamberNamesByState = nameMap;
      }
      if (state.mode === "state" && state.selectedState && !state.selectedDistrictLayer) {
        showStateChamberOverview();
      }
    })
    .catch((_err) => {
      // Keep app responsive if chamber names fail.
    });

  targetsPromise
    .then((targets) => {
      state.targetDistricts = targets;
      if (state.mode === "state" && state.selectedState && !state.selectedDistrictLayer) {
        refreshTargetJoinKeySet();
        showStateChamberOverview();
      }
    })
    .catch((_err) => {
      // Keep app responsive if target data fails.
    });
}
async function loadAllChamberData() {
  const index = await loadChamberIndex();
  if (index) {
    const [houseRows, senateRows] = await Promise.all([
      Promise.all(index.house.map((url) => fetchJsonArray(url))),
      Promise.all(index.senate.map((url) => fetchJsonArray(url))),
    ]);
    state.dataByChamber.house = buildDataMap(houseRows.flat());
    state.dataByChamber.senate = buildDataMap(senateRows.flat());
    buildAvailableMapViewsIndex();
    return;
  }

  const [miHouseData, miSenateData, mnHouseData, mnSenateData, wiHouseData, wiSenateData, paHouseData, paSenateData] = await Promise.all([
    fetchJsonArray("data/michigan_house.json"),
    fetchJsonArray("data/michigan_senate.json"),
    fetchJsonArray("data/minnesota_house.json"),
    fetchJsonArray("data/minnesota_senate.json"),
    fetchJsonArray("data/wi_house.json"),
    fetchJsonArray("data/wi_senate.json"),
    fetchJsonArray("data/pa_house.json"),
    fetchJsonArray("data/pa_senate.json"),
  ]);
  state.dataByChamber.house = buildDataMap([...(miHouseData || []), ...(mnHouseData || []), ...(wiHouseData || []), ...(paHouseData || [])]);
  state.dataByChamber.senate = buildDataMap([...(miSenateData || []), ...(mnSenateData || []), ...(wiSenateData || []), ...(paSenateData || [])]);
  buildAvailableMapViewsIndex();
}

async function loadChamberIndex() {
  for (const url of CHAMBER_INDEX_URLS) {
    try {
      const response = await fetch(withCacheBust(url));
      if (!response.ok) continue;
      const parsed = await response.json();
      const normalized = normalizeChamberIndex(parsed);
      if (normalized) return normalized;
    } catch (_err) {
      // Try next source.
    }
  }
  return null;
}

function normalizeChamberIndex(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  const normalizeSide = (value) => {
    if (!Array.isArray(value)) return [];
    const urls = [];
    for (const item of value) {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed) urls.push(trimmed);
        continue;
      }
      if (item && typeof item === "object") {
        const url = String(item.url || item.file || "").trim();
        if (url) urls.push(url);
      }
    }
    return Array.from(new Set(urls));
  };

  const house = normalizeSide(parsed.house);
  const senate = normalizeSide(parsed.senate);
  if (!house.length && !senate.length) return null;
  return { house, senate };
}

async function fetchJsonArray(url) {
  try {
    const response = await fetch(withCacheBust(url));
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (_err) {
    return [];
  }
}

function wireEvents() {
  houseChamberBtn.addEventListener("click", async () => {
    await setChamber("house");
  });

  senateChamberBtn.addEventListener("click", async () => {
    await setChamber("senate");
  });

  countyOverlayToggle.addEventListener("change", async (e) => {
    state.countyVisible = e.target.checked;
    await updateCountyOverlayVisibility();
  });

  targetDistrictsToggle.addEventListener("change", async (e) => {
    await setTargetDistrictsMode(e.target.checked);
  });

  if (upIn2026Toggle) {
    upIn2026Toggle.addEventListener("change", async (e) => {
      await setUpIn2026Mode(e.target.checked);
    });
  }

  if (projectionToggleBtn) {
    projectionToggleBtn.addEventListener("click", async () => {
      await setProjectionMode(!state.projectionMode);
    });
  }

  if (projectionBaseLegBtn) {
    projectionBaseLegBtn.addEventListener("click", async () => {
      await setProjectionBaseView("latest_leg");
    });
  }

  if (projectionBasePresBtn) {
    projectionBasePresBtn.addEventListener("click", async () => {
      await setProjectionBaseView("pres_2024");
    });
  }

  if (projectionShiftSlider) {
    projectionShiftSlider.addEventListener("pointerdown", async (e) => {
      if (!state.projectionMode) return;
      projectionSliderDragging = true;
      if (typeof projectionShiftSlider.setPointerCapture === "function") {
        projectionShiftSlider.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
      await setProjectionShift(projectionShiftFromClientX(e.clientX));
    });

    projectionShiftSlider.addEventListener("pointermove", async (e) => {
      if (!projectionSliderDragging || !state.projectionMode) return;
      e.preventDefault();
      await setProjectionShift(projectionShiftFromClientX(e.clientX));
    });

    const stopProjectionSliderDrag = (e) => {
      projectionSliderDragging = false;
      if (projectionShiftSlider && typeof projectionShiftSlider.releasePointerCapture === "function") {
        try {
          projectionShiftSlider.releasePointerCapture(e.pointerId);
        } catch {}
      }
    };

    projectionShiftSlider.addEventListener("pointerup", stopProjectionSliderDrag);
    projectionShiftSlider.addEventListener("pointercancel", stopProjectionSliderDrag);
    projectionShiftSlider.addEventListener("lostpointercapture", () => {
      projectionSliderDragging = false;
    });

    projectionShiftSlider.addEventListener("keydown", async (e) => {
      if (!state.projectionMode) return;
      const current = Number(state.projectionShift || 0);
      const { min, max } = projectionShiftBounds();
      let next = null;
      if (e.key === "ArrowLeft") next = current + 1;
      if (e.key === "ArrowRight") next = current - 1;
      if (e.key === "Home") next = max;
      if (e.key === "End") next = min;
      if (e.key === "PageUp") next = current + 5;
      if (e.key === "PageDown") next = current - 5;
      if (next === null) return;
      e.preventDefault();
      await setProjectionShift(Math.max(min, Math.min(max, next)));
    });
  }

  stateSelect.addEventListener("change", async (e) => {
    const key = String(e.target.value || "").trim();
    if (!key) return;
    await selectStateByKey(key);
  });

  exitStateBtn.addEventListener("click", () => {
    enterNationalView();
  });

  document.addEventListener("keydown", async (e) => {
    if (isEditableTarget(e.target)) return;
    if (e.key === "Control") {
      applyFineZoomMode(true);
    }
    if (state.mode !== "state") return;

    if (e.key === "Escape") {
      if (state.hasOpenPopup) {
        map.closePopup();
        return;
      }

      if (state.selectedDistrictLayer) {
        clearSelectedDistrict();
        showStateChamberOverview();
        return;
      }

      enterNationalView();
      return;
    }

    if (e.key === "Shift" && e.location === 1 && !e.repeat) {
      const nextChamber = state.chamber === "house" ? "senate" : "house";
      await setChamber(nextChamber);
      return;
    }

    if (!/^[1-9]$/.test(e.key)) return;
    const idx = Number(e.key) - 1;
    const views = displayedMapViews();
    if (idx < 0 || idx >= views.length) return;
    e.preventDefault();
    await setMapView(views[idx]);
  });

  document.addEventListener("keyup", (e) => {
    if (e.key === "Control") {
      applyFineZoomMode(false);
    }
  });

  window.addEventListener("blur", () => {
    applyFineZoomMode(false);
  });

  window.addEventListener("resize", () => {
    renderProjectionUi();
  });

  map.getContainer().addEventListener(
    "wheel",
    (e) => {
      // Apply before Leaflet's wheel handler runs so ctrl+wheel uses finer zoom increments.
      applyFineZoomMode(e.ctrlKey);
      if (e.ctrlKey) {
        e.preventDefault();
      }
    },
    { capture: true, passive: false }
  );

  map.on("zoomend", () => {
    refreshCountyLabels();
    refreshDistrictNumberLabels();
  });

  map.on("popupopen", () => {
    state.hasOpenPopup = true;
  });

  map.on("popupclose", () => {
    state.hasOpenPopup = false;
    if (state.suspendPopupCloseOverview) return;
    clearSelectedDistrict();
    if (state.mode === "state") {
      showStateChamberOverview();
    }
  });
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.closest("[contenteditable='true']") !== null;
}

function applyFineZoomMode(enabled) {
  if (enabled) {
    map.options.wheelPxPerZoomLevel = BASE_WHEEL_PX_PER_ZOOM_LEVEL * CTRL_WHEEL_ZOOM_SLOW_FACTOR;
    map.options.zoomSnap = CTRL_FINE_ZOOM_SNAP;
    map.options.zoomDelta = CTRL_FINE_ZOOM_SNAP;
    return;
  }
  map.options.wheelPxPerZoomLevel = BASE_WHEEL_PX_PER_ZOOM_LEVEL;
  map.options.zoomSnap = BASE_ZOOM_SNAP;
  map.options.zoomDelta = BASE_ZOOM_SNAP;
}

async function autoLoadStateShapes() {
  setStatus("Loading state boundaries...");
  const statesGeojson = await loadUrlZipToGeojson(AUTO_SHAPE_URLS.states);
  if (!statesGeojson) {
    setStatus("Missing data/shapes/states.zip.");
    return;
  }

  const filtered = {
    type: "FeatureCollection",
    features: (statesGeojson.features || []).filter((feature) => {
      const meta = stateMetaFromFeature(feature);
      return !isDistrictOfColumbia(meta) && !isOverseasTerritory(meta);
    }),
  };

  state.statesGeojson = filtered;
  buildStateLayer(filtered);
  populateStateSelect(filtered);
  setStatus("State boundaries loaded. Select a state to view districts.");
}

function buildStateLayer(geojson) {
  if (state.statesLayer && map.hasLayer(state.statesLayer)) {
    map.removeLayer(state.statesLayer);
  }
  state.stateBoundsByKey = new Map();
  state.stateLayerByKey = new Map();
  state.hoveredStateLayer = null;

  state.statesLayer = L.geoJSON(geojson, {
    pane: "statePane",
    style: (feature) => stateBoundaryStyle(feature),
    onEachFeature: (feature, layer) => {
      const meta = stateMetaFromFeature(feature);
      if (!meta.key) return;
      layer.__featureRef = feature;
      state.stateLayerByKey.set(meta.key, layer);
      const bounds = layer.getBounds();
      if (bounds?.isValid?.()) {
        state.stateBoundsByKey.set(meta.key, bounds);
      }

      layer.on("mouseover", () => {
        setHoveredStateKey(meta.key);
      });
      layer.on("mouseout", () => {
        if (state.hoveredStateKey === meta.key) {
          setHoveredStateKey(null);
        }
      });
      layer.on("click", async () => {
        await selectStateByMeta(meta, feature, { shouldZoom: true, bounds });
      });
    },
  });

  if (!map.hasLayer(state.statesLayer)) {
    map.addLayer(state.statesLayer);
  }
}

function populateStateSelect(geojson) {
  const items = [];
  const seen = new Set();
  state.statesByKey = new Map();
  for (const feature of geojson.features || []) {
    const meta = stateMetaFromFeature(feature);
    if (!meta.key || seen.has(meta.key)) continue;
    seen.add(meta.key);
    items.push(meta);
    state.statesByKey.set(meta.key, { meta, feature });
  }

  items.sort((a, b) => String(a.name || a.abbr || a.key).localeCompare(String(b.name || b.abbr || b.key)));

  stateSelect.innerHTML = '<option value="">Select State...</option>';
  for (const meta of items) {
    const option = document.createElement("option");
    option.value = meta.key;
    const parts = [meta.name || meta.abbr || meta.fips || meta.key];
    if (meta.abbr && meta.name && meta.abbr !== meta.name) parts.push(`(${meta.abbr})`);
    option.textContent = parts.join(" ");
    stateSelect.appendChild(option);
  }
}

function stateMetaFromFeature(feature) {
  const properties = feature?.properties || {};
  const fips = stateFipsFromProperties(properties);
  const abbr = normalizeStateAbbr(readProperty(properties, "STUSPS") || readProperty(properties, "USPS") || readProperty(properties, "STATE_ABBR"));
  const name = String(readProperty(properties, "NAME") || readProperty(properties, "STATE_NAME") || readProperty(properties, "NAMELSAD") || "").trim();
  const key = fips || abbr || normalizeTextKey(name);
  return { key, fips, abbr, name };
}

function isDistrictOfColumbia(meta) {
  if (!meta) return false;
  const name = String(meta.name || "").trim().toUpperCase();
  return meta.fips === "11" || meta.abbr === "DC" || name === "DISTRICT OF COLUMBIA";
}

function isOverseasTerritory(meta) {
  if (!meta) return false;
  const fips = normalizeStateFips(meta.fips);
  const abbr = normalizeStateAbbr(meta.abbr);
  return OVERSEAS_TERRITORY_FIPS.has(fips) || OVERSEAS_TERRITORY_ABBR.has(abbr);
}

function normalizeTextKey(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
}

function normalizeStateAbbr(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
}

function stateFipsFromProperties(properties = {}) {
  return normalizeStateFips(
    readProperty(properties, "STATEFP")
      || readProperty(properties, "STATE_FIPS")
      || readProperty(properties, "GEOID")
      || readProperty(properties, "FIPS")
      || readProperty(properties, "STATE")
  );
}

async function selectStateByKey(key) {
  if (!state.statesGeojson) return;
  const target = String(key || "").trim();
  if (!target) return;

  const entry = state.statesByKey.get(target);
  if (!entry) return;
  await selectStateByMeta(entry.meta, entry.feature, { shouldZoom: true, bounds: state.stateBoundsByKey.get(target) || null });
}

async function selectStateByMeta(meta, feature, options = {}) {
  const { shouldZoom = state.mode === "national", bounds = null } = options;
  state.mode = "state";
  state.selectedState = meta;
  setHoveredStateRow(null);
  setHoveredStateKey(null);
  clearStateHoverOutline();
  refreshTargetJoinKeySet();
  state.availableMapViews = availableMapViewsForState(meta);
  state.mapView = pickMapView(state.availableMapViews, state.mapView);
  stateSelect.value = meta.key;
  detailsTitle.textContent = selectedStateChamberHeader();
  renderMapViewButtons();

  if (state.statesLayer && !map.hasLayer(state.statesLayer)) {
    map.addLayer(state.statesLayer);
  }

  const featureBounds = bounds && bounds.isValid && bounds.isValid() ? bounds : geometryBounds(feature?.geometry);
  if (shouldZoom) {
    focusOnState(meta, featureBounds);
  }

  await ensureDistrictShapesLoaded();
  renderDistrictLayerForSelectedState();
  await updateCountyOverlayVisibility();
  refreshStateBoundaryStyles();
  renderModeUi();
  setStatus(`Viewing ${meta.name || meta.abbr || meta.key} ${capitalize(state.chamber)} districts.`);
}

function focusOnState(meta, bounds) {
  const abbr = normalizeStateAbbr(meta?.abbr || "");
  if (abbr === "AK") {
    map.setView([64.8, -150.0], 4, { animate: false });
    return;
  }
  if (bounds && bounds.isValid && bounds.isValid()) {
    map.fitBounds(bounds.pad(0.1), { animate: false });
  }
}

function enterNationalView() {
  state.mode = "national";
  state.selectedState = null;
  state.targetJoinKeySet = new Set();
  state.availableMapViews = [];
  stateSelect.value = "";
  renderMapViewButtons();
  clearDistrictLayer();
  clearCountyLayers();
  if (state.statesLayer && !map.hasLayer(state.statesLayer)) {
    map.addLayer(state.statesLayer);
  }
  refreshStateBoundaryStyles();

  map.setView(NATIONAL_CENTER, NATIONAL_ZOOM);
  state.detailsRenderToken += 1;
  const renderToken = state.detailsRenderToken;
  detailsTitle.textContent = "National Overview";
  setDetailsLoading("Loading national overview table...");
  resetSidebarScroll();
  requestAnimationFrame(() => {
    if (state.mode !== "national" || renderToken !== state.detailsRenderToken) return;
    details.innerHTML = nationalOverviewHtml();
    wireDetailsInteractions();
    resetSidebarScroll();
  });
  renderModeUi();
  setStatus("National overview. Select a state to view districts.");
}
function renderModeUi() {
  const inState = state.mode === "state";
  houseChamberBtn.disabled = !inState;
  senateChamberBtn.disabled = !inState;
  countyOverlayToggle.disabled = !inState;
  targetDistrictsToggle.disabled = !inState;
  syncTargetModeUi();
  syncUpIn2026Ui();
  renderProjectionUi();
  exitStateBtn.hidden = !inState;
  houseChamberBtn.classList.toggle("active-chamber", state.chamber === "house");
  senateChamberBtn.classList.toggle("active-chamber", state.chamber === "senate");
  setMapViewButtonsDisabled(!inState);
}

function setMapViewButtonsDisabled(disabled) {
  if (!mapViewButtons) return;
  const buttons = mapViewButtons.querySelectorAll("button");
  for (const button of buttons) {
    button.disabled = disabled;
  }
}

function projectionShiftBounds() {
  const min = Number(projectionShiftSlider?.getAttribute?.("aria-valuemin") ?? -5);
  const max = Number(projectionShiftSlider?.getAttribute?.("aria-valuemax") ?? 25);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return { min: -5, max: 25 };
  }
  return { min, max };
}

function projectionShiftFromClientX(clientX) {
  if (!projectionSliderAxis) return 0;
  const rect = projectionSliderAxis.getBoundingClientRect();
  if (!rect || rect.width <= 0) return Number(state.projectionShift || 0);
  const { min, max } = projectionShiftBounds();
  const clampedX = Math.max(rect.left, Math.min(rect.right, clientX));
  const ratio = (clampedX - rect.left) / rect.width;
  const value = max - ratio * (max - min);
  return Math.round(value);
}

function projectionVisualRatio(value) {
  const { min, max } = projectionShiftBounds();
  const clamped = Math.max(min, Math.min(max, Number(value) || 0));
  return (max - clamped) / (max - min);
}

function renderProjectionScale() {
  const { min, max } = projectionShiftBounds();
  const zeroRatio = projectionVisualRatio(0);
  const zeroPercent = `${(zeroRatio * 100).toFixed(4)}%`;

  if (projectionRangeDem) {
    projectionRangeDem.textContent = max > 0 ? `D+${Math.round(max)}` : '0';
  }
  if (projectionRangeRep) {
    projectionRangeRep.textContent = min < 0 ? `R+${Math.abs(Math.round(min))}` : '0';
  }
  if (projectionZeroLabel) {
    projectionZeroLabel.textContent = '0';
  }
  if (projectionSliderShell) {
    projectionSliderShell.style.setProperty('--projection-zero-ratio', String(zeroRatio));
    projectionSliderShell.style.setProperty('--projection-zero-percent', zeroPercent);
  }
  if (projectionSliderTicks) {
    const ticks = [];
    for (let value = Math.round(max); value >= Math.round(min); value -= 1) {
      const classes = ['projection-tick'];
      if (value === 0) {
        classes.push('projection-tick-zero');
      } else {
        classes.push(value % 5 === 0 ? 'projection-tick-major' : 'projection-tick-minor');
        classes.push(value > 0 ? 'projection-tick-dem' : 'projection-tick-rep');
      }
      const ratio = projectionVisualRatio(value);
      ticks.push(`<span class="${classes.join(' ')}" style="left:${(ratio * 100).toFixed(4)}%"></span>`);
    }
    projectionSliderTicks.innerHTML = ticks.join('');
  }
}


function renderProjectionUi() {
  const inState = state.mode === "state";
  const active = inState && !!state.projectionMode;
  const { min, max } = projectionShiftBounds();
  const clampedShift = Math.max(min, Math.min(max, Number(state.projectionShift || 0)));
  const accent = projectionShiftAccentColor(clampedShift);

  if (clampedShift !== Number(state.projectionShift || 0)) {
    state.projectionShift = clampedShift;
  }

  renderProjectionScale();

  document.body.classList.toggle("projection-active", active);
  if (sidebarEl) {
    sidebarEl.classList.toggle("projection-active-sidebar", active);
    sidebarEl.style.setProperty("--projection-accent", accent);
  }
  if (detailsTitle) {
    detailsTitle.classList.toggle("projection-active-title", active);
  }

  if (projectionControls) {
    projectionControls.hidden = !inState;
    projectionControls.style.setProperty("--projection-accent", accent);
  }
  if (projectionToggleBtn) {
    projectionToggleBtn.disabled = !inState;
    projectionToggleBtn.classList.toggle("active-projection", active);
  }
  if (projectionBaseLegBtn) {
    projectionBaseLegBtn.disabled = !active;
    projectionBaseLegBtn.classList.toggle("active-projection-base", state.projectionBaseView === "latest_leg");
  }
  if (projectionBasePresBtn) {
    projectionBasePresBtn.disabled = !active;
    projectionBasePresBtn.classList.toggle("active-projection-base", state.projectionBaseView === "pres_2024");
  }
  if (projectionShiftSlider) {
    const ratio = projectionVisualRatio(clampedShift);
    projectionShiftSlider.classList.toggle("projection-shift-slider-disabled", !active);
    projectionShiftSlider.setAttribute("aria-disabled", active ? "false" : "true");
    projectionShiftSlider.setAttribute("aria-valuenow", String(clampedShift));
    projectionShiftSlider.setAttribute("aria-valuetext", active ? projectionShiftLabel(clampedShift) : "Off");
    projectionShiftSlider.style.setProperty("--projection-accent", accent);
    projectionShiftSlider.style.setProperty("--projection-thumb-ratio", String(ratio));
    if (projectionSliderAxis) {
      projectionSliderAxis.style.setProperty("--projection-accent", accent);
      projectionSliderAxis.style.setProperty("--projection-thumb-ratio", String(ratio));
    }
    if (projectionSliderFill) {
      projectionSliderFill.style.setProperty("--projection-thumb-ratio", String(ratio));
    }
    if (projectionSliderThumb) {
      projectionSliderThumb.style.setProperty("--projection-accent", accent);
      projectionSliderThumb.style.setProperty("--projection-thumb-ratio", String(ratio));
    }
  }
  if (projectionShiftBox) {
    projectionShiftBox.classList.toggle("projection-shift-box-inactive", !active);
  }
  if (projectionShiftValue) {
    projectionShiftValue.textContent = active ? projectionShiftLabel(state.projectionShift) : "Off";
    projectionShiftValue.style.color = active ? accent : "#c2cbd5";
  }
  if (projectionShiftCaption) {
    projectionShiftCaption.textContent = active ? "Shift" : "";
  }
  if (upIn2026Toggle) {
    upIn2026Toggle.checked = active ? true : !!state.upIn2026Mode;
    upIn2026Toggle.disabled = !inState || active;
  }
}

function projectionShiftAccentColor(shift) {
  const amount = Number(shift || 0);
  const { min, max } = projectionShiftBounds();
  if (Math.abs(amount) < 0.0001) return "#d5dae0";
  if (amount > 0) {
    const positiveMax = Math.max(1, max);
    return interpolateHex("#cfe2ff", "#257BF8", Math.min(amount, positiveMax) / positiveMax);
  }
  const negativeMax = Math.max(1, Math.abs(min));
  return interpolateHex("#ffd4dc", "#F82644", Math.min(Math.abs(amount), negativeMax) / negativeMax);
}

function projectionShiftLabel(shift) {
  const amount = Number(shift || 0);
  if (Math.abs(amount) < 0.0001) return "EVEN";
  if (amount > 0) return `D+${Math.abs(amount).toFixed(0)}`;
  return `R+${Math.abs(amount).toFixed(0)}`;
}

function projectionBaseViewKey() {
  return state.projectionBaseView === "pres_2024" ? "pres_2024" : "latest_leg";
}

function projectionBaseHeaderLines() {
  if (projectionBaseViewKey() === "pres_2024") {
    return { top: "2024", bottom: "Pres" };
  }
  return { top: "Latest", bottom: "Leg" };
}

function projectionBaseDisplayLabel(rec) {
  if (projectionBaseViewKey() === "pres_2024") return "2024 Pres";
  return latestLegDisplayLabel(rec);
}

function recordIsUpIn2026(rec) {
  return Number(rec?.next_election) === 2026;
}

function projectionBaseMarginForRecord(rec) {
  return getMarginForView(rec, projectionBaseViewKey());
}

function projectedMarginForRecord(rec) {
  if (!recordIsUpIn2026(rec)) return null;
  const base = projectionBaseMarginForRecord(rec);
  if (typeof base !== "number") return null;
  return base + Number(state.projectionShift || 0);
}

function projectedSeatCategory(rec, member) {
  const projected = projectedMarginForRecord(rec);
  if (typeof projected !== "number" || Math.abs(projected) < 0.0001) {
    return memberSeatCategory(member);
  }
  return projected > 0 ? "dem" : "rep";
}

async function setProjectionMode(enabled) {
  const next = !!enabled;
  if (state.projectionMode === next) return;

  if (next) {
    state.projectionPreviousUpIn2026Mode = !!state.upIn2026Mode;
    state.projectionMode = true;
    state.upIn2026Mode = true;
  } else {
    state.projectionMode = false;
    state.upIn2026Mode = !!state.projectionPreviousUpIn2026Mode;
  }

  renderModeUi();
  await refreshProjectionPresentation({ rebuildLabels: true });
}

async function setProjectionBaseView(view) {
  const nextView = view === "pres_2024" ? "pres_2024" : "latest_leg";
  if (state.projectionBaseView === nextView) return;
  state.projectionBaseView = nextView;
  renderModeUi();
  await refreshProjectionPresentation({ rebuildLabels: false });
}

async function setProjectionShift(value) {
  const { min, max } = projectionShiftBounds();
  const next = Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
  if (Number(state.projectionShift || 0) === next) {
    renderModeUi();
    return;
  }
  state.projectionShift = next;
  renderModeUi();
  await refreshProjectionPresentation({ rebuildLabels: false });
}

function refreshLayerPopupContent(layer) {
  if (!layer?.__featureRef || !layer.__dataMapRef || !layer.__joinKey) return;
  const rec = layer.__dataMapRef.get(layer.__joinKey);
  const html = popupHtml(layer.__featureRef.properties, extractJoinIds(layer.__featureRef.properties), rec);
  if (typeof layer.setPopupContent === "function") {
    layer.setPopupContent(html);
  }
  const popup = typeof layer.getPopup === "function" ? layer.getPopup() : null;
  if (popup && typeof popup.setContent === "function") {
    popup.setContent(html);
  }
}

async function refreshProjectionPresentation(options = {}) {
  const { rebuildLabels = false } = options;
  if (state.mode !== "state") return;

  if (state.districtLayer) {
    refreshDistrictLayerForActiveFilters({ rebuildLabels });
    state.districtLayer.eachLayer((layer) => {
      refreshLayerPopupContent(layer);
    });
  } else {
    await ensureDistrictShapesLoaded();
    renderDistrictLayerForSelectedState();
    return;
  }

  if (state.selectedDistrictLayer) {
    refreshLayerPopupContent(state.selectedDistrictLayer);
  } else {
    showStateChamberOverview({ resetScroll: false });
  }
}

function buildAvailableMapViewsIndex() {
  const index = new Map();
  const dataMaps = [state.dataByChamber.house, state.dataByChamber.senate];
  for (const dataMap of dataMaps) {
    for (const rec of dataMap.values()) {
      const stateFips = normalizeStateFips(rec?.state_fips);
      if (!stateFips) continue;
      if (!index.has(stateFips)) index.set(stateFips, new Set());
      const viewSet = index.get(stateFips);
      for (const view of mapViewsInRecord(rec)) {
        viewSet.add(view);
      }
    }
  }
  state.availableMapViewsByState = index;
}

function parseModelViewKey(view) {
  const meta = MODEL_VIEW_META[String(view || "").trim()];
  if (!meta) return null;
  return {
    key: String(view),
    label: meta.label,
    order: meta.order,
    tableTop: meta.tableTop,
    tableBottom: meta.tableBottom,
  };
}

function modelVariantFromViewKey(view) {
  const key = String(view || "").trim();
  if (!parseModelViewKey(key)) return null;
  if (key.endsWith("_hm")) return "hm";
  if (key.endsWith("_all")) return "all";
  return null;
}

function availableMapViewsForState(meta) {
  const stateFips = normalizeStateFips(meta?.fips);
  if (!stateFips) return [];
  const found = state.availableMapViewsByState.get(stateFips) || new Set();

  return [...found]
    .filter((view) => !!parseMapViewKey(view) || !!parseModelViewKey(view))
    .sort((a, b) => {
      const aModel = parseModelViewKey(a);
      const bModel = parseModelViewKey(b);
      if (aModel && bModel) return aModel.order - bModel.order;
      if (aModel && !bModel) return 1;
      if (!aModel && bModel) return -1;

      const aParsed = parseMapViewKey(a);
      const bParsed = parseMapViewKey(b);
      if (!aParsed || !bParsed) return String(a).localeCompare(String(b));
      if (aParsed.year !== bParsed.year) return aParsed.year - bParsed.year;
      return (MAP_VIEW_TYPE_PRIORITY[aParsed.type] ?? 99) - (MAP_VIEW_TYPE_PRIORITY[bParsed.type] ?? 99);
    });
}

function displayedMapViews() {
  const views = [...state.availableMapViews];
  const hasLeg = views.some((view) => String(view).startsWith("leg_"));
  if (hasLeg) views.push("latest_leg");
  return views;
}

function mapViewsInRecord(rec) {
  const found = new Set();
  if (!rec) return found;

  for (const election of rec.elections || []) {
    const year = Number(election?.year);
    if (!Number.isFinite(year)) continue;
    if (typeof election?.dem_pct !== "number" || typeof election?.rep_pct !== "number") continue;
    found.add(`leg_${year}`);
  }

  const viewMargins = rec.view_margins || {};
  for (const [key, value] of Object.entries(viewMargins)) {
    if (typeof value !== "number") continue;
    if (parseModelViewKey(key)) {
      found.add(String(key));
      continue;
    }
    const parsed = parseMapViewKey(key);
    if (parsed) found.add(parsed.key);
  }

  for (const [key, value] of Object.entries(rec)) {
    if (typeof value !== "number") continue;
    let match = key.match(/^(leg|gov|pres|ussen)_(\d{4})_margin$/);
    if (match) {
      found.add(`${match[1]}_${match[2]}`);
      continue;
    }
    match = key.match(/^state_leg_(\d{4})_margin$/);
    if (match) {
      found.add(`leg_${match[1]}`);
    }
  }

  return found;
}

function parseMapViewKey(view) {
  const match = String(view || "").match(/^(leg|gov|pres|ussen)_(\d{4})$/);
  if (!match) return null;
  return {
    key: `${match[1]}_${match[2]}`,
    type: match[1],
    year: Number(match[2]),
  };
}

function mapViewButtonLabel(view) {
  if (view === "latest_leg") return "State Leg";
  const model = parseModelViewKey(view);
  if (model) return model.label;
  const parsed = parseMapViewKey(view);
  if (!parsed) return String(view || "");
  if (parsed.type === "leg") return "State Leg";
  if (parsed.type === "gov") return "Governor";
  if (parsed.type === "pres") return "Presidential";
  if (parsed.type === "ussen") return "US Senate";
  return `${parsed.year}`;
}

function mapViewDisplayOrder(view) {
  if (view === "latest_leg") return 0;
  const parsed = parseMapViewKey(view);
  if (!parsed) return 99;
  return ({ pres: 0, ussen: 1, gov: 2, leg: 3 })[parsed.type] ?? 99;
}

function mapViewIsStateLeg(view) {
  if (view === "latest_leg") return true;
  return parseMapViewKey(view)?.type === "leg";
}

function groupedMapViewSections() {
  const shownViews = displayedMapViews();
  const byYear = new Map([
    [2022, []],
    [2023, []],
    [2024, []],
    [2025, []],
  ]);

  for (const view of shownViews) {
    if (view === "latest_leg" || parseModelViewKey(view)) continue;
    const parsed = parseMapViewKey(view);
    if (!parsed || !byYear.has(parsed.year)) continue;
    byYear.get(parsed.year).push(view);
  }

  const sections = [];
  for (const year of [2022, 2023, 2024, 2025]) {
    const views = (byYear.get(year) || []).sort((a, b) => mapViewDisplayOrder(a) - mapViewDisplayOrder(b));
    if (views.length) {
      sections.push({ key: `year-${year}`, title: String(year), type: "views", views });
    }
  }

  if (shownViews.includes("latest_leg")) {
    sections.push({ key: "latest-leg", title: "Latest Leg", type: "views", views: ["latest_leg"] });
  }

  const modelingViews = shownViews
    .filter((view) => !!parseModelViewKey(view))
    .sort((a, b) => (parseModelViewKey(a)?.order ?? 99) - (parseModelViewKey(b)?.order ?? 99));

  if (modelingViews.length) {
    sections.push({ key: "modeling", title: "Modeling", type: "views", views: modelingViews });
  } else {
    sections.push({ key: "modeling", title: "Modeling", type: "placeholder", placeholder: "Coming Soon" });
  }

  return sections;
}

function pickMapView(availableViews, preferredView) {
  const shownViews = [...availableViews];
  if (shownViews.some((view) => String(view).startsWith("leg_"))) shownViews.push("latest_leg");
  if (shownViews.includes(preferredView)) return preferredView;
  if (shownViews.includes("latest_leg")) return "latest_leg";
  if (shownViews.includes("leg_2024")) return "leg_2024";
  if (shownViews.length) return shownViews[0];
  return "latest_leg";
}

function renderMapViewButtons() {
  if (!mapViewButtons) return;
  mapViewButtons.innerHTML = "";

  for (const section of groupedMapViewSections()) {
    const sectionEl = document.createElement("section");
    sectionEl.className = `mapview-group mapview-group-${section.type}`;

    const titleEl = document.createElement("div");
    titleEl.className = "mapview-group-title";
    titleEl.textContent = section.title;
    sectionEl.appendChild(titleEl);

    const bodyEl = document.createElement("div");
    bodyEl.className = "mapview-group-buttons";

    if (section.type === "placeholder") {
      const placeholderEl = document.createElement("div");
      placeholderEl.className = "mapview-placeholder";
      placeholderEl.textContent = section.placeholder;
      bodyEl.appendChild(placeholderEl);
    } else {
      for (const view of section.views) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `mapview-button ${mapViewIsStateLeg(view) ? "mapview-button-state-leg" : ""}`.trim();
        if (view === state.mapView) {
          button.classList.add("active-mapview");
        }
        button.textContent = mapViewButtonLabel(view);
        button.disabled = state.mode !== "state";
        button.addEventListener("click", async () => {
          await setMapView(view);
        });
        bodyEl.appendChild(button);
      }
    }

    sectionEl.appendChild(bodyEl);
    mapViewButtons.appendChild(sectionEl);
  }
}

async function setMapView(view) {
  if (state.mapView === view) return;
  state.mapView = view;
  const modelingVariant = modelVariantFromViewKey(view);
  if (modelingVariant) state.modelingVariant = modelingVariant;
  renderMapViewButtons();
  if (state.mode === "state") {
    if (state.districtLayer) {
      refreshDistrictLayerForMapView();
    } else {
      await ensureDistrictShapesLoaded();
      renderDistrictLayerForSelectedState();
    }
  }
}

function refreshStateBoundaryStyles() {
  if (state.statesLayer) {
    state.statesLayer.setStyle((feature) => stateBoundaryStyle(feature));
    renderHoveredStateOverlay();
  }
}

function stateBoundaryStyle(feature) {
  const meta = stateMetaFromFeature(feature);
  const isSelected = state.mode === "state" && state.selectedState && meta.key === state.selectedState.key;
  if (isSelected) {
    return {
      color: "#2f3c4b",
      weight: 0,
      fillColor: "#b9c6d3",
      fillOpacity: 0,
      opacity: 0,
    };
  }

  return {
    color: "#2f3c4b",
    weight: 1.5,
    opacity: 1,
    fillColor: "#b9c6d3",
    fillOpacity: 0.08,
  };
}

function stateHoverBoundaryStyle(feature) {
  const base = stateBoundaryStyle(feature);
  return {
    ...base,
    color: "#9cb2c7",
    weight: Math.max(3.2, Number(base.weight || 0)),
    opacity: 1,
    fillOpacity: Math.max(0.14, Number(base.fillOpacity || 0)),
  };
}

async function ensureDistrictShapesLoaded() {
  const chamber = state.chamber;
  if (state.geojsonByChamber[chamber]) return;
  setStatus("Loading district shapefiles...");
  state.geojsonByChamber[chamber] = await loadUrlZipToGeojson(AUTO_SHAPE_URLS[chamber]);
  if (state.geojsonByChamber[chamber]) {
    indexDistrictFeaturesByState(chamber, state.geojsonByChamber[chamber]);
  }

  if (chamber === "house" && !state.nhFloterialGeojson) {
    state.nhFloterialGeojson = await loadUrlZipToGeojson(AUTO_SHAPE_URLS.nh_house_floterial);
  }

  // Preload the other chamber in the background to reduce wait on chamber switch.
  const other = chamber === "house" ? "senate" : "house";
  if (!state.geojsonByChamber[other]) {
    loadUrlZipToGeojson(AUTO_SHAPE_URLS[other]).then((geojson) => {
      if (!state.geojsonByChamber[other]) {
        state.geojsonByChamber[other] = geojson;
        if (geojson) indexDistrictFeaturesByState(other, geojson);
      }
    });
  }
}
async function ensureCountyShapeLoaded() {
  if (state.countyGeojson) return;
  setStatus("Loading county boundaries...");
  state.countyGeojson = await loadUrlZipToGeojson(AUTO_SHAPE_URLS.counties);
  if (state.countyGeojson) {
    state.countyFeaturesByState = indexFeaturesByStateFips(state.countyGeojson.features || []);
  }
}

function indexDistrictFeaturesByState(chamber, geojson) {
  const filteredFeatures = (geojson?.features || []).filter((feature) => !isPlaceholderDistrictFeature(feature, chamber));
  const byState = indexFeaturesByStateFips(filteredFeatures);
  state.districtFeaturesByChamberState[chamber] = byState;
}

function isPlaceholderDistrictFeature(feature, chamber = state.chamber) {
  const props = feature?.properties || {};
  const districtField = chamber === "house" ? "SLDLST" : "SLDUST";
  const rawDistrict = String(readProperty(props, districtField) || "").trim().toUpperCase();
  // TIGER legislative shapefiles include non-district placeholders like ZZZ.
  return rawDistrict === "ZZZ";
}

function indexFeaturesByStateFips(features) {
  const byState = new Map();
  for (const feature of features || []) {
    const props = feature?.properties || {};
    const stateFips = normalizeStateFips(readProperty(props, "STATEFP") || readProperty(props, "STATE_FIPS"));
    if (!stateFips) continue;
    if (!byState.has(stateFips)) byState.set(stateFips, []);
    byState.get(stateFips).push(feature);
  }
  return byState;
}

function districtFeaturesForSelectedState(chamber = state.chamber) {
  if (!state.selectedState) return [];
  const stateFips = normalizeStateFips(state.selectedState.fips);
  const index = state.districtFeaturesByChamberState[chamber];
  if (stateFips && index?.has(stateFips)) return index.get(stateFips);

  // Fallback path when index is unavailable.
  const geojson = state.geojsonByChamber[chamber];
  if (!geojson) return [];
  return (geojson.features || []).filter(
    (feature) => featureMatchesSelectedState(feature.properties) && !isPlaceholderDistrictFeature(feature, chamber)
  );
}

function renderDistrictLayerForSelectedState() {
  clearDistrictLayer();
  const selectedAbbrForChamber = normalizeStateAbbr(state.selectedState?.abbr || "");
  if (state.chamber === "house" && selectedAbbrForChamber === "NE") {
    state.detailsRenderToken += 1;
    details.innerHTML = "Switch to Senate to view Nebraska's unicameral legislature.";
    resetSidebarScroll();
    return;
  }

  if (!state.selectedState) return;

  const geojson = state.geojsonByChamber[state.chamber];
  if (!geojson) {
    state.detailsRenderToken += 1;
    details.innerHTML = "District shapefile missing for this chamber.";
    resetSidebarScroll();
    return;
  }

  const dataMap = state.dataByChamber[state.chamber];
  refreshFilteredDistrictJoinKeySet();
  const selectedFeatures = districtFeaturesForSelectedState(state.chamber);
  if (!selectedFeatures.length) {
    const selectedAbbr = normalizeStateAbbr(state.selectedState?.abbr || "");
    state.detailsRenderToken += 1;
    if (state.chamber === "house" && selectedAbbr === "NE") {
      details.innerHTML = "Switch to Senate to view Nebraska's unicameral legislature.";
    } else {
      details.innerHTML = "No districts found for selected state/chamber.";
    }
    resetSidebarScroll();
    return;
  }
  state.currentDistrictFeatures = selectedFeatures;

  state.districtLayer = L.geoJSON(
    {
      type: "FeatureCollection",
      features: selectedFeatures,
    },
    {
      pane: "districtPane",
      style: (feature) => districtBaseStyle(feature, dataMap),
      onEachFeature: (feature, layer) => {
        const joinInfo = extractJoinIds(feature.properties);
        const rec = dataMap.get(joinInfo.key);
        layer.__featureRef = feature;
        layer.__dataMapRef = dataMap;
        layer.__joinKey = joinInfo.key;
        layer.__isFloterial = false;
        state.districtLayerIndex.set(joinInfo.key, layer);
        layer.bindPopup(() => popupHtml(feature.properties, joinInfo, rec));
        layer.on("mouseover", (e) => {
          showDistrictHoverOutline(feature);
          showDistrictHoverInfo(e.containerPoint, popupHtml(feature.properties, joinInfo, rec));
        });
        layer.on("mousemove", (e) => {
          moveDistrictHoverInfo(e.containerPoint);
        });
        layer.on("mouseout", () => {
          clearDistrictHoverOutline();
          hideDistrictHoverInfo();
        });
        layer.on("click", () => {
          clearDistrictHoverOutline();
          hideDistrictHoverInfo();
          setSelectedDistrict(layer);
          showDistrictDetailPanel(feature.properties, joinInfo, rec);
        });
      },
    }
  ).addTo(map);

  renderNhFloterialLayer(dataMap);
  scheduleDistrictNumberLayerBuild(selectedFeatures);
  showStateChamberOverview();
}
function renderNhFloterialLayer(dataMap) {
  clearNhFloterialLayer();
  if (state.chamber !== "house") return;
  const selectedAbbr = normalizeStateAbbr(state.selectedState?.abbr || "");
  if (selectedAbbr !== "NH") return;
  if (!state.nhFloterialGeojson?.features?.length) return;

  const joinByCode = new Map();
  for (const rec of dataMap.values()) {
    if (normalizeStateFips(rec?.state_fips) !== "33") continue;
    const code = nhFloterialCodeFromDistrictName(rec?.district_name);
    if (!code) continue;
    joinByCode.set(code, makeJoinKey("33", rec.district_id));
  }

  state.floterialLayer = L.geoJSON(state.nhFloterialGeojson, {
    pane: "floterialPane",
    interactive: false,
    style: (feature) => districtBaseStyle(feature, dataMap),
    onEachFeature: (feature, layer) => {
      const code = normalizeNhFloterialCode(readProperty(feature?.properties || {}, "floathse22"));
      const joinKey = joinByCode.get(code);
      if (!joinKey) {
        layer.setStyle({ opacity: 0, fillOpacity: 0, weight: 0 });
        return;
      }
      layer.__featureRef = feature;
      layer.__dataMapRef = dataMap;
      layer.__joinKey = joinKey;
      layer.__isFloterial = true;
      state.floterialLayerByJoinKey.set(joinKey, layer);
    },
  }).addTo(map);
}

function clearNhFloterialLayer() {
  if (state.floterialLayer && map.hasLayer(state.floterialLayer)) {
    map.removeLayer(state.floterialLayer);
  }
  state.floterialLayer = null;
  state.floterialLayerByJoinKey = new Map();
}

function normalizeNhFloterialCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function nhFloterialCodeFromDistrictName(name) {
  const text = String(name || "").trim();
  const m = text.match(/^State House District\s+([A-Za-z]+)\s+0*([0-9]+)\s*$/i);
  if (!m) return "";
  return `${String(m[1]).slice(0, 2).toUpperCase()}${Number(m[2])}`;
}

function scheduleDistrictNumberLayerBuild(features) {
  state.districtNumberBuildToken += 1;
  const token = state.districtNumberBuildToken;
  requestAnimationFrame(() => {
    if (token !== state.districtNumberBuildToken) return;
    buildDistrictNumberLayer(features);
  });
}

function resetSidebarScroll() {
  const sidebar = details?.closest?.(".sidebar");
  if (sidebar) sidebar.scrollTop = 0;
}

function setDetailsLoading(message) {
  details.innerHTML = `<div class="loading-indicator">${escapeHtml(message || "Loading...")}</div>`;
}
function selectedStateHeader() {
  if (!state.selectedState) return "National View";
  return state.selectedState.name || state.selectedState.abbr || state.selectedState.key || "State View";
}

function selectedStateChamberHeader() {
  if (!state.selectedState) return "National Overview";
  return chamberOverviewHeaderForState(state.selectedState, state.chamber);
}

function chamberOverviewHeaderForState(meta, chamber) {
  const stateName = meta?.name || meta?.abbr || meta?.key || "State";
  const stateAbbr = normalizeStateAbbr(meta?.abbr || "");
  const key = `${stateAbbr}|${chamber}`;
  const official = state.chamberNamesByState.get(key);
  if (official) {
    const trimmed = String(official).trim();
    if (stateAbbr && stateName) {
      const abbrPattern = new RegExp(`^${stateAbbr}\\b\\s*`, "i");
      if (abbrPattern.test(trimmed)) {
        return trimmed.replace(abbrPattern, `${stateName} `).trim();
      }
    }
    return trimmed;
  }
  return `${stateName} ${capitalize(chamber)}`;
}

function showStateChamberOverview(options = {}) {
  const { resetScroll = true } = options;
  state.detailsRenderToken += 1;
  setHoveredTableRow(null);
  detailsTitle.textContent = selectedStateChamberHeader();
  const composition = chamberCompositionStatsForSelectedState();
  details.innerHTML = stateChamberOverviewHtml(composition);
  if (resetScroll) resetSidebarScroll();
  syncTargetModeUi();
  wireTargetTableInteractions();
}
function stateChamberOverviewHtml(composition) {
  if (!composition) {
    return "State chamber overview.";
  }

  const officialName = chamberOverviewHeaderForState(state.selectedState, state.chamber);
  const targets = targetTablesForSelectedState();
  const allDistrictRows = allDistrictRowsForSelectedState();
  const compositionTitle = state.projectionMode ? "Chamber Composition Projection" : "Chamber Composition";
  return `
    <div class="detail-section">
      <div class="detail-section-title centered-section-title large-section-title">${compositionTitle}</div>
      ${chamberCompositionHtml(composition)}
    </div>
    <div class="detail-section">${targetDistrictsSectionHtml(targets)}</div>
    <div class="detail-section">${allDistrictsSectionHtml(allDistrictRows)}</div>
  `;
}

function nationalOverviewHtml() {
  const rows = nationalOverviewRows();
  const body = rows
    .map((row) => {
      const lower = row.lower;
      const upper = row.upper;
      const lowerMargin = typeof lower.marginDemPct === "number" ? lower.marginDemPct : null;
      const upperMargin = typeof upper.marginDemPct === "number" ? upper.marginDemPct : null;
      return `
        <tr class="target-row state-select-row" data-state-key="${escapeHtml(row.stateKey)}">
          <td class="national-state-cell">${escapeHtml(row.stateName)}</td>
          <td class="national-seat-value national-seat-col">${lower.rep}</td>
          <td class="national-seat-value national-seat-col">${lower.dem}</td>
          <td class="national-seat-value national-seat-col">${lower.other}</td>
          <td class="margin-cell" style="background:${nationalOverviewMarginColor(lowerMargin)}">${escapeHtml(formatSignedRMargin(lowerMargin))}</td>
          <td class="national-gap-cell"></td>
          <td class="national-seat-value national-seat-col">${upper.rep}</td>
          <td class="national-seat-value national-seat-col">${upper.dem}</td>
          <td class="national-seat-value national-seat-col">${upper.other}</td>
          <td class="margin-cell" style="background:${nationalOverviewMarginColor(upperMargin)}">${escapeHtml(formatSignedRMargin(upperMargin))}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="national-overview-wrap">
      <table class="target-table national-overview-table">
        <thead>
          <tr>
            <th class="national-state-top"></th>
            <th colspan="4" class="national-section-head">Lower Chamber</th>
            <th class="national-gap-col" rowspan="2"></th>
            <th colspan="4" class="national-section-head">Upper Chamber</th>
          </tr>
          <tr>
            <th class="national-state-head">State</th>
            <th class="national-sortable national-seat-head" data-sort-key="lower_rep">GOP<br/>Seats${nationalSortIndicator("lower_rep")}</th>
            <th class="national-sortable national-seat-head" data-sort-key="lower_dem">Dem<br/>Seats${nationalSortIndicator("lower_dem")}</th>
            <th class="national-sortable national-seat-head" data-sort-key="lower_other">Ind<br/>Seats${nationalSortIndicator("lower_other")}</th>
            <th class="national-sortable national-margin-head" data-sort-key="lower_margin">MARGIN${nationalSortIndicator("lower_margin")}</th>
            <th class="national-sortable national-seat-head" data-sort-key="upper_rep">GOP<br/>Seats${nationalSortIndicator("upper_rep")}</th>
            <th class="national-sortable national-seat-head" data-sort-key="upper_dem">Dem<br/>Seats${nationalSortIndicator("upper_dem")}</th>
            <th class="national-sortable national-seat-head" data-sort-key="upper_other">Ind<br/>Seats${nationalSortIndicator("upper_other")}</th>
            <th class="national-sortable national-margin-head" data-sort-key="upper_margin">MARGIN${nationalSortIndicator("upper_margin")}</th>
          </tr>
        </thead>
        <tbody>
          ${body}
        </tbody>
      </table>
    </div>
  `;
}

function nationalOverviewRows() {
  const rows = [];
  const seen = new Set();

  for (const { meta } of state.statesByKey.values()) {
    if (!meta?.key || seen.has(meta.key)) continue;
    const stateFips = normalizeStateFips(meta.fips);
    if (!stateFips) continue;
    seen.add(meta.key);

    rows.push({
      stateKey: meta.key,
      stateAbbr: normalizeStateAbbr(meta.abbr || ""),
      stateName: meta.name || meta.abbr || meta.key,
      lower: chamberStatsForStateFips("house", stateFips),
      upper: chamberStatsForStateFips("senate", stateFips),
    });
  }

  rows.sort((a, b) => a.stateName.localeCompare(b.stateName));
  return applyNationalSort(rows);
}

function applyNationalSort(rows) {
  const key = state.nationalSort?.key || null;
  const direction = Number(state.nationalSort?.direction || 0);
  if (!key || direction === 0) return rows;

  const valueFor = (row) => {
    switch (key) {
      case "lower_rep": return Number(row.lower.rep || 0);
      case "lower_dem": return Number(row.lower.dem || 0);
      case "lower_other": return Number(row.lower.other || 0);
      case "lower_margin": return typeof row.lower.marginDemPct === "number" ? -row.lower.marginDemPct : Number.NEGATIVE_INFINITY;
      case "upper_rep": return Number(row.upper.rep || 0);
      case "upper_dem": return Number(row.upper.dem || 0);
      case "upper_other": return Number(row.upper.other || 0);
      case "upper_margin": return typeof row.upper.marginDemPct === "number" ? -row.upper.marginDemPct : Number.NEGATIVE_INFINITY;
      default: return Number.NEGATIVE_INFINITY;
    }
  };

  return [...rows].sort((a, b) => {
    if (key === "lower_margin") {
      const aNeb = a.stateAbbr === "NE";
      const bNeb = b.stateAbbr === "NE";
      if (aNeb && !bNeb) return 1;
      if (!aNeb && bNeb) return -1;
    }

    const av = valueFor(a);
    const bv = valueFor(b);
    if (av === bv) return a.stateName.localeCompare(b.stateName);
    return direction === -1 ? bv - av : av - bv;
  });
}

function nationalSortIndicator(key) {
  if (state.nationalSort?.key !== key || !state.nationalSort?.direction) return "";
  return state.nationalSort.direction === -1 ? " (v)" : " (^)";
}

function toggleNationalSort(key) {
  if (state.nationalSort?.key !== key) {
    state.nationalSort = { key, direction: -1 };
    return;
  }
  if (state.nationalSort.direction === -1) {
    state.nationalSort = { key, direction: 1 };
    return;
  }
  if (state.nationalSort.direction === 1) {
    state.nationalSort = { key: null, direction: 0 };
    return;
  }
  state.nationalSort = { key, direction: -1 };
}

function chamberStatsForStateFips(chamber, stateFips) {
  const dataMap = state.dataByChamber[chamber];
  const counts = { rep: 0, dem: 0, other: 0, vacant: 0 };

  for (const [joinKey, rec] of dataMap.entries()) {
    if (!String(joinKey || "").startsWith(`${stateFips}|`)) continue;
    const members = recordMembers(rec);
    if (!members.length) {
      counts.vacant += 1;
      continue;
    }
    for (const member of members) {
      const category = memberSeatCategory(member);
      counts[category] += 1;
    }
  }

  const total = counts.rep + counts.dem + counts.other + counts.vacant;
  const marginDemPct = total > 0 ? ((counts.dem - counts.rep) / total) * 100 : null;

  return {
    rep: counts.rep,
    dem: counts.dem,
    other: counts.other,
    vacant: counts.vacant,
    total,
    marginDemPct,
  };
}

function chamberCompositionStatsForSelectedState() {
  if (!state.selectedState) return null;

  const dataMap = state.dataByChamber[state.chamber];
  const stateFips = normalizeStateFips(state.selectedState.fips);
  const records = [];

  for (const [key, rec] of dataMap.entries()) {
    if (!key || !stateFips) continue;
    if (!String(key).startsWith(`${stateFips}|`)) continue;
    records.push(rec);
  }

  if (!records.length) return null;

  const before = {
    rep: 0,
    dem: 0,
    other: 0,
    vacant: 0,
  };
  const after = {
    rep: 0,
    dem: 0,
    other: 0,
    vacant: 0,
  };

  for (const rec of records) {
    const members = recordMembers(rec);
    const seatsUp = state.projectionMode && recordIsUpIn2026(rec)
      ? Math.max(0, Math.min(candidateSeatCount(rec), members.length || 0))
      : 0;

    if (!members.length) {
      before.vacant += 1;
      after.vacant += 1;
      continue;
    }

    members.forEach((member, idx) => {
      const currentCategory = memberSeatCategory(member);
      before[currentCategory] += 1;
      if (state.projectionMode && idx < seatsUp) {
        after[projectedSeatCategory(rec, member)] += 1;
      } else {
        after[currentCategory] += 1;
      }
    });
  }

  return {
    before,
    after,
    total: before.rep + before.dem + before.other + before.vacant,
    projectionMode: !!state.projectionMode,
  };
}

function memberSeatCategory(member) {
  const name = String(member?.incumbent?.name || "").trim().toUpperCase();
  if (!name || name === "VACANT" || name === "UNKNOWN" || name === "OPEN") return "vacant";
  const party = String(member?.incumbent?.party || "").trim().toUpperCase();
  if (party === "R") return "rep";
  if (party === "D") return "dem";
  return "other";
}

function chamberCompositionHtml(composition) {
  const before = composition?.before || composition || { rep: 0, dem: 0, other: 0, vacant: 0 };
  const after = composition?.after || before;
  const projectionMode = !!composition?.projectionMode;
  const rows = compositionDotRows(composition.total);
  const majority = chamberMajoritySummary({ ...after, total: composition.total });
  const gainSummary = projectionMode ? projectionGainSummary(before, after) : null;
  const flipCounts = projectionMode ? compositionFlipCounts(before, after) : { rep: 0, dem: 0 };
  return `
    <div class="chamber-composition-scroll">
      <div class="chamber-composition-layout">
        <div class="chamber-dotmap-wrap">
          <div class="chamber-dotmap" style="--dot-rows:${rows}">
            <div class="dot-group-left">${dotMatrixHtml(after.rep, "dot-seat dot-rep", rows, flipCounts.rep)}</div>
            <div class="dot-group-right">
              <div class="dot-major-row">${dotMatrixHtml(after.dem, "dot-seat dot-dem", rows, flipCounts.dem)}</div>
              <div class="dot-minor-row">
                ${dotMatrixHtml(after.other, "dot-seat dot-other", Math.max(1, Math.min(rows, after.other || 1)))}
                ${dotMatrixHtml(after.vacant, "dot-seat dot-vacant", Math.max(1, Math.min(rows, after.vacant || 1)))}
              </div>
            </div>
          </div>
          ${majoritySummaryHtml(majority, gainSummary)}
        </div>
        <div class="chamber-composition-table ${projectionMode ? "projection-legend" : ""}">
          <div class="composition-head">
            <span>Party</span>
            ${projectionMode ? '<span class="composition-head-value">Before</span><span class="composition-head-value">After</span>' : "<span>Seats</span>"}
          </div>
          ${compositionRowHtml("Republican", before.rep, after.rep, "dot-seat dot-rep", projectionMode)}
          ${compositionRowHtml("Democrat", before.dem, after.dem, "dot-seat dot-dem", projectionMode)}
          ${compositionRowHtml("Independent/Other", before.other, after.other, "dot-seat dot-other", projectionMode)}
          ${compositionRowHtml("Vacant", before.vacant, after.vacant, "dot-seat dot-vacant", projectionMode)}
          <div class="composition-total-row">
            <span>Total Seats</span>
            ${projectionMode ? `<strong class="composition-value-before">${composition.total}</strong><strong>${composition.total}</strong>` : `<strong>${composition.total}</strong>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

function chamberMajoritySummary(composition) {
  const rep = Number(composition?.rep || 0);
  const dem = Number(composition?.dem || 0);
  const total = Number(composition?.total || 0);

  if (rep === dem && rep > 0 && rep + dem === total) {
    return { type: "tie" };
  }

  const largestParty = rep >= dem ? "R" : "D";
  const largestSeats = largestParty === "R" ? rep : dem;
  const threshold = Math.floor(total / 2) + 1;
  const majoritySeats = largestSeats - threshold + 1;

  if (majoritySeats > 0) {
    return { type: "majority", party: largestParty, seats: majoritySeats };
  }

  return { type: "none" };
}

function projectionGainSummary(before, after) {
  const repGain = Number(after?.rep || 0) - Number(before?.rep || 0);
  const demGain = Number(after?.dem || 0) - Number(before?.dem || 0);
  if (repGain > 0) return { party: "R", seats: repGain };
  if (demGain > 0) return { party: "D", seats: demGain };
  return null;
}

function compositionFlipCounts(before, after) {
  const repGain = Math.max(0, Number(after?.rep || 0) - Number(before?.rep || 0));
  const demGain = Math.max(0, Number(after?.dem || 0) - Number(before?.dem || 0));
  return { rep: repGain, dem: demGain };
}


function majoritySummaryHtml(majority, gainSummary = null) {
  let firstLine = '<div class="majority-summary">No majority</div>';
  if (majority?.type === "tie") {
    firstLine = '<div class="majority-summary">Tied chamber</div>';
  } else if (majority?.type === "majority" && majority?.party && majority?.seats) {
    const partyLabel = majority.party === "R" ? "GOP" : "Dem";
    const partyClass = majority.party === "R" ? "majority-party-r" : "majority-party-d";
    firstLine = `
      <div class="majority-summary">
        <strong>${majority.seats}</strong> seat <strong class="${partyClass}">${partyLabel}</strong> majority
      </div>
    `;
  }

  if (!gainSummary?.party || !gainSummary?.seats) return firstLine;

  const gainPartyLabel = gainSummary.party === "R" ? "GOP" : "Dem";
  const gainPartyClass = gainSummary.party === "R" ? "majority-party-r" : "majority-party-d";
  return `${firstLine}<div class="majority-gain-line"><strong>${gainSummary.seats}</strong> seat gain for <strong class="${gainPartyClass}">${gainPartyLabel}</strong></div>`;
}

function compositionDotRows(totalSeats) {
  if (totalSeats >= 180) return 14;
  if (totalSeats >= 120) return 12;
  if (totalSeats >= 80) return 10;
  if (totalSeats >= 40) return 8;
  return 6;
}

function dotMatrixHtml(count, dotClass, rowsOverride = null, flipCount = 0) {
  const safeCount = Math.max(0, Number(count) || 0);
  if (!safeCount) return "";
  const dotRows = Number.isFinite(Number(rowsOverride)) && Number(rowsOverride) > 0 ? Number(rowsOverride) : compositionDotRows(safeCount);
  const safeFlipCount = Math.max(0, Math.min(safeCount, Number(flipCount) || 0));
  return `
    <div class="dot-matrix" style="--dot-rows:${dotRows}">
      ${Array.from({ length: safeCount }, (_, idx) => `<span class="${dotClass}${idx >= safeCount - safeFlipCount ? ' dot-flip-gain' : ''}"></span>`).join("")}
    </div>
  `;
}

function compositionRowHtml(label, beforeValue, afterValue, dotClass, projectionMode = false) {
  return `
    <div class="composition-row">
      <span class="composition-party"><span class="${dotClass}"></span>${escapeHtml(label)}</span>
      ${projectionMode
        ? `<span class="composition-value composition-value-before">${Number(beforeValue) || 0}</span><span class="composition-value">${Number(afterValue) || 0}</span>`
        : `<span class="composition-value">${Number(afterValue) || 0}</span>`}
    </div>
  `;
}

function districtTierValue(value) {
  const tier = Number(value);
  if (!Number.isInteger(tier) || tier < 1 || tier > 4) return null;
  return tier;
}

function districtTierForRecord(rec) {
  return districtTierValue(rec?.tier);
}

function createDefaultTargetFilters() {
  return {
    defense: { enabled: true, tiers: { 1: true, 2: true, 3: true, 4: true } },
    offense: { enabled: true, tiers: { 1: true, 2: true, 3: true, 4: true } },
  };
}

function ensureTargetFilters() {
  if (!state.targetFilters || typeof state.targetFilters !== "object") {
    state.targetFilters = createDefaultTargetFilters();
  }
  for (const section of ["defense", "offense"]) {
    if (!state.targetFilters[section] || typeof state.targetFilters[section] !== "object") {
      state.targetFilters[section] = createDefaultTargetFilters()[section];
    }
    if (typeof state.targetFilters[section].enabled !== "boolean") {
      state.targetFilters[section].enabled = true;
    }
    if (!state.targetFilters[section].tiers || typeof state.targetFilters[section].tiers !== "object") {
      state.targetFilters[section].tiers = { 1: true, 2: true, 3: true, 4: true };
    }
    for (const tier of [1, 2, 3, 4]) {
      if (typeof state.targetFilters[section].tiers[tier] !== "boolean") {
        state.targetFilters[section].tiers[tier] = true;
      }
    }
  }
}

function resetTargetFilters() {
  state.targetFilters = createDefaultTargetFilters();
}

function targetSectionForParty(party) {
  return String(party || "").trim().toUpperCase() === "R" ? "defense" : String(party || "").trim().toUpperCase() === "D" ? "offense" : null;
}

function availableTargetTiersForSection(section) {
  if (!state.selectedState) return [1, 2, 3, 4];
  const selectedFips = normalizeStateFips(state.selectedState.fips);
  if (!selectedFips) return [1, 2, 3, 4];
  const dataMap = state.dataByChamber[state.chamber];
  const tiers = new Set();
  for (const [joinKey, rec] of dataMap.entries()) {
    if (!String(joinKey || "").startsWith(`${selectedFips}|`)) continue;
    if (targetSectionForParty(rec?.incumbent?.party) !== section) continue;
    const tier = districtTierForRecord(rec);
    if (tier !== null) tiers.add(tier);
  }
  return tiers.size ? [...tiers].sort((a, b) => a - b) : [1, 2, 3, 4];
}

function targetSectionHasAnyTierSelected(section) {
  ensureTargetFilters();
  return availableTargetTiersForSection(section).some((tier) => !!state.targetFilters?.[section]?.tiers?.[tier]);
}

function normalizeTargetFiltersAfterChange() {
  ensureTargetFilters();
  for (const section of ["defense", "offense"]) {
    if (!targetSectionHasAnyTierSelected(section)) {
      state.targetFilters[section].enabled = false;
    }
  }
}

function anyTargetFiltersActive() {
  ensureTargetFilters();
  return ["defense", "offense"].some((section) => !!state.targetFilters?.[section]?.enabled && targetSectionHasAnyTierSelected(section));
}

function targetSectionIsActive(section) {
  ensureTargetFilters();
  return !!state.targetDistrictsMode && !!state.targetFilters?.[section]?.enabled && targetSectionHasAnyTierSelected(section);
}

function targetTierIsActive(section, tier) {
  ensureTargetFilters();
  return !!state.targetDistrictsMode && !!state.targetFilters?.[section]?.enabled && !!state.targetFilters?.[section]?.tiers?.[tier];
}

function targetRowPassesActiveFilters(row) {
  const section = row?.targetSection || targetSectionForParty(row?.incParty || row?.rec?.incumbent?.party);
  const tier = districtTierValue(row?.tier ?? row?.rec?.tier);
  if (!section || tier === null) return false;
  ensureTargetFilters();
  return !!state.targetFilters?.[section]?.enabled && !!state.targetFilters?.[section]?.tiers?.[tier];
}

function setExclusiveTargetFilter(section, tier = null) {
  ensureTargetFilters();
  for (const key of ["defense", "offense"]) {
    state.targetFilters[key].enabled = false;
    for (const currentTier of [1, 2, 3, 4]) state.targetFilters[key].tiers[currentTier] = false;
  }
  if (!state.targetFilters[section]) return;
  state.targetFilters[section].enabled = true;
  if (tier === null) {
    for (const currentTier of availableTargetTiersForSection(section)) state.targetFilters[section].tiers[currentTier] = true;
  } else {
    state.targetFilters[section].tiers[tier] = true;
  }
}

async function toggleTargetFilterControl(section, tier = null) {
  ensureTargetFilters();
  if (!section || !state.targetFilters[section]) return;

  if (!state.targetDistrictsMode) {
    setExclusiveTargetFilter(section, tier);
    await setTargetDistrictsMode(true, { preserveFilters: true });
    return;
  }

  if (tier === null) {
    if (targetSectionIsActive(section)) {
      state.targetFilters[section].enabled = false;
    } else {
      state.targetFilters[section].enabled = true;
      for (const currentTier of [1, 2, 3, 4]) state.targetFilters[section].tiers[currentTier] = false;
      for (const currentTier of availableTargetTiersForSection(section)) state.targetFilters[section].tiers[currentTier] = true;
    }
  } else if (!state.targetFilters[section].enabled || !state.targetFilters[section].tiers[tier]) {
    state.targetFilters[section].enabled = true;
    state.targetFilters[section].tiers[tier] = true;
  } else {
    state.targetFilters[section].tiers[tier] = false;
  }

  normalizeTargetFiltersAfterChange();

  if (!anyTargetFiltersActive()) {
    await setTargetDistrictsMode(false, { preserveFilters: true });
    return;
  }

  syncTargetModeUi();
  if (state.mode === "state" && state.selectedState && !state.selectedDistrictLayer) {
    showStateChamberOverview({ resetScroll: false });
  }
  if (state.mode !== "state") return;
  if (state.districtLayer) {
    refreshDistrictLayerForActiveFilters();
  } else {
    await ensureDistrictShapesLoaded();
    renderDistrictLayerForSelectedState();
  }
  await updateCountyOverlayVisibility();
}

function targetDistrictTableColCount(electionCols = [], showDistrictNameCol = false, includeTierColumn = false, includeOutcomeColumn = false) {
  return 4 + electionCols.length + (showDistrictNameCol ? 1 : 0) + (includeTierColumn ? 1 : 0) + (includeOutcomeColumn ? 1 : 0);
}

function groupedTargetDistrictRowsHtml(rows, electionCols, showDistrictNameCol = false, sectionKey = "") {
  const groups = [1, 2, 3, 4]
    .map((tier) => ({ tier, rows: rows.filter((row) => row.tier === tier) }))
    .filter((group) => group.rows.length);
  if (!groups.length) return "";

  const colCount = targetDistrictTableColCount(electionCols, showDistrictNameCol, true, state.projectionMode);
  return groups
    .map((group, groupIdx) => {
      const groupActive = targetTierIsActive(sectionKey, group.tier);
      const groupRowsHtml = group.rows
        .map((row, rowIdx) =>
          targetDistrictRowHtml(row, electionCols, showDistrictNameCol, {
            includeTierColumn: true,
            suppressTierCell: rowIdx > 0,
            rowClass: `${rowIdx === 0 ? "target-tier-group-start" : ""} ${state.targetDistrictsMode && !row.filterActive ? "target-row-inactive" : ""}`.trim(),
            tierCellHtml:
              rowIdx === 0
                ? `<td class="target-tier-group-cell target-filter-toggle ${groupActive ? "active-target-mode" : ""}" data-target-section="${escapeHtml(sectionKey)}" data-target-tier="${group.tier}" rowspan="${group.rows.length}"><span class="target-tier-group-label">Tier ${group.tier}</span></td>`
                : "",
          })
        )
        .join("");
      const spacerHtml =
        groupIdx < groups.length - 1
          ? `<tr class="target-tier-spacer" aria-hidden="true"><td colspan="${colCount}"></td></tr>`
          : "";
      return `${groupRowsHtml}${spacerHtml}`;
    })
    .join("");
}

function targetDistrictsSectionHtml(targets) {
  const showDistrictNameCol = shouldShowDistrictNameColumn();
  const defenseCols = districtElectionColumns(targets.defense);
  const offenseCols = districtElectionColumns(targets.offense);
  const defenseRows = groupedTargetDistrictRowsHtml(targets.defense, defenseCols, showDistrictNameCol, "defense");
  const offenseRows = groupedTargetDistrictRowsHtml(targets.offense, offenseCols, showDistrictNameCol, "offense");
  const defenseActive = targetSectionIsActive("defense");
  const offenseActive = targetSectionIsActive("offense");
  return `
    <div id="targetModeHeader" class="detail-section-title centered-section-title large-section-title target-mode-header ${state.targetDistrictsMode ? "active-target-mode" : ""}">Target Districts</div>
    <div class="target-columns">
      <div class="target-column ${defenseActive ? "" : "target-column-muted"}">
        <div class="detail-subtitle centered-subtitle chart-header target-section-toggle target-filter-toggle ${defenseActive ? "active-target-mode" : ""}" data-target-section="defense">Defense</div>
        ${targetDistrictTableHtml(defenseRows, targets.defense, showDistrictNameCol, { includeTierColumn: true, tierHeaderLabel: "Tier" })}
      </div>
      <div class="target-column ${offenseActive ? "" : "target-column-muted"}">
        <div class="detail-subtitle centered-subtitle chart-header target-section-toggle target-filter-toggle ${offenseActive ? "active-target-mode" : ""}" data-target-section="offense">Offense</div>
        ${targetDistrictTableHtml(offenseRows, targets.offense, showDistrictNameCol, { includeTierColumn: true, tierHeaderLabel: "Tier" })}
      </div>
    </div>
  `;
}
function districtModelColumns(rows = []) {
  const columns = [];
  for (const view of Object.keys(MODEL_VIEW_META)) {
    if (!rows.some((row) => typeof getMarginForView(row?.rec, view) === "number")) continue;
    const meta = parseModelViewKey(view);
    if (!meta) continue;
    columns.push({ type: "margin", view, labelTop: meta.tableTop, labelBottom: meta.tableBottom });
  }
  return columns;
}

function districtElectionColumns(rows = []) {
  const modelColumns = districtModelColumns(rows);
  const columns = [...modelColumns];

  if (state.projectionMode) {
    const baseHead = projectionBaseHeaderLines();
    if (columns.length) columns.push({ type: "gap" });
    columns.push(
      { type: "margin", view: "projection_base", labelTop: baseHead.top, labelBottom: baseHead.bottom },
      { type: "margin", view: "projection_2026", labelTop: "Proj", labelBottom: "2026" },
    );
    return columns;
  }

  const include = (view) => rows.some((row) => typeof getMarginForView(row?.rec, view) === "number");
  const includeGov2022 = include("gov_2022");
  const includeUsSen2022 = include("ussen_2022");

  const groups = [
    {
      key: "g2025",
      columns: include("leg_2025") ? [{ view: "leg_2025", year: 2025, type: "Leg", labelTop: "2025", labelBottom: "Leg" }] : [],
    },
    {
      key: "g2024",
      columns: [
        ...(include("leg_2024") ? [{ view: "leg_2024", year: 2024, type: "Leg", labelTop: "2024", labelBottom: "Leg" }] : []),
        ...(include("pres_2024") ? [{ view: "pres_2024", year: 2024, type: "Pres", labelTop: "2024", labelBottom: "Pres" }] : []),
      ],
    },
    {
      key: "g2023",
      columns: include("leg_2023") ? [{ view: "leg_2023", year: 2023, type: "Leg", labelTop: "2023", labelBottom: "Leg" }] : [],
    },
    {
      key: "g2022",
      columns: [
        ...(include("leg_2022") ? [{ view: "leg_2022", year: 2022, type: "Leg", labelTop: "2022", labelBottom: "Leg" }] : []),
        ...(includeGov2022 ? [{ view: "gov_2022", year: 2022, type: "Gov", labelTop: "2022", labelBottom: "Gov" }] : []),
        ...(!includeGov2022 && includeUsSen2022 ? [{ view: "ussen_2022", year: 2022, type: "US Sen", labelTop: "2022", labelBottom: "US Sen" }] : []),
      ],
    },
  ].filter((group) => group.columns.length);

  groups.forEach((group, idx) => {
    if (columns.length || idx > 0) columns.push({ type: "gap" });
    for (const col of group.columns) columns.push({ type: "margin", ...col });
  });
  return columns;
}

function shouldShowDistrictNameColumn() {
  if (state.chamber !== "house") return false;
  const abbr = normalizeStateAbbr(state.selectedState?.abbr || "");
  return abbr === "NH" || abbr === "MA";
}

function districtNameDisplayForRecord(rec) {
  const rawName = String(rec?.district_name || "").trim();
  if (!rawName) return "";
  const abbr = normalizeStateAbbr(state.selectedState?.abbr || "");
  if (abbr === "NH") {
    return rawName.replace(/^State House District\s+/i, "").trim();
  }
  if (abbr === "MA") {
    return rawName.replace(/\s+District$/i, "").trim();
  }
  return rawName;
}

function targetDistrictTableHtml(rowsHtml, rows = [], showDistrictNameCol = false, options = {}) {
  const { includeTierColumn = false, tierHeaderLabel = "Tier" } = options;
  const includeOutcomeColumn = !!state.projectionMode;
  const electionCols = districtElectionColumns(rows);
  const headCols = electionCols
    .map((col) => {
      if (col.type === "gap") return '<th class="target-gap-col"></th>';
      const top = col.labelTop ?? col.year ?? "";
      const bottom = col.labelBottom ?? col.type ?? "";
      return `<th class="target-col-margin"><span class="twoline-head">${escapeHtml(String(top))}<br/>${escapeHtml(String(bottom))}</span></th>`;
    })
    .join("");
  const tierHead = includeTierColumn ? `<th class="target-col-tier">${escapeHtml(tierHeaderLabel)}</th>` : "";
  const districtNameHead = showDistrictNameCol ? '<th class="target-col-district-name">District</th>' : "";
  const outcomeHead = includeOutcomeColumn ? '<th class="target-col-outcome">Outcome</th>' : "";
  const colCount = targetDistrictTableColCount(electionCols, showDistrictNameCol, includeTierColumn, includeOutcomeColumn);

  return `
    <table class="target-table">
      <thead>
        <tr>
          ${tierHead}
          <th class="target-col-district">#</th>
          ${districtNameHead}
          <th class="target-col-inc">Inc</th>
          <th class="target-col-candidate">2026 GOP</th>
          <th class="target-col-candidate">2026 DEM</th>
          ${headCols}
          ${outcomeHead}
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="${colCount}" class="target-empty">None</td></tr>`}
      </tbody>
    </table>
  `;
}
function districtColumnMarginValue(row, col) {
  if (!row || !col || col.type === "gap") return null;
  if (col.view === "projection_base") return projectionBaseMarginForRecord(row.rec);
  if (col.view === "projection_2026") return projectedMarginForRecord(row.rec);
  const cached = row?.marginsByView?.[col.view];
  if (typeof cached === "number") return cached;
  return row?.rec ? getMarginForView(row.rec, col.view) : null;
}
function projectionOutcomeForRow(row) {
  if (!state.projectionMode || !row?.rec) return null;
  const projected = projectedMarginForRecord(row.rec);
  if (typeof projected !== "number") return null;

  const currentParty = row.incParty === "R" || row.incParty === "D"
    ? row.incParty
    : String(row?.rec?.incumbent?.party || "").trim().toUpperCase();
  const resolvedCurrentParty = currentParty === "R" || currentParty === "D" ? currentParty : null;
  const projectedParty = Math.abs(projected) < 0.0001
    ? resolvedCurrentParty
    : projected > 0
      ? "D"
      : "R";

  if (!resolvedCurrentParty || !projectedParty) return null;

  if (resolvedCurrentParty === projectedParty) {
    if (projectedParty === "R") return { label: "GOP Hold", className: "outcome-cell-gop-hold" };
    return { label: "Dem Hold", className: "outcome-cell-dem-hold" };
  }

  if (projectedParty === "R") return { label: "GOP Flip", className: "outcome-cell-gop-flip" };
  return { label: "Dem Flip", className: "outcome-cell-dem-flip" };
}


function targetDistrictRowHtml(row, electionCols = districtElectionColumns([row]), showDistrictNameCol = false, options = {}) {
  const { includeTierColumn = false, suppressTierCell = false, tierCellHtml = null, rowClass = "" } = options;
  const incClass = row.incParty === "R" ? "inc-r" : row.incParty === "D" ? "inc-d" : "inc-u";
  const districtNameCell = showDistrictNameCol
    ? `<td class="district-name-cell" title="${escapeHtml(row.districtNameDisplay || "")}">${escapeHtml(row.districtNameDisplay || "-")}</td>`
    : "";
  const tierCell = includeTierColumn
    ? suppressTierCell
      ? ""
      : typeof tierCellHtml === "string"
        ? tierCellHtml
        : `<td class="target-tier-cell">${escapeHtml(row.tier ? String(row.tier) : "")}</td>`
    : "";
  const marginCells = electionCols
    .map((col) => {
      if (col.type === "gap") return '<td class="target-gap-cell"></td>';
      const margin = districtColumnMarginValue(row, col);
      const isNa = typeof margin !== "number";
      const cellClass = isNa ? "margin-cell margin-cell-na" : "margin-cell";
      return `<td class="${cellClass}" style="background:${targetMarginCellColor(margin)}">${escapeHtml(formatSignedRMargin(margin))}</td>`;
    })
    .join("");
  const outcome = projectionOutcomeForRow(row);
  const outcomeCell = state.projectionMode
    ? `<td class="outcome-cell ${escapeHtml(outcome?.className || 'outcome-cell-na')}">${escapeHtml(outcome?.label || 'N/A')}</td>`
    : "";
  const candidateCells = recordIsUpIn2026(row.rec)
    ? `<td class="candidate-cell">${candidateCellHtml(row.rec, "R", { short: false })}</td><td class="candidate-cell">${candidateCellHtml(row.rec, "D", { short: false })}</td>`
    : '<td class="candidate-cell candidate-cell-unavailable" colspan="2">Not up in 2026</td>';
  return `
    <tr class="target-row district-select-row ${rowNeedsExpandedCandidateCells(row.rec) ? "target-row-multi" : ""} ${escapeHtml(rowClass)}" data-join-key="${escapeHtml(row.joinKey)}">
      ${tierCell}
      <td class="target-district-cell">${escapeHtml(row.districtLabel)}</td>
      ${districtNameCell}
      <td class="inc-cell ${incClass}"><strong>${escapeHtml(row.incParty || "?")}</strong></td>
      ${candidateCells}
      ${marginCells}
      ${outcomeCell}
    </tr>
  `;
}
function targetTablesForSelectedState() {

  const rows = targetDistrictRowsForSelectedState();
  const rowSort = (a, b) => (a.tier - b.tier) || (targetSortValue(a) - targetSortValue(b)) || (districtLabelSortValue(a.districtLabel) - districtLabelSortValue(b.districtLabel));
  const defense = rows
    .filter((row) => row.incParty === "R")
    .sort(rowSort);
  const offense = rows
    .filter((row) => row.incParty === "D")
    .sort(rowSort);
  return { defense, offense };
}

function targetDistrictRowsForSelectedState() {
  if (!state.selectedState) return [];
  const selectedFips = normalizeStateFips(state.selectedState.fips);
  if (!selectedFips) return [];
  const dataMap = state.dataByChamber[state.chamber];
  const rows = [];

  for (const [joinKey, rec] of dataMap.entries()) {
    if (!String(joinKey || "").startsWith(`${selectedFips}|`)) continue;
    const tier = districtTierForRecord(rec);
    if (tier === null) continue;
    const incParty = String(rec.incumbent?.party || "").trim().toUpperCase();
    if (incParty !== "R" && incParty !== "D") continue;
    const targetSection = targetSectionForParty(incParty);
    rows.push({
      joinKey,
      districtLabel: displayDistrictId(rec.district_id, rec.district_id),
      districtNameDisplay: districtNameDisplayForRecord(rec),
      incParty,
      targetSection,
      tier,
      rec,
      filterActive: targetSection ? targetRowPassesActiveFilters({ incParty, targetSection, tier, rec }) : false,
      marginsByView: {
        leg_2025: getMarginForView(rec, "leg_2025"),
        leg_2024: getMarginForView(rec, "leg_2024"),
        pres_2024: getMarginForView(rec, "pres_2024"),
        leg_2023: getMarginForView(rec, "leg_2023"),
        leg_2022: getMarginForView(rec, "leg_2022"),
        gov_2022: getMarginForView(rec, "gov_2022"),
        ussen_2022: getMarginForView(rec, "ussen_2022"),
      },
    });
  }

  return rows;
}
function allDistrictsSectionHtml(rows) {
  const chamberLabel = capitalize(state.chamber);
  const showDistrictNameCol = shouldShowDistrictNameColumn();
  const allCols = districtElectionColumns(rows);
  const bodyRows = rows.map((row) => targetDistrictRowHtml(row, allCols, showDistrictNameCol, { includeTierColumn: true })).join("");
  return `
    <div class="detail-section-title centered-section-title large-section-title all-districts-header">All ${escapeHtml(chamberLabel)} Districts</div>
    <div class="all-districts-table-wrap">
      ${targetDistrictTableHtml(bodyRows, rows, showDistrictNameCol, { includeTierColumn: true, tierHeaderLabel: "Tier" })}
    </div>
  `;
}
function allDistrictRowsForSelectedState() {
  if (!state.selectedState) return [];
  const dataMap = state.dataByChamber[state.chamber];
  const rows = [];
  const seen = new Set();

  const selectedFips = normalizeStateFips(state.selectedState.fips);
  const isNhHouse = state.chamber === "house" && normalizeStateAbbr(state.selectedState?.abbr || "") === "NH";

  if (isNhHouse) {
    for (const rec of dataMap.values()) {
      if (normalizeStateFips(rec?.state_fips) !== selectedFips) continue;
      const joinKey = makeJoinKey(selectedFips, rec.district_id);
      if (!joinKey || seen.has(joinKey)) continue;
      seen.add(joinKey);
      const incParty = String(rec.incumbent?.party || "").trim().toUpperCase() || "O";
      rows.push({
        joinKey,
        districtLabel: displayDistrictId(rec.district_id, rec.district_id),
        districtNameDisplay: districtNameDisplayForRecord(rec),
        incParty: incParty === "R" || incParty === "D" ? incParty : "O",
        tier: districtTierForRecord(rec),
        rec,
        marginsByView: {
          leg_2025: getMarginForView(rec, "leg_2025"),
          leg_2024: getMarginForView(rec, "leg_2024"),
          pres_2024: getMarginForView(rec, "pres_2024"),
          leg_2023: getMarginForView(rec, "leg_2023"),
          leg_2022: getMarginForView(rec, "leg_2022"),
          gov_2022: getMarginForView(rec, "gov_2022"),
          ussen_2022: getMarginForView(rec, "ussen_2022"),
        },
      });
    }
  } else {
    for (const feature of state.currentDistrictFeatures || []) {
      const joinInfo = extractJoinIds(feature.properties);
      if (!joinInfo.key || seen.has(joinInfo.key)) continue;
      seen.add(joinInfo.key);
      const rec = dataMap.get(joinInfo.key);
      if (!rec) continue;
      const incParty = String(rec.incumbent?.party || "").trim().toUpperCase() || "O";
      rows.push({
        joinKey: joinInfo.key,
        districtLabel: displayDistrictId(joinInfo.rawDistrict, joinInfo.districtId),
        districtNameDisplay: districtNameDisplayForRecord(rec),
        incParty: incParty === "R" || incParty === "D" ? incParty : "O",
        tier: districtTierForRecord(rec),
        rec,
        marginsByView: {
          leg_2025: getMarginForView(rec, "leg_2025"),
          leg_2024: getMarginForView(rec, "leg_2024"),
          pres_2024: getMarginForView(rec, "pres_2024"),
          leg_2023: getMarginForView(rec, "leg_2023"),
          leg_2022: getMarginForView(rec, "leg_2022"),
          gov_2022: getMarginForView(rec, "gov_2022"),
          ussen_2022: getMarginForView(rec, "ussen_2022"),
        },
      });
    }
  }

  rows.sort((a, b) => districtLabelSortValue(a.districtLabel) - districtLabelSortValue(b.districtLabel));
  return rows;
}
function districtLabelSortValue(label) {
  const text = String(label || "").trim().toUpperCase();
  const m = text.match(/^([0-9]+)([A-Z]*)$/);
  if (!m) return Number.POSITIVE_INFINITY;
  const numPart = Number(m[1]);
  const suffix = m[2] || "";
  let suffixScore = 0;
  for (let i = 0; i < suffix.length; i += 1) {
    suffixScore += (suffix.charCodeAt(i) - 64) / Math.pow(27, i + 1);
  }
  return numPart + suffixScore;
}

function recordMembers(rec) {
  const members = Array.isArray(rec?.members) ? rec.members : [];
  if (members.length) {
    return members
      .map((member, idx) => normalizeMemberEntry(member, idx))
      .filter((member) => !!member);
  }

  const incumbent = rec?.incumbent || {};
  const candidates = rec?.candidates_2026 || {};
  return [
    normalizeMemberEntry(
      {
        seat: 1,
        seat_label: "",
        incumbent: {
          name: incumbent.name,
          party: incumbent.party,
        },
        candidates: {
          rep: candidates.rep,
          dem: candidates.dem,
        },
      },
      0
    ),
  ].filter((member) => !!member);
}

function normalizeMemberEntry(member, idx = 0) {
  if (!member || typeof member !== "object") return null;
  const incumbent = member.incumbent || {};
  const candidates = member.candidates || {};
  const seat = Number.isFinite(Number(member.seat)) ? Number(member.seat) : idx + 1;
  const incumbentName = String(incumbent.name || "").trim() || "Vacant";
  const incumbentParty = String(incumbent.party || "").trim().toUpperCase() || "O";
  return {
    seat,
    seat_label: String(member.seat_label || "").trim(),
    incumbent: {
      name: incumbentName,
      party: incumbentParty,
    },
    candidates: {
      rep: normalizeCandidateName(candidates.rep),
      dem: normalizeCandidateName(candidates.dem),
    },
  };
}

function normalizeCandidateName(value) {
  const text = String(value || "").trim();
  if (!text || /^tbd$/i.test(text) || /^unknown$/i.test(text) || /^no candidate$/i.test(text)) return "No candidate";
  return text;
}

function hasNamedCandidate(name) {
  const text = String(name || "").trim();
  return !!text && !/^no candidate$/i.test(text);
}

function memberIsIncumbentNominee(member, party) {
  if (!member || !party) return false;
  const incumbentParty = String(member.incumbent?.party || "").toUpperCase();
  if (incumbentParty !== party) return false;
  const incumbentName = String(member.incumbent?.name || "").trim().toUpperCase();
  if (!incumbentName || incumbentName === "VACANT") return false;
  const key = party === "R" ? "rep" : "dem";
  const candidateName = String(member.candidates?.[key] || "").trim().toUpperCase();
  return !!candidateName && candidateName === incumbentName;
}

function memberIncumbentRunningFor2026(member) {
  return memberIsIncumbentNominee(member, "R") || memberIsIncumbentNominee(member, "D");
}

function candidateSeatCount(rec) {
  const seatsUp = Number(rec?.candidate_seats_up);
  if (Number.isFinite(seatsUp) && seatsUp > 0) return Math.max(1, Math.floor(seatsUp));
  return recordMembers(rec).length;
}

function membersForCandidateDisplay(rec) {
  const members = recordMembers(rec).sort((a, b) => Number(a.seat || 0) - Number(b.seat || 0));
  if (!members.length) return [];
  const seatsUp = Math.min(candidateSeatCount(rec), members.length);
  return members.slice(0, seatsUp);
}

function candidateDisplayLines(rec, party, options = {}) {
  const { short = false, includeParty = false, includeSeatLabel = false } = options;
  const key = party === "R" ? "rep" : "dem";
  const members = membersForCandidateDisplay(rec);
  if (!members.length) return [includeParty ? `No candidate (${party})` : "No candidate"];

  const raw = members.map((member) => {
    const baseName = normalizeCandidateName(member.candidates?.[key]);
    const name = short && hasNamedCandidate(baseName) ? shortPersonName(baseName) : baseName;
    const withInc = `${name}${memberIsIncumbentNominee(member, party) && hasNamedCandidate(baseName) ? "*" : ""}`;
    const seatPrefix = includeSeatLabel && member.seat_label ? `${member.seat_label}: ` : "";
    const suffix = includeParty ? ` (${party})` : "";
    return `${seatPrefix}${withInc}${suffix}`;
  });

  const anyNamed = raw.some((line) => !/^((Seat\s+\d+:\s+)?)?No candidate(\s*\([RD]\))?$/i.test(line));
  if (!anyNamed) return raw;
  return raw.filter((line) => !/^((Seat\s+\d+:\s+)?)?No candidate(\s*\([RD]\))?$/i.test(line));
}

function seatOrderedCandidateLines(rec) {
  const members = membersForCandidateDisplay(rec);
  if (!members.length) return [];
  const hasSeatLabels = members.some((member) => !!member?.seat_label);
  if (!hasSeatLabels) return [];

  const lines = [];
  members.forEach((member, idx) => {
    const seatLabel = member.seat_label ? `${member.seat_label}: ` : "";
    const repName = normalizeCandidateName(member.candidates?.rep);
    const demName = normalizeCandidateName(member.candidates?.dem);
    const repInc = memberIsIncumbentNominee(member, "R") && hasNamedCandidate(repName) ? "*" : "";
    const demInc = memberIsIncumbentNominee(member, "D") && hasNamedCandidate(demName) ? "*" : "";
    lines.push(`${seatLabel}${repName}${repInc} (R)`);
    lines.push(`${seatLabel}${demName}${demInc} (D)`);
    if (idx < members.length - 1) lines.push("");
  });
  return lines;
}

function isNoCandidateLine(line) {
  return /^((Seat\s+\d+:\s+)?)?No candidate(\s*\([RD]\))?$/i.test(String(line || "").trim());
}

function mutedCandidateLineHtml(line) {
  return `<div class="candidate-line candidate-line-muted">${escapeHtml(line)}</div>`;
}

function candidateCellHtml(rec, party, options = {}) {
  const lines = candidateDisplayLines(rec, party, options);
  return lines
    .map((line) => {
      if (isNoCandidateLine(line)) return mutedCandidateLineHtml(line);
      return `<div class="candidate-line">${escapeHtml(line)}</div>`;
    })
    .join("");
}

function rowNeedsExpandedCandidateCells(rec) {
  const repCount = candidateDisplayLines(rec, "R", { short: false, includeParty: false }).length;
  const demCount = candidateDisplayLines(rec, "D", { short: false, includeParty: false }).length;
  return Math.max(repCount, demCount) > 1;
}

function gopCandidateShort(rec) {
  return candidateDisplayLines(rec, "R", { short: true, includeParty: false }).join(" / ");
}

function demCandidateShort(rec) {
  return candidateDisplayLines(rec, "D", { short: true, includeParty: false }).join(" / ");
}

function gopCandidateFull(rec) {
  return candidateDisplayLines(rec, "R", { short: false, includeParty: false }).join(" / ");
}

function demCandidateFull(rec) {
  return candidateDisplayLines(rec, "D", { short: false, includeParty: false }).join(" / ");
}

function shortPersonName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0].charAt(0).toUpperCase()}. ${parts[parts.length - 1]}`;
}

function clampDisplayMarginValue(margin) {
  if (typeof margin !== "number") return null;
  return Math.max(-100, Math.min(100, margin));
}

function formatSignedRMargin(demMargin) {
  const clampedMargin = clampDisplayMarginValue(demMargin);
  if (typeof clampedMargin !== "number") return "N/A";
  const rMargin = -clampedMargin;
  const sign = rMargin >= 0 ? "+" : "-";
  return `${sign}${Math.abs(rMargin).toFixed(1)}%`;
}

function targetMarginCellColor(demMargin) {
  if (typeof demMargin !== "number") return "#1b232d";
  return marginColor(demMargin);
}

function targetSortValue(row) {
  if (state.projectionMode) {
    const base = projectionBaseMarginForRecord(row?.rec);
    if (typeof base === "number") return Math.abs(base);
    return Number.POSITIVE_INFINITY;
  }

  const views = ["leg_2025", "leg_2024", "leg_2023", "leg_2022"];
  for (const view of views) {
    const margin = row?.marginsByView?.[view];
    if (typeof margin === "number") return Math.abs(margin);
  }
  return Number.POSITIVE_INFINITY;
}

function wireTargetTableInteractions() {
  const modeHeader = details.querySelector("#targetModeHeader");
  if (modeHeader) {
    modeHeader.onclick = async () => {
      await setTargetDistrictsMode(!state.targetDistrictsMode);
    };
  }
  syncTargetModeUi();
  wireDetailsInteractions();
}

function wireDetailsInteractions() {
  if (state.detailsInteractionsWired) return;
  state.detailsInteractionsWired = true;

  details.addEventListener("mouseover", (event) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    if (!targetEl) return;

    const pointEl = document.elementFromPoint(event.clientX, event.clientY);
    if (pointEl instanceof Element && pointEl.closest(".target-tier-group-cell, .target-section-toggle")) {
      setHoveredTableRow(null);
      return;
    }

    if (targetEl.closest(".target-tier-group-cell, .target-section-toggle")) {
      setHoveredTableRow(null);
      return;
    }

    const districtRow = targetEl.closest(".district-select-row[data-join-key]");
    if (districtRow) {
      setHoveredStateRow(null);
      setHoveredTableRow(districtRow);
      return;
    }

    const stateRow = targetEl.closest(".state-select-row[data-state-key]");
    if (stateRow) {
      setHoveredTableRow(null);
      setHoveredStateRow(stateRow);
    }
  });

  details.addEventListener("mousemove", (event) => {
    const pointEl = document.elementFromPoint(event.clientX, event.clientY);
    if (pointEl instanceof Element && pointEl.closest(".target-tier-group-cell, .target-section-toggle")) {
      if (state.hoveredTableRowEl) setHoveredTableRow(null);
    }
  });

  details.addEventListener("mouseout", (event) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    if (!targetEl) return;

    const districtRow = targetEl.closest(".district-select-row[data-join-key]");
    if (districtRow) {
      const related = event.relatedTarget;
      if (related && districtRow.contains(related)) return;
      if (state.hoveredTableRowEl === districtRow) setHoveredTableRow(null);
      return;
    }

    const stateRow = targetEl.closest(".state-select-row[data-state-key]");
    if (stateRow) {
      const related = event.relatedTarget;
      if (related && stateRow.contains(related)) return;
      if (state.hoveredStateRowEl === stateRow) setHoveredStateRow(null);
    }
  });

  details.addEventListener("click", async (event) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    if (!targetEl) return;

    const targetFilterControl = targetEl.closest(".target-filter-toggle[data-target-section]");
    if (targetFilterControl) {
      const section = String(targetFilterControl.dataset.targetSection || "").trim();
      const tier = districtTierValue(targetFilterControl.dataset.targetTier);
      await toggleTargetFilterControl(section, tier);
      return;
    }

    const sortHeader = targetEl.closest("th.national-sortable[data-sort-key]");
    if (sortHeader && state.mode === "national") {
      const key = String(sortHeader.dataset.sortKey || "").trim();
      if (key) {
        setHoveredStateRow(null);
        toggleNationalSort(key);
        details.innerHTML = nationalOverviewHtml();
      }
      return;
    }

    const districtRow = targetEl.closest(".district-select-row[data-join-key]");
    if (districtRow) {
      selectDistrictFromTargetRow(districtRow.dataset.joinKey || "");
      return;
    }

    const stateRow = targetEl.closest(".state-select-row[data-state-key]");
    if (stateRow) {
      let chamberOverride = null;
      const clickedCell = targetEl.closest("td");
      if (clickedCell && clickedCell.parentElement === stateRow) {
        const idx = Array.from(stateRow.children).indexOf(clickedCell);
        if (idx >= 1 && idx <= 4) chamberOverride = "house";
        if (idx >= 6 && idx <= 9) chamberOverride = "senate";
      }
      if (chamberOverride) {
        await setChamber(chamberOverride);
      }
      await selectStateByKey(stateRow.dataset.stateKey || "");
    }
  });
}

function setHoveredTableRow(row) {
  if (state.hoveredTableRowEl && state.hoveredTableRowEl !== row) {
    state.hoveredTableRowEl.classList.remove("is-hovered");
  }
  state.hoveredTableRowEl = row || null;
  if (!row) {
    clearDistrictHoverOutline();
    return;
  }
  row.classList.add("is-hovered");
  const layer = districtLayerForJoinKey(row.dataset.joinKey || "");
  if (!layer?.__featureRef) return;
  showDistrictHoverOutline(layer.__featureRef);
}

function setHoveredStateKey(key) {
  const nextKey = key ? String(key) : null;
  if (state.hoveredStateKey === nextKey) return;
  state.hoveredStateKey = nextKey;
  renderHoveredStateOverlay();
}

function renderHoveredStateOverlay() {
  clearStateHoverOutline();
  if (!state.hoveredStateKey) return;
  const nextLayer = state.stateLayerByKey.get(state.hoveredStateKey);
  if (!nextLayer) return;
  const feature = nextLayer.__featureRef || nextLayer.feature;
  state.hoveredStateOverlayLayer = L.geoJSON(feature, {
    pane: "stateHoverPane",
    interactive: false,
    style: stateHoverBoundaryStyle(feature),
  }).addTo(map);
}

function clearStateHoverOutline() {
  if (!state.hoveredStateOverlayLayer) return;
  if (map.hasLayer(state.hoveredStateOverlayLayer)) map.removeLayer(state.hoveredStateOverlayLayer);
  state.hoveredStateOverlayLayer = null;
}

function setHoveredStateRow(row) {
  if (state.hoveredStateRowEl && state.hoveredStateRowEl !== row) {
    state.hoveredStateRowEl.classList.remove("is-hovered");
  }

  state.hoveredStateRowEl = row || null;
  const key = row?.dataset?.stateKey ? String(row.dataset.stateKey) : null;

  if (row) {
    row.classList.add("is-hovered");
  }
  setHoveredStateKey(key);
}

function districtLayerForJoinKey(joinKey) {
  if (!joinKey || !state.districtLayerIndex) return null;
  if (state.districtLayerIndex.has(joinKey)) return state.districtLayerIndex.get(joinKey) || null;
  if (state.floterialLayerByJoinKey?.has(joinKey)) return state.floterialLayerByJoinKey.get(joinKey) || null;
  return null;
}

function selectDistrictFromTargetRow(joinKey) {
  const layer = districtLayerForJoinKey(joinKey);
  if (!layer?.__featureRef || !layer.__dataMapRef) return;
  clearDistrictHoverOutline();
  clearSelectedDistrictOutline();
  hideDistrictHoverInfo();
  setSelectedDistrict(layer);
  const feature = layer.__featureRef;
  const joinInfo = extractJoinIds(feature.properties);
  const rec = layer.__dataMapRef.get(joinInfo.key);
  showDistrictDetailPanel(feature.properties, joinInfo, rec);
}
function targetJoinKeySetForSelectedState() {
  return state.targetJoinKeySet || new Set();
}

function upIn2026JoinKeySetForSelectedState() {
  return state.upIn2026JoinKeySet || new Set();
}

function filteredDistrictJoinKeySetForSelectedState() {
  return state.filteredDistrictJoinKeySet || null;
}

function refreshTargetJoinKeySet() {
  const set = new Set();
  if (!state.selectedState) {
    state.targetJoinKeySet = set;
    return;
  }
  const stateFips = normalizeStateFips(state.selectedState.fips);
  if (!stateFips) {
    state.targetJoinKeySet = set;
    return;
  }

  const dataMap = state.dataByChamber[state.chamber];
  for (const [joinKey, rec] of dataMap.entries()) {
    if (!String(joinKey || "").startsWith(`${stateFips}|`)) continue;
    if (districtTierForRecord(rec) === null) continue;
    if (!targetRowPassesActiveFilters({ rec })) continue;
    set.add(joinKey);
  }
  state.targetJoinKeySet = set;
}

function refreshUpIn2026JoinKeySet() {
  const set = new Set();
  if (!state.selectedState) {
    state.upIn2026JoinKeySet = set;
    return;
  }
  const stateFips = normalizeStateFips(state.selectedState.fips);
  if (!stateFips) {
    state.upIn2026JoinKeySet = set;
    return;
  }

  const dataMap = state.dataByChamber[state.chamber];
  for (const [joinKey, rec] of dataMap.entries()) {
    if (!String(joinKey || "").startsWith(`${stateFips}|`)) continue;
    if (Number(rec?.next_election) !== 2026) continue;
    set.add(joinKey);
  }
  state.upIn2026JoinKeySet = set;
}

function refreshFilteredDistrictJoinKeySet() {
  refreshTargetJoinKeySet();
  refreshUpIn2026JoinKeySet();

  const activeSets = [];
  if (state.targetDistrictsMode) activeSets.push(targetJoinKeySetForSelectedState());
  if (state.upIn2026Mode || state.projectionMode) activeSets.push(upIn2026JoinKeySetForSelectedState());

  if (!activeSets.length) {
    state.filteredDistrictJoinKeySet = null;
    return;
  }

  const filtered = new Set(activeSets[0]);
  for (const currentSet of activeSets.slice(1)) {
    for (const key of [...filtered]) {
      if (!currentSet.has(key)) filtered.delete(key);
    }
  }
  state.filteredDistrictJoinKeySet = filtered;
}

async function setTargetDistrictsMode(enabled, options = {}) {
  const { preserveFilters = false } = options;
  state.targetDistrictsMode = !!enabled;
  ensureTargetFilters();
  if (state.targetDistrictsMode && !preserveFilters) {
    resetTargetFilters();
  }
  syncTargetModeUi();
  if (state.mode === "state" && state.selectedState && !state.selectedDistrictLayer) {
    showStateChamberOverview({ resetScroll: false });
  }
  if (state.mode !== "state") return;
  if (state.districtLayer) {
    refreshDistrictLayerForActiveFilters();
  } else {
    await ensureDistrictShapesLoaded();
    renderDistrictLayerForSelectedState();
  }
  await updateCountyOverlayVisibility();
}

function syncTargetModeUi() {
  if (targetDistrictsToggle) targetDistrictsToggle.checked = !!state.targetDistrictsMode;
  const modeHeader = details?.querySelector?.("#targetModeHeader");
  if (modeHeader) {
    modeHeader.classList.toggle("active-target-mode", !!state.targetDistrictsMode);
  }
  for (const control of details?.querySelectorAll?.('.target-filter-toggle') || []) {
    const section = String(control.dataset.targetSection || '').trim();
    const tier = districtTierValue(control.dataset.targetTier);
    const active = tier === null ? targetSectionIsActive(section) : targetTierIsActive(section, tier);
    control.classList.toggle('active-target-mode', active);
  }
}

async function setUpIn2026Mode(enabled) {
  if (state.projectionMode) {
    state.upIn2026Mode = true;
    syncUpIn2026Ui();
    renderProjectionUi();
    return;
  }

  state.upIn2026Mode = !!enabled;
  syncUpIn2026Ui();
  if (state.mode !== "state") return;
  if (state.districtLayer) {
    refreshDistrictLayerForActiveFilters();
  } else {
    await ensureDistrictShapesLoaded();
    renderDistrictLayerForSelectedState();
  }
}

function syncUpIn2026Ui() {
  if (upIn2026Toggle) upIn2026Toggle.checked = !!state.upIn2026Mode;
}

function refreshDistrictLayerForActiveFilters(options = {}) {
  const { rebuildLabels = true } = options;
  if (!state.districtLayer) return;
  refreshFilteredDistrictJoinKeySet();
  state.districtLayer.eachLayer((layer) => {
    if (state.selectedDistrictLayer && state.selectedDistrictLayer === layer) {
      layer.setStyle(districtSelectedStyle(layer.__featureRef, layer.__dataMapRef));
      return;
    }
    resetDistrictStyle(layer);
  });
  if (rebuildLabels) {
    scheduleDistrictNumberLayerBuild(state.currentDistrictFeatures || []);
  }
}

function refreshDistrictLayerForMapView() {
  if (!state.districtLayer) return;
  state.districtLayer.eachLayer((layer) => {
    if (state.selectedDistrictLayer && state.selectedDistrictLayer === layer) {
      layer.setStyle(districtSelectedStyle(layer.__featureRef, layer.__dataMapRef));
    } else {
      resetDistrictStyle(layer);
    }
  });
}

function clearDistrictLayer() {
  state.suspendPopupCloseOverview = true;
  map.closePopup();
  setTimeout(() => {
    state.suspendPopupCloseOverview = false;
  }, 0);
  state.districtLayerIndex = new Map();
  state.currentDistrictFeatures = [];
  state.districtNumberBuildToken += 1;
  state.hoveredTableRowEl = null;
  setHoveredStateRow(null);
  setHoveredStateKey(null);
  clearStateHoverOutline();
  if (state.districtLayer) {
    map.removeLayer(state.districtLayer);
    state.districtLayer = null;
  }
  clearNhFloterialLayer();
  clearDistrictNumberLayer();
  state.selectedDistrictLayer = null;
  hideChamberOverviewButton();
  clearDistrictHoverOutline();
  clearSelectedDistrictOutline();
  hideDistrictHoverInfo();
}

function buildDistrictNumberLayer(features) {
  clearDistrictNumberLayer();
  const targetKeySet = filteredDistrictJoinKeySetForSelectedState();
  const group = L.layerGroup();
  for (const feature of features || []) {
    const joinInfo = extractJoinIds(feature.properties);
    if (targetKeySet && !targetKeySet.has(joinInfo.key)) continue;
    const districtNumber = displayDistrictId(joinInfo.rawDistrict, joinInfo.districtId);
    if (!districtNumber) continue;
    const bounds = geometryBounds(feature.geometry);
    if (!bounds.isValid()) continue;
    const marker = L.marker(bounds.getCenter(), {
      pane: "districtNumberPane",
      interactive: false,
      icon: L.divIcon({
        className: "district-number-label-wrap",
        html: "",
      }),
    });
    marker.__districtBounds = bounds;
    marker.__districtText = districtNumber;
    marker.__districtGeometry = feature.geometry || null;
    marker.__districtLabelHtml = null;
    marker.__districtLabelLatLng = null;
    marker.addTo(group);
  }
  state.districtNumberLayer = group.addTo(map);
  refreshDistrictNumberLabels();
}

function geometryBounds(geometry) {
  if (!geometry || !geometry.type) return L.latLngBounds([]);
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  const consumeCoord = (coord) => {
    if (!Array.isArray(coord) || coord.length < 2) return;
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  };

  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
      consumeCoord(coords);
      return;
    }
    for (const child of coords) walk(child);
  };

  walk(geometry.coordinates);
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng) || !Number.isFinite(maxLat) || !Number.isFinite(maxLng)) {
    return L.latLngBounds([]);
  }
  return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
}

function clearDistrictNumberLayer() {
  state.districtNumberBuildToken += 1;
  state.districtLabelRefreshToken += 1;
  if (!state.districtNumberLayer) return;
  if (map.hasLayer(state.districtNumberLayer)) map.removeLayer(state.districtNumberLayer);
  state.districtNumberLayer = null;
}

function refreshDistrictNumberLabels() {
  if (!state.districtNumberLayer) return;
  state.districtLabelRefreshToken += 1;
  const token = state.districtLabelRefreshToken;
  const zoom = map.getZoom();
  const viewBounds = map.getBounds().pad(0.06);
  const markers = [];
  state.districtNumberLayer.eachLayer((marker) => markers.push(marker));

  const chunkSize = 20;
  const processChunk = (startIdx) => {
    if (token !== state.districtLabelRefreshToken) return;
    const endIdx = Math.min(markers.length, startIdx + chunkSize);
    for (let i = startIdx; i < endIdx; i += 1) {
      refreshDistrictNumberMarker(markers[i], zoom, viewBounds);
    }
    if (endIdx < markers.length) {
      requestAnimationFrame(() => processChunk(endIdx));
    }
  };

  processChunk(0);
}

function refreshDistrictNumberMarker(marker, zoom, viewBounds) {
  const bounds = marker.__districtBounds;
  const text = String(marker.__districtText || "");
  const geometry = marker.__districtGeometry;
  if (!bounds || !bounds.isValid() || !text || !geometry) return;
  if (viewBounds && !viewBounds.intersects(bounds)) {
    setDistrictNumberMarkerLabel(marker, "", null);
    return;
  }

  const nw = map.latLngToContainerPoint(bounds.getNorthWest());
  const se = map.latLngToContainerPoint(bounds.getSouthEast());
  const width = Math.max(0, Math.abs(se.x - nw.x));
  const height = Math.max(0, Math.abs(se.y - nw.y));
  const minWidthNeeded = Math.max(10, text.length * 6.2);
  const centerPt = map.latLngToContainerPoint(bounds.getCenter());
  const visible = width >= minWidthNeeded && height >= 10;

  if (!visible) {
    setDistrictNumberMarkerLabel(marker, "", null);
    return;
  }

  const byWidth = width / Math.max(1, text.length * 0.82);
  const byHeight = height * 0.72;
  const startSize = Math.max(11, Math.min(22, Math.min(byWidth, byHeight)));
  if (marker.__pixelGeomZoom !== zoom || !marker.__pixelGeometry) {
    marker.__pixelGeometry = buildGeometryPixelCache(geometry);
    marker.__pixelGeomZoom = zoom;
  }
  const pixelGeometry = marker.__pixelGeometry;
  const bestPlacement = findBestLabelPlacement(text, pixelGeometry, startSize, centerPt, nw, se);
  if (!bestPlacement) {
    setDistrictNumberMarkerLabel(marker, "", null);
    return;
  }

  const latlng = map.containerPointToLatLng([bestPlacement.x, bestPlacement.y]);
  const html = `<span class="district-number-label" style="font-size:${bestPlacement.size.toFixed(1)}px;">${escapeHtml(text)}</span>`;
  setDistrictNumberMarkerLabel(marker, html, latlng);
}

function setDistrictNumberMarkerLabel(marker, html, latlng) {
  const nextHtml = String(html || "");
  const currentHtml = String(marker.__districtLabelHtml || "");
  const currentLatLng = marker.__districtLabelLatLng || null;
  const needsLatLngUpdate = Boolean(
    latlng &&
      (!currentLatLng ||
        Math.abs(currentLatLng.lat - latlng.lat) > 1e-7 ||
        Math.abs(currentLatLng.lng - latlng.lng) > 1e-7)
  );

  if (nextHtml !== currentHtml) {
    marker.setIcon(
      L.divIcon({
        className: "district-number-label-wrap",
        html: nextHtml,
      })
    );
    marker.__districtLabelHtml = nextHtml;
  }
  if (latlng && needsLatLngUpdate) {
    marker.setLatLng(latlng);
    marker.__districtLabelLatLng = latlng;
  }
  if (!latlng) {
    marker.__districtLabelLatLng = null;
  }
}

function fitLabelSizeInsideFeature(text, centerPt, geometry, startSize) {
  for (let size = startSize; size >= 10.5; size -= 0.5) {
    if (labelFitsFeature(text, centerPt, geometry, size)) return size;
  }
  return null;
}

function findBestLabelPlacement(text, geometry, startSize, centerPt, nw, se) {
  const candidates = [];
  const near = searchPlacementGrid(centerPt, geometry, Math.abs(se.x - nw.x), Math.abs(se.y - nw.y), 0.65, true);
  if (near && near.length) candidates.push(...near);
  const broad = searchPlacementBounds(centerPt, geometry, nw, se, true);
  if (broad && broad.length) candidates.push(...broad);

  if (!candidates.length) return null;
  // Deduplicate and cap checked points to avoid UI freeze on state load.
  const uniq = [];
  const seen = new Set();
  for (const p of candidates) {
    const key = `${Math.round(p.x)}|${Math.round(p.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
    if (uniq.length >= 40) break;
  }

  let best = null;
  for (const p of uniq) {
    const size = fitLabelSizeInsideFeature(text, p, geometry, startSize);
    if (!size) continue;
    if (size >= startSize - 0.4) return { ...p, size };
    if (!best || size > best.size || (Math.abs(size - best.size) < 0.01 && p.dist2 < best.dist2)) {
      best = { ...p, size };
    }
  }
  return best;
}

function searchPlacementGrid(centerPt, geometry, width, height, spread, returnAll = false) {
  const xStep = Math.max(2, width * 0.18 * spread);
  const yStep = Math.max(2, height * 0.18 * spread);
  const points = [];
  for (let ix = -2; ix <= 2; ix += 1) {
    for (let iy = -2; iy <= 2; iy += 1) {
      const x = centerPt.x + ix * xStep;
      const y = centerPt.y + iy * yStep;
      const dist2 = ix * ix + iy * iy;
      points.push({ x, y, dist2 });
    }
  }
  points.sort((a, b) => a.dist2 - b.dist2);
  if (returnAll) {
    return points.filter((p) => isPointInFeaturePixels(p, geometry)).map((p) => ({ x: p.x, y: p.y, dist2: p.dist2 }));
  }
  for (const p of points) {
    if (isPointInFeaturePixels(p, geometry)) return { x: p.x, y: p.y };
  }
  return null;
}

function searchPlacementBounds(centerPt, geometry, nw, se, returnAll = false) {
  const minX = Math.min(nw.x, se.x);
  const maxX = Math.max(nw.x, se.x);
  const minY = Math.min(nw.y, se.y);
  const maxY = Math.max(nw.y, se.y);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 2 || height < 2) return null;

  const cols = 6;
  const rows = 6;
  let best = null;
  const valid = [];

  for (let cx = 0; cx <= cols; cx += 1) {
    const x = minX + (width * cx) / cols;
    for (let cy = 0; cy <= rows; cy += 1) {
      const y = minY + (height * cy) / rows;
      const pt = { x, y };
      if (!isPointInFeaturePixels(pt, geometry)) continue;
      const dx = x - centerPt.x;
      const dy = y - centerPt.y;
      const dist2 = dx * dx + dy * dy;
      valid.push({ x, y, dist2 });
      if (!best || dist2 < best.dist2) best = { x, y, dist2 };
    }
  }

  if (returnAll) {
    valid.sort((a, b) => a.dist2 - b.dist2);
    return valid;
  }
  return best ? { x: best.x, y: best.y } : null;
}

function labelFitsFeature(text, centerPt, geometry, fontSize) {
  const width = text.length * fontSize * 0.56 + 2;
  const height = fontSize * 0.9;
  const x0 = centerPt.x - width / 2;
  const x1 = centerPt.x + width / 2;
  const y0 = centerPt.y - height / 2;
  const y1 = centerPt.y + height / 2;
  const insetX = (x1 - x0) * 0.45;
  const insetY = (y1 - y0) * 0.45;

  const sample = [
    { x: centerPt.x, y: centerPt.y },
    { x: centerPt.x - insetX, y: centerPt.y },
    { x: centerPt.x + insetX, y: centerPt.y },
    { x: centerPt.x, y: centerPt.y - insetY },
    { x: centerPt.x, y: centerPt.y + insetY },
  ];

  return sample.every((pt) => isPointInFeaturePixels(pt, geometry));
}

function isPointInFeaturePixels(pt, geometry) {
  if (!geometry) return false;

  if (geometry.__pixelPolygons) {
    return geometry.__pixelPolygons.some((poly) => isPointInPolygonPixels(pt, poly));
  }

  if (!geometry.type) return false;

  if (geometry.type === "Polygon") {
    return isPointInPolygonPixels(pt, geometry.coordinates || []);
  }
  if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates || [];
    return polys.some((poly) => isPointInPolygonPixels(pt, poly || []));
  }
  return false;
}

function isPointInPolygonPixels(pt, polygonCoords) {
  // Cached polygon format
  if (polygonCoords.outer && Array.isArray(polygonCoords.outer)) {
    const outer = polygonCoords.outer;
    if (outer.length < 3 || !pointInRing(pt, outer)) return false;
    const holes = polygonCoords.holes || [];
    for (const hole of holes) {
      if (hole.length >= 3 && pointInRing(pt, hole)) return false;
    }
    return true;
  }

  if (!Array.isArray(polygonCoords) || polygonCoords.length === 0) return false;

  const outer = toPixelRing(polygonCoords[0]);
  if (outer.length < 3 || !pointInRing(pt, outer)) return false;

  for (let i = 1; i < polygonCoords.length; i += 1) {
    const hole = toPixelRing(polygonCoords[i]);
    if (hole.length >= 3 && pointInRing(pt, hole)) return false;
  }
  return true;
}

function toPixelRing(coordRing) {
  if (!Array.isArray(coordRing)) return [];
  const out = [];
  for (const c of coordRing) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const p = map.latLngToContainerPoint([c[1], c[0]]);
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

function buildGeometryPixelCache(geometry) {
  if (!geometry || !geometry.type) return geometry;
  const out = { __pixelPolygons: [] };

  if (geometry.type === "Polygon") {
    const p = polygonToPixelStructure(geometry.coordinates || []);
    if (p) out.__pixelPolygons.push(p);
    return out;
  }
  if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates || []) {
      const p = polygonToPixelStructure(poly || []);
      if (p) out.__pixelPolygons.push(p);
    }
    return out;
  }
  return geometry;
}

function polygonToPixelStructure(coords) {
  if (!Array.isArray(coords) || !coords.length) return null;
  const outer = toPixelRing(coords[0]);
  if (outer.length < 3) return null;
  const holes = [];
  for (let i = 1; i < coords.length; i += 1) {
    const hole = toPixelRing(coords[i]);
    if (hole.length >= 3) holes.push(hole);
  }
  return { outer, holes };
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function districtBaseStyle(feature, dataMap) {
  if (isNhFloterialFeature(feature)) {
    return {
      weight: 2.8,
      color: "#0d1218",
      opacity: 0.98,
      fillOpacity: 0,
      fill: false,
    };
  }

  const filteredKeySet = filteredDistrictJoinKeySetForSelectedState();
  if (filteredKeySet) {
    const joinInfo = extractJoinIds(feature?.properties || {});
    if (!filteredKeySet.has(joinInfo.key)) {
      return {
        weight: 1.2,
        color: "#2f3c4b",
        opacity: 0.85,
        fillOpacity: 0.08,
        fillColor: "#b9c6d3",
      };
    }
  }
  return {
    weight: 1.4,
    color: "#1b2733",
    fillOpacity: 0.7,
    fillColor: colorForFeature(feature, dataMap),
  };
}

function isNhFloterialFeature(feature) {
  const code = normalizeNhFloterialCode(readProperty(feature?.properties || {}, "floathse22"));
  return !!code;
}
function districtHoverStyle(feature, dataMap) {
  return {
    ...districtBaseStyle(feature, dataMap),
    weight: 3.8,
    color: "#ffffff",
  };
}

function districtSelectedStyle(feature, dataMap) {
  return {
    ...districtBaseStyle(feature, dataMap),
    weight: 3.2,
    color: "#ffffff",
  };
}

function setSelectedDistrict(layer) {
  if (!layer) return;
  if (state.selectedDistrictLayer && state.selectedDistrictLayer !== layer) {
    resetDistrictStyle(state.selectedDistrictLayer);
  }

  state.selectedDistrictLayer = layer;
  const feature = layer.__featureRef;
  const dataMap = layer.__dataMapRef;
  layer.setStyle(districtSelectedStyle(feature, dataMap));
  layer.bringToFront();
  showSelectedDistrictOutline(feature);
  showChamberOverviewButton();
}

function resetDistrictStyle(layer) {
  if (!layer) return;
  const feature = layer.__featureRef;
  const dataMap = layer.__dataMapRef;
  if (!feature || !dataMap) return;
  layer.setStyle(districtBaseStyle(feature, dataMap));
}

function clearSelectedDistrict() {
  if (state.selectedDistrictLayer) {
    resetDistrictStyle(state.selectedDistrictLayer);
    state.selectedDistrictLayer = null;
  }
  clearSelectedDistrictOutline();
  hideChamberOverviewButton();
}

function showSelectedDistrictOutline(feature) {
  clearSelectedDistrictOutline();
  if (!feature) return;

  state.selectedDistrictOutlineLayer = L.geoJSON(feature, {
    pane: "districtHoverPane",
    interactive: false,
    style: {
      color: "#ffffff",
      weight: 4.6,
      opacity: 1,
      fillOpacity: 0,
    },
  }).addTo(map);
}

function clearSelectedDistrictOutline() {
  if (!state.selectedDistrictOutlineLayer) return;
  if (map.hasLayer(state.selectedDistrictOutlineLayer)) map.removeLayer(state.selectedDistrictOutlineLayer);
  state.selectedDistrictOutlineLayer = null;
}

function showDistrictHoverOutline(feature) {
  clearDistrictHoverOutline();
  if (!feature) return;

  state.hoverDistrictLayer = L.geoJSON(feature, {
    pane: "districtHoverPane",
    interactive: false,
    style: {
      color: "#ffffff",
      weight: 4.2,
      opacity: 1,
      fillOpacity: 0,
    },
  }).addTo(map);
}

function clearDistrictHoverOutline() {
  if (!state.hoverDistrictLayer) return;
  if (map.hasLayer(state.hoverDistrictLayer)) map.removeLayer(state.hoverDistrictLayer);
  state.hoverDistrictLayer = null;
}

function initHoverInfo() {
  const container = map.getContainer();
  const el = document.createElement("div");
  el.className = "district-hover-info";
  el.style.display = "none";
  container.appendChild(el);
  state.hoverInfoEl = el;
}

function initChamberOverviewButton() {
  const container = map.getContainer();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-overview-button";
  button.textContent = "Chamber Overview";
  button.setAttribute("aria-label", "Return to chamber overview");
  button.addEventListener("click", () => {
    if (state.hasOpenPopup) {
      map.closePopup();
      return;
    }
    clearSelectedDistrict();
    if (state.mode === "state") {
      showStateChamberOverview();
    }
  });
  container.appendChild(button);
  state.chamberOverviewBtnEl = button;
}

function showChamberOverviewButton() {
  if (!state.chamberOverviewBtnEl) return;
  state.chamberOverviewBtnEl.classList.add("visible");
}

function hideChamberOverviewButton() {
  if (!state.chamberOverviewBtnEl) return;
  state.chamberOverviewBtnEl.classList.remove("visible");
}

function showDistrictHoverInfo(containerPoint, html) {
  if (!state.hoverInfoEl) return;
  state.hoverInfoEl.innerHTML = html;
  state.hoverInfoEl.style.display = "block";
  moveDistrictHoverInfo(containerPoint);
}

function moveDistrictHoverInfo(containerPoint) {
  if (!state.hoverInfoEl || state.hoverInfoEl.style.display === "none" || !containerPoint) return;
  const offsetX = -14;
  const offsetY = 14;
  state.hoverInfoEl.style.left = `${containerPoint.x + offsetX}px`;
  state.hoverInfoEl.style.top = `${containerPoint.y + offsetY}px`;
  state.hoverInfoEl.style.transform = "translate(-100%, 0)";
}

function hideDistrictHoverInfo() {
  if (!state.hoverInfoEl) return;
  state.hoverInfoEl.style.display = "none";
}

async function updateCountyOverlayVisibility() {
  if (!state.countyVisible || state.mode !== "state" || !state.selectedState) {
    clearCountyLayers();
    return;
  }

  await ensureCountyShapeLoaded();
  if (!state.countyGeojson) {
    clearCountyLayers();
    return;
  }

  clearCountyLayers();
  const selectedStateFips = normalizeStateFips(state.selectedState.fips);
  const features =
    (selectedStateFips && state.countyFeaturesByState.get(selectedStateFips)) ||
    (state.countyGeojson.features || []).filter((feature) => featureMatchesSelectedState(feature.properties));
  if (!features.length) return;

  const selectedCountyGeojson = {
    type: "FeatureCollection",
    features,
  };

  state.countyLayer = L.geoJSON(selectedCountyGeojson, {
    pane: "countyPane",
    interactive: false,
    style: {
      color: "#4e5d6d",
      weight: 1.8,
      fillOpacity: 0,
    },
  }).addTo(map);

  state.countyLabelLayer = buildCountyLabelLayer(selectedCountyGeojson);
  refreshCountyLabels();
}

function buildCountyLabelLayer(geojson) {
  const group = L.layerGroup();
  for (const feature of geojson.features || []) {
    const name = String(readProperty(feature.properties, "NAMELSAD") || readProperty(feature.properties, "NAME") || "").trim().toUpperCase();
    if (!name) continue;
    const placement = countyLabelPlacement(feature);
    if (!placement) continue;
    L.marker(placement.latlng, {
      pane: "countyLabelPane",
      interactive: false,
      icon: L.divIcon({
        className: "county-label",
        html: `<span class="county-label-text" style="transform: rotate(${placement.angle}deg);">${escapeHtml(name)}</span>`,
      }),
    }).addTo(group);
  }
  return group;
}

function countyLabelPlacement(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;

  let lineSets = [];
  if (geometry.type === "Polygon") {
    lineSets = geometry.coordinates || [];
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates || []) {
      lineSets.push(...poly);
    }
  } else {
    return null;
  }

  let best = null;
  for (const ring of lineSets) {
    if (!Array.isArray(ring) || ring.length < 2) continue;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (!best || len2 > best.len2) {
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const normalizedAngle = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;
        best = {
          len2,
          latlng: L.latLng((a[1] + b[1]) / 2, (a[0] + b[0]) / 2),
          angle: normalizedAngle,
        };
      }
    }
  }
  return best ? { latlng: best.latlng, angle: best.angle } : null;
}

function refreshCountyLabels() {
  if (!state.countyLabelLayer) return;
  if (!state.countyVisible || state.mode !== "state") {
    if (map.hasLayer(state.countyLabelLayer)) map.removeLayer(state.countyLabelLayer);
    return;
  }

  if (map.getZoom() >= COUNTY_LABEL_MIN_ZOOM) {
    if (!map.hasLayer(state.countyLabelLayer)) map.addLayer(state.countyLabelLayer);
  } else if (map.hasLayer(state.countyLabelLayer)) {
    map.removeLayer(state.countyLabelLayer);
  }
}

function clearCountyLayers() {
  if (state.countyLayer && map.hasLayer(state.countyLayer)) map.removeLayer(state.countyLayer);
  if (state.countyLabelLayer && map.hasLayer(state.countyLabelLayer)) map.removeLayer(state.countyLabelLayer);
  state.countyLayer = null;
  state.countyLabelLayer = null;
}

function featureMatchesSelectedState(properties = {}) {
  if (!state.selectedState) return false;

  const featureFips = normalizeStateFips(readProperty(properties, "STATEFP") || readProperty(properties, "STATE_FIPS"));
  const featureAbbr = normalizeStateAbbr(readProperty(properties, "STUSPS") || readProperty(properties, "USPS") || readProperty(properties, "STATE_ABBR"));
  const featureName = normalizeTextKey(readProperty(properties, "NAME") || readProperty(properties, "STATE_NAME") || readProperty(properties, "STATENAME"));

  if (state.selectedState.fips && featureFips) return featureFips === state.selectedState.fips;
  if (state.selectedState.abbr && featureAbbr) return featureAbbr === state.selectedState.abbr;
  if (state.selectedState.name && featureName) return featureName === normalizeTextKey(state.selectedState.name);
  return false;
}

async function loadUrlZipToGeojson(url) {
  try {
    const response = await fetch(withCacheBust(url));
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const parsed = await shp(arrayBuffer);
    return toFeatureCollection(parsed);
  } catch (err) {
    console.warn(`Could not load ${url}: ${err.message}`);
    return null;
  }
}

function toFeatureCollection(parsed) {
  if (!parsed) throw new Error("No geometry found.");
  if (parsed.type === "FeatureCollection") return parsed;

  if (Array.isArray(parsed)) {
    const collection = parsed.find((item) => item && item.type === "FeatureCollection");
    if (collection) return collection;
  }

  if (typeof parsed === "object") {
    for (const key of Object.keys(parsed)) {
      const maybe = parsed[key];
      if (maybe && maybe.type === "FeatureCollection") return maybe;
    }
  }

  throw new Error("Could not find a FeatureCollection in uploaded zip.");
}

function buildDataMap(rows) {
  const m = new Map();
  for (const r of rows) {
    const districtId = normalizeDistrictId(r.district_id);
    const stateFips = normalizeStateFips(r.state_fips);
    m.set(makeJoinKey(stateFips, districtId), r);
  }
  return m;
}

async function loadTargetDistricts() {
  const jsonTargets = await loadTargetDistrictsFromJson();
  if (jsonTargets.length) return jsonTargets;
  return loadTargetDistrictsFromWorkbook();
}

async function loadTargetDistrictsFromJson() {
  for (const url of TARGET_DISTRICTS_JSON_URLS) {
    try {
      const response = await fetch(withCacheBust(url));
      if (!response.ok) continue;
      const data = await response.json();
      if (!Array.isArray(data)) continue;
      const normalized = normalizeTargetDistrictRows(data);
      if (normalized.length) return normalized;
    } catch (_err) {
      // Try next JSON source.
    }
  }
  return [];
}

function normalizeTargetDistrictRows(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const stateRaw = cleanCell(row?.stateAbbr ?? row?.state ?? row?.State);
    const chamberRaw = cleanCell(row?.chamber ?? row?.Chamber);
    const rawDistrict = cleanCell(row?.rawDistrict ?? row?.district ?? row?.District ?? row?.districtId ?? row?.["#"]);
    const stateAbbr = normalizeWorkbookState(stateRaw);
    const chamber = normalizeChamberLabel(chamberRaw);
    const districtId = normalizeDistrictId(rawDistrict);
    if (!stateAbbr || !chamber || !districtId) continue;
    const key = `${stateAbbr}|${chamber}|${districtId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      stateAbbr,
      chamber,
      districtId,
      rawDistrict: rawDistrict || districtId,
    });
  }
  return out;
}

async function loadChamberNamesFromWorkbook() {
  try {
    if (!(await ensureXlsxLibraryLoaded())) return new Map();

    let workbook = null;
    for (const workbookUrl of WORKBOOK_URLS) {
      try {
        const response = await fetch(withCacheBust(workbookUrl));
        if (!response.ok) continue;
        const bytes = await response.arrayBuffer();
        workbook = window.XLSX.read(bytes, { type: "array" });
        if (workbook) break;
      } catch (_err) {
        // Try next workbook path.
      }
    }
    if (!workbook) return new Map();

    const sheet = workbook.Sheets["Chamber Names"];
    if (!sheet) return new Map();

    const rows = window.XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });
    if (!Array.isArray(rows) || !rows.length) return new Map();

    const out = new Map();

    // Expected shape: State | Lower | Upper
    const header = (rows[0] || []).map((v) => cleanCell(v).toLowerCase());
    const colState = header.findIndex((v) => v === "state");
    const colLower = header.findIndex((v) => v === "lower");
    const colUpper = header.findIndex((v) => v === "upper");

    if (colState >= 0 && colLower >= 0 && colUpper >= 0) {
      for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i] || [];
        const stateAbbr = normalizeWorkbookState(cleanCell(row[colState]));
        if (!stateAbbr) continue;

        const lowerName = cleanCell(row[colLower]);
        const upperName = cleanCell(row[colUpper]);
        if (lowerName) out.set(`${stateAbbr}|house`, `${stateAbbr} ${lowerName}`);
        if (upperName) out.set(`${stateAbbr}|senate`, `${stateAbbr} ${upperName}`);
      }
      return out;
    }

    // Fallback for alternative formats: State | Chamber | Name
    const objects = window.XLSX.utils.sheet_to_json(sheet, { raw: false, defval: "" });
    for (const row of objects || []) {
      const stateRaw = cleanCell(
        row?.State ?? row?.STATE ?? row?.state ?? row?.StateAbbr ?? row?.State_ABBR ?? row?.Abbr ?? row?.ABBR ?? row?.ST
      );
      const chamberRaw = cleanCell(row?.Chamber ?? row?.CHAMBER ?? row?.chamber);
      const nameRaw = cleanCell(
        row?.OfficialName
          ?? row?.Official_Name
          ?? row?.Official
          ?? row?.Name
          ?? row?.["Chamber Name"]
          ?? row?.["Official Chamber Name"]
          ?? row?.name
      );

      const stateAbbr = normalizeWorkbookState(stateRaw);
      const chamber = normalizeChamberLabel(chamberRaw);
      if (!stateAbbr || !chamber || !nameRaw) continue;
      out.set(`${stateAbbr}|${chamber}`, nameRaw);
    }

    return out;
  } catch (err) {
    console.warn(`Could not load chamber names from workbook: ${err.message}`);
    return new Map();
  }
}

async function loadTargetDistrictsFromWorkbook() {
  try {
    if (!(await ensureXlsxLibraryLoaded())) return [];
    let workbook = null;
    for (const workbookUrl of WORKBOOK_URLS) {
      try {
        const response = await fetch(withCacheBust(workbookUrl));
        if (!response.ok) continue;
        const bytes = await response.arrayBuffer();
        workbook = window.XLSX.read(bytes, { type: "array" });
        if (workbook) break;
      } catch (_err) {
        // Try next workbook path.
      }
    }
    if (!workbook) return [];
    const overview = workbook.Sheets["Overview"] || workbook.Sheets[workbook.SheetNames[0]];
    if (!overview) return [];

    const rows = window.XLSX.utils.sheet_to_json(overview, {
      header: 1,
      raw: false,
      defval: "",
    });
    const table = extractTargetDistrictTable(rows);
    if (!table) return [];

    const targets = [];
    let emptyStreak = 0;
    for (let r = table.startRow; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const stateRaw = cleanCell(row[table.colState]);
      const chamberRaw = cleanCell(row[table.colChamber]);
      const districtRaw = cleanCell(row[table.colDistrict]);
      if (!stateRaw && !chamberRaw && !districtRaw) {
        emptyStreak += 1;
        if (emptyStreak >= 3) break;
        continue;
      }
      emptyStreak = 0;
      if (!stateRaw || !chamberRaw || !districtRaw) continue;
      const chamber = normalizeChamberLabel(chamberRaw);
      const districtId = normalizeDistrictId(districtRaw);
      const stateAbbr = normalizeWorkbookState(stateRaw);
      if (!stateAbbr || !chamber || !districtId) continue;
      targets.push({
        stateAbbr,
        chamber,
        districtId,
        rawDistrict: districtRaw,
      });
    }

    return normalizeTargetDistrictRows(targets);
  } catch (err) {
    console.warn(`Could not load target districts from workbook: ${err.message}`);
    return [];
  }
}

async function ensureXlsxLibraryLoaded() {
  if (window.XLSX) return true;
  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-xlsx-loader="1"]');
    if (existing) {
      if (existing.dataset.loaded === "1") {
        resolve(Boolean(window.XLSX));
        return;
      }
      existing.addEventListener("load", () => resolve(Boolean(window.XLSX)), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = XLSX_CDN_URL;
    script.async = true;
    script.defer = true;
    script.dataset.xlsxLoader = "1";
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "1";
        resolve(Boolean(window.XLSX));
      },
      { once: true }
    );
    script.addEventListener("error", () => resolve(false), { once: true });
    document.head.appendChild(script);
  });
}

function extractTargetDistrictTable(rows) {
  let titleRow = -1;
  let titleCol = -1;
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c += 1) {
      const value = cleanCell(row[c]).toUpperCase();
      if (value === "TARGET DISTRICTS") {
        titleRow = r;
        titleCol = c;
        break;
      }
    }
    if (titleRow >= 0) break;
  }
  if (titleRow < 0) return null;

  for (let r = titleRow + 1; r < Math.min(rows.length, titleRow + 8); r += 1) {
    const row = rows[r] || [];
    const map = {};
    for (let c = titleCol; c < Math.min(row.length, titleCol + 12); c += 1) {
      const header = cleanCell(row[c]).toLowerCase();
      if (!header) continue;
      map[header] = c;
    }
    const colState = map.state;
    const colChamber = map.chamber;
    const colDistrict = map.district ?? map["#"] ?? map.dist;
    if (Number.isInteger(colState) && Number.isInteger(colChamber) && Number.isInteger(colDistrict)) {
      return {
        colState,
        colChamber,
        colDistrict,
        startRow: r + 1,
      };
    }
  }
  return null;
}

function normalizeChamberLabel(text) {
  const value = String(text || "").trim().toLowerCase();
  if (value.includes("house")) return "house";
  if (value.includes("senate")) return "senate";
  return "";
}

function normalizeWorkbookState(text) {
  const value = String(text || "").trim().toUpperCase();
  if (value.length === 2) return value;
  return STATE_NAME_TO_ABBR[value] || "";
}

function cleanCell(value) {
  return String(value ?? "").trim();
}

function extractJoinIds(properties = {}) {
  const stateFips = normalizeStateFips(readProperty(properties, "STATEFP"));
  const districtField = districtFieldForChamber();
  const rawDistrict = readProperty(properties, districtField);
  const districtId = normalizeDistrictId(rawDistrict);
  return {
    stateFips,
    rawDistrict,
    districtId,
    key: makeJoinKey(stateFips, districtId),
  };
}

function districtFieldForChamber() {
  return state.chamber === "house" ? "SLDLST" : "SLDUST";
}

function makeJoinKey(stateFips, districtId) {
  return `${stateFips || ""}|${districtId || ""}`;
}

function normalizeStateFips(value) {
  const digits = String(value ?? "").trim().replace(/[^0-9]/g, "");
  return digits ? digits.padStart(2, "0") : "";
}

function normalizeDistrictId(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  if (/^[0-9]+$/.test(raw)) return raw.padStart(3, "0");
  return raw.replace(/\s+/g, "");
}

function popupDistrictTitle(properties, joinInfo) {
  const abbr = String(readProperty(properties, "STUSPS") || readProperty(properties, "STATE_ABBR") || state.selectedState?.abbr || "US").trim().toUpperCase();
  const district = displayDistrictId(joinInfo.rawDistrict, joinInfo.districtId);
  const chamberCode = state.chamber === "house" ? "HD" : "SD";
  return `${abbr} ${chamberCode}-${district}`;
}
function popupCandidateLineHtml(line) {
  const text = String(line || "");
  if (text.endsWith(" (R)")) {
    return `${escapeHtml(text.slice(0, -4))} (<span class="party-letter-r">R</span>)`;
  }
  if (text.endsWith(" (D)")) {
    return `${escapeHtml(text.slice(0, -4))} (<span class="party-letter-d">D</span>)`;
  }
  return escapeHtml(text);
}

function popupHtml(properties, joinInfo, rec) {
  const title = popupDistrictTitle(properties, joinInfo);
  if (!rec) {
    return `<strong>${escapeHtml(title)}</strong><br/>No joined data found.`;
  }

  const candidateLines = !recordIsUpIn2026(rec)
    ? ['<div class="popup-muted-line" style="text-align:center;">Not up in 2026</div>']
    : (() => {
        const seatOrderedCandidates = seatOrderedCandidateLines(rec);
        const fallbackRep = candidateDisplayLines(rec, "R", { includeParty: true, includeSeatLabel: true });
        const fallbackDem = candidateDisplayLines(rec, "D", { includeParty: true, includeSeatLabel: true });
        return (seatOrderedCandidates.length ? seatOrderedCandidates : [...fallbackRep, ...fallbackDem]).map((line) => {
          if (!line) return "";
          if (isNoCandidateLine(line)) return `&nbsp;&nbsp;<span class="muted-inline">${popupCandidateLineHtml(line)}</span>`;
          return `&nbsp;&nbsp;${popupCandidateLineHtml(line)}`;
        });
      })();

  const incumbentParty = String(rec?.incumbent?.party || "").trim().toUpperCase();
  const incumbentPartyHtml = incumbentParty === "R"
    ? '(<span class="party-letter-r">R</span>)'
    : incumbentParty === "D"
      ? '(<span class="party-letter-d">D</span>)'
      : '';
  const incumbentLine = `&nbsp;&nbsp;Inc: ${escapeHtml(String(rec?.incumbent?.name || "Vacant").trim() || "Vacant")} ${incumbentPartyHtml}`;
  const hmModelView = modelViewKeyForVariant(rec, "hm");
  const hmModelLine = hmModelView
    ? `&nbsp;&nbsp;Model (H+M): ${formatMarginHtml(getMarginForView(rec, hmModelView))}`
    : null;

  const summaryLines = state.projectionMode
    ? [
        incumbentLine,
        ...(hmModelLine ? [hmModelLine] : []),
        `&nbsp;&nbsp;${projectionBaseDisplayLabel(rec)}: ${formatMarginHtml(projectionBaseMarginForRecord(rec))}`,
        `&nbsp;&nbsp;Proj 2026: ${formatMarginHtml(projectedMarginForRecord(rec))}`,
      ]
    : [
        incumbentLine,
        ...(hmModelLine ? [hmModelLine] : []),
        `&nbsp;&nbsp;${latestLegDisplayLabel(rec)}: ${formatMarginHtml(getMarginForView(rec, "latest_leg"))}`,
        `&nbsp;&nbsp;2024 Pres: ${formatMarginHtml(getMarginForView(rec, "pres_2024"))}`,
      ];

  return [
    `<strong>${escapeHtml(title)}</strong>`,
    ...summaryLines,
    "",
    "2026 Candidates",
    ...candidateLines,
  ].join("<br/>");
}

function latestLegDisplayLabel(rec) {
  const years = [2025, 2024, 2023, 2022];
  for (const year of years) {
    const margin = marginForYear(rec, year);
    if (typeof margin === "number") return `${year} Leg`;
  }
  return "Latest Leg";
}

function modelViewKeyForVariant(rec, variant) {
  const models = rec?.models;
  if (!models || typeof models !== "object") return null;
  const suffix = variant === "hm" ? "_hm" : "_all";
  return Object.keys(models).find((key) => !!parseModelViewKey(key) && key.endsWith(suffix)) || null;
}

function activeModelViewForRecord(rec) {
  const models = rec?.models;
  if (!models || typeof models !== "object") return null;
  const preferredVariantView = modelViewKeyForVariant(rec, state.modelingVariant);
  if (preferredVariantView) return preferredVariantView;
  if (parseModelViewKey(state.mapView) && models[state.mapView]) return state.mapView;
  return modelViewKeyForVariant(rec, "all") || modelViewKeyForVariant(rec, "hm") || Object.keys(models).find((key) => !!parseModelViewKey(key)) || null;
}

function wireModelingPanelInteractions(properties, joinInfo, rec) {
  const buttons = details.querySelectorAll("[data-modeling-variant]");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const variant = String(button.dataset.modelingVariant || "").trim();
      if (variant !== "all" && variant !== "hm") return;
      if (state.modelingVariant === variant) return;
      state.modelingVariant = variant;
      const scrollTop = details.scrollTop;
      showDistrictDetailPanel(properties, joinInfo, rec, { resetScroll: false, preserveScrollTop: scrollTop });
    });
  });
}

function showDistrictDetailPanel(properties, joinInfo, rec, options = {}) {
  const { resetScroll = true, preserveScrollTop = null } = options;
  state.detailsRenderToken += 1;
  detailsTitle.textContent = districtTitle(properties, joinInfo, rec);
  details.innerHTML = detailHtml(properties, joinInfo, rec);
  wireModelingPanelInteractions(properties, joinInfo, rec);
  if (typeof preserveScrollTop === "number") {
    details.scrollTop = preserveScrollTop;
  } else if (resetScroll) {
    resetSidebarScroll();
  }
}

function affinitySegmentsForModel(model) {
  const affinity = model?.affinity;
  if (!affinity || typeof affinity !== "object") return [];
  if (Array.isArray(affinity.segments) && affinity.segments.length) {
    const familyKey = String(model?.family || "").trim().toUpperCase();
    const palette = MODEL_SEGMENT_COLOR_CLASSES[familyKey] || [];
    return affinity.segments.map((segment, idx) => ({
      label: segment?.label || `Bucket ${idx + 1}`,
      value: typeof segment?.value === "number" ? segment.value : Number(segment?.value || 0),
      colorClass: palette[idx] || (idx % 2 === 0 ? "color-model-gop-target" : "color-model-dem-likely"),
    }));
  }

  return [
    { label: "GOP Base", value: affinity.gop_base, colorClass: "color-model-gop-base" },
    { label: "GOP Target", value: affinity.gop_target, colorClass: "color-model-gop-target" },
    { label: "Swing", value: affinity.swing, colorClass: "color-model-swing" },
    { label: "Likely Dem", value: affinity.dem_likely, colorClass: "color-model-dem-likely" },
    { label: "Dem Base", value: affinity.dem_base, colorClass: "color-model-dem-base" },
  ].filter((segment) => typeof segment.value === "number");
}

function modelingPanelHtml(rec) {
  const modelView = activeModelViewForRecord(rec);
  const model = modelView ? rec?.models?.[modelView] : null;
  if (!model) {
    return `
      <div class="detail-section-title centered-section-title large-section-title">Modeling</div>
      <div class="detail-row">No modeling data.</div>
    `;
  }

  const modelMeta = parseModelViewKey(modelView);
  const affinity = model.affinity || null;
  const education = model.education || null;
  const allView = modelViewKeyForVariant(rec, "all");
  const hmView = modelViewKeyForVariant(rec, "hm");
  const activeVariant = modelVariantFromViewKey(modelView) || "all";
  const blocks = [];

  if (affinity) {
    const affinitySegments = affinitySegmentsForModel(model);
    if (affinitySegments.length) {
      blocks.push(
        stackedBreakdownHtml(
          `Affinity Model: ${formatMarginHtml(getMarginForView(rec, modelView))}`,
          affinitySegments,
          {
            normalizeTo100: true,
            legendColumns: String(model?.family || "").trim().toUpperCase() === "RSLC" ? 3 : 2,
          }
        )
      );
    }
  }

  if (education) {
    blocks.push(
      stackedBreakdownHtml(
        "Modeled Education",
        [
          { label: "Non-College", value: education.non_college, colorClass: "color-edu-noncollege" },
          { label: "College", value: education.college, colorClass: "color-edu-college" },
        ],
        { normalizeTo100: true }
      )
    );
  }

  return `
    <div class="detail-section-title centered-section-title large-section-title">Modeling</div>
    <div class="modeling-subheader-row">
      <div class="detail-row modeling-variant-note">${escapeHtml(model.family || "Model")}</div>
      <div class="modeling-switch" role="group" aria-label="Modeling variant">
        <button type="button" class="modeling-switch-btn ${activeVariant === "hm" ? "active" : ""}" data-modeling-variant="hm" ${hmView ? "" : "disabled"}>H+M</button>
        <button type="button" class="modeling-switch-btn ${activeVariant === "all" ? "active" : ""}" data-modeling-variant="all" ${allView ? "" : "disabled"}>All</button>
      </div>
    </div>
    ${blocks.join("") || '<div class="detail-row">No modeling data.</div>'}
  `;
}

function detailHtml(properties, joinInfo, rec) {
  if (!rec) {
    return `<div>No joined data found.</div>`;
  }

  const metro = rec.demographics || {};
  const income = rec.demographics?.income_brackets || {};
  const incomeUnknown = safePct(income.unknown_pct);
  const raceOther = clampPct(100 - safePct(rec.demographics.white_pct) - safePct(rec.demographics.black_pct) - safePct(rec.demographics.hispanic_pct) - safePct(rec.demographics.asian_pct));
  const educationUnknown = safePct(rec.demographics.education_unknown_pct);
  const educationPostGrad = safePct(rec.demographics.post_grad_pct);
  const educationCollegeOnly = safePct(rec.demographics.college_pct);
  const educationNonCollege = clampPct(100 - educationCollegeOnly - educationPostGrad - educationUnknown);
  const incumbentRowsHtml = incumbentRowsForDetail(rec);
  const candidateRowsHtml = candidateRowsForDetail(rec);
  const pastElectionRows = pastElectionRowsHtml(rec);
  const pastTurnoutRows = pastTurnoutRowsHtml(rec);
  const metroChart = stackedBreakdownHtml("Metro Type", [
    { label: "Rural", value: metro.rural_pct, colorClass: "color-metro-rural" },
    { label: "Town", value: metro.town_pct, colorClass: "color-metro-town" },
    { label: "Suburban", value: metro.suburban_pct, colorClass: "color-metro-suburban" },
    { label: "Urban", value: metro.urban_pct, colorClass: "color-metro-urban" },
  ]);
  const incomeChart = stackedBreakdownHtml("Household Income", [
    { label: "<$50k", value: income.lt_50k, colorClass: "color-income-lt50k" },
    { label: "$50k-$100k", value: income.between_50_100k, colorClass: "color-income-50to100k" },
    { label: ">$150k", value: income.gt_150k, colorClass: "color-income-gt150k" },
    { label: "Unknown", value: incomeUnknown, colorClass: "color-unknown" },
  ]);
  const educationChart = stackedBreakdownHtml("Education", [
    { label: "Non-College", value: educationNonCollege, colorClass: "color-edu-noncollege" },
    { label: "College", value: educationCollegeOnly, colorClass: "color-edu-college" },
    { label: "Post-Grad", value: educationPostGrad, colorClass: "color-edu-postgrad" },
    { label: "Unknown", value: educationUnknown, colorClass: "color-unknown" },
  ]);
  const raceChart = stackedBreakdownHtml("Ethnicity", [
    { label: "White", value: rec.demographics.white_pct, colorClass: "color-race-white" },
    { label: "Hispanic", value: rec.demographics.hispanic_pct, colorClass: "color-race-hispanic" },
    { label: "Black", value: rec.demographics.black_pct, colorClass: "color-race-black" },
    { label: "Asian", value: rec.demographics.asian_pct, colorClass: "color-race-asian" },
    { label: "Other", value: raceOther, colorClass: "color-race-other" },
  ]);
  const modelingPanel = modelingPanelHtml(rec);
  const pollingPanel = `
    <div class="detail-section-title centered-section-title large-section-title">Polling</div>
    <div class="detail-row">No polling data.</div>
  `;
  const demographicsPanel = `
    <div class="detail-section-title centered-section-title large-section-title">Demographics</div>
    ${metroChart}
    ${raceChart}
    ${incomeChart}
    ${educationChart}
  `;

  return `
    ${incumbentRowsHtml}
    <div class="detail-section-title large-section-title candidates-title">2026 Candidates</div>
    ${candidateRowsHtml}
    <div class="detail-break"></div>

    <div class="detail-section">
      <div class="detail-section-title centered-section-title large-section-title">Past Election Results</div>
      <div class="past-election-grid">${pastElectionRows}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title centered-section-title large-section-title">Past Turnout</div>
      <div class="past-election-grid">${pastTurnoutRows}</div>
    </div>

    <div class="detail-section">
      ${modelingPanel}
    </div>

    <div class="detail-section">
      <div class="split-two-col">
        <div class="split-col-left">${pollingPanel}</div>
        <div class="split-col-right">${demographicsPanel}</div>
      </div>
    </div>
  `;
}

function districtTitle(properties, joinInfo, rec = null) {
  const stateName = state.selectedState?.name || String(readProperty(properties, "STATE_NAME") || "").trim();
  const stateAbbr = normalizeStateAbbr(state.selectedState?.abbr || readProperty(properties, "STUSPS") || readProperty(properties, "STATE_ABBR") || "");
  const chamberLabel = chamberOverviewHeaderForState({ name: stateName, abbr: stateAbbr }, state.chamber);

  let district = displayDistrictId(joinInfo.rawDistrict, joinInfo.districtId);
  if (state.chamber === "house" && (stateAbbr === "NH" || stateAbbr === "MA")) {
    const fullName = districtNameDisplayForRecord(rec || {});
    if (fullName) district = fullName;
  }
  return `${chamberLabel} District ${district}`;
}
function displayDistrictId(rawDistrict, fallbackDistrictId) {
  const raw = String(rawDistrict || fallbackDistrictId || "").trim().toUpperCase();
  if (!raw) return "";
  if (/^[0-9]+$/.test(raw)) return String(Number(raw));

  const mixedNumericPrefix = raw.match(/^0*([0-9]+)([A-Z]+)$/);
  if (mixedNumericPrefix) return `${Number(mixedNumericPrefix[1])}${mixedNumericPrefix[2]}`;

  if (/^0+[A-Z]+$/.test(raw)) return raw.replace(/^0+/, "");
  return raw;
}

function incumbentRowsForDetail(rec) {
  const members = recordMembers(rec);
  if (!members.length) {
    return `<div class="detail-meta incumbent-detail-meta">Incumbent: Vacant</div>`;
  }
  return members
    .map((member, idx) => {
      const fallbackSeat = members.length > 1 ? `Seat ${idx + 1}` : "";
      const labelBase = member.seat_label || fallbackSeat;
      const label = labelBase ? `${labelBase} Incumbent` : "Incumbent";
      if (!hasIncumbentForMember(member)) {
        return `<div class="detail-meta detail-meta-muted incumbent-detail-meta">${escapeHtml(label)}: Vacant</div>`;
      }
      const name = String(member?.incumbent?.name || "").trim();
      const party = String(member?.incumbent?.party || "").trim().toUpperCase();
      const partyHtml = party === "R"
        ? '(<span class="party-letter-r">R</span>)'
        : party === "D"
          ? '(<span class="party-letter-d">D</span>)'
          : "";
      const fadedClass = recordIsUpIn2026(rec) && !memberIncumbentRunningFor2026(member) ? ' incumbent-detail-meta-faded' : '';
      return `<div class="detail-meta incumbent-detail-meta${fadedClass}">${escapeHtml(label)}: ${escapeHtml(name)} ${partyHtml}</div>`;
    })
    .join("");
}

function candidateRowsForDetail(rec) {
  if (!recordIsUpIn2026(rec)) {
    return '<div class="candidate-party-cell candidate-party-unavailable">Not up in 2026</div>';
  }

  const members = membersForCandidateDisplay(rec);
  if (!members.length) {
    return '<div class="candidate-party-cell candidate-party-unavailable">No candidate</div>';
  }

  const showSeatBlocks = members.length > 1 || members.some((m) => !!m?.seat_label);

  return members
    .map((member, idx) => {
      const seatLabel = member.seat_label || `Seat ${idx + 1}`;
      const rep = normalizeCandidateName(member?.candidates?.rep);
      const dem = normalizeCandidateName(member?.candidates?.dem);
      const repInc = memberIsIncumbentNominee(member, "R") && hasNamedCandidate(rep) ? "*" : "";
      const demInc = memberIsIncumbentNominee(member, "D") && hasNamedCandidate(dem) ? "*" : "";
      const repClass = hasNamedCandidate(rep) ? "candidate-party-cell candidate-party-r" : "candidate-party-cell candidate-party-r candidate-party-muted";
      const demClass = hasNamedCandidate(dem) ? "candidate-party-cell candidate-party-d" : "candidate-party-cell candidate-party-d candidate-party-muted";
      const seatHeader = showSeatBlocks ? `<div class="candidate-seat-header">${escapeHtml(seatLabel)}</div>` : "";
      return `
        <div class="candidate-stack${showSeatBlocks ? ' candidate-stack-with-seat' : ''}">
          ${seatHeader}
          <div class="candidate-stack-row">
            <div class="candidate-stack-label candidate-grid-head-r">Republican</div>
            <div class="${repClass}">${escapeHtml(rep + repInc)}</div>
          </div>
          <div class="candidate-stack-row">
            <div class="candidate-stack-label candidate-grid-head-d">Democrat</div>
            <div class="${demClass}">${escapeHtml(dem + demInc)}</div>
          </div>
        </div>
      `;
    })
    .join("");
}
function incumbentDisplayForMember(member) {
  if (!hasIncumbentForMember(member)) return "Vacant";
  const name = String(member?.incumbent?.name || "").trim();
  const party = String(member?.incumbent?.party || "").trim().toUpperCase();
  if (party === "R" || party === "D") return `${name} (${party})`;
  return name;
}

function candidateDisplay(rec, party) {
  const lines = candidateDisplayLines(rec, party, { includeParty: true, includeSeatLabel: true });
  return lines[0] || `No candidate (${party})`;
}

function hasIncumbentForMember(member) {
  const name = String(member?.incumbent?.name || "").trim();
  if (!name) return false;
  const upper = name.toUpperCase();
  return upper !== "UNKNOWN" && upper !== "VACANT" && upper !== "OPEN";
}

function hasIncumbent(rec) {
  return recordMembers(rec).some((member) => hasIncumbentForMember(member));
}

function incumbentDisplay(rec) {
  const members = recordMembers(rec);
  if (!members.length) return "Vacant";
  const firstNamed = members.find((member) => hasIncumbentForMember(member));
  return incumbentDisplayForMember(firstNamed || members[0]);
}

function isIncumbentNominee(rec) {
  const members = recordMembers(rec);
  return members.some((member) => memberIsIncumbentNominee(member, "R") || memberIsIncumbentNominee(member, "D"));
}

function turnoutByYear(rec) {
  const totalRegistered = Number(rec.demographics?.population || 0);
  const byYear = new Map();

  const pres24Total = Number(rec.top_ticket_totals?.pres_2024 || 0);
  if (totalRegistered > 0 && pres24Total > 0) {
    const turnout = clampPct((pres24Total / totalRegistered) * 100);
    byYear.set(2024, [turnoutChartBlock("2024 Presidential Turnout", turnout, pres24Total, totalRegistered)]);
  }

  const gov22Total = Number(rec.top_ticket_totals?.gov_2022 || 0);
  const sen22Total = Number(rec.top_ticket_totals?.ussen_2022 || 0);
  const midterm22Total = Math.max(gov22Total, sen22Total);
  if (totalRegistered > 0 && midterm22Total > 0) {
    const turnout = clampPct((midterm22Total / totalRegistered) * 100);
    byYear.set(2022, [turnoutChartBlock("2022 Midterm Turnout", turnout, midterm22Total, totalRegistered)]);
  }

  return {
    totalRegistered,
    byYear,
  };
}

function yearColumnGridHtml(byYear, options = {}) {
  const { emptyMessage = "No data available." } = options;
  const leftYears = [2025, 2024];
  const rightYears = [2023, 2022];

  const buildColumn = (years) => {
    const blocks = years
      .map((year) => {
        const items = byYear.get(year) || [];
        if (!items.length) return "";
        return `<div class="past-year-block"><div class="past-year-block-body">${items.join("")}</div></div>`;
      })
      .filter(Boolean)
      .join("");
    return blocks || `<div class="detail-row">${escapeHtml(emptyMessage)}</div>`;
  };

  const hasAny = [...byYear.values()].some((items) => Array.isArray(items) && items.length);
  if (!hasAny) {
    return `<div class="detail-row">${escapeHtml(emptyMessage)}</div>`;
  }

  return `
    <div class="past-election-two-col">
      <div class="past-election-column past-election-column-left">${buildColumn(leftYears)}</div>
      <div class="past-election-column past-election-column-right">${buildColumn(rightYears)}</div>
    </div>
  `;
}

function pastElectionRowsHtml(rec) {
  const grouped = groupElectionRows(rec);
  return yearColumnGridHtml(grouped.byYear, { emptyMessage: "No election history available." });
}

function pastTurnoutRowsHtml(rec) {
  const turnout = turnoutByYear(rec);
  return yearColumnGridHtml(turnout.byYear, { emptyMessage: "No turnout history available." });
}

function turnoutChartBlock(label, turnoutPct, turnoutVotes, totalRegistered) {
  const turnout = clampPct(safePct(turnoutPct));
  const remainder = clampPct(100 - turnout);
  const turnoutVotesInt = Number.isFinite(Number(turnoutVotes)) ? Number(turnoutVotes) : 0;
  const registeredInt = Number.isFinite(Number(totalRegistered)) ? Number(totalRegistered) : 0;
  return `
    <div class="election-chart-block turnout-chart-block">
      <div class="detail-subtitle centered-subtitle chart-header">${escapeHtml(label)}</div>
      <div class="stacked-chart">
        <div class="stacked-segment turnout-segment" style="width:${widthPct(turnout)}"></div>
        <div class="stacked-segment turnout-remainder" style="width:${widthPct(remainder)}"></div>
      </div>
      <div class="turnout-detail">Turnout: ${turnoutVotesInt.toLocaleString()} / ${registeredInt.toLocaleString()} (${turnout.toFixed(1)}%)</div>
    </div>
  `;
}

function groupElectionRows(rec) {
  const legLabel = state.chamber === "senate" ? "State Leg" : "State Leg";
  const byYear = new Map();

  const pushYearRow = (year, priority, html) => {
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({ priority, html });
  };

  const legElections = [...(rec.elections || [])]
    .filter((e) => Number.isFinite(Number(e?.year)) && typeof e.dem_pct === "number" && typeof e.rep_pct === "number")
    .sort((a, b) => Number(b.year) - Number(a.year));

  for (const election of legElections) {
    const year = Number(election.year);
    pushYearRow(year, 3, electionChartBlock(`${year} ${legLabel}`, election.rep_pct, election.dem_pct));
  }

  const presMargin = getMarginForView(rec, "pres_2024");
  if (typeof presMargin === "number") {
    const presDem = clampPct(50 + presMargin / 2);
    const presRep = clampPct(50 - presMargin / 2);
    pushYearRow(2024, 0, electionChartBlock("2024 Presidential", presRep, presDem));
  }

  const ussenMargin = getMarginForView(rec, "ussen_2022");
  if (typeof ussenMargin === "number") {
    const ussenDem = clampPct(50 + ussenMargin / 2);
    const ussenRep = clampPct(50 - ussenMargin / 2);
    pushYearRow(2022, 1, electionChartBlock("2022 US Senate", ussenRep, ussenDem));
  }

  const govMargin = getMarginForView(rec, "gov_2022");
  if (typeof govMargin === "number") {
    const govDem = clampPct(50 + govMargin / 2);
    const govRep = clampPct(50 - govMargin / 2);
    pushYearRow(2022, 2, electionChartBlock("2022 Governor", govRep, govDem));
  }

  const years = [...byYear.keys()].sort((a, b) => b - a);
  const rowHtmlByYear = new Map();
  for (const year of years) {
    rowHtmlByYear.set(
      year,
      byYear
        .get(year)
        .sort((a, b) => a.priority - b.priority)
        .map((row) => row.html)
    );
  }

  return {
    years,
    byYear: rowHtmlByYear,
  };
}

function electionChartBlock(label, repPct, demPct) {
  const rep = safePct(repPct);
  const dem = safePct(demPct);
  const others = clampPct(100 - rep - dem);
  const margin = dem - rep;

  const chart = stackedBreakdownHtml(
    `${label}: ${formatMarginHtml(margin)}`,
    [
      { label: "Republican", value: rep, colorClass: "color-party-r" },
      { label: "Democrat", value: dem, colorClass: "color-party-d" },
      { label: "Others", value: others, colorClass: "color-party-other" },
    ],
    { showLegend: false, segmentFormatter: electionPct }
  );

  return `<div class="election-chart-block">${chart}</div>`;
}

function colorForFeature(feature, dataMap) {
  const rec = dataMap.get(extractJoinIds(feature.properties).key);
  if (!rec) return "#d5dae0";

  const margin = state.projectionMode ? projectedMarginForRecord(rec) : getMarginForView(rec, state.mapView);
  if (typeof margin !== "number") return "#d5dae0";
  return marginColor(margin);
}

function getMarginForView(rec, view) {
  if (!rec) return null;
  let cache = rec.__marginCache;
  if (!cache) {
    cache = {};
    Object.defineProperty(rec, "__marginCache", {
      value: cache,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  if (Object.prototype.hasOwnProperty.call(cache, view)) {
    return cache[view];
  }

  let margin = null;
  if (view === "latest_leg") {
    margin = latestMargin(rec);
    cache[view] = margin;
    return margin;
  }

  if (rec.view_margins && typeof rec.view_margins[view] === "number") {
    margin = rec.view_margins[view];
    if (String(view).startsWith("model_rslc_")) {
      margin = -margin;
    }
    cache[view] = margin;
    return margin;
  }

  const parsed = parseMapViewKey(view);
  if (!parsed) {
    cache[view] = null;
    return null;
  }
  if (parsed.type === "leg") {
    margin = marginForYear(rec, parsed.year);
    cache[view] = margin;
    return margin;
  }

  const key = `${parsed.type}_${parsed.year}_margin`;
  if (typeof rec[key] === "number") {
    margin = rec[key];
    cache[view] = margin;
    return margin;
  }

  const viewMargins = rec?.view_margins || {};
  if (typeof viewMargins[parsed.key] === "number") {
    margin = viewMargins[parsed.key];
    cache[view] = margin;
    return margin;
  }

  cache[view] = null;
  return null;
}

function latestMargin(rec) {
  for (const year of [2025, 2024, 2023, 2022]) {
    const margin = marginForYear(rec, year);
    if (typeof margin === "number") return margin;
  }
  return null;
}

function marginForYear(rec, year) {
  if (!rec) return null;
  let cache = rec.__legMarginByYear;
  if (!cache) {
    cache = {};
    for (const election of rec.elections || []) {
      const y = Number(election?.year);
      if (!Number.isFinite(y)) continue;
      if (typeof election?.dem_pct !== "number" || typeof election?.rep_pct !== "number") continue;
      cache[y] = election.dem_pct - election.rep_pct;
    }
    Object.defineProperty(rec, "__legMarginByYear", {
      value: cache,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  if (Object.prototype.hasOwnProperty.call(cache, year)) return cache[year];

  const key = `state_leg_${year}_margin`;
  if (typeof rec[key] === "number") {
    cache[year] = rec[key];
    return rec[key];
  }
  cache[year] = null;
  return null;
}

function latestElection(rec) {
  const rows = [...(rec.elections || [])];
  if (!rows.length) return null;
  rows.sort((a, b) => b.year - a.year);
  return rows[0];
}

function formatMargin(margin) {
  const clampedMargin = clampDisplayMarginValue(margin);
  if (typeof clampedMargin !== "number") return "N/A";
  if (clampedMargin > 0) return `D+${Math.abs(clampedMargin).toFixed(1)}`;
  if (clampedMargin < 0) return `R+${Math.abs(clampedMargin).toFixed(1)}`;
  return "EVEN";
}

function formatMarginHtml(margin) {
  const text = formatMargin(margin);
  if (text.startsWith("R+")) return `<span class="margin-r">${escapeHtml(text)}</span>`;
  if (text.startsWith("D+")) return `<span class="margin-d">${escapeHtml(text)}</span>`;
  return escapeHtml(text);
}

function marginColor(margin) {
  if (Math.abs(margin) < 0.0001) return "#f0f2f5";
  if (margin > 0) return interpolateHex("#cfe2ff", "#257BF8", Math.min(margin, 10) / 10);
  return interpolateHex("#ffd4dc", "#F82644", Math.min(Math.abs(margin), 10) / 10);
}

function nationalOverviewMarginColor(margin) {
  if (Math.abs(margin) < 0.0001) return "#f0f2f5";
  if (margin > 0) return interpolateHex("#cfe2ff", "#257BF8", Math.min(margin, 20) / 20);
  return interpolateHex("#ffd4dc", "#F82644", Math.min(Math.abs(margin), 20) / 20);
}
function widthPct(value) {
  if (typeof value !== "number") return "0%";
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped}%`;
}

function safePct(value) {
  return typeof value === "number" ? value : 0;
}

function clampPct(value) {
  if (typeof value !== "number") return 0;
  return Math.max(0, Math.min(100, value));
}

function shortPct(value) {
  return `${Math.round(safePct(value))}%`;
}

function barPct(value) {
  return `${Math.round(safePct(value))}%`;
}

function electionPct(value) {
  return `${safePct(value).toFixed(1)}%`;
}

function stackedBreakdownHtml(title, items, options = {}) {
  const cleaned = items
    .map((item) => ({
      ...item,
      value: clampPct(safePct(item.value)),
    }));

  const normalized = options.normalizeTo100
    ? normalizeTo100(cleaned)
    : cleaned;

  const chartItems = normalized.filter((item) => item.value > 0.01);

  const segmentFormatter = options.segmentFormatter || barPct;

  const segments = chartItems
    .map((item) => {
      const showLabel = item.value >= 6.3;
      return `
        <div class="stacked-segment ${item.colorClass}" style="width:${widthPct(item.value)}">
          ${showLabel ? `<span class="stacked-segment-label">${escapeHtml(segmentFormatter(item.value))}</span>` : ""}
        </div>
      `;
    })
    .join("");

  const legendColumns = Math.max(1, Math.min(3, Number(options.legendColumns) || 2));
  const legendClass = legendColumns === 3 ? "three-col" : "two-col";
  const legendRows = Math.ceil(normalized.length / legendColumns);
  const legend = normalized
    .map(
      (item) => `
      <div class="stacked-legend-item">
        <span class="stacked-swatch ${item.colorClass}"></span>
        <span>${escapeHtml(item.label)}: ${escapeHtml(shortPct(item.value))}</span>
      </div>
    `
    )
    .join("");
  const showLegend = options.showLegend !== false;
  const headerClass = options.headerClass || "chart-header";

  return `
    <div class="detail-subtitle centered-subtitle ${headerClass}">${title}</div>
    <div class="stacked-chart">${segments}</div>
    ${showLegend ? `<div class="stacked-legend ${legendClass}" style="--legend-rows:${legendRows};">${legend}</div>` : ""}
    <div class="detail-break"></div>
  `;
}

function normalizeTo100(items) {
  const sum = items.reduce((acc, item) => acc + safePct(item.value), 0);
  if (sum <= 0.01) return items.map((item) => ({ ...item, value: 0 }));
  return items.map((item) => ({
    ...item,
    value: clampPct((safePct(item.value) * 100) / sum),
  }));
}

async function setChamber(chamber) {
  if (chamber !== "house" && chamber !== "senate") return;
  if (state.chamber === chamber) return;
  state.chamber = chamber;
  refreshTargetJoinKeySet();
  renderModeUi();
  if (state.mode === "state") {
    await ensureDistrictShapesLoaded();
    renderDistrictLayerForSelectedState();
  }
}

function readProperty(properties, key) {
  if (!key || !properties) return "";
  return properties[key] ?? properties[key.toUpperCase()] ?? properties[key.toLowerCase()] ?? "";
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function interpolateHex(lightHex, darkHex, t) {
  const a = hexToRgb(lightHex);
  const b = hexToRgb(darkHex);
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(a.r + (b.r - a.r) * clamped);
  const g = Math.round(a.g + (b.g - a.g) * clamped);
  const bVal = Math.round(a.b + (b.b - a.b) * clamped);
  return rgbToHex(r, g, bVal);
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(n) {
  return n.toString(16).padStart(2, "0");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setStatus(msg) {
  if (statusText) statusText.textContent = msg;
}






































