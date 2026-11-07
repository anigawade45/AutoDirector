# Production Rollback & Emergency Recovery Plan

## 1. Scope & Purpose
This document defines the standard operating procedures for executing a safe, zero-downtime rollback of the **AI-Native Video Creation & Editing Platform** in the event of an unrecoverable production regression, data corruption, or service degradation.

---

## 2. Fast-Rollback Decision Matrix

| Severity | Incident Trigger | Max Decision Time | Action |
| :--- | :--- | :--- | :--- |
| **P1** | 5xx error rate $> 1.0\%$ or API crash loop | 5 minutes | Immediate Blue/Green traffic switchback |
| **P1** | Render worker failure rate $> 10\%$ across exports | 10 minutes | Revert worker container image to prior tag |
| **P2** | AI Planner schema validation failure $> 5\%$ | 15 minutes | Toggle feature flag `FALLBACK_HEURISTIC_PLANNER=true` |
| **P2** | Latency p95 $> 15\text{ s}$ on exports | 20 minutes | Scale worker concurrency; rollback if unresolved |

---

## 3. Step-by-Step Rollback Execution Procedure

### Step 1: Instant Traffic Switchback (Blue/Green Routing)
If deploying via AWS ECS / Kubernetes / Nginx:
1. Revert the active upstream service target in the load balancer:
   ```bash
   # AWS ALB Target Group Switchback
   aws elbv2 modify-listener --listener-arn $ALB_LISTENER_ARN \
     --default-actions Type=forward,TargetGroupArn=$PREVIOUS_STABLE_TG_ARN
   ```
   Or via Nginx upstream reload:
   ```bash
   sed -i 's/api_blue:4000/api_green:4000/g' /etc/nginx/conf.d/default.conf
   nginx -s reload
   ```
2. Confirm live 200 OK responses on `/health` within 10 seconds.

### Step 2: Asynchronous Worker Queue Draining & Container Rollback
1. Stop newly deployed workers from picking up new BullMQ jobs:
   ```bash
   # Gracefully pause analysis and render queues
   node scripts/pauseQueues.js
   ```
2. Redeploy the previous container image tag:
   ```bash
   docker-compose -f docker-compose.prod.yml down api worker-analysis worker-render
   IMAGE_TAG=v1.0.0-stable docker-compose -f docker-compose.prod.yml up -d
   ```
3. In-flight jobs that fail due to container termination will automatically be retried by BullMQ with exponential backoff (up to 3 attempts).

### Step 3: Database Compatibility & Migration Safeguards
- **Schema Backward Compatibility Guarantee**:
  - The platform strictly enforces the **Expand-and-Contract** pattern.
  - New schema versions **never** drop or rename existing collections or fields in the active release window.
  - Newly added fields have defaults defined in Mongoose schemas (`default: ...`).
  - Therefore, rolling back API containers does **not** require rolling back MongoDB data schemas.
- If data corruption occurred due to a rogue process:
  1. Restore the pre-deployment MongoDB archive snapshot:
     ```bash
     mongorestore --uri="$MONGODB_URI" --archive=/backups/pre_deploy_snapshot.gz --gzip --drop
     ```
  2. Restore the pre-deployment Redis dump:
     ```bash
     cp /backups/pre_deploy_redis.rdb /data/dump.rdb && redis-server --appendonly yes
     ```

### Step 4: Storage & S3 Safeguards
- S3 objects are immutable once written; render outputs use unique keys keyed by `jobId` (`users/{userId}/projects/{projectId}/renders/{jobId}.mp4`).
- S3 Versioning is enabled on the bucket, guaranteeing that any overwritten or deleted objects can be restored from previous versions.

---

## 4. Post-Rollback Verification Checklist
- [ ] `/health` endpoint responds with HTTP 200 and `{ status: "healthy", db: "connected", redis: "ready" }`.
- [ ] Public catalog (`/api/catalog`) returns active templates, LUTs, and music tracks.
- [ ] User authentication (`/api/auth/login`) succeeds and issues valid bearer tokens.
- [ ] Queue depths monitor returns zero unhandled stalls.
- [ ] In-flight renders resume without `INPUT_CORRUPT` or `WORKER_AUTH_INVALID_SIGNATURE` errors.
- [ ] Post-mortem review scheduled within 24 hours of incident resolution.
