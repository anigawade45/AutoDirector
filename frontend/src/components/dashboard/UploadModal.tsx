import React, { useState, useRef } from 'react';
import { X, UploadCloud, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import { toast } from '../../stores/toastStore';

interface UploadModalProps {
  onClose: () => void;
  onProjectCreated: (projectId: string) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({ onClose, onProjectCreated }) => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [stepLabel, setStepLabel] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const activeUploadIdRef = useRef<string | null>(null);
  const isCancelledRef = useRef<boolean>(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      if (!title) {
        setTitle(selected.name.replace(/\.[^/.]+$/, ''));
      }
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
    setStepLabel('Cancelling upload and cleaning up workspace...');

    // 1. Abort in-flight network transfer
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    try {
      // 2. Abort upload session on storage if active
      if (activeUploadIdRef.current) {
        await api.abortUpload(activeUploadIdRef.current).catch(() => {});
      }

      // 3. Purge draft project from database so it never lingers on dashboard
      if (activeProjectIdRef.current) {
        await api.deleteProject(activeProjectIdRef.current, true).catch(() => {});
      }
    } catch (cleanupErr) {
      console.warn('[UploadModal] Cleanup notice during abort:', cleanupErr);
    } finally {
      setIsUploading(false);
      setIsCancelling(false);
      toast.info('Video upload cancelled and cleaned up', 'Upload Cancelled');
      onClose();
    }
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
    setIsUploading(true);
    setIsCancelling(false);
    isCancelledRef.current = false;
    activeProjectIdRef.current = null;
    activeUploadIdRef.current = null;
    setErrorMsg(null);

    abortControllerRef.current = new AbortController();
    const abortSignal = abortControllerRef.current.signal;

    try {
      // 1. Create project
      setStepLabel('Creating project workspace...');
      setProgressPercent(10);
      const project = await api.createProject({ title });
      activeProjectIdRef.current = project.publicId;

      if (isCancelledRef.current || abortSignal.aborted) {
        await api.deleteProject(project.publicId, true).catch(() => {});
        return;
      }

      // 2. Request multipart upload session
      setStepLabel('Preparing secure upload session...');
      setProgressPercent(20);
      const session = await api.createUploadSession({
        projectId: project.publicId,
        fileName: file.name,
        contentType: file.type || 'video/mp4',
        sizeBytes: file.size,
      });
      activeUploadIdRef.current = session.uploadId;

      if (isCancelledRef.current || abortSignal.aborted) {
        await api.abortUpload(session.uploadId).catch(() => {});
        await api.deleteProject(project.publicId, true).catch(() => {});
        return;
      }

      // 3. Upload chunks directly to storage with exponential backoff retry (3 attempts)
      setStepLabel(`Uploading ${session.parts.length} parts securely...`);
      const completedParts: Array<{ partNumber: number; etag: string }> = [];

      const uploadChunk = async (
        url: string,
        blob: Blob,
        partNumber: number,
        maxRetries = 3
      ): Promise<string> => {
        let lastErr: any = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          if (isCancelledRef.current || abortSignal.aborted) {
            throw new DOMException('Upload aborted by user', 'AbortError');
          }

          try {
            const putRes = await fetch(url, {
              method: 'PUT',
              body: blob,
              headers: {
                'Content-Type': file.type || 'video/mp4',
              },
              signal: abortSignal,
            });

            if (putRes.ok) {
              const rawEtag = putRes.headers.get('ETag');
              // ETags must be quoted string e.g. "etag"
              const etag = rawEtag
                ? rawEtag.startsWith('"')
                  ? rawEtag
                  : `"${rawEtag}"`
                : `"${Math.random().toString(16)}"`;
              return etag;
            }

            lastErr = new Error(
              `Storage service returned HTTP ${putRes.status}: ${putRes.statusText}`
            );
          } catch (err: any) {
            if (err.name === 'AbortError' || isCancelledRef.current) {
              throw err;
            }
            lastErr = err;
          }

          // If attempts remain, wait with exponential backoff delay (500ms, 1000ms, 2000ms + jitter)
          if (attempt < maxRetries && !isCancelledRef.current && !abortSignal.aborted) {
            const backoffMs = Math.pow(2, attempt - 1) * 500 + Math.floor(Math.random() * 200);
            setStepLabel(
              `Part ${partNumber} transfer notice. Retrying upload (${attempt + 1}/${maxRetries}) in ${Math.round(
                backoffMs
              )}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        }

        throw new Error(
          `Failed to upload part ${partNumber} after ${maxRetries} attempts: ${
            lastErr?.message || 'Network failure'
          }`
        );
      };

      try {
        for (let i = 0; i < session.parts.length; i++) {
          if (isCancelledRef.current || abortSignal.aborted) {
            throw new DOMException('Upload aborted by user', 'AbortError');
          }

          const partInfo = session.parts[i];
          const startByte = (partInfo.partNumber - 1) * session.partSizeBytes;
          const endByte = Math.min(startByte + session.partSizeBytes, file.size);
          const chunkBlob = file.slice(startByte, endByte);

          setStepLabel(`Transferring part ${i + 1} of ${session.parts.length}...`);
          const etag = await uploadChunk(partInfo.url, chunkBlob, partInfo.partNumber, 3);
          completedParts.push({ partNumber: partInfo.partNumber, etag });

          const pct = 20 + Math.round(((i + 1) / session.parts.length) * 60);
          setProgressPercent(pct);
        }
      } catch (uploadError: any) {
        if (uploadError.name === 'AbortError' || isCancelledRef.current) {
          return;
        }
        // Automatically abort uncompleted multipart upload and purge draft project on error
        await api.abortUpload(session.uploadId).catch(() => {});
        if (activeProjectIdRef.current) {
          await api.deleteProject(activeProjectIdRef.current, true).catch(() => {});
        }
        throw uploadError;
      }

      if (isCancelledRef.current || abortSignal.aborted) {
        return;
      }

      // 4. Finalize upload & enqueue analysis
      setStepLabel('Finalizing upload and initiating speech analysis...');
      setProgressPercent(90);
      await api.completeUpload(session.uploadId, { parts: completedParts });

      setProgressPercent(100);
      setStepLabel('Analysis enqueued! Redirecting to editor...');
      toast.success(
        `"${title}" uploaded! Video analysis & transcription queued.`,
        'Media Uploaded'
      );
      setTimeout(() => {
        onProjectCreated(project.publicId);
      }, 800);
    } catch (err: any) {
      if (err.name === 'AbortError' || isCancelledRef.current) {
        return;
      }
      console.error('Upload error:', err);
      const errMsg = err.message || 'An error occurred during video upload';
      setErrorMsg(errMsg);
      toast.error(errMsg, 'Upload Failed');
      setIsUploading(false);
    }
  };

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
        <p className="text-xs text-[#FFF5F5]/70 mb-6 font-mono">
          Upload raw footage. Multi-part chunks are analyzed with AI speech sync & voice activity
          detection.
        </p>

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
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-[#FFF5F5]/90">
                    Click to select or drag and drop
                  </p>
                  <p className="text-xs text-[#FFF5F5]/50 mt-1 font-mono">
                    High-res media stream • 480p proxy generated automatically
                  </p>
                </div>
              )}
            </div>
          </div>

          {isUploading && (
            <div className="mt-4 p-4 rounded-xl bg-[#18191B] border border-[#393B3F]">
              <div className="flex items-center justify-between text-xs text-[#FFF5F5]/80 mb-2 font-mono">
                <span className="flex items-center space-x-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E3B5BE]" />
                  <span>{stepLabel}</span>
                </span>
                <span className="text-[#F7D7D1] font-semibold">{progressPercent}%</span>
              </div>
              <div className="h-2 w-full bg-[#2A2C2F] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#E3B5BE] transition-all duration-300 rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
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
            <button
              type="button"
              onClick={handleStartUpload}
              disabled={!file || !title || isUploading || isCancelling}
              className="bg-[#E3B5BE] hover:bg-[#F7D7D1] disabled:opacity-40 disabled:cursor-not-allowed text-[#18191B] font-bold uppercase tracking-wider px-5 py-2.5 rounded-lg text-xs transition-colors shadow-sm"
            >
              {isUploading ? 'Uploading...' : 'Upload & Analyze'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
