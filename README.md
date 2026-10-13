# Wialon Geofence Bulk Importer (web)

A hostable version of `../import.js`. Upload a CSV, paste a Wialon API token and
resource ID, and bulk-create circular geofences — all from the browser.

Nothing is persisted: the token and parsed CSV rows are sent once, in a single
request, to this app's `/api/import` serverless route, which forwards them
directly to Wialon's API and streams back progress. No database, no file writes,
no logging of the token or zone data. Refreshing the page clears everything.

(A serverless proxy is required because Wialon's API does not send CORS headers,
so the browser cannot call it directly from a page hosted on another domain.)

## CSV format

Same as the CLI script:

```
name,latitude,longitude,radius
Warehouse A,60.1699,24.9384,100
Depot North,60.2055,24.6559
```

`radius` is optional per-row; the "Default radius" advanced option is used when omitted.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

```bash
npm install -g vercel   # if you don't already have it
vercel
```

Or import this `webapp/` folder as the project root in the Vercel dashboard
(New Project → set "Root Directory" to `webapp` if deploying from the repo root).
No environment variables are required.

## Notes

- Large imports: the import route is capped at 60s execution (`maxDuration`) and
  5000 zones per request. For bigger datasets, split the CSV into smaller files,
  or self-host where you can raise the function timeout.
- The token is only as powerful as the Wialon user account it belongs to — the
  account must have "manage geozones" rights on the target resource.
