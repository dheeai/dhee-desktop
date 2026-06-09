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
}: {
  message: ChatMessage;
  archetype: ToolArchetype;
}) {
  if (message.toolStatus === 'in_progress')
    return <RunningBody message={message} />;
  if (message.toolStatus === 'error') return <ErrorBody message={message} />;

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
  /** When true the card renders as a single collapsed line until clicked. */
  condensed?: boolean;
}

export default function ToolCard({
  message,
  condensed = false,
}: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const name = message.toolName ?? '';
  const archetype = toolArchetype(name);
  const title = humanizeTool(name);
  const object = toolObject(message);

  if (condensed && !expanded) {
    const chip = resultChip(message);
    return (
      <button
        type="button"
        className={styles.line}
        onClick={() => setExpanded(true)}
        aria-expanded={false}
      >
        <span className={`${styles.glyph} ${styles[archetype]}`}>
          {GLYPHS[archetype]}
        </span>
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
      className={`${styles.card} ${styles[archetype]}`}
      data-archetype={archetype}
      data-status={message.toolStatus ?? 'in_progress'}
    >
      <div className={styles.head}>
        <span className={`${styles.glyph} ${styles[archetype]}`}>
          {GLYPHS[archetype]}
        </span>
        <span className={styles.title}>
          {title}
          {object && <span className={styles.object}> {object}</span>}
        </span>
        <StatusDot status={message.toolStatus} />
      </div>
      <ToolBody message={message} archetype={archetype} />
    </div>
  );
}
