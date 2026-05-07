# Backlog: Cloudflare R2 and Cached Media Delivery

Date: 2026-05-06

## Summary

Wingman Tower currently uses S3-compatible object storage for shared images,
audio notes, avatars, and document-like blobs. Moving the storage backend to
Cloudflare R2 looks financially safe at the current usage profile, but the main
product benefit requires changing the media delivery path so normal reads do
not stream through Tower.

R2 solves storage egress cost. Cloudflare Cache, via an R2 custom domain or a
Worker-backed delivery layer, solves global loading performance.

## Current Tower Usage

Measured from the running local Tower database using completed rows in
`v4_storage_objects`.

- Completed objects: 115
- Stored object bytes: 71,785,119 bytes, about 68 MiB
- Observed period: 2026-03-21 to 2026-05-06, about 46.2 days
- 30-day run rate: about 75 uploads/month, 46.6 MB/month
- Completed objects are currently private.

Object mix:

| Kind | Objects | Bytes | Average size |
| --- | ---: | ---: | ---: |
| Images | 103 | 68.9 MB | 669 KB |
| Audio | 6 | 1.9 MB | 315 KB |
| Other | 6 | 980 KB | 163 KB |

## R2 Pricing Inputs

Cloudflare R2 Standard pricing checked on 2026-05-06:

- Free tier: 10 GB-month storage/month
- Free tier: 1,000,000 Class A operations/month
- Free tier: 10,000,000 Class B operations/month
- Additional storage: $0.015 per GB-month
- Additional Class A operations: $4.50 per 1,000,000 operations
- Additional Class B operations: $0.36 per 1,000,000 operations
- Egress from R2: free

Use R2 Standard for Wingman media. R2 Infrequent Access is not a good fit for
chat images/audio because reads are normal product behavior and retrieval fees
would complicate the model.

## Cost Model

One active profile-month is based on current observed usage:

- About 75 uploads/month
- About 46.6 MB/month added storage
- Assumed reads: each object viewed 10 times as a cache miss
- Current Tower read behavior is approximately one completion `HeadObject`,
  then `HeadObject + GetObject` per content read.

Estimated monthly R2 Standard cost:

| Active profile-months | Storage added | Class A ops | Class B ops | Est. R2 cost |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 0.05 GB | 75 | 1,569 | $0.00 |
| 100 | 4.66 GB | 7,470 | 156,870 | $0.00 |
| 250 | 11.66 GB | 18,675 | 392,175 | $0.03 |
| 1,000 | 46.62 GB | 74,700 | 1.57M | $0.55 |
| 5,000 | 233 GB | 373,500 | 7.84M | $3.36 |
| 10,000 | 466 GB | 747,000 | 15.69M | $9.02 |
| 20,000 | 932 GB | 1.49M | 31.37M | $26.27 |

Marginal rough cost after free tier is exceeded:

- Storage: about $0.00070 per active profile-month at current usage
- Class A: about $0.00034 per active profile-month
- Class B with 10 cache-miss views/object: about $0.00056 per active profile-month

Storage crosses the 10 GB free tier at roughly 215 current-profile months of
new storage. Operation limits are much less likely to matter until reads become
large or cache miss rates stay high.

## Current Delivery Path

Flight Deck currently resolves `storage://...` image references by downloading
from Tower:

- `src/storage-image-manager.js` calls `downloadStorageObjectBlob(...)`
- `src/api.js` fetches `/api/v4/storage/:objectId/content`
- Tower reads the object from S3-compatible storage and returns the bytes
- Flight Deck then caches the blob locally in Dexie

This means simply swapping MinIO/S3-compatible storage for R2 would reduce
object-store egress concerns, but it would not by itself make media globally
fast. The user still waits on Tower for the first read, and Tower still carries
the bandwidth/load for proxied content.

## Recommended Architecture

Keep Tower as the source of truth for metadata and authorization. Move blob
storage to R2. Change media reads so normal content delivery is handled by
Cloudflare rather than by Tower.

Recommended phases:

1. Configure Tower storage for R2 Standard.
   - Set `STORAGE_S3_ENDPOINT` to the R2 S3-compatible endpoint.
   - Set R2 access key, secret key, bucket, and region.
   - Keep Tower metadata in `v4_storage_objects`.

2. Add a direct media URL path for public/shareable objects.
   - Use an R2 custom domain, for example `media.<domain>`.
   - Set long-lived `Cache-Control` on immutable object uploads.
   - Return or derive stable public media URLs for `is_public` objects.
   - Disable `r2.dev` for production.

3. Add a private media delivery strategy.
   - Option A: Tower authorizes and returns short-lived presigned R2 URLs.
   - Option B: a Cloudflare Worker authorizes requests and reads from R2.
   - Option C: keep Tower proxy fallback for private objects only.

4. Update Flight Deck hydration.
   - Prefer `download_url` or a new `delivery_url` from storage metadata.
   - Use Tower `/content` only as fallback.
   - Keep the existing Dexie cache because it still improves repeat reads.

5. Add cache-aware behavior.
   - Immutable objects should be safe to cache aggressively.
   - Public images/audio can use Cloudflare Cache with Smart Tiered Cache.
   - Private delivery must avoid leaking content through public cache keys.

## Acceptance Criteria

- Tower can use R2 as the configured S3-compatible storage backend.
- Public/shareable media can be served through a Cloudflare custom domain.
- Flight Deck no longer requires Tower `/content` for normal public media reads.
- Private media access remains authorization-gated.
- Existing `storage://<objectId>` markdown continues to render.
- Existing Dexie image cache continues to work.
- Tower retains billing and inspection metadata in `v4_storage_objects`.
- The product has a clear fallback path if direct R2/Cloudflare delivery fails.

## Open Decisions

- Whether user-shared site media should always be `is_public`, or whether it
  needs tokenized private delivery.
- Whether Tower should return a generic `delivery_url` field instead of exposing
  R2-specific URLs to clients.
- Whether uploads should continue using presigned S3 URLs directly from the
  browser, or whether Tower should proxy uploads for stricter control.
- Whether Cloudflare Worker auth is worth adding for private media in v1.
- What cache TTL to use for immutable media objects.

## Sources

- Tower storage metadata: `v4_storage_objects`
- Flight Deck storage image hydration: `src/storage-image-manager.js`
- Flight Deck storage API client: `src/api.js`
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 public buckets/custom domains: https://developers.cloudflare.com/r2/buckets/public-buckets/
- Cloudflare cache for R2 buckets: https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/
