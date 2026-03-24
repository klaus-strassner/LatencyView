document.addEventListener('DOMContentLoaded', () => {
    // --- Application State ---
    const state = {
        visibility: { fps: true, lows: true, rnd: true, cpu: true, disp: true, peri: true, tot: true },
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
        aSelect: document.getElementById('activeSessionSelect'),
        mouseInput: document.getElementById('manualMouseLat'), 
        mouseStatus: document.getElementById('mouseStatus'),
        fpsInput: document.getElementById('maxFPSInput'), 
        latInput: document.getElementById('maxLatInput'),
        copyBtn: document.getElementById('copyGraphBtn'),
        mainGrid: document.getElementById('mainGrid'),
        homeBtn: document.getElementById('homeBtn')
    };

    // --- State Management / Routing ---
    function resetToGuide() {
        document.body.classList.remove('has-data');
        state.activeKey = null;
        state.pairedSessions = {};
        dom.aSelect.innerHTML = '<option value="">Waiting for file...</option>';
        dom.aSelect.disabled = true;
        if (state.chart) {
            state.chart.destroy();
            state.chart = null;
        }
        dom.fInput.value = ''; 
    }

    // Handle browser Back/Forward buttons
    window.addEventListener('popstate', () => {
        if (window.location.hash !== '#workspace') {
            resetToGuide();
        } else if (Object.keys(state.pairedSessions).length > 0) {
            document.body.classList.add('has-data');
            renderChart();
        }
    });

    // Handle top-left Home logo click
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
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
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

    // --- Grid Mouse Spotlight Effect ---
    dom.mainGrid.addEventListener('mousemove', (e) => {
        const r = dom.mainGrid.getBoundingClientRect();
        dom.mainGrid.style.setProperty('--mouse-x', `${(e.clientX - r.left) / r.width * 100}%`);
        dom.mainGrid.style.setProperty('--mouse-y', `${(e.clientY - r.top) / r.height * 100}%`);
    });
    dom.mainGrid.addEventListener('mouseenter', () => {
        dom.mainGrid.style.setProperty('--spotlight-color', '#4a4a5a'); 
    });
    dom.mainGrid.addEventListener('mouseleave', () => {
        dom.mainGrid.style.setProperty('--spotlight-color', 'var(--line-grey)');
        dom.mainGrid.style.setProperty('--mouse-x', '-100%');
        dom.mainGrid.style.setProperty('--mouse-y', '-100%');
    });

    // --- Core Logic ---
    async function handleFiles(files) {
        const list = Array.from(files).filter(f => f.name.endsWith('.csv'));
        
        const parsePromises = list.map(f => new Promise(res => {
            Papa.parse(f, { 
                header: true, 
                dynamicTyping: true, 
                skipEmptyLines: true, 
                complete: r => res({ name: f.name, data: r.data, cols: Object.keys(r.data[0]) }) 
            });
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
        dom.aSelect.innerHTML = '';
        
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
                dom.aSelect.add(new Option(ts, ts));
            }
        });
        
        if (Object.keys(state.pairedSessions).length) { 
            state.activeKey = Object.keys(state.pairedSessions)[0];
            dom.aSelect.disabled = false; 
            
            document.body.classList.add('has-data');
            if (window.location.hash !== '#workspace') {
                history.pushState({ view: 'workspace' }, '', '#workspace');
            }
            
            renderChart(); 
        }
    }

    function renderChart() {
        if (!state.activeKey) return;
        const session = state.pairedSessions[state.activeKey];
        const lData = session.cleanLat, pData = session.perf.data;
        const tL = session.lat.cols[0], tP = session.perf.cols[0];

        dom.mouseStatus.textContent = session.hasMouseData ? "" : "(MANUAL)";
        dom.mouseStatus.style.color = session.hasMouseData ? "" : "var(--warn)";
        dom.mouseInput.classList.toggle('fallback-active', !session.hasMouseData);

        if (dom.minR.max != lData.length - 1) {
            dom.minR.max = lData.length - 1; 
            dom.maxR.max = lData.length - 1;
            dom.minR.value = 0; 
            dom.maxR.value = lData.length - 1;
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

        const datasets = [];
        const activeFPS = prepPerf(colFPS), activeLow = prepPerf(colLow), activeRnd = prepPerf(colRnd), activePC = prepPerf(colPC);
        
        if (state.visibility.fps) datasets.push({ label: "AVERAGE FPS", data: activeFPS, yAxisID: 'yL', borderColor: '#32d74b', borderWidth: 2, pointRadius: 0 });
        if (state.visibility.lows) datasets.push({ label: "1% LOW FPS", data: activeLow, yAxisID: 'yL', borderColor: '#1d7a2b', borderWidth: 2, pointRadius: 0 });
        
        let lastIdx = null;
        if (state.visibility.rnd) { datasets.push({ label: "RENDER LATENCY", data: activeRnd, yAxisID: 'yR', borderColor: '#fde047', backgroundColor: 'rgba(253, 224, 71, 0.1)', fill: 'origin', borderWidth: 1.5, pointRadius: 0 }); lastIdx = datasets.length - 1; }
        if (state.visibility.cpu) { datasets.push({ label: "CPU LATENCY", data: activePC, yAxisID: 'yR', borderColor: '#ff9f0a', backgroundColor: 'rgba(255, 159, 10, 0.1)', fill: lastIdx !== null ? lastIdx : 'origin', borderWidth: 1.5, pointRadius: 0 }); lastIdx = datasets.length - 1; }

        const valPCD = [], valTot = [], mBase = parseFloat(dom.mouseInput.value) || 0;
        lData.slice(startIdx, endIdx + 1).forEach(r => {
            const colSys = session.lat.cols.find(c => c.toLowerCase().includes('system latency'));
            const colMouse = session.lat.cols.find(c => c.toLowerCase().includes('mouse'));
            const isRealMouse = (colSys && r[colSys] && r[colMouse] > 0);
            valPCD.push({ x: r[tL], y: r[colPCD] });
            valTot.push({ x: r[tL], y: isRealMouse ? r[colSys] : (r[colPCD] + mBase + (mBase * r._jitter)) });
        });

        if (state.visibility.disp) { datasets.push({ label: "DISPLAY LATENCY", data: valPCD, yAxisID: 'yR', borderColor: '#ff375f', backgroundColor: 'rgba(255, 55, 95, 0.1)', fill: lastIdx !== null ? lastIdx : 'origin', borderWidth: 1.5, pointRadius: 0 }); lastIdx = datasets.length - 1; }
        if (state.visibility.peri) { datasets.push({ label: "PERIPHERAL LATENCY", data: valTot, yAxisID: 'yR', borderColor: '#bf5af2', backgroundColor: 'rgba(191, 90, 242, 0.1)', fill: lastIdx !== null ? lastIdx : 'origin', borderWidth: 1.5, pointRadius: 0 }); }
        if (state.visibility.tot) { datasets.push({ label: "TOTAL LATENCY", data: valTot, yAxisID: 'yR', borderColor: '#fff', borderWidth: 1, pointRadius: 0, fill: false }); }

        const updateSidebarMetrics = (id, arr) => {
            const els = ['min', 'avg', 'max'].map(t => document.getElementById(`${t}-${id}`));
            if (!arr.length) { els.forEach(el => el.textContent = "-"); return; }
            els[0].textContent = fmt(Math.min(...arr));
            els[1].textContent = fmt(arr.reduce((a,b)=>a+b,0)/arr.length);
            els[2].textContent = fmt(Math.max(...arr));
        };

        updateSidebarMetrics('fps', activeFPS.map(d=>d.y)); 
        updateSidebarMetrics('lows', activeLow.map(d=>d.y));
        updateSidebarMetrics('rnd', activeRnd.map(d=>d.y)); 
        updateSidebarMetrics('cpu', activePC.map((d,i)=>d.y - (activeRnd[i]?activeRnd[i].y:0)));
        updateSidebarMetrics('disp', valPCD.map(d=>d.y - getInterpolatedValue(pData, d.x, colPC, tP)));
        updateSidebarMetrics('peri', valTot.map((d,i)=>d.y - (valPCD[i]?valPCD[i].y:0))); 
        updateSidebarMetrics('tot', valTot.map(d=>d.y));

        const ctx = document.getElementById('myChart').getContext('2d');
        if (state.chart) state.chart.destroy();
        
        const fM = parseFloat(dom.fpsInput.value), lM = parseFloat(dom.latInput.value);

        state.chart = new Chart(ctx, {
            type: 'line', 
            data: { datasets },
            options: {
                responsive: true, 
                maintainAspectRatio: false, 
                animation: false,
                layout: { padding: { left: 80, right: 80, top: 40, bottom: 20 } },
                plugins: { 
                    legend: { display: true, position: 'top', align: 'center', labels: { color: '#888', font: { family: "'JetBrains Mono'", size: 11, weight: '700' }, boxWidth: 12, padding: 30 } },
                    tooltip: { backgroundColor: '#050505', titleFont: { family: "'JetBrains Mono'" }, callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw.y)}` } } 
                },
                scales: {
                    x: { type: 'linear', min: mMin, max: mMax, ticks: { color: '#444', font: { size: 10 }, callback: v => fmt(v) }, title: { display: true, text: 'TIME (S)', color: '#666', font: { weight: 'bold' } }, grid: { color: '#1a1a20' } },
                    yL: { type: 'linear', position: 'left', min: 0, max: fM, ticks: { color: '#888', font: { size: 10 }, callback: v => fmt(v) }, title: { display: true, text: 'FPS', color: '#666', font: { weight: 'bold' } }, grid: { color: '#1a1a20' }, afterFit: s => s.width = 60 },
                    yR: { type: 'linear', position: 'right', min: 0, max: lM, ticks: { color: '#888', font: { size: 10 }, callback: v => fmt(v) }, title: { display: true, text: 'LATENCY (MS)', color: '#666', font: { weight: 'bold' } }, grid: { drawOnChartArea: false }, afterFit: s => s.width = 60 }
                }
            }
        });
    }

    // --- Event Listeners ---
    const debouncedRenderChart = debounce(renderChart, 25);

    dom.copyBtn.addEventListener('click', () => {
        if (!state.chart) return;
        const originalCanvas = document.getElementById('myChart');
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = originalCanvas.width;
        tempCanvas.height = originalCanvas.height;
        const ctx = tempCanvas.getContext('2d');
        
        ctx.fillStyle = '#08080a';
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(originalCanvas, 0, 0);
        
        tempCanvas.toBlob(async (blob) => {
            try {
                await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
                dom.copyBtn.innerText = "COPIED!";
            } catch (err) {
                const a = document.createElement('a');
                a.download = 'latency_graph.png';
                a.href = tempCanvas.toDataURL('image/png');
                a.click();
                dom.copyBtn.innerText = "DOWNLOADED!";
            }
            setTimeout(() => dom.copyBtn.innerText = "Copy Graph", 2000);
        }, 'image/png');
    });

    window.addEventListener('load', () => setTimeout(() => document.body.classList.add('loaded'), 500));
    
    dom.fInput.addEventListener('change', e => { handleFiles(e.target.files); });
    dom.aSelect.addEventListener('change', e => { state.activeKey = e.target.value; renderChart(); });
    
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