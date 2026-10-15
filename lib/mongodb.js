import { MongoClient } from "mongodb";

const mongoGlobal = globalThis;

export async function getMetricsCollection() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured.");

  const databaseName = process.env.MONGODB_DATABASE || "atelier_commerce";
  const cacheKey = `${uri}|${databaseName}`;
  if (mongoGlobal.apiScoutMongoCacheKey !== cacheKey || !mongoGlobal.apiScoutMongoClientPromise) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    mongoGlobal.apiScoutMongoCacheKey = cacheKey;
    mongoGlobal.apiScoutMongoClientPromise = client.connect();
  }

  const client = await mongoGlobal.apiScoutMongoClientPromise;
  const database = client.db(databaseName);
  const collectionName = process.env.MONGODB_METRICS_COLLECTION || "api_endpoint_stats";
  return database.collection(collectionName);
}
