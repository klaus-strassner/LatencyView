document.addEventListener("DOMContentLoaded", () => {
    // --- Application State ---
    const state = {
        viewMode: "single",
        visibility: {
            game: true,
            os: true,
            rnd: true,
            sched: true, 
            disp: true,
            peri: true,
            tot: false, // Default disabled, calculated purely from data sum when on
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

    const metricHierarchy = ["tot", "disp", "sched", "rnd", "game", "os", "peri"];

    function getOptimalSortDir(metric) {
        return "asc";
    }

    // --- Custom Dropdown Controller ---
    dom.csDisp.addEventListener("click", () => {
        if (!dom.csWrap.classList.contains("disabled")) {
            dom.csWrap.classList.toggle("open");
        }
    });

    document.addEventListener("click", (e) => {
        if (!dom.csWrap.contains(e.target)) {
            dom.csWrap.classList.remove("open");
        }
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

            if (optionsList.length > 1) {
                dom.compareBtn.classList.remove("disabled");
            } else {
                dom.compareBtn.classList.add("disabled");
            }

            optionsList.forEach((ts) => {
                const opt = document.createElement("div");
                opt.className = "custom-option" + (ts === state.activeKey ? " selected" : "");
                opt.textContent = ts;
                opt.addEventListener("click", () => {
                    state.activeKey = ts;
                    dom.csDisp.textContent = ts;
                    dom.csWrap.classList.remove("open");
                    Array.from(dom.csOpts.children).forEach((c) =>
                        c.classList.remove("selected")
                    );
                    opt.classList.add("selected");
                    renderChart();
                });
                dom.csOpts.appendChild(opt);
            });
        }
    }

    // --- Mode Switching ---
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
            dom.compareBtn.textContent = "Compare All";
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

    // --- Utilities ---
    function resetToGuide() {
        document.body.classList.remove("has-data");
        state.activeKey = null;
        state.pairedSessions = {};
        state.viewMode = "single";
        dom.compareBtn.classList.remove("active");
        dom.compareBtn.textContent = "Compare All";
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

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function fmt(n) {
        return n === null || isNaN(n) ? "-" : parseFloat(n.toFixed(2)).toString();
    }

    function getAverage(arr) {
        if (!arr || !arr.length) return null;
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i];
        return sum / arr.length;
    }

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

    function getInterpolatedValue(data, time, col, timeCol) {
        if (!data || !data.length || !col) return null;
        
        let low = 0;
        let high = data.length - 1;

        if (time <= data[0][timeCol]) return data[0][col];
        if (time >= data[high][timeCol]) return data[high][col];

        while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            if (data[mid][timeCol] === time) return data[mid][col];
            
            if (data[mid][timeCol] < time) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        const left = data[high];
        const right = data[low];
        
        if (!left && right) return right[col];
        if (left && !right) return left[col];
        if (!left && !right) return null;
        
        if (Math.abs(left[timeCol] - right[timeCol]) < 0.0001) return left[col];
        
        return left[col] + (right[col] - left[col]) * ((time - left[timeCol]) / (right[timeCol] - left[timeCol]));
    }

    function getNormalizedColumn(cols, keyword) {
        const normalizedKeyword = keyword.toLowerCase().replace(/[^a-z0-9+]/g, '');
        return cols.find(c => c.toLowerCase().replace(/[^a-z0-9+]/g, '').includes(normalizedKeyword));
    }

    // --- File Handling & High-Performance Pre-calculation ---
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
                                data: r.data,
                                cols: Object.keys(r.data[0]),
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
            const ts = parseTimestamp(d.name);
            if (!ts) return;

            let group = groups.find(g => Math.abs(g.baseTs - ts) <= 5000);
            if (!group) {
                group = { baseTs: ts, displayTs: formatTs(ts), files: {} };
                groups.push(group);
            }

            if (d.name.toLowerCase().includes("latency")) group.files.lat = d;
            else if (d.name.toLowerCase().includes("frameview") || d.name.toLowerCase().includes("game")) group.files.game = d;
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
                
                // Hardware Check
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
                
                // === PRE-CALCULATION PASS (Massive Performance Improvement) ===
                const colPCD = getNormalizedColumn(session.lat.cols, "pc+display");
                
                const colGamePC = getNormalizedColumn(session.game.cols, "mspclatency");
                const colGameRnd = getNormalizedColumn(session.game.cols, "msrenderpresentlatency");
                const colGameApi = getNormalizedColumn(session.game.cols, "msinpresentapi");
                const colGameDisp = getNormalizedColumn(session.game.cols, "msuntildisplayed");

                let gIdx = 0;
                const gLen = gData.length;

                // Merge and interpolate arrays instantly via two-pointer sliding window
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
                        pcd: r[colPCD] || 0,
                        mouseRaw: r[colMouse]
                    };
                });

                state.pairedSessions[group.displayTs] = session;
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
            alert("Incomplete sessions detected. Please ensure you select a matching set of FrameView Game and NVIDIA Latency logs for each session.");
        }
    }

    function renderChart() {
        if (state.viewMode === "compare") renderCompareChart();
        else renderSingleChart();
    }

    function renderCompareChart() {
        const rawKeys = Object.keys(state.pairedSessions);
        const globalVals = { game: [], os: [], rnd: [], sched: [], disp: [], peri: [], tot: [] };

        let sessionData = rawKeys.map((ts) => {
            const session = state.pairedSessions[ts];
            let sumGame = 0, sumOs = 0, sumRnd = 0, sumSched = 0, sumDisp = 0, sumPeri = 0;
            const mBase = parseFloat(dom.mouseInput.value) || 0;
            
            session.mergedData.forEach((r) => {
                const hasReflexMouse = r.mouseRaw !== undefined && r.mouseRaw !== null && r.mouseRaw > 0;
                const peri = hasReflexMouse ? r.mouseRaw : mBase;

                // The Pipeline Math
                const game = Math.max(0, r.pc - r.untilDisp - r.api);
                const os = Math.max(0, r.api);
                const render = Math.max(0, r.rnd);
                const sched = Math.max(0, r.untilDisp - r.rnd);
                const disp = Math.max(0, r.pcd - r.pc);

                sumGame += game;
                sumOs += os;
                sumRnd += render;
                sumSched += sched;
                sumDisp += disp;
                sumPeri += peri;
                
                globalVals.game.push(game);
                globalVals.os.push(os);
                globalVals.rnd.push(render);
                globalVals.sched.push(sched);
                globalVals.disp.push(disp);
                globalVals.peri.push(peri);
                globalVals.tot.push(game + os + render + sched + disp + peri);
            });
            
            const count = session.mergedData.length;
            
            return {
                ts: ts,
                game: sumGame / count,
                os: sumOs / count,
                rnd: sumRnd / count,
                sched: sumSched / count,
                disp: sumDisp / count,
                peri: sumPeri / count,
                tot: (sumGame + sumOs + sumRnd + sumSched + sumDisp + sumPeri) / count,
            };
        });

        sessionData.sort((a, b) => {
            let valA = a[state.sort.metric];
            let valB = b[state.sort.metric];
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
        const activeLatSums = avgData.map((d) => {
            let s = 0;
            if (state.visibility.rnd) s += d.rnd;
            if (state.visibility.game) s += d.game;
            if (state.visibility.os) s += d.os;
            if (state.visibility.sched) s += d.sched;
            if (state.visibility.disp) s += d.disp;
            if (state.visibility.peri) s += d.peri;
            return s;
        });

        let maxLat = 0;
        avgData.forEach((d, i) => {
            let latStack = state.visibility.tot ? d.tot : activeLatSums[i];
            if (latStack > maxLat) maxLat = latStack;
        });

        const lM = (Math.floor(Math.max(0, maxLat || 10) / 2) + 1) * 2;
        const datasets = [];
        
        const pushBar = (id, label, stack, xAxisID, border, bg, dataOverride = null) => {
            datasets.push({
                id: id,
                _isToggled: state.visibility[id],
                hidden: !state.visibility[id],
                label: label,
                data: dataOverride || avgData.map((d) => d[id]),
                backgroundColor: bg,
                borderColor: border,
                borderWidth: 1,
                stack: stack,
                xAxisID: xAxisID,
                barPercentage: 0.5,
                categoryPercentage: 0.8,
            });
        };

        const hasSubLats = state.visibility.rnd || state.visibility.game || state.visibility.os || state.visibility.sched || state.visibility.disp || state.visibility.peri;

        pushBar("peri", "PERIPHERAL LATENCY", "lat", "x", "#8a804f", "rgba(138, 128, 79, 0.08)");
        pushBar("os", "OS LATENCY", "lat", "x", "#4f6b8a", "rgba(79, 107, 138, 0.08)");
        pushBar("game", "GAME LATENCY", "lat", "x", "#8a6b4f", "rgba(138, 107, 79, 0.08)");
        pushBar("rnd", "RENDER LATENCY", "lat", "x", "#6b8a4f", "rgba(107, 138, 79, 0.08)");
        pushBar("sched", "SCHEDULING LATENCY", "lat", "x", "#7a5c7a", "rgba(122, 92, 122, 0.08)"); 
        pushBar("disp", "DISPLAY LATENCY", "lat", "x", "#8a4f4f", "rgba(138, 79, 79, 0.08)");

        const totData = avgData.map((d, i) => (hasSubLats ? Math.max(0, d.tot - activeLatSums[i]) : d.tot));
        const totBg = hasSubLats ? "transparent" : "rgba(255, 255, 255, 0.05)";
        pushBar("tot", "TOTAL LATENCY", "lat", "x", "#ffffff", totBg, totData);

        const ctx = document.getElementById("myChart").getContext("2d");
        
        // Hot-Swap existing chart context if type matches to prevent lag
        if (state.chart && state.chart.config.type === "bar") {
            state.chart.data.labels = labels;
            state.chart.data.datasets = datasets;
            state.chart.options.scales.x.max = lM;
            state.chart.update('none'); // Update without animation overhead
        } else {
            if (state.chart) state.chart.destroy();
            
            const inlineDataLabels = {
                id: "inlineDataLabels",
                afterDatasetsDraw(chart) {
                    const ctx = chart.ctx;
                    ctx.save();
                    ctx.font = "500 10px 'JetBrains Mono'";
                    ctx.textBaseline = "middle";
                    const latStackSums = new Array(chart.data.labels.length).fill(0);
                    const latStackEdges = new Array(chart.data.labels.length).fill(0);
                    const latStackYs = new Array(chart.data.labels.length).fill(0);
                    const activeStacks = {};
                    
                    chart.data.datasets.forEach((ds) => {
                        if (!ds.hidden) activeStacks[ds.stack] = (activeStacks[ds.stack] || 0) + 1;
                    });
                    
                    chart.data.datasets.forEach((dataset, i) => {
                        const meta = chart.getDatasetMeta(i);
                        if (!meta.hidden && dataset._isToggled) {
                            const isLatStack = dataset.stack === "lat";
                            const isTot = dataset.id === "tot";
                            const isSoloStack = activeStacks[dataset.stack] === 1;
                            
                            meta.data.forEach((el, index) => {
                                const val = dataset.data[index];
                                if (val !== null && val > 0) {
                                    if (!(isTot && hasSubLats)) {
                                        if (el.width && el.width > 24) {
                                            ctx.fillStyle = "#ffffff";
                                            ctx.textAlign = "right";
                                            ctx.fillText(fmt(val), el.x - 8, el.y);
                                        } else if (isSoloStack) {
                                            ctx.fillStyle = "#ffffff";
                                            ctx.textAlign = "left";
                                            ctx.fillText(fmt(val), el.x + 8, el.y);
                                        }
                                    }
                                    if (isLatStack) {
                                        latStackSums[index] += val;
                                        if (el.x > latStackEdges[index]) latStackEdges[index] = el.x;
                                        latStackYs[index] = el.y;
                                    }
                                }
                            });
                        }
                    });
                    
                    if (activeStacks["lat"] > 1) {
                        ctx.fillStyle = "#ffffff";
                        ctx.textAlign = "left";
                        latStackEdges.forEach((edgeX, index) => {
                            if (latStackSums[index] > 0) ctx.fillText(fmt(latStackSums[index]), edgeX + 8, latStackYs[index]);
                        });
                    }
                    ctx.restore();
                },
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
                    layout: { padding: { left: 50, right: 50, top: 50, bottom: 20 } },
                    plugins: {
                        legend: {
                            display: true,
                            position: "top",
                            align: "center",
                            labels: {
                                color: "#a1a1aa",
                                font: { family: "'JetBrains Mono'", size: 10, weight: "400" },
                                boxWidth: 10,
                                padding: 35,
                                generateLabels: (chart) => {
                                    const active = chart.data.datasets
                                        .map((ds, i) => ({ ds, i }))
                                        .filter((item) => item.ds._isToggled);
                                    if (active.length === 0)
                                        return [
                                            {
                                                text: "", fillStyle: "transparent", strokeStyle: "transparent",
                                                lineWidth: 0, boxWidth: 0, hidden: false, fontColor: "transparent",
                                            },
                                        ];
                                    return active.map((item) => ({
                                        text: item.ds.label,
                                        fontColor: "#a1a1aa",
                                        fillStyle: item.ds.backgroundColor !== "transparent" ? item.ds.backgroundColor : item.ds.borderColor,
                                        strokeStyle: item.ds.borderColor,
                                        lineWidth: item.ds.borderWidth || 1,
                                        borderRadius: 0,
                                        hidden: false,
                                        datasetIndex: item.i,
                                    }));
                                },
                            },
                        },
                        tooltip: {
                            backgroundColor: "#0a0a0c",
                            titleFont: { family: "'JetBrains Mono'", size: 11, weight: "500" },
                            bodyFont: { family: "'JetBrains Mono'", size: 10, weight: "400" },
                            titleColor: "#ffffff",
                            bodyColor: "#a1a1aa",
                            cornerRadius: 0,
                            borderColor: "#27272a",
                            borderWidth: 1,
                            padding: 16,
                            boxPadding: 6,
                            callbacks: {
                                label: (c) => {
                                    if (c.dataset.id === "tot") return `${c.dataset.label}: ${fmt(avgData[c.dataIndex].tot)}`;
                                    return `${c.dataset.label}: ${fmt(c.raw)}`;
                                },
                            },
                        },
                    },
                    scales: {
                        y: {
                            stacked: true,
                            ticks: { color: "#71717a", font: { family: "'JetBrains Mono'", size: 10 } },
                            grid: { display: false },
                        },
                        x: {
                            type: "linear",
                            position: "bottom",
                            stacked: true,
                            min: 0,
                            max: lM,
                            ticks: { color: "#71717a", font: { size: 10 }, callback: (v) => fmt(v) },
                            title: { display: true, text: "LATENCY (ms)", color: "#71717a", font: { weight: "500", size: 10, letterSpacing: 2 }, padding: { top: 20 } },
                            grid: { color: "rgba(255, 255, 255, 0.05)" },
                        },
                    },
                },
                plugins: [inlineDataLabels],
            });
        }

        updateSidebarMetrics("game", globalVals.game);
        updateSidebarMetrics("os", globalVals.os);
        updateSidebarMetrics("rnd", globalVals.rnd);
        updateSidebarMetrics("sched", globalVals.sched);
        updateSidebarMetrics("disp", globalVals.disp);
        updateSidebarMetrics("peri", globalVals.peri);
        updateSidebarMetrics("tot", globalVals.tot);
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
        
        const arrGame = [], arrOs = [], arrRnd = [], arrSched = [], arrDisp = [], arrPeri = [], arrTot = [];
        const dataGame = [], dataOs = [], dataRnd = [], dataSched = [], dataDisp = [], dataPeri = [], dataTot = [];

        // Fast Iteration over Pre-Calculated slice
        const dataSlice = session.mergedData.slice(startIdx, endIdx + 1);
        dataSlice.forEach((r) => {
            const t = r.t;
            
            const hasReflexMouse = r.mouseRaw !== undefined && r.mouseRaw !== null && r.mouseRaw > 0;
            const peri = hasReflexMouse ? r.mouseRaw : mBase;

            const game = Math.max(0, r.pc - r.untilDisp - r.api);
            const os = Math.max(0, r.api);
            const render = Math.max(0, r.rnd);
            const sched = Math.max(0, r.untilDisp - r.rnd);
            const disp = Math.max(0, r.pcd - r.pc);
            
            const sys = game + os + render + sched + disp + peri;

            arrGame.push(game);
            arrOs.push(os);
            arrRnd.push(render); 
            arrSched.push(sched);
            arrDisp.push(disp); 
            arrPeri.push(peri); 
            arrTot.push(sys);

            dataGame.push({ x: t, y: game });
            dataOs.push({ x: t, y: os });
            dataRnd.push({ x: t, y: render });
            dataSched.push({ x: t, y: sched });
            dataDisp.push({ x: t, y: disp });
            dataPeri.push({ x: t, y: peri });
            dataTot.push({ x: t, y: sys });
        });

        let maxLat = 0;
        if (state.visibility.tot) {
            for (let i = 0; i < arrTot.length; i++) {
                if (arrTot[i] > maxLat) maxLat = arrTot[i];
            }
        } else {
            for (let i = 0; i < arrTot.length; i++) {
                let stackSum = 0;
                if (state.visibility.game) stackSum += arrGame[i] || 0;
                if (state.visibility.os) stackSum += arrOs[i] || 0;
                if (state.visibility.rnd) stackSum += arrRnd[i] || 0;
                if (state.visibility.sched) stackSum += arrSched[i] || 0;
                if (state.visibility.disp) stackSum += arrDisp[i] || 0;
                if (state.visibility.peri) stackSum += arrPeri[i] || 0;
                if (stackSum > maxLat) maxLat = stackSum;
            }
        }

        // Updated chart max calculation: rounding up to nearest multiple of 2
        const lM = (Math.floor(Math.max(0, maxLat || 10) / 2) + 1) * 2;

        const datasets = [];
        const pushLine = (id, label, avg, data, color, bg, fillMode, stackId) => {
            if(state.visibility[id] || id === 'tot') {
                if (id === 'tot' && !state.visibility.tot) return;
                datasets.push({
                    label: label,
                    data: data,
                    yAxisID: "y",
                    borderColor: state.visibility[id] ? color : "transparent",
                    backgroundColor: state.visibility[id] ? bg : "transparent",
                    fill: fillMode,
                    borderWidth: 1,
                    pointRadius: 0,
                    tension: 0,
                    stack: stackId
                });
            }
        };

        let prevIdx = "origin";
        const activeLatencyLayers = [
            { id: "peri", label: "PERIPHERAL LATENCY", data: dataPeri, color: "#8a804f", bg: "rgba(138, 128, 79, 0.08)" },
            { id: "os", label: "OS LATENCY", data: dataOs, color: "#4f6b8a", bg: "rgba(79, 107, 138, 0.08)" },
            { id: "game", label: "GAME LATENCY", data: dataGame, color: "#8a6b4f", bg: "rgba(138, 107, 79, 0.08)" },
            { id: "rnd", label: "RENDER LATENCY", data: dataRnd, color: "#6b8a4f", bg: "rgba(107, 138, 79, 0.08)" },
            { id: "sched", label: "SCHEDULING LATENCY", data: dataSched, color: "#7a5c7a", bg: "rgba(122, 92, 122, 0.08)" },
            { id: "disp", label: "DISPLAY LATENCY", data: dataDisp, color: "#8a4f4f", bg: "rgba(138, 79, 79, 0.08)" },
        ];

        activeLatencyLayers.forEach((layer) => {
            if(state.visibility[layer.id]) {
                pushLine(layer.id, layer.label, layer.avg, layer.data, layer.color, layer.bg, prevIdx, 'latency');
                prevIdx = datasets.length - 1; 
            }
        });
        
        pushLine("tot", "TOTAL LATENCY", getAverage(arrTot), dataTot, "#ffffff", "transparent", false, "total");

        const ctx = document.getElementById("myChart").getContext("2d");

        // Hot-Swap existing chart context if type matches for ultra-responsive sliding
        if (state.chart && state.chart.config.type === "line") {
            state.chart.data.datasets = datasets;
            state.chart.options.scales.x.min = mMin;
            state.chart.options.scales.x.max = mMax;
            state.chart.options.scales.y.max = lM;
            state.chart.update('none'); // Update immediately with no animation
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
                            display: true,
                            position: "top",
                            align: "center",
                            labels: {
                                color: "#a1a1aa",
                                font: { family: "'JetBrains Mono'", size: 10, weight: "400" },
                                boxWidth: 10,
                                padding: 35,
                                generateLabels: (chart) => {
                                    const active = chart.data.datasets
                                        .map((ds, i) => ({ ds, i }))
                                        .filter((item) => item.ds._isToggled !== false);
                                    if (active.length === 0)
                                        return [
                                            {
                                                text: "", fillStyle: "transparent", strokeStyle: "transparent",
                                                lineWidth: 0, boxWidth: 0, hidden: false, fontColor: "transparent",
                                            },
                                        ];
                                    return active.map((item) => {
                                        const ds = item.ds;
                                        let text = ds.label;
                                        if (ds._avgVal !== undefined && ds._avgVal !== null) text += `: ${fmt(ds._avgVal)}`;
                                        return {
                                            text: text,
                                            fontColor: "#a1a1aa",
                                            fillStyle: ds.backgroundColor !== "transparent" ? ds.backgroundColor : ds.borderColor,
                                            strokeStyle: ds.borderColor,
                                            lineWidth: ds.borderWidth || 1,
                                            borderRadius: 0,
                                            hidden: false,
                                            datasetIndex: item.i,
                                        };
                                    });
                                },
                            },
                            onClick: null,
                        },
                        tooltip: {
                            backgroundColor: "#0a0a0c",
                            titleFont: { family: "'JetBrains Mono'", size: 11, weight: "500" },
                            bodyFont: { family: "'JetBrains Mono'", size: 10, weight: "400" },
                            titleColor: "#ffffff",
                            bodyColor: "#a1a1aa",
                            cornerRadius: 0,
                            borderColor: "#27272a",
                            borderWidth: 1,
                            padding: 16,
                            boxPadding: 6,
                            itemSort: (a, b) => b.raw.y - a.raw.y,
                            callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw.y)}` },
                        },
                    },
                    scales: {
                        x: {
                            type: "linear",
                            min: mMin,
                            max: mMax,
                            ticks: { color: "#71717a", font: { size: 10 }, callback: (v) => fmt(v) },
                            title: { display: true, text: "TIME (s)", color: "#71717a", font: { weight: "500", size: 10, letterSpacing: 2 }, padding: { top: 20 } },
                            grid: { color: "rgba(255, 255, 255, 0.05)" },
                        },
                        y: {
                            type: "linear",
                            position: "left",
                            stacked: true,
                            min: 0,
                            max: lM,
                            ticks: { color: "#71717a", font: { size: 10 }, callback: (v) => fmt(v) },
                            title: { display: true, text: "LATENCY (ms)", color: "#71717a", font: { weight: "500", size: 10, letterSpacing: 2 }, padding: { bottom: 20 } },
                            grid: { color: "rgba(255, 255, 255, 0.05)" },
                            afterFit: (s) => (s.width = 60),
                        },
                    },
                },
            });
        }

        updateSidebarMetrics("game", arrGame);
        updateSidebarMetrics("os", arrOs);
        updateSidebarMetrics("rnd", arrRnd);
        updateSidebarMetrics("sched", arrSched);
        updateSidebarMetrics("disp", arrDisp);
        updateSidebarMetrics("peri", arrPeri);
        updateSidebarMetrics("tot", arrTot);
    }

    // Lowered debounce to 10ms for highly responsive slider feedback
    const debouncedRenderChart = debounce(renderChart, 10);
    
    // --- Event Listeners & UI Binding ---
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
                } catch(e) { 
                    console.warn("Directory listing failed, falling back to known paths.");
                }

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
        ctx.fillStyle = "#050505";
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(originalCanvas, 0, 0);
        
        tempCanvas.toBlob(async (blob) => {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({ "image/png": blob }),
                ]);
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

    window.addEventListener("load", () =>
        setTimeout(() => document.body.classList.add("loaded"), 800)
    );
    
    dom.fInput.addEventListener("change", (e) => {
        handleFiles(e.target.files);
    });
    
    [dom.minR, dom.maxR].forEach((r) =>
        r.addEventListener("input", () => {
            const min = parseInt(dom.minR.value);
            const max = parseInt(dom.maxR.value);
            const tot = parseInt(dom.minR.max);
            
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
                const activeMetrics = Object.keys(state.visibility).filter(
                    (key) => state.visibility[key]
                );
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
    
    if (dom.mouseInput) {
        dom.mouseInput.addEventListener("input", renderChart);
    }
});