# Wialon Geofence Manager (web)

A hostable version of `../import.js`, plus a viewer/exporter. Sign in with your
Wialon account, pick a resource from a dropdown, and either bulk-create circular
geofences from a CSV or view and export the existing ones to Excel — all from
the browser, in one interface.

Signing in opens Wialon's own login page in a popup (`login.html`); your
credentials go directly to Wialon, never to this app. The app only receives a
short-lived session token back, which is sent once per action to this app's
serverless routes, forwarded directly to Wialon's API, and never written to
disk, a database, or logs. Refreshing the page clears everything.

(A serverless proxy is required because Wialon's API does not send CORS headers,
so the browser cannot call it directly from a page hosted on another domain.)

## CSV format (import)

Same as the CLI script:

```
name,latitude,longitude,radius
Warehouse A,60.1699,24.9384,100
Depot North,60.2055,24.6559
```

`radius` is optional per-row; the "Default radius" advanced option is used when omitted.
A sample file is served at `/sample.csv`.

## Viewing / exporting geofences

The "View & export" tab fetches all geofences on the selected resource
(`resource/get_zone_data`) and lists their name, latitude, longitude, and
radius. "Download as Excel" builds a real `.xlsx` file client-side (via
SheetJS) from that table — nothing is generated or stored server-side.

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
- The signed-in session is only as powerful as the Wialon user account it
  belongs to — the account must have "manage geozones" rights on the target
  resource to import, and "view zones" rights to list/export them.
- The `xlsx` dependency is installed from SheetJS's own CDN
  (`cdn.sheetjs.com`) rather than the npm registry, since the npm-published
  build has known unpatched vulnerabilities; see `package.json`.
