document.addEventListener("DOMContentLoaded", () => {
    // --- Application State ---
    const state = {
        viewMode: "single",
        visibility: {
            fps: true,
            lows: true,
            rnd: false,
            cpu: false,
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
        fpsInput: document.getElementById("maxFPSInput"),
        latInput: document.getElementById("maxLatInput"),
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

    // Updated hierarchy: Compute is now last (bottom)
    const metricHierarchy = ["fps", "lows", "tot", "peri", "disp", "rnd", "cpu"];

    function getOptimalSortDir(metric) {
        return metric === "fps" || metric === "lows" ? "desc" : "asc";
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
            const activeMetrics = Object.keys(state.visibility).filter(
                (key) => state.visibility[key]
            );
            if (activeMetrics.length === 1 && activeMetrics[0] !== newMetric) {
                const oldMetric = activeMetrics[0];
                state.visibility[oldMetric] = false;
                const oldRow = document.querySelector(
                    `.metric-row[data-metric="${oldMetric}"]`
                );
                if (oldRow) oldRow.classList.add("disabled");
            }
            if (!state.visibility[newMetric]) {
                state.visibility[newMetric] = true;
                const newRow = document.querySelector(
                    `.metric-row[data-metric="${newMetric}"]`
                );
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

    function getInterpolatedValue(data, time, col, timeCol) {
        if (!data || !data.length) return null;
        let left = null, right = null;
        for (let i = 0; i < data.length; i++) {
            if (data[i][timeCol] <= time) left = data[i];
            if (data[i][timeCol] >= time) {
                right = data[i];
                break;
            }
        }
        if (!left && right) return right[col];
        if (left && !right) return left[col];
        if (!left && !right) return null;
        if (Math.abs(left[timeCol] - right[timeCol]) < 0.0001) return left[col];
        return left[col] + (right[col] - left[col]) * ((time - left[timeCol]) / (right[timeCol] - left[timeCol]));
    }

    function getAverage(arr) {
        if (!arr || !arr.length) return null;
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i];
        return sum / arr.length;
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
        let groups = {};
        
        raw.forEach((d) => {
            const match = d.name.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.csv$/i);
            if (!match) return;
            const ts = match[1];
            if (!groups[ts]) groups[ts] = {};
            if (d.name.toLowerCase().includes("latency")) groups[ts].lat = d;
            else if (d.name.toLowerCase().includes("performance")) groups[ts].perf = d;
        });

        state.pairedSessions = {};
        Object.keys(groups).forEach((ts) => {
            const session = groups[ts];
            if (session.lat && session.perf) {
                const pData = session.perf.data, lData = session.lat.data;
                const tP = session.perf.cols[0], tL = session.lat.cols[0];
                const colPC = session.perf.cols.find((c) => c.toLowerCase().includes("pc latency"));
                const colPCD = session.lat.cols.find((c) => c.toLowerCase().includes("pc + display"));
                const colMouse = session.lat.cols.find((c) => c.toLowerCase().includes("mouse"));
                
                session.hasMouseData = lData.some((r) => r[colMouse] > 0);
                const uniqueTimeMap = new Map();
                
                lData.forEach((row) => {
                    const t = row[tL];
                    const baselinePC = getInterpolatedValue(pData, t, colPC, tP);
                    if (row[colPCD] >= baselinePC && t >= pData[0][tP] && t <= pData[pData.length - 1][tP]) {
                        row._jitter = Math.random() - 0.5;
                        if (!uniqueTimeMap.has(t)) uniqueTimeMap.set(t, row);
                    }
                });
                
                session.cleanLat = Array.from(uniqueTimeMap.values()).sort((a, b) => a[tL] - b[tL]);
                state.pairedSessions[ts] = session;
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
        }
    }

    function renderChart() {
        if (state.viewMode === "compare") renderCompareChart();
        else renderSingleChart();
    }

    function renderCompareChart() {
        const rawKeys = Object.keys(state.pairedSessions);
        const globalVals = { fps: [], lows: [], rnd: [], cpu: [], disp: [], peri: [], tot: [] };

        let sessionData = rawKeys.map((ts) => {
            const session = state.pairedSessions[ts];
            const lData = session.cleanLat, pData = session.perf.data;
            const tL = session.lat.cols[0], tP = session.perf.cols[0];
            
            const colFPS = session.perf.cols.find((c) => c.toLowerCase().includes("fps"));
            const colLow = session.perf.cols.find((c) => c.toLowerCase().includes("1(%) low"));
            const colRnd = session.perf.cols.find((c) => c.toLowerCase().includes("render latency"));
            const colPC = session.perf.cols.find((c) => c.toLowerCase().includes("pc latency"));
            const colPCD = session.lat.cols.find((c) => c.toLowerCase().includes("pc + display"));
            const colSys = session.lat.cols.find((c) => c.toLowerCase().includes("system latency"));
            const colMouse = session.lat.cols.find((c) => c.toLowerCase().includes("mouse"));

            let sumFPS = 0, sumLow = 0, sumRnd = 0, sumPC = 0;
            
            pData.forEach((r) => {
                const fps = r[colFPS] || 0, low = r[colLow] || 0, rnd = r[colRnd] || 0, pc = r[colPC] || 0;
                sumFPS += fps;
                sumLow += low;
                sumRnd += rnd;
                sumPC += pc;
                globalVals.fps.push(fps);
                globalVals.lows.push(low);
                globalVals.rnd.push(rnd);
                globalVals.cpu.push(pc - rnd);
            });
            
            const avgFPS = sumFPS / pData.length;
            const avgLow = sumLow / pData.length;
            const avgRnd = sumRnd / pData.length;
            const avgPC = sumPC / pData.length;

            let sumPCD = 0, sumTot = 0;
            const mBase = parseFloat(dom.mouseInput.value) || 0;
            
            lData.forEach((r) => {
                const pcd = r[colPCD] || 0;
                sumPCD += pcd;
                const isRealMouse = colSys && r[colSys] && r[colMouse] > 0;
                const tot = isRealMouse ? r[colSys] : pcd + mBase + mBase * r._jitter;
                sumTot += tot;
                const pcLat = getInterpolatedValue(pData, r[tL], colPC, tP) || 0;
                globalVals.disp.push(pcd - pcLat);
                globalVals.peri.push(tot - pcd);
                globalVals.tot.push(tot);
            });
            
            const avgPCD = sumPCD / lData.length;
            const avgTot = sumTot / lData.length;
            
            return {
                ts: ts,
                fps: avgFPS,
                lows: avgLow,
                rnd: avgRnd,
                cpu: avgPC - avgRnd,
                disp: avgPCD - avgPC,
                peri: avgTot - avgPCD,
                tot: avgTot,
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
            if (state.visibility.cpu) s += d.cpu;
            if (state.visibility.disp) s += d.disp;
            if (state.visibility.peri) s += d.peri;
            return s;
        });

        let maxFPS = 0, maxLat = 0;
        avgData.forEach((d, i) => {
            if (state.visibility.fps && d.fps > maxFPS) maxFPS = d.fps;
            if (state.visibility.lows && d.lows > maxFPS) maxFPS = d.lows;
            let latStack = state.visibility.tot ? d.tot : activeLatSums[i];
            if (latStack > maxLat) maxLat = latStack;
        });

        const fM = maxFPS > 0 ? Math.ceil(maxFPS / 50) * 50 : parseFloat(dom.fpsInput.value);
        const lM = maxLat > 0 ? Math.ceil(maxLat / 5) * 5 : parseFloat(dom.latInput.value);

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

        const hasSubLats = state.visibility.rnd || state.visibility.cpu || state.visibility.disp || state.visibility.peri;

        pushBar("fps", "AVERAGE FPS", "fps", "xTop", "#10b981", "rgba(16, 185, 129, 0.15)");
        pushBar("lows", "1% LOW FPS", "lows", "xTop", "#059669", "rgba(5, 150, 105, 0.15)");

        // Pushing in order of bottom-to-top stacking
        pushBar("cpu", "COMPUTE LATENCY", "lat", "xBottom", "#44444a", "rgba(68, 68, 74, 0.15)");
        pushBar("rnd", "RENDER LATENCY", "lat", "xBottom", "#71717a", "rgba(113, 113, 122, 0.15)");
        pushBar("disp", "DISPLAY LATENCY", "lat", "xBottom", "#a1a1aa", "rgba(161, 161, 170, 0.15)");
        pushBar("peri", "PERIPHERAL LATENCY", "lat", "xBottom", "#d4d4d8", "rgba(212, 212, 216, 0.15)");

        const totData = avgData.map((d, i) => (hasSubLats ? Math.max(0, d.tot - activeLatSums[i]) : d.tot));
        const totBg = hasSubLats ? "transparent" : "rgba(255, 255, 255, 0.15)";
        pushBar("tot", "TOTAL LATENCY", "lat", "xBottom", "#ffffff", totBg, totData);

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
                animation: { duration: 400, easing: "easeOutQuart" },
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
                                            text: "",
                                            fillStyle: "transparent",
                                            strokeStyle: "transparent",
                                            lineWidth: 0,
                                            boxWidth: 0,
                                            hidden: false,
                                            fontColor: "transparent",
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
                    xBottom: {
                        type: "linear",
                        position: "bottom",
                        stacked: true,
                        min: 0,
                        max: lM,
                        ticks: { color: "#71717a", font: { size: 10 }, callback: (v) => fmt(v) },
                        title: { display: true, text: "LATENCY (ms)", color: "#71717a", font: { weight: "500", size: 10, letterSpacing: 2 }, padding: { top: 20 } },
                        grid: { color: "rgba(255, 255, 255, 0.05)" },
                    },
                    xTop: {
                        type: "linear",
                        position: "top",
                        stacked: true,
                        min: 0,
                        max: fM,
                        ticks: { color: "#71717a", font: { size: 10 }, callback: (v) => fmt(v) },
                        title: { display: true, text: "FPS", color: "#71717a", font: { weight: "500", size: 10, letterSpacing: 2 }, padding: { bottom: 20 } },
                        grid: { drawOnChartArea: false },
                    },
                },
            },
            plugins: [inlineDataLabels],
        });

        const updateSidebarMetrics = (id, arr) => {
            const els = ["min", "avg", "max"].map((t) => document.getElementById(`${t}-${id}`));
            if (!arr || !arr.length) {
                els.forEach((el) => {
                    if (el) el.textContent = "-";
                });
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
        };
        
        updateSidebarMetrics("fps", globalVals.fps);
        updateSidebarMetrics("lows", globalVals.lows);
        updateSidebarMetrics("rnd", globalVals.rnd);
        updateSidebarMetrics("cpu", globalVals.cpu);
        updateSidebarMetrics("disp", globalVals.disp);
        updateSidebarMetrics("peri", globalVals.peri);
        updateSidebarMetrics("tot", globalVals.tot);
    }

    function renderSingleChart() {
        if (!state.activeKey) return;
        const session = state.pairedSessions[state.activeKey];
        const lData = session.cleanLat, pData = session.perf.data, tL = session.lat.cols[0], tP = session.perf.cols[0];

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
        const mMin = lData[startIdx][tL];
        const mMax = lData[endIdx][tL];
        dom.rLabel.textContent = `${fmt(mMin)} - ${fmt(mMax)}s`;

        const colFPS = session.perf.cols.find((c) => c.toLowerCase().includes("fps"));
        const colLow = session.perf.cols.find((c) => c.toLowerCase().includes("1(%) low"));
        const colRnd = session.perf.cols.find((c) => c.toLowerCase().includes("render latency"));
        const colPC = session.perf.cols.find((c) => c.toLowerCase().includes("pc latency"));
        const colPCD = session.lat.cols.find((c) => c.toLowerCase().includes("pc + display"));

        const prepPerf = (col) => {
            let d = pData
                .filter((r) => r[tP] > mMin && r[tP] < mMax)
                .map((r) => ({ x: r[tP], y: r[col] }));
            d.unshift({ x: mMin, y: getInterpolatedValue(pData, mMin, col, tP) });
            d.push({ x: mMax, y: getInterpolatedValue(pData, mMax, col, tP) });
            return d.sort((a, b) => a.x - b.x);
        };
        
        const activeFPS = prepPerf(colFPS);
        const activeLow = prepPerf(colLow);
        const activeRnd = prepPerf(colRnd);
        const activePC = prepPerf(colPC);
        
        const valPCD = [];
        const valTot = [];
        const mBase = parseFloat(dom.mouseInput.value) || 0;
        
        lData.slice(startIdx, endIdx + 1).forEach((r) => {
            const colSys = session.lat.cols.find((c) => c.toLowerCase().includes("system latency"));
            const colMouse = session.lat.cols.find((c) => c.toLowerCase().includes("mouse"));
            const isRealMouse = colSys && r[colSys] && r[colMouse] > 0;
            valPCD.push({ x: r[tL], y: r[colPCD] });
            valTot.push({ x: r[tL], y: isRealMouse ? r[colSys] : r[colPCD] + mBase + mBase * r._jitter });
        });

        const arrFPS = activeFPS.map((d) => d.y);
        const arrLow = activeLow.map((d) => d.y);
        const arrRnd = activeRnd.map((d) => d.y);
        const arrCpu = activePC.map((d, i) => d.y - (activeRnd[i] ? activeRnd[i].y : 0));
        const arrDisp = valPCD.map((d) => d.y - getInterpolatedValue(pData, d.x, colPC, tP));
        const arrPeri = valTot.map((d, i) => d.y - (valPCD[i] ? valPCD[i].y : 0));
        const arrTot = valTot.map((d) => d.y);

        const datasets = [];
        const pushLine = (id, label, avg, data, color, bg, fillMode) => {
            datasets.push({
                _isToggled: state.visibility[id],
                hidden: !state.visibility[id],
                label: label,
                _avgVal: avg,
                data: data,
                yAxisID: id === "fps" || id === "lows" ? "yL" : "yR",
                borderColor: state.visibility[id] ? color : "transparent",
                backgroundColor: state.visibility[id] ? bg : "transparent",
                fill: fillMode,
                borderWidth: 1,
                pointRadius: 0,
                tension: 0,
            });
        };

        pushLine("fps", "AVERAGE FPS", getAverage(arrFPS), activeFPS, "#10b981", "transparent", false);
        pushLine("lows", "1% LOW FPS", getAverage(arrLow), activeLow, "#059669", "transparent", false);

        // Stacking order: Compute (bottom) -> Render -> Display -> Peripheral (top)
        const activeLatencyLayers = [
            { id: "cpu", label: "COMPUTE LATENCY", avg: getAverage(arrCpu), data: activePC.map((d, i) => ({ x: d.x, y: d.y - (activeRnd[i] ? activeRnd[i].y : 0) })), color: "#44444a", bg: "rgba(68, 68, 74, 0.15)" },
            { id: "rnd", label: "RENDER LATENCY", avg: getAverage(arrRnd), data: activePC, color: "#71717a", bg: "rgba(113, 113, 122, 0.15)" },
            { id: "disp", label: "DISPLAY LATENCY", avg: getAverage(arrDisp), data: valPCD, color: "#a1a1aa", bg: "rgba(161, 161, 170, 0.15)" },
            { id: "peri", label: "PERIPHERAL LATENCY", avg: getAverage(arrPeri), data: valTot, color: "#d4d4d8", bg: "rgba(212, 212, 216, 0.15)" },
        ];

        let prevIdx = "origin";
        activeLatencyLayers.forEach((layer) => {
            pushLine(layer.id, layer.label, layer.avg, layer.data, layer.color, layer.bg, prevIdx);
            prevIdx = datasets.length - 1;
        });
        
        pushLine("tot", "TOTAL LATENCY", getAverage(arrTot), valTot, "#ffffff", "transparent", false);

        const ctx = document.getElementById("myChart").getContext("2d");
        if (state.chart) state.chart.destroy();
        const fM = parseFloat(dom.fpsInput.value);
        const lM = parseFloat(dom.latInput.value);

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
                                            text: "",
                                            fillStyle: "transparent",
                                            strokeStyle: "transparent",
                                            lineWidth: 0,
                                            boxWidth: 0,
                                            hidden: false,
                                            fontColor: "transparent",
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
                    yL: {
                        type: "linear",
                        position: "left",
                        min: 0,
                        max: fM,
                        ticks: { color: "#71717a", font: { size: 10 }, callback: (v) => fmt(v) },
                        title: { display: true, text: "FPS", color: "#71717a", font: { weight: "500", size: 10, letterSpacing: 2 }, padding: { bottom: 20 } },
                        grid: { color: "rgba(255, 255, 255, 0.05)" },
                        afterFit: (s) => (s.width = 60),
                    },
                    yR: {
                        type: "linear",
                        position: "right",
                        min: 0,
                        max: lM,
                        ticks: { color: "#71717a", font: { size: 10 }, callback: (v) => fmt(v) },
                        title: { display: true, text: "LATENCY (ms)", color: "#71717a", font: { weight: "500", size: 10, letterSpacing: 2 }, padding: { bottom: 20 } },
                        grid: { drawOnChartArea: false },
                        afterFit: (s) => (s.width = 60),
                    },
                },
            },
        });

        const updateSidebarMetrics = (id, arr) => {
            const els = ["min", "avg", "max"].map((t) => document.getElementById(`${t}-${id}`));
            if (!arr || !arr.length) {
                els.forEach((el) => {
                    if (el) el.textContent = "-";
                });
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
        };
        
        updateSidebarMetrics("fps", arrFPS);
        updateSidebarMetrics("lows", arrLow);
        updateSidebarMetrics("rnd", arrRnd);
        updateSidebarMetrics("cpu", arrCpu);
        updateSidebarMetrics("disp", arrDisp);
        updateSidebarMetrics("peri", arrPeri);
        updateSidebarMetrics("tot", arrTot);
    }

    const debouncedRenderChart = debounce(renderChart, 25);
    
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
            const timestamps = [
                "2026-03-24T04-53-39",
                "2026-03-24T05-01-02",
                "2026-03-24T05-17-51",
                "2026-03-24T05-23-26",
                "2026-03-24T05-52-49",
                "2026-03-24T06-28-45",
            ];
            
            try {
                let allSampleFiles = [];
                for (const ts of timestamps) {
                    const perfName = `NVIDIA_App_Performance_Log_${ts}.csv`;
                    const latName = `NVIDIA_App_Latency_Log_${ts}.csv`;
                    const [perfRes, latRes] = await Promise.all([
                        fetch(`./samples/${perfName}`),
                        fetch(`./samples/${latName}`),
                    ]);
                    if (perfRes.ok && latRes.ok) {
                        const pBlob = await perfRes.blob(), lBlob = await latRes.blob();
                        allSampleFiles.push(new File([pBlob], perfName, { type: "text/csv" }));
                        allSampleFiles.push(new File([lBlob], latName, { type: "text/csv" }));
                    }
                }
                if (allSampleFiles.length === 0) throw new Error("No files located.");
                await handleFiles(allSampleFiles);
            } catch (err) {
                alert("Data retrieval failed. Verify local server configuration.");
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
    
    [dom.mouseInput, dom.fpsInput, dom.latInput].forEach((i) => {
        if (i) i.addEventListener("input", renderChart);
    });
});