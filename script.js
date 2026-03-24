document.addEventListener('DOMContentLoaded', () => {
    // --- Application State ---
    const state = {
        viewMode: 'single', // 'single' or 'compare'
        visibility: { fps: true, lows: true, rnd: false, cpu: false, disp: false, peri: false, tot: true },
        sort: { metric: 'ts', dir: 'asc' }, 
        pairedSessions: {}, 
        activeKey: null, 
        chart: null
    };

    const dom = {
        minR: document.getElementById('minRange'), 
        maxR: document.getElementById('maxRange'),
        rTrack: document.getElementById('rangeTrack'), 
        rLabel: document.getElementById('rangeLabel'),
        fInput: document.getElementById('csvFile'), 
        mouseInput: document.getElementById('manualMouseLat'), 
        mouseStatus: document.getElementById('mouseStatus'),
        fpsInput: document.getElementById('maxFPSInput'), 
        latInput: document.getElementById('maxLatInput'),
        copyBtn: document.getElementById('copyGraphBtn'),
        mainGrid: document.getElementById('mainGrid'),
        homeBtn: document.getElementById('homeBtn'),
        csWrap: document.getElementById('customSelectWrapper'),
        csDisp: document.getElementById('customSelectDisplay'),
        csOpts: document.getElementById('customSelectOptions'),
        compareBtn: document.getElementById('compareBtn'),
        timespanGroup: document.getElementById('timespanGroup'),
        mouseGroup: document.getElementById('mouseInputGroup'),
        sortGroup: document.getElementById('sortGroup'),
        sortSelect: document.getElementById('sortSelect'),
        sortDirToggle: document.getElementById('sortDirToggle')
    };

    // --- Custom Dropdown Controller ---
    dom.csDisp.addEventListener('click', () => {
        if (!dom.csWrap.classList.contains('disabled')) dom.csWrap.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (!dom.csWrap.contains(e.target)) dom.csWrap.classList.remove('open');
    });

    function buildCustomSelect(optionsList) {
        dom.csOpts.innerHTML = '';
        if (!optionsList || optionsList.length === 0) {
            dom.csDisp.textContent = "Awaiting Data...";
            dom.csWrap.classList.add('disabled');
            dom.compareBtn.classList.add('disabled');
        } else {
            dom.csDisp.textContent = state.activeKey;
            dom.csWrap.classList.remove('disabled');
            
            if (optionsList.length > 1) {
                dom.compareBtn.classList.remove('disabled');
            } else {
                dom.compareBtn.classList.add('disabled');
            }

            optionsList.forEach(ts => {
                const opt = document.createElement('div');
                opt.className = 'custom-option' + (ts === state.activeKey ? ' selected' : '');
                opt.textContent = ts;
                opt.addEventListener('click', () => {
                    state.activeKey = ts;
                    dom.csDisp.textContent = ts;
                    dom.csWrap.classList.remove('open');
                    
                    Array.from(dom.csOpts.children).forEach(c => c.classList.remove('selected'));
                    opt.classList.add('selected');
                    
                    renderChart();
                });
                dom.csOpts.appendChild(opt);
            });
        }
    }

    // --- Mode Switching ---
    dom.compareBtn.addEventListener('click', () => {
        if (Object.keys(state.pairedSessions).length < 2) return;
        
        if (state.viewMode === 'single') {
            state.viewMode = 'compare';
            dom.compareBtn.classList.add('active');
            dom.compareBtn.textContent = 'Exit Compare Mode';
            dom.csWrap.classList.add('ui-disabled');
            dom.csDisp.textContent = "COMPARING SESSIONS";
            dom.timespanGroup.style.display = 'none';
            dom.sortGroup.style.display = 'block'; 
        } else {
            state.viewMode = 'single';
            dom.compareBtn.classList.remove('active');
            dom.compareBtn.textContent = 'Compare All';
            dom.csWrap.classList.remove('ui-disabled');
            dom.csDisp.textContent = state.activeKey;
            dom.timespanGroup.style.display = 'block';
            dom.sortGroup.style.display = 'none'; 
        }
        renderChart();
    });

    dom.sortSelect.addEventListener('change', (e) => {
        state.sort.metric = e.target.value;
        renderChart();
    });

    dom.sortDirToggle.addEventListener('click', () => {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
        dom.sortDirToggle.textContent = state.sort.dir === 'asc' ? 'ASCENDING' : 'DESCENDING';
        renderChart();
    });

    // --- State Management / Routing ---
    function resetToGuide() {
        document.body.classList.remove('has-data');
        state.activeKey = null;
        state.pairedSessions = {};
        state.viewMode = 'single';
        dom.compareBtn.classList.remove('active');
        dom.compareBtn.textContent = 'Compare All';
        dom.timespanGroup.style.display = 'block';
        dom.sortGroup.style.display = 'none';
        dom.csWrap.classList.remove('ui-disabled');
        
        buildCustomSelect([]);
        if (state.chart) {
            state.chart.destroy();
            state.chart = null;
        }
        dom.fInput.value = ''; 
    }

    window.addEventListener('popstate', () => {
        if (window.location.hash !== '#workspace') {
            resetToGuide();
        } else if (Object.keys(state.pairedSessions).length > 0) {
            document.body.classList.add('has-data');
            renderChart();
        }
    });

    dom.homeBtn.addEventListener('click', () => {
        history.pushState('', document.title, window.location.pathname + window.location.search);
        resetToGuide();
    });

    if (window.location.hash === '#workspace') {
        history.replaceState('', document.title, window.location.pathname + window.location.search);
    }

    // --- Utility Functions ---
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => { clearTimeout(timeout); func(...args); };
            clearTimeout(timeout); timeout = setTimeout(later, wait);
        };
    }

    function fmt(n) { 
        return (n === null || isNaN(n)) ? "-" : parseFloat(n.toFixed(2)).toString(); 
    }

    function getInterpolatedValue(data, time, col, timeCol) {
        if (!data || !data.length) return null;
        let left = null, right = null;
        for (let i = 0; i < data.length; i++) {
            if (data[i][timeCol] <= time) left = data[i];
            if (data[i][timeCol] >= time) { right = data[i]; break; }
        }
        if (!left && right) return right[col];
        if (left && !right) return left[col];
        if (!left && !right) return null;
        if (Math.abs(left[timeCol] - right[timeCol]) < 0.0001) return left[col];
        return left[col] + (right[col] - left[col]) * ((time - left[timeCol]) / (right[timeCol] - left[timeCol]));
    }

    // --- Core Logic ---
    async function handleFiles(files) {
        const list = Array.from(files).filter(f => f.name.endsWith('.csv'));
        const parsePromises = list.map(f => new Promise(res => {
            Papa.parse(f, { header: true, dynamicTyping: true, skipEmptyLines: true, complete: r => res({ name: f.name, data: r.data, cols: Object.keys(r.data[0]) }) });
        }));
        
        const raw = await Promise.all(parsePromises);
        let groups = {};
        
        raw.forEach(d => {
            const match = d.name.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.csv$/i);
            if (!match) return;
            const ts = match[1]; 
            if (!groups[ts]) groups[ts] = {};
            if (d.name.toLowerCase().includes('latency')) groups[ts].lat = d;
            else if (d.name.toLowerCase().includes('performance')) groups[ts].perf = d;
        });

        state.pairedSessions = {}; 
        Object.keys(groups).forEach(ts => {
            const session = groups[ts];
            if (session.lat && session.perf) {
                const pData = session.perf.data, lData = session.lat.data;
                const tP = session.perf.cols[0], tL = session.lat.cols[0];
                const colPC = session.perf.cols.find(c => c.toLowerCase().includes('pc latency'));
                const colPCD = session.lat.cols.find(c => c.toLowerCase().includes('pc + display'));
                const colMouse = session.lat.cols.find(c => c.toLowerCase().includes('mouse'));
                
                session.hasMouseData = lData.some(r => r[colMouse] > 0);

                const uniqueTimeMap = new Map();
                lData.forEach(row => {
                    const t = row[tL];
                    const baselinePC = getInterpolatedValue(pData, t, colPC, tP);
                    if (row[colPCD] >= baselinePC && t >= pData[0][tP] && t <= pData[pData.length-1][tP]) {
                        row._jitter = (Math.random() - 0.5);
                        if (!uniqueTimeMap.has(t)) uniqueTimeMap.set(t, row);
                    }
                });
                session.cleanLat = Array.from(uniqueTimeMap.values()).sort((a,b) => a[tL] - b[tL]);
                state.pairedSessions[ts] = session; 
            }
        });
        
        const sessionKeys = Object.keys(state.pairedSessions);
        if (sessionKeys.length) { 
            state.activeKey = sessionKeys[0];
            buildCustomSelect(sessionKeys);
            
            document.body.classList.add('has-data');
            if (window.location.hash !== '#workspace') history.pushState({ view: 'workspace' }, '', '#workspace');
            renderChart(); 
        }
    }

    function renderChart() {
        if (state.viewMode === 'compare') {
            renderCompareChart();
        } else {
            renderSingleChart();
        }
    }

    function renderCompareChart() {
        const rawKeys = Object.keys(state.pairedSessions);
        
        let sessionData = rawKeys.map(ts => {
            const session = state.pairedSessions[ts];
            const lData = session.cleanLat, pData = session.perf.data;
            const colFPS = session.perf.cols.find(c => c.toLowerCase().includes('fps')),
                  colLow = session.perf.cols.find(c => c.toLowerCase().includes('1(%) low')),
                  colRnd = session.perf.cols.find(c => c.toLowerCase().includes('render latency')),
                  colPC = session.perf.cols.find(c => c.toLowerCase().includes('pc latency')),
                  colPCD = session.lat.cols.find(c => c.toLowerCase().includes('pc + display'));
            const colSys = session.lat.cols.find(c => c.toLowerCase().includes('system latency'));
            const colMouse = session.lat.cols.find(c => c.toLowerCase().includes('mouse'));
            
            let sumFPS = 0, sumLow = 0, sumRnd = 0, sumPC = 0;
            pData.forEach(r => { sumFPS += r[colFPS] || 0; sumLow += r[colLow] || 0; sumRnd += r[colRnd] || 0; sumPC += r[colPC] || 0; });
            const avgFPS = sumFPS / pData.length, avgLow = sumLow / pData.length, avgRnd = sumRnd / pData.length, avgPC = sumPC / pData.length;

            let sumPCD = 0, sumTot = 0;
            const mBase = parseFloat(dom.mouseInput.value) || 0;
            lData.forEach(r => {
                sumPCD += r[colPCD] || 0;
                const isRealMouse = (colSys && r[colSys] && r[colMouse] > 0);
                sumTot += isRealMouse ? r[colSys] : (r[colPCD] + mBase + (mBase * r._jitter));
            });
            const avgPCD = sumPCD / lData.length, avgTot = sumTot / lData.length;

            return { ts: ts, fps: avgFPS, lows: avgLow, rnd: avgRnd, cpu: avgPC - avgRnd, disp: avgPCD - avgPC, peri: avgTot - avgPCD, tot: avgTot };
        });

        sessionData.sort((a, b) => {
            let valA = a[state.sort.metric];
            let valB = b[state.sort.metric];

            if (state.sort.metric === 'ts') {
                if (valA < valB) return state.sort.dir === 'asc' ? -1 : 1;
                if (valA > valB) return state.sort.dir === 'asc' ? 1 : -1;
                return 0;
            } else {
                return state.sort.dir === 'asc' ? valA - valB : valB - valA;
            }
        });

        const labels = sessionData.map(d => d.ts);
        const avgData = sessionData;

        const activeLatSums = avgData.map(d => {
            let s = 0;
            if (state.visibility.rnd) s += d.rnd;
            if (state.visibility.cpu) s += d.cpu;
            if (state.visibility.disp) s += d.disp;
            if (state.visibility.peri) s += d.peri;
            return s;
        });

        const datasets = [];
        const pushBar = (id, label, stack, xAxisID, border, bg, dataOverride = null) => {
            if (!state.visibility[id]) return;
            datasets.push({
                id: id, 
                _isToggled: true, label: label, data: dataOverride || avgData.map(d => d[id]), 
                backgroundColor: bg, borderColor: border, borderWidth: 1,
                stack: stack, xAxisID: xAxisID, barPercentage: 0.5, categoryPercentage: 0.8
            });
        };

        const hasSubLats = state.visibility.rnd || state.visibility.cpu || state.visibility.disp || state.visibility.peri;

        pushBar('fps', 'AVERAGE FPS', 'fps', 'xTop', '#10b981', 'rgba(16, 185, 129, 0.15)');
        pushBar('lows', '1% LOW FPS', 'lows', 'xTop', '#059669', 'rgba(5, 150, 105, 0.15)');

        pushBar('rnd', 'RENDER LATENCY', 'lat', 'xBottom', '#52525b', 'rgba(82, 82, 91, 0.15)');
        pushBar('cpu', 'COMPUTE LATENCY', 'lat', 'xBottom', '#71717a', 'rgba(113, 113, 122, 0.15)');
        pushBar('disp', 'DISPLAY LATENCY', 'lat', 'xBottom', '#a1a1aa', 'rgba(161, 161, 170, 0.15)');
        pushBar('peri', 'PERIPHERAL LATENCY', 'lat', 'xBottom', '#d4d4d8', 'rgba(212, 212, 216, 0.15)');

        if (state.visibility.tot) {
            const totData = avgData.map((d, i) => hasSubLats ? Math.max(0, d.tot - activeLatSums[i]) : d.tot);
            const totBg = hasSubLats ? 'transparent' : 'rgba(255, 255, 255, 0.15)';
            pushBar('tot', 'TOTAL LATENCY', 'lat', 'xBottom', '#ffffff', totBg, totData);
        }

        const ctx = document.getElementById('myChart').getContext('2d');
        if (state.chart) state.chart.destroy();
        const fM = parseFloat(dom.fpsInput.value), lM = parseFloat(dom.latInput.value);

        const inlineDataLabels = {
            id: 'inlineDataLabels',
            afterDatasetsDraw(chart) {
                const ctx = chart.ctx;
                ctx.save();
                ctx.font = "500 10px 'JetBrains Mono'";
                ctx.textBaseline = 'middle';

                const latStackSums = new Array(chart.data.labels.length).fill(0);
                const latStackEdges = new Array(chart.data.labels.length).fill(0);
                const latStackYs = new Array(chart.data.labels.length).fill(0);

                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    if (!meta.hidden && dataset._isToggled) {
                        const isLatStack = dataset.stack === 'lat';
                        const isTot = dataset.id === 'tot';

                        meta.data.forEach((el, index) => {
                            const val = dataset.data[index];
                            if (val !== null && val > 0) {
                                
                                // Because the bars are now dark/translucent, text returns to pure white.
                                if (!(isTot && hasSubLats) && el.width && el.width > 24) {
                                    ctx.fillStyle = '#ffffff'; 
                                    ctx.textAlign = 'right';
                                    ctx.fillText(fmt(val), el.x - 8, el.y); 
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

                if (hasSubLats) {
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'left';
                    latStackEdges.forEach((edgeX, index) => {
                        if (latStackSums[index] > 0) {
                            ctx.fillText(fmt(latStackSums[index]), edgeX + 8, latStackYs[index]);
                        }
                    });
                }

                ctx.restore();
            }
        };

        state.chart = new Chart(ctx, {
            type: 'bar', data: { labels, datasets },
            options: {
                indexAxis: 'y', devicePixelRatio: Math.max(window.devicePixelRatio || 1, 4), 
                responsive: true, maintainAspectRatio: false, animation: { duration: 400, easing: 'easeOutQuart' },
                interaction: { mode: 'y', intersect: false },
                layout: { padding: { left: 50, right: 50, top: 50, bottom: 20 } },
                plugins: { 
                    legend: { display: true, position: 'top', align: 'center', labels: { color: '#a1a1aa', font: { family: "'JetBrains Mono'", size: 10, weight: '400' }, boxWidth: 10, padding: 35 } },
                    tooltip: { 
                        backgroundColor: '#0a0a0c', titleFont: { family: "'JetBrains Mono'", size: 11, weight: '500' }, 
                        bodyFont: { family: "'JetBrains Mono'", size: 10, weight: '400' }, titleColor: '#ffffff', 
                        bodyColor: '#a1a1aa', cornerRadius: 0, borderColor: '#27272a', borderWidth: 1, padding: 16, 
                        boxPadding: 6, 
                        callbacks: { 
                            label: c => {
                                if (c.dataset.id === 'tot') return `${c.dataset.label}: ${fmt(avgData[c.dataIndex].tot)}`;
                                return `${c.dataset.label}: ${fmt(c.raw)}`;
                            } 
                        } 
                    } 
                },
                scales: {
                    y: { stacked: true, ticks: { color: '#71717a', font: { family: "'JetBrains Mono'", size: 10 } }, grid: { display: false } },
                    xBottom: { type: 'linear', position: 'bottom', stacked: true, min: 0, max: lM, ticks: { color: '#71717a', font: { size: 10 }, callback: v => fmt(v) }, title: { display: true, text: 'LATENCY (ms)', color: '#71717a', font: { weight: '500', size: 10, letterSpacing: 2 }, padding: { top: 20 } }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                    xTop: { type: 'linear', position: 'top', stacked: true, min: 0, max: fM, ticks: { color: '#71717a', font: { size: 10 }, callback: v => fmt(v) }, title: { display: true, text: 'FPS', color: '#71717a', font: { weight: '500', size: 10, letterSpacing: 2 }, padding: { bottom: 20 } }, grid: { drawOnChartArea: false } }
                }
            },
            plugins: [inlineDataLabels]
        });

        // Blank out single-session metrics
        ['fps', 'lows', 'tot', 'peri', 'disp', 'cpu', 'rnd'].forEach(id => {
            ['min', 'avg', 'max'].forEach(t => {
                const el = document.getElementById(`${t}-${id}`);
                if(el) el.textContent = "-";
            });
        });
    }

    function renderSingleChart() {
        if (!state.activeKey) return;
        const session = state.pairedSessions[state.activeKey];
        const lData = session.cleanLat, pData = session.perf.data;
        const tL = session.lat.cols[0], tP = session.perf.cols[0];

        if (session.hasMouseData) {
            dom.mouseStatus.classList.remove('visible');
            dom.mouseInput.parentElement.classList.remove('fallback-active');
        } else {
            dom.mouseStatus.textContent = "Note: Non-Reflex compatible mouse detected. Using estimated latency.";
            dom.mouseStatus.classList.add('visible');
            dom.mouseInput.parentElement.classList.add('fallback-active');
        }

        if (dom.minR.max != lData.length - 1) {
            dom.minR.max = lData.length - 1; dom.maxR.max = lData.length - 1;
            dom.minR.value = 0; dom.maxR.value = lData.length - 1;
        }

        const startIdx = parseInt(dom.minR.value), endIdx = parseInt(dom.maxR.value);
        const mMin = lData[startIdx][tL], mMax = lData[endIdx][tL];
        dom.rLabel.textContent = `${fmt(mMin)} - ${fmt(mMax)}s`;

        const colFPS = session.perf.cols.find(c => c.toLowerCase().includes('fps')),
              colLow = session.perf.cols.find(c => c.toLowerCase().includes('1(%) low')),
              colRnd = session.perf.cols.find(c => c.toLowerCase().includes('render latency')),
              colPC = session.perf.cols.find(c => c.toLowerCase().includes('pc latency')),
              colPCD = session.lat.cols.find(c => c.toLowerCase().includes('pc + display'));

        const prepPerf = col => {
            let d = pData.filter(r => r[tP] > mMin && r[tP] < mMax).map(r => ({ x: r[tP], y: r[col] }));
            d.unshift({ x: mMin, y: getInterpolatedValue(pData, mMin, col, tP) });
            d.push({ x: mMax, y: getInterpolatedValue(pData, mMax, col, tP) });
            return d.sort((a,b) => a.x - b.x);
        };

        const activeFPS = prepPerf(colFPS), activeLow = prepPerf(colLow), activeRnd = prepPerf(colRnd), activePC = prepPerf(colPC);
        
        const valPCD = [], valTot = [], mBase = parseFloat(dom.mouseInput.value) || 0;
        lData.slice(startIdx, endIdx + 1).forEach(r => {
            const colSys = session.lat.cols.find(c => c.toLowerCase().includes('system latency'));
            const colMouse = session.lat.cols.find(c => c.toLowerCase().includes('mouse'));
            const isRealMouse = (colSys && r[colSys] && r[colMouse] > 0);
            valPCD.push({ x: r[tL], y: r[colPCD] });
            valTot.push({ x: r[tL], y: isRealMouse ? r[colSys] : (r[colPCD] + mBase + (mBase * r._jitter)) });
        });

        const datasets = [];

        if (state.visibility.fps) datasets.push({ _isToggled: true, label: "AVERAGE FPS", data: activeFPS, yAxisID: 'yL', borderColor: '#10b981', borderWidth: 1, pointRadius: 0, tension: 0 });
        if (state.visibility.lows) datasets.push({ _isToggled: true, label: "1% LOW FPS", data: activeLow, yAxisID: 'yL', borderColor: '#059669', borderWidth: 1, pointRadius: 0, tension: 0 });

        const activeLatencyLayers = [
            { id: 'rnd', label: "RENDER LATENCY", data: activeRnd, color: '#52525b', bg: 'rgba(82, 82, 91, 0.15)' },
            { id: 'cpu', label: "COMPUTE LATENCY", data: activePC, color: '#71717a', bg: 'rgba(113, 113, 122, 0.15)' },
            { id: 'disp', label: "DISPLAY LATENCY", data: valPCD, color: '#a1a1aa', bg: 'rgba(161, 161, 170, 0.15)' },
            { id: 'peri', label: "PERIPHERAL LATENCY", data: valTot, color: '#d4d4d8', bg: 'rgba(212, 212, 216, 0.15)' }
        ];

        let prevIdx = 'origin';
        activeLatencyLayers.forEach((layer, index) => {
            const isVis = state.visibility[layer.id];
            const nextLayer = activeLatencyLayers[index + 1];
            const isNextVis = nextLayer ? state.visibility[nextLayer.id] : false;
            const isNakedFloor = !isVis && isNextVis;
            let strokeColor = 'transparent';
            if (isVis) strokeColor = layer.color;
            else if (isNakedFloor) strokeColor = 'rgba(255, 255, 255, 0.15)';

            datasets.push({
                _isToggled: isVis, label: layer.label, data: layer.data, yAxisID: 'yR',
                borderColor: strokeColor, backgroundColor: isVis ? layer.bg : 'transparent', fill: prevIdx, borderWidth: 1, pointRadius: 0, tension: 0
            });
            prevIdx = datasets.length - 1;
        });

        if (state.visibility.tot) datasets.push({ _isToggled: true, label: "TOTAL LATENCY", data: valTot, yAxisID: 'yR', borderColor: '#ffffff', borderWidth: 1, pointRadius: 0, fill: false, tension: 0 }); 

        const updateSidebarMetrics = (id, arr) => {
            const els = ['min', 'avg', 'max'].map(t => document.getElementById(`${t}-${id}`));
            if (!arr.length) { els.forEach(el => el.textContent = "-"); return; }
            els[0].textContent = fmt(Math.min(...arr));
            els[1].textContent = fmt(arr.reduce((a,b)=>a+b,0)/arr.length);
            els[2].textContent = fmt(Math.max(...arr));
        };

        updateSidebarMetrics('fps', activeFPS.map(d=>d.y)); updateSidebarMetrics('lows', activeLow.map(d=>d.y));
        updateSidebarMetrics('rnd', activeRnd.map(d=>d.y)); updateSidebarMetrics('cpu', activePC.map((d,i)=>d.y - (activeRnd[i]?activeRnd[i].y:0)));
        updateSidebarMetrics('disp', valPCD.map(d=>d.y - getInterpolatedValue(pData, d.x, colPC, tP)));
        updateSidebarMetrics('peri', valTot.map((d,i)=>d.y - (valPCD[i]?valPCD[i].y:0))); updateSidebarMetrics('tot', valTot.map(d=>d.y));

        const ctx = document.getElementById('myChart').getContext('2d');
        if (state.chart) state.chart.destroy();
        const fM = parseFloat(dom.fpsInput.value), lM = parseFloat(dom.latInput.value);

        state.chart = new Chart(ctx, {
            type: 'line', data: { datasets },
            options: {
                devicePixelRatio: Math.max(window.devicePixelRatio || 1, 4), responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
                layout: { padding: { left: 50, right: 50, top: 50, bottom: 20 } },
                plugins: { 
                    legend: { display: true, position: 'top', align: 'center', labels: { color: '#a1a1aa', font: { family: "'JetBrains Mono'", size: 10, weight: '400' }, boxWidth: 10, padding: 35, filter: (item, chart) => chart.datasets[item.datasetIndex]._isToggled } },
                    tooltip: { backgroundColor: '#0a0a0c', titleFont: { family: "'JetBrains Mono'", size: 11, weight: '500' }, bodyFont: { family: "'JetBrains Mono'", size: 10, weight: '400' }, titleColor: '#ffffff', bodyColor: '#a1a1aa', cornerRadius: 0, borderColor: '#27272a', borderWidth: 1, padding: 16, boxPadding: 6, itemSort: (a, b) => b.raw.y - a.raw.y, filter: (item) => item.dataset._isToggled, callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw.y)}` } } 
                },
                scales: {
                    x: { type: 'linear', min: mMin, max: mMax, ticks: { color: '#71717a', font: { size: 10 }, callback: v => fmt(v) }, title: { display: true, text: 'TIME (s)', color: '#71717a', font: { weight: '500', size: 10, letterSpacing: 2 }, padding: { top: 20 } }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                    yL: { type: 'linear', position: 'left', min: 0, max: fM, ticks: { color: '#71717a', font: { size: 10 }, callback: v => fmt(v) }, title: { display: true, text: 'FPS', color: '#71717a', font: { weight: '500', size: 10, letterSpacing: 2 }, padding: { bottom: 20 } }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, afterFit: s => s.width = 60 },
                    yR: { type: 'linear', position: 'right', min: 0, max: lM, ticks: { color: '#71717a', font: { size: 10 }, callback: v => fmt(v) }, title: { display: true, text: 'LATENCY (ms)', color: '#71717a', font: { weight: '500', size: 10, letterSpacing: 2 }, padding: { bottom: 20 } }, grid: { drawOnChartArea: false }, afterFit: s => s.width = 60 }
                }
            }
        });
    }

    const debouncedRenderChart = debounce(renderChart, 25);

    document.querySelectorAll('.num-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.target.dataset.target;
            const input = document.getElementById(targetId);
            const step = parseFloat(input.step) || 1;
            const min = input.min !== "" ? parseFloat(input.min) : -Infinity;
            let val = parseFloat(input.value) || 0;

            if (e.target.classList.contains('plus')) val += step;
            else if (e.target.classList.contains('minus')) val -= step;
            
            if (val < min) val = min;
            
            const decimals = (input.step.split('.')[1] || '').length;
            input.value = val.toFixed(decimals);
            
            input.dispatchEvent(new Event('input'));
        });
    });

    document.querySelectorAll('.sample-data-link').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const originalText = e.target.innerText;
            e.target.innerText = "LOADING...";
            
            const timestamps = ['2026-03-24T04-53-39', '2026-03-24T05-01-02', '2026-03-24T05-17-51', '2026-03-24T05-23-26', '2026-03-24T05-52-49', '2026-03-24T06-28-45'];

            try {
                let allSampleFiles = [];
                for (const ts of timestamps) {
                    const perfName = `NVIDIA_App_Performance_Log_${ts}.csv`;
                    const latName = `NVIDIA_App_Latency_Log_${ts}.csv`;
                    const [perfRes, latRes] = await Promise.all([ fetch(`./samples/${perfName}`), fetch(`./samples/${latName}`) ]);
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

    dom.copyBtn.addEventListener('click', () => {
        if (!state.chart) return;
        const originalCanvas = document.getElementById('myChart');
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = originalCanvas.width; tempCanvas.height = originalCanvas.height;
        const ctx = tempCanvas.getContext('2d');
        
        ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height); ctx.drawImage(originalCanvas, 0, 0);
        
        tempCanvas.toBlob(async (blob) => {
            try {
                await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
                dom.copyBtn.innerText = "COPIED";
            } catch (err) {
                const a = document.createElement('a');
                a.download = 'latency_graph.png'; a.href = tempCanvas.toDataURL('image/png'); a.click();
                dom.copyBtn.innerText = "DOWNLOADED";
            }
            setTimeout(() => dom.copyBtn.innerText = "COPY GRAPH", 2000);
        }, 'image/png');
    });

    window.addEventListener('load', () => setTimeout(() => document.body.classList.add('loaded'), 800));
    dom.fInput.addEventListener('change', e => { handleFiles(e.target.files); });
    
    [dom.minR, dom.maxR].forEach(r => r.addEventListener('input', () => {
        const min = parseInt(dom.minR.value), max = parseInt(dom.maxR.value), tot = parseInt(dom.minR.max);
        if (min >= max) dom.minR.value = max - 1;
        dom.rTrack.style.left = (tot > 0 ? (dom.minR.value / tot * 100) : 0) + "%";
        dom.rTrack.style.width = (tot > 0 ? ((dom.maxR.value - dom.minR.value) / tot * 100) : 100) + "%";
        debouncedRenderChart();
    }));
    
    [dom.mouseInput, dom.fpsInput, dom.latInput].forEach(i => i.addEventListener('input', renderChart));
    
    document.querySelectorAll('.metric-row').forEach(row => row.addEventListener('click', () => {
        const m = row.dataset.metric; 
        state.visibility[m] = !state.visibility[m];
        row.classList.toggle('disabled', !state.visibility[m]); 
        renderChart();
    }));
});