# Cloud Panel Visual/Functional Parity (Fase 3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cloud-panel-app` look and navigate exactly like the local
dashboard (`src/content-central-server.js`'s `renderApp()`) — same CSS
(copied literally, not approximated), same 3-column shell (header, project
sidebar, section nav, workspace), same per-tab card language.

**Architecture:** Replace `cloud-panel-app/src/styles/global.css`'s content
with the local dashboard's `<style>` block verbatim. Add one shared
`AppShell` component (header + sidebar + section-nav + `<Outlet/>`) as a
react-router layout route wrapping every authenticated page. Convert
`App.tsx` to nested routes under that layout. Every existing page keeps
100% of its logic — only the outer wrapper markup and a handful of stray
inline styles change to match the new class names.

**Tech Stack:** React 19 + react-router-dom 7 + Vite 6 + TypeScript 5.8 +
Vitest 3 (unchanged).

## Global Constraints

- The copied CSS in Task 1, Step 1 must be byte-identical to
  `src/content-central-server.js` lines 5510-5528 (the `<style>` block's
  content) — no renamed classes, no adjusted colors/values. If a class an
  existing page needs isn't in that block, that's a signal to re-check the
  copy, not to invent a new class.
- Var-name migration (old cloud-panel-app names → local names, used
  throughout): `var(--text-dim)` → `var(--muted)`, `var(--danger)` →
  `var(--bad)`, `var(--border)` → `var(--line)`. Every occurrence in the
  existing pages is enumerated task-by-task below — do not leave any
  unconverted, the old var names won't exist in the new stylesheet.
- No logic changes anywhere in this plan. Every task is markup/class only.
  If a step here looks like it's changing behavior, stop and flag it
  rather than guessing — it's a plan defect, not a green light.
- `npm run build` is this project's real type-check (`tsc --noEmit` alone
  checks nothing here) — always use it to verify, per every task's Step.

---

### Task 1: Shared CSS, AppShell, routing, Dashboard/Overview

**Files:**
- Modify: `cloud-panel-app/src/styles/global.css` (full replace)
- Create: `cloud-panel-app/src/components/AppShell.tsx`
- Create: `cloud-panel-app/src/pages/Overview.tsx`
- Modify: `cloud-panel-app/src/App.tsx`
- Modify: `cloud-panel-app/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabaseClient` (existing). `RequireAuth`
  from `@/components/RequireAuth` (existing, unchanged signature —
  `({children}: {children: ReactNode})`).
- Produces: `AppShell` — a route element with no props, rendered as a
  react-router **layout route** (renders `<Outlet/>` for its children).
  Every later task's pages render *inside* `AppShell`'s `.workspace-main`
  and must NOT render their own `<header>`/sidebar/nav — just their tab
  content, starting from a `.card` or plain flex wrapper.

- [ ] **Step 1: Replace `global.css`'s content**

Replace the entire content of `cloud-panel-app/src/styles/global.css`
with this (copied verbatim from `src/content-central-server.js`'s
`renderApp()` — the local dashboard's real stylesheet, one block, do not
reformat or split it):

```css
/* src/styles/global.css — copied verbatim from src/content-central-server.js's renderApp() <style> block, so the cloud panel matches the local dashboard exactly. Do not hand-edit values here; if something needs to change, change it in both places. */
:root{color-scheme:dark;--bg:#07070a;--bg-soft:#0a0a0d;--panel:#0e0e12;--surface:rgba(255,255,255,.04);--surface-2:rgba(255,255,255,.06);--surface-3:rgba(255,255,255,.08);--line:rgba(255,255,255,.09);--line-strong:rgba(255,255,255,.16);--muted:#94939f;--text:#f8f7fb;--soft:#d6d4e0;--faint:#68667a;--accent:#8b6bff;--accent-strong:#a78bff;--accent-2:#ff5fb8;--accent-3:#4fd1ff;--accent-gradient:linear-gradient(135deg,var(--accent) 0%,#c15fff 48%,var(--accent-2) 100%);--accent-warm:#facc15;--ok:#22c55e;--bad:#ef4444;--warn:#f59e0b;--radius-sm:10px;--radius:16px;--radius-lg:24px;--shadow:0 24px 80px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.05);--button-h:44px;--ease:cubic-bezier(.16,1,.3,1)}
*{box-sizing:border-box}html{scroll-behavior:smooth}input[type=checkbox],input[type=radio]{accent-color:var(--accent);width:16px;height:16px;min-height:0;flex:0 0 auto}
@keyframes driftA{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(3vw,2vh) scale(1.08)}}
@keyframes driftB{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-4vw,-3vh) scale(1.05)}}
body{margin:0;min-height:100vh;background:#050508;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:15px;line-height:1.55;font-feature-settings:"cv01","ss03";text-rendering:geometricPrecision;position:relative;overflow-x:hidden}
body::before,body::after{content:'';position:fixed;z-index:0;border-radius:50%;filter:blur(90px);pointer-events:none;opacity:.5}
body::before{top:-18vh;left:-10vw;width:56vw;height:56vw;background:radial-gradient(circle,rgba(139,107,255,.5),transparent 68%);animation:driftA 26s ease-in-out infinite}
body::after{bottom:-24vh;right:-14vw;width:52vw;height:52vw;background:radial-gradient(circle,rgba(255,95,184,.32),transparent 68%);animation:driftB 30s ease-in-out infinite}
@media(prefers-reduced-motion:reduce){body::before,body::after{animation:none}}
header,main{position:relative;z-index:1}
button,input,select,textarea{font:inherit}button{min-height:44px;border:1px solid transparent;border-radius:12px;background:var(--accent-gradient);background-size:160% 160%;color:#fff;font-weight:750;padding:0 16px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 10px 30px rgba(139,107,255,.28),inset 0 1px 0 rgba(255,255,255,.16);transition:transform .22s var(--ease),border-color .22s var(--ease),background-position .4s var(--ease),filter .2s ease,box-shadow .22s var(--ease)}button:hover{filter:brightness(1.08);transform:translateY(-2px);background-position:100% 40%;box-shadow:0 16px 38px rgba(139,107,255,.36),inset 0 1px 0 rgba(255,255,255,.2)}button:active{transform:translateY(0)}button:disabled{opacity:.6;cursor:wait;transform:none}button.secondary,.action-secondary{background:var(--surface-2);color:var(--soft);border-color:var(--line);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}button.secondary:hover,.action-secondary:hover{background:var(--surface-3);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}button.ghost{background:transparent;color:var(--soft);border-color:var(--line);box-shadow:none}button.ghost:hover{background:var(--surface);box-shadow:none}button.danger{background:rgba(239,68,68,.13);border-color:rgba(239,68,68,.34);color:#fecaca;box-shadow:none}.action-primary{background:var(--accent-gradient);background-size:160% 160%;color:#fff}.full-width{width:100%}.button-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;align-items:center}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:999px;animation:spin .8s linear infinite;vertical-align:-2px}button.secondary .spinner{border-color:#fafafa55;border-top-color:#fafafa}@keyframes spin{to{transform:rotate(360deg)}}
header{padding:20px 28px;border-bottom:1px solid var(--line);background:rgba(6,6,9,.66);backdrop-filter:blur(22px) saturate(140%);position:sticky;top:0;z-index:20}.hero{display:flex;justify-content:space-between;gap:18px;align-items:center;max-width:1540px;margin:0 auto}.hero-brand{display:flex;align-items:center;gap:14px}.hero-mark{width:42px;height:42px;border-radius:13px;flex:0 0 auto;background:var(--accent-gradient);background-size:160% 160%;box-shadow:0 8px 24px rgba(139,107,255,.4),inset 0 1px 0 rgba(255,255,255,.3);display:grid;place-items:center;font-weight:800;font-size:17px;color:#fff}.panel-kicker{margin:0 0 6px;background:var(--accent-gradient);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.16em}.hero h1{margin:0 0 6px;font-size:clamp(26px,2.6vw,36px);letter-spacing:-.05em;line-height:1.04;font-weight:800}.sub{color:var(--muted);margin:0;max-width:820px;line-height:1.6;font-size:14px}.hero-metrics{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:10px;min-width:390px}.metric{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:12px 14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.05);transition:border-color .2s var(--ease),background .2s var(--ease)}.metric:hover{border-color:var(--line-strong);background:var(--surface-2)}.metric b{display:block;font-size:18px;letter-spacing:-.02em}.metric span{display:block;color:var(--muted);font-size:12px;margin-top:2px}
.wrap.design-shell{display:grid;grid-template-columns:280px 216px minmax(0,1fr);gap:18px;max-width:1540px;margin:0 auto;padding:18px 22px 42px;align-items:start}.card{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.022)),rgba(14,14,18,.55);backdrop-filter:blur(20px) saturate(140%);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow);transition:border-color .25s var(--ease),box-shadow .25s var(--ease),transform .25s var(--ease)}.sidebar{position:sticky;top:96px;padding:18px 18px 28px;max-height:calc(100vh - 114px);overflow:auto;scrollbar-width:thin}.workspace-main{display:grid;gap:16px;min-width:0}.workspace-main>.card{min-width:0;max-width:100%}.selected-card{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:18px 20px;position:relative;overflow:hidden}.selected-card::before{content:'';position:absolute;inset:0;background:radial-gradient(140% 100% at 0% 0%,rgba(139,107,255,.14),transparent 55%);pointer-events:none}.selected-info{line-height:1.7;min-width:0;overflow-wrap:anywhere;position:relative}.quick-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;min-width:0;max-width:100%;flex:1 1 360px;position:relative}.quick-actions button{width:100%}.section-nav{position:sticky;top:96px;max-height:calc(100vh - 114px);overflow:auto;scrollbar-width:thin;display:flex;flex-direction:column;gap:4px;padding:12px}.tab-button{white-space:nowrap;background:transparent;color:var(--muted);border-color:transparent;box-shadow:none;min-height:40px;padding:0 14px;transition:color .2s ease,background .2s ease;width:100%;justify-content:flex-start;text-align:left}.tab-button:hover{color:var(--soft);background:var(--surface)}.tab-button.active{background:var(--accent-gradient);background-size:160% 160%;border-color:transparent;color:#fff;box-shadow:0 8px 22px rgba(139,107,255,.32),inset 0 1px 0 rgba(255,255,255,.18)}.tab-panel{display:none;padding:22px;animation:panelIn .35s var(--ease)}.tab-panel.active{display:block}@keyframes panelIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.tab-panel{animation:none}}.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:14px}.stat-card{border:1px solid var(--line);background:var(--surface);border-radius:16px;padding:14px 16px}.stat-card b{display:block;font-size:26px;letter-spacing:-.02em}.stat-card span{display:block;color:var(--muted);font-size:12px;margin-top:4px}.checklist{display:grid;gap:8px;margin-top:12px}.checklist-item{display:flex;align-items:center;gap:12px;border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:12px 14px}.checklist-item .check-icon{width:26px;height:26px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;font-size:13px;font-weight:800;border:1px solid var(--line-strong)}.checklist-item.done .check-icon{background:rgba(34,197,94,.18);color:#86efac;border-color:rgba(34,197,94,.4)}.checklist-item:not(.done) .check-icon{color:var(--muted)}.checklist-item .check-label{flex:1;min-width:0}.checklist-item .check-title{font-weight:700}.checklist-item .check-desc{color:var(--muted);font-size:12px;margin-top:2px}
.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.section-title h2,.section-title h3{margin:0;letter-spacing:-.03em;line-height:1.15}.section-title h2{font-size:24px}.section-title h3{font-size:18px}.section-heading{margin:22px 0 4px;letter-spacing:-.02em}.step,.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:4px 9px;color:var(--soft);font-size:12px;font-weight:700;background:rgba(255,255,255,.035);line-height:1.2}.step{text-transform:uppercase;letter-spacing:.08em;color:var(--accent-warm)}.pill.ok,.ok{color:#86efac}.pill.bad,.bad{color:#fecaca}.muted{color:var(--muted)}hr{border:0;border-top:1px solid var(--line);margin:18px 0}
label{display:block;color:var(--soft);font-weight:680;font-size:13px;margin:12px 0 6px}input,select,textarea{width:100%;border:1px solid var(--line);background:rgba(255,255,255,.035);color:var(--text);border-radius:12px;padding:11px 12px;outline:none;min-height:44px}textarea{min-height:118px;resize:vertical;line-height:1.55}input:focus,select:focus,textarea:focus{border-color:rgba(139,107,255,.72);box-shadow:0 0 0 4px rgba(139,107,255,.16)}input::placeholder,textarea::placeholder{color:#6f7480}.field-card{background:rgba(255,255,255,.025);border:1px solid var(--line);border-radius:18px;padding:16px;transition:border-color .2s var(--ease)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.mini-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.notice,.guide-box,.empty-state{border:1px solid var(--line);background:rgba(255,255,255,.035);border-radius:18px;padding:15px 16px;line-height:1.65}.guide-box{border-style:dashed}.empty-state{text-align:center;color:var(--muted)}.status-line{min-height:24px;color:var(--muted);margin-top:10px}.toast{display:none;position:fixed;right:22px;bottom:22px;background:#111216;border:1px solid var(--line-strong);color:var(--text);padding:14px 16px;border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.42);z-index:50;max-width:420px}.projects{display:grid;gap:10px}.project{padding:14px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.025);cursor:pointer;transition:background .2s var(--ease),border-color .2s var(--ease),transform .2s var(--ease),box-shadow .2s var(--ease)}.project:hover{background:var(--surface-2);border-color:var(--line-strong);transform:translateY(-1px)}.project.active{background:linear-gradient(135deg,rgba(139,107,255,.16),rgba(255,95,184,.1));border-color:rgba(167,139,255,.5);box-shadow:0 8px 26px rgba(139,107,255,.18);transform:translateY(-1px)}.project-pills{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}.project-pills .pill{font-size:11px;padding:3px 8px}.project-pills .pill.ok{color:#86efac;border-color:rgba(34,197,94,.35)}
details#createProjectDetails>div{overflow:hidden;animation:detailsIn .3s var(--ease)}@keyframes detailsIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
.step-card{display:flex;align-items:center;justify-content:center;text-align:center;min-height:76px;border-radius:18px;padding:14px!important}.journey{display:flex;flex-wrap:wrap;gap:10px}.journey-step{flex:1 1 170px;justify-content:flex-start;align-items:center;gap:12px;padding:14px 16px!important;border-radius:16px;background:var(--surface);border:1px solid var(--line);color:var(--soft);text-align:left}.journey-step:hover{background:var(--surface-2);border-color:var(--line-strong);transform:translateY(-2px)}.journey-step.action-primary{background:var(--accent-gradient);background-size:160% 160%;border-color:transparent;color:#fff}.journey-num{width:26px;height:26px;flex:0 0 auto;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;background:var(--surface-3);color:var(--text);border:1px solid var(--line-strong)}.journey-step.action-primary .journey-num{background:rgba(255,255,255,.24);border-color:rgba(255,255,255,.3);color:#fff}.journey-label{font-size:13px;font-weight:700}.reference-panel{margin-top:16px;border:1px solid var(--line);border-radius:22px;padding:16px;background:rgba(255,255,255,.022)}.reference-toolbar{display:grid;grid-template-columns:1.15fr 1.5fr .55fr;gap:12px;align-items:end}.reference-meta{display:flex;flex-wrap:wrap;gap:6px}.reference-gallery{margin-top:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.brand-xray-grid{grid-template-columns:repeat(2,minmax(320px,1fr));gap:16px;align-items:stretch}.brand-xray-intro{grid-column:1/-1;border:1px solid var(--line);border-radius:18px;background:rgba(113,112,255,.08);padding:14px 16px;color:var(--soft);line-height:1.65}.reference-card{overflow:hidden;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.03);transition:border-color .25s var(--ease),transform .25s var(--ease),box-shadow .25s var(--ease)}.reference-card:hover{border-color:var(--line-strong);transform:translateY(-3px);box-shadow:0 16px 34px rgba(0,0,0,.35)}.reference-card:hover .reference-thumb img{transform:scale(1.06)}.brand-xray-card{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025));border-color:var(--line-strong);position:relative}.brand-xray-card::before{content:'';position:absolute;top:0;left:18px;right:18px;height:2px;background:var(--accent-gradient);border-radius:0 0 4px 4px}.brand-xray-card .reference-body{padding:18px}.brand-xray-card .reference-name{font-size:17px;margin-bottom:10px}.brand-xray-card textarea{min-height:220px;overflow:hidden;resize:none;background:rgba(0,0,0,.18);line-height:1.7;font-size:14px;padding:13px 14px}.brand-xray-source-note{margin:10px 0 0;color:var(--muted);font-size:12px;line-height:1.5}.reference-thumb{height:150px;background:#09090b;display:grid;place-items:center;color:var(--muted);border-bottom:1px solid var(--line);overflow:hidden}.reference-thumb img{width:100%;height:100%;object-fit:cover;transition:transform .4s var(--ease)}.reference-body{padding:14px}.reference-name{font-weight:800;margin-bottom:8px}.reference-note{color:var(--muted);font-size:13px;line-height:1.55;margin-top:8px}.format-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}.format-card{border:1px solid var(--line);background:rgba(255,255,255,.028);border-radius:20px;padding:15px;transition:border-color .25s var(--ease),background .25s var(--ease)}.format-card:has(input:checked){border-color:rgba(139,107,255,.4);background:rgba(139,107,255,.06)}.format-card>label:first-child{display:flex;align-items:center;gap:9px;margin-top:0;font-size:15px;color:var(--text)}.content-toolbar{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:14px}.days{display:grid;gap:14px}.content-card{display:grid;grid-template-columns:minmax(220px,320px) minmax(0,1fr);gap:18px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.026);padding:14px;transition:border-color .25s var(--ease),box-shadow .25s var(--ease)}.content-card:hover{border-color:var(--line-strong);box-shadow:0 16px 34px rgba(0,0,0,.3)}.content-card:hover .content-preview img{transform:scale(1.04)}.content-preview{position:relative;overflow:hidden;border-radius:18px;background:#050506;display:grid;place-items:center;color:var(--muted);border:1px solid var(--line);min-height:300px}.content-preview img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s var(--ease)}.content-preview.channel-instagram_story,.content-preview.channel-instagram_reels{aspect-ratio:9/16;max-height:620px}.content-preview.channel-instagram_feed{aspect-ratio:4/5}.content-preview.empty{padding:20px;text-align:center}.generating-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;background:rgba(5,5,8,.72);backdrop-filter:blur(2px);color:#fff;font-weight:700;font-size:13px;text-align:center;padding:16px}.content-meta{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0 12px}.caption-box,.prompt-box{white-space:pre-wrap;background:rgba(0,0,0,.24);border:1px solid var(--line);border-radius:16px;padding:13px;color:var(--soft);line-height:1.62}.prompt-box{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#cbd5e1;max-height:420px;overflow:auto}details summary{cursor:pointer;color:var(--soft);font-weight:750;margin:10px 0 8px}.sidebar-summary{display:flex;justify-content:space-between;align-items:center;font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--text);margin:0 0 4px;list-style:revert}#createProjectDetails[open] .sidebar-summary{margin-bottom:2px}.card-actions{display:flex;justify-content:flex-end;margin-top:10px}button.card-delete{min-height:32px;padding:0 10px;font-size:12px;font-weight:650;background:transparent;border-color:transparent;color:var(--muted);box-shadow:none}button.card-delete:hover{color:#fecaca;border-color:rgba(239,68,68,.34);background:rgba(239,68,68,.1)}
@media(max-width:1180px){.wrap.design-shell{grid-template-columns:1fr}.sidebar{position:static;max-height:none}.section-nav{position:static;max-height:none;flex-direction:row;overflow-x:auto;flex-wrap:nowrap;margin-bottom:16px}.section-nav .tab-button{width:auto}.hero{align-items:flex-start}.hero-metrics{min-width:0}.format-grid{grid-template-columns:1fr}.mini-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:980px){.brand-xray-grid{grid-template-columns:1fr}}@media(max-width:760px){header{padding:18px}.hero,.selected-card,.content-toolbar{display:grid}.hero-metrics{grid-template-columns:1fr 1fr}.wrap.design-shell{padding:14px}.grid,.row,.reference-toolbar,.content-card{grid-template-columns:1fr}.mini-grid{grid-template-columns:1fr}.tab-panel{padding:16px}.quick-actions{justify-content:stretch}.quick-actions button{width:100%}}
```

- [ ] **Step 2: Run the build to verify the CSS alone doesn't break anything**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean (existing pages will look visually broken/unstyled until
Steps 3-5 land — that's expected mid-task, this build check is only
confirming no syntax/type errors, not final appearance).

- [ ] **Step 3: Create `src/components/AppShell.tsx`**

Create `cloud-panel-app/src/components/AppShell.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

interface Project {
  id: string;
  name: string;
  slug: string;
}

const PROJECT_TABS: Array<[string, string]> = [
  ["visao-geral", "Visão geral"],
  ["empresa", "Empresa / Raio-X"],
  ["referencias", "Referências e imagem"],
  ["ofertas", "Ofertas e assuntos"],
  ["aprovacao", "Conteúdos gerados"],
  ["calendario", "Calendário"],
  ["aprendizado", "Aprendizado"],
];

const GLOBAL_TABS: Array<[string, string]> = [
  ["/aprendizado/tipos-de-oferta", "Tipos de Oferta"],
  ["/aprendizado/templates", "Templates de Segmento"],
  ["/conta", "Conta e token"],
];

export function AppShell() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    supabase
      .from("projects")
      .select("id, name, slug")
      .order("name")
      .then(({ data }) => setProjects(data || []));
  }, []);

  const selected = projects.find((p) => p.id === projectId);

  return (
    <>
      <header>
        <div className="hero">
          <div className="hero-brand">
            <div className="hero-mark" aria-hidden="true">C</div>
            <div>
              <p className="panel-kicker">Painel nuvem · Opensquad</p>
              <h1>Central de Conteúdo Opensquad</h1>
              <p className="sub">Acompanhe e aprove conteúdo de qualquer lugar — os mesmos dados do painel local.</p>
            </div>
          </div>
          <div className="hero-metrics">
            <div className="metric"><b>{projects.length}</b><span>projetos</span></div>
            <div className="metric"><b>{selected ? selected.name : "--"}</b><span>selecionado</span></div>
            <div className="metric"><b>Nuvem</b><span>sincronizado com o Supabase</span></div>
          </div>
        </div>
      </header>
      <main className="wrap design-shell">
        <aside className="card sidebar">
          <div className="section-title"><h2>Projetos</h2><span className="pill">{projects.length}</span></div>
          <div className="projects">
            {projects.map((project) => (
              <Link
                key={project.id}
                to={`/projects/${project.id}/visao-geral`}
                className={`project${project.id === projectId ? " active" : ""}`}
                style={{ display: "block", textDecoration: "none", color: "inherit" }}
              >
                <strong>{project.name}</strong>
              </Link>
            ))}
            {projects.length === 0 ? <p className="muted">Nenhum projeto ainda.</p> : null}
          </div>
        </aside>
        <nav className="card section-nav" aria-label="Seções do painel">
          {(projectId ? PROJECT_TABS : GLOBAL_TABS).map(([target, label]) => {
            const to = projectId ? `/projects/${projectId}/${target}` : target;
            const active = location.pathname === to;
            return (
              <Link key={to} to={to} className={`tab-button${active ? " active" : ""}`}>
                {label}
              </Link>
            );
          })}
        </nav>
        <section className="workspace-main">
          <Outlet />
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 4: Create `src/pages/Overview.tsx`**

Create `cloud-panel-app/src/pages/Overview.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

interface Stats {
  total: number;
  draft: number;
  approved: number;
}

interface ChecklistItem {
  label: string;
  done: boolean;
}

export function Overview() {
  const { projectId } = useParams<{ projectId: string }>();
  const [stats, setStats] = useState<Stats | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [itemsResult, projectResult] = await Promise.all([
        supabase.from("content_items").select("status").eq("project_id", projectId),
        supabase.from("projects").select("company_profile, content_strategy, brand_profile").eq("id", projectId).single(),
      ]);
      if (itemsResult.error) {
        setError(itemsResult.error.message);
        return;
      }
      if (projectResult.error) {
        setError(projectResult.error.message);
        return;
      }
      const rows = itemsResult.data || [];
      setStats({
        total: rows.length,
        draft: rows.filter((r) => r.status === "draft").length,
        approved: rows.filter((r) => r.status === "approved").length,
      });
      const profile = (projectResult.data.company_profile || {}) as Record<string, unknown>;
      const strategy = (projectResult.data.content_strategy || {}) as { offers?: unknown[] };
      const brand = (projectResult.data.brand_profile || {}) as { references?: unknown[] };
      setChecklist([
        { label: "Perfil da empresa preenchido", done: Boolean(profile.segment || profile.description) },
        { label: "Pelo menos 1 oferta cadastrada", done: Array.isArray(strategy.offers) && strategy.offers.length > 0 },
        { label: "Pelo menos 1 referência enviada", done: Array.isArray(brand.references) && brand.references.length > 0 },
      ]);
    }
    load();
  }, [projectId]);

  if (error) return <div className="card">Erro: {error}</div>;
  if (!stats || !checklist) return <div className="card">Carregando...</div>;

  return (
    <section className="card tab-panel active">
      <div className="section-title"><h2>Visão geral</h2><span className="step">comece aqui</span></div>
      <div className="stat-grid">
        <div className="stat-card"><b>{stats.total}</b><span>conteúdos</span></div>
        <div className="stat-card"><b>{stats.draft}</b><span>aguardando aprovação</span></div>
        <div className="stat-card"><b>{stats.approved}</b><span>aprovados</span></div>
      </div>
      <h3 className="section-heading">Checklist do projeto</h3>
      <div className="checklist">
        {checklist.map((item) => (
          <div key={item.label} className={`checklist-item${item.done ? " done" : ""}`}>
            <span className="check-icon">{item.done ? "✓" : "•"}</span>
            <div className="check-label">
              <div className="check-title">{item.label}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Rewrite `App.tsx` as nested routes under `AppShell`**

Replace the full content of `cloud-panel-app/src/App.tsx` with:

```tsx
import { Routes, Route } from "react-router-dom";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Overview } from "@/pages/Overview";
import { Approval } from "@/pages/Approval";
import { CalendarPage } from "@/pages/Calendar";
import { Company } from "@/pages/Company";
import { OffersAndPillars } from "@/pages/OffersAndPillars";
import { References } from "@/pages/References";
import { SegmentLearning } from "@/pages/SegmentLearning";
import { OfferTypeLearning } from "@/pages/OfferTypeLearning";
import { SegmentTemplates } from "@/pages/SegmentTemplates";
import { Account } from "@/pages/Account";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/conta" element={<Account />} />
        <Route path="/projects/:projectId/visao-geral" element={<Overview />} />
        <Route path="/projects/:projectId/aprovacao" element={<Approval />} />
        <Route path="/projects/:projectId/calendario" element={<CalendarPage />} />
        <Route path="/projects/:projectId/empresa" element={<Company />} />
        <Route path="/projects/:projectId/ofertas" element={<OffersAndPillars />} />
        <Route path="/projects/:projectId/referencias" element={<References />} />
        <Route path="/projects/:projectId/aprendizado" element={<SegmentLearning />} />
        <Route path="/aprendizado/tipos-de-oferta" element={<OfferTypeLearning />} />
        <Route path="/aprendizado/templates" element={<SegmentTemplates />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 6: Simplify `Dashboard.tsx`**

Replace the full content of `cloud-panel-app/src/pages/Dashboard.tsx`
with (the project list moved into `AppShell`'s sidebar, so this page is
now just the "/" landing card):

```tsx
export function Dashboard() {
  return (
    <div className="card selected-card">
      <div>
        <div className="section-title">
          <h2>Bem-vindo</h2>
          <span className="step">início</span>
        </div>
        <p className="muted">
          Selecione um projeto na barra lateral para ver detalhes, ou acesse Tipos de Oferta / Templates de
          Segmento no menu de seções.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Build and manually sanity-check**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, same test count as before (no test files touched this task).

- [ ] **Step 8: Commit**

```bash
git add cloud-panel-app/src/styles/global.css cloud-panel-app/src/components/AppShell.tsx cloud-panel-app/src/pages/Overview.tsx cloud-panel-app/src/App.tsx cloud-panel-app/src/pages/Dashboard.tsx
git commit -m "feat(cloud-panel): adopt local dashboard's exact CSS and 3-column shell"
```

---

### Task 2: Restyle Company, Account, Login

**Files:**
- Modify: `cloud-panel-app/src/pages/Company.tsx`
- Modify: `cloud-panel-app/src/pages/Account.tsx`
- Modify: `cloud-panel-app/src/pages/Login.tsx`

**Interfaces:** Consumes `AppShell` (Task 1, already merged by the time
this task starts) implicitly — these pages now render inside
`.workspace-main`, so their own outer wrapper must NOT repeat
header/sidebar/nav, and must NOT constrain width with `maxWidth`/`margin:
"... auto"` (Login is the one exception — it renders outside `AppShell`,
keep its centered-card layout as-is).

- [ ] **Step 1: `Company.tsx` — drop the width constraint, convert the title, fix the stray var names**

In `cloud-panel-app/src/pages/Company.tsx`, change:

```tsx
        <span style={{ color: "var(--text-dim)" }}>{doc.status}</span>
```

to:

```tsx
        <span style={{ color: "var(--muted)" }}>{doc.status}</span>
```

Change:

```tsx
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Empresa</h1>
```

to:

```tsx
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="section-title">
        <h2>Empresa</h2>
        <span className="step">coleta rápida</span>
      </div>
```

Change:

```tsx
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
```

to:

```tsx
            style={{ width: "100%" }}
```

(the border/padding/radius now come from the shared `select`/`input`
rule in `global.css` — the inline override is no longer needed.)

- [ ] **Step 2: `Account.tsx` — same treatment**

In `cloud-panel-app/src/pages/Account.tsx`, change:

```tsx
    <div style={{ maxWidth: 480, margin: "40px auto" }} className="card">
      <h1>Autenticação em duas etapas</h1>
```

to:

```tsx
    <div className="card">
      <div className="section-title">
        <h2>Autenticação em duas etapas</h2>
        <span className="step">segurança</span>
      </div>
```

Change:

```tsx
            <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
```

to:

```tsx
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
```

Change:

```tsx
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
```

to:

```tsx
      {error ? <p style={{ color: "var(--bad)" }}>{error}</p> : null}
```

- [ ] **Step 3: `Login.tsx` — fix the 2 stray var names only**

Login renders outside `AppShell` (unauthenticated), so its centered-card
layout (`maxWidth`, `margin`) stays exactly as-is — only the color var
names need fixing since they no longer exist in the new stylesheet.

In `cloud-panel-app/src/pages/Login.tsx`, change both occurrences of:

```tsx
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
```

to:

```tsx
        {error ? <p style={{ color: "var(--bad)" }}>{error}</p> : null}
```

(there are 2 identical lines — one inside the MFA-step form, one inside
the credentials-step form — fix both.)

- [ ] **Step 4: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, same test count as before this task.

- [ ] **Step 5: Commit**

```bash
git add cloud-panel-app/src/pages/Company.tsx cloud-panel-app/src/pages/Account.tsx cloud-panel-app/src/pages/Login.tsx
git commit -m "feat(cloud-panel): restyle Company, Account, Login to match local dashboard"
```

---

### Task 3: Restyle References, OffersAndPillars

**Files:**
- Modify: `cloud-panel-app/src/pages/References.tsx`
- Modify: `cloud-panel-app/src/pages/OffersAndPillars.tsx`

**Interfaces:** Same as Task 2 — no `AppShell` props, just markup fixes.

- [ ] **Step 1: `References.tsx`**

In `cloud-panel-app/src/pages/References.tsx`, change:

```tsx
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Referências</h1>
```

to:

```tsx
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="section-title">
        <h2>Referências</h2>
        <span className="step">identidade visual</span>
      </div>
```

Search the rest of the file for any other `var(--text-dim)`,
`var(--danger)`, or `var(--border)` occurrence and apply the same mapping
as Task 1's Global Constraints (`--text-dim`→`--muted`,
`--danger`→`--bad`, `--border`→`--line`) — the enumeration in this plan's
Global Constraints section is exhaustive for the files listed in Task 2,
but re-check this file with a search before moving on, since the exact
current line numbers may have shifted since this plan was written.

- [ ] **Step 2: `OffersAndPillars.tsx`**

In `cloud-panel-app/src/pages/OffersAndPillars.tsx`, change:

```tsx
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Ofertas e Pilares</h1>
```

to:

```tsx
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="section-title">
        <h2>Ofertas e Pilares</h2>
        <span className="step">assuntos</span>
      </div>
```

Search the rest of the file for `var(--text-dim)`/`var(--danger)`/
`var(--border)` and apply the same mapping if any are found (none were
found in this file as of this plan's writing, but confirm).

- [ ] **Step 3: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, same test count as before this task.

- [ ] **Step 4: Commit**

```bash
git add cloud-panel-app/src/pages/References.tsx cloud-panel-app/src/pages/OffersAndPillars.tsx
git commit -m "feat(cloud-panel): restyle References, OffersAndPillars to match local dashboard"
```

---

### Task 4: Restyle Approval, Calendar

**Files:**
- Modify: `cloud-panel-app/src/pages/Approval.tsx`
- Modify: `cloud-panel-app/src/pages/Calendar.tsx`

- [ ] **Step 1: `Approval.tsx`**

In `cloud-panel-app/src/pages/Approval.tsx`, change:

```tsx
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Aprovação</h1>
```

to:

```tsx
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="section-title">
        <h2>Conteúdos gerados</h2>
        <span className="step">revisão</span>
      </div>
```

(title text changes from "Aprovação" to "Conteúdos gerados" to match the
section-nav label from `AppShell` — same page, same logic, just the
on-page heading now matches what the nav calls it, like local does.)

- [ ] **Step 2: `Calendar.tsx`**

In `cloud-panel-app/src/pages/Calendar.tsx`, change:

```tsx
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Calendário</h1>
```

to:

```tsx
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="section-title">
        <h2>Calendário</h2>
        <span className="step">agenda</span>
      </div>
```

Change:

```tsx
                  <span style={{ color: "var(--text-dim)" }}>{row.run_at.slice(11, 16)}</span>
```

to:

```tsx
                  <span style={{ color: "var(--muted)" }}>{row.run_at.slice(11, 16)}</span>
```

- [ ] **Step 3: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, same test count as before this task.

- [ ] **Step 4: Commit**

```bash
git add cloud-panel-app/src/pages/Approval.tsx cloud-panel-app/src/pages/Calendar.tsx
git commit -m "feat(cloud-panel): restyle Approval, Calendar to match local dashboard"
```

---

### Task 5: Restyle SegmentLearning, OfferTypeLearning, SegmentTemplates

**Files:**
- Modify: `cloud-panel-app/src/pages/SegmentLearning.tsx`
- Modify: `cloud-panel-app/src/pages/OfferTypeLearning.tsx`
- Modify: `cloud-panel-app/src/pages/SegmentTemplates.tsx`

- [ ] **Step 1: `SegmentLearning.tsx`**

In `cloud-panel-app/src/pages/SegmentLearning.tsx`, change:

```tsx
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Aprendizado do Segmento</h1>
```

to:

```tsx
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="section-title">
        <h2>Aprendizado do Segmento</h2>
        <span className="step">aprendizado</span>
      </div>
```

- [ ] **Step 2: `OfferTypeLearning.tsx`**

In `cloud-panel-app/src/pages/OfferTypeLearning.tsx`, change:

```tsx
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Aprendizado por Tipo de Oferta</h1>
```

to:

```tsx
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="section-title">
        <h2>Aprendizado por Tipo de Oferta</h2>
        <span className="step">global</span>
      </div>
```

- [ ] **Step 3: `SegmentTemplates.tsx`**

In `cloud-panel-app/src/pages/SegmentTemplates.tsx`, change:

```tsx
    <div style={{ maxWidth: 720, margin: "40px auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Templates de Segmento</h1>
      <p style={{ color: "var(--text-dim)" }}>Somente leitura — criar/editar template continua via script local.</p>
```

to:

```tsx
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="section-title">
        <h2>Templates de Segmento</h2>
        <span className="step">somente leitura</span>
      </div>
      <p style={{ color: "var(--muted)" }}>Criar/editar template continua via script local.</p>
```

- [ ] **Step 4: Build and verify**

Run (from `cloud-panel-app/`): `npm run build`
Expected: clean.

Run: `npx vitest run`
Expected: PASS, same test count as before this task.

- [ ] **Step 5: Commit**

```bash
git add cloud-panel-app/src/pages/SegmentLearning.tsx cloud-panel-app/src/pages/OfferTypeLearning.tsx cloud-panel-app/src/pages/SegmentTemplates.tsx
git commit -m "feat(cloud-panel): restyle SegmentLearning, OfferTypeLearning, SegmentTemplates to match local dashboard"
```

---

## Post-plan (controller, not a subagent task)

After all 5 tasks land and the final review is clean:

1. Deploy `cloud-panel-app` to Vercel (`npx vercel --yes --prod`).
2. Open the deployed URL side-by-side with the local dashboard
   (`http://localhost:<port>` wherever `content-central-server.js` is
   running) and manually confirm: same colors/cards/buttons, same 3-column
   layout, same section-nav labels lining up with local's tab labels
   where they correspond, project sidebar behaves like local's project
   list (click to select, active project highlighted).
3. Report to the user any place the comparison reveals a real visual gap
   the plan didn't anticipate — this phase's whole point is exact parity,
   so a spotted mismatch is worth a fast follow-up fix, not a "close
   enough."
