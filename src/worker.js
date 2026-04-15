import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';
import { processDataPipeline } from './data-queries.js';

// DuckDB-Wasm has a hard WASM heap ceiling (~4 GB). Multiple sequential
// LOAD_FILE_PAIRS calls accumulate internal buffers that aren't fully
// released, so we reboot the whole instance between loads. The first boot
// is eager (happens at startup) so the user doesn't pay it on first click.

let db         = null;
let conn       = null;
let bundle     = null;
let freshBoot  = false;  // true right after a fresh boot — skip tearing down

async function getBundle() {
    if (!bundle) bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    return bundle;
}

async function tearDown() {
    if (conn) { try { await conn.close();   } catch (e) {} conn = null; }
    if (db)   { try { await db.terminate(); } catch (e) {} db   = null; }
}

async function bootFresh() {
    await tearDown();
    self.postMessage({ status: "Booting DuckDB-Wasm Engine..." });
    try {
        const b         = await getBundle();
        const workerURL = URL.createObjectURL(new Blob([`importScripts("${b.mainWorker}");`], { type: 'text/javascript' }));
        db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), new Worker(workerURL));
        await db.instantiate(b.mainModule, b.pthreadWorker);
        URL.revokeObjectURL(workerURL);
        conn = await db.connect();

        // Best-effort: tell DuckDB it may spill to the emscripten VFS.
        // Silently ignored on builds that don't support it.
        try { await conn.query(`PRAGMA temp_directory='tmp'`); } catch (e) {}

        freshBoot = true;
        self.postMessage({ status: "DuckDB Engine Ready." });
    } catch (error) {
        self.postMessage({ status: `DuckDB Init Failed: ${error.message}` });
    }
}

// Eager first boot so the landing page reports "Ready" without waiting on a click
bootFresh();

self.onmessage = async ({ data }) => {
    if (data.type !== 'LOAD_FILE_PAIRS') return;

    // If this isn't the first load since the last fresh boot, reboot to
    // release whatever DuckDB held onto from the previous query.
    if (!freshBoot) await bootFresh();
    freshBoot = false;

    if (!db || !conn) {
        self.postMessage({ type: 'ERROR', sessionId: data.sessionId, message: 'DuckDB unavailable. Please reload the page.' });
        return;
    }

    const { flatFiles, pairs, customMouseLatency = 1.0, sessionId } = data;
    try {
        for (let i = 0; i < flatFiles.length; i++)
            await db.registerFileHandle(flatFiles[i].name, flatFiles[i], duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);

        self.postMessage({ status: "Executing Data Pipeline..." });
        const { ts, metrics, minX, maxX, numRows, usedCustomMouseLatency, fpsStats, fvTs, fvFps, mouseLatencyRaw, pcDisplayLatency, systemLatencyRaw, gpuName, cpuName } = await processDataPipeline(conn, pairs, customMouseLatency);

        if (numRows === 0) throw new Error("No valid numeric data found.");

        self.postMessage({ status: `Transferring ${numRows.toLocaleString()} rows...` });

        const transferables = [ts.buffer, ...metrics.map(m => m.data.buffer), fvTs.buffer, fvFps.buffer, mouseLatencyRaw.buffer, pcDisplayLatency.buffer, systemLatencyRaw.buffer];
        self.postMessage({ type: 'RENDER_CHART', sessionId, numRows, ts, metrics, minX, maxX, usedCustomMouseLatency, fpsStats, fvTs, fvFps, mouseLatencyRaw, pcDisplayLatency, systemLatencyRaw, gpuName, cpuName }, transferables);
        self.postMessage({ status: `Rendered ${numRows.toLocaleString()} data points on WebGPU.` });

        // Drop file handles so the next reboot doesn't carry them.
        for (const f of flatFiles) {
            try { await db.dropFile(f.name); } catch (e) {}
        }
    } catch (error) {
        self.postMessage({ type: 'ERROR', sessionId, message: error.message });
        self.postMessage({ status: `Error: ${error.message}` });
    }
};
