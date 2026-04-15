const LATENCY_MAJOR_STACK = ['peripheral_latency', 'game_latency', 'driver_latency', 'render_latency', 'scheduling_latency', 'display_latency'];

// Warm-neutral palette along the ivory → champagne → dune → taupe axis.
// Indexed positionally — each slot is chosen for the specific metric it lands
// on, so stacked neighbours have strong luminance deltas and everything stays
// readable on pure black (no value darker than ~#6a6458).
//
// Latency stack order (bottom → top):
//   peripheral → game → driver → render → scheduling → display
// Deltas between neighbours (approx sRGB L): 22, 29, 20, 27, 16.
//
//   idx  metric               role                        hex       ~L
const COLOR_PALETTE = [
    '#e8e0c8', // 0  system_latency      shell/total          ivory     87
    '#a8a294', // 1  display_latency     top of stack         platinum  64
    '#d6cdb2', // 2  scheduling_latency                       champagne 80
    '#8c8576', // 3  render_latency      middle               dune      53
    '#c4bba0', // 4  driver_latency                           bone      73
    '#746c5c', // 5  game_latency        largest block        khaki     44
    '#ece4cc', // 6  frame_time          inside game — max Δ  ivory     89
    '#b0a78e', // 7  peripheral_latency  bottom of stack      titanium  66
    '#d0c6a8', // 8  fps_live            avg FPS              champagne 77
    '#9e9582', // 9  fps_1pct                                 taupe     59
    '#7a7263', // 10 fps_01pct                                shadow    46
    // fallback slots for any additional metrics (keeps %-index stable)
    '#bcb39a', '#867e6c', '#d8cfb4', '#a69c84', '#706856',
    '#c8bfa4', '#988f7a', '#e0d8c0', '#827a68',
];

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// ── State ────────────────────────────────────────────────────────────────────

const gpuState = {};
let isInitialized = false;
let worker;

// Multi-session state
const sessions    = new Map();  // id → { name, chartState, fileData, customMouseLatency, usedCustomMouseLatency }
let activeSessionId   = null;
let nextSessionId     = 1;
let viewMode            = 'single'; // 'single' | 'compare'
let compareChartState   = null;
let compareVisibleMetrics = new Map(); // metric key → boolean
let compareSortMetric   = 'fps_live';   // metric key to sort by
let compareSortDir      = 'desc';       // 'asc' | 'desc'
let compareExcludedIds  = new Set();    // session ids manually removed from compare

// Global single-view metric visibility — shared across all sessions.
// Initialised on first session load; toggling a metric updates this map
// and applies the change to every session.
const singleVisibility = new Map();

// Worker queue — serialize DuckDB processing
const workerQueue = [];
let workerBusy    = false;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const landingStatusEl = document.getElementById("status-landing");
const sessionListEl   = document.getElementById("session-list");
const singleViewEl    = document.getElementById("single-view");
const compareViewEl   = document.getElementById("compare-view");
const sidebarScrollEl = document.querySelector(".sidebar-scroll");

function setStatus() {} // no-op: status bar removed

// ── Startup ──────────────────────────────────────────────────────────────────

if (!window.crossOriginIsolated) {
    landingStatusEl.textContent = "Service Worker initializing. Reloading...";
} else {
    landingStatusEl.textContent = "Ready.";
    initWorker();
}

function initWorker() {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
        if (data.status) setStatus(data.status);

        if (data.type === 'RENDER_CHART') {
            const session = sessions.get(data.sessionId);
            if (!session) { drainWorkerQueue(); return; }

            session.chartState = buildChartState(data);
            session.usedCustomMouseLatency = data.usedCustomMouseLatency;
            // Store raw arrays for fast client-side peripheral latency recalculation
            session.mouseLatencyRaw   = data.mouseLatencyRaw;
            session.pcDisplayLatency  = data.pcDisplayLatency;
            session.systemLatencyRaw  = data.systemLatencyRaw;
            session.gpuName           = data.gpuName;
            session.cpuName           = data.cpuName;
            session.lastRenderData    = data;
            updateSessionPanel();

            if (data.sessionId === activeSessionId && viewMode === 'single') {
                render();
                buildSidebar();
            }
            if (viewMode === 'compare') buildCompareView();

            drainWorkerQueue();
        }

        if (data.type === 'ERROR') {
            drainWorkerQueue();
        }
    };
}

// ── Worker queue ─────────────────────────────────────────────────────────────

function enqueueWorkerMessage(msg) {
    workerQueue.push(msg);
    if (!workerBusy) drainWorkerQueue();
}

function drainWorkerQueue() {
    if (workerQueue.length === 0) { workerBusy = false; return; }
    workerBusy = true;
    worker.postMessage(workerQueue.shift());
}

// ── File input ───────────────────────────────────────────────────────────────

const csvInput = document.getElementById("csv-input");
document.getElementById("open-files-btn").addEventListener("click", () => csvInput.click());
document.getElementById("load-demo-btn").addEventListener("click", loadDemoData);


const DEMO_PAIRS = [
    { fv: 'demo/pr_480hz_480fps.csv',      app: 'demo/pr_480hz_480fps_data.csv' },
    { fv: 'demo/pr_540hz_540fps.csv',      app: 'demo/pr_540hz_540fps_data.csv' },
    { fv: 'demo/pr_600hz_600fps.csv',      app: 'demo/pr_600hz_600fps_data.csv' },
];

async function loadDemoData() {
    landingStatusEl.textContent = 'Loading sample data...';
    try {
        const pairs = [];
        for (const { fv, app } of DEMO_PAIRS) {
            const [fvResp, appResp] = await Promise.all([fetch(fv), fetch(app)]);
            if (!fvResp.ok || !appResp.ok) throw new Error('Failed to fetch demo files');
            const [fvBlob, appBlob] = await Promise.all([fvResp.blob(), appResp.blob()]);
            const ts = Date.now();
            const fvFile  = new File([fvBlob],  fv.split('/').pop(),  { type: 'text/csv', lastModified: ts });
            const appFile = new File([appBlob], app.split('/').pop(), { type: 'text/csv', lastModified: ts });
            pairs.push([fvFile, appFile]);
        }

        document.body.className = 'view-workspace';
        setStatus('Initializing...');

        if (!isInitialized) {
            isInitialized = true;
            await new Promise(resolve => requestAnimationFrame(resolve));
            await initWebGPU();
        }

        for (const pair of pairs) {
            const id = nextSessionId++;
            const name = deriveSessionName(pair[0]);
            sessions.set(id, {
                name,
                chartState: null,
                fileData: { flatFiles: [pair[0], pair[1]], pairs: [[pair[0].name, pair[1].name]] },
                customMouseLatency: 1.0,
                usedCustomMouseLatency: false,
            });

            enqueueWorkerMessage({
                type: 'LOAD_FILE_PAIRS',
                sessionId: id,
                flatFiles: [pair[0], pair[1]],
                pairs: [[pair[0].name, pair[1].name]],
                customMouseLatency: 1.0,
            });
        }

        if (activeSessionId === null) {
            activeSessionId = sessions.keys().next().value;
        }
        updateSessionPanel();
    } catch (e) {
        landingStatusEl.textContent = 'Failed to load sample data: ' + e.message;
    }
}

csvInput.addEventListener("change", async ({ target }) => {
    if (!target.files.length) return;
    const pairs = await pairFilesByTime(target.files);
    if (!pairs.length) {
        const msg = "No valid pairs found. Select one FrameView CSV and one NVIDIA App CSV.";
        document.body.className === "view-workspace" ? setStatus(msg) : (landingStatusEl.textContent = msg);
        return;
    }

    document.body.className = "view-workspace";
    setStatus("Initializing...");

    if (!isInitialized) {
        isInitialized = true;
        await new Promise(resolve => requestAnimationFrame(resolve));
        await initWebGPU();
    }

    // Create a session per pair
    for (const pair of pairs) {
        const id = nextSessionId++;
        const name = deriveSessionName(pair[0]);
        sessions.set(id, {
            name,
            chartState: null,
            fileData: { flatFiles: [pair[0], pair[1]], pairs: [[pair[0].name, pair[1].name]] },
            customMouseLatency: 1.0,
            usedCustomMouseLatency: false,
        });

        enqueueWorkerMessage({
            type: "LOAD_FILE_PAIRS",
            sessionId: id,
            flatFiles: [pair[0], pair[1]],
            pairs: [[pair[0].name, pair[1].name]],
            customMouseLatency: 1.0,
        });
    }

    // Activate the first new session if none active
    if (activeSessionId === null) {
        activeSessionId = sessions.keys().next().value;
    }

    updateSessionPanel();
    target.value = '';
});

function deriveSessionName(frameViewFile) {
    let name = frameViewFile.name.replace(/\.csv$/i, '');
    name = name.replace(/^FrameView[-_ ]*/i, '');
    return name || 'Session';
}

function sendSessionToWorker(id) {
    const session = sessions.get(id);
    if (!session) return;
    enqueueWorkerMessage({
        type: "LOAD_FILE_PAIRS",
        sessionId: id,
        flatFiles: session.fileData.flatFiles,
        pairs: [session.fileData.pairs[0]],
        customMouseLatency: session.customMouseLatency,
    });
}

// Must use Float32 representation for exact comparison against Float32Array values
const MOUSE_LATENCY_SENTINEL = new Float32Array([-0.001])[0];

// Fast client-side recalculation of peripheral/system latency without worker round-trip
function recalcPeripheralLatency(id) {
    const session = sessions.get(id);
    if (!session || !session.lastRenderData || !session.mouseLatencyRaw) return;

    const { mouseLatencyRaw, pcDisplayLatency, systemLatencyRaw, customMouseLatency } = session;
    const data = session.lastRenderData;
    const n = mouseLatencyRaw.length;

    // Recompute peripheral_latency and system_latency arrays
    const newPeripheral = new Float32Array(n);
    const newSystem     = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const raw = mouseLatencyRaw[i];
        const isSentinel = raw === MOUSE_LATENCY_SENTINEL;
        newPeripheral[i] = Math.max(0, isSentinel ? customMouseLatency : raw);
        newSystem[i]     = Math.max(0, isSentinel ? pcDisplayLatency[i] + customMouseLatency : systemLatencyRaw[i]);
    }

    // Patch the metrics array with recalculated values and stats
    const updatedMetrics = data.metrics.map(m => {
        if (m.key === 'peripheral_latency') {
            let min = Infinity, max = -Infinity, sum = 0;
            for (let i = 0; i < n; i++) { const v = newPeripheral[i]; if (v < min) min = v; if (v > max) max = v; sum += v; }
            return { ...m, data: newPeripheral, min, max, avg: sum / n };
        }
        if (m.key === 'system_latency') {
            let min = Infinity, max = -Infinity, sum = 0;
            for (let i = 0; i < n; i++) { const v = newSystem[i]; if (v < min) min = v; if (v > max) max = v; sum += v; }
            return { ...m, data: newSystem, min, max, avg: sum / n };
        }
        return m;
    });

    // Rebuild chart state with patched metrics
    const patchedData = { ...data, metrics: updatedMetrics };
    session.lastRenderData = patchedData;
    session.chartState = buildChartState(patchedData);

    if (id === activeSessionId && viewMode === 'single') {
        render();
        buildSidebar();
    }
    if (viewMode === 'compare') buildCompareView();
}

async function pairFilesByTime(fileList) {
    const files = await Promise.all(Array.from(fileList).map(async file => {
        const text   = await file.slice(0, 1024).text();
        const header = text.split('\n')[0];
        const type   = header.includes('TimeInSeconds')           ? 'frameview'
                     : header.includes('Elapsed time in seconds') ? 'app'
                     : null;
        return { file, type };
    }));

    const frameViewFiles = files.filter(f => f.type === 'frameview');
    const appFiles       = files.filter(f => f.type === 'app');
    const usedAppFiles   = new Set();
    const pairs          = [];

    for (const fv of frameViewFiles) {
        let best = null, bestDiff = Infinity;
        for (const app of appFiles) {
            if (usedAppFiles.has(app)) continue;
            const diff = Math.abs(fv.file.lastModified - app.file.lastModified);
            if (diff < bestDiff) { best = app; bestDiff = diff; }
        }
        if (best) { pairs.push([fv.file, best.file]); usedAppFiles.add(best); }
    }
    return pairs;
}

// ── Session management ───────────────────────────────────────────────────────

function setActiveSession(id) {
    if (!sessions.has(id)) return;
    activeSessionId = id;
    viewMode = 'single';
    updateSessionPanel();
    updateViewVisibility();

    const session = sessions.get(id);
    if (session.chartState) {
        render();
        buildSidebar();
    }
}

function removeSession(id) {
    const session = sessions.get(id);
    if (!session) return;

    // Destroy GPU buffers
    if (session.chartState) {
        session.chartState.timestampBuffer.destroy();
        session.chartState.metrics.forEach(m => {
            m.vertexBuffer.destroy();
            m.uniformBuffer.destroy();
            m.areaBuffer.destroy();
            m.areaUniformBuffer.destroy();
        });
    }

    sessions.delete(id);

    if (activeSessionId === id) {
        activeSessionId = sessions.size > 0 ? sessions.keys().next().value : null;
    }

    if (sessions.size === 0) {
        document.body.className = "view-landing";
        return;
    }

    updateSessionPanel();

    if (viewMode === 'single' && activeSessionId !== null) {
        const active = sessions.get(activeSessionId);
        if (active && active.chartState) {
            render();
            buildSidebar();
        }
    }
    if (viewMode === 'compare') buildCompareView();
}

function updateSessionPanel() {
    sessionListEl.innerHTML = '';

    // Group label
    const label = document.createElement('p');
    label.className = 'group-label';
    label.textContent = 'Sessions';
    sessionListEl.appendChild(label);

    for (const [id, session] of sessions) {
        const row = document.createElement('div');
        row.className = 'session-row' + (id === activeSessionId && viewMode === 'single' ? ' active' : '');

        const name = document.createElement('span');
        name.className = 'session-name';
        name.textContent = session.name;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'session-remove';
        removeBtn.textContent = '\u00D7';
        removeBtn.title = 'Remove session';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeSession(id);
        });

        row.addEventListener('click', () => {
            if (viewMode === 'single') setActiveSession(id);
        });

        row.appendChild(name);
        row.appendChild(removeBtn);
        sessionListEl.appendChild(row);
    }

    // Action buttons below list
    const actions = document.createElement('div');
    actions.className = 'session-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-session-action';
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', () => document.getElementById('csv-input').click());

    const readySessions = [...sessions.values()].filter(s => s.chartState);

    const compareBtn = document.createElement('button');
    compareBtn.className = 'btn-session-action';
    compareBtn.textContent = viewMode === 'compare' ? 'Exit' : 'Compare';
    compareBtn.disabled = readySessions.length < 1;
    compareBtn.addEventListener('click', () => {
        if (viewMode === 'compare') exitCompareMode();
        else enterCompareMode();
    });

    actions.appendChild(addBtn);
    actions.appendChild(compareBtn);
    sessionListEl.appendChild(actions);
}

function updateViewVisibility() {
    if (viewMode === 'single') {
        singleViewEl.classList.remove('hidden');
        compareViewEl.classList.remove('visible');
        sidebarScrollEl.classList.remove('compare-mode');
    } else {
        singleViewEl.classList.add('hidden');
        compareViewEl.classList.add('visible');
        sidebarScrollEl.classList.add('compare-mode');
    }
    updateSessionPanel();
}

// ── Compare mode ─────────────────────────────────────────────────────────────

function getCheckedSessionIds() {
    return [...sessions.keys()].filter(id => !compareExcludedIds.has(id));
}

function enterCompareMode() {
    viewMode = 'compare';
    compareExcludedIds.clear();
    // Seed compare visibility from single-view selections so toggled metrics carry over.
    compareVisibleMetrics.clear();
    for (const [key, vis] of singleVisibility) compareVisibleMetrics.set(key, vis);
    updateViewVisibility();
    const scroll = document.querySelector('#compare-view .compare-scroll');
    if (scroll) scroll.scrollTop = 0;
    buildCompareView();
}

function exitCompareMode() {
    viewMode = 'single';
    updateViewVisibility();
    if (compareChartState) {
        for (const bar of compareChartState.bars) {
            bar.vertexBuffer.destroy();
            bar.uniformBuffer.destroy();
        }
        compareChartState = null;
    }
    // Sync compare selections back to single-view visibility.
    for (const [key, vis] of compareVisibleMetrics) singleVisibility.set(key, vis);
    compareVisibleMetrics.clear();
    compareExcludedIds.clear();
    // Apply updated visibility to all sessions.
    for (const s of sessions.values()) {
        if (!s.chartState) continue;
        for (const m of s.chartState.metrics) {
            if (singleVisibility.has(m.key)) m.visible = singleVisibility.get(m.key);
        }
    }
    if (activeSessionId !== null) {
        const session = sessions.get(activeSessionId);
        if (session && session.chartState) {
            recomputeYAxes(session);
            render();
            buildSidebar();
        }
    }
}



// ── Compare WebGPU canvas ────────────────────────────────────────────────────

const COMPARE_MARGINS = { top: 116, right: 108, bottom: 88, left: 220 };
const COMPARE_ROW_HEIGHT = 150; // CSS px per session — fixed, never stretches

function compareRegion() {
    const c    = gpuState.compareCanvas;
    const cssW = c.clientWidth;
    const cssH = c.clientHeight;
    const M    = COMPARE_MARGINS;
    return {
        cssW, cssH,
        x: M.left,
        y: M.top,
        w: Math.max(1, cssW - M.left - M.right),
        h: Math.max(1, cssH - M.top - M.bottom),
    };
}

function initCompareCanvas() {
    if (gpuState.compareCanvas) return;
    const canvas = document.getElementById('compare-canvas');
    gpuState.compareCanvas    = canvas;
    gpuState.compareCtx2d     = canvas.getContext('2d');
    gpuState.compareOffscreen = new OffscreenCanvas(1, 1);

    const overlay = document.getElementById('compare-overlay');
    gpuState.compareOverlay    = overlay;
    gpuState.compareOverlayCtx = overlay.getContext('2d');

    const scrollContainer = document.querySelector('#compare-view .compare-scroll');
    gpuState.compareScroll = scrollContainer;

    const context = gpuState.compareOffscreen.getContext('webgpu');
    const format  = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device: gpuState.device, format, alphaMode: 'premultiplied' });
    gpuState.compareContext = context;

    // Observe the scroll container for viewport size changes (window resize).
    // The data canvas height is set dynamically in buildCompareView based on
    // session count; this observer handles width changes and redraws.
    new ResizeObserver(() => {
        syncCompareCanvasSizes();
        if (viewMode === 'compare') renderCompareChart();
    }).observe(scrollContainer);

    scrollContainer.addEventListener('scroll', () => {
        if (viewMode === 'compare') renderCompareOverlay();
    });
}

function syncCompareCanvasSizes() {
    const dpr    = devicePixelRatio;
    const scroll = gpuState.compareScroll;
    if (!scroll) return;

    const viewW = scroll.clientWidth;
    const viewH = scroll.clientHeight;
    const M     = COMPARE_MARGINS;

    // Data canvas includes top/bottom margins so right-click → Copy Image
    // captures the full chart with axes.  The overlay re-draws the same
    // axes on top, pinned to the viewport, for sticky-scroll behaviour.
    const n       = compareChartState ? compareChartState.n : 1;
    const dataH   = n * COMPARE_ROW_HEIGHT;
    const canvasH = M.top + dataH + M.bottom;

    const c = gpuState.compareCanvas;
    c.style.height       = canvasH + 'px';
    c.style.marginTop    = '';
    c.style.marginBottom = '';
    c.width  = viewW * dpr;
    c.height = canvasH * dpr;

    // Overlay canvas: sized to match the scroll container's content area
    // (excludes scrollbar) so axis lines align with the data canvas.
    const ov = gpuState.compareOverlay;
    ov.style.width  = viewW + 'px';
    ov.style.height = viewH + 'px';
    ov.width  = viewW * dpr;
    ov.height = viewH * dpr;
}

// Latency stacking order for compare bars. frame_time is NOT in this list —
// it is a sub-metric of game_latency and is rendered as an inset overlay
// inside game_latency's segment rather than as an additive stack entry.
const LAT_STACK_ORDER = ['peripheral_latency', 'game_latency', 'driver_latency', 'render_latency', 'scheduling_latency', 'display_latency'];

// FPS stacking order — ascending value (0.1% Low < 1% Low < Avg).
// Each segment spans from the previous threshold to its own value, identical
// in structure to the latency stacked segments.
const FPS_STACK_ORDER = ['fps_01pct', 'fps_1pct', 'fps_live'];

function getSortValue(session, metricKey) {
    const m = session.chartState.metrics.find(m => m.key === metricKey)
           || (session.chartState.hwMetrics || []).find(m => m.key === metricKey);
    return m ? m.avg : -Infinity;
}

function buildCompareView() {
    const checkedIds = getCheckedSessionIds();
    const compareSessions = checkedIds
        .map(id => ({ id, ...sessions.get(id) }))
        .filter(s => s.chartState);

    if (compareSessions.length < 2) {
        if (viewMode === 'compare') exitCompareMode();
        return;
    }

    // Sort sessions by selected metric
    compareSessions.sort((a, b) => {
        const valA = getSortValue(a, compareSortMetric);
        const valB = getSortValue(b, compareSortMetric);
        return compareSortDir === 'desc' ? valB - valA : valA - valB;
    });

    // Union of all metric objects (keyed), taking color from first session that has it.
    let hwColorIdx = 0;
    const allMetricsByKey = new Map();
    for (const s of compareSessions) {
        for (const m of s.chartState.metrics) {
            if (!allMetricsByKey.has(m.key)) allMetricsByKey.set(m.key, m);
        }
        for (const m of (s.chartState.hwMetrics || [])) {
            if (!allMetricsByKey.has(m.key)) {
                allMetricsByKey.set(m.key, { ...m, color: HW_COLORS[hwColorIdx++ % HW_COLORS.length] });
            }
        }
    }

    // Seed compareVisibleMetrics for any new keys.
    // Only system_latency and fps_live are on by default; everything else is off.
    // frame_time cannot be active if game_latency is inactive.
    for (const [key] of allMetricsByKey) {
        if (!compareVisibleMetrics.has(key)) {
            let defaultVisible = key === 'system_latency' || key === 'fps_live';
            if (key === 'frame_time' && !compareVisibleMetrics.get('game_latency')) {
                defaultVisible = false;
            }
            compareVisibleMetrics.set(key, defaultVisible);
        }
    }

    // Collect visible HW metric keys and compute their maxes across sessions.
    const HW_GROUPS = new Set(['GPU', 'CPU']);
    const visibleHwKeys = [];
    const hwMaxes = new Map(); // key → max avg across sessions
    for (const [key, m] of allMetricsByKey) {
        if (!HW_GROUPS.has(m.group) || !compareVisibleMetrics.get(key)) continue;
        visibleHwKeys.push(key);
        let maxVal = 0;
        for (const s of compareSessions) {
            const hwM = (s.chartState.hwMetrics || []).find(h => h.key === key);
            if (hwM) maxVal = Math.max(maxVal, hwM.avg);
        }
        hwMaxes.set(key, maxVal > 0 ? maxVal : 1);
    }

    // Axis maxes based on avg values of *visible* metrics across sessions.
    const hasVisibleLat = LAT_STACK_ORDER.some(k => compareVisibleMetrics.get(k))
                       || compareVisibleMetrics.get('system_latency');
    const hasVisibleFps = FPS_STACK_ORDER.some(k => compareVisibleMetrics.get(k));

    // Latency max — use the highest cumulative stack of visible sub-metrics,
    // or system_latency envelope if that alone is selected.
    let latMaxRaw = 0;
    if (hasVisibleLat) {
        for (const s of compareSessions) {
            const metByKey = new Map(s.chartState.metrics.map(m => [m.key, m]));
            // Cumulative stack of visible sub-latency metrics
            let cumAvg = 0;
            for (const k of LAT_STACK_ORDER) {
                if (compareVisibleMetrics.get(k) && metByKey.has(k)) cumAvg += metByKey.get(k).avg;
            }
            // system_latency envelope (not additive with sub-metrics)
            const sysAvg = compareVisibleMetrics.get('system_latency') ? (metByKey.get('system_latency')?.avg ?? 0) : 0;
            latMaxRaw = Math.max(latMaxRaw, cumAvg, sysAvg);
        }
    }
    const latMax = latMaxRaw <= 0 ? 0
                 : latMaxRaw < 2 ? Math.max(0.2, Math.ceil(latMaxRaw / 0.2) * 0.2)
                                 : Math.max(1,   Math.ceil(latMaxRaw));

    // FPS max — highest visible FPS metric avg across sessions.
    let fpsMaxRaw = 0;
    if (hasVisibleFps) {
        for (const s of compareSessions) {
            const metByKey = new Map(s.chartState.metrics.map(m => [m.key, m]));
            for (const k of FPS_STACK_ORDER) {
                if (compareVisibleMetrics.get(k) && metByKey.has(k)) {
                    fpsMaxRaw = Math.max(fpsMaxRaw, metByKey.get(k).avg);
                }
            }
        }
    }
    const fpsMax = fpsMaxRaw > 0 ? Math.max(50, Math.ceil(fpsMaxRaw / 50) * 50) : 0;


    // Destroy old GPU buffers before rebuilding.
    if (compareChartState) {
        for (const seg of compareChartState.bars) {
            seg.vertexBuffer.destroy();
            seg.uniformBuffer.destroy();
        }
    }

    const { device, areaPipeline } = gpuState;
    const n = compareSessions.length;

    // Coordinate space:
    //   x ∈ [0, 1] — normalized value
    //   y ∈ [0, n] — row i at top, flipped via uniform bounds [yMin=n, yMax=0]
    // Bar layout is dynamic — each visible category (FPS, Latency, HW metrics)
    // gets an equal-height slot, centred vertically in the row.

    const makeSeg = (x0, x1, y0, y1, colorHex, alpha = 0.22) => {
        const [cr, cg, cb] = hexToRgb(colorHex);
        const verts = new Float32Array([x0, y0, x1, y0, x0, y1, x1, y1]);
        const vertexBuffer = device.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(vertexBuffer, 0, verts);
        const uniformBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([0, 1, n, 0, cr, cg, cb, alpha]));
        const bindGroup = device.createBindGroup({ layout: areaPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
        return { vertexBuffer, uniformBuffer, bindGroup, x0, x1, y0frac: y0 - Math.floor(y0), y1frac: y1 - Math.floor(y0), row: Math.floor(y0), colorHex };
    };

    const bars = [];
    const rows = compareSessions.map(s => ({ name: s.name }));

    // Dynamic bar layout: compute how many bar slots are needed and size them evenly.
    const barSlots = [];
    if (hasVisibleFps) barSlots.push('fps');
    if (hasVisibleLat) barSlots.push('lat');
    for (const k of visibleHwKeys) barSlots.push(k);

    const slotCount = barSlots.length;
    const gap       = 0.04;
    const totalGap  = Math.max(0, slotCount - 1) * gap;
    const barH      = slotCount > 0 ? Math.min(0.30, (0.80 - totalGap) / slotCount) : 0.30;
    const blockH    = slotCount * barH + totalGap;
    const blockTop  = 0.50 - blockH / 2;

    const slotTop = (idx) => blockTop + idx * (barH + gap);

    compareSessions.forEach((s, i) => {
        const metByKey = new Map(s.chartState.metrics.map(m => [m.key, m]));
        const hwByKey  = new Map((s.chartState.hwMetrics || []).map(m => [m.key, m]));

        const fpsSlot = barSlots.indexOf('fps');
        const latSlot = barSlots.indexOf('lat');

        // ── FPS stacked segments ─────────────────────────────────────────────
        if (fpsMax > 0 && fpsSlot >= 0) {
            const top = slotTop(fpsSlot), bot = top + barH;
            const visFps = FPS_STACK_ORDER.filter(k => compareVisibleMetrics.get(k) && metByKey.has(k));
            let prevVal = 0;
            visFps.forEach((k) => {
                const m      = metByKey.get(k);
                const x0     = prevVal / fpsMax;
                const x1     = Math.min(m.avg / fpsMax, 1);
                prevVal      = m.avg;
                bars.push({ ...makeSeg(x0, x1, i + top, i + bot, m.color),
                    type: 'fps', capLabel: null,
                    segValue: m.avg.toFixed(0) });
            });
        }

        // ── Latency stacked segments ─────────────────────────────────────────
        if (latMax > 0 && latSlot >= 0) {
            const top = slotTop(latSlot), bot = top + barH;
            const allSubSelected = LAT_STACK_ORDER.every(
                k => !metByKey.has(k) || compareVisibleMetrics.get(k));

            if (compareVisibleMetrics.get('system_latency') && metByKey.has('system_latency')) {
                const sys    = metByKey.get('system_latency');
                const shellX = Math.min(sys.avg / latMax, 1);
                bars.push({ ...makeSeg(0, shellX, i + top, i + bot, sys.color, 0.10),
                    type: 'lat_shell',
                    capLabel: allSubSelected ? sys.avg.toFixed(2) : null,
                    segValue: sys.avg.toFixed(2) });
            }

            const visLat = LAT_STACK_ORDER.filter(k => compareVisibleMetrics.get(k) && metByKey.has(k));
            let cumX = 0;
            let gameSegX0 = null, gameSegX1 = null;
            visLat.forEach((k, j) => {
                const m      = metByKey.get(k);
                const x0     = cumX / latMax;
                cumX        += m.avg;
                const x1     = Math.min(cumX / latMax, 1);
                if (k === 'game_latency') { gameSegX0 = x0; gameSegX1 = x1; }
                const isLast = j === visLat.length - 1;
                bars.push({ ...makeSeg(x0, x1, i + top, i + bot, m.color),
                    type: 'lat', capLabel: isLast && visLat.length > 1 && !allSubSelected ? cumX.toFixed(2) : null,
                    segValue: m.avg.toFixed(2) });
            });

            if (gameSegX0 !== null && compareVisibleMetrics.get('frame_time') && metByKey.has('frame_time')) {
                const ft   = metByKey.get('frame_time');
                const ftX1 = Math.min(gameSegX0 + ft.avg / latMax, gameSegX1);
                bars.push({ ...makeSeg(gameSegX0, ftX1, i + top, i + bot, ft.color),
                    type: 'lat_sub', capLabel: null, segValue: ft.avg.toFixed(2) });
            }
        }

        // ── HW metric bars (one per visible HW metric) ──────────────────────
        for (const hwKey of visibleHwKeys) {
            const hwM = hwByKey.get(hwKey);
            if (!hwM) continue;
            const slotIdx = barSlots.indexOf(hwKey);
            const top = slotTop(slotIdx), bot = top + barH;
            const maxVal = hwMaxes.get(hwKey);
            const x1 = Math.min(hwM.avg / maxVal, 1);
            const meta = allMetricsByKey.get(hwKey);
            bars.push({ ...makeSeg(0, x1, i + top, i + bot, meta.color),
                type: 'hw', capLabel: null,
                segValue: fmtHwVal(hwM.avg, hwM.unit) + ' ' + hwM.unit });
        }
    });

    // Build legend items from the union of metrics, respecting compare visibility.
    const compareLegendItems = [];
    for (const [key, m] of allMetricsByKey) {
        if (compareVisibleMetrics.get(key)) {
            compareLegendItems.push({ color: m.color, label: m.label });
        }
    }

    compareChartState = { rows, bars, fpsMax, latMax, hwMaxes, n, legendItems: compareLegendItems };

    initCompareCanvas();
    syncCompareCanvasSizes();
    buildCompareSidebar(compareSessions, allMetricsByKey);
    renderCompareChart();
}

function buildCompareSidebar(compareSessions, allMetricsByKey) {
    // Collect union of metrics with averaged stats across all compared sessions.
    const metaMap = new Map(); // key → { label, unit, group, color, minSum, avgSum, maxSum, count }
    for (const s of compareSessions) {
        const allMetrics = [...s.chartState.metrics, ...(s.chartState.hwMetrics || [])];
        for (const m of allMetrics) {
            if (!metaMap.has(m.key)) {
                // Use color from allMetricsByKey (which has HW colors assigned)
                const colorSrc = allMetricsByKey?.get(m.key);
                metaMap.set(m.key, { label: m.label, unit: m.unit, group: m.group, color: colorSrc?.color ?? m.color, minSum: 0, avgSum: 0, maxSum: 0, count: 0 });
            }
            const d = metaMap.get(m.key);
            d.minSum += m.min; d.avgSum += m.avg; d.maxSum += m.max; d.count++;
        }
    }

    const anyCustomMouse = compareSessions.some(s => s.usedCustomMouseLatency);
    document.getElementById('mouse-latency-config').style.display = 'none';

    const container = document.getElementById('metrics-container');
    container.innerHTML = '';

    // ── Sort control ─────────────────────────────────────────────────────────
    const sortBlock = document.createElement('div');
    sortBlock.className = 'compare-sort visible';

    const sortOptions = [
        ['fps_live',             'Avg FPS'],
        ['fps_1pct',             '1% Low FPS'],
        ['fps_01pct',            '0.1% Low FPS'],
        ['system_latency',       'System Latency'],
        ['display_latency',      'Display Latency'],
        ['scheduling_latency',   'Scheduling Latency'],
        ['render_latency',       'Render Latency'],
        ['driver_latency',       'Driver Latency'],
        ['game_latency',         'Game Latency'],
        ['frame_time',           'Frame Time'],
        ['peripheral_latency',   'Peripheral Latency'],
    ];
    // Append available HW metrics to sort options
    for (const [key, d] of metaMap) {
        if (d.group === 'GPU' || d.group === 'CPU') sortOptions.push([key, d.label]);
    }

    sortBlock.innerHTML = `
        <p class="compare-sort-label">Sort</p>
        <div class="compare-sort-row">
            <select id="compare-sort-metric">
                ${sortOptions.map(([v, l]) => `<option value="${v}"${v === compareSortMetric ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
            <button class="btn-sort" title="${compareSortDir === 'desc' ? 'Descending' : 'Ascending'}">${compareSortDir === 'desc' ? '\u25BC' : '\u25B2'}</button>
        </div>`;

    const selEl = sortBlock.querySelector('select');
    const dirEl = sortBlock.querySelector('.btn-sort');

    selEl.addEventListener('change', () => {
        compareSortMetric = selEl.value;
        buildCompareView();
    });

    dirEl.addEventListener('click', () => {
        compareSortDir = compareSortDir === 'desc' ? 'asc' : 'desc';
        dirEl.textContent = compareSortDir === 'desc' ? '\u25BC' : '\u25B2';
        dirEl.title       = compareSortDir === 'desc' ? 'Descending' : 'Ascending';
        buildCompareView();
    });

    container.appendChild(sortBlock);

    const groups = new Map();
    for (const [key, d] of metaMap) {
        if (!groups.has(d.group)) groups.set(d.group, []);
        groups.get(d.group).push({ key, label: d.label, unit: d.unit, group: d.group, color: d.color, min: d.minSum / d.count, avg: d.avgSum / d.count, max: d.maxSum / d.count });
    }

    // Collect hardware names from the first session that has them
    const compareHwNames = { GPU: null, CPU: null };
    for (const s of compareSessions) {
        if (!compareHwNames.GPU && s.gpuName) compareHwNames.GPU = s.gpuName;
        if (!compareHwNames.CPU && s.cpuName) compareHwNames.CPU = s.cpuName;
        if (compareHwNames.GPU && compareHwNames.CPU) break;
    }

    const orderedCompareGroups = [...groups.keys()].sort((a, b) => {
        const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    for (const groupName of orderedCompareGroups) {
        const groupMetrics = groups.get(groupName);
        const section = document.createElement('div');
        section.className = 'metric-group';

        if (!foldedGroups.has(groupName)) foldedGroups.set(groupName, GROUP_DEFAULT_FOLDED[groupName] ?? false);
        const folded = foldedGroups.get(groupName);

        const heading = document.createElement('p');
        heading.className = 'group-label foldable';
        if (folded) heading.classList.add('folded');
        const hwName = compareHwNames[groupName];
        heading.innerHTML = `<span class="fold-arrow"></span>${groupName}${hwName ? `<span class="hw-name">${hwName}</span>` : ''}`;
        heading.addEventListener('click', () => {
            const nowFolded = !foldedGroups.get(groupName);
            foldedGroups.set(groupName, nowFolded);
            if (nowFolded) {
                for (const m of groupMetrics) compareVisibleMetrics.set(m.key, false);
            }
            buildCompareView();
        });
        section.appendChild(heading);

        if (!folded) {
            for (const metric of groupMetrics) {
                if (metric.key === 'frame_time') continue;
                section.appendChild(buildCompareMetricCard(metric, anyCustomMouse));
                if (metric.key === 'game_latency') {
                    const ftMeta = groupMetrics.find(m => m.key === 'frame_time');
                    if (ftMeta) section.appendChild(buildCompareMetricCard(ftMeta, anyCustomMouse));
                }
            }
        }
        container.appendChild(section);
    }
}

function buildCompareMetricCard(metric, anyCustomMouse) {
    const gameOff  = metric.key === 'frame_time' && compareVisibleMetrics.get('game_latency') === false;
    const visible  = !gameOff && (compareVisibleMetrics.get(metric.key) ?? false);
    const showInlineInput = metric.key === 'peripheral_latency' && anyCustomMouse;

    const card = document.createElement('div');
    card.className = `metric-card${visible ? '' : ' dimmed'}`;
    card.dataset.key = metric.key;
    card.style.setProperty('--c', metric.color);

    const avgText = metric.unit === 'fps' || metric.unit === 'MHz' ? metric.avg.toFixed(0)
                  : metric.unit === '%' || metric.unit === 'W' || metric.unit === '°C' ? metric.avg.toFixed(1)
                  : metric.avg.toFixed(2);
    const unitSuffix = metric.unit === 'ms' || metric.unit === 'fps' ? '' : ` ${metric.unit}`;
    const currentCustom = [...sessions.values()].find(s => s.usedCustomMouseLatency)?.customMouseLatency ?? 1;

    card.innerHTML = `
        <label class="metric-header">
            <input type="checkbox" ${visible ? 'checked' : ''}${gameOff ? ' disabled' : ''}>
            <span class="metric-name">${metric.label}</span>
            ${showInlineInput
                ? `<input type="number" class="input-mono metric-inline-input" value="${currentCustom}" min="0" max="100" step="0.5">`
                : `<span class="metric-unit">${avgText}${unitSuffix}</span>`}
        </label>`;

    card.querySelector('input').addEventListener('change', ({ target }) => {
        compareVisibleMetrics.set(metric.key, target.checked);
        card.classList.toggle('dimmed', !target.checked);
        // Turning off game_latency also forces frame_time off
        if (metric.key === 'game_latency' && !target.checked) {
            compareVisibleMetrics.set('frame_time', false);
        }
        buildCompareView();
    });

    if (showInlineInput) {
        const numInput = card.querySelector('.metric-inline-input');
        numInput.addEventListener('click', e => e.preventDefault());
        numInput.addEventListener('change', () => {
            const value = parseFloat(numInput.value);
            if (isNaN(value) || value < 0) return;
            for (const s of sessions.values()) s.customMouseLatency = value;
            for (const id of sessions.keys()) recalcPeripheralLatency(id);
        });
    }

    return card;
}

function renderCompareChart() {
    if (!compareChartState || !gpuState.compareCtx2d) return;

    const { rows, bars, n } = compareChartState;
    const { device, areaPipeline, compareContext, compareOffscreen, compareCtx2d: ctx2d } = gpuState;
    const dpr = devicePixelRatio;

    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.clearRect(0, 0, ctx2d.canvas.width, ctx2d.canvas.height);
    ctx2d.fillStyle = '#000000';
    ctx2d.fillRect(0, 0, ctx2d.canvas.width, ctx2d.canvas.height);

    const r = compareRegion();

    // ── 1. WebGPU: bar fills into offscreen canvas ───────────────────────────
    compareOffscreen.width  = Math.max(1, Math.round(r.w * dpr));
    compareOffscreen.height = Math.max(1, Math.round(r.h * dpr));

    const commandEncoder = device.createCommandEncoder();
    const renderPass     = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view:       compareContext.getCurrentTexture().createView(),
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: 'clear', storeOp: 'store',
        }],
    });

    renderPass.setPipeline(areaPipeline);
    for (const seg of bars) {
        renderPass.setVertexBuffer(0, seg.vertexBuffer);
        renderPass.setBindGroup(0, seg.bindGroup);
        renderPass.draw(4);
    }

    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);

    // ── 2. Data canvas: blit + scrollable content (bars, names, values) ─────
    ctx2d.scale(dpr, dpr);
    ctx2d.drawImage(compareOffscreen, r.x, r.y, r.w, r.h);

    // Horizontal row separators
    ctx2d.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx2d.lineWidth   = 1;
    ctx2d.beginPath();
    for (let i = 1; i < n; i++) {
        const y = Math.round(r.y + r.h * (i / n)) + 0.5;
        ctx2d.moveTo(r.x, y); ctx2d.lineTo(r.x + r.w, y);
    }
    ctx2d.stroke();

    // Vertical grid lines
    ctx2d.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx2d.beginPath();
    for (let i = 1; i <= 4; i++) {
        const x = Math.round(r.x + r.w * (i / 5)) + 0.5;
        ctx2d.moveTo(x, r.y); ctx2d.lineTo(x, r.y + r.h);
    }
    ctx2d.stroke();

    // Slim 1 px border around each bar segment
    for (const seg of bars) {
        const x1     = Math.round(r.x + seg.x1 * r.w) + 0.5;
        const x0     = Math.round(r.x + seg.x0 * r.w) + 0.5;
        const barTop = Math.round(r.y + r.h * (seg.row + seg.y0frac) / n) + 0.5;
        const barBot = Math.round(r.y + r.h * (seg.row + seg.y1frac) / n) - 0.5;
        ctx2d.strokeStyle = seg.colorHex;
        ctx2d.lineWidth   = 1;
        ctx2d.strokeRect(x0, barTop, x1 - x0, barBot - barTop);
    }

    // Inside value labels — right-aligned within each segment, hidden if too narrow
    ctx2d.font         = '12px "JetBrains Mono", "SF Mono", Consolas, monospace';
    ctx2d.textBaseline = 'middle';
    ctx2d.textAlign    = 'right';
    for (const seg of bars) {
        if (!seg.segValue) continue;
        const segPxW = (seg.x1 - seg.x0) * r.w;
        const textW  = ctx2d.measureText(seg.segValue).width;
        if (segPxW < textW + 14) continue;
        const labelX = r.x + seg.x1 * r.w - 7;
        const labelY = r.y + r.h * (seg.row + (seg.y0frac + seg.y1frac) / 2) / n;
        ctx2d.fillStyle = 'rgba(255,255,255,0.85)';
        ctx2d.fillText(seg.segValue, labelX, labelY);
    }

    // Session name labels (Y-axis) — scroll with the data
    ctx2d.font = '300 13px "Inter", system-ui, sans-serif';
    ctx2d.fillStyle = '#d0c8b8';
    ctx2d.textAlign = 'right'; ctx2d.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
        ctx2d.fillText(rows[i].name, r.x - 24, r.y + r.h * ((i + 0.5) / n));
    }

    // Cap value labels (right of end-cap)
    ctx2d.font = '12px "JetBrains Mono", "SF Mono", Consolas, monospace';
    ctx2d.textBaseline = 'middle'; ctx2d.textAlign = 'left';
    for (const seg of bars) {
        if (!seg.capLabel) continue;
        const labelX = r.x + seg.x1 * r.w + 10;
        const labelY = r.y + r.h * (seg.row + (seg.y0frac + seg.y1frac) / 2) / n;
        ctx2d.fillStyle = '#b0a898';
        ctx2d.fillText(seg.capLabel, labelX, labelY);
    }

    // ── 3. Axes, ticks, titles — drawn on the data canvas so Copy Image
    //    captures a complete chart.  The overlay re-draws these pinned to
    //    the viewport for sticky-scroll behaviour. ───────────────────────────
    const { fpsMax, latMax } = compareChartState;

    // Axis frame — top, bottom, left
    ctx2d.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx2d.lineWidth   = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(r.x,       r.y + 0.5);       ctx2d.lineTo(r.x + r.w, r.y + 0.5);
    ctx2d.moveTo(r.x,       r.y + r.h - 0.5); ctx2d.lineTo(r.x + r.w, r.y + r.h - 0.5);
    ctx2d.moveTo(r.x + 0.5, r.y);             ctx2d.lineTo(r.x + 0.5, r.y + r.h);
    ctx2d.stroke();

    ctx2d.fillStyle = '#b0a898';
    ctx2d.font      = '12px "JetBrains Mono", "SF Mono", Consolas, monospace';

    // Top tick labels (FPS)
    if (fpsMax) {
        ctx2d.textBaseline = 'bottom';
        for (let i = 0; i <= 5; i++) {
            const x = r.x + r.w * (i / 5);
            ctx2d.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
            ctx2d.fillText(Math.round((fpsMax / 5) * i).toString(), x, r.y - 12);
        }
    }

    // Bottom tick labels (Latency)
    if (latMax) {
        ctx2d.textBaseline = 'top';
        const latFmt = latMax < 2 ? v => v.toFixed(1) : v => Math.round(v).toString();
        for (let i = 0; i <= 5; i++) {
            const x = r.x + r.w * (i / 5);
            ctx2d.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
            ctx2d.fillText(latFmt((latMax / 5) * i), x, r.y + r.h + 12);
        }
    }

    // Axis titles
    ctx2d.fillStyle = '#908878';
    ctx2d.font = '500 11px "Inter", system-ui, sans-serif';
    const drawTitle = (text, x, y, align) => {
        ctx2d.textAlign = align; ctx2d.textBaseline = 'alphabetic';
        ctx2d.fillText(text.toUpperCase().split('').join('\u2009\u2009'), x, y);
    };
    if (fpsMax) drawTitle('FPS',          r.x + r.w, r.y - 30,       'right');
    if (latMax) drawTitle('Latency (ms)', r.x + r.w, r.y + r.h + 38, 'right');

    // Legend — visible metrics, drawn into the top margin of the data canvas
    if (compareChartState.legendItems) {
        drawLegend(ctx2d, compareChartState.legendItems, r.x, r.y - 68, r.w);
    }

    // ── 4. Pinned overlay: same axes re-drawn at viewport position ──────────
    renderCompareOverlay();
}

// Draws the pinned axis frame, tick labels and titles on the overlay canvas.
// Called on every data render and on scroll (to stay in place while rows move).
// Skipped when the content fits without scrolling — the data canvas's own
// axes are already in the correct position and fully visible.
function renderCompareOverlay() {
    if (!compareChartState || !gpuState.compareOverlayCtx) return;

    const { fpsMax, latMax } = compareChartState;
    const ctx    = gpuState.compareOverlayCtx;
    const ov     = gpuState.compareOverlay;
    const dpr    = devicePixelRatio;
    const scroll = gpuState.compareScroll;

    // No scroll needed → data canvas axes are authoritative, hide overlay.
    if (scroll && scroll.scrollHeight <= scroll.clientHeight) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ov.width, ov.height);
        return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ov.width, ov.height);

    const viewW = ov.width  / dpr;
    const viewH = ov.height / dpr;
    const M     = COMPARE_MARGINS;
    // Plot region within the overlay viewport
    const rx = M.left;
    const rw = Math.max(1, viewW - M.left - M.right);

    ctx.scale(dpr, dpr);

    // Opaque background masks over the top and bottom margin areas so
    // scrolling data rows don't bleed into the axis label regions.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, viewW, M.top);
    ctx.fillRect(0, viewH - M.bottom, viewW, M.bottom);

    // Axis frame — top, bottom, and left lines (all pinned in the viewport)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(rx,       M.top + 0.5);            ctx.lineTo(rx + rw, M.top + 0.5);
    ctx.moveTo(rx,       viewH - M.bottom - 0.5); ctx.lineTo(rx + rw, viewH - M.bottom - 0.5);
    ctx.moveTo(rx + 0.5, M.top);                  ctx.lineTo(rx + 0.5, viewH - M.bottom);
    ctx.stroke();

    // ── Tick labels ─────────────────────────────────────────────────────────
    ctx.fillStyle = '#b0a898';
    ctx.font      = '12px "JetBrains Mono", "SF Mono", Consolas, monospace';

    // Top tick labels (FPS)
    if (fpsMax) {
        ctx.textBaseline = 'bottom';
        for (let i = 0; i <= 5; i++) {
            const x = rx + rw * (i / 5);
            ctx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
            ctx.fillText(Math.round((fpsMax / 5) * i).toString(), x, M.top - 12);
        }
    }

    // Bottom tick labels (Latency)
    if (latMax) {
        ctx.textBaseline = 'top';
        const latFmt = latMax < 2 ? v => v.toFixed(1) : v => Math.round(v).toString();
        for (let i = 0; i <= 5; i++) {
            const x = rx + rw * (i / 5);
            ctx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
            ctx.fillText(latFmt((latMax / 5) * i), x, viewH - M.bottom + 12);
        }
    }

    // ── Axis titles ─────────────────────────────────────────────────────────
    ctx.fillStyle = '#908878';
    ctx.font = '500 11px "Inter", system-ui, sans-serif';
    const drawTitle = (text, x, y, align) => {
        ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
        ctx.fillText(text.toUpperCase().split('').join('\u2009\u2009'), x, y);
    };
    if (fpsMax) drawTitle('FPS',          rx + rw, M.top - 30,            'right');
    if (latMax) drawTitle('Latency (ms)', rx + rw, viewH - M.bottom + 38, 'right');

    // Legend — pinned in the overlay top margin
    if (compareChartState.legendItems) {
        drawLegend(ctx, compareChartState.legendItems, rx, M.top - 68, rw);
    }
}

// ── WebGPU init ──────────────────────────────────────────────────────────────

// Internal margins for axis labels — the visible canvas is sized to the full
// chart area, and WebGPU draws the data into the inner plot region.
const PLOT_MARGINS = { top: 100, right: 112, bottom: 96, left: 112 };

function plotRegion() {
    const c    = gpuState.canvas;
    const cssW = c.clientWidth;
    const cssH = c.clientHeight;
    return {
        cssW, cssH,
        x: PLOT_MARGINS.left,
        y: PLOT_MARGINS.top,
        w: Math.max(1, cssW - PLOT_MARGINS.left - PLOT_MARGINS.right),
        h: Math.max(1, cssH - PLOT_MARGINS.top  - PLOT_MARGINS.bottom),
    };
}

function syncCanvasSizes() {
    const dpr  = devicePixelRatio;
    const c    = gpuState.canvas;
    const r    = plotRegion();
    c.width  = r.cssW * dpr;
    c.height = r.cssH * dpr;
    gpuState.offscreen.width  = Math.max(1, Math.round(r.w * dpr));
    gpuState.offscreen.height = Math.max(1, Math.round(r.h * dpr));
}

async function initWebGPU() {
    const canvas = document.getElementById("gpu-canvas");
    gpuState.canvas = canvas;
    gpuState.ctx2d  = canvas.getContext("2d");

    // WebGPU draws the data lines into an offscreen canvas; the visible 2D
    // canvas blits that result into the plot region and then draws axis
    // frame, grid lines and tick labels on top. This way every chart element
    // — including labels and coordinates — lives in the canvas the user
    // copies via right-click → Copy Image.
    gpuState.offscreen = new OffscreenCanvas(1, 1);

    // Pre-load the fonts used by canvas text. Unlike HTML, canvas text
    // does NOT auto-redraw when a web font finishes loading, so calling
    // fillText with an unloaded font silently falls back (or draws nothing).
    // Loading them up-front guarantees the labels are visible on first render.
    if (document.fonts && document.fonts.load) {
        await Promise.all([
            document.fonts.load('12px "JetBrains Mono"'),
            document.fonts.load('500 11px "Inter"'),
        ]).catch(() => {});
    }

    const adapter = await navigator.gpu.requestAdapter();
    const device  = await adapter.requestDevice();
    gpuState.device = device;

    const context = gpuState.offscreen.getContext("webgpu");
    const format  = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    gpuState.context = context;

    syncCanvasSizes();

    new ResizeObserver(() => {
        syncCanvasSizes();
        render();
    }).observe(canvas);

    const shaderModule = device.createShaderModule({ code: `
        struct Uniforms { bounds: vec4<f32>, color: vec4<f32> };
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        @vertex fn vs_main(@location(0) x: f32, @location(1) y: f32) -> @builtin(position) vec4<f32> {
            let nx = (x - uniforms.bounds[0]) / (uniforms.bounds[1] - uniforms.bounds[0]) * 2.0 - 1.0;
            let ny = (y - uniforms.bounds[2]) / (uniforms.bounds[3] - uniforms.bounds[2]) * 2.0 - 1.0;
            return vec4<f32>(nx, ny, 0.0, 1.0);
        }

        @fragment fn fs_main() -> @location(0) vec4<f32> { return uniforms.color; }
    ` });

    const blendState = {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };

    gpuState.pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: shaderModule,
            entryPoint: "vs_main",
            buffers: [
                { arrayStride: 4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32" }] },
                { arrayStride: 4, attributes: [{ shaderLocation: 1, offset: 0, format: "float32" }] },
            ],
        },
        fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format, blend: blendState }] },
        primitive: { topology: "line-strip" },
    });

    gpuState.areaPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: shaderModule,
            entryPoint: "vs_main",
            buffers: [{
                arrayStride: 8,
                attributes: [
                    { shaderLocation: 0, offset: 0, format: "float32" },
                    { shaderLocation: 1, offset: 4, format: "float32" },
                ],
            }],
        },
        fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format, blend: blendState }] },
        primitive: { topology: "triangle-strip" },
    });

}

// ── Chart data setup ─────────────────────────────────────────────────────────

function buildChartState({ numRows, ts, metrics, minX, maxX, fpsStats, fvTs, fvFps }) {
    const { device, pipeline, areaPipeline } = gpuState;

    const timestampBuffer = device.createBuffer({ size: ts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(timestampBuffer, 0, ts);

    // No horizontal padding — data attaches flush to the left/right axis lines.
    const xMin = minX;
    const xMax = maxX;

    // Stacked latency buffers
    const metricMap   = new Map(metrics.map(m => [m.key, m]));
    const stackedData = new Map();

    let stackFloor     = new Float32Array(numRows);
    let stackGameFloor = stackFloor;

    for (const key of LATENCY_MAJOR_STACK) {
        const m = metricMap.get(key);
        if (!m) continue;
        if (key === 'game_latency') stackGameFloor = stackFloor;
        const buf = new Float32Array(numRows);
        for (let i = 0; i < numRows; i++) buf[i] = stackFloor[i] + (m.data[i] || 0);
        stackedData.set(key, buf);
        if (singleVisibility.get(key) ?? m.defaultActive) stackFloor = buf;
    }

    const ftMetric = metricMap.get('frame_time');
    if (ftMetric) {
        const buf = new Float32Array(numRows);
        for (let i = 0; i < numRows; i++) buf[i] = stackGameFloor[i] + (ftMetric.data[i] || 0);
        stackedData.set('frame_time', buf);
    }

    const sysMetric = metricMap.get('system_latency');
    if (sysMetric) stackedData.set('system_latency', sysMetric.data);

    const latencyMax  = sysMetric ? sysMetric.max
                      : metrics.filter(m => m.group === 'Latency').reduce((a, m) => Math.max(a, m.max), 0);
    // yMax: next higher value divisible by 1. If the latency is < 2 ms,
    // relax to 0.2 so the axis retains useful resolution at small scales.
    const latencyYMax = latencyMax < 2
        ? Math.max(0.2, Math.ceil(latencyMax / 0.2) * 0.2)
        : Math.max(1,   Math.ceil(latencyMax));

    // FPS metrics use raw FrameView data (own timeline, not the ASOF-joined one)
    // so every single frame is represented without duplication.
    let fpsYMax = 50;
    const fvNumRows = fvFps ? fvFps.length : 0;

    const syntheticFps = [];
    if (fvFps && fvTs && fvNumRows > 0 && fpsStats) {
        let minFps = Infinity, maxFps = 0;
        for (let i = 0; i < fvNumRows; i++) {
            if (fvFps[i] > 0 && fvFps[i] < minFps) minFps = fvFps[i];
            if (fvFps[i] > maxFps) maxFps = fvFps[i];
        }
        if (minFps === Infinity) minFps = 0;
        fpsYMax = maxFps > 0 ? Math.max(50, Math.ceil(maxFps / 50) * 50) : 50;

        // FPS metrics carry their own timestamps and vertex count
        const fvTsBuf = device.createBuffer({ size: fvTs.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(fvTsBuf, 0, fvTs);

        syntheticFps.push({ key: 'fps_live',  label: 'FPS',      unit: 'fps', group: 'FPS', defaultActive: true,  data: fvFps,                                                    min: minFps,               max: maxFps,                avg: fpsStats.avgFps,      _fvTs: fvTs, _fvTsBuf: fvTsBuf, _fvCount: fvNumRows });
        syntheticFps.push({ key: 'fps_1pct',  label: '1% Low',   unit: 'fps', group: 'FPS', defaultActive: false, data: new Float32Array(fvNumRows).fill(fpsStats.fps1pctLow),  min: fpsStats.fps1pctLow,  max: fpsStats.fps1pctLow,  avg: fpsStats.fps1pctLow,  _fvTs: fvTs, _fvTsBuf: fvTsBuf, _fvCount: fvNumRows });
        syntheticFps.push({ key: 'fps_01pct', label: '0.1% Low', unit: 'fps', group: 'FPS', defaultActive: false, data: new Float32Array(fvNumRows).fill(fpsStats.fps01pctLow), min: fpsStats.fps01pctLow, max: fpsStats.fps01pctLow, avg: fpsStats.fps01pctLow, _fvTs: fvTs, _fvTsBuf: fvTsBuf, _fvCount: fvNumRows });
    }

    // Separate hardware telemetry (stat-only, not charted) from chartable metrics
    const HW_GROUPS = new Set(['GPU', 'CPU']);
    const chartMetrics = metrics.filter(m => !HW_GROUPS.has(m.group));
    const hwMetrics    = metrics.filter(m => HW_GROUPS.has(m.group))
        .map((m, i) => ({ ...m, color: HW_COLORS[i % HW_COLORS.length] }));

    // Upload GPU buffers
    const metricEntries = [...chartMetrics, ...syntheticFps].map((metric, i) => {
        const color     = COLOR_PALETTE[i % COLOR_PALETTE.length];
        const [r, g, b] = hexToRgb(color);

        let gpuData, yMin, yMax;
        if (metric.group === 'FPS') {
            // FPS: 0 at bottom, fpsYMax at top — full chart height.
            gpuData = metric.data;
            yMin = 0; yMax = fpsYMax;
        } else if (stackedData.has(metric.key)) {
            // Latency: 0 at bottom, extended max at top so data stays in bottom half.
            gpuData = stackedData.get(metric.key);
            yMin = 0; yMax = latencyYMax * 2;
        } else {
            const pad = (metric.max - metric.min) * 0.05 || 1;
            gpuData = metric.data;
            yMin = metric.min - pad; yMax = metric.max + pad;
        }

        const vertexBuffer = device.createBuffer({ size: gpuData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(vertexBuffer, 0, gpuData);

        const uniformBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([xMin, xMax, yMin, yMax, r, g, b, 1.0]));

        const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
        });

        const metricTs    = metric._fvTs    || ts;
        const metricCount = metric._fvCount || numRows;
        const areaData = new Float32Array(metricCount * 4);
        for (let i = 0; i < metricCount; i++) {
            areaData[i * 4 + 0] = metricTs[i]; areaData[i * 4 + 1] = gpuData[i];
            areaData[i * 4 + 2] = metricTs[i]; areaData[i * 4 + 3] = 0;
        }
        const areaBuffer = device.createBuffer({ size: areaData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(areaBuffer, 0, areaData);

        const areaUniformBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(areaUniformBuffer, 0, new Float32Array([xMin, xMax, yMin, yMax, r, g, b, 0.14]));

        const areaBindGroup = device.createBindGroup({
            layout: areaPipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: areaUniformBuffer } }],
        });

        const visible = singleVisibility.has(metric.key) ? singleVisibility.get(metric.key) : metric.defaultActive;
        return { ...metric, rawData: metric.data, color, vertexBuffer, uniformBuffer, bindGroup, areaBuffer, areaUniformBuffer, areaBindGroup, visible };
    });

    // Seed the global visibility map from the first session's defaults.
    if (singleVisibility.size === 0) {
        for (const m of metricEntries) singleVisibility.set(m.key, m.visible);
    }

    return { numRows, ts, timestampBuffer, metrics: metricEntries, hwMetrics, minX, maxX, fpsStats, latencyYMax, fpsYMax };
}

// ── Latency stack recompute ──────────────────────────────────────────────────

function recomputeLatencyStack(targetSession) {
    const session = targetSession ?? sessions.get(activeSessionId);
    if (!session || !session.chartState) return;

    const { device } = gpuState;
    const { metrics, numRows, ts } = session.chartState;
    const byKey = new Map(metrics.map(m => [m.key, m]));

    let floor     = new Float32Array(numRows);
    let gameFloor = floor;

    for (const key of LATENCY_MAJOR_STACK) {
        const m = byKey.get(key);
        if (!m) continue;

        if (key === 'game_latency') gameFloor = floor;

        const buf = new Float32Array(numRows);
        for (let i = 0; i < numRows; i++) buf[i] = floor[i] + (m.rawData[i] || 0);
        device.queue.writeBuffer(m.vertexBuffer, 0, buf);

        const areaBuf = new Float32Array(numRows * 4);
        for (let i = 0; i < numRows; i++) {
            areaBuf[i * 4 + 0] = ts[i]; areaBuf[i * 4 + 1] = buf[i];
            areaBuf[i * 4 + 2] = ts[i]; areaBuf[i * 4 + 3] = 0;
        }
        device.queue.writeBuffer(m.areaBuffer, 0, areaBuf);

        if (m.visible) floor = buf;
    }

    const ft = byKey.get('frame_time');
    if (ft) {
        const buf = new Float32Array(numRows);
        for (let i = 0; i < numRows; i++) buf[i] = gameFloor[i] + (ft.rawData[i] || 0);
        device.queue.writeBuffer(ft.vertexBuffer, 0, buf);

        const areaBuf = new Float32Array(numRows * 4);
        for (let i = 0; i < numRows; i++) {
            areaBuf[i * 4 + 0] = ts[i]; areaBuf[i * 4 + 1] = buf[i];
            areaBuf[i * 4 + 2] = ts[i]; areaBuf[i * 4 + 3] = 0;
        }
        device.queue.writeBuffer(ft.areaBuffer, 0, areaBuf);
    }
}

// ── Single-view Y-axis recalculation ────────────────────────────────────────
// Recomputes latencyYMax and fpsYMax based on currently visible metrics,
// then updates all GPU uniform buffers so the chart scales dynamically.

function updateSingleYAxes(session) {
    if (!session?.chartState) return;
    const { device } = gpuState;
    const { metrics, numRows, minX, maxX } = session.chartState;
    const byKey = new Map(metrics.map(m => [m.key, m]));

    // Effective stacked latency max — replicate the stacking logic for visible metrics.
    let floor = new Float32Array(numRows);
    for (const key of LATENCY_MAJOR_STACK) {
        const m = byKey.get(key);
        if (!m || !m.visible) continue;
        const buf = new Float32Array(numRows);
        for (let i = 0; i < numRows; i++) buf[i] = floor[i] + (m.rawData[i] || 0);
        floor = buf;
    }
    let maxStack = 0;
    for (let i = 0; i < numRows; i++) if (floor[i] > maxStack) maxStack = floor[i];

    // system_latency is an envelope line, not part of the additive stack.
    const sysM = byKey.get('system_latency');
    if (sysM && sysM.visible) maxStack = Math.max(maxStack, sysM.max);

    const latencyYMax = maxStack <= 0 ? 0
        : maxStack < 2 ? Math.max(0.2, Math.ceil(maxStack / 0.2) * 0.2)
        : Math.max(1, Math.ceil(maxStack));

    // FPS max from visible FPS metrics.
    const visFps = metrics.filter(m => m.group === 'FPS' && m.visible);
    const fpsRawMax = visFps.length ? Math.max(...visFps.map(m => m.max)) : 0;
    const fpsYMax = fpsRawMax > 0 ? Math.max(50, Math.ceil(fpsRawMax / 50) * 50) : 0;

    const hasFpsVisible = fpsYMax > 0;

    // Update GPU uniforms for every metric.
    for (const metric of metrics) {
        let yMin, yMax;
        if (metric.group === 'FPS') {
            yMin = 0; yMax = fpsYMax || 50;
        } else if (metric.group === 'Latency') {
            const scale = hasFpsVisible ? 2 : 1;
            yMin = 0; yMax = (latencyYMax || 1) * scale;
        } else {
            const pad = (metric.max - metric.min) * 0.05 || 1;
            yMin = metric.min - pad; yMax = metric.max + pad;
        }
        const [r, g, b] = hexToRgb(metric.color);
        device.queue.writeBuffer(metric.uniformBuffer, 0, new Float32Array([minX, maxX, yMin, yMax, r, g, b, 1.0]));
        device.queue.writeBuffer(metric.areaUniformBuffer, 0, new Float32Array([minX, maxX, yMin, yMax, r, g, b, 0.14]));
    }

    session.chartState.latencyYMax = latencyYMax;
    session.chartState.fpsYMax = fpsYMax;
}

// ── Legend ───────────────────────────────────────────────────────────────────

// Draws a horizontal legend row into a 2D canvas context.
// items: [{ color, label }]  — drawn left-to-right within [x, x+maxW] at cy.
function drawLegend(ctx, items, x, cy, maxW) {
    if (!items.length) return;

    const swatchW = 14, swatchH = 3, gap = 6, itemGap = 20;
    ctx.font = '300 11px "Inter", system-ui, sans-serif';

    // Measure total width to centre the row.
    let totalW = 0;
    const measured = items.map(it => {
        const tw = ctx.measureText(it.label).width;
        return { ...it, tw };
    });
    for (let i = 0; i < measured.length; i++) {
        totalW += swatchW + gap + measured[i].tw;
        if (i < measured.length - 1) totalW += itemGap;
    }

    let cx = x + Math.max(0, (maxW - totalW) / 2);
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'left';

    for (const it of measured) {
        // Swatch
        ctx.fillStyle = it.color;
        ctx.fillRect(Math.round(cx), Math.round(cy - swatchH / 2), swatchW, swatchH);
        cx += swatchW + gap;
        // Label
        ctx.fillStyle = '#b0a898';
        ctx.fillText(it.label, cx, cy);
        cx += it.tw + itemGap;
    }
}

// ── Render ───────────────────────────────────────────────────────────────────

function render() {
    const ctx2d = gpuState.ctx2d;
    if (!ctx2d) return;

    // Always start from a clean visible canvas — even when there is no active
    // session — so leftover frames don't bleed through after session removal.
    const dpr = devicePixelRatio;
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.clearRect(0, 0, ctx2d.canvas.width, ctx2d.canvas.height);
    ctx2d.fillStyle = '#000000';
    ctx2d.fillRect(0, 0, ctx2d.canvas.width, ctx2d.canvas.height);

    const session = sessions.get(activeSessionId);
    if (!session || !session.chartState) return;

    const { device, context, pipeline, areaPipeline, offscreen } = gpuState;
    const { numRows, timestampBuffer, metrics, latencyYMax, fpsYMax, minX, maxX } = session.chartState;

    // ── 1. WebGPU draws data lines + areas into the offscreen canvas ────────
    const commandEncoder = device.createCommandEncoder();
    const renderPass     = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: "clear", storeOp: "store",
        }],
    });

    renderPass.setPipeline(areaPipeline);
    for (const metric of metrics) {
        if (!metric.visible || metric.group === 'FPS') continue;
        renderPass.setVertexBuffer(0, metric.areaBuffer);
        renderPass.setBindGroup(0, metric.areaBindGroup);
        renderPass.draw((metric._fvCount || numRows) * 2);
    }

    renderPass.setPipeline(pipeline);
    for (const metric of metrics) {
        if (!metric.visible) continue;
        renderPass.setVertexBuffer(0, metric._fvTsBuf || timestampBuffer);
        renderPass.setVertexBuffer(1, metric.vertexBuffer);
        renderPass.setBindGroup(0, metric.bindGroup);
        renderPass.draw(metric._fvCount || numRows);
    }

    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);

    // ── 2. 2D canvas: blit data and draw axis frame, grid lines, labels ─────
    const r = plotRegion();
    ctx2d.scale(dpr, dpr);

    // Blit the WebGPU offscreen result into the inner plot region.
    ctx2d.drawImage(offscreen, r.x, r.y, r.w, r.h);

    const hasLatency = metrics.some(m => m.group === 'Latency' && m.visible);
    const hasFps     = metrics.some(m => m.group === 'FPS' && m.visible);

    // 4 interior horizontal grid lines — unified across the full chart.
    ctx2d.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    for (let i = 1; i <= 4; i++) {
        const y = Math.round(r.y + r.h * (1 - i / 5)) + 0.5;
        ctx2d.moveTo(r.x, y);
        ctx2d.lineTo(r.x + r.w, y);
    }
    ctx2d.stroke();

    // Axis frame — left, right, bottom only (no top). 1 px hairlines.
    ctx2d.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    const left   = r.x + 0.5;
    const right  = r.x + r.w - 0.5;
    const bottom = r.y + r.h - 0.5;
    ctx2d.moveTo(left,  r.y);
    ctx2d.lineTo(left,  r.y + r.h);
    ctx2d.moveTo(right, r.y);
    ctx2d.lineTo(right, r.y + r.h);
    ctx2d.moveTo(r.x,        bottom);
    ctx2d.lineTo(r.x + r.w,  bottom);
    ctx2d.stroke();

    // ── Tick labels ─────────────────────────────────────────────────────────
    ctx2d.fillStyle = '#b0a898';
    ctx2d.font      = '12px "JetBrains Mono", "SF Mono", Consolas, monospace';

    // Both axes span the full chart height (0 at bottom, max at top).
    // Latency uses an extended max so its data stays in the bottom half when FPS is visible.
    function drawYTicks(axisMax, side, format) {
        if (!axisMax) return;
        ctx2d.textBaseline = 'middle';
        ctx2d.textAlign    = side === 'left' ? 'right' : 'left';
        const tx = side === 'left' ? r.x - 16 : r.x + r.w + 16;
        for (let i = 0; i <= 5; i++) {
            const value = (axisMax / 5) * i;
            const ty    = r.y + r.h * (1 - i / 5);
            ctx2d.fillText(format(value), tx, ty);
        }
    }

    const latencyAxisMax = latencyYMax * (hasFps ? 2 : 1);
    const latencyFmt = latencyAxisMax < 4 ? v => v.toFixed(1) : v => Math.round(v).toString();
    if (hasFps)     drawYTicks(fpsYMax,        'left',  v => Math.round(v).toString());
    if (hasLatency) drawYTicks(latencyAxisMax,  'right', latencyFmt);

    // X-axis tick labels — 5 evenly spaced including both endpoints
    // (far-left = minX, far-right = maxX), rounded to whole seconds.
    ctx2d.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
        const t  = minX + (maxX - minX) * (i / 4);
        const px = r.x + r.w * (i / 4);
        // Anchor endpoints to their edge so they don't overflow the plot.
        ctx2d.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
        ctx2d.fillText(Math.round(t).toString(), px, r.y + r.h + 14);
    }

    // ── Axis titles ─────────────────────────────────────────────────────────
    ctx2d.fillStyle = '#908878';
    ctx2d.font = '500 11px "Inter", system-ui, sans-serif';
    const drawTitle = (text, x, y, align) => {
        ctx2d.textAlign    = align;
        ctx2d.textBaseline = 'alphabetic';
        const spaced = text.toUpperCase().split('').join('\u2009\u2009');
        ctx2d.fillText(spaced, x, y);
    };
    if (hasFps)     drawTitle('FPS',          r.x,         r.y - 20, 'left');
    if (hasLatency) drawTitle('LATENCY (MS)', r.x + r.w,   r.y - 20, 'right');
    drawTitle('TIME (S)', r.x + r.w / 2, r.y + r.h + 48, 'center');

    // ── Legend — visible metrics, drawn into the top margin ─────────────────
    const legendItems = metrics
        .filter(m => m.visible)
        .map(m => ({ color: m.color, label: m.label }));
    drawLegend(ctx2d, legendItems, r.x, r.y - 62, r.w);
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

const GROUP_ORDER          = ['Latency', 'FPS', 'GPU', 'CPU'];
const GROUP_DEFAULT_FOLDED = { GPU: true, CPU: true };
const foldedGroups         = new Map();
const HW_COLORS            = ['#8ab4a0', '#6a9a88', '#a0c4b0', '#5a8a78', '#7aaa94',
                               '#9aaab8', '#7a8a9a', '#b0bcc8', '#6a7a8c'];

function buildSidebar() {
    const session = sessions.get(activeSessionId);
    if (!session || !session.chartState) return;

    document.getElementById("mouse-latency-config").style.display = "none";

    const container = document.getElementById("metrics-container");
    container.innerHTML = "";

    const groups = new Map();
    for (const metric of session.chartState.metrics) {
        if (!groups.has(metric.group)) groups.set(metric.group, []);
        groups.get(metric.group).push(metric);
    }
    for (const metric of (session.chartState.hwMetrics || [])) {
        if (!groups.has(metric.group)) groups.set(metric.group, []);
        groups.get(metric.group).push(metric);
    }

    const hwNames = { GPU: session.gpuName, CPU: session.cpuName };
    const orderedGroups = [...groups.keys()].sort((a, b) => {
        const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    for (const groupName of orderedGroups) {
        const groupMetrics = groups.get(groupName);
        const isHwGroup = groupName === 'GPU' || groupName === 'CPU';
        const section = document.createElement("div");
        section.className = "metric-group";

        if (!foldedGroups.has(groupName)) foldedGroups.set(groupName, GROUP_DEFAULT_FOLDED[groupName] ?? false);
        const folded = foldedGroups.get(groupName);

        const heading = document.createElement("p");
        heading.className = "group-label foldable";
        if (folded) heading.classList.add("folded");
        const hwName = hwNames[groupName];
        heading.innerHTML = `<span class="fold-arrow"></span>${groupName}${hwName ? `<span class="hw-name">${hwName}</span>` : ''}`;
        heading.addEventListener("click", () => {
            const nowFolded = !foldedGroups.get(groupName);
            foldedGroups.set(groupName, nowFolded);

            // Disable all metrics in the group when folding, restore when unfolding
            if (!isHwGroup) {
                for (const m of groupMetrics) {
                    if (nowFolded) {
                        singleVisibility.set(m.key, false);
                    } else {
                        singleVisibility.set(m.key, m.defaultActive);
                    }
                }
                for (const s of sessions.values()) {
                    if (!s.chartState) continue;
                    for (const m of s.chartState.metrics) {
                        if (singleVisibility.has(m.key)) m.visible = singleVisibility.get(m.key);
                    }
                }
                for (const s of sessions.values()) {
                    if (s.chartState) {
                        recomputeLatencyStack(s);
                        updateSingleYAxes(s);
                    }
                }
                render();
            }
            buildSidebar();
        });
        section.appendChild(heading);

        if (!folded) {
            for (const metric of groupMetrics) {
                if (metric.key === 'frame_time') continue;
                section.appendChild(isHwGroup ? buildHwStatCard(metric) : buildMetricCard(metric));
                if (metric.key === 'game_latency') {
                    const ftMetric = groupMetrics.find(m => m.key === 'frame_time');
                    if (ftMetric) section.appendChild(buildMetricCard(ftMetric));
                }
            }
        }
        container.appendChild(section);
    }
}

function fmtHwVal(value, unit) {
    if (unit === 'MHz') return Math.round(value).toLocaleString();
    if (unit === '%' || unit === 'W' || unit === '°C') return value.toFixed(1);
    return value.toFixed(2);
}

function buildHwStatCard(metric) {
    const card = document.createElement("div");
    card.className = "metric-card";
    card.style.setProperty('--c', metric.color);
    const avg = fmtHwVal(metric.avg, metric.unit);
    card.innerHTML = `
        <div class="metric-header">
            <span class="metric-name">${metric.label}</span>
            <span class="metric-unit">${avg} ${metric.unit}</span>
        </div>`;
    return card;
}


function buildMetricCard(metric) {
    const session   = sessions.get(activeSessionId);
    const gameM     = session?.chartState?.metrics.find(m => m.key === 'game_latency');
    const isDisabled = metric.key === 'frame_time' && gameM && !gameM.visible;
    const showInlineInput = metric.key === 'peripheral_latency' && session?.usedCustomMouseLatency;

    const card = document.createElement("div");
    card.className = `metric-card${metric.visible ? "" : " dimmed"}`;
    card.dataset.key = metric.key;
    card.style.setProperty('--c', metric.color);

    const avgText = metric.unit === 'fps' || metric.unit === 'MHz' ? metric.avg.toFixed(0)
                  : metric.unit === '%' || metric.unit === 'W' || metric.unit === '°C' ? metric.avg.toFixed(1)
                  : metric.avg.toFixed(2);
    const unitSuffix = metric.unit === 'ms' || metric.unit === 'fps' ? '' : ` ${metric.unit}`;

    card.innerHTML = `
        <label class="metric-header">
            <input type="checkbox" ${metric.visible ? "checked" : ""}${isDisabled ? " disabled" : ""}>
            <span class="metric-name">${metric.label}</span>
            ${showInlineInput
                ? `<input type="number" class="input-mono metric-inline-input" value="${session.customMouseLatency}" min="0" max="100" step="0.5">`
                : `<span class="metric-unit">${avgText}${unitSuffix}</span>`}
        </label>`;

    card.querySelector("input").addEventListener("change", ({ target }) => {
        const checked = target.checked;
        // Update global visibility and propagate to all sessions.
        singleVisibility.set(metric.key, checked);

        // Turning off game_latency also forces frame_time off
        if (metric.key === 'game_latency' && !checked) {
            singleVisibility.set('frame_time', false);
        }

        for (const s of sessions.values()) {
            if (!s.chartState) continue;
            for (const m of s.chartState.metrics) {
                if (singleVisibility.has(m.key)) m.visible = singleVisibility.get(m.key);
            }
        }

        // Update UI for the active session's sidebar
        card.classList.toggle("dimmed", !checked);
        if (metric.key === 'game_latency') {
            const ftCard = document.querySelector('.metric-card[data-key="frame_time"]');
            const ftInput = ftCard?.querySelector('input');
            if (!checked) {
                if (ftInput) ftInput.checked = false;
                ftCard?.classList.add('dimmed');
                if (ftInput) ftInput.disabled = true;
            } else {
                if (ftInput) ftInput.disabled = false;
            }
        }

        // Recompute stacks for all sessions that have latency changes
        if (metric.group === 'Latency') {
            for (const s of sessions.values()) {
                if (s.chartState) recomputeLatencyStack(s);
            }
        }
        // Recalculate Y-axis ranges based on visible metrics.
        for (const s of sessions.values()) {
            if (s.chartState) updateSingleYAxes(s);
        }
        render();
    });

    if (showInlineInput) {
        const numInput = card.querySelector('.metric-inline-input');
        numInput.addEventListener('click', e => e.preventDefault());  // prevent label toggle
        numInput.addEventListener('change', () => {
            const value = parseFloat(numInput.value);
            if (isNaN(value) || value < 0) return;
            for (const s of sessions.values()) s.customMouseLatency = value;
            for (const id of sessions.keys()) recalcPeripheralLatency(id);
        });
    }

    return card;
}

// ── Mouse latency config ─────────────────────────────────────────────────────

document.getElementById("apply-mouse-latency").addEventListener("click", () => {
    const value = parseFloat(document.getElementById("mouse-latency-input").value);
    if (isNaN(value) || value < 0) return;

    for (const session of sessions.values()) session.customMouseLatency = value;
    for (const id of sessions.keys()) recalcPeripheralLatency(id);
});

