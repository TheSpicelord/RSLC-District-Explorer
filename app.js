const NATIONAL_CENTER = [39.5, -98.35];
const NATIONAL_ZOOM = 4;
const COUNTY_LABEL_MIN_ZOOM = 8;

const map = L.map("map").setView(NATIONAL_CENTER, NATIONAL_ZOOM);
map.boxZoom.disable();

map.createPane("statePane");
map.getPane("statePane").style.zIndex = 330;
map.createPane("districtPane");
map.getPane("districtPane").style.zIndex = 420;
map.createPane("countyPane");
map.getPane("countyPane").style.zIndex = 440;
map.createPane("countyLabelPane");
map.getPane("countyLabelPane").style.zIndex = 450;
map.createPane("placeLabelPane");
map.getPane("placeLabelPane").style.zIndex = 460;
map.getPane("placeLabelPane").style.pointerEvents = "none";
map.createPane("districtHoverPane");
map.getPane("districtHoverPane").style.zIndex = 455;
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

const AUTO_SHAPE_URLS = {
  states: "data/shapes/states.zip",
  house: "data/shapes/house.zip",
  senate: "data/shapes/senate.zip",
  counties: "data/shapes/counties.zip",
};
const TARGET_DISTRICTS_JSON_URLS = ["data/target_districts.json"];
const WORKBOOK_URLS = [
  "data/State Legislative Election History - Copy.xlsx",
  "data/State Legislative Election History.xlsx",
];
const XLSX_CDN_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

const MAP_VIEW_TYPE_PRIORITY = {
  gov: 0,
  pres: 1,
  leg: 2,
};
const STATE_NAME_TO_ABBR = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};

const state = {
  mode: "national",
  chamber: "house",
  mapView: "latest_leg",
  availableMapViews: [],
  selectedState: null,
  statesGeojson: null,
  statesLayer: null,
  statesByKey: new Map(),
  stateBoundsByKey: new Map(),
  geojsonByChamber: {
    house: null,
    senate: null,
  },
  districtFeaturesByChamberState: {
    house: new Map(),
    senate: new Map(),
  },
  countyGeojson: null,
  countyFeaturesByState: new Map(),
  districtLayer: null,
  districtLayerIndex: new Map(),
  currentDistrictFeatures: [],
  districtNumberLayer: null,
  districtNumberBuildToken: 0,
  districtLabelRefreshToken: 0,
  selectedDistrictLayer: null,
  hoverDistrictLayer: null,
  hoverInfoEl: null,
  chamberOverviewBtnEl: null,
  hasOpenPopup: false,
  countyLayer: null,
  countyLabelLayer: null,
  countyVisible: false,
  suspendPopupCloseOverview: false,
  targetDistrictsMode: false,
  targetJoinKeySet: new Set(),
  targetDistricts: [],
  availableMapViewsByState: new Map(),
  dataByChamber: {
    house: new Map(),
    senate: new Map(),
  },
  detailsInteractionsWired: false,
  hoveredTableRowEl: null,
};

const houseChamberBtn = document.getElementById("houseChamberBtn");
const senateChamberBtn = document.getElementById("senateChamberBtn");
const mapViewButtons = document.getElementById("mapViewButtons");
const countyOverlayToggle = document.getElementById("countyOverlayToggle");
const targetDistrictsToggle = document.getElementById("targetDistrictsToggle");
const stateSelect = document.getElementById("stateSelect");
const exitStateBtn = document.getElementById("exitStateBtn");
const statusText = document.getElementById("statusText");
const detailsTitle = document.getElementById("detailsTitle");
const details = document.getElementById("details");

init().catch((err) => {
  console.error(err);
  setStatus(`Startup error: ${err.message}`);
});

async function init() {
  wireEvents();
  initHoverInfo();
  initChamberOverviewButton();

  const targetsPromise = loadTargetDistricts();
  await Promise.all([loadAllChamberData(), autoLoadStateShapes()]);
  enterNationalView();

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

async function fetchJsonArray(url) {
  try {
    const response = await fetch(url);
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

  stateSelect.addEventListener("change", async (e) => {
    const key = String(e.target.value || "").trim();
    if (!key) return;
    await selectStateByKey(key);
  });

  exitStateBtn.addEventListener("click", () => {
    enterNationalView();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.mode !== "state") return;

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
  });

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
      return !isDistrictOfColumbia(meta);
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

  state.statesLayer = L.geoJSON(geojson, {
    pane: "statePane",
    style: (feature) => stateBoundaryStyle(feature),
    onEachFeature: (feature, layer) => {
      const meta = stateMetaFromFeature(feature);
      if (!meta.key) return;
      const bounds = layer.getBounds();
      if (bounds?.isValid?.()) {
        state.stateBoundsByKey.set(meta.key, bounds);
      }

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
  const fips = normalizeStateFips(readProperty(properties, "STATEFP") || readProperty(properties, "STATE_FIPS"));
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

function normalizeTextKey(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
}

function normalizeStateAbbr(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
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
  if (shouldZoom && featureBounds.isValid()) {
    map.fitBounds(featureBounds.pad(0.1), { animate: false });
  }

  await ensureDistrictShapesLoaded();
  renderDistrictLayerForSelectedState();
  await updateCountyOverlayVisibility();
  refreshStateBoundaryStyles();
  renderModeUi();
  setStatus(`Viewing ${meta.name || meta.abbr || meta.key} ${capitalize(state.chamber)} districts.`);
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
  detailsTitle.textContent = "National View";
  details.innerHTML = "Select a state on the map or from the dropdown.";
  renderModeUi();
  setStatus("National view. Select a state to view districts.");
}

function renderModeUi() {
  const inState = state.mode === "state";
  houseChamberBtn.disabled = !inState;
  senateChamberBtn.disabled = !inState;
  countyOverlayToggle.disabled = !inState;
  targetDistrictsToggle.disabled = !inState;
  syncTargetModeUi();
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

function availableMapViewsForState(meta) {
  const stateFips = normalizeStateFips(meta?.fips);
  if (!stateFips) return [];
  const found = state.availableMapViewsByState.get(stateFips) || new Set();

  return [...found]
    .map((view) => parseMapViewKey(view))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return MAP_VIEW_TYPE_PRIORITY[a.type] - MAP_VIEW_TYPE_PRIORITY[b.type];
    })
    .map((item) => item.key);
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
    const parsed = parseMapViewKey(key);
    if (parsed) found.add(parsed.key);
  }

  for (const [key, value] of Object.entries(rec)) {
    if (typeof value !== "number") continue;
    let match = key.match(/^(leg|gov|pres)_(\d{4})_margin$/);
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
  const match = String(view || "").match(/^(leg|gov|pres)_(\d{4})$/);
  if (!match) return null;
  return {
    key: `${match[1]}_${match[2]}`,
    type: match[1],
    year: Number(match[2]),
  };
}

function mapViewButtonLabel(view) {
  if (view === "latest_leg") return "Latest Leg";
  const parsed = parseMapViewKey(view);
  if (!parsed) return String(view || "");
  if (parsed.type === "leg") return `${parsed.year} Leg`;
  if (parsed.type === "gov") return `${parsed.year} Gov`;
  if (parsed.type === "pres") return `${parsed.year} Pres`;
  return `${parsed.year}`;
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

  for (const view of displayedMapViews()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mapview-button";
    if (view === state.mapView) {
      button.classList.add("active-mapview");
    }
    button.textContent = mapViewButtonLabel(view);
    button.disabled = state.mode !== "state";
    button.addEventListener("click", async () => {
      await setMapView(view);
    });
    mapViewButtons.appendChild(button);
  }
}

async function setMapView(view) {
  if (state.mapView === view) return;
  state.mapView = view;
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
  }
}

function stateBoundaryStyle(feature) {
  const isSelected =
    state.mode === "state" &&
    state.selectedState &&
    stateMetaFromFeature(feature).key === state.selectedState.key;
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

async function ensureDistrictShapesLoaded() {
  const chamber = state.chamber;
  if (state.geojsonByChamber[chamber]) return;
  setStatus("Loading district shapefiles...");
  state.geojsonByChamber[chamber] = await loadUrlZipToGeojson(AUTO_SHAPE_URLS[chamber]);
  if (state.geojsonByChamber[chamber]) {
    indexDistrictFeaturesByState(chamber, state.geojsonByChamber[chamber]);
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
  if (!state.selectedState) return;

  const geojson = state.geojsonByChamber[state.chamber];
  if (!geojson) {
    details.innerHTML = "District shapefile missing for this chamber.";
    return;
  }

  const dataMap = state.dataByChamber[state.chamber];
  const selectedFeatures = districtFeaturesForSelectedState(state.chamber);
  if (!selectedFeatures.length) {
    details.innerHTML = "No districts found for selected state/chamber.";
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
        const hoverHtml = popupHtml(feature.properties, joinInfo, rec);
        layer.__featureRef = feature;
        layer.__dataMapRef = dataMap;
        layer.__joinKey = joinInfo.key;
        state.districtLayerIndex.set(joinInfo.key, layer);
        layer.bindPopup(hoverHtml);
        layer.on("mouseover", (e) => {
          showDistrictHoverOutline(feature);
          showDistrictHoverInfo(e.containerPoint, hoverHtml);
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
          detailsTitle.textContent = districtTitle(feature.properties, joinInfo);
          details.innerHTML = detailHtml(feature.properties, joinInfo, rec);
        });
      },
    }
  ).addTo(map);
  scheduleDistrictNumberLayerBuild(selectedFeatures);
  showStateChamberOverview();
}

function scheduleDistrictNumberLayerBuild(features) {
  state.districtNumberBuildToken += 1;
  const token = state.districtNumberBuildToken;
  requestAnimationFrame(() => {
    if (token !== state.districtNumberBuildToken) return;
    buildDistrictNumberLayer(features);
  });
}

function selectedStateHeader() {
  if (!state.selectedState) return "National View";
  return state.selectedState.name || state.selectedState.abbr || state.selectedState.key || "State View";
}

function selectedStateChamberHeader() {
  if (!state.selectedState) return "National View";
  const stateName = state.selectedState.name || state.selectedState.abbr || state.selectedState.key || "State";
  return `${stateName} ${capitalize(state.chamber)}`;
}

function showStateChamberOverview() {
  setHoveredTableRow(null);
  detailsTitle.textContent = selectedStateChamberHeader();
  const composition = chamberCompositionStatsForSelectedState();
  details.innerHTML = stateChamberOverviewHtml(composition);
  syncTargetModeUi();
  wireTargetTableInteractions();
}

function stateChamberOverviewHtml(composition) {
  if (!composition) {
    return "State chamber overview.";
  }

  const titleState = state.selectedState?.name || state.selectedState?.abbr || "State";
  const chamberLabel = capitalize(state.chamber);
  const targets = targetTablesForSelectedState();
  const allDistrictRows = allDistrictRowsForSelectedState();
  return `
    <div class="detail-section">
      <div class="detail-section-title centered-section-title large-section-title">${escapeHtml(titleState)} ${escapeHtml(chamberLabel)} Composition</div>
      ${chamberCompositionHtml(composition)}
    </div>
    <div class="detail-section">${targetDistrictsSectionHtml(targets)}</div>
    <div class="detail-section">${allDistrictsSectionHtml(allDistrictRows)}</div>
  `;
}

function chamberCompositionStatsForSelectedState() {
  if (!state.selectedState) return null;
  const geojson = state.geojsonByChamber[state.chamber];
  if (!geojson) return null;

  const features = districtFeaturesForSelectedState(state.chamber);
  if (!features.length) return null;

  const dataMap = state.dataByChamber[state.chamber];
  const counts = {
    rep: 0,
    dem: 0,
    other: 0,
    vacant: 0,
  };

  for (const feature of features) {
    const joinInfo = extractJoinIds(feature.properties);
    const rec = dataMap.get(joinInfo.key);
    const category = incumbentSeatCategory(rec);
    counts[category] += 1;
  }

  return {
    ...counts,
    total: features.length,
  };
}

function incumbentSeatCategory(rec) {
  if (!rec || !hasIncumbent(rec)) return "vacant";
  const party = String(rec?.incumbent?.party || "").trim().toUpperCase();
  if (party === "R") return "rep";
  if (party === "D") return "dem";
  return "other";
}

function chamberCompositionHtml(composition) {
  const rows = compositionDotRows(composition.total);
  const majority = chamberMajoritySummary(composition);
  return `
    <div class="chamber-composition-layout">
      <div class="chamber-dotmap-wrap">
        <div class="chamber-dotmap" style="--dot-rows:${rows}">
          <div class="dot-group-left">${dotMatrixHtml(composition.rep, "dot-seat dot-rep")}</div>
          <div class="dot-group-right">
            <div class="dot-major-row">${dotMatrixHtml(composition.dem, "dot-seat dot-dem")}</div>
            <div class="dot-minor-row">
              ${dotMatrixHtml(composition.other, "dot-seat dot-other")}
              ${dotMatrixHtml(composition.vacant, "dot-seat dot-vacant")}
            </div>
          </div>
        </div>
        ${majoritySummaryHtml(majority)}
      </div>
      <div class="chamber-composition-table">
        <div class="composition-head">
          <span>Party</span>
          <span>Seats</span>
        </div>
        ${compositionRowHtml("Republican", composition.rep, "dot-seat dot-rep")}
        ${compositionRowHtml("Democrat", composition.dem, "dot-seat dot-dem")}
        ${compositionRowHtml("Independent/Other", composition.other, "dot-seat dot-other")}
        ${compositionRowHtml("Vacant", composition.vacant, "dot-seat dot-vacant")}
        <div class="composition-total-row">
          <span>Total Seats</span>
          <strong>${composition.total}</strong>
        </div>
      </div>
    </div>
  `;
}

function chamberMajoritySummary(composition) {
  const rep = Number(composition?.rep || 0);
  const dem = Number(composition?.dem || 0);
  const other = Number(composition?.other || 0);
  const vacant = Number(composition?.vacant || 0);
  const total = Number(composition?.total || 0);

  if (rep === dem && rep > 0 && rep + dem === total) {
    return { type: "tie" };
  }

  const largestParty = rep >= dem ? "R" : "D";
  const largestSeats = largestParty === "R" ? rep : dem;
  const everyoneElsePlusVacant = total - largestSeats;
  const majoritySeats = largestSeats - everyoneElsePlusVacant;
  if (majoritySeats > 0) {
    return { type: "majority", party: largestParty, seats: majoritySeats };
  }

  return { type: "none" };
}

function majoritySummaryHtml(majority) {
  if (majority?.type === "tie") {
    return '<div class="majority-summary">Tied chamber</div>';
  }
  if (majority?.type !== "majority" || !majority?.party || !majority?.seats) {
    return '<div class="majority-summary">No majority</div>';
  }
  const partyLabel = majority.party === "R" ? "GOP" : "Dem";
  const partyClass = majority.party === "R" ? "majority-party-r" : "majority-party-d";
  return `
    <div class="majority-summary">
      <strong>${majority.seats}</strong> seat <strong class="${partyClass}">${partyLabel}</strong> majority
    </div>
  `;
}

function compositionDotRows(totalSeats) {
  if (totalSeats >= 180) return 14;
  if (totalSeats >= 120) return 12;
  if (totalSeats >= 80) return 10;
  if (totalSeats >= 40) return 8;
  return 6;
}

function dotMatrixHtml(count, dotClass) {
  const safeCount = Math.max(0, Number(count) || 0);
  if (!safeCount) return "";
  return `
    <div class="dot-matrix">
      ${Array.from({ length: safeCount }, () => `<span class="${dotClass}"></span>`).join("")}
    </div>
  `;
}

function compositionRowHtml(label, value, dotClass) {
  return `
    <div class="composition-row">
      <span class="composition-party"><span class="${dotClass}"></span>${escapeHtml(label)}</span>
      <span class="composition-value">${Number(value) || 0}</span>
    </div>
  `;
}

function targetDistrictsSectionHtml(targets) {
  const defenseRows = targets.defense.map((row) => targetDistrictRowHtml(row)).join("");
  const offenseRows = targets.offense.map((row) => targetDistrictRowHtml(row)).join("");
  return `
    <div id="targetModeHeader" class="detail-section-title centered-section-title large-section-title target-mode-header ${state.targetDistrictsMode ? "active-target-mode" : ""}">Target Districts</div>
    <div class="target-columns">
      <div class="target-column">
        <div class="detail-subtitle centered-subtitle chart-header">Defense</div>
        ${targetDistrictTableHtml(defenseRows)}
      </div>
      <div class="target-column">
        <div class="detail-subtitle centered-subtitle chart-header">Offense</div>
        ${targetDistrictTableHtml(offenseRows)}
      </div>
    </div>
  `;
}

function targetDistrictTableHtml(rowsHtml) {
  return `
    <table class="target-table">
      <thead>
        <tr>
          <th class="target-col-district">#</th>
          <th class="target-col-inc">Inc</th>
          <th class="target-col-candidate">2026 GOP</th>
          <th class="target-col-candidate">2026 DEM</th>
          <th class="target-col-margin"><span class="twoline-head">2024<br/>Leg</span></th>
          <th class="target-col-margin"><span class="twoline-head">2024<br/>Pres</span></th>
          <th class="target-gap-col"></th>
          <th class="target-col-margin"><span class="twoline-head">2022<br/>Leg</span></th>
          <th class="target-col-margin"><span class="twoline-head">2022<br/>Gov</span></th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="9" class="target-empty">None</td></tr>'}
      </tbody>
    </table>
  `;
}

function targetDistrictRowHtml(row) {
  const incClass = row.incParty === "R" ? "inc-r" : row.incParty === "D" ? "inc-d" : "inc-u";
  return `
    <tr class="target-row district-select-row" data-join-key="${escapeHtml(row.joinKey)}">
      <td class="target-district-cell">${escapeHtml(row.districtLabel)}</td>
      <td class="inc-cell ${incClass}"><strong>${escapeHtml(row.incParty || "?")}</strong></td>
      <td>${escapeHtml(row.gopCandidate)}</td>
      <td>${escapeHtml(row.demCandidate)}</td>
      <td class="margin-cell" style="background:${targetMarginCellColor(row.legMarginDem)}">${escapeHtml(formatSignedRMargin(row.legMarginDem))}</td>
      <td class="margin-cell" style="background:${targetMarginCellColor(row.presMarginDem)}">${escapeHtml(formatSignedRMargin(row.presMarginDem))}</td>
      <td class="target-gap-cell"></td>
      <td class="margin-cell" style="background:${targetMarginCellColor(row.leg2022MarginDem)}">${escapeHtml(formatSignedRMargin(row.leg2022MarginDem))}</td>
      <td class="margin-cell" style="background:${targetMarginCellColor(row.gov2022MarginDem)}">${escapeHtml(formatSignedRMargin(row.gov2022MarginDem))}</td>
    </tr>
  `;
}

function targetTablesForSelectedState() {
  const rows = targetDistrictRowsForSelectedState();
  const defense = rows
    .filter((row) => row.incParty === "R")
    .sort((a, b) => targetSortValue(a) - targetSortValue(b));
  const offense = rows
    .filter((row) => row.incParty === "D")
    .sort((a, b) => targetSortValue(a) - targetSortValue(b));
  return { defense, offense };
}

function targetDistrictRowsForSelectedState() {
  if (!state.selectedState) return [];
  const selectedAbbr = normalizeStateAbbr(state.selectedState.abbr);
  if (!selectedAbbr) return [];
  const chamberText = state.chamber;
  const dataMap = state.dataByChamber[state.chamber];
  const rows = [];

  for (const target of state.targetDistricts || []) {
    if (target.stateAbbr !== selectedAbbr) continue;
    if (target.chamber !== chamberText) continue;
    const key = makeJoinKey(state.selectedState.fips, target.districtId);
    const rec = dataMap.get(key);
    if (!rec) continue;
    const incParty = String(rec.incumbent?.party || "").trim().toUpperCase();
    if (incParty !== "R" && incParty !== "D") continue;
    const legMarginDem = getMarginForView(rec, "leg_2024");
    const presMarginDem = getMarginForView(rec, "pres_2024");
    const gov2022MarginDem = getMarginForView(rec, "gov_2022");
    const leg2022MarginDem = getMarginForView(rec, "leg_2022");
    rows.push({
      joinKey: key,
      districtLabel: displayDistrictId(target.rawDistrict, target.districtId),
      incParty,
      gopCandidate: gopCandidateFull(rec),
      demCandidate: demCandidateFull(rec),
      legMarginDem,
      presMarginDem,
      gov2022MarginDem,
      leg2022MarginDem,
    });
  }

  return rows;
}

function allDistrictsSectionHtml(rows) {
  const chamberLabel = capitalize(state.chamber);
  const bodyRows = rows.map((row) => targetDistrictRowHtml(row)).join("");
  return `
    <div class="detail-section-title centered-section-title large-section-title all-districts-header">All ${escapeHtml(chamberLabel)} Districts</div>
    <div class="all-districts-table-wrap">
      ${targetDistrictTableHtml(bodyRows)}
    </div>
  `;
}

function allDistrictRowsForSelectedState() {
  if (!state.selectedState) return [];
  const dataMap = state.dataByChamber[state.chamber];
  const rows = [];
  const seen = new Set();

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
      incParty: incParty === "R" || incParty === "D" ? incParty : "O",
      gopCandidate: gopCandidateFull(rec),
      demCandidate: demCandidateFull(rec),
      legMarginDem: getMarginForView(rec, "leg_2024"),
      presMarginDem: getMarginForView(rec, "pres_2024"),
      gov2022MarginDem: getMarginForView(rec, "gov_2022"),
      leg2022MarginDem: getMarginForView(rec, "leg_2022"),
    });
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

function gopCandidateShort(rec) {
  const candidate = String(rec?.candidates_2026?.rep || "TBD").trim();
  if (!candidate || /^no candidate$/i.test(candidate)) return "No candidate";
  const compact = shortPersonName(candidate);
  const isInc = String(rec?.incumbent?.party || "").toUpperCase() === "R" && isIncumbentNominee(rec);
  return `${compact}${isInc ? "*" : ""}`;
}

function demCandidateShort(rec) {
  const candidate = String(rec?.candidates_2026?.dem || "TBD").trim();
  if (!candidate || /^no candidate$/i.test(candidate)) return "No candidate";
  const compact = shortPersonName(candidate);
  const isInc = String(rec?.incumbent?.party || "").toUpperCase() === "D" && isIncumbentNominee(rec);
  return `${compact}${isInc ? "*" : ""}`;
}

function gopCandidateFull(rec) {
  const candidate = String(rec?.candidates_2026?.rep || "TBD").trim();
  if (!candidate || /^no candidate$/i.test(candidate)) return "No candidate";
  const isInc = String(rec?.incumbent?.party || "").toUpperCase() === "R" && isIncumbentNominee(rec);
  return `${candidate}${isInc ? "*" : ""}`;
}

function demCandidateFull(rec) {
  const candidate = String(rec?.candidates_2026?.dem || "TBD").trim();
  if (!candidate || /^no candidate$/i.test(candidate)) return "No candidate";
  const isInc = String(rec?.incumbent?.party || "").toUpperCase() === "D" && isIncumbentNominee(rec);
  return `${candidate}${isInc ? "*" : ""}`;
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

function formatSignedRMargin(demMargin) {
  if (typeof demMargin !== "number") return "N/A";
  const rMargin = -demMargin;
  const sign = rMargin >= 0 ? "+" : "-";
  return `${sign}${Math.abs(rMargin).toFixed(1)}%`;
}

function targetMarginCellColor(demMargin) {
  if (typeof demMargin !== "number") return "#d5dae0";
  return marginColor(demMargin);
}

function targetSortValue(row) {
  if (typeof row?.legMarginDem === "number") return Math.abs(row.legMarginDem);
  if (typeof row?.leg2022MarginDem === "number") return Math.abs(row.leg2022MarginDem);
  return Number.POSITIVE_INFINITY;
}

function wireTargetTableInteractions() {
  const modeHeader = details.querySelector("#targetModeHeader");
  if (modeHeader) {
    modeHeader.onclick = async () => {
      await setTargetDistrictsMode(!state.targetDistrictsMode);
    };
  }
  wireDetailsInteractions();
}

function wireDetailsInteractions() {
  if (state.detailsInteractionsWired) return;
  state.detailsInteractionsWired = true;

  details.addEventListener("mouseover", (event) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    if (!targetEl) return;
    const row = targetEl.closest(".district-select-row[data-join-key]");
    if (!row) return;
    setHoveredTableRow(row);
  });

  details.addEventListener("mouseout", (event) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    if (!targetEl) return;
    const row = targetEl.closest(".district-select-row[data-join-key]");
    if (!row) return;
    const related = event.relatedTarget;
    if (related && row.contains(related)) return;
    if (state.hoveredTableRowEl === row) setHoveredTableRow(null);
  });

  details.addEventListener("click", (event) => {
    const targetEl = event.target instanceof Element ? event.target : null;
    if (!targetEl) return;
    const row = targetEl.closest(".district-select-row[data-join-key]");
    if (!row) return;
    selectDistrictFromTargetRow(row.dataset.joinKey || "");
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

function districtLayerForJoinKey(joinKey) {
  if (!joinKey || !state.districtLayerIndex) return null;
  return state.districtLayerIndex.get(joinKey) || null;
}

function selectDistrictFromTargetRow(joinKey) {
  const layer = districtLayerForJoinKey(joinKey);
  if (!layer?.__featureRef || !layer.__dataMapRef) return;
  clearDistrictHoverOutline();
  hideDistrictHoverInfo();
  setSelectedDistrict(layer);
  const feature = layer.__featureRef;
  const joinInfo = extractJoinIds(feature.properties);
  const rec = layer.__dataMapRef.get(joinInfo.key);
  detailsTitle.textContent = districtTitle(feature.properties, joinInfo);
  details.innerHTML = detailHtml(feature.properties, joinInfo, rec);
}

function targetJoinKeySetForSelectedState() {
  return state.targetJoinKeySet || new Set();
}

function refreshTargetJoinKeySet() {
  const set = new Set();
  if (!state.selectedState) {
    state.targetJoinKeySet = set;
    return;
  }
  const selectedAbbr = normalizeStateAbbr(state.selectedState.abbr);
  const stateFips = normalizeStateFips(state.selectedState.fips);
  if (!selectedAbbr || !stateFips) {
    state.targetJoinKeySet = set;
    return;
  }
  const chamberText = state.chamber;

  for (const target of state.targetDistricts || []) {
    if (target.stateAbbr !== selectedAbbr) continue;
    if (target.chamber !== chamberText) continue;
    set.add(makeJoinKey(stateFips, target.districtId));
  }
  state.targetJoinKeySet = set;
}

async function setTargetDistrictsMode(enabled) {
  state.targetDistrictsMode = !!enabled;
  syncTargetModeUi();
  if (state.mode !== "state") return;
  if (state.districtLayer) {
    refreshDistrictLayerForTargetMode();
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
}

function refreshDistrictLayerForTargetMode() {
  if (!state.districtLayer) return;
  refreshTargetJoinKeySet();
  state.districtLayer.eachLayer((layer) => {
    if (state.selectedDistrictLayer && state.selectedDistrictLayer === layer) {
      layer.setStyle(districtSelectedStyle(layer.__featureRef, layer.__dataMapRef));
      return;
    }
    resetDistrictStyle(layer);
  });
  scheduleDistrictNumberLayerBuild(state.currentDistrictFeatures || []);
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
  if (state.districtLayer) {
    map.removeLayer(state.districtLayer);
    state.districtLayer = null;
  }
  clearDistrictNumberLayer();
  state.selectedDistrictLayer = null;
  hideChamberOverviewButton();
  clearDistrictHoverOutline();
  hideDistrictHoverInfo();
}

function buildDistrictNumberLayer(features) {
  clearDistrictNumberLayer();
  const targetKeySet = state.targetDistrictsMode ? targetJoinKeySetForSelectedState() : null;
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
  if (state.targetDistrictsMode) {
    const joinInfo = extractJoinIds(feature?.properties || {});
    const targetKeySet = targetJoinKeySetForSelectedState();
    if (!targetKeySet.has(joinInfo.key)) {
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
  if (!state.selectedDistrictLayer) return;
  resetDistrictStyle(state.selectedDistrictLayer);
  state.selectedDistrictLayer = null;
  hideChamberOverviewButton();
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
    const response = await fetch(url);
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
      const response = await fetch(url);
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

async function loadTargetDistrictsFromWorkbook() {
  try {
    if (!(await ensureXlsxLibraryLoaded())) return [];
    let workbook = null;
    for (const workbookUrl of WORKBOOK_URLS) {
      try {
        const response = await fetch(workbookUrl);
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

function popupHtml(properties, joinInfo, rec) {
  const title = districtTitle(properties, joinInfo);
  if (!rec) {
    return `<strong>${escapeHtml(title)}</strong><br/>No joined data found.`;
  }

  const latestMargin = getMarginForView(rec, "latest_leg");
  const latestText = formatMarginHtml(latestMargin);
  const latestLegLabel = latestLegDisplayLabel(rec);
  const pres2024Text = formatMarginHtml(getMarginForView(rec, "pres_2024"));
  const repCandidate = candidateDisplay(rec, "R");
  const demCandidate = candidateDisplay(rec, "D");

  return [
    `<strong>${escapeHtml(title)}</strong>`,
    `&nbsp;&nbsp;${latestLegLabel}: ${latestText}`,
    `&nbsp;&nbsp;2024 Pres: ${pres2024Text}`,
    "",
    "2026 Candidates",
    `&nbsp;&nbsp;${escapeHtml(repCandidate)}`,
    `&nbsp;&nbsp;${escapeHtml(demCandidate)}`,
  ].join("<br/>");
}

function latestLegDisplayLabel(rec) {
  const m2024 = marginForYear(rec, 2024);
  if (typeof m2024 === "number") return "2024 Leg";
  const m2022 = marginForYear(rec, 2022);
  if (typeof m2022 === "number") return "2022 Leg";
  return "Latest Leg";
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
  const repCandidate = candidateDisplay(rec, "R");
  const demCandidate = candidateDisplay(rec, "D");
  const hasNamedIncumbent = hasIncumbent(rec);
  const incumbentNominee = hasNamedIncumbent && isIncumbentNominee(rec);
  const incumbentLabel = incumbentDisplay(rec);
  const pastElectionRows = pastElectionRowsHtml(rec);
  const metroChart = stackedBreakdownHtml("Metro Type", [
    { label: "Rural", value: metro.rural_pct, colorClass: "color-metro-rural" },
    { label: "Town", value: metro.town_pct, colorClass: "color-metro-town" },
    { label: "Suburban", value: metro.suburban_pct, colorClass: "color-metro-suburban" },
    { label: "Urban", value: metro.urban_pct, colorClass: "color-metro-urban" },
  ]);
  const incomeChart = stackedBreakdownHtml("Household Income", [
    { label: "<$50,000", value: income.lt_50k, colorClass: "color-income-lt50k" },
    { label: "$50,000-$100,000", value: income.between_50_100k, colorClass: "color-income-50to100k" },
    { label: ">$150,000", value: income.gt_150k, colorClass: "color-income-gt150k" },
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
  const modelingPanel = `
    <div class="detail-section-title centered-section-title large-section-title">Modeling</div>
    <div class="detail-row">Coming soon.</div>
  `;
  const demographicsPanel = `
    <div class="detail-section-title centered-section-title large-section-title">Demographics</div>
    ${metroChart}
    ${raceChart}
    ${incomeChart}
    ${educationChart}
  `;

  return `
    <div class="detail-meta ${incumbentNominee || !hasNamedIncumbent ? "" : "detail-meta-muted"}">Incumbent: ${escapeHtml(incumbentLabel)}</div>
    <div class="detail-subtitle candidates-title">2026 Candidates</div>
    <div class="detail-row detail-indent candidates-row">${escapeHtml(repCandidate)}</div>
    <div class="detail-row detail-indent candidates-row">${escapeHtml(demCandidate)}</div>
    <div class="detail-break"></div>

    <div class="detail-section">
      <div class="detail-section-title centered-section-title large-section-title">Past Election Results</div>
      <div class="past-election-grid">${pastElectionRows}</div>
    </div>

    <div class="detail-section">
      <div class="split-two-col">
        <div class="split-col-left">${modelingPanel}</div>
        <div class="split-col-right">${demographicsPanel}</div>
      </div>
    </div>
  `;
}

function districtTitle(properties, joinInfo) {
  const abbr = String(readProperty(properties, "STUSPS") || readProperty(properties, "STATE_ABBR") || joinInfo.stateFips || "US").trim().toUpperCase();
  const district = displayDistrictId(joinInfo.rawDistrict, joinInfo.districtId);
  return `${abbr} ${capitalize(state.chamber)} District ${district}`;
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

function candidateDisplay(rec, party) {
  const isIncumbent = String(rec.incumbent?.party || "").toUpperCase() === party && isIncumbentNominee(rec);
  const key = party === "R" ? "rep" : "dem";
  const candidateName = rec.candidates_2026?.[key] || "TBD";
  return `${candidateName}${isIncumbent ? "*" : ""} (${party})`;
}

function hasIncumbent(rec) {
  const name = String(rec?.incumbent?.name || "").trim();
  if (!name) return false;
  const upper = name.toUpperCase();
  return upper !== "UNKNOWN" && upper !== "VACANT";
}

function incumbentDisplay(rec) {
  if (!hasIncumbent(rec)) return "Vacant";
  const name = String(rec.incumbent?.name || "").trim();
  const party = String(rec.incumbent?.party || "").trim().toUpperCase();
  if (party === "R" || party === "D") return `${name} (${party})`;
  return name;
}

function isIncumbentNominee(rec) {
  const party = String(rec.incumbent?.party || "").toUpperCase();
  const incumbentName = String(rec.incumbent?.name || "").trim().toUpperCase();
  if (!party || !incumbentName) return false;
  const key = party === "R" ? "rep" : party === "D" ? "dem" : "";
  if (!key) return false;
  const nomineeName = String(rec.candidates_2026?.[key] || "").trim().toUpperCase();
  return nomineeName && nomineeName === incumbentName;
}

function turnoutByYear(rec) {
  const totalRegistered = Number(rec.demographics?.population || 0);
  const byYear = new Map();

  const pres24Total = Number(rec.top_ticket_totals?.pres_2024 || 0);
  if (totalRegistered > 0 && pres24Total > 0) {
    const turnout = clampPct((pres24Total / totalRegistered) * 100);
    byYear.set(2024, turnoutChartBlock("2024 Presidential Turnout", turnout, pres24Total, totalRegistered));
  }

  const gov22Total = Number(rec.top_ticket_totals?.gov_2022 || 0);
  if (totalRegistered > 0 && gov22Total > 0) {
    const turnout = clampPct((gov22Total / totalRegistered) * 100);
    byYear.set(2022, turnoutChartBlock("2022 Midterm Turnout", turnout, gov22Total, totalRegistered));
  }

  return {
    totalRegistered,
    byYear,
  };
}

function pastElectionRowsHtml(rec) {
  const electionRowsByYear = new Map();
  const yearOrder = [];
  const yearSeen = new Set();

  const grouped = groupElectionRows(rec);
  const turnout = turnoutByYear(rec);

  for (const year of grouped.years) {
    const leftHtml = grouped.byYear.get(year) || "";
    if (!leftHtml && !turnout.byYear.has(year)) continue;
    electionRowsByYear.set(year, leftHtml);
    if (!yearSeen.has(year)) {
      yearSeen.add(year);
      yearOrder.push(year);
    }
  }

  for (const year of turnout.byYear.keys()) {
    if (!yearSeen.has(year)) {
      yearSeen.add(year);
      yearOrder.push(year);
    }
  }

  yearOrder.sort((a, b) => b - a);

  if (!yearOrder.length) {
    return '<div class="detail-row">No election history available.</div>';
  }

  const yearRows = yearOrder
    .map((year, idx) => {
      const dividerClass = idx < yearOrder.length - 1 ? "with-year-divider" : "";
      const leftHtml = electionRowsByYear.get(year) || "";
      const rightHtml = turnout.byYear.get(year) || "";
      return `
        <div class="past-election-year-row ${dividerClass}">
          <div class="past-election-year-left">${leftHtml}</div>
          <div class="past-election-year-right">${rightHtml}</div>
        </div>
      `;
    })
    .join("");

  return `${yearRows}`;
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
  const legLabel = state.chamber === "senate" ? "State Senate" : "State House";
  const byYear = new Map();

  const legElections = [...(rec.elections || [])]
    .filter((e) => Number.isFinite(Number(e?.year)) && typeof e.dem_pct === "number" && typeof e.rep_pct === "number")
    .sort((a, b) => Number(b.year) - Number(a.year));

  for (const election of legElections) {
    const year = Number(election.year);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({
      priority: 0,
      html: electionChartBlock(`${year} ${legLabel}`, election.rep_pct, election.dem_pct),
    });
  }

  const presMargin = getMarginForView(rec, "pres_2024");
  if (typeof presMargin === "number") {
    const presDem = clampPct(50 + presMargin / 2);
    const presRep = clampPct(50 - presMargin / 2);
    const year = 2024;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({
      priority: 1,
      html: electionChartBlock("2024 Presidential", presRep, presDem),
    });
  }

  const govMargin = getMarginForView(rec, "gov_2022");
  if (typeof govMargin === "number") {
    const govDem = clampPct(50 + govMargin / 2);
    const govRep = clampPct(50 - govMargin / 2);
    const year = 2022;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({
      priority: 1,
      html: electionChartBlock("2022 Gubernatorial", govRep, govDem),
    });
  }

  const years = [...byYear.keys()].sort((a, b) => b - a);
  const rowHtmlByYear = new Map();
  for (const year of years) {
    const html = byYear
      .get(year)
      .sort((a, b) => a.priority - b.priority)
      .map((row) => row.html)
      .join("");
    rowHtmlByYear.set(year, html);
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

  const margin = getMarginForView(rec, state.mapView);
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
  const m2024 = marginForYear(rec, 2024);
  if (typeof m2024 === "number") return m2024;
  const m2022 = marginForYear(rec, 2022);
  if (typeof m2022 === "number") return m2022;
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
  if (typeof margin !== "number") return "N/A";
  if (margin > 0) return `D+${Math.abs(margin).toFixed(1)}`;
  if (margin < 0) return `R+${Math.abs(margin).toFixed(1)}`;
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
      const showLabel = item.value >= 7.5;
      return `
        <div class="stacked-segment ${item.colorClass}" style="width:${widthPct(item.value)}">
          ${showLabel ? `<span class="stacked-segment-label">${escapeHtml(segmentFormatter(item.value))}</span>` : ""}
        </div>
      `;
    })
    .join("");

  const legendRows = Math.ceil(normalized.length / 2);
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
    ${showLegend ? `<div class="stacked-legend two-col" style="--legend-rows:${legendRows};">${legend}</div>` : ""}
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
