# Production Operations Runbook

## 1. Incident Severity Matrix & SLAs

| Severity | Description | Target Response Time | Target Resolution Time | Escalation Contact |
| :--- | :--- | :--- | :--- | :--- |
| **P1 — Critical** | Service down, render pipeline stalled, database unavailable | $< 15\text{ minutes}$ | $< 2\text{ hours}$ | Lead SRE + Engineering Lead |
| **P2 — High** | AI Planner degraded, high export failure rate ($> 5\%$) | $< 30\text{ minutes}$ | $< 4\text{ hours}$ | Backend On-Call |
| **P3 — Medium** | Non-critical feature degradation, individual user upload failure | $< 2\text{ hours}$ | $< 1\text{ business day}$ | Support Engineer |
| **P4 — Low** | Minor visual glitch, documentation typo | Next sprint | Next release | Product Manager |

---

## 2. Runbook 1: Failed Uploads

### Symptoms
- User receives HTTP 400 `INVALID_PARTS`, 404 `UPLOAD_SESSION_NOT_FOUND`, or 413 `UPLOAD_TOO_LARGE`.
- Browser console reports S3 CORS error or PUT preflight failure.
- Upload progress stalls at 99%.

### Diagnostic Steps
1. Verify S3 CORS configuration on the bucket:
   ```bash
   aws s3api get-bucket-cors --bucket $S3_BUCKET_NAME
   ```
2. Verify upload session exists in Redis with TTL:
   ```bash
   redis-cli -a "$REDIS_PASSWORD" GET "upload_session:<uploadId>"
   ```
3. Check file size in client request payload:
   - Minimum: $1024\text{ B}$ (1 KB)
   - Maximum: $5\text{ GB}$ ($5,368,709,120\text{ B}$)
4. Check S3 multipart upload status in AWS:
   ```bash
   aws s3api list-parts --bucket $S3_BUCKET_NAME --key "raw/..." --upload-id "<uploadId>"
   ```

### Remediation
- **Missing CORS**: Reapply CORS policy via `S3Service.configureBucketCors()` or AWS CLI:
  ```bash
  aws s3api put-bucket-cors --bucket $S3_BUCKET_NAME --cors-configuration file://cors.json
  ```
- **Expired Upload Session**: Session TTL in Redis is 24 hours. If expired, request the client restart the upload via `POST /api/uploads`.
- **Orphan / Abandoned Multiparts**: Trigger immediate maintenance purge:
  ```bash
  node -e "import('./dist/services/maintenance/maintenanceService.js').then(m => m.MaintenanceService.runAbandonedUploadCleanup())"
  ```

---

## 3. Runbook 2: Failed Video Renders & Exports

### Symptoms
- RenderJob state transitions to `failed` with error codes: `FFMPEG_COMPILE_ERROR`, `FFMPEG_PROCESS_ERROR`, `OUT_OF_MEMORY`, or `INPUT_CORRUPT`.
- Worker process crashes or restarts abruptly.

### Diagnostic Steps
1. Inspect RenderJob error payload in MongoDB:
   ```javascript
   // In mongosh:
   db.renderjobs.find({ state: "failed" }).sort({ createdAt: -1 }).limit(5).pretty();
   ```
2. Review FFmpeg execution logs in worker container:
   ```bash
   docker logs --tail 200 ai_video_prod_worker_render | grep -E "Error|exit code|Invalid data"
   ```
3. Check if scratch directory disk space is full:
   ```bash
   df -h /tmp/renders
   ```

### Common Exit Codes & Fixes
- **Exit Code 137 (OOM Killer)**:
  - Cause: FFmpeg complex filter chain exceeded container memory limit during 4K render or dense multi-layer blur.
  - Fix: Increase container memory limit to 6GB or 8GB in `docker-compose.prod.yml`, or restrict 4K renders to high-memory worker tier.
- **Error: "Font 'X' not found"**:
  - Cause: EditPlan specifies font missing in container's `/usr/share/fonts`.
  - Fix: Verify font fallback in `PlanNormalizer` defaults to `'Montserrat'`. Run `apk add ttf-dejavu` in worker container.
- **Error: "Input corrupted / moov atom not found"**:
  - Cause: User uploaded partial or truncated MP4 container.
  - Fix: RenderJob transitions to `failed` with code `INPUT_CORRUPT`. Prompt user to re-encode footage with faststart flag: `ffmpeg -i input.mp4 -c copy -movflags +faststart fixed.mp4`.

---

## 4. Runbook 3: Queue Backlog & Worker Stalling

### Symptoms
- CloudWatch or Datadog alert `[ALERT:QUEUE_BACKLOG]` fires ($> 10$ waiting jobs).
- Render queue ETA increases monotonically.
- SSE progress events stop updating.

### Diagnostic Steps
1. Inspect BullMQ queue depths across all three queues:
   ```bash
   node -e "import('./dist/services/observability/metrics.js').then(m => m.MetricsService.checkQueueDepths()).then(console.log)"
   ```
2. Check active vs. stalled jobs in Redis:
   ```bash
   redis-cli -a "$REDIS_PASSWORD" keys "bull:render-queue:*"
   ```
3. Inspect worker container CPU and memory utilization:
   ```bash
   docker stats --no-stream ai_video_prod_worker_render ai_video_prod_worker_analysis
   ```

### Remediation
1. **Scale Worker Instances**:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d --scale worker-render=4
   ```
2. **Clear Dead-Letter Stalled Jobs**:
   - If a worker node crashed hard, BullMQ automatically detects stalled jobs after 30 seconds and moves them back to `wait` or `failed`.
   - To clean up dead jobs manually:
     ```javascript
     // In node console:
     import { renderQueue } from './dist/services/queue/queueService.js';
     await renderQueue.clean(5000, 100, 'failed');
     ```

---

## 5. Runbook 4: AI Provider Outages (Gemini / OpenAI)

### Symptoms
- Users receive HTTP 422 `PLAN_VALIDATION_ERROR` or HTTP 503 `PROVIDER_UNAVAILABLE`.
- Structured logs indicate HTTP 429 `RESOURCE_EXHAUSTED` or timeout connecting to `generativelanguage.googleapis.com`.

### Diagnostic Steps
1. Check Google AI Studio / Gemini API status page: `https://status.cloud.google.com/`.
2. Review structured logger provider outputs:
   ```bash
   docker logs --tail 100 ai_video_prod_api | grep -E "GeminiPlannerAdapter|OpenAIPlannerAdapter"
   ```

### Remediation
1. **Activate Heuristic Fallback Planner**:
   - `GeminiPlannerAdapter` and `OpenAIPlannerAdapter` contain automatic local fallback to the deterministic heuristic planner if the remote API fails.
   - If the API key is completely exhausted, the platform continues servicing edit requests using rule-based analysis heuristics.
2. **Switch AI Provider via Environment Variable**:
   ```bash
   # Switch provider from Gemini to OpenAI without rebuilding image
   docker exec ai_video_prod_api export AI_PROVIDER=openai
   docker exec ai_video_prod_api export OPENAI_API_KEY=sk-...
   ```

---

## 6. Runbook 5: S3 Storage & Signature Mismatch Issues

### Symptoms
- Users receive HTTP 403 `SignatureDoesNotMatch` or `RequestTimeTooSkewed` on download or upload URLs.
- S3 uploads fail with `AccessDenied`.

### Diagnostic Steps
1. Verify server system clock synchronization (NTP):
   ```bash
   timedatectl status || ntpstat
   ```
2. Verify AWS credentials and bucket existence:
   ```bash
   aws s3 ls s3://$S3_BUCKET_NAME/
   ```
3. Test download presigned URL generation:
   ```bash
   node -e "import('./dist/services/storage/s3Service.js').then(s => s.S3Service.getPresignedDownloadUrl('library/fonts/test.ttf', 60)).then(console.log)"
   ```

### Remediation
- **Clock Skew**: Synchronize host clock via Chrony/NTP: `chronyc makestep`.
- **Expired Presigned URL**: Presigned download URLs expire after 1 hour (3600s). Re-query `GET /api/jobs/:id/download` to obtain a fresh presigned URL.
- **Bucket Encryption / Permissions**: Verify bucket policy grants `s3:GetObject`, `s3:PutObject`, `s3:AbortMultipartUpload` to the IAM role.

