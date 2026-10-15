import { getMetricsCollection } from "../../../lib/mongodb.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function metricNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countUniqueCallers(value) {
  let callers = value;
  if (typeof callers === "string") {
    try {
      callers = JSON.parse(callers);
    } catch {
      callers = callers.trim() ? [callers.trim()] : [];
    }
  }
  if (Array.isArray(callers)) return new Set(callers.map(String)).size;
  if (typeof callers === "number" && Number.isFinite(callers)) return Math.max(0, Math.floor(callers));
  return 0;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint")?.trim();
  const method = searchParams.get("method")?.trim().toUpperCase();

  if (!endpoint || !method) {
    return Response.json(
      { detail: "Provide both endpoint and method query parameters." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const collection = await getMetricsCollection();
    const record = await collection.findOne(
      { endpoint, method },
      { projection: { _id: 0, endpoint: 1, method: 1, rpm: 1, avg_payload_bytes: 1, unique_callers: 1, total_calls: 1, last_updated: 1 } },
    );

    if (!record) {
      return Response.json(
        { found: false, endpoint, method },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const updatedAt = record.last_updated instanceof Date
      ? record.last_updated.toISOString()
      : record.last_updated == null ? null : String(record.last_updated);

    return Response.json(
      {
        found: true,
        endpoint: record.endpoint,
        method: record.method,
        rpm: metricNumber(record.rpm),
        avg_payload_bytes: metricNumber(record.avg_payload_bytes),
        unique_callers_count: countUniqueCallers(record.unique_callers),
        total_calls: metricNumber(record.total_calls),
        last_updated: updatedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const missingUri = error?.message === "MONGODB_URI is not configured.";
    return Response.json(
      { detail: missingUri ? error.message : "MongoDB is unreachable. Check the connection URI, access list, and credentials." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
