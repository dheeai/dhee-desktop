/* eslint-disable react/require-default-props */
import { useState, type ReactNode } from 'react';
import {
  Activity,
  Pencil,
  Image as ImageIcon,
  Layers,
  Play,
  HelpCircle,
  Box,
  FolderPlus,
  Terminal,
  Wrench,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import type { ChatMessage } from '../ChatPanelEmbedded/chatMessageModel';
import {
  toolArchetype,
  humanizeTool,
  toolObject,
  resultChip,
  classifyFailure,
  type ToolArchetype,
} from '../ChatPanelEmbedded/toolPresentation';
import {
  parseStatusCounts,
  parseVersionList,
  type StatusCounts,
  type VersionRow,
} from '../ChatPanelEmbedded/toolResultParsers';
import { extractRehydratedMedia } from '../ChatPanelEmbedded/rehydratedMedia';
import {
  resolveMediaSrc,
  cacheBustMediaSrc,
} from '../ChatPanelEmbedded/mediaResolution';
import styles from './ToolCard.module.scss';

const GLYPHS: Record<ToolArchetype, ReactNode> = {
  inspection: <Activity size={11} />,
  edit: <Pencil size={11} />,
  artifact: <ImageIcon size={11} />,
  takes: <Layers size={11} />,
  run: <Play size={11} />,
  ask: <HelpCircle size={11} />,
  bundle: <Box size={11} />,
  lifecycle: <FolderPlus size={11} />,
  fs: <Terminal size={11} />,
  generic: <Wrench size={11} />,
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

interface MissingRef {
  nodeType?: string;
  inputField?: string;
}
function asMissingRefs(value: unknown): MissingRef[] {
  return Array.isArray(value)
    ? value.filter((v): v is MissingRef => !!v && typeof v === 'object')
    : [];
}

function StatusBody({ counts }: { counts: StatusCounts }) {
  const seg = (n: number) =>
    counts.total ? `${(n / counts.total) * 100}%` : '0%';
  return (
    <div className={styles.body}>
      <div className={styles.statline}>
        <span className={styles.stat}>
          <i className={`${styles.sd} ${styles.done}`} />
          <b>{counts.completed}</b> done
        </span>
        {counts.inProgress > 0 && (
          <span className={styles.stat}>
            <i className={`${styles.sd} ${styles.run}`} />
            <b>{counts.inProgress}</b> running
          </span>
        )}
        <span className={styles.stat}>
          <i className={`${styles.sd} ${styles.pend}`} />
          <b>{counts.pending}</b> pending
        </span>
        {counts.failed > 0 && (
          <span className={styles.stat}>
            <i className={`${styles.sd} ${styles.fail}`} />
            <b>{counts.failed}</b> failed
          </span>
        )}
      </div>
      <div
        className={styles.segbar}
        role="progressbar"
        aria-label="Node completion"
        aria-valuenow={counts.completed}
        aria-valuemin={0}
        aria-valuemax={counts.total}
      >
        <i className={styles.done} style={{ width: seg(counts.completed) }} />
        <i className={styles.run} style={{ width: seg(counts.inProgress) }} />
        <i className={styles.fail} style={{ width: seg(counts.failed) }} />
        <i className={styles.pend} style={{ width: seg(counts.pending) }} />
      </div>
    </div>
  );
}

function CascadeBody({ source, nodes }: { source?: string; nodes: string[] }) {
  const shown = nodes.slice(0, 3);
  const rest = nodes.length - shown.length;
  return (
    <div className={styles.body}>
      <div className={styles.cascade}>
        {source && <span className={styles.src}>{source}</span>}
        <span className={styles.arr}>&rarr;</span>
        {shown.map((n) => (
          <span key={n} className={`${styles.node} ${styles.warn}`}>
            {n}
          </span>
        ))}
        {rest > 0 && <span className={styles.arr}>+{rest}</span>}
      </div>
      <div className={styles.cascNote}>
        Re-runs <b>{nodes.length}</b> downstream{' '}
        {nodes.length === 1 ? 'node' : 'nodes'} &middot; prior takes preserved
      </div>
    </div>
  );
}

function TakesBody({ versions }: { versions: VersionRow[] }) {
  return (
    <div className={styles.body}>
      <div className={styles.takes}>
        {versions.map((v) => (
          <div
            key={v.id}
            className={`${styles.take} ${v.selected ? styles.sel : ''}`}
          >
            <span className={styles.star}>{v.selected ? '★' : ''}</span>
            <span className={styles.takeId}>{v.id}</span>
            <span className={styles.takeMeta}>
              {v.tool ?? '?'}
              {v.cost ? ` · ${v.cost}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MissingRefsBody({ refs }: { refs: MissingRef[] }) {
  return (
    <div className={styles.body}>
      <div
        className={styles.cascNote}
        style={{ marginTop: 0, marginBottom: 9 }}
      >
        {refs.length} model {refs.length === 1 ? 'ref' : 'refs'} missing on this
        endpoint
      </div>
      <div className={styles.cascade}>
        {refs.map((r) => (
          <span
            key={`${r.nodeType ?? 'node'}.${r.inputField ?? ''}`}
            className={`${styles.node} ${styles.warn}`}
          >
            {r.nodeType ?? 'node'}
            {r.inputField ? `.${r.inputField}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function ErrorBody({ message }: { message: ChatMessage }) {
  const cls = classifyFailure(message.toolResultText);
  return (
    <div className={styles.body}>
      <div className={styles.errmsg}>
        {message.toolResultText || 'Tool failed.'}
      </div>
      <span className={`${styles.classchip} ${styles[cls]}`}>
        {cls === 'transient'
          ? 'Transient · retryable'
          : 'Structural · fix the node'}
      </span>
    </div>
  );
}

function RunningBody({ message }: { message: ChatMessage }) {
  return (
    <div className={styles.body}>
      <div className={styles.running}>
        <Loader2 size={12} className={styles.spin} />
        <span>{message.toolArgsSummary || 'Working…'}</span>
      </div>
    </div>
  );
}

function ArtifactBody({
  message,
  projectDirectory,
}: {
  message: ChatMessage;
  projectDirectory: string | null;
}) {
  const media = extractRehydratedMedia({
    details: message.toolDetails,
    resultText: message.toolResultText,
  });
  if (!media) return <GenericBody message={message} />;
  const src = cacheBustMediaSrc(
    resolveMediaSrc(media.path, projectDirectory),
    media.createdAt ?? null,
  );
  return (
    <div className={styles.artifactBody}>
      {media.kind === 'image' ? (
        <img
          src={src}
          alt={media.path.split('/').pop() ?? 'artifact'}
          className={styles.artifactMedia}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <video
          src={src}
          controls
          preload="metadata"
          className={styles.artifactMedia}
        />
      )}
    </div>
  );
}

function GenericBody({ message }: { message: ChatMessage }) {
  const text = (message.toolResultText ?? message.toolArgsSummary ?? '').trim();
  if (!text) return null;
  return (
    <div className={styles.body}>
      <div className={styles.generic}>{text}</div>
    </div>
  );
}

function ToolBody({
  message,
  archetype,
  projectDirectory,
}: {
  message: ChatMessage;
  archetype: ToolArchetype;
  projectDirectory: string | null;
}) {
  if (message.toolStatus === 'in_progress')
    return <RunningBody message={message} />;
  if (message.toolStatus === 'error') return <ErrorBody message={message} />;

  // Artifact tools render their image/video INSIDE the card so it folds with
  // the card (was previously a separate media row that stayed on collapse).
  if (archetype === 'artifact') {
    return <ArtifactBody message={message} projectDirectory={projectDirectory} />;
  }

  const name = message.toolName ?? '';

  if (name === 'dhee_get_status' && message.toolResultText) {
    const counts = parseStatusCounts(message.toolResultText);
    if (counts) return <StatusBody counts={counts} />;
  }

  if (archetype === 'edit') {
    const nodes = asStringArray(message.toolDetails?.affectedNodes);
    if (nodes.length > 0)
      return <CascadeBody source={toolObject(message)} nodes={nodes} />;
  }

  if (name === 'dhee_list_versions' && message.toolResultText) {
    const versions = parseVersionList(message.toolResultText);
    if (versions.length > 0) return <TakesBody versions={versions} />;
  }

  if (name === 'dhee_check_workflow') {
    const refs = asMissingRefs(message.toolDetails?.missing_refs);
    if (refs.length > 0) return <MissingRefsBody refs={refs} />;
  }

  return <GenericBody message={message} />;
}

function StatusDot({ status }: { status: ChatMessage['toolStatus'] }) {
  if (status === 'in_progress')
    return <Loader2 size={13} className={styles.spin} />;
  return (
    <span
      className={`${styles.statusDot} ${status === 'error' ? styles.error : ''}`}
      aria-hidden="true"
    />
  );
}

export interface ToolCardProps {
  message: ChatMessage;
  /**
   * Sets the INITIAL fold state — condensed cards (superseded ones) start
   * collapsed, the live-edge card starts open. Either way the user can
   * toggle; a manual toggle sticks even if the card is later superseded.
   */
  condensed?: boolean;
  /** For resolving artifact file paths to displayable src URLs. */
  projectDirectory?: string | null;
}

export default function ToolCard({
  message,
  condensed = false,
  projectDirectory = null,
}: ToolCardProps) {
  // null = follow `condensed`; true/false = a sticky manual choice.
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? !condensed;
  const name = message.toolName ?? '';
  const archetype = toolArchetype(name);
  const title = humanizeTool(name);
  const object = toolObject(message);

  if (!expanded) {
    const chip = resultChip(message);
    return (
      <button
        type="button"
        className={styles.line}
        data-archetype={archetype}
        onClick={() => setOverride(true)}
        aria-expanded={false}
        aria-label={`Expand: ${title}`}
      >
        <span className={styles.glyph}>{GLYPHS[archetype]}</span>
        <span className={styles.lineTitle}>
          {title}
          {object && <b> {object}</b>}
        </span>
        {chip && <span className={styles.chip}>{chip}</span>}
        <ChevronDown size={13} className={styles.exp} />
      </button>
    );
  }

  return (
    <div
      className={styles.card}
      data-archetype={archetype}
      data-status={message.toolStatus ?? 'in_progress'}
    >
      {/* The whole header toggles — every card collapses, click anywhere. */}
      <button
        type="button"
        className={`${styles.head} ${styles.headToggle}`}
        onClick={() => setOverride(false)}
        aria-expanded
        aria-label={`Collapse: ${title}`}
      >
        <span className={styles.glyph}>{GLYPHS[archetype]}</span>
        <span className={styles.title}>
          {title}
          {object && <span className={styles.object}> {object}</span>}
        </span>
        <StatusDot status={message.toolStatus} />
        <ChevronUp size={14} className={styles.headChevron} aria-hidden="true" />
      </button>
      <ToolBody
        message={message}
        archetype={archetype}
        projectDirectory={projectDirectory}
      />
    </div>
  );
}
