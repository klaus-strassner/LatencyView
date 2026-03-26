document.addEventListener("DOMContentLoaded", () => {
    // --- Application State ---
    const state = {
        viewMode: "single",
        visibility: {
            game: false,
            os: false,
            rnd: false,
            disp: false,
            peri: false,
            tot: true,
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

    const metricHierarchy = ["tot", "disp", "rnd", "game", "os", "peri"];

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
        if (!data || !data.length) return null;
        
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

    // --- File Handling ---
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
                const tG = session.game.cols.find(c => c.toLowerCase().includes('timeinseconds'));

                const baseL = lData[0][tL];
                lData.forEach(r => r._normTime = r[tL] - baseL);

                const baseG = gData[0][tG];
                gData.forEach(r => r._normTime = r[tG] - baseG);

                const colPCD = session.lat.cols.find((c) => c.toLowerCase().includes("pc + display"));
                const colMouse = session.lat.cols.find((c) => c.toLowerCase().includes("mouse"));
                
                session.hasMouseData = lData.some((r) => r[colMouse] > 0);
                const uniqueTimeMap = new Map();
                const maxTime = gData[gData.length - 1]._normTime;

                // VALIDATION FILTER REMOVED: All rows within the timeframe are now included
                lData.forEach((row) => {
                    const t = row._normTime;
                    if (t >= 0 && t <= maxTime) {
                        row._jitter = Math.random() - 0.5;
                        if (!uniqueTimeMap.has(t)) uniqueTimeMap.set(t, row);
                    }
                });
                
                session.cleanLat = Array.from(uniqueTimeMap.values()).sort((a, b) => a._normTime - b._normTime);
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
        const globalVals = { game: [], os: [], rnd: [], disp: [], peri: [], tot: [] };

        let sessionData = rawKeys.map((ts) => {
            const session = state.pairedSessions[ts];
            const lData = session.cleanLat, gData = session.game.data;
            
            const colPCD = session.lat.cols.find((c) => c.toLowerCase().includes("pc + display"));
            const colSys = session.lat.cols.find((c) => c.toLowerCase().includes("system latency"));
            const colMouse = session.lat.cols.find((c) => c.toLowerCase().includes("mouse"));
            
            const colGameFt = session.game.cols.find((c) => c.toLowerCase().includes("msbetweenpresents"));
            const colGameRnd = session.game.cols.find((c) => c.toLowerCase().includes("msrenderpresentlatency"));
            const colGamePC = session.game.cols.find((c) => c.toLowerCase().includes("mspclatency"));

            let sumGame = 0, sumOs = 0, sumRnd = 0, sumDisp = 0, sumPeri = 0, sumTot = 0;
            const mBase = parseFloat(dom.mouseInput.value) || 0;
            
            lData.forEach((r) => {
                const t = r._normTime;
                
                const ft = getInterpolatedValue(gData, t, colGameFt, '_normTime') || 0;
                const rnd = getInterpolatedValue(gData, t, colGameRnd, '_normTime') || 0;
                const pc = getInterpolatedValue(gData, t, colGamePC, '_normTime') || 0;
                
                const pcd = r[colPCD] || 0;
                const isRealMouse = colSys && r[colSys] !== null && r[colMouse] > 0;
                const sys = isRealMouse ? r[colSys] : pcd + mBase + mBase * r._jitter;

                const isoCpu = Math.max(0, pc - rnd);
                const game = ft > 0 ? ft : 0;
                const os = Math.max(0, isoCpu - game);

                sumGame += game;
                sumOs += os;
                sumRnd += Math.max(0, rnd);
                sumDisp += Math.max(0, pcd - pc);
                sumPeri += Math.max(0, sys - pcd);
                sumTot += sys;
                
                globalVals.game.push(game);
                globalVals.os.push(os);
                globalVals.rnd.push(Math.max(0, rnd));
                globalVals.disp.push(Math.max(0, pcd - pc));
                globalVals.peri.push(Math.max(0, sys - pcd));
                globalVals.tot.push(sys);
            });
            
            const count = lData.length;
            
            return {
                ts: ts,
                game: sumGame / count,
                os: sumOs / count,
                rnd: sumRnd / count,
                disp: sumDisp / count,
                peri: sumPeri / count,
                tot: sumTot / count,
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
            if (state.visibility.disp) s += d.disp;
            if (state.visibility.peri) s += d.peri;
            return s;
        });

        let maxLat = 0;
        avgData.forEach((d, i) => {
            let latStack = state.visibility.tot ? d.tot : activeLatSums[i];
            if (latStack > maxLat) maxLat = latStack;
        });

        const lM = (Math.floor(Math.max(0, maxLat) / 5) + 1) * 5;
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

        const hasSubLats = state.visibility.rnd || state.visibility.game || state.visibility.os || state.visibility.disp || state.visibility.peri;

        pushBar("peri", "PERIPHERAL LATENCY", "lat", "x", "#44444a", "rgba(68, 68, 74, 0.15)");
        pushBar("os", "OS LATENCY", "lat", "x", "#52525b", "rgba(82, 82, 91, 0.15)");
        pushBar("game", "GAME LATENCY", "lat", "x", "#71717a", "rgba(113, 113, 122, 0.15)");
        pushBar("rnd", "RENDER LATENCY", "lat", "x", "#a1a1aa", "rgba(161, 161, 170, 0.15)");
        pushBar("disp", "DISPLAY LATENCY", "lat", "x", "#d4d4d8", "rgba(212, 212, 216, 0.15)");

        const totData = avgData.map((d, i) => (hasSubLats ? Math.max(0, d.tot - activeLatSums[i]) : d.tot));
        const totBg = hasSubLats ? "transparent" : "rgba(255, 255, 255, 0.15)";
        pushBar("tot", "TOTAL LATENCY", "lat", "x", "#ffffff", totBg, totData);

        const ctx = document.getElementById("myChart").getContext("2d");
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

        updateSidebarMetrics("game", globalVals.game);
        updateSidebarMetrics("os", globalVals.os);
        updateSidebarMetrics("rnd", globalVals.rnd);
        updateSidebarMetrics("disp", globalVals.disp);
        updateSidebarMetrics("peri", globalVals.peri);
        updateSidebarMetrics("tot", globalVals.tot);
    }

    function renderSingleChart() {
        if (!state.activeKey) return;
        const session = state.pairedSessions[state.activeKey];
        const lData = session.cleanLat, gData = session.game.data;

        if (session.hasMouseData) {
            dom.mouseStatus.classList.remove("visible");
            dom.mouseInput.parentElement.classList.remove("fallback-active");
        } else {
            dom.mouseStatus.textContent = "Note: Non-Reflex compatible mouse detected. Using estimated latency.";
            dom.mouseStatus.classList.add("visible");
            dom.mouseInput.parentElement.classList.add("fallback-active");
        }

        if (dom.minR.max != lData.length - 1) {
            dom.minR.max = lData.length - 1;
            dom.maxR.max = lData.length - 1;
            dom.minR.value = 0;
            dom.maxR.value = lData.length - 1;
        }
        
        const startIdx = parseInt(dom.minR.value);
        const endIdx = parseInt(dom.maxR.value);
        const mMin = lData[startIdx]._normTime;
        const mMax = lData[endIdx]._normTime;
        dom.rLabel.textContent = `${fmt(mMin)} - ${fmt(mMax)}s`;

        const colPCD = session.lat.cols.find((c) => c.toLowerCase().includes("pc + display"));
        const colSys = session.lat.cols.find((c) => c.toLowerCase().includes("system latency"));
        const colMouse = session.lat.cols.find((c) => c.toLowerCase().includes("mouse"));
        
        const colGameFt = session.game.cols.find((c) => c.toLowerCase().includes("msbetweenpresents"));
        const colGameRnd = session.game.cols.find((c) => c.toLowerCase().includes("msrenderpresentlatency"));
        const colGamePC = session.game.cols.find((c) => c.toLowerCase().includes("mspclatency"));

        const mBase = parseFloat(dom.mouseInput.value) || 0;
        
        const arrGame = [], arrOs = [], arrRnd = [], arrDisp = [], arrPeri = [], arrTot = [];
        const dataGame = [], dataOs = [], dataRnd = [], dataDisp = [], dataPeri = [], dataTot = [];

        lData.slice(startIdx, endIdx + 1).forEach((r) => {
            const t = r._normTime;
            
            const ft = getInterpolatedValue(gData, t, colGameFt, '_normTime') || 0;
            const rnd = getInterpolatedValue(gData, t, colGameRnd, '_normTime') || 0;
            const pc = getInterpolatedValue(gData, t, colGamePC, '_normTime') || 0;
            
            const pcd = r[colPCD] || 0;
            const sysRaw = r[colSys];
            const mouseRaw = r[colMouse];
            const jitter = r._jitter || 0;

            const isRealMouse = colSys && sysRaw !== null && mouseRaw > 0;
            const sys = isRealMouse ? sysRaw : pcd + mBase + mBase * jitter;

            const isoCpu = Math.max(0, pc - rnd);
            const game = ft > 0 ? ft : 0;
            const os = Math.max(0, isoCpu - game);

            const isoRnd = Math.max(0, rnd);
            const isoDisp = Math.max(0, pcd - pc);
            const isoPeri = Math.max(0, sys - pcd);
            const isoTot = Math.max(0, sys);

            arrGame.push(game);
            arrOs.push(os);
            arrRnd.push(isoRnd); 
            arrDisp.push(isoDisp); 
            arrPeri.push(isoPeri); 
            arrTot.push(isoTot);

            dataGame.push({ x: t, y: game });
            dataOs.push({ x: t, y: os });
            dataRnd.push({ x: t, y: isoRnd });
            dataDisp.push({ x: t, y: isoDisp });
            dataPeri.push({ x: t, y: isoPeri });
            dataTot.push({ x: t, y: isoTot });
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
                if (state.visibility.disp) stackSum += arrDisp[i] || 0;
                if (state.visibility.peri) stackSum += arrPeri[i] || 0;
                if (stackSum > maxLat) maxLat = stackSum;
            }
        }

        const lM = (Math.floor(Math.max(0, maxLat) / 5) + 1) * 5;

        const datasets = [];
        const pushLine = (id, label, avg, data, color, bg, fillMode, stackId) => {
            datasets.push({
                _isToggled: state.visibility[id],
                hidden: !state.visibility[id],
                label: label,
                _avgVal: avg,
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
        };

        const activeLatencyLayers = [
            { id: "peri", label: "PERIPHERAL LATENCY", avg: getAverage(arrPeri), data: dataPeri, color: "#44444a", bg: "rgba(68, 68, 74, 0.15)" },
            { id: "os", label: "OS LATENCY", avg: getAverage(arrOs), data: dataOs, color: "#52525b", bg: "rgba(82, 82, 91, 0.15)" },
            { id: "game", label: "GAME LATENCY", avg: getAverage(arrGame), data: dataGame, color: "#71717a", bg: "rgba(113, 113, 122, 0.15)" },
            { id: "rnd", label: "RENDER LATENCY", avg: getAverage(arrRnd), data: dataRnd, color: "#a1a1aa", bg: "rgba(161, 161, 170, 0.15)" },
            { id: "disp", label: "DISPLAY LATENCY", avg: getAverage(arrDisp), data: dataDisp, color: "#d4d4d8", bg: "rgba(212, 212, 216, 0.15)" },
        ];

        let prevIdx = "origin";
        activeLatencyLayers.forEach((layer) => {
            pushLine(layer.id, layer.label, layer.avg, layer.data, layer.color, layer.bg, prevIdx, 'latency');
            prevIdx = datasets.length - 1; 
        });
        
        pushLine("tot", "TOTAL LATENCY", getAverage(arrTot), dataTot, "#ffffff", "transparent", false, "total");

        const ctx = document.getElementById("myChart").getContext("2d");
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
                                    .filter((item) => item.ds._isToggled);
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

        updateSidebarMetrics("game", arrGame);
        updateSidebarMetrics("os", arrOs);
        updateSidebarMetrics("rnd", arrRnd);
        updateSidebarMetrics("disp", arrDisp);
        updateSidebarMetrics("peri", arrPeri);
        updateSidebarMetrics("tot", arrTot);
    }

    const debouncedRenderChart = debounce(renderChart, 25);
    
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