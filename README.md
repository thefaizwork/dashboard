# API Scout Dashboard

Next.js dashboard for sending a website URL to a backend API scanner and reviewing the returned endpoints. Endpoints reported under `Seen but undocumented` are marked as **Shadow API**.

## Run locally

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:4173>.

## Backend response

The dashboard accepts an endpoint array under `endpoints`, `results`, `items`, or `data`. It also reads shadow endpoints from `seen_but_undocumented` (or `shadow_apis`) as strings such as `GET /api/v1/products/search`. Coverage and documented-and-seen counts are displayed when returned by the backend.

The scanner endpoint receives `POST { "url": "https://site-to-scan.example" }` by default, or a `GET` request with `?url=` when selected. An optional bearer token can be supplied in the form.
