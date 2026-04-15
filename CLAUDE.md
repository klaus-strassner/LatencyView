# Latency View Development Guide for AI Agents

## Project Overview

Latency View is a web app that visualizes PC latency data from the Reflex Latency Analyzer. Users record a benchmark with both FrameView and the NVIDIA App, then select the FrameView and NVIDIA App Latency CSV files. The app pairs files by `lastModified` timestamp, joins them via DuckDB-Wasm SQL (ASOF join after normalizing both sides to start at t=0), and renders stacked line charts on a WebGPU canvas.

Multiple pairs can be loaded as independent **sessions**. The sidebar lists sessions; clicking one activates its single-view chart. **Compare mode** renders an N-row stacked bar chart across checked sessions — one stacked latency bar and one stacked FPS bar per session — with the best session's end-cap highlighted in the accent color.

---

## Tech Stack

| Concern | Detail |
| --- | --- |
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Data engine | DuckDB-Wasm |
| Rendering | WebGPU |
| Hosting | Github Pages |

---

## File Map

| File | Responsibility |
| --- | --- |
| `index.html` | Landing view + Workspace view (sidebar + `#single-view` canvas + `#compare-view` canvas) |
| `style.css` | All styles |
| `src/main.js` | Main thread: session state, WebGPU init, single-chart render, compare-chart render, sidebar |
| `src/worker.js` | Web Worker: DuckDB-Wasm lifecycle (reboots between loads to release heap) |
| `src/data-queries.js` | DuckDB SQL pipeline — schema detection, ASOF join, metric derivation, FPS percentiles |
| `lib/mini-coi.js` | Service worker that adds COOP/COEP headers for cross-origin isolation |

---

## Metrics

| Metric | Source |
| --- | --- |
| **System Latency** | `NvidiaApp.[System Latency (MSec)]` |
| ├── Display Latency | `NvidiaApp.[PC + DisplayLatency(MSec)]` - `Frameview.[MsPCLatency]` |
| ├── Scheduling Latency | `Frameview.[MsUntilDisplayed]` - `Frameview.[MsRenderPresentLatency]` |
| ├── Render Latency | `Frameview.[MsRenderPresentLatency]` |
| ├── Driver Latency | `Frameview.[MsInPresentAPI]` |
| ├── Game Latency | `Frameview.[MsPCLatency]` - `Frameview.[MsUntilDisplayed]` - `Frameview.[MsInPresentAPI]` |
| │ └── Frame Time | `Frameview.[MsBetweenPresents]` |
| └── Peripheral Latency | `NvidiaApp.[Mouse Latency(MSec)]` |
| **FPS** | `1000 / Frameview.[MsBetweenPresents]` |
| ├── Avg FPS | `1000 / AVG(Frameview.[MsBetweenPresents])` |
| ├── 1% Low FPS | `1000 / PERCENTILE_CONT(0.99) OVER (ORDER BY Frameview.[MsBetweenPresents])` |
| └── 0.1% Low FPS | `1000 / PERCENTILE_CONT(0.999) OVER (ORDER BY Frameview.[MsBetweenPresents])` |

FPS percentiles are computed on raw FrameView rows (not the ASOF-joined output) to avoid skew from duplicated rows.

Fallback Logic if Peripheral Latency is invalid (<0ms) or the column is absent:

1. Set default Peripheral Latency to 1ms.
2. Show a sidebar input so the user can manually adjust this value and re-run the pipeline.
3. Recalculate System Latency: `NvidiaApp.[PC + DisplayLatency(MSec)] + [Custom Peripheral Latency]`.

The fallback is triggered by a sentinel value (`-0.001`) substituted in the SQL when the row's mouse latency is missing; the worker reports `usedCustomMouseLatency = true` when any sentinel was present.

---

## Visuals

- Maximize Whitespace: Elements must never feel crowded. Use aggressive, deliberate empty space to project confidence and luxury.

- Razor-Thin Geometry: Use only ultra-light, highly legible typography and fine, 1px structural borders.

- Strictly Muted Palette: Restrict colors to monochrome or stark, serious tones (e.g., deep black, bone white, slate, titanium). Absolutely no bright, primary, or playful colors.

- Zero Latency: Eliminate all CSS transitions, easing, and decorative animations. Hover states, routing, and loading must feel instantaneous.

- Ruthless Minimalism: Strip away all marketing fluff, friendly greetings, and hand-holding text. If a geometric icon explains the function perfectly, remove the text label entirely.

- No Gamification: Do not add badges, celebratory pop-ups, or "rewards." This is a sterile precision instrument, not a toy.

- Quiet Authority: The UI must never try to sell itself, entertain the user, or justify its existence. Keep the layout deliberate, exact, and uncompromising.

---

## Update This File

After any session where the implementation changed: update the relevant section above.
