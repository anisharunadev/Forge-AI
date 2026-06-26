'use client';

/**
 * `<CaptureModal>` — Step 28.
 *
 * New multi-modal idea capture:
 *   - Text: simple textarea
 *   - Paste: textarea that auto-detects lists / bullets
 *   - URL: input field, AI "extracts" the key insight (mock)
 *   - Voice: Web Speech API + waveform; real-time transcription
 *   - Screen: MediaRecorder API; up to 2 min screen capture with bookmarks
 *   - File: drag-drop zone (PDF, DOCX, MD, TXT, images)
 *
 * Right-side "AI assist" toggle asks clarifying questions as you type
 * (mocked — real call to the ideation agent wires in later).
 */

import * as React from 'react';
import {
  Check,
  Clipboard,
  FileUp,
  Link as LinkIcon,
  Loader2,
  Mic,
  Plus,
  Save,
  Sparkles,
  Square,
  StopCircle,
  Type as TypeIcon,
  Video,
  X,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type CaptureMode = 'text' | 'paste' | 'url' | 'voice' | 'screen' | 'file';

const MODES: ReadonlyArray<{ value: CaptureMode; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'text', label: 'Text', Icon: TypeIcon },
  { value: 'paste', label: 'Paste', Icon: Clipboard },
  { value: 'url', label: 'URL', Icon: LinkIcon },
  { value: 'voice', label: 'Voice', Icon: Mic },
  { value: 'screen', label: 'Screen', Icon: Video },
  { value: 'file', label: 'File', Icon: FileUp },
];

export interface CaptureInput {
  readonly title: string;
  readonly description: string;
  readonly mode: CaptureMode;
}

export interface CaptureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate?: (input: CaptureInput) => void;
  /** Default content (used when launched from a market-signal "Generate idea"). */
  defaultDescription?: string;
  defaultTitle?: string;
}

// ---------------------------------------------------------------------------
// Voice capture hook — wraps Web Speech API with safe fallbacks.
// ---------------------------------------------------------------------------

interface SpeechRecognitionLike {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }> }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function VoiceCapture({
  transcript,
  setTranscript,
  onExtractIdeas,
}: {
  transcript: string;
  setTranscript: (t: string) => void;
  onExtractIdeas: (ideas: string[]) => void;
}) {
  const [supported, setSupported] = React.useState(true);
  const [recording, setRecording] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);
  const tickRef = React.useRef<number | null>(null);
  const startedAt = React.useRef<number>(0);

  React.useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  const start = React.useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      toast.error('Voice capture is not supported in this browser.');
      return;
    }
    try {
      const r = new Ctor();
      r.continuous = true;
      r.interimResults = true;
      r.lang = 'en-US';
      r.onresult = (event) => {
        let combined = '';
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result && result[0]) combined += result[0].transcript;
        }
        setTranscript(combined);
      };
      r.onerror = () => {
        setRecording(false);
        toast.error('Voice capture error — try again.');
      };
      r.onend = () => {
        setRecording(false);
      };
      r.start();
      recognitionRef.current = r;
      setRecording(true);
      startedAt.current = Date.now();
      tickRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }, 250);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[voice] start failed', err);
      toast.error('Could not start voice capture.');
    }
  }, [setTranscript]);

  const stop = React.useCallback(() => {
    recognitionRef.current?.stop();
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setRecording(false);
    // Mock "AI detected 3 ideas"
    window.setTimeout(() => {
      const seed = transcript || 'Idea one, idea two, idea three';
      const ideas = seed
        .split(/[.,;\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 8)
        .slice(0, 3);
      if (ideas.length > 0) {
        onExtractIdeas(ideas);
        toast.success(`AI detected ${ideas.length} ideas in your recording.`);
      }
    }, 200);
  }, [onExtractIdeas, transcript]);

  React.useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--fg-tertiary)]">
          {supported
            ? 'Powered by your browser (Web Speech API). Nothing is sent to the server until you save.'
            : 'Voice capture is not supported in this browser — try Chrome or Edge.'}
        </span>
        <span
          className="font-mono text-[10px] text-[var(--fg-secondary)]"
          data-testid="voice-elapsed"
        >
          {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, '0')}
        </span>
      </div>

      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={!supported}
        data-testid="voice-mic-button"
        className={cn(
          'group relative mx-auto flex h-24 w-24 items-center justify-center rounded-full transition-transform',
          recording
            ? 'bg-[var(--accent-rose)] text-white'
            : 'bg-[var(--accent-cyan)] text-black',
          recording ? '' : 'hover:scale-105',
        )}
      >
        {recording ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-rose)] opacity-50" aria-hidden="true" />
        ) : null}
        {recording ? (
          <StopCircle className="h-10 w-10" aria-hidden="true" />
        ) : (
          <Mic className="h-10 w-10" aria-hidden="true" />
        )}
      </button>

      {/* Live waveform (decorative bars driven by elapsed timer). */}
      {recording ? (
        <div className="flex h-8 items-center justify-center gap-0.5" aria-hidden="true">
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-[var(--accent-rose)] opacity-80"
              style={{
                height: `${30 + Math.sin((elapsed + i) / 2) * 50}%`,
                transition: 'height 100ms linear',
              }}
            />
          ))}
        </div>
      ) : null}

      <Textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder="Live transcript…"
        rows={4}
        data-testid="voice-transcript"
        className="resize-none"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen capture hook — MediaRecorder + getDisplayMedia.
// ---------------------------------------------------------------------------

function ScreenCapture({
  bookmarkCount,
  setBookmarkCount,
  onExtractIdeas,
}: {
  bookmarkCount: number;
  setBookmarkCount: (n: number) => void;
  onExtractIdeas: (ideas: string[]) => void;
}) {
  const [recording, setRecording] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [supported, setSupported] = React.useState(true);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const tickRef = React.useRef<number | null>(null);
  const startedAt = React.useRef<number>(0);

  React.useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' &&
        typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    );
  }, []);

  const start = React.useCallback(async () => {
    if (!supported) {
      toast.error('Screen capture is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      startedAt.current = Date.now();
      tickRef.current = window.setInterval(() => {
        const e = Math.floor((Date.now() - startedAt.current) / 1000);
        setElapsed(e);
        if (e >= 120) stop();
      }, 250);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[screen] start failed', err);
      toast.error('Screen capture permission denied.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  const stop = React.useCallback(() => {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setRecording(false);
    window.setTimeout(() => {
      onExtractIdeas([
        'Detected: form submit on checkout',
        'Detected: 3s blank screen before redirect',
        'Detected: error toast on validation',
      ]);
      toast.success('AI extracted 3 ideas from the recording.');
    }, 300);
  }, [onExtractIdeas]);

  React.useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--fg-tertiary)]">
          Record up to 2 minutes. Click "Mark moment" to bookmark a section.
        </span>
        <span
          className="font-mono text-[10px] text-[var(--fg-secondary)]"
          data-testid="screen-elapsed"
        >
          {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, '0')} / 2:00
        </span>
      </div>

      <div className="flex items-center gap-2">
        {recording ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={stop}
            data-testid="screen-stop"
          >
            <Square className="h-4 w-4" aria-hidden="true" />
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={start}
            disabled={!supported}
            data-testid="screen-start"
            className="bg-[var(--accent-rose)] text-white hover:opacity-90"
          >
            <Video className="h-4 w-4" aria-hidden="true" />
            Record screen
          </Button>
        )}
        {recording ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setBookmarkCount(bookmarkCount + 1)}
            data-testid="screen-bookmark"
            className="border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            Mark moment
          </Button>
        ) : null}
        {bookmarkCount > 0 ? (
          <span className="font-mono text-[10px] text-[var(--accent-amber)]">
            {bookmarkCount} bookmark{bookmarkCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] bg-[var(--bg-inset)] p-3 text-[11px] text-[var(--fg-tertiary)]">
        {recording
          ? 'Recording in progress. AI will extract transcript + OCR + actions when you stop.'
          : 'Press "Record screen" to start. Forge will OCR text, detect actions, and suggest 1–3 ideas.'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// File drop zone (client-side validation only).
// ---------------------------------------------------------------------------

function FileDropZone({
  files,
  setFiles,
}: {
  files: ReadonlyArray<File>;
  setFiles: (files: File[]) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const MAX = 25 * 1024 * 1024;
  const ACCEPTED = ['.pdf', '.docx', '.md', '.txt', '.png', '.jpg', '.jpeg'];

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const next: File[] = [];
    for (let i = 0; i < incoming.length; i += 1) {
      const f = incoming.item(i);
      if (!f) continue;
      if (f.size > MAX) {
        toast.error(`${f.name} exceeds 25MB`);
        continue;
      }
      const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
      if (!ACCEPTED.includes(ext)) {
        toast.error(`${f.name} — unsupported file type`);
        continue;
      }
      next.push(f);
    }
    if (next.length > 0) setFiles([...files, ...next]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        data-testid="file-drop"
        className={cn(
          'flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed text-center text-xs transition-colors',
          dragOver
            ? 'border-[var(--accent-primary)] bg-[rgba(99,102,241,0.06)]'
            : 'border-[var(--border-default)] bg-[var(--bg-inset)] text-[var(--fg-tertiary)] hover:border-[var(--accent-primary)]',
        )}
      >
        <FileUp className="h-5 w-5 text-[var(--fg-tertiary)]" aria-hidden="true" />
        <span>Drop a file here or click to browse.</span>
        <span className="font-mono text-[10px]">PDF · DOCX · MD · TXT · PNG · JPG · 25MB max</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {files.length > 0 ? (
        <ul className="space-y-1.5" data-testid="file-list">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px]"
            >
              <span className="truncate">{f.name}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-[var(--fg-tertiary)]">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                  className="text-[var(--fg-muted)] hover:text-[var(--accent-rose)]"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main CaptureModal
// ---------------------------------------------------------------------------

export function CaptureModal({
  open,
  onOpenChange,
  onCreate,
  defaultDescription = '',
  defaultTitle = '',
}: CaptureModalProps) {
  const [mode, setMode] = React.useState<CaptureMode>('text');
  const [text, setText] = React.useState(defaultDescription);
  const [url, setUrl] = React.useState('');
  const [voiceTranscript, setVoiceTranscript] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [bookmarkCount, setBookmarkCount] = React.useState(0);
  const [title, setTitle] = React.useState(defaultTitle);
  const [aiAssist, setAiAssist] = React.useState(true);
  const [extracting, setExtracting] = React.useState(false);
  const [chips, setChips] = React.useState<string[]>([]);

  // Auto-fill title from URL on a debounce.
  React.useEffect(() => {
    if (!url) return;
    const t = window.setTimeout(() => {
      if (aiAssist && !title) {
        try {
          const u = new URL(url);
          setTitle(`Insight from ${u.hostname}`);
        } catch {
          /* not a URL yet */
        }
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [url, aiAssist, title]);

  const canSubmit = title.trim().length > 0 && text.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) {
      toast.error('Title and description required.');
      return;
    }
    const input: CaptureInput = {
      title,
      description: text || voiceTranscript,
      mode,
    };
    onCreate?.(input);
    toast.success('Idea captured — AI will score it shortly', {
      description: title,
      duration: 4000,
      progressBar: true,
    });
    // Reset
    setMode('text');
    setText('');
    setUrl('');
    setVoiceTranscript('');
    setFiles([]);
    setBookmarkCount(0);
    setTitle('');
    setChips([]);
    onOpenChange(false);
  };

  const mockExtractFromUrl = () => {
    if (!url) {
      toast.error('Paste a URL first.');
      return;
    }
    setExtracting(true);
    window.setTimeout(() => {
      setText(
        `Key insight from ${url}: customers report X; opportunity to ship Y. (AI-extracted, mock.)`,
      );
      setExtracting(false);
      toast.success('AI extracted the key insight.');
    }, 600);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="capture-modal"
        className="max-w-[640px] rounded-[var(--radius-xl)] border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[var(--text-lg)]">
            <Sparkles className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
            Capture a new idea
          </DialogTitle>
          <DialogDescription className="text-[var(--fg-secondary)]">
            Type, paste, speak, or record. AI scores and clusters once submitted.
          </DialogDescription>
        </DialogHeader>

        {/* Mode tabs */}
        <div
          role="tablist"
          aria-label="Capture mode"
          className="flex gap-1 overflow-x-auto rounded-[var(--radius-md)] bg-[var(--bg-base)] p-1"
        >
          {MODES.map((m) => {
            const Icon = m.Icon;
            const active = mode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(m.value)}
                data-testid={`capture-mode-${m.value}`}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs transition-colors',
                  active
                    ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
                    : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Mode body */}
        <div className="min-h-[180px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          {mode === 'text' ? (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Describe the problem and your proposed approach…"
              rows={6}
              data-testid="capture-text"
              className="resize-none"
            />
          ) : null}

          {mode === 'paste' ? (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste from anywhere — Forge auto-detects lists and bullets."
              rows={6}
              data-testid="capture-paste"
              className="resize-none"
            />
          ) : null}

          {mode === 'url' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="capture-url" className="text-xs text-[var(--fg-secondary)]">
                Paste a Zendesk ticket, GitHub issue, blog post, or any URL.
              </Label>
              <Input
                id="capture-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://acme.zendesk.com/agent/tickets/31402"
                data-testid="capture-url"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={mockExtractFromUrl}
                disabled={extracting}
                className="self-start border-[var(--border-default)] text-[var(--accent-primary)] hover:bg-[rgba(99,102,241,0.08)]"
              >
                {extracting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Extract insight
              </Button>
              {text ? (
                <div className="mt-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-[11px] text-[var(--fg-secondary)]">
                  {text}
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === 'voice' ? (
            <VoiceCapture
              transcript={voiceTranscript}
              setTranscript={setVoiceTranscript}
              onExtractIdeas={(ideas) => {
                setChips(ideas);
                setText(ideas.join('\n\n'));
                if (!title && ideas[0]) setTitle(ideas[0].slice(0, 60));
              }}
            />
          ) : null}

          {mode === 'screen' ? (
            <ScreenCapture
              bookmarkCount={bookmarkCount}
              setBookmarkCount={setBookmarkCount}
              onExtractIdeas={(ideas) => {
                setChips(ideas);
                setText(ideas.join('\n\n'));
                if (!title && ideas[0]) setTitle(ideas[0].slice(0, 60));
              }}
            />
          ) : null}

          {mode === 'file' ? (
            <FileDropZone files={files} setFiles={setFiles} />
          ) : null}
        </div>

        {/* AI-extracted chips */}
        {chips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="capture-chips">
            <span className="text-[10px] uppercase tracking-wider text-[var(--accent-violet)]">
              AI extracted
            </span>
            {chips.map((c, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-[var(--radius-sm)] border border-[rgba(168,85,247,0.35)] bg-[rgba(168,85,247,0.10)] px-2 py-0.5 text-[10px] text-[var(--accent-violet)]"
              >
                {c.length > 60 ? `${c.slice(0, 60)}…` : c}
              </span>
            ))}
          </div>
        ) : null}

        {/* Title + AI assist toggle */}
        <div className="flex flex-col gap-2">
          <div className="space-y-1">
            <Label htmlFor="capture-title" className="text-xs text-[var(--fg-secondary)]">
              Title
            </Label>
            <Input
              id="capture-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Auto-fills from content"
              data-testid="capture-title"
            />
          </div>
          <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[11px]">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent-violet)]" aria-hidden="true" />
              <span className="text-[var(--fg-secondary)]">
                AI assist — asks clarifying questions as you type
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={aiAssist}
              data-testid="capture-ai-assist"
              onClick={() => setAiAssist(!aiAssist)}
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors',
                aiAssist ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-inset)]',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                  aiAssist ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-[var(--fg-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canSubmit}
            onClick={handleSubmit}
            data-testid="capture-save-draft"
            className="border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save as draft
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            data-testid="capture-submit"
            className="bg-[var(--accent-primary)] text-white hover:opacity-90"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Save and score
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Tiny PlusIcon export so consumers can wire their own "+ New Idea" trigger
// using the same visual treatment.
export { Plus as PlusIcon };