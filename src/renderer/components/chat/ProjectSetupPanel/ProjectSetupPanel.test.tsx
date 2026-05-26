import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import ProjectSetupPanel from './ProjectSetupPanel';

const templates = [
  {
    id: 'narrative',
    displayName: 'Narrative Story Video',
    description: 'Story-driven video workflow.',
    defaultStyle: 'cinematic_realism',
    styles: [
      {
        id: 'cinematic_realism',
        displayName: 'Cinematic Realism',
        description: 'High-end cinematic look.',
      },
    ],
  },
];

const durationPresets = {
  narrative: [
    { label: '1 minute', seconds: 60 },
    { label: '2 minutes', seconds: 120 },
  ],
};

const renderMethods = [
  { id: 'shot_by_shot', displayName: 'Shot-by-shot', description: 'Per-shot FL2V.' },
  { id: 'prompt_relay', displayName: 'Prompt relay', description: 'LTX Director continuous render.' },
];

function renderPanel() {
  const onOpenWizard = jest.fn();
  const onEditSetup = jest.fn();
  const onSelectTemplate = jest.fn();
  const onSelectStyle = jest.fn();
  const onSelectDuration = jest.fn();
  const onChangeStory = jest.fn();
  const onSubmitStory = jest.fn();
  const onSelectAutonomousMode = jest.fn();
  const onConfirmSetup = jest.fn();
  const onBack = jest.fn();

  render(
    <ProjectSetupPanel
      mode="wizard"
      step="autonomous"
      templates={templates}
      durationPresets={durationPresets}
      renderMethods={renderMethods}
      selectedTemplateId="narrative"
      selectedStyleId="cinematic_realism"
      selectedDuration={120}
      selectedRenderMethod="shot_by_shot"
      selectedAutonomousMode={false}
      storyInput=""
      loading={false}
      configuring={false}
      error={null}
      onOpenWizard={onOpenWizard}
      onEditSetup={onEditSetup}
      onSelectTemplate={onSelectTemplate}
      onSelectStyle={onSelectStyle}
      onSelectDuration={onSelectDuration}
      onSelectRenderMethod={jest.fn()}
      onChangeStory={onChangeStory}
      onSubmitStory={onSubmitStory}
      onSelectAutonomousMode={onSelectAutonomousMode}
      onConfirmSetup={onConfirmSetup}
      onBack={onBack}
    />,
  );

  return {
    onOpenWizard,
    onEditSetup,
    onSelectTemplate,
    onSelectStyle,
    onSelectDuration,
    onChangeStory,
    onSubmitStory,
    onSelectAutonomousMode,
    onConfirmSetup,
    onBack,
  };
}

describe('ProjectSetupPanel', () => {
  it('renders preview images for template and style selection cards', () => {
    const props = {
      onOpenWizard: jest.fn(),
      onEditSetup: jest.fn(),
      onSelectTemplate: jest.fn(),
      onSelectStyle: jest.fn(),
      onSelectDuration: jest.fn(),
      onChangeStory: jest.fn(),
      onSubmitStory: jest.fn(),
      onSelectAutonomousMode: jest.fn(),
      onConfirmSetup: jest.fn(),
      onBack: jest.fn(),
    };
    const baseProps = {
      mode: 'wizard' as const,
      templates,
      durationPresets,
      selectedTemplateId: 'narrative',
      selectedStyleId: 'cinematic_realism',
      selectedDuration: 120,
      selectedAutonomousMode: false,
      storyInput: '',
      loading: false,
      configuring: false,
      error: null,
      onOpenWizard: props.onOpenWizard,
      onEditSetup: props.onEditSetup,
      onSelectTemplate: props.onSelectTemplate,
      onSelectStyle: props.onSelectStyle,
      onSelectDuration: props.onSelectDuration,
      onChangeStory: props.onChangeStory,
      onSubmitStory: props.onSubmitStory,
      onSelectAutonomousMode: props.onSelectAutonomousMode,
      onConfirmSetup: props.onConfirmSetup,
      onBack: props.onBack,
    };

    const { rerender } = render(
      <ProjectSetupPanel
        step="template"
        mode={baseProps.mode}
        templates={baseProps.templates}
        durationPresets={baseProps.durationPresets}
        renderMethods={renderMethods}
        selectedTemplateId={baseProps.selectedTemplateId}
        selectedStyleId={baseProps.selectedStyleId}
        selectedDuration={baseProps.selectedDuration}
        selectedRenderMethod="shot_by_shot"
        selectedAutonomousMode={baseProps.selectedAutonomousMode}
        storyInput={baseProps.storyInput}
        loading={baseProps.loading}
        configuring={baseProps.configuring}
        error={baseProps.error}
        onOpenWizard={baseProps.onOpenWizard}
        onEditSetup={baseProps.onEditSetup}
        onSelectTemplate={baseProps.onSelectTemplate}
        onSelectStyle={baseProps.onSelectStyle}
        onSelectDuration={baseProps.onSelectDuration}
      onSelectRenderMethod={jest.fn()}
        onChangeStory={baseProps.onChangeStory}
        onSubmitStory={baseProps.onSubmitStory}
        onSelectAutonomousMode={baseProps.onSelectAutonomousMode}
        onConfirmSetup={baseProps.onConfirmSetup}
        onBack={baseProps.onBack}
      />,
    );

    expect(
      screen.getByRole('img', { name: 'Narrative Story Video preview' }),
    ).not.toBeNull();

    rerender(
      <ProjectSetupPanel
        step="style"
        mode={baseProps.mode}
        templates={baseProps.templates}
        durationPresets={baseProps.durationPresets}
        renderMethods={renderMethods}
        selectedTemplateId={baseProps.selectedTemplateId}
        selectedStyleId={baseProps.selectedStyleId}
        selectedDuration={baseProps.selectedDuration}
        selectedRenderMethod="shot_by_shot"
        selectedAutonomousMode={baseProps.selectedAutonomousMode}
        storyInput={baseProps.storyInput}
        loading={baseProps.loading}
        configuring={baseProps.configuring}
        error={baseProps.error}
        onOpenWizard={baseProps.onOpenWizard}
        onEditSetup={baseProps.onEditSetup}
        onSelectTemplate={baseProps.onSelectTemplate}
        onSelectStyle={baseProps.onSelectStyle}
        onSelectDuration={baseProps.onSelectDuration}
      onSelectRenderMethod={jest.fn()}
        onChangeStory={baseProps.onChangeStory}
        onSubmitStory={baseProps.onSubmitStory}
        onSelectAutonomousMode={baseProps.onSelectAutonomousMode}
        onConfirmSetup={baseProps.onConfirmSetup}
        onBack={baseProps.onBack}
      />,
    );

    expect(
      screen.getByRole('img', { name: 'Cinematic Realism preview' }),
    ).not.toBeNull();
  });

  it('renders the autonomous step with a continue action (step kept for back-compat; not part of the user flow today)', () => {
    // The autonomous step lives on but the wizard's user flow no
    // longer routes through it — story.Continue fires confirm
    // directly. We keep the rendering + handler so the step can be
    // surfaced via a future "advanced" UI without re-plumbing.
    const props = renderPanel();
    expect(screen.queryByText('Autonomous Mode')).not.toBeNull();

    fireEvent.click(screen.getByText('Autonomous'));
    expect(props.onSelectAutonomousMode).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(props.onConfirmSetup).toHaveBeenCalled();
  });

  // ── Story step (the new 4 of 5 step that collects the user's seed
  // idea before pi-agent kicks off the project) ─────────────────────

  function renderStoryStep(overrides: {
    storyInput?: string;
    onChangeStory?: jest.Mock;
    onSubmitStory?: jest.Mock;
  } = {}) {
    const onChangeStory = overrides.onChangeStory ?? jest.fn();
    const onSubmitStory = overrides.onSubmitStory ?? jest.fn();
    render(
      <ProjectSetupPanel
        mode="wizard"
        step="story"
        templates={templates}
        durationPresets={durationPresets}
      renderMethods={renderMethods}
        selectedTemplateId="narrative"
        selectedStyleId="cinematic_realism"
        selectedDuration={60}
        selectedRenderMethod="shot_by_shot"
        selectedAutonomousMode={false}
        storyInput={overrides.storyInput ?? ''}
        loading={false}
        configuring={false}
        error={null}
        onOpenWizard={jest.fn()}
        onEditSetup={jest.fn()}
        onSelectTemplate={jest.fn()}
        onSelectStyle={jest.fn()}
        onSelectDuration={jest.fn()}
        onSelectRenderMethod={jest.fn()}
        onChangeStory={onChangeStory}
        onSubmitStory={onSubmitStory}
        onSelectAutonomousMode={jest.fn()}
        onConfirmSetup={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    return { onChangeStory, onSubmitStory };
  }

  // Indicator tests for the collapsed 3-step user flow.

  it('shows "Step 1 of 4" on the style step', () => {
    render(
      <ProjectSetupPanel
        mode="wizard"
        step="style"
        templates={templates}
        durationPresets={durationPresets}
      renderMethods={renderMethods}
        selectedTemplateId="narrative"
        selectedStyleId={null}
        selectedDuration={60}
        selectedRenderMethod="shot_by_shot"
        selectedAutonomousMode={false}
        storyInput=""
        loading={false}
        configuring={false}
        error={null}
        onOpenWizard={jest.fn()}
        onEditSetup={jest.fn()}
        onSelectTemplate={jest.fn()}
        onSelectStyle={jest.fn()}
        onSelectDuration={jest.fn()}
        onSelectRenderMethod={jest.fn()}
        onChangeStory={jest.fn()}
        onSubmitStory={jest.fn()}
        onSelectAutonomousMode={jest.fn()}
        onConfirmSetup={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    expect(screen.queryByText('Step 1 of 4')).not.toBeNull();
    expect(screen.queryByText('Choose a Style')).not.toBeNull();
  });

  it('shows "Step 2 of 4" on the duration step', () => {
    render(
      <ProjectSetupPanel
        mode="wizard"
        step="duration"
        templates={templates}
        durationPresets={durationPresets}
      renderMethods={renderMethods}
        selectedTemplateId="narrative"
        selectedStyleId="cinematic_realism"
        selectedDuration={null}
        selectedRenderMethod="shot_by_shot"
        selectedAutonomousMode={false}
        storyInput=""
        loading={false}
        configuring={false}
        error={null}
        onOpenWizard={jest.fn()}
        onEditSetup={jest.fn()}
        onSelectTemplate={jest.fn()}
        onSelectStyle={jest.fn()}
        onSelectDuration={jest.fn()}
        onSelectRenderMethod={jest.fn()}
        onChangeStory={jest.fn()}
        onSubmitStory={jest.fn()}
        onSelectAutonomousMode={jest.fn()}
        onConfirmSetup={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    expect(screen.queryByText('Step 2 of 4')).not.toBeNull();
    expect(screen.queryByText('Choose Duration')).not.toBeNull();
  });

  it('renders the story step as the third (and final) of three visible steps', () => {
    // The wizard collapsed to 3 user-facing steps: style → duration →
    // story. Template (step 0) is auto-defaulted to 'narrative';
    // autonomous (post-step) is no longer in the user flow.
    renderStoryStep();
    expect(screen.queryByText('Step 4 of 4')).not.toBeNull();
    expect(screen.queryByText('Tell Us the Story')).not.toBeNull();
    // The textarea is rendered with an aria-label.
    expect(
      screen.getByLabelText('Project story or idea'),
    ).not.toBeNull();
  });

  it('disables the Continue button while the story is empty', () => {
    renderStoryStep({ storyInput: '' });
    const button = screen.getByRole('button', {
      name: 'Continue',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('disables the Continue button when the story is whitespace-only', () => {
    renderStoryStep({ storyInput: '    \n  \t  ' });
    const button = screen.getByRole('button', {
      name: 'Continue',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('enables the Continue button once the story has content', () => {
    renderStoryStep({ storyInput: 'A story.' });
    const button = screen.getByRole('button', {
      name: 'Continue',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('fires onChangeStory with the new value when the user types', () => {
    const { onChangeStory } = renderStoryStep({ storyInput: '' });
    const textarea = screen.getByLabelText(
      'Project story or idea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Once upon a time' } });
    expect(onChangeStory).toHaveBeenCalledWith('Once upon a time');
  });

  it('fires onSubmitStory when Continue is clicked with a non-empty story', () => {
    const { onSubmitStory } = renderStoryStep({ storyInput: 'A story.' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmitStory).toHaveBeenCalledTimes(1);
  });

  it('does not fire onSubmitStory when Continue is clicked with empty story (button disabled)', () => {
    const { onSubmitStory } = renderStoryStep({ storyInput: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmitStory).not.toHaveBeenCalled();
  });

  it('shows the autonomous badge in summary mode when enabled', () => {
    render(
      <ProjectSetupPanel
        mode="summary"
        step="autonomous"
        templates={templates}
        durationPresets={durationPresets}
      renderMethods={renderMethods}
        selectedTemplateId="narrative"
        selectedStyleId="cinematic_realism"
        selectedDuration={120}
      selectedRenderMethod="shot_by_shot"
        selectedAutonomousMode
        storyInput=""
        loading={false}
        configuring={false}
        error={null}
        onOpenWizard={jest.fn()}
        onEditSetup={jest.fn()}
        onSelectTemplate={jest.fn()}
        onSelectStyle={jest.fn()}
        onSelectDuration={jest.fn()}
        onSelectRenderMethod={jest.fn()}
        onChangeStory={jest.fn()}
        onSubmitStory={jest.fn()}
        onSelectAutonomousMode={jest.fn()}
        onConfirmSetup={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    expect(screen.queryByText('Autonomous')).not.toBeNull();
  });
});
