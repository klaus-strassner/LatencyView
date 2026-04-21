const FRAMEVIEW_TIMESTAMP_COLUMN = "TimeInSeconds";
const APP_TIMESTAMP_COLUMN       = "Timestamp (Elapsed time in seconds)";
const ISRDPC_TIMESTAMP_COLUMN    = "DPC/ISR Enter Time (s)";
const CSV_READ_OPTIONS           = "auto_detect=True, header=True, delim=',', null_padding=True, ignore_errors=True";
const MOUSE_LATENCY_SENTINEL     = -0.001;

const METRICS = [
    { key: 'system_latency',     label: 'System Latency',     unit: 'ms',  group: 'Latency',      defaultActive: true  },
    { key: 'display_latency',    label: 'Display Latency',    unit: 'ms',  group: 'Latency',      defaultActive: false },
    { key: 'scheduling_latency', label: 'Scheduling Latency', unit: 'ms',  group: 'Latency',      defaultActive: false },
    { key: 'render_latency',     label: 'Render Latency',     unit: 'ms',  group: 'Latency',      defaultActive: false },
    { key: 'driver_latency',     label: 'Driver Latency',     unit: 'ms',  group: 'Latency',      defaultActive: false },
    { key: 'game_latency',       label: 'Game Latency',       unit: 'ms',  group: 'Latency',      defaultActive: false },
    { key: 'frame_time',         label: 'Frame Time',         unit: 'ms',  group: 'Latency',      defaultActive: false },
    { key: 'dpc_latency',        label: 'DPC Latency',        unit: 'ms',  group: 'Latency',      defaultActive: false },
    { key: 'isr_latency',        label: 'ISR Latency',        unit: 'ms',  group: 'Latency',      defaultActive: false },
    { key: 'peripheral_latency', label: 'Peripheral Latency', unit: 'ms',  group: 'Latency',      defaultActive: false },
    { key: 'gpu_util',           label: 'GPU Util',           unit: '%',   group: 'GPU',          defaultActive: false },
    { key: 'gpu_clk',            label: 'GPU Clk',            unit: 'MHz', group: 'GPU',          defaultActive: false },
    { key: 'gpu_mem_clk',        label: 'GPU Mem Clk',        unit: 'MHz', group: 'GPU',          defaultActive: false },
    { key: 'gpu_temp',           label: 'GPU Temp',           unit: '°C',  group: 'GPU',          defaultActive: false },
    { key: 'gpu_power',          label: 'GPU Power',          unit: 'W',   group: 'GPU',          defaultActive: false },
    { key: 'cpu_util',           label: 'CPU Util',           unit: '%',   group: 'CPU',          defaultActive: false },
    { key: 'cpu_clk',            label: 'CPU Clk',            unit: 'MHz', group: 'CPU',          defaultActive: false },
    { key: 'cpu_temp',           label: 'CPU Temp',           unit: '°C',  group: 'CPU',          defaultActive: false },
    { key: 'cpu_power',          label: 'CPU Power',          unit: 'W',   group: 'CPU',          defaultActive: false },
];

export async function processDataPipeline(conn, pairs, customMouseLatency = 0.08) {
    const filesInPair = pairs[0].filter(f => f != null);

    const schemas = await Promise.all(filesInPair.map(f =>
        conn.query(`DESCRIBE SELECT * FROM read_csv('${f}', ${CSV_READ_OPTIONS}) LIMIT 1`)
    ));

    let frameViewFile = null, appFile = null, isrDpcFile = null;
    let frameViewColumns = null, appColumns = null;
    filesInPair.forEach((fname, i) => {
        const cols = new Set(schemas[i].toArray().map(r => r.column_name));
        if (cols.has(FRAMEVIEW_TIMESTAMP_COLUMN))      { frameViewFile = fname; frameViewColumns = cols; }
        else if (cols.has(ISRDPC_TIMESTAMP_COLUMN))    { isrDpcFile    = fname; }
        else                                           { appFile       = fname; appColumns       = cols; }
    });

    if (!frameViewFile) throw new Error("Could not identify FrameView CSV.");
    if (!appFile)       throw new Error("Could not identify NVIDIA App CSV.");

    const requiredApp = ['PC + DisplayLatency(MSec)', 'System Latency (MSec)'];
    const requiredFV  = ['MsBetweenPresents', 'MsUntilDisplayed', 'MsRenderPresentLatency', 'MsPCLatency'];
    for (const col of requiredApp) if (!appColumns.has(col))       throw new Error(`Required column "${col}" not found in NVIDIA App file.`);
    for (const col of requiredFV)  if (!frameViewColumns.has(col)) throw new Error(`Required column "${col}" not found in FrameView file.`);

    const hasMouseLatency = appColumns.has('Mouse Latency(MSec)');
    const hasInPresentAPI = frameViewColumns.has('MsInPresentAPI');

    // Hardware telemetry columns (all from FrameView, all optional)
    const HW_COLUMNS = [
        { key: 'gpu_util',    col: 'GPU0Util(%)' },
        { key: 'gpu_clk',     col: 'GPU0Clk(MHz)' },
        { key: 'gpu_mem_clk', col: 'GPU0MemClk(MHz)' },
        { key: 'gpu_temp',    col: 'GPU0Temp(C)' },
        { key: 'gpu_power',   col: 'NV Pwr(W) (API)' },
        { key: 'cpu_util',    col: 'CPUUtil(%)' },
        { key: 'cpu_clk',     col: 'CPUClk(MHz)' },
        { key: 'cpu_temp',    col: 'CPU Package Temp(C)' },
        { key: 'cpu_power',   col: 'CPU Package Power(W)' },
    ];
    const presentHW = HW_COLUMNS.filter(h => frameViewColumns.has(h.col));

    // If mouse latency column is absent, treat all rows as sentinel → use custom value
    const mouseLatencyRawExpr = hasMouseLatency
        ? `TRY_CAST("Mouse Latency(MSec)" AS FLOAT)`
        : `CAST(${MOUSE_LATENCY_SENTINEL} AS FLOAT)`;

    const inPresentAPIExpr = hasInPresentAPI
        ? `TRY_CAST("MsInPresentAPI" AS FLOAT)`
        : `CAST(NULL AS FLOAT)`;

    // Game latency = PC latency - scheduling component - driver component - ISR/DPC (when present)
    const isrDpcSubtract = isrDpcFile ? ` - COALESCE(isr_latency, 0) - COALESCE(dpc_latency, 0)` : ``;
    const gameLatencyExpr = hasInPresentAPI
        ? `pc_latency_fv - until_displayed - in_present_api${isrDpcSubtract}`
        : `pc_latency_fv - until_displayed${isrDpcSubtract}`;

    const driverLatencyExpr = hasInPresentAPI ? `in_present_api` : `CAST(NULL AS FLOAT)`;

    // Materialize FrameView once — it's consumed by both the main pipeline and the
    // FPS percentile query, and reparsing the CSV twice was wasting heap.
    const hwSelectClauses = presentHW.map(h =>
        `TRY_CAST("${h.col}" AS FLOAT) as ${h.key}`
    ).join(',\n            ');

    await conn.query(`
        CREATE OR REPLACE TEMP TABLE fv_typed AS
        SELECT
            TRY_CAST("${FRAMEVIEW_TIMESTAMP_COLUMN}" AS FLOAT) as ts,
            TRY_CAST("MsBetweenPresents"             AS FLOAT) as frame_time,
            TRY_CAST("MsUntilDisplayed"              AS FLOAT) as until_displayed,
            TRY_CAST("MsRenderPresentLatency"        AS FLOAT) as render_latency,
            TRY_CAST("MsPCLatency"                   AS FLOAT) as pc_latency_fv,
            ${inPresentAPIExpr}                                 as in_present_api${presentHW.length ? ',\n            ' + hwSelectClauses : ''}
        FROM read_csv('${frameViewFile}', ${CSV_READ_OPTIONS})
    `);

    // Extract hardware names from the FrameView file (first non-null row)
    const hasGpuName = frameViewColumns.has('GPU');
    const hasCpuName = frameViewColumns.has('CPU');
    let gpuName = null, cpuName = null;
    if (hasGpuName || hasCpuName) {
        const nameCols = [hasGpuName && '"GPU"', hasCpuName && '"CPU"'].filter(Boolean).join(', ');
        const nameResult = await conn.query(
            `SELECT ${nameCols} FROM read_csv('${frameViewFile}', ${CSV_READ_OPTIONS}) LIMIT 1`
        );
        if (hasGpuName) gpuName = nameResult.getChild('GPU')?.get(0) ?? null;
        if (hasCpuName) cpuName = nameResult.getChild('CPU')?.get(0) ?? null;
    }

    // ISR/DPC typed table — values in the source CSV use comma decimal separators
    // and are quoted, so we read as VARCHAR via auto_detect and REPLACE(',', '.')
    // before casting. Pair-level aggregates (per-frame ISR/DPC latency) are
    // computed later inside the main CTE pipeline.
    if (isrDpcFile) {
        await conn.query(`
            CREATE OR REPLACE TEMP TABLE isr_typed AS
            SELECT
                TRY_CAST(REPLACE(CAST("${ISRDPC_TIMESTAMP_COLUMN}"  AS VARCHAR), ',', '.') AS DOUBLE) AS ts,
                "Type"                                                                                AS type,
                TRY_CAST(REPLACE(CAST("Duration (Fragmented) (ms)" AS VARCHAR), ',', '.') AS DOUBLE) AS duration
            FROM read_csv('${isrDpcFile}', ${CSV_READ_OPTIONS})
        `);
    }

    // Only include metrics whose columns are present in the SQL output.
    // Hardware metrics are conditional on FrameView schema; ISR/DPC metrics
    // are conditional on the ISR/DPC CSV being present.
    const presentHWKeys = new Set(presentHW.map(h => h.key));
    const activeMetrics = METRICS.filter(m => {
        if (HW_COLUMNS.some(h => h.key === m.key))   return presentHWKeys.has(m.key);
        if (m.key === 'isr_latency' || m.key === 'dpc_latency') return !!isrDpcFile;
        return true;
    });

    const windowAggregates = activeMetrics.map(m =>
        `MIN(${m.key}) OVER () as ${m.key}_min, MAX(${m.key}) OVER () as ${m.key}_max, AVG(${m.key}) OVER () as ${m.key}_avg, COUNT(${m.key}) OVER () as ${m.key}_count`
    ).join(', ');

    // ISR/DPC CTEs: normalize to its own t=0 like the other two sides, bin every
    // ISR/DPC event to the next app row at or after it, then sum durations per
    // app row — split by type so Interrupts → isr_latency, DPCs → dpc_latency.
    const isrCTEs = isrDpcFile ? `,
        isr_norm AS (
            SELECT ts - MIN(ts) OVER () AS norm_ts, type, duration
            FROM isr_typed
            WHERE ts IS NOT NULL AND duration IS NOT NULL
        ),
        isr_binned AS (
            SELECT app.norm_ts AS app_norm_ts, isr.type, isr.duration
            FROM isr_norm isr
            ASOF JOIN app_norm app ON isr.norm_ts <= app.norm_ts
        ),
        isr_agg AS (
            SELECT
                app_norm_ts,
                SUM(CASE WHEN type = 'Interrupt' THEN duration ELSE 0 END) AS isr_latency,
                SUM(CASE WHEN type = 'DPC'       THEN duration ELSE 0 END) AS dpc_latency
            FROM isr_binned
            GROUP BY app_norm_ts
        )` : '';

    const isrJoinedCols = isrDpcFile ? ',\n                   isr_agg.isr_latency, isr_agg.dpc_latency' : '';
    const isrJoin       = isrDpcFile ? 'LEFT JOIN isr_agg ON app.norm_ts = isr_agg.app_norm_ts' : '';
    const isrComputed   = isrDpcFile ? 'COALESCE(isr_latency, 0) as isr_latency,\n                COALESCE(dpc_latency, 0) as dpc_latency,\n                ' : '';

    const result = await conn.query(`
        WITH app_raw AS (
            SELECT
                TRY_CAST("${APP_TIMESTAMP_COLUMN}"       AS FLOAT) as ts,
                TRY_CAST("PC + DisplayLatency(MSec)"     AS FLOAT) as pc_display_latency,
                TRY_CAST("System Latency (MSec)"         AS FLOAT) as system_latency_raw,
                ${mouseLatencyRawExpr}                              as mouse_latency_raw
            FROM read_csv('${appFile}', ${CSV_READ_OPTIONS})
            WHERE TRY_CAST("${APP_TIMESTAMP_COLUMN}" AS FLOAT) IS NOT NULL
        ),
        fv_raw AS ( SELECT * FROM fv_typed WHERE ts IS NOT NULL ),
        app_norm AS ( SELECT *, ts - MIN(ts) OVER () AS norm_ts FROM app_raw ),
        fv_norm  AS ( SELECT *, ts - MIN(ts) OVER () AS norm_ts FROM fv_raw  )${isrCTEs},
        -- ASOF JOIN replaces a LATERAL ORDER BY ABS(...) LIMIT 1 that materialized
        -- the full N×M cross-product and OOM'd on larger captures. Both sides are
        -- normalized to start at norm_ts=0, so the first app row always finds a
        -- match and subsequent gaps are at most one frame.
        joined AS (
            SELECT app.ts, app.pc_display_latency, app.system_latency_raw, app.mouse_latency_raw,
                   fv.frame_time, fv.until_displayed, fv.render_latency, fv.pc_latency_fv, fv.in_present_api${presentHW.length ? ',\n                   ' + presentHW.map(h => `fv.${h.key}`).join(', ') : ''}${isrJoinedCols}
            FROM app_norm app
            ASOF JOIN fv_norm fv ON app.norm_ts >= fv.norm_ts
            ${isrJoin}
        ),
        computed AS (
            SELECT
                ts,
                mouse_latency_raw,
                pc_display_latency,
                system_latency_raw,
                -- Peripheral latency: substitute custom value when sentinel detected
                GREATEST(0.0, CASE WHEN mouse_latency_raw = ${MOUSE_LATENCY_SENTINEL}
                     THEN ${customMouseLatency} ELSE mouse_latency_raw END)  as peripheral_latency,
                -- System latency: recalculate when mouse latency was substituted
                GREATEST(0.0, CASE WHEN mouse_latency_raw = ${MOUSE_LATENCY_SENTINEL}
                     THEN pc_display_latency + ${customMouseLatency}
                     ELSE system_latency_raw END)                            as system_latency,
                GREATEST(0.0, pc_display_latency - pc_latency_fv)           as display_latency,
                GREATEST(0.0, until_displayed - render_latency)              as scheduling_latency,
                GREATEST(0.0, render_latency)                                as render_latency,
                GREATEST(0.0, ${driverLatencyExpr})                          as driver_latency,
                GREATEST(0.0, ${gameLatencyExpr})                            as game_latency,
                ${isrComputed}frame_time${presentHW.length ? ',\n                ' + presentHW.map(h => h.key).join(', ') : ''}
            FROM joined
        )
        SELECT
            ts, ${activeMetrics.map(m => m.key).join(', ')},
            mouse_latency_raw, pc_display_latency, system_latency_raw,
            MIN(ts)                  OVER () as minX,
            MAX(ts)                  OVER () as maxX,
            MIN(mouse_latency_raw)   OVER () as mouse_raw_min,
            ${windowAggregates}
        FROM computed
        ORDER BY ts ASC
    `);

    const getScalar = col => Number(result.getChild(col).get(0));
    const appMinTs  = getScalar('minX');

    // FPS percentiles computed on raw FrameView data — avoids skew from ASOF-joined duplicates
    const fpsResult = await conn.query(`
        SELECT
            1000.0 / AVG(frame_time)                                                    as avg_fps,
            1000.0 / PERCENTILE_CONT(0.99)  WITHIN GROUP (ORDER BY frame_time)         as fps_1pct_low,
            1000.0 / PERCENTILE_CONT(0.999) WITHIN GROUP (ORDER BY frame_time)         as fps_01pct_low
        FROM fv_typed
        WHERE frame_time > 0
    `);

    // Time-binned FPS from raw FrameView data (100 ms buckets → 10 points/sec).
    // Each bucket's FPS = frame_count / SUM(frame_time) * 1000, which is the
    // true framerate during that interval — not a single-frame instantaneous value.
    // Timestamps are aligned to the app timeline (same origin as the joined data).
    const FPS_BIN_MS = 50;
    const fvRawResult = await conn.query(`
        WITH fv_norm AS (
            SELECT ts - MIN(ts) OVER () AS norm_ts, frame_time
            FROM fv_typed
            WHERE ts IS NOT NULL AND frame_time > 0
        )
        SELECT FLOOR(norm_ts / ${FPS_BIN_MS / 1000}) * ${FPS_BIN_MS / 1000} + ${appMinTs} AS ts,
               COUNT(*) / SUM(frame_time) * 1000.0 AS fps
        FROM fv_norm
        GROUP BY FLOOR(norm_ts / ${FPS_BIN_MS / 1000})
        ORDER BY ts ASC
    `);

    const getFpsScalar = col => Number(fpsResult.getChild(col).get(0));
    const timestamps   = new Float32Array(result.getChild('ts').toArray());

    // Mouse raw min < 0 means at least one sentinel was present → custom value was used
    const usedCustomMouseLatency = getScalar('mouse_raw_min') < 0;

    // Raw arrays for client-side peripheral latency recalculation (avoids full pipeline re-run)
    const mouseLatencyRaw    = new Float32Array(result.getChild('mouse_latency_raw').toArray());
    const pcDisplayLatency   = new Float32Array(result.getChild('pc_display_latency').toArray());
    const systemLatencyRaw   = new Float32Array(result.getChild('system_latency_raw').toArray());

    const sparsityThreshold = timestamps.length * 0.01;
    const metrics = activeMetrics.flatMap(m => {
        const min   = getScalar(`${m.key}_min`);
        const max   = getScalar(`${m.key}_max`);
        const count = getScalar(`${m.key}_count`);
        if (isNaN(min) || isNaN(max) || count < sparsityThreshold) return [];
        return [{
            key:           m.key,
            label:         m.label,
            unit:          m.unit,
            group:         m.group,
            defaultActive: m.defaultActive,
            data:          new Float32Array(result.getChild(m.key).toArray()),
            min, max,
            avg: getScalar(`${m.key}_avg`),
        }];
    });

    const fpsStats = {
        avgFps:     getFpsScalar('avg_fps'),
        fps1pctLow: getFpsScalar('fps_1pct_low'),
        fps01pctLow: getFpsScalar('fps_01pct_low'),
    };

    const fvTs  = new Float32Array(fvRawResult.getChild('ts').toArray());
    const fvFps = new Float32Array(fvRawResult.getChild('fps').toArray());

    return {
        ts: timestamps,
        metrics,
        minX: getScalar('minX'),
        maxX: getScalar('maxX'),
        numRows: timestamps.length,
        usedCustomMouseLatency,
        fpsStats,
        fvTs,
        fvFps,
        mouseLatencyRaw,
        pcDisplayLatency,
        systemLatencyRaw,
        gpuName,
        cpuName,
    };
}
