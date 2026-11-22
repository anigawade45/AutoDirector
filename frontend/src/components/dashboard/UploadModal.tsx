import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  UploadCloud,
  AlertCircle,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  CheckCircle2,
  WifiOff,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { api } from '../../api/client';
import { toast } from '../../stores/toastStore';
import { PresignedPartUrl } from '@ai-video/shared';

const UPLOAD_STORAGE_KEY = 'ai_video_pending_upload';
const CONCURRENCY_LIMIT = 3;

interface StoredUploadSession {
  uploadId: string;
  projectId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  title: string;
  completedParts: Array<{ partNumber: number; etag: string }>;
  totalParts: number;
  partSizeBytes: number;
  createdAt: number;
}

interface UploadModalProps {
  onClose: () => void;
  onProjectCreated: (projectId: string) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({ onClose, onProjectCreated }) => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [stepLabel, setStepLabel] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stored pending upload from prior session / reload
  const [pendingResume, setPendingResume] = useState<StoredUploadSession | null>(null);

  const activeProjectIdRef = useRef<string | null>(null);
  const activeUploadIdRef = useRef<string | null>(null);
  const isCancelledRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const chunkAbortControllerRef = useRef<AbortController | null>(null);
  const totalPartsRef = useRef<number>(1);
  const partSizeBytesRef = useRef<number>(16 * 1024 * 1024);
  const completedPartsMapRef = useRef<Map<number, string>>(new Map());

  // 1. Check for stored pending resumable upload on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(UPLOAD_STORAGE_KEY);
      if (raw) {
        const parsed: StoredUploadSession = JSON.parse(raw);
        // Valid for up to 24 hours
        if (Date.now() - parsed.createdAt < 24 * 60 * 60 * 1000) {
          setPendingResume(parsed);
          if (!title) {
            setTitle(parsed.title);
          }
        } else {
          localStorage.removeItem(UPLOAD_STORAGE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(UPLOAD_STORAGE_KEY);
    }
  }, []);

  // 2. Offline / Online auto-pause and auto-resume
  useEffect(() => {
    const handleOffline = () => {
      if (isUploading && !isPausedRef.current) {
        isPausedRef.current = true;
        setIsPaused(true);
        if (chunkAbortControllerRef.current) {
          chunkAbortControllerRef.current.abort();
        }
        setStepLabel('Network connection lost. Upload paused automatically.');
        toast.warning('Network connection lost. Upload paused automatically.', 'Network Offline');
      }
    };

    const handleOnline = () => {
      if (isUploading && isPausedRef.current && file) {
        toast.info('Network connection restored! Resuming upload...', 'Network Online');
        handleResume();
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [isUploading, file]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      setErrorMsg(null);

      // If matches pending resume file, set title and pre-populate progress
      if (
        pendingResume &&
        selected.name === pendingResume.fileName &&
        selected.size === pendingResume.fileSize
      ) {
        setTitle(pendingResume.title);
        const priorPct = Math.round(
          (pendingResume.completedParts.length / Math.max(1, pendingResume.totalParts)) * 75
        );
        setProgressPercent(Math.min(90, priorPct + 10));
        setStepLabel(
          `Matching session found! ${pendingResume.completedParts.length} of ${pendingResume.totalParts} parts previously uploaded.`
        );
      } else if (!title) {
        setTitle(selected.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleDiscardPendingResume = () => {
    if (pendingResume) {
      api.abortUpload(pendingResume.uploadId).catch(() => {});
      localStorage.removeItem(UPLOAD_STORAGE_KEY);
      setPendingResume(null);
      setProgressPercent(0);
      setStepLabel('');
      toast.info('Discarded previous upload session. Starting fresh.', 'Upload Reset');
    }
  };

  const handleCancelOrClose = async () => {
    if (isCancelling) return;

    if (!isUploading) {
      onClose();
      return;
    }

    // Gracefully abort and cleanup active upload and draft project
    setIsCancelling(true);
    isCancelledRef.current = true;
    isPausedRef.current = false;
    setStepLabel('Cancelling upload and cleaning up workspace...');

    if (chunkAbortControllerRef.current) {
      chunkAbortControllerRef.current.abort();
    }

    try {
      if (activeUploadIdRef.current) {
        await api.abortUpload(activeUploadIdRef.current).catch(() => {});
      }
      if (activeProjectIdRef.current) {
        await api.deleteProject(activeProjectIdRef.current, true).catch(() => {});
      }
      localStorage.removeItem(UPLOAD_STORAGE_KEY);
    } catch (cleanupErr) {
      console.warn('[UploadModal] Cleanup notice during abort:', cleanupErr);
    } finally {
      setIsUploading(false);
      setIsCancelling(false);
      setIsPaused(false);
      toast.info('Video upload cancelled and cleaned up', 'Upload Cancelled');
      onClose();
    }
  };

  const handlePause = () => {
    if (!isUploading || isPaused) return;
    isPausedRef.current = true;
    setIsPaused(true);
    if (chunkAbortControllerRef.current) {
      chunkAbortControllerRef.current.abort();
    }
    setStepLabel('Upload paused. Progress saved to disk.');
    toast.info('Upload paused. You can resume at any time.', 'Upload Paused');
  };

  // Upload a single chunk to presigned URL with exponential backoff retry (3 attempts)
  const uploadChunk = async (
    url: string,
    blob: Blob,
    partNumber: number,
    contentType: string,
    abortSignal: AbortSignal,
    maxRetries = 3
  ): Promise<string> => {
    let lastErr: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (isCancelledRef.current || isPausedRef.current || abortSignal.aborted) {
        throw new DOMException('Upload aborted or paused by user', 'AbortError');
      }

      try {
        const putRes = await fetch(url, {
          method: 'PUT',
          body: blob,
          headers: {
            'Content-Type': contentType,
          },
          signal: abortSignal,
        });

        if (putRes.ok) {
          const rawEtag = putRes.headers.get('ETag');
          const etag = rawEtag
            ? rawEtag.startsWith('"')
              ? rawEtag
              : `"${rawEtag}"`
            : `"${Math.random().toString(16)}"`;
          return etag;
        }

        lastErr = new Error(`Storage service returned HTTP ${putRes.status}: ${putRes.statusText}`);
      } catch (err: any) {
        if (err.name === 'AbortError' || isCancelledRef.current || isPausedRef.current) {
          throw err;
        }
        lastErr = err;
      }

      if (
        attempt < maxRetries &&
        !isCancelledRef.current &&
        !isPausedRef.current &&
        !abortSignal.aborted
      ) {
        const backoffMs = Math.pow(2, attempt - 1) * 500 + Math.floor(Math.random() * 200);
        setStepLabel(
          `Part ${partNumber} retry (${attempt + 1}/${maxRetries}) in ${Math.round(backoffMs)}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw new Error(
      `Failed to transfer part ${partNumber} after ${maxRetries} attempts: ${
        lastErr?.message || 'Network failure'
      }`
    );
  };

  // Concurrent worker queue for parallel chunk uploads
  const runWorkerPool = async (
    fileToUpload: File,
    remainingParts: PresignedPartUrl[],
    partSize: number,
    totalParts: number,
    uploadId: string,
    projectId: string
  ) => {
    chunkAbortControllerRef.current = new AbortController();
    const abortSignal = chunkAbortControllerRef.current.signal;

    const queue = [...remainingParts];
    const inFlight: Promise<void>[] = [];

    const saveProgressToStorage = () => {
      try {
        const completedList = Array.from(completedPartsMapRef.current.entries()).map(
          ([partNumber, etag]) => ({ partNumber, etag })
        );
        const sessionRecord: StoredUploadSession = {
          uploadId,
          projectId,
          fileName: fileToUpload.name,
          fileSize: fileToUpload.size,
          contentType: fileToUpload.type || 'video/mp4',
          title,
          completedParts: completedList,
          totalParts,
          partSizeBytes: partSize,
          createdAt: Date.now(),
        };
        localStorage.setItem(UPLOAD_STORAGE_KEY, JSON.stringify(sessionRecord));
      } catch {}
    };

    const processNext = async (): Promise<void> => {
      if (isCancelledRef.current || isPausedRef.current || abortSignal.aborted) {
        return;
      }
      const partInfo = queue.shift();
      if (!partInfo) return;

      const startByte = (partInfo.partNumber - 1) * partSize;
      const endByte = Math.min(startByte + partSize, fileToUpload.size);
      const chunkBlob = fileToUpload.slice(startByte, endByte);

      const etag = await uploadChunk(
        partInfo.url,
        chunkBlob,
        partInfo.partNumber,
        fileToUpload.type || 'video/mp4',
        abortSignal,
        3
      );

      completedPartsMapRef.current.set(partInfo.partNumber, etag);
      saveProgressToStorage();

      const doneCount = completedPartsMapRef.current.size;
      const pct = 15 + Math.round((doneCount / totalParts) * 75);
      setProgressPercent(Math.min(92, pct));

      const doneBytes = Math.min(fileToUpload.size, doneCount * partSize);
      setUploadedBytes(doneBytes);
      setStepLabel(
        `Uploaded part ${partInfo.partNumber} (${doneCount}/${totalParts} parts • ${(
          doneBytes /
          (1024 * 1024)
        ).toFixed(1)}MB / ${(fileToUpload.size / (1024 * 1024)).toFixed(1)}MB)`
      );

      // Recurse to pick next part
      if (queue.length > 0 && !isCancelledRef.current && !isPausedRef.current) {
        return processNext();
      }
    };

    // Spawn up to CONCURRENCY_LIMIT workers
    const workerCount = Math.min(CONCURRENCY_LIMIT, remainingParts.length);
    for (let w = 0; w < workerCount; w++) {
      inFlight.push(processNext());
    }

    await Promise.all(inFlight);
  };

  const handleResume = async () => {
    if (!file) {
      toast.warning('Please select the video file to resume', 'File Missing');
      return;
    }
    setIsUploading(true);
    setIsPaused(false);
    isPausedRef.current = false;
    isCancelledRef.current = false;
    setErrorMsg(null);

    const uploadId = activeUploadIdRef.current || pendingResume?.uploadId;
    const projectId = activeProjectIdRef.current || pendingResume?.projectId;

    if (!uploadId || !projectId) {
      handleStartUpload();
      return;
    }

    try {
      setStepLabel('Validating uploaded parts with cloud storage...');
      const statusRes = await api.getUploadStatus(uploadId);

      // Populate completed parts map with parts confirmed by server
      const currentMap = new Map<number, string>();
      if (statusRes.uploadedParts && Array.isArray(statusRes.uploadedParts)) {
        statusRes.uploadedParts.forEach((p) => currentMap.set(p.partNumber, p.etag));
      }
      completedPartsMapRef.current = currentMap;
      totalPartsRef.current = statusRes.totalParts;
      partSizeBytesRef.current = statusRes.partSizeBytes;

      const doneCount = currentMap.size;
      const totalCount = statusRes.totalParts;
      const pct = 15 + Math.round((doneCount / totalCount) * 75);
      setProgressPercent(Math.min(92, pct));

      if (statusRes.isComplete || currentMap.size === totalCount) {
        // All parts already uploaded, finalize directly!
        await finalizeUpload(uploadId, projectId, totalCount);
        return;
      }

      setStepLabel(
        `Resuming from part ${doneCount + 1} (${doneCount}/${totalCount} parts already uploaded)...`
      );

      // Run parallel upload for remaining parts
      await runWorkerPool(
        file,
        statusRes.remainingParts,
        statusRes.partSizeBytes,
        statusRes.totalParts,
        uploadId,
        projectId
      );

      if (isPausedRef.current || isCancelledRef.current) {
        return;
      }

      if (completedPartsMapRef.current.size === statusRes.totalParts) {
        await finalizeUpload(uploadId, projectId, statusRes.totalParts);
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || isPausedRef.current || isCancelledRef.current) {
        return;
      }
      console.error('Resume error:', err);
      const msg = err.message || 'Failed to resume upload';
      setErrorMsg(msg);
      toast.error(msg, 'Resume Failed');
      setIsUploading(false);
    }
  };

  const finalizeUpload = async (uploadId: string, projectId: string, totalParts: number) => {
    setStepLabel('Finalizing upload and initiating speech analysis...');
    setProgressPercent(95);

    const sortedParts = Array.from(completedPartsMapRef.current.entries())
      .map(([partNumber, etag]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber);

    if (sortedParts.length !== totalParts) {
      throw new Error(`Expected ${totalParts} parts, but only ${sortedParts.length} were verified`);
    }

    await api.completeUpload(uploadId, { parts: sortedParts });

    localStorage.removeItem(UPLOAD_STORAGE_KEY);
    setPendingResume(null);

    setProgressPercent(100);
    setStepLabel('Analysis enqueued! Redirecting to editor...');
    toast.success(`"${title}" uploaded! Video analysis & transcription queued.`, 'Media Uploaded');
    setTimeout(() => {
      onProjectCreated(projectId);
    }, 800);
  };

  const handleStartUpload = async () => {
    if (!file) {
      toast.warning('Please select a video file to upload', 'File Missing');
      return;
    }
    if (!title.trim()) {
      toast.warning('Please enter a project title', 'Title Required');
      return;
    }

    // If matches pending resume, execute resume
    if (
      pendingResume &&
      file.name === pendingResume.fileName &&
      file.size === pendingResume.fileSize
    ) {
      activeUploadIdRef.current = pendingResume.uploadId;
      activeProjectIdRef.current = pendingResume.projectId;
      await handleResume();
      return;
    }

    setIsUploading(true);
    setIsPaused(false);
    setIsCancelling(false);
    isCancelledRef.current = false;
    isPausedRef.current = false;
    activeProjectIdRef.current = null;
    activeUploadIdRef.current = null;
    completedPartsMapRef.current = new Map();
    setErrorMsg(null);

    try {
      // 1. Create project workspace
      setStepLabel('Creating project workspace...');
      setProgressPercent(5);
      const project = await api.createProject({ title });
      activeProjectIdRef.current = project.publicId;

      if (isCancelledRef.current) {
        await api.deleteProject(project.publicId, true).catch(() => {});
        return;
      }

      // 2. Request multipart upload session
      setStepLabel('Preparing secure multipart upload session...');
      setProgressPercent(12);
      const session = await api.createUploadSession({
        projectId: project.publicId,
        fileName: file.name,
        contentType: file.type || 'video/mp4',
        sizeBytes: file.size,
      });
      activeUploadIdRef.current = session.uploadId;
      totalPartsRef.current = session.parts.length;
      partSizeBytesRef.current = session.partSizeBytes;

      if (isCancelledRef.current) {
        await api.abortUpload(session.uploadId).catch(() => {});
        await api.deleteProject(project.publicId, true).catch(() => {});
        return;
      }

      // Initial storage session record
      const initialRecord: StoredUploadSession = {
        uploadId: session.uploadId,
        projectId: project.publicId,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || 'video/mp4',
        title,
        completedParts: [],
        totalParts: session.parts.length,
        partSizeBytes: session.partSizeBytes,
        createdAt: Date.now(),
      };
      localStorage.setItem(UPLOAD_STORAGE_KEY, JSON.stringify(initialRecord));
      setPendingResume(initialRecord);

      // 3. Run parallel chunk worker pool
      setStepLabel(
        `Uploading ${session.parts.length} parts concurrently (${CONCURRENCY_LIMIT} active streams)...`
      );
      await runWorkerPool(
        file,
        session.parts,
        session.partSizeBytes,
        session.parts.length,
        session.uploadId,
        project.publicId
      );

      if (isPausedRef.current || isCancelledRef.current) {
        return;
      }

      // 4. Finalize upload
      if (completedPartsMapRef.current.size === session.parts.length) {
        await finalizeUpload(session.uploadId, project.publicId, session.parts.length);
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || isPausedRef.current || isCancelledRef.current) {
        return;
      }
      console.error('Upload error:', err);
      const errMsg = err.message || 'An error occurred during video upload';
      setErrorMsg(errMsg);
      toast.error(errMsg, 'Upload Failed');
      setIsUploading(false);
    }
  };

  const isMatchingPendingResume =
    !!pendingResume &&
    !!file &&
    file.name === pendingResume.fileName &&
    file.size === pendingResume.fileSize;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#222326] border border-[#393B3F] rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative my-auto text-[#FFF5F5]">
        <button
          type="button"
          onClick={handleCancelOrClose}
          disabled={isCancelling}
          className="absolute top-4 right-4 text-[#FFF5F5]/60 hover:text-[#FFF5F5] transition-colors p-1.5 rounded-lg hover:bg-[#2A2C2F] disabled:opacity-50"
          title={isUploading ? 'Cancel upload' : 'Close'}
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-bold mb-1 text-[#FFF5F5]">Create New Video Project</h3>
        <p className="text-xs text-[#FFF5F5]/70 mb-4 font-mono">
          Upload raw footage. Resumable multi-part chunks with AI speech sync & media intelligence.
        </p>

        {/* Killer Demo One-Click Card */}
        <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-[#2A2326] to-[#1F2023] border border-[#E3B5BE]/60 flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="flex items-center space-x-1.5 font-bold text-xs text-[#F7D7D1]">
              <Sparkles className="w-3.5 h-3.5 text-[#E3B5BE]" />
              <span>Instant Video Demo (No Upload Required)</span>
            </span>
            <p className="text-[10px] text-[#FFF5F5]/70">
              Loads 3-minute uncut studio footage with false starts & repeated takes.
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                toast.info('Loading Killer Demo Footage...', 'Demo');
                const res = await api.createDemoProject();
                const proj = res?.data || res;
                if (proj?.publicId) {
                  onProjectCreated(proj.publicId);
                  onClose();
                }
              } catch (err: any) {
                toast.error('Could not load demo project: ' + err.message);
              }
            }}
            className="px-3 py-1.5 rounded-lg bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold text-xs shadow-sm whitespace-nowrap transition-all"
          >
            Load Demo
          </button>
        </div>

        {/* Resumable Session Alert Banner */}
        {pendingResume && !isUploading && (
          <div className="mb-4 p-3 rounded-xl bg-[#2A2326] border border-[#E3B5BE]/60 text-xs text-[#FFF5F5] space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center space-x-1.5 font-semibold text-[#F7D7D1]">
                <RotateCcw className="w-4 h-4 text-[#E3B5BE]" />
                <span>Resumable Upload Available</span>
              </span>
              <button
                type="button"
                onClick={handleDiscardPendingResume}
                className="text-[10px] text-[#FFF5F5]/50 hover:text-red-400 flex items-center space-x-1"
                title="Discard saved progress and start fresh"
              >
                <Trash2 className="w-3 h-3" />
                <span>Discard</span>
              </button>
            </div>
            <p className="text-[11px] text-[#FFF5F5]/80 leading-relaxed font-mono">
              Previous file: <strong className="text-white">{pendingResume.fileName}</strong> (
              {pendingResume.completedParts.length}/{pendingResume.totalParts} parts completed).
              {!isMatchingPendingResume
                ? ' Select this file below to resume without re-uploading from scratch.'
                : ' File matched! Ready to continue upload.'}
            </p>
          </div>
        )}

        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-red-300 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-1.5">
              Project Title
            </label>
            <input
              type="text"
              value={title}
              disabled={isUploading}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Cinematic Sequence 01"
              className="w-full bg-[#18191B] border border-[#393B3F] rounded-lg px-3.5 py-2.5 text-xs text-[#FFF5F5] placeholder:text-[#FFF5F5]/40 focus:outline-none focus:border-[#E3B5BE]"
            />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#FFF5F5]/80 mb-1.5">
              Video File (MP4, MOV, WebM)
            </label>
            <div className="border-2 border-dashed border-[#393B3F] hover:border-[#E3B5BE] rounded-xl p-6 text-center cursor-pointer transition-colors relative bg-[#18191B]/40">
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                disabled={isUploading}
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <UploadCloud className="w-10 h-10 text-[#E3B5BE] mx-auto mb-2" />
              {file ? (
                <div>
                  <p className="text-sm font-semibold text-[#FFF5F5]">{file.name}</p>
                  <p className="text-xs font-mono text-[#F7D7D1] mt-0.5">
                    {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                  {isMatchingPendingResume && (
                    <span className="inline-flex items-center gap-1 mt-2 text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-300 border border-emerald-800/50">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>Ready to resume from {(progressPercent || 20).toFixed(0)}%</span>
                    </span>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-[#FFF5F5]/90">
                    Click to select or drag and drop
                  </p>
                  <p className="text-xs text-[#FFF5F5]/50 mt-1 font-mono">
                    High-res media stream • Resumable 16MB multi-part chunking
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Upload Progress & Controls */}
          {isUploading && (
            <div className="mt-4 p-4 rounded-xl bg-[#18191B] border border-[#393B3F] space-y-3">
              <div className="flex items-center justify-between text-xs text-[#FFF5F5]/80 font-mono">
                <span className="flex items-center space-x-2 truncate max-w-[320px]">
                  {isPaused ? (
                    <Pause className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E3B5BE] shrink-0" />
                  )}
                  <span className="truncate">{stepLabel}</span>
                </span>
                <span className="text-[#F7D7D1] font-semibold shrink-0">{progressPercent}%</span>
              </div>

              {/* Multi-Segment Progress Bar */}
              <div className="h-2.5 w-full bg-[#2A2C2F] rounded-full overflow-hidden relative">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    isPaused ? 'bg-amber-400/80' : 'bg-[#E3B5BE]'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Pause & Resume Inline Actions */}
              <div className="flex items-center justify-between text-[11px] font-mono text-[#FFF5F5]/60 pt-1">
                <span>
                  {uploadedBytes > 0 && file
                    ? `${(uploadedBytes / (1024 * 1024)).toFixed(1)}MB / ${(
                        file.size /
                        (1024 * 1024)
                      ).toFixed(1)}MB transferred`
                    : 'Securing upload stream...'}
                </span>

                <div className="flex items-center space-x-2">
                  {isPaused ? (
                    <button
                      type="button"
                      onClick={handleResume}
                      className="px-2.5 py-1 rounded bg-[#E3B5BE] hover:bg-[#F7D7D1] text-[#18191B] font-bold text-[10px] flex items-center space-x-1 transition-colors"
                      title="Resume upload from current part"
                    >
                      <Play className="w-2.5 h-2.5 fill-[#18191B]" />
                      <span>Resume</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handlePause}
                      className="px-2.5 py-1 rounded bg-[#2A2C2F] hover:bg-[#34373B] text-[#FFF5F5] text-[10px] flex items-center space-x-1 border border-[#393B3F] transition-colors"
                      title="Pause upload without losing progress"
                    >
                      <Pause className="w-2.5 h-2.5" />
                      <span>Pause</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="pt-4 flex justify-end space-x-3">
            <button
              type="button"
              onClick={handleCancelOrClose}
              disabled={isCancelling}
              className="px-4 py-2 text-xs font-semibold text-[#FFF5F5]/70 hover:text-[#FFF5F5] disabled:opacity-50 transition-colors"
            >
              {isCancelling ? 'Cancelling...' : isUploading ? 'Cancel Upload' : 'Cancel'}
            </button>

            {isMatchingPendingResume && !isUploading ? (
              <button
                type="button"
                onClick={handleResume}
                disabled={!file || isCancelling}
                className="bg-[#E3B5BE] hover:bg-[#F7D7D1] disabled:opacity-40 text-[#18191B] font-bold uppercase tracking-wider px-5 py-2.5 rounded-lg text-xs transition-colors shadow-sm flex items-center space-x-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Resume Upload</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartUpload}
                disabled={!file || !title || isUploading || isCancelling}
                className="bg-[#E3B5BE] hover:bg-[#F7D7D1] disabled:opacity-40 disabled:cursor-not-allowed text-[#18191B] font-bold uppercase tracking-wider px-5 py-2.5 rounded-lg text-xs transition-colors shadow-sm"
              >
                {isUploading ? (isPaused ? 'Paused' : 'Uploading...') : 'Upload & Analyze'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
