/**
 * Contextual call-to-action shown in the empty chat area when the
 * user opens a project that is past the wizard but hasn't been
 * touched in this session yet. The state classifier
 * (`classifyProjectState`) decides which variant to render:
 *
 *   in_progress → "Continue where you left off"
 *   completed   → "Your project is ready"
 *
 * Each action carries a pre-formatted natural-language task that the
 * caller dispatches via session.runTask. The task strings include the
 * absolute `projectDir` so pi-agent's tools (kshana_run_to,
 * kshana_status, kshana_show_final_video, …) skip their default
 * `<basePath>/<name>.kshana` probe and operate on the host's path.
 */
import type { CSSProperties } from 'react';
import { ArrowRight, Edit3, FileText, Play, RotateCcw, Wand2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ProjectLifecycleState } from './classifyProjectState';

export interface CTAAction {
  id: string;
  label: string;
  helper?: string;
  task: string;
  variant: 'primary' | 'secondary';
  icon: LucideIcon;
}

export interface CTABlueprint {
  title: string;
  body: string;
  actions: CTAAction[];
}

interface ProjectCTAProps {
  state: Exclude<ProjectLifecycleState, 'fresh'>;
  projectName: string;
  projectDir: string;
  onAction: (action: CTAAction) => void;
}

function paramBlock(projectName: string, projectDir: string): string {
  // Quoted args make the param boundaries unambiguous when the LLM
  // serialises them into a tool call. Tested in ProjectCTA.test.tsx.
  return `project="${projectName}" projectDir="${projectDir}"`;
}

function buildActions(
  state: Exclude<ProjectLifecycleState, 'fresh'>,
  projectName: string,
  projectDir: string,
): CTABlueprint {
  const params = paramBlock(projectName, projectDir);

  if (state === 'in_progress') {
    return {
      title: 'Continue where you left off',
      body: `${projectName} is set up and partially generated. Pick up the pipeline, inspect the current state, or jump in and edit.`,
      actions: [
        {
          id: 'continue_pipeline',
          label: 'Continue the pipeline',
          helper: 'Run kshana_run_to until the final video is rendered.',
          task: `Continue running the kshana pipeline for ${params} all the way to completion. Use kshana_run_to with no stage so it runs to the end. Stream progress as nodes finish.`,
          variant: 'primary',
          icon: Play,
        },
        {
          id: 'check_status',
          label: 'Show me the current status',
          helper: 'List which stages are done, in progress, or failed.',
          task: `Use kshana_status with ${params} and summarise where the project stands — which stages are complete, which are pending, and any failures.`,
          variant: 'secondary',
          icon: FileText,
        },
        {
          id: 'edit_scene',
          label: 'I want to edit a scene or shot',
          helper:
            'Pick a specific scene/shot and either edit its prompt or regenerate it.',
          task: `For ${params}, list the scenes and shots that exist so I can choose one to edit. Use kshana_list_items.`,
          variant: 'secondary',
          icon: Edit3,
        },
      ],
    };
  }

  // state === 'completed'
  return {
    title: 'Your project is ready',
    body: `${projectName} has a final video. You can preview it, polish a specific shot, or rerun a stage with new inputs.`,
    actions: [
      {
        id: 'show_final_video',
        label: 'Show me the final video',
        helper: 'Render the assembled cut inline.',
        task: `Use kshana_show_final_video with ${params}.`,
        variant: 'primary',
        icon: Play,
      },
      {
        id: 'polish_shot',
        label: 'Polish a specific shot',
        helper: 'Pick a shot to refine its prompt and regenerate.',
        task: `For ${params}, list the shots so I can choose one to polish. Use kshana_list_items filtered to shots.`,
        variant: 'secondary',
        icon: Wand2,
      },
      {
        id: 'rerun_stage',
        label: 'Re-run a stage with edits',
        helper: 'Reset to a stage and re-run from there.',
        task: `For ${params}, walk me through which stage I want to reset (kshana_reset) and then re-run from there with kshana_run_to.`,
        variant: 'secondary',
        icon: RotateCcw,
      },
    ],
  };
}

export default function ProjectCTA({
  state,
  projectName,
  projectDir,
  onAction,
}: ProjectCTAProps) {
  const blueprint = buildActions(state, projectName, projectDir);

  return (
    <div
      role="region"
      aria-label="Project next steps"
      style={{
        margin: '8px 4px',
        padding: 16,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid #2a2c30',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#e3e3e3',
            marginBottom: 4,
          }}
        >
          {blueprint.title}
        </div>
        <div style={{ fontSize: 12, color: '#8b95a4', lineHeight: 1.5 }}>
          {blueprint.body}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {blueprint.actions.map((action) => (
          <ActionRow key={action.id} action={action} onClick={() => onAction(action)} />
        ))}
      </div>
    </div>
  );
}

function ActionRow({
  action,
  onClick,
}: {
  action: CTAAction;
  onClick: () => void;
}) {
  const isPrimary = action.variant === 'primary';
  const Icon = action.icon;
  const baseStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    border: '1px solid',
    borderColor: isPrimary ? 'rgba(120,160,220,0.45)' : '#2a2c30',
    borderRadius: 8,
    background: isPrimary ? 'rgba(120,160,220,0.08)' : 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 120ms ease, border-color 120ms ease',
    fontFamily: 'inherit',
    width: '100%',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={action.label}
      style={baseStyle}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.background = isPrimary
          ? 'rgba(120,160,220,0.14)'
          : 'rgba(255,255,255,0.05)';
        el.style.borderColor = isPrimary
          ? 'rgba(120,160,220,0.6)'
          : '#3a3c40';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.background = isPrimary
          ? 'rgba(120,160,220,0.08)'
          : 'transparent';
        el.style.borderColor = isPrimary
          ? 'rgba(120,160,220,0.45)'
          : '#2a2c30';
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 26,
          height: 26,
          flexShrink: 0,
          borderRadius: 6,
          background: isPrimary ? '#3a7aa1' : '#26282d',
          color: isPrimary ? '#fff' : '#a8b0bd',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={14} strokeWidth={2.2} />
      </span>
      <span
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500 }}>{action.label}</span>
        {action.helper && (
          <span
            style={{
              fontSize: 11,
              color: '#7a8190',
              lineHeight: 1.4,
            }}
          >
            {action.helper}
          </span>
        )}
      </span>
      <ArrowRight
        size={14}
        style={{ flexShrink: 0, opacity: isPrimary ? 0.85 : 0.4 }}
      />
    </button>
  );
}

// Test-only export — the buildActions logic is the contract pi-agent
// depends on (every action must include projectDir + project args).
// Exposed so we can pin that without rendering the full component.
export const __testing__ = { buildActions };
