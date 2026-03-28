import { cosineSimilarity } from '../db/index.js';

export interface Cluster {
  centroid: Float32Array;
  entryIds: number[];
  label?: string;
}

export function kmeans(
  embeddings: Map<number, Float32Array>,
  k: number,
  maxIterations: number = 20
): Cluster[] {
  const ids = Array.from(embeddings.keys());
  const vecs = Array.from(embeddings.values());
  if (ids.length === 0 || k <= 0) return [];
  if (ids.length <= k) {
    return ids.map((id, i) => ({
      centroid: vecs[i],
      entryIds: [id],
    }));
  }

  // Initialize centroids randomly
  let centroids = vecs.slice(0, k).map((v) => new Float32Array(v));
  let clusters: Cluster[] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    clusters = centroids.map((c) => ({ centroid: c, entryIds: [] }));

    // Assign each vector to the nearest centroid
    for (let i = 0; i < ids.length; i++) {
      const vec = vecs[i];
      let bestSim = -1;
      let bestIdx = 0;

      for (let j = 0; j < k; j++) {
        const sim = cosineSimilarity(vec, centroids[j]);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = j;
        }
      }
      clusters[bestIdx].entryIds.push(ids[i]);
    }

    // Recompute centroids
    const nextCentroids = clusters.map((cluster) => {
      if (cluster.entryIds.length === 0) return cluster.centroid;
      const first = embeddings.get(cluster.entryIds[0])!;
      const sum = new Float32Array(first.length);
      for (const id of cluster.entryIds) {
        const v = embeddings.get(id)!;
        for (let i = 0; i < v.length; i++) {
          sum[i] += v[i];
        }
      }
      for (let i = 0; i < sum.length; i++) {
        sum[i] /= cluster.entryIds.length;
      }
      return sum;
    });

    // Check for convergence
    let changed = false;
    for (let i = 0; i < k; i++) {
      if (cosineSimilarity(centroids[i], nextCentroids[i]) < 0.9999) {
        changed = true;
        break;
      }
    }

    centroids = nextCentroids;
    if (!changed) break;
  }

  return clusters;
}
