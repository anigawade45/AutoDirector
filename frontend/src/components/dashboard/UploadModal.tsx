import React, { useState } from 'react';
import { X, UploadCloud, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../../api/client';

interface UploadModalProps {
  onClose: () => void;
  onProjectCreated: (projectId: string) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({ onClose, onProjectCreated }) => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [stepLabel, setStepLabel] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      if (!title) {
        setTitle(selected.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleStartUpload = async () => {
    if (!file || !title) return;
    setIsUploading(true);
    setErrorMsg(null);

    try {
      // 1. Create project
      setStepLabel('Creating project workspace...');
      setProgressPercent(10);
      const project = await api.createProject({ title });

      // 2. Request multipart upload session
      setStepLabel('Requesting presigned S3 chunk URLs...');
      setProgressPercent(20);
      const session = await api.createUploadSession({
        projectId: project.publicId,
        fileName: file.name,
        contentType: file.type || 'video/mp4',
        sizeBytes: file.size,
      });

      // 3. Upload chunks directly to S3 with exponential backoff retry (3 attempts)
      setStepLabel(`Uploading ${session.parts.length} parts directly to S3...`);
      const completedParts: Array<{ partNumber: number; etag: string }> = [];

      const uploadChunk = async (
        url: string,
        blob: Blob,
        partNumber: number,
        maxRetries = 3
      ): Promise<string> => {
        let lastErr: any = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const putRes = await fetch(url, {
              method: 'PUT',
              body: blob,
              headers: {
                'Content-Type': file.type || 'video/mp4',
              },
            });

            if (putRes.ok) {
              const rawEtag = putRes.headers.get('ETag');
              // S3 ETags must be quoted string e.g. "etag"
              const etag = rawEtag
                ? rawEtag.startsWith('"')
                  ? rawEtag
                  : `"${rawEtag}"`
                : `"${Math.random().toString(16)}"`;
              return etag;
            }

            lastErr = new Error(`S3 returned HTTP ${putRes.status}: ${putRes.statusText}`);
          } catch (err: any) {
            lastErr = err;
          }

          // If attempts remain, wait with exponential backoff delay (500ms, 1000ms, 2000ms + jitter)
          if (attempt < maxRetries) {
            const backoffMs = Math.pow(2, attempt - 1) * 500 + Math.floor(Math.random() * 200);
            setStepLabel(
              `Part ${partNumber} transfer notice. Retrying S3 PUT (${attempt + 1}/${maxRetries}) in ${Math.round(
                backoffMs
              )}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        }

        throw new Error(
          `Failed to upload part ${partNumber} directly to S3 after ${maxRetries} attempts: ${
            lastErr?.message || 'Network failure'
          }`
        );
      };

      try {
        for (let i = 0; i < session.parts.length; i++) {
          const partInfo = session.parts[i];
          const startByte = (partInfo.partNumber - 1) * session.partSizeBytes;
          const endByte = Math.min(startByte + session.partSizeBytes, file.size);
          const chunkBlob = file.slice(startByte, endByte);

          setStepLabel(`Transferring part ${i + 1} of ${session.parts.length} to S3...`);
          const etag = await uploadChunk(partInfo.url, chunkBlob, partInfo.partNumber, 3);
          completedParts.push({ partNumber: partInfo.partNumber, etag });

          const pct = 20 + Math.round(((i + 1) / session.parts.length) * 60);
          setProgressPercent(pct);
        }
      } catch (uploadError: any) {
        // Automatically abort uncompleted multipart upload on S3 to prevent orphaned storage
        await api.abortUpload(session.uploadId).catch(() => {});
        throw uploadError;
      }

      // 4. Finalize upload & enqueue analysis
      setStepLabel('Finalizing upload and enqueuing Whisper analysis...');
      setProgressPercent(90);
      await api.completeUpload(session.uploadId, { parts: completedParts });

      setProgressPercent(100);
      setStepLabel('Analysis enqueued! Redirecting to editor...');
      setTimeout(() => {
        onProjectCreated(project.publicId);
      }, 800);
    } catch (err: any) {
      console.error('Upload error:', err);
      setErrorMsg(err.message || 'An error occurred during video upload');
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-surfaceBorder rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          disabled={isUploading}
          className="absolute top-4 right-4 text-slate-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-bold mb-1">Create New Video Project</h3>
        <p className="text-xs text-slate-400 mb-6">
          Upload your raw video. Large files are streamed directly to S3 via chunked presigned URLs.
        </p>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Project Title</label>
            <input
              type="text"
              value={title}
              disabled={isUploading}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Summer Vacation Reel"
              className="w-full bg-[#0B0F17] border border-surfaceBorder rounded-lg px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Video File (MP4, MOV)</label>
            <div className="border-2 border-dashed border-surfaceBorder hover:border-blue-500/50 rounded-xl p-6 text-center cursor-pointer transition-colors relative">
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                disabled={isUploading}
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <UploadCloud className="w-10 h-10 text-slate-500 mx-auto mb-2" />
              {file ? (
                <div>
                  <p className="text-sm font-semibold text-slate-200">{file.name}</p>
                  <p className="text-xs text-slate-400">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-slate-300">Click to select or drag and drop</p>
                  <p className="text-xs text-slate-500 mt-1">Up to 5GB • 480p proxy generated automatically</p>
                </div>
              )}
            </div>
          </div>

          {isUploading && (
            <div className="mt-4 p-4 rounded-xl bg-[#0B0F17] border border-surfaceBorder">
              <div className="flex items-center justify-between text-xs text-slate-300 mb-2">
                <span className="flex items-center space-x-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                  <span>{stepLabel}</span>
                </span>
                <span className="font-mono text-blue-400 font-semibold">{progressPercent}%</span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-all duration-300 rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          <div className="pt-4 flex justify-end space-x-3">
            <button
              onClick={onClose}
              disabled={isUploading}
              className="px-4 py-2 text-sm text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleStartUpload}
              disabled={!file || !title || isUploading}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors shadow-md shadow-blue-600/20"
            >
              Upload & Analyze
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

