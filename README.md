# Repro — Visual Bug Investigator

A Tavus CVI interview demo that turns a customer's screen-shared bug into a structured engineering handoff. A PAL asks follow-up questions, observes the shared dashboard, and saves findings beside the call through one application tool.

## Try the demo

Use a desktop browser with camera, microphone and screen-sharing permissions. The app contains a fictional Northstar reporting dashboard and a deliberately seeded export failure.

1. Start an investigation and open the dashboard in its separate window. **Share only the dashboard with the PAL**, so it cannot read its own report as evidence.
2. Say: “I can't export my weekly report for All locations. I need it for a Tuesday meeting.”
3. Export **All locations** for **2–8 November 2026**, then **26 October–1 November 2026**. Both display `EXPORT_FAILED · Unable to generate report`.
4. Compare **Camden for 2–8 November 2026**: the CSV download succeeds. Individual locations are intentionally successful in this sandbox.
5. Correct the deadline: “Actually, the meeting is Wednesday.” Ask the PAL to prepare the final report for review.
6. Check the report and source labels, edit a PAL evidence item if needed, ask for another final review after edits, and copy the report.

“Ready for review” means required content is present; a person still checks accuracy, corrected facts and tested scope. Do not generalise two tested date ranges into a claim about every possible period.

## Run locally

Requires Python 3 and a current Node.js version. There are no npm dependencies to install.

```sh
git clone https://github.com/inalbant/tavus-demo.git
cd tavus-demo
npm run dev
```

Open **http://localhost:4173**. Use the HTTP-served application for calls, rather than opening an HTML file directly.

```sh
npm test
python3 build-preview.py
```

The preview command creates a self-contained visual preview. The served app is required for the live demonstration. Stop old development servers and refresh the browser when switching versions.

## Deploy to Netlify

Import this repository into Netlify using the `main` branch. Leave the build command empty; the publish directory is **`dist`**, declared in `netlify.toml`. This is a static application and needs no host-side API key or environment variables for the existing hosted Tavus embed.

Before testing calls, add the exact HTTPS origin assigned by Netlify to the Tavus embed deployment's **allowed origins**, alongside `http://localhost:4173`. A custom domain or a changed Netlify site name needs its own matching origin. The page loading successfully does not establish that calls can connect.

For an independent deployment, configure your own Tavus PAL and application tool using the snapshots in `tavus/`, create an embed deployment, and set its ID in `dist/config.js`. A deployment ID is public configuration, not an API key. Snapshots describe the configuration recorded on 15 November 2026; live account settings may change separately.

## How it works

| Part | Responsibility |
| --- | --- |
| Tavus hosted embed | Live voice/video conversation and shared-screen perception |
| `update_bug_report` | Delivers structured findings to the browser through app messages |
| `dist/report.js` | Payload validation, merging, provenance, manual edit protection and Markdown export |
| `dist/app.js` | Call integration, report UI, sandbox exports and cross-window events |
| `tests/` | Report-model tests and actual app integration against DOM/transport doubles |
| `tavus/` | PAL prompt/settings, tool schema and deployment configuration snapshots |

Three evidence sources stay distinct: **customer reports**, **screen observations**, and **app-confirmed sandbox events**. Hypotheses are explicitly labelled. The browser records export outcomes independently and does not pass that telemetry to the PAL in tool results or initial context. These events are a demonstration cross-check, not authenticated production telemetry.

Draft tool calls save partial findings. Final review requires eight report fields (`title`, `steps`, `expected`, `actual`, `error_text`, `impact`, `open_questions`, `evidence`) plus `mode: final_review`. Invalid final updates are rejected atomically. The PAL cannot assert app-confirmed provenance.

Manual field edits take priority until a new investigation. Editing/removing PAL evidence protects the whole PAL evidence list until **Allow AI evidence updates** is selected. App-confirmed events remain read-only. Edits and new findings return the report to draft.

## Scope and verification

The MVP is intentionally one PAL, one application tool and one seeded bug. There is no ticket submission, automatic diagnosis, authentication or report backend. Drafts are held in browser memory and disappear on reload. Conversation context and manually edited report content can be sent to Tavus; browser-local report state does not imply that the conversation is processed only locally.

The 20 automated tests cover validation, correction replacement, evidence protection, review completeness, stale/reset isolation, duplicate calls, export timing, compact replies, transport errors and clipboard fallback. They do not replace real media/browser acceptance testing.

Local user-run acceptance on 15 November verified a populated final report and a Wednesday deadline correction. The evidence editor has automated coverage; a successful manual edit was not separately confirmed. Hosted call acceptance is still required after deployment and origin configuration.

Known limitation: a historical failed call showed the PAL claiming success after the host rejected a save. Current guidance requires host confirmation, but the later successful flow does not prove that failure path resolved. Check the visible report rather than relying only on spoken acknowledgements.

The shared embed is capped at 10 minutes per call, 20 calls per day and one concurrent call (last checked 17 November 2026). If it is busy or unavailable, retry later or contact the project owner; limits are not removed by hosting the frontend elsewhere.
