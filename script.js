document.addEventListener("DOMContentLoaded", () => {
    // --- Application State ---
    const state = {
        viewMode: "single",
        visibility: {
            game: true, os: true, rnd: true, sched: true, disp: true, peri: true,
            tot: false, frametime: false, fps: true, fps1low: false, fps01low: false
        },
        sort: { metric: "ts", dir: "asc" },
        pairedSessions: {},
        activeKey: null,
        chart: null,
    };

    const dom = {
        minR: document.getElementById("minRange"),
        maxR: document.getElementById("maxRange"),
        rTrack: document.getElementById("rangeTrack"),
        rLabel: document.getElementById("rangeLabel"),
        fInput: document.getElementById("csvFile"),
        mouseInput: document.getElementById("manualMouseLat"),
        mouseStatus: document.getElementById("mouseStatus"),
        copyBtn: document.getElementById("copyGraphBtn"),
        mainGrid: document.getElementById("mainGrid"),
        homeBtn: document.getElementById("homeBtn"),
        csWrap: document.getElementById("customSelectWrapper"),
        csDisp: document.getElementById("customSelectDisplay"),
        csOpts: document.getElementById("customSelectOptions"),
        compareBtn: document.getElementById("compareBtn"),
        timespanGroup: document.getElementById("timespanGroup"),
        mouseGroup: document.getElementById("mouseInputGroup"),
        sortGroup: document.getElementById("sortGroup"),
        sortSelect: document.getElementById("sortSelect"),
        sortDirToggle: document.getElementById("sortDirToggle"),
    };

    const metricHierarchy = ["tot", "disp", "sched", "rnd", "game", "os", "peri", "fps", "fps1low", "fps01low", "frametime"];

    // Stylistic config for elegant charting
    const chartStyle = {
        fontFamily: "'Inter', sans-serif",
        dataFontFamily: "'JetBrains Mono', monospace",
        colorMuted: "#888888",
        colorFaint: "#333333",
        colorText: "#ffffff",
        gridLine: "rgba(255, 255, 255, 0.04)"
    };

    function getOptimalSortDir(metric) {
        if (metric.includes("fps")) return "desc";
        return "asc";
    }

    // --- UI Interactions ---
    dom.csDisp.addEventListener("click", () => {
        if (!dom.csWrap.classList.contains("disabled")) {
            dom.csWrap.classList.toggle("open");
        }
    });

    document.addEventListener("click", (e) => {
        if (!dom.csWrap.contains(e.target)) dom.csWrap.classList.remove("open");
    });

    function buildCustomSelect(optionsList) {
        dom.csOpts.innerHTML = "";
        if (!optionsList || optionsList.length === 0) {
            dom.csDisp.textContent = "Awaiting Data...";
            dom.csWrap.classList.add("disabled");
            dom.compareBtn.classList.add("disabled");
        } else {
            dom.csDisp.textContent = state.activeKey;
            dom.csWrap.classList.remove("disabled");
            dom.compareBtn.classList.toggle("disabled", optionsList.length <= 1);

            optionsList.forEach((ts) => {
                const opt = document.createElement("div");
                opt.className = "custom-option" + (ts === state.activeKey ? " selected" : "");
                opt.textContent = ts;
                opt.addEventListener("click", () => {
                    state.activeKey = ts;
                    dom.csDisp.textContent = ts;
                    dom.csWrap.classList.remove("open");
                    Array.from(dom.csOpts.children).forEach((c) => c.classList.remove("selected"));
                    opt.classList.add("selected");
                    renderChart();
                });
                dom.csOpts.appendChild(opt);
            });
        }
    }

    dom.compareBtn.addEventListener("click", () => {
        if (Object.keys(state.pairedSessions).length < 2) return;

        if (state.viewMode === "single") {
            state.viewMode = "compare";
            dom.compareBtn.classList.add("active");
            dom.compareBtn.textContent = "Exit Compare Mode";
            dom.csWrap.classList.add("ui-disabled");
            dom.csDisp.textContent = "COMPARING SESSIONS";
            dom.timespanGroup.style.display = "none";
            dom.sortGroup.style.display = "block";

            let targetMetric = "ts";
            for (const m of metricHierarchy) {
                if (state.visibility[m]) {
                    targetMetric = m;
                    break;
                }
            }
            state.sort.metric = targetMetric;
            state.sort.dir = getOptimalSortDir(targetMetric);
            dom.sortSelect.value = state.sort.metric;
            dom.sortDirToggle.textContent = state.sort.dir === "asc" ? "ASCENDING" : "DESCENDING";
        } else {
            state.viewMode = "single";
            dom.compareBtn.classList.remove("active");
            dom.compareBtn.textContent = "Compare Sessions";
            dom.csWrap.classList.remove("ui-disabled");
            dom.csDisp.textContent = state.activeKey;
            dom.timespanGroup.style.display = "block";
            dom.sortGroup.style.display = "none";
        }
        renderChart();
    });

    dom.sortSelect.addEventListener("change", (e) => {
        const newMetric = e.target.value;
        state.sort.metric = newMetric;
        state.sort.dir = getOptimalSortDir(newMetric);
        dom.sortDirToggle.textContent = state.sort.dir === "asc" ? "ASCENDING" : "DESCENDING";
        
        if (newMetric !== "ts") {
            const activeMetrics = Object.keys(state.visibility).filter((key) => state.visibility[key]);
            if (activeMetrics.length === 1 && activeMetrics[0] !== newMetric) {
                const oldMetric = activeMetrics[0];
                state.visibility[oldMetric] = false;
                const oldRow = document.querySelector(`.metric-row[data-metric="${oldMetric}"]`);
                if (oldRow) oldRow.classList.add("disabled");
            }
            if (!state.visibility[newMetric]) {
                state.visibility[newMetric] = true;
                const newRow = document.querySelector(`.metric-row[data-metric="${newMetric}"]`);
                if (newRow) newRow.classList.remove("disabled");
            }
        }
        renderChart();
    });

    dom.sortDirToggle.addEventListener("click", () => {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        dom.sortDirToggle.textContent = state.sort.dir === "asc" ? "ASCENDING" : "DESCENDING";
        renderChart();
    });

    function resetToGuide() {
        document.body.classList.remove("has-data");
        state.activeKey = null;
        state.pairedSessions = {};
        state.viewMode = "single";
        dom.compareBtn.classList.remove("active");
        dom.compareBtn.textContent = "Compare Sessions";
        dom.timespanGroup.style.display = "block";
        dom.sortGroup.style.display = "none";
        dom.csWrap.classList.remove("ui-disabled");
        buildCustomSelect([]);
        if (state.chart) {
            state.chart.destroy();
            state.chart = null;
        }
        dom.fInput.value = "";
    }

    // --- Helpers ---
    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    };

    const fmt = (n) => (n === null || isNaN(n) ? "-" : parseFloat(n.toFixed(2)).toString());
    const getAverage = (arr) => arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    function updateSidebarMetrics(id, arr) {
        const els = ["min", "avg", "max"].map((t) => document.getElementById(`${t}-${id}`));
        if (!arr || !arr.length) {
            els.forEach((el) => { if (el) el.textContent = "-"; });
            return;
        }
        let min = Infinity, max = -Infinity, sum = 0;
        for (let i = 0; i < arr.length; i++) {
            let v = arr[i];
            if (v < min) min = v;
            if (v > max) max = v;
            sum += v;
        }
        if (els[0]) els[0].textContent = fmt(min);
        if (els[1]) els[1].textContent = fmt(sum / arr.length);
        if (els[2]) els[2].textContent = fmt(max);
    }

    function updateSidebarMetricsStatic(id, val) {
        const elMin = document.getElementById(`min-${id}`);
        const elAvg = document.getElementById(`avg-${id}`);
        const elMax = document.getElementById(`max-${id}`);
        if (elMin) elMin.textContent = "-";
        if (elAvg) elAvg.textContent = fmt(val);
        if (elMax) elMax.textContent = "-";
    }

    function getNormalizedColumn(cols, keyword) {
        const normalizedKeyword = keyword.toLowerCase().replace(/[^a-z0-9+]/g, '');
        return cols.find(c => c.toLowerCase().replace(/[^a-z0-9+]/g, '').includes(normalizedKeyword));
    }

    // --- Data Processing ---
    async function handleFiles(files) {
        const list = Array.from(files).filter((f) => f.name.endsWith(".csv"));
        const parsePromises = list.map(
            (f) =>
                new Promise((res) => {
                    Papa.parse(f, {
                        header: true,
                        dynamicTyping: true,
                        skipEmptyLines: true,
                        complete: (r) =>
                            res({
                                name: f.name,
                                lastModified: f.lastModified,
                                data: r.data,
                                cols: r.data.length > 0 ? Object.keys(r.data[0]) : [],
                            }),
                    });
                })
        );
        
        const raw = await Promise.all(parsePromises);
        let groups = [];
        
        function parseTimestamp(filename) {
            let m = filename.match(/(\d{4})[-_](\d{2})[-_](\d{2})T(\d{2})[-_]?(\d{2})[-_]?(\d{2})/i);
            if (m) return new Date(m[1], m[2]-1, m[3], m[4], m[5], m[6]).getTime();
            return null;
        }

        function formatTs(ts) {
            const d = new Date(ts);
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
        }

        raw.forEach((d) => {
            if (d.data.length === 0) return;
            let ts = parseTimestamp(d.name) || d.lastModified;
            if (!ts) return;

            let group = groups.find(g => Math.abs(g.baseTs - ts) <= 5000);
            if (!group) {
                group = { baseTs: ts, displayTs: formatTs(ts), files: {} };
                groups.push(group);
            }

            const normCols = d.cols.map(c => c.toLowerCase().replace(/[^a-z0-9+]/g, ''));
            const isLatency = normCols.some(c => c.includes("pc+display") || c.includes("mouse"));
            const isGame = normCols.some(c => c.includes("timeinseconds") || c.includes("mspclatency"));

            if (isLatency) group.files.lat = d;
            else if (isGame) group.files.game = d;
        });

        state.pairedSessions = {};
        
        groups.forEach((group) => {
            const session = group.files;
            
            if (session.lat && session.game) {
                const lData = session.lat.data, gData = session.game.data;
                const tL = session.lat.cols[0];
                const tG = getNormalizedColumn(session.game.cols, 'timeinseconds');

                const baseL = lData[0][tL];
                lData.forEach(r => r._normTime = r[tL] - baseL);

                const baseG = gData[0][tG];
                gData.forEach(r => r._normTime = r[tG] - baseG);

                const colMouse = getNormalizedColumn(session.lat.cols, "mouse");
                
                session.hasMouseData = lData.some((r) => {
                    const mVal = r[colMouse];
                    return mVal !== undefined && mVal !== null && mVal > 0;
                });
                
                const uniqueTimeMap = new Map();
                const maxTime = gData[gData.length - 1]._normTime;

                lData.forEach((row) => {
                    const t = row._normTime;
                    if (t >= 0 && t <= maxTime) {
                        if (!uniqueTimeMap.has(t)) uniqueTimeMap.set(t, row);
                    }
                });
                
                session.cleanLat = Array.from(uniqueTimeMap.values()).sort((a, b) => a._normTime - b._normTime);
                
                const colPCD = getNormalizedColumn(session.lat.cols, "pc+display");
                const colGamePC = getNormalizedColumn(session.game.cols, "mspclatency");
                const colGameRnd = getNormalizedColumn(session.game.cols, "msrenderpresentlatency");
                const colGameApi = getNormalizedColumn(session.game.cols, "msinpresentapi");
                const colGameDisp = getNormalizedColumn(session.game.cols, "msuntildisplayed");
                const colGameFt = getNormalizedColumn(session.game.cols, "msbetweenpresents") || getNormalizedColumn(session.game.cols, "frametime");

                let gIdx = 0;
                const gLen = gData.length;

                session.mergedData = session.cleanLat.map((r) => {
                    const t = r._normTime;
                    
                    while (gIdx < gLen - 1 && gData[gIdx + 1]._normTime <= t) {
                        gIdx++;
                    }
                    
                    const left = gData[gIdx];
                    const right = gIdx < gLen - 1 ? gData[gIdx + 1] : left;
                    
                    let f = 0;
                    if (right._normTime !== left._normTime) {
                        if (t <= left._normTime) f = 0;
                        else if (t >= right._normTime) f = 1;
                        else f = (t - left._normTime) / (right._normTime - left._normTime);
                    }

                    const interp = (col) => {
                        if (!col) return 0;
                        const lVal = left[col] || 0;
                        const rVal = right[col] || 0;
                        return lVal + (rVal - lVal) * f;
                    };

                    return {
                        t: t,
                        pc: interp(colGamePC),
                        rnd: interp(colGameRnd),
                        api: interp(colGameApi),
                        untilDisp: interp(colGameDisp),
                        ft: interp(colGameFt),
                        pcd: r[colPCD] || 0,
                        mouseRaw: r[colMouse]
                    };
                });

                state.pairedSessions[session.game.name] = session;
            }
        });
        
        const sessionKeys = Object.keys(state.pairedSessions);
        if (sessionKeys.length) {
            state.activeKey = sessionKeys[0];
            buildCustomSelect(sessionKeys);
            document.body.classList.add("has-data");

            if (window.location.hash !== "#workspace") {
                history.pushState({ view: "workspace" }, "", "#workspace");
            }
            renderChart();
        } else {
            alert("Incomplete sessions detected. Please ensure you select matching sets of FrameView Game and NVIDIA Latency logs.");
        }
    }

    // --- Chart Rendering ---
    function renderChart() {
        if (state.viewMode === "compare") renderCompareChart();
        else renderSingleChart();
    }

    function renderCompareChart() {
        const rawKeys = Object.keys(state.pairedSessions);
        const globalVals = { rawGame: [], gameRest: [], ftOverlap: [], os: [], rnd: [], sched: [], disp: [], peri: [], tot: [], frametime: [], fps: [], fps1low: [], fps01low: [] };

        let sessionData = rawKeys.map((ts) => {
            const session = state.pairedSessions[ts];
            let sumRawGame = 0, sumGameRest = 0, sumFtOverlap = 0, sumOs = 0, sumRnd = 0, sumSched = 0, sumDisp = 0, sumPeri = 0, sumFt = 0;
            const arrFt = [];
            const mBase = parseFloat(dom.mouseInput.value) || 0;
            
            session.mergedData.forEach((r) => {
                const hasReflexMouse = r.mouseRaw !== undefined && r.mouseRaw !== null && r.mouseRaw > 0;
                const peri = hasReflexMouse ? r.mouseRaw : mBase;
                const rawGame = Math.max(0, r.pc - r.untilDisp - r.api);
                const os = Math.max(0, r.api);
                const render = Math.max(0, r.rnd);
                const sched = Math.max(0, r.untilDisp - r.rnd);
                const disp = Math.max(0, r.pcd - r.pc);
                const ft = r.ft || 0;
                const ftOverlap = Math.min(rawGame, ft);
                const gameRest = Math.max(0, rawGame - ft);

                sumRawGame += rawGame; sumGameRest += gameRest; sumFtOverlap += ftOverlap; sumOs += os;
                sumRnd += render; sumSched += sched; sumDisp += disp; sumPeri += peri; sumFt += ft;
                arrFt.push(ft);
                
                globalVals.rawGame.push(rawGame); globalVals.gameRest.push(gameRest); globalVals.ftOverlap.push(ftOverlap);
                globalVals.os.push(os); globalVals.rnd.push(render); globalVals.sched.push(sched);
                globalVals.disp.push(disp); globalVals.peri.push(peri);
                globalVals.tot.push(rawGame + os + render + sched + disp + peri);
            });
            
            const count = session.mergedData.length;
            const avgFt = sumFt / count;
            const avgFps = count > 0 && avgFt > 0 ? 1000 / avgFt : 0;
            
            const sortedFt = [...arrFt].sort((a,b) => a - b);
            const p99Ft = sortedFt[Math.floor(sortedFt.length * 0.99)] || sortedFt[sortedFt.length - 1];
            const p999Ft = sortedFt[Math.floor(sortedFt.length * 0.999)] || sortedFt[sortedFt.length - 1];
            const fps1Low = p99Ft > 0 ? 1000 / p99Ft : 0;
            const fps01Low = p999Ft > 0 ? 1000 / p999Ft : 0;

            globalVals.frametime.push(avgFt); globalVals.fps.push(avgFps);
            globalVals.fps1low.push(fps1Low); globalVals.fps01low.push(fps01Low);

            return {
                ts: ts, 
                rawGame: sumRawGame / count, gameRest: sumGameRest / count, ftOverlap: sumFtOverlap / count,
                os: sumOs / count, rnd: sumRnd / count, sched: sumSched / count, disp: sumDisp / count,
                peri: sumPeri / count, tot: (sumRawGame + sumOs + sumRnd + sumSched + sumDisp + sumPeri) / count,
                frametime: avgFt, fps: avgFps, fps1low: fps1Low, fps01low: fps01Low
            };
        });

        sessionData.sort((a, b) => {
            let mapVal = (m, obj) => m === 'game' ? obj.rawGame : obj[m];
            let valA = mapVal(state.sort.metric, a), valB = mapVal(state.sort.metric, b);
            
            if (state.sort.metric === "ts") {
                if (valA < valB) return state.sort.dir === "asc" ? -1 : 1;
                if (valA > valB) return state.sort.dir === "asc" ? 1 : -1;
                return 0;
            } else {
                return state.sort.dir === "asc" ? valA - valB : valB - valA;
            }
        });

        const labels = sessionData.map((d) => d.ts);
        const avgData = sessionData;
        
        let maxLat = 0, maxFps = 0;
        avgData.forEach((d) => {
            let latSum = 0;
            if (state.visibility.peri) latSum += d.peri;
            if (state.visibility.os) latSum += d.os;
            if (state.visibility.rnd) latSum += d.rnd;
            if (state.visibility.sched) latSum += d.sched;
            if (state.visibility.disp) latSum += d.disp;
            if (state.visibility.game && state.visibility.frametime) latSum += d.gameRest + d.ftOverlap;
            else if (state.visibility.game) latSum += d.rawGame;
            else if (state.visibility.frametime) latSum += d.ftOverlap;
            
            let latStack = state.visibility.tot ? d.tot : latSum;
            if (latStack > maxLat) maxLat = latStack;
            
            if (d.fps > maxFps) maxFps = d.fps;
            if (d.fps1low > maxFps) maxFps = d.fps1low;
            if (d.fps01low > maxFps) maxFps = d.fps01low;
        });

        const lM = (Math.floor(Math.max(0, maxLat || 10) / 2) + 1) * 2;
        const fM = (Math.ceil(Math.max(0, maxFps || 60) / 10) + 1) * 10;

        const datasets = [];
        const hasFpsAxis = state.visibility.fps || state.visibility.fps1low || state.visibility.fps01low;
        
        const getTrueData = (id) => {
            if (id === 'game') return avgData.map(d => d.rawGame);
            if (id === 'frametime') return avgData.map(d => d.frametime);
            return avgData.map(d => d[id]);
        };

        const pushBar = (id, label, stack, xAxisID, border, bg, dataOverride = null) => {
            datasets.push({
                id: id, _isToggled: state.visibility[id], hidden: !state.visibility[id],
                label: label, data: dataOverride || getTrueData(id), _trueData: getTrueData(id), 
                backgroundColor: bg, borderColor: border, borderWidth: 1,
                stack: stack, xAxisID: xAxisID, yAxisID: 'y', 
                barPercentage: 0.75, categoryPercentage: 0.6,
            });
        };

        const hasSubLats = state.visibility.rnd || state.visibility.game || state.visibility.os || state.visibility.sched || state.visibility.disp || state.visibility.peri;

        pushBar("peri", "PERIPHERAL LATENCY", "lat", "x", "#8a8c6b", "rgba(138, 140, 107, 0.12)");
        pushBar("os", "OS LATENCY", "lat", "x", "#6b7b8c", "rgba(107, 123, 140, 0.12)");
        
        const displayGame = state.visibility.frametime ? avgData.map(d => d.gameRest) : avgData.map(d => d.rawGame);
        if (state.visibility.game) pushBar("game", "GAME LATENCY", "lat", "x", "#8c7e6b", "rgba(140, 126, 107, 0.12)", displayGame);
        if (state.visibility.frametime) pushBar("frametime", "FRAMETIME (IN GAME)", "lat", "x", "#555555", "rgba(85, 85, 85, 0.12)", avgData.map(d => d.ftOverlap));

        pushBar("rnd", "RENDER LATENCY", "lat", "x", "#6b8c76", "rgba(107, 140, 118, 0.12)");
        pushBar("sched", "SCHEDULING LATENCY", "lat", "x", "#7a6b8c", "rgba(122, 107, 140, 0.12)"); 
        pushBar("disp", "DISPLAY LATENCY", "lat", "x", "#8c6b6b", "rgba(140, 107, 107, 0.12)");

        const activeLatSums = avgData.map((d) => {
            let latSum = 0;
            if (state.visibility.peri) latSum += d.peri;
            if (state.visibility.os) latSum += d.os;
            if (state.visibility.rnd) latSum += d.rnd;
            if (state.visibility.sched) latSum += d.sched;
            if (state.visibility.disp) latSum += d.disp;
            if (state.visibility.game && state.visibility.frametime) latSum += d.gameRest + d.ftOverlap;
            else if (state.visibility.game) latSum += d.rawGame;
            else if (state.visibility.frametime) latSum += d.ftOverlap;
            return latSum;
        });

        const totData = avgData.map((d, i) => (hasSubLats ? Math.max(0, d.tot - activeLatSums[i]) : d.tot));
        const totBg = hasSubLats ? "transparent" : "rgba(255, 255, 255, 0.05)";
        pushBar("tot", "TOTAL LATENCY", "lat", "x", "#ffffff", totBg, totData);

        const getFpsData = (id) => {
            return avgData.map(d => {
                if (id === "fps01low") return d.fps01low;
                if (id === "fps1low") {
                    if (state.visibility.fps01low) return Math.max(0, d.fps1low - d.fps01low);
                    return d.fps1low;
                }
                if (id === "fps") {
                    let base = 0;
                    if (state.visibility.fps1low) base = d.fps1low;
                    else if (state.visibility.fps01low) base = d.fps01low;
                    return Math.max(0, d.fps - base);
                }
                return d[id];
            });
        };

        // FPS bars dynamically overlapped in the same stack
        pushBar("fps01low", "0.1% LOW FPS", "fps_group", "xFPS", "#333333", "rgba(51, 51, 51, 0.12)", getFpsData("fps01low"));
        pushBar("fps1low", "1% LOW FPS", "fps_group", "xFPS", "#666666", "rgba(102, 102, 102, 0.12)", getFpsData("fps1low"));
        pushBar("fps", "AVG FRAMERATE", "fps_group", "xFPS", "#ffffff", "rgba(255, 255, 255, 0.12)", getFpsData("fps"));

        const ctx = document.getElementById("myChart").getContext("2d");
        
        if (state.chart && state.chart.config.type === "bar") {
            state.chart.data.labels = labels;
            state.chart.data.datasets = datasets;
            state.chart.options.scales.x.max = lM;
            if(state.chart.options.scales.xFPS) {
                state.chart.options.scales.xFPS.display = hasFpsAxis;
                state.chart.options.scales.xFPS.max = fM;
            }
            state.chart.update('none'); 
        } else {
            if (state.chart) state.chart.destroy();
            
            const elegantLabelsPlugin = {
                id: "elegantLabels",
                afterDatasetsDraw(chart) {
                    const ctx = chart.ctx;
                    ctx.save();
                    ctx.font = `400 11px ${chartStyle.dataFontFamily}`;
                    ctx.textBaseline = "middle";

                    const latTotals = new Array(chart.data.labels.length).fill(0);
                    const latMaxX = new Array(chart.data.labels.length).fill(0);
                    const latY = new Array(chart.data.labels.length).fill(0);

                    let isTotVisible = false;
                    chart.data.datasets.forEach(ds => {
                        if (ds.id === 'tot' && ds._isToggled && !ds.hidden) isTotVisible = true;
                    });

                    const activeStacks = {};
                    chart.data.datasets.forEach((ds) => {
                        if (!ds.hidden && ds._isToggled) activeStacks[ds.stack] = (activeStacks[ds.stack] || 0) + 1;
                    });

                    chart.data.datasets.forEach((dataset, i) => {
                        const meta = chart.getDatasetMeta(i);
                        if (!meta.hidden && dataset._isToggled) {
                            const isLatStack = dataset.stack === "lat";
                            const isFpsStack = dataset.stack === "fps_group";
                            const isTot = dataset.id === "tot";
                            const isSoloStack = activeStacks[dataset.stack] === 1;

                            meta.data.forEach((element, index) => {
                                const val = dataset.data[index];
                                const trueVal = dataset._trueData[index];
                                
                                if (val > 0) {
                                    // Draw inline segment labels for Latency & FPS
                                    if (!(isTot && hasSubLats)) {
                                        if (element.width && element.width > 26) {
                                            ctx.fillStyle = chartStyle.colorText;
                                            ctx.textAlign = "right";
                                            ctx.fillText(fmt(trueVal), element.x - 6, element.y);
                                        } else if (isSoloStack && isFpsStack) { 
                                            ctx.fillStyle = chartStyle.colorMuted;
                                            ctx.textAlign = "left";
                                            ctx.fillText(fmt(trueVal), element.x + 8, element.y);
                                        }
                                    }

                                    // Track ONLY Latency totals for the end-of-bar text
                                    if (isLatStack) {
                                        latMaxX[index] = Math.max(latMaxX[index], element.x);
                                        latY[index] = element.y;
                                        if (isTotVisible) {
                                            if (dataset.id === 'tot') latTotals[index] = trueVal;
                                        } else {
                                            latTotals[index] += val;
                                        }
                                    }
                                }
                            });
                        }
                    });

                    // Render Latency Stack Totals
                    ctx.fillStyle = chartStyle.colorMuted;
                    ctx.textAlign = "left";
                    for (let i = 0; i < chart.data.labels.length; i++) {
                        if (latTotals[i] > 0) { 
                            ctx.fillText(fmt(latTotals[i]) + "ms", latMaxX[i] + 8, latY[i]);
                        }
                    }

                    ctx.restore();
                }
            };

            state.chart = new Chart(ctx, {
                type: "bar",
                data: { labels, datasets },
                options: {
                    indexAxis: "y",
                    devicePixelRatio: Math.max(window.devicePixelRatio || 1, 4),
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: { mode: "y", intersect: false },
                    layout: { padding: { left: 40, right: 80, top: 40, bottom: 20 } },
                    plugins: {
                        legend: {
                            display: true, position: "top", align: "center",
                            labels: {
                                color: chartStyle.colorMuted,
                                font: { family: chartStyle.fontFamily, size: 11, weight: "400" },
                                boxWidth: 10, padding: 35,
                                generateLabels: (chart) => {
                                    const active = chart.data.datasets
                                        .map((ds, i) => ({ ds, i }))
                                        .filter((item) => item.ds._isToggled);
                                    if (active.length === 0) return [{ text: "", fillStyle: "transparent", strokeStyle: "transparent", lineWidth: 0, boxWidth: 0, hidden: false, fontColor: "transparent" }];
                                    return active.map((item) => ({
                                        text: item.ds.label, fontColor: chartStyle.colorMuted,
                                        fillStyle: item.ds.backgroundColor !== "transparent" ? item.ds.backgroundColor : item.ds.borderColor,
                                        strokeStyle: item.ds.borderColor, lineWidth: item.ds.borderWidth || 1, borderRadius: 0,
                                        hidden: false, datasetIndex: item.i,
                                    }));
                                },
                            },
                        },
                        tooltip: {
                            backgroundColor: "rgba(10, 10, 10, 0.85)",
                            titleFont: { family: chartStyle.fontFamily, size: 12, weight: "500" },
                            bodyFont: { family: chartStyle.dataFontFamily, size: 11, weight: "400" },
                            titleColor: chartStyle.colorText, bodyColor: chartStyle.colorMuted,
                            cornerRadius: 4, borderColor: "#1a1a1a", borderWidth: 1, padding: 16, boxPadding: 6,
                            callbacks: {
                                label: (c) => {
                                    if (c.dataset.id === "tot") return `${c.dataset.label}: ${fmt(avgData[c.dataIndex].tot)}`;
                                    return `${c.dataset.label}: ${fmt(c.dataset._trueData[c.dataIndex])}`;
                                },
                            },
                        },
                    },
                    scales: {
                        y: { 
                            stacked: false, 
                            ticks: { color: chartStyle.colorMuted, font: { family: chartStyle.fontFamily, size: 11 }, padding: 10 }, 
                            grid: { display: false } 
                        },
                        x: {
                            type: "linear", position: "bottom", stacked: true, min: 0, max: lM,
                            ticks: { color: chartStyle.colorMuted, font: { family: chartStyle.dataFontFamily, size: 10 }, callback: (v) => fmt(v) },
                            title: { display: true, text: "LATENCY & FRAMETIME (ms)", color: chartStyle.colorMuted, font: { family: chartStyle.fontFamily, weight: "500", size: 10, letterSpacing: 2 }, padding: { top: 20 } },
                            grid: { color: chartStyle.gridLine, borderDash: [4, 4], drawBorder: false },
                        },
                        xFPS: {
                            type: "linear", position: "top", display: hasFpsAxis, stacked: true, min: 0, max: fM,
                            ticks: { color: chartStyle.colorMuted, font: { family: chartStyle.dataFontFamily, size: 10 }, callback: (v) => fmt(v) },
                            title: { display: true, text: "FRAMERATE (FPS)", color: chartStyle.colorMuted, font: { family: chartStyle.fontFamily, weight: "500", size: 10, letterSpacing: 2 }, padding: { bottom: 20 } },
                            grid: { display: false, drawBorder: false },
                        },
                    },
                },
                plugins: [elegantLabelsPlugin],
            });
        }

        updateSidebarMetrics("game", globalVals.rawGame);
        updateSidebarMetrics("os", globalVals.os);
        updateSidebarMetrics("rnd", globalVals.rnd);
        updateSidebarMetrics("sched", globalVals.sched);
        updateSidebarMetrics("disp", globalVals.disp);
        updateSidebarMetrics("peri", globalVals.peri);
        updateSidebarMetrics("tot", globalVals.tot);
        updateSidebarMetrics("frametime", globalVals.frametime);
        updateSidebarMetrics("fps", globalVals.fps);
        updateSidebarMetrics("fps1low", globalVals.fps1low);
        updateSidebarMetrics("fps01low", globalVals.fps01low);
    }

    function renderSingleChart() {
        if (!state.activeKey) return;
        const session = state.pairedSessions[state.activeKey];

        if (session.hasMouseData) {
            dom.mouseStatus.classList.remove("visible");
            dom.mouseInput.parentElement.classList.remove("fallback-active");
        } else {
            dom.mouseStatus.textContent = "Note: Non-Reflex compatible mouse detected. Using estimated latency.";
            dom.mouseStatus.classList.add("visible");
            dom.mouseInput.parentElement.classList.add("fallback-active");
        }

        if (dom.minR.max != session.mergedData.length - 1) {
            dom.minR.max = session.mergedData.length - 1;
            dom.maxR.max = session.mergedData.length - 1;
            dom.minR.value = 0;
            dom.maxR.value = session.mergedData.length - 1;
        }
        
        const startIdx = parseInt(dom.minR.value);
        const endIdx = parseInt(dom.maxR.value);
        const mMin = session.mergedData[startIdx].t;
        const mMax = session.mergedData[endIdx].t;
        dom.rLabel.textContent = `${fmt(mMin)} - ${fmt(mMax)}s`;

        const mBase = parseFloat(dom.mouseInput.value) || 0;
        
        const arrRawGame = [], arrOs = [], arrRnd = [], arrSched = [], arrDisp = [], arrPeri = [], arrTot = [];
        const arrFt = [], arrFps = [];
        const dataGameRest = [], dataOs = [], dataRnd = [], dataSched = [], dataDisp = [], dataPeri = [], dataTot = [];
        const dataFtOverlap = [], dataFps = [];

        const dataSlice = session.mergedData.slice(startIdx, endIdx + 1);
        dataSlice.forEach((r) => {
            const t = r.t;
            const hasReflexMouse = r.mouseRaw !== undefined && r.mouseRaw !== null && r.mouseRaw > 0;
            const peri = hasReflexMouse ? r.mouseRaw : mBase;

            const rawGame = Math.max(0, r.pc - r.untilDisp - r.api);
            const os = Math.max(0, r.api);
            const render = Math.max(0, r.rnd);
            const sched = Math.max(0, r.untilDisp - r.rnd);
            const disp = Math.max(0, r.pcd - r.pc);
            const ft = r.ft || 0;
            const fps = ft > 0 ? 1000 / ft : 0;
            const ftOverlap = Math.min(rawGame, ft);
            const gameRest = Math.max(0, rawGame - ft);
            const sys = rawGame + os + render + sched + disp + peri;

            arrRawGame.push(rawGame); arrOs.push(os); arrRnd.push(render); arrSched.push(sched);
            arrDisp.push(disp); arrPeri.push(peri); arrTot.push(sys); arrFt.push(ft); arrFps.push(fps);

            const displayGame = state.visibility.frametime ? gameRest : rawGame;
            const displayFtOverlap = state.visibility.frametime ? ftOverlap : 0;

            dataGameRest.push({ x: t, y: displayGame }); dataFtOverlap.push({ x: t, y: displayFtOverlap });
            dataOs.push({ x: t, y: os }); dataRnd.push({ x: t, y: render });
            dataSched.push({ x: t, y: sched }); dataDisp.push({ x: t, y: disp });
            dataPeri.push({ x: t, y: peri }); dataTot.push({ x: t, y: sys }); dataFps.push({ x: t, y: fps });
        });

        const sortedFt = [...arrFt].sort((a,b) => a - b);
        const p99Ft = sortedFt[Math.floor(sortedFt.length * 0.99)] || sortedFt[sortedFt.length - 1];
        const p999Ft = sortedFt[Math.floor(sortedFt.length * 0.999)] || sortedFt[sortedFt.length - 1];
        const fps1Low = p99Ft > 0 ? 1000 / p99Ft : 0;
        const fps01Low = p999Ft > 0 ? 1000 / p999Ft : 0;

        let maxLat = 0, maxFps = 0;
        for (let i = 0; i < arrFps.length; i++) {
            if (arrFps[i] > maxFps) maxFps = arrFps[i];
        }

        for (let i = 0; i < arrTot.length; i++) {
            let stackSum = 0;
            if (state.visibility.peri) stackSum += arrPeri[i];
            if (state.visibility.os) stackSum += arrOs[i];
            if (state.visibility.rnd) stackSum += arrRnd[i];
            if (state.visibility.sched) stackSum += arrSched[i];
            if (state.visibility.disp) stackSum += arrDisp[i];
            if (state.visibility.game && state.visibility.frametime) stackSum += dataGameRest[i].y + dataFtOverlap[i].y;
            else if (state.visibility.game) stackSum += arrRawGame[i];
            else if (state.visibility.frametime) stackSum += dataFtOverlap[i].y;
            
            let currentLat = state.visibility.tot ? arrTot[i] : stackSum;
            if (currentLat > maxLat) maxLat = currentLat;
        }

        const lM = (Math.floor(Math.max(0, maxLat || 10) / 2) + 1) * 2;
        const fM = (Math.ceil(Math.max(0, maxFps || 60) / 10) + 1) * 10;
        
        const latMaxScale = lM * 2.2; 
        const fpsMinScale = -(fM * 0.9);
        const fpsMaxScale = fM * 1.1;
        const hasFpsAxis = state.visibility.fps || state.visibility.fps1low || state.visibility.fps01low;

        const datasets = [];
        const pushLine = (id, label, avg, data, color, bg, fillMode, stackId, yAxisID = "y") => {
            if(state.visibility[id] || id === 'tot') {
                if (id === 'tot' && !state.visibility.tot) return;
                datasets.push({
                    label: label, data: data, yAxisID: yAxisID,
                    borderColor: state.visibility[id] ? color : "transparent",
                    backgroundColor: state.visibility[id] ? bg : "transparent",
                    fill: fillMode, borderWidth: 1, pointRadius: 0, tension: 0.1,
                    stack: stackId, _avgVal: avg
                });
            }
        };

        let prevIdx = "origin";
        
        const activeLatencyLayers = [
            { id: "peri", label: "PERIPHERAL LATENCY", avg: getAverage(arrPeri), data: dataPeri, color: "#8a8c6b", bg: "rgba(138, 140, 107, 0.12)" },
            { id: "os", label: "OS LATENCY", avg: getAverage(arrOs), data: dataOs, color: "#6b7b8c", bg: "rgba(107, 123, 140, 0.12)" },
            { id: "game", label: "GAME LATENCY", avg: getAverage(arrRawGame), data: dataGameRest, color: "#8c7e6b", bg: "rgba(140, 126, 107, 0.12)" },
            { id: "frametime", label: "FRAMETIME (IN GAME)", avg: getAverage(arrFt), data: dataFtOverlap, color: "#555555", bg: "rgba(85, 85, 85, 0.12)" },
            { id: "rnd", label: "RENDER LATENCY", avg: getAverage(arrRnd), data: dataRnd, color: "#6b8c76", bg: "rgba(107, 140, 118, 0.12)" },
            { id: "sched", label: "SCHEDULING LATENCY", avg: getAverage(arrSched), data: dataSched, color: "#7a6b8c", bg: "rgba(122, 107, 140, 0.12)" },
            { id: "disp", label: "DISPLAY LATENCY", avg: getAverage(arrDisp), data: dataDisp, color: "#8c6b6b", bg: "rgba(140, 107, 107, 0.12)" },
        ];

        activeLatencyLayers.forEach((layer) => {
            if(state.visibility[layer.id]) {
                pushLine(layer.id, layer.label, layer.avg, layer.data, layer.color, layer.bg, prevIdx, 'latency', "y");
                prevIdx = datasets.length - 1; 
            }
        });
        
        pushLine("tot", "TOTAL LATENCY", getAverage(arrTot), dataTot, "#ffffff", "transparent", false, "total", "y");

        pushLine("fps", "FRAMERATE", getAverage(arrFps), dataFps, "#ffffff", "rgba(255, 255, 255, 0.05)", true, "fps", "yFPS");
        pushLine("fps1low", "1% LOW FPS", fps1Low, dataSlice.map(r => ({x: r.t, y: fps1Low})), "#666666", "transparent", false, "fps1low", "yFPS");
        pushLine("fps01low", "0.1% LOW FPS", fps01Low, dataSlice.map(r => ({x: r.t, y: fps01Low})), "#333333", "transparent", false, "fps01low", "yFPS");

        const ctx = document.getElementById("myChart").getContext("2d");

        if (state.chart && state.chart.config.type === "line") {
            state.chart.data.datasets = datasets;
            state.chart.options.scales.x.min = mMin;
            state.chart.options.scales.x.max = mMax;
            state.chart.options.scales.y.max = latMaxScale;
            if (state.chart.options.scales.yFPS) {
                state.chart.options.scales.yFPS.display = hasFpsAxis;
                state.chart.options.scales.yFPS.min = fpsMinScale;
                state.chart.options.scales.yFPS.max = fpsMaxScale;
            }
            state.chart.update('none'); 
        } else {
            if (state.chart) state.chart.destroy();
            
            state.chart = new Chart(ctx, {
                type: "line",
                data: { datasets },
                options: {
                    devicePixelRatio: Math.max(window.devicePixelRatio || 1, 4),
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: { mode: "index", intersect: false },
                    layout: { padding: { left: 50, right: 50, top: 50, bottom: 20 } },
                    plugins: {
                        legend: {
                            display: true, position: "top", align: "center",
                            labels: {
                                color: chartStyle.colorMuted,
                                font: { family: chartStyle.fontFamily, size: 11, weight: "400" },
                                boxWidth: 10, padding: 35,
                                generateLabels: (chart) => {
                                    const active = chart.data.datasets
                                        .map((ds, i) => ({ ds, i }))
                                        .filter((item) => item.ds._isToggled !== false);
                                    if (active.length === 0) return [{ text: "", fillStyle: "transparent", strokeStyle: "transparent", lineWidth: 0, boxWidth: 0, hidden: false, fontColor: "transparent" }];
                                    return active.map((item) => {
                                        const ds = item.ds;
                                        let text = ds.label;
                                        if (ds._avgVal !== undefined && ds._avgVal !== null) text += `: ${fmt(ds._avgVal)}`;
                                        return {
                                            text: text, fontColor: chartStyle.colorMuted,
                                            fillStyle: ds.backgroundColor !== "transparent" ? ds.backgroundColor : ds.borderColor,
                                            strokeStyle: ds.borderColor, lineWidth: ds.borderWidth || 1, borderRadius: 0,
                                            hidden: false, datasetIndex: item.i,
                                        };
                                    });
                                },
                            },
                        },
                        tooltip: {
                            backgroundColor: "rgba(10, 10, 10, 0.85)",
                            titleFont: { family: chartStyle.fontFamily, size: 12, weight: "500" },
                            bodyFont: { family: chartStyle.dataFontFamily, size: 11, weight: "400" },
                            titleColor: chartStyle.colorText, bodyColor: chartStyle.colorMuted,
                            cornerRadius: 4, borderColor: "#1a1a1a", borderWidth: 1, padding: 16, boxPadding: 6,
                            itemSort: (a, b) => b.raw.y - a.raw.y,
                            callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw.y)}` },
                        },
                    },
                    scales: {
                        x: {
                            type: "linear", min: mMin, max: mMax,
                            ticks: { color: chartStyle.colorMuted, font: { family: chartStyle.dataFontFamily, size: 10 }, callback: (v) => fmt(v) },
                            title: { display: true, text: "TIME (s)", color: chartStyle.colorMuted, font: { family: chartStyle.fontFamily, weight: "500", size: 10, letterSpacing: 2 }, padding: { top: 20 } },
                            grid: { color: chartStyle.gridLine },
                        },
                        y: {
                            type: "linear", position: "left", stacked: true, min: 0, max: latMaxScale,
                            ticks: { color: chartStyle.colorMuted, font: { family: chartStyle.dataFontFamily, size: 10 }, callback: (v) => fmt(v) },
                            title: { display: true, text: "LATENCY & FRAMETIME (ms)", color: chartStyle.colorMuted, font: { family: chartStyle.fontFamily, weight: "500", size: 10, letterSpacing: 2 }, padding: { bottom: 20 } },
                            grid: { color: chartStyle.gridLine }, afterFit: (s) => (s.width = 60),
                        },
                        yFPS: {
                            type: "linear", position: "right", display: hasFpsAxis, min: fpsMinScale, max: fpsMaxScale,
                            grid: { display: false },
                            ticks: { color: chartStyle.colorMuted, font: { family: chartStyle.dataFontFamily, size: 10 }, callback: (v) => v >= 0 ? fmt(v) : "" },
                            title: { display: true, text: "FRAMERATE (FPS)", color: chartStyle.colorMuted, font: { family: chartStyle.fontFamily, weight: "500", size: 10, letterSpacing: 2 }, padding: { bottom: 20 } },
                        },
                    },
                },
            });
        }

        updateSidebarMetrics("game", state.visibility.frametime ? dataGameRest.map(d=>d.y) : arrRawGame);
        updateSidebarMetrics("os", arrOs); updateSidebarMetrics("rnd", arrRnd); updateSidebarMetrics("sched", arrSched);
        updateSidebarMetrics("disp", arrDisp); updateSidebarMetrics("peri", arrPeri); updateSidebarMetrics("tot", arrTot);
        updateSidebarMetrics("frametime", arrFt); updateSidebarMetrics("fps", arrFps);
        updateSidebarMetricsStatic("fps1low", fps1Low); updateSidebarMetricsStatic("fps01low", fps01Low);
    }

    const debouncedRenderChart = debounce(renderChart, 10);
    
    // --- Window Events ---
    window.addEventListener("popstate", () => {
        if (window.location.hash !== "#workspace") {
            resetToGuide();
        } else if (Object.keys(state.pairedSessions).length > 0) {
            document.body.classList.add("has-data");
            renderChart();
        }
    });

    dom.homeBtn.addEventListener("click", () => {
        history.pushState("", document.title, window.location.pathname + window.location.search);
        resetToGuide();
    });

    document.querySelectorAll(".num-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            const targetId = e.target.dataset.target;
            const input = document.getElementById(targetId);
            const step = parseFloat(input.step) || 1;
            const min = input.min !== "" ? parseFloat(input.min) : -Infinity;
            let val = parseFloat(input.value) || 0;
            
            if (e.target.classList.contains("plus")) val += step;
            else if (e.target.classList.contains("minus")) val -= step;
            
            if (val < min) val = min;
            const decimals = (input.step.split(".")[1] || "").length;
            input.value = val.toFixed(decimals);
            input.dispatchEvent(new Event("input"));
        });
    });

    document.querySelectorAll(".sample-data-link").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const originalText = e.target.innerText;
            e.target.innerText = "LOADING...";
            
            try {
                let allSampleFiles = [];
                let directoryFound = false;

                try {
                    const response = await fetch('./samples/');
                    if (response.ok) {
                        const text = await response.text();
                        const matches = text.match(/href="([^"]+\.csv)"/gi);
                        if (matches) {
                            const csvFiles = matches.map(m => m.split('"')[1].split('/').pop());
                            const uniqueFiles = [...new Set(csvFiles)];
                            
                            for (const filename of uniqueFiles) {
                                try {
                                    const res = await fetch(`./samples/${filename}`);
                                    if (res.ok) {
                                        const blob = await res.blob();
                                        allSampleFiles.push(new File([blob], filename, { type: "text/csv" }));
                                    }
                                } catch(e) { }
                            }
                            if (allSampleFiles.length > 0) directoryFound = true;
                        }
                    }
                } catch(e) { console.warn("Directory listing failed, falling back to known paths."); }

                if (!directoryFound) {
                    const fallbackFiles = [
                        "NVIDIA_App_Latency_Log_2026-03-26T14-28-13.csv",
                        "FrameView_Overwatch.exe_2026_03_26T142813_Log.csv",
                        "NVIDIA_App_Latency_Log_2026-03-26T12-51-48.csv",
                        "FrameView_Overwatch.exe_2026_03_26T125149_Log.csv"
                    ];
                    for (const filename of fallbackFiles) {
                        try {
                            const res = await fetch(`./samples/${filename}`);
                            if (res.ok) {
                                const blob = await res.blob();
                                allSampleFiles.push(new File([blob], filename, { type: "text/csv" }));
                            }
                        } catch(e) {}
                    }
                }

                if (allSampleFiles.length === 0) throw new Error("No files located.");
                await handleFiles(allSampleFiles);
            } catch (err) {
                alert("Data retrieval failed. Verify local server configuration includes the specific Game logs.");
                console.error(err);
            } finally {
                e.target.innerText = originalText;
            }
        });
    });

    dom.copyBtn.addEventListener("click", () => {
        if (!state.chart) return;
        const originalCanvas = document.getElementById("myChart");
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = originalCanvas.width;
        tempCanvas.height = originalCanvas.height;
        
        const ctx = tempCanvas.getContext("2d");
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(originalCanvas, 0, 0);
        
        tempCanvas.toBlob(async (blob) => {
            try {
                await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                dom.copyBtn.innerText = "COPIED";
            } catch (err) {
                const a = document.createElement("a");
                a.download = "latency_graph.png";
                a.href = tempCanvas.toDataURL("image/png");
                a.click();
                dom.copyBtn.innerText = "DOWNLOADED";
            }
            setTimeout(() => (dom.copyBtn.innerText = "COPY GRAPH"), 2000);
        }, "image/png");
    });

    window.addEventListener("load", () => setTimeout(() => document.body.classList.add("loaded"), 800));
    
    dom.fInput.addEventListener("change", (e) => handleFiles(e.target.files));
    
    [dom.minR, dom.maxR].forEach((r) =>
        r.addEventListener("input", () => {
            const min = parseInt(dom.minR.value), max = parseInt(dom.maxR.value), tot = parseInt(dom.minR.max);
            if (min >= max) dom.minR.value = max - 1;
            dom.rTrack.style.left = (tot > 0 ? (dom.minR.value / tot) * 100 : 0) + "%";
            dom.rTrack.style.width = (tot > 0 ? ((dom.maxR.value - dom.minR.value) / tot) * 100 : 100) + "%";
            debouncedRenderChart();
        })
    );
    
    document.querySelectorAll(".metric-row").forEach((row) =>
        row.addEventListener("click", () => {
            const m = row.dataset.metric;
            state.visibility[m] = !state.visibility[m];
            row.classList.toggle("disabled", !state.visibility[m]);
            
            if (state.viewMode === "compare") {
                const activeMetrics = Object.keys(state.visibility).filter((key) => state.visibility[key]);
                if (activeMetrics.length === 1) {
                    const soloMetric = activeMetrics[0];
                    state.sort.metric = soloMetric;
                    state.sort.dir = getOptimalSortDir(soloMetric);
                    dom.sortSelect.value = state.sort.metric;
                    dom.sortDirToggle.textContent = state.sort.dir === "asc" ? "ASCENDING" : "DESCENDING";
                }
            }
            renderChart();
        })
    );
    
    if (dom.mouseInput) dom.mouseInput.addEventListener("input", renderChart);
});