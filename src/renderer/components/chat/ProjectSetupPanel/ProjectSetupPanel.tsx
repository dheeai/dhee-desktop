import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import styleAnimePreview from '../../../../../assets/previews/style_anime.png';
import styleCinematicDocumentaryPreview from '../../../../../assets/previews/style_cinematic_documentary.png';
import styleCinematicRealismPreview from '../../../../../assets/previews/style_cinematic_realism.png';
import styleCinematicShortPreview from '../../../../../assets/previews/style_cinematic_short.png';
import styleInfomercialClassicPreview from '../../../../../assets/previews/style_infomercial_classic.png';
import styleLifestylePreview from '../../../../../assets/previews/style_lifestyle.png';
import styleLoFiPreview from '../../../../../assets/previews/style_lo_fi.png';
import styleMinimalCleanPreview from '../../../../../assets/previews/style_minimal_clean.png';
import styleNatureDocumentaryPreview from '../../../../../assets/previews/style_nature_documentary.png';
import styleNewsStylePreview from '../../../../../assets/previews/style_news_style.png';
import styleProfessionalProductPreview from '../../../../../assets/previews/style_professional_product.png';
import styleStylized3dPreview from '../../../../../assets/previews/style_stylized_3d.png';
import styleTechSleekPreview from '../../../../../assets/previews/style_tech_sleek.png';
import styleViralAestheticPreview from '../../../../../assets/previews/style_viral_aesthetic.png';
import styleWatercolorPreview from '../../../../../assets/previews/style_watercolor.png';
import templateDocumentaryPreview from '../../../../../assets/previews/template_documentary.png';
import templateGraphicNovelPreview from '../../../../../assets/previews/template_graphic_novel.png';
import templateInfomercialPreview from '../../../../../assets/previews/template_infomercial.png';
import templateNarrativePreview from '../../../../../assets/previews/template_narrative.png';
import templateShortPreview from '../../../../../assets/previews/template_short.png';
import styles from './ProjectSetupPanel.module.scss';

export interface SetupStyleOption {
  id: string;
  displayName: string;
  description?: string;
}

export interface SetupTemplateOption {
  id: string;
  displayName: string;
  description?: string;
  defaultStyle?: string;
  styles: SetupStyleOption[];
}

export interface SetupDurationOption {
  label: string;
  seconds: number;
}

export interface SetupRenderMethodOption {
  /** Must match a value in kshana-core's `RenderMethod` type. */
  id: string;
  displayName: string;
  description: string;
}

const TEMPLATE_PREVIEW_SRC: Record<string, string> = {
  documentary: templateDocumentaryPreview,
  graphic_novel: templateGraphicNovelPreview,
  infomercial: templateInfomercialPreview,
  narrative: templateNarrativePreview,
  short: templateShortPreview,
};

const STYLE_PREVIEW_SRC: Record<string, string> = {
  anime: styleAnimePreview,
  cinematic_documentary: styleCinematicDocumentaryPreview,
  cinematic_realism: styleCinematicRealismPreview,
  cinematic_short: styleCinematicShortPreview,
  infomercial_classic: styleInfomercialClassicPreview,
  lifestyle: styleLifestylePreview,
  lo_fi: styleLoFiPreview,
  minimal_clean: styleMinimalCleanPreview,
  nature_documentary: styleNatureDocumentaryPreview,
  news_style: styleNewsStylePreview,
  professional_product: styleProfessionalProductPreview,
  stylized_3d: styleStylized3dPreview,
  tech_sleek: styleTechSleekPreview,
  viral_aesthetic: styleViralAestheticPreview,
  watercolor: styleWatercolorPreview,
};

export type SetupStep = 'template' | 'configure' | 'story' | 'autonomous';
export type SetupPanelMode = 'hidden' | 'banner' | 'wizard' | 'summary';

interface ProjectSetupPanelProps {
  mode: SetupPanelMode;
  step: SetupStep;
  templates: SetupTemplateOption[];
  durationPresets: Record<string, SetupDurationOption[]>;
  renderMethods: SetupRenderMethodOption[];
  selectedTemplateId: string | null;
  selectedStyleId: string | null;
  selectedDuration: number | null;
  selectedRenderMethod: string | null;
  selectedAutonomousMode: boolean;
  storyInput: string;
  loading: boolean;
  configuring: boolean;
  error: string | null;
  onOpenWizard: () => void;
  onEditSetup: () => void;
  onSelectTemplate: (templateId: string) => void;
  onSelectStyle: (styleId: string) => void;
  onSelectDuration: (seconds: number) => void;
  onSelectRenderMethod: (methodId: string) => void;
  onChangeStory: (value: string) => void;
  onSubmitStory: () => void;
  onSelectAutonomousMode: (enabled: boolean) => void;
  onConfirmSetup: () => void;
  /** Advance from the combined Configure step to Story. The caller is responsible for blocking the advance when not all three sections are selected; the panel's Continue button is disabled in that case. */
  onConfigureContinue: () => void;
  onBack: () => void;
}

function formatDuration(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${seconds} seconds`;
}

function renderCardPreview(
  previewSrc: string | undefined,
  label: string,
): ReactElement {
  if (previewSrc) {
    return (
      <div className={styles.cardPreview}>
        <img
          src={previewSrc}
          alt={`${label} preview`}
          className={styles.cardPreviewImage}
        />
      </div>
    );
  }

  return (
    <div className={`${styles.cardPreview} ${styles.cardPreviewPlaceholder}`}>
      <span>{label}</span>
    </div>
  );
}

export default function ProjectSetupPanel({
  mode,
  step,
  templates,
  durationPresets,
  renderMethods,
  selectedTemplateId,
  selectedStyleId,
  selectedDuration,
  selectedRenderMethod,
  selectedAutonomousMode,
  storyInput,
  loading,
  configuring,
  error,
  onOpenWizard,
  onEditSetup,
  onSelectTemplate,
  onSelectStyle,
  onSelectDuration,
  onSelectRenderMethod,
  onChangeStory,
  onSubmitStory,
  onSelectAutonomousMode,
  onConfirmSetup,
  onConfigureContinue,
  onBack,
}: ProjectSetupPanelProps) {
  const [customDuration, setCustomDuration] = useState('');

  const selectedTemplate = useMemo(
    () =>
      templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  const selectedStyle = useMemo(
    () =>
      selectedTemplate?.styles.find((style) => style.id === selectedStyleId) ??
      null,
    [selectedStyleId, selectedTemplate],
  );

  const selectedDurationLabel = useMemo(() => {
    if (!selectedTemplateId || !selectedDuration) return null;
    const preset = (durationPresets[selectedTemplateId] || []).find(
      (option) => option.seconds === selectedDuration,
    );
    return preset?.label || formatDuration(selectedDuration);
  }, [durationPresets, selectedDuration, selectedTemplateId]);

  const styleOptions = useMemo(
    () => selectedTemplate?.styles || [],
    [selectedTemplate],
  );
  const durationOptions = useMemo(
    () => (selectedTemplateId ? durationPresets[selectedTemplateId] || [] : []),
    [durationPresets, selectedTemplateId],
  );

  useEffect(() => {
    if (mode !== 'wizard') return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      // Story step uses a textarea — let the user type freely.
      if (step === 'story') return;
      // Don't hijack digits when the user is actively typing into a
      // form control. The duration step in particular has a custom
      // "seconds" input alongside the preset chips — without this
      // bail-out, typing "3" to start "300" would fire the "preset
      // chip 3" handler (2 minutes) instead of landing in the input.
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      if (event.key < '1' || event.key > '9') return;

      const index = Number(event.key) - 1;
      if (step === 'template') {
        const target = templates[index];
        if (!target) return;
        event.preventDefault();
        onSelectTemplate(target.id);
        return;
      }

      if (step === 'autonomous') {
        if (index > 1) return;
        event.preventDefault();
        onSelectAutonomousMode(index === 1);
        return;
      }

      // Combined 'configure' step has style + duration + method
      // sections visible together; keyboard shortcuts are ambiguous
      // when multiple groups share the same 1..N keys. Skip them in
      // configure — users click; nothing else stops them.
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    durationOptions,
    mode,
    onSelectDuration,
    onSelectAutonomousMode,
    onSelectRenderMethod,
    onSelectStyle,
    onSelectTemplate,
    renderMethods,
    step,
    styleOptions,
    templates,
  ]);

  const submitCustomDuration = () => {
    const seconds = Number.parseInt(customDuration, 10);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return;
    }
    onSelectDuration(seconds);
    setCustomDuration('');
  };

  if (mode === 'hidden') {
    return null;
  }

  if (mode === 'banner') {
    return (
      <div className={styles.banner}>
        <div className={styles.bannerLeft}>
          <Settings2 size={15} />
          <span>Configure Project Setup</span>
        </div>
        <button
          type="button"
          className={styles.bannerButton}
          onClick={onOpenWizard}
        >
          Start Setup
        </button>
      </div>
    );
  }

  if (mode === 'summary') {
    return (
      <div className={styles.summary}>
        <div className={styles.summaryHeader}>
          <div className={styles.summaryTitle}>
            <Sparkles size={14} />
            <span>Project Setup</span>
          </div>
          <button
            type="button"
            className={styles.summaryEdit}
            onClick={onEditSetup}
          >
            Edit
          </button>
        </div>
        <div className={styles.summaryTags}>
          <span className={styles.tag}>
            {selectedTemplate?.displayName || 'Narrative Story Video'}
          </span>
          <span className={styles.tag}>
            {selectedStyle?.displayName || 'Cinematic Realism'}
          </span>
          <span className={styles.tag}>
            {selectedDurationLabel || '2 minutes'}
          </span>
          {selectedAutonomousMode && (
            <span className={`${styles.tag} ${styles.autonomousTag}`}>
              Autonomous
            </span>
          )}
        </div>
        {(configuring || error) && (
          <div className={styles.summaryStatus}>
            {configuring ? (
              <>
                <RefreshCw size={13} className={styles.spin} />
                Configuring session...
              </>
            ) : (
              <span className={styles.errorText}>{error}</span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.wizard}>
      <div className={styles.wizardHeader}>
        <div className={styles.wizardTitleRow}>
          {step !== 'template' && (
            <button
              type="button"
              className={styles.backButton}
              onClick={onBack}
              disabled={loading || configuring}
              aria-label="Back to previous setup step"
            >
              <ChevronLeft size={14} />
            </button>
          )}
          <span className={styles.wizardStep}>
            {step === 'template' && 'Setup'}
            {step === 'configure' && 'Step 1 of 2'}
            {step === 'story' && 'Step 2 of 2'}
            {step === 'autonomous' && 'Setup'}
          </span>
        </div>
        <h3 className={styles.wizardTitle}>
          {step === 'template' && 'Choose a Template'}
          {step === 'configure' && 'Choose Style, Duration & Method'}
          {step === 'story' && 'Tell Us the Story'}
          {step === 'autonomous' && 'Autonomous Mode'}
        </h3>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading options...</div>
      ) : (
        <>
          {step === 'template' && (
            <div className={styles.cardsGrid}>
              {templates.map((template, index) => (
                <button
                  type="button"
                  key={template.id}
                  className={`${styles.card} ${
                    selectedTemplateId === template.id
                      ? styles.cardSelected
                      : ''
                  }`}
                  onClick={() => onSelectTemplate(template.id)}
                  disabled={configuring}
                >
                  {renderCardPreview(
                    TEMPLATE_PREVIEW_SRC[template.id],
                    template.displayName,
                  )}
                  <div className={styles.cardContent}>
                    <span className={styles.cardIndex}>{index + 1}</span>
                    <span className={styles.cardName}>
                      {template.displayName}
                    </span>
                    <span className={styles.cardDescription}>
                      {template.description || 'No description'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 'configure' && (
            <div className={styles.configureSections}>
              <section className={styles.configureSection}>
                <h3 className={styles.configureSectionTitle}>Style</h3>
                <div className={styles.cardsGrid}>
                  {styleOptions.map((style, index) => (
                    <button
                      type="button"
                      key={style.id}
                      className={`${styles.card} ${
                        selectedStyleId === style.id ? styles.cardSelected : ''
                      }`}
                      onClick={() => onSelectStyle(style.id)}
                      disabled={configuring}
                    >
                      {renderCardPreview(
                        STYLE_PREVIEW_SRC[style.id],
                        style.displayName,
                      )}
                      <div className={styles.cardContent}>
                        <span className={styles.cardIndex}>{index + 1}</span>
                        <span className={styles.cardName}>
                          {style.displayName}
                        </span>
                        <span className={styles.cardDescription}>
                          {style.description || 'No description'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className={styles.configureSection}>
                <h3 className={styles.configureSectionTitle}>Duration</h3>
                <div className={styles.durationRow}>
                  {durationOptions.map((duration, index) => (
                    <button
                      type="button"
                      key={`${duration.seconds}-${duration.label}`}
                      className={`${styles.durationButton} ${
                        selectedDuration === duration.seconds
                          ? styles.durationSelected
                          : ''
                      }`}
                      onClick={() => onSelectDuration(duration.seconds)}
                      disabled={configuring}
                    >
                      {index + 1}. {duration.label}
                    </button>
                  ))}
                </div>
                <div className={styles.customDurationRow}>
                  <input
                    type="number"
                    min={1}
                    className={styles.customInput}
                    placeholder="seconds"
                    value={customDuration}
                    onChange={(event) => setCustomDuration(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        submitCustomDuration();
                      }
                    }}
                    disabled={configuring}
                  />
                  <button
                    type="button"
                    className={styles.customSet}
                    onClick={submitCustomDuration}
                    disabled={configuring}
                  >
                    Set
                  </button>
                </div>
              </section>

              <section className={styles.configureSection}>
                <h3 className={styles.configureSectionTitle}>
                  Generation Method
                </h3>
                <div className={styles.methodList}>
                  {renderMethods.map((method, index) => (
                    <button
                      type="button"
                      key={method.id}
                      className={`${styles.methodCard} ${
                        selectedRenderMethod === method.id
                          ? styles.methodSelected
                          : ''
                      }`}
                      onClick={() => onSelectRenderMethod(method.id)}
                      disabled={configuring}
                    >
                      <div className={styles.methodCardHeader}>
                        <span className={styles.methodCardIndex}>
                          {index + 1}.
                        </span>
                        <span className={styles.methodCardTitle}>
                          {method.displayName}
                        </span>
                      </div>
                      <div className={styles.methodCardDescription}>
                        {method.description}
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <div className={styles.autonomousFooter}>
                <button
                  type="button"
                  className={styles.continueButton}
                  onClick={onConfigureContinue}
                  disabled={
                    configuring ||
                    !selectedStyleId ||
                    !selectedDuration ||
                    !selectedRenderMethod
                  }
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 'story' && (
            <>
              <textarea
                className={styles.storyTextarea}
                placeholder="A noir detective walks into the rain... or paste a longer story / outline here. The agent will build everything from this seed."
                rows={8}
                value={storyInput}
                onChange={(event) => onChangeStory(event.target.value)}
                disabled={configuring}
                aria-label="Project story or idea"
              />
              <div className={styles.autonomousFooter}>
                <button
                  type="button"
                  className={styles.continueButton}
                  onClick={onSubmitStory}
                  disabled={configuring || storyInput.trim().length === 0}
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {step === 'autonomous' && (
            <>
              <div className={styles.cardsGrid}>
                <button
                  type="button"
                  className={`${styles.card} ${
                    !selectedAutonomousMode ? styles.cardSelected : ''
                  }`}
                  onClick={() => onSelectAutonomousMode(false)}
                  disabled={configuring}
                >
                  <span className={styles.cardIndex}>1</span>
                  <span className={styles.cardName}>Manual</span>
                  <span className={styles.cardDescription}>
                    Pause for user decisions and keep the normal ask-user flow.
                  </span>
                </button>
                <button
                  type="button"
                  className={`${styles.card} ${
                    selectedAutonomousMode ? styles.cardSelected : ''
                  }`}
                  onClick={() => onSelectAutonomousMode(true)}
                  disabled={configuring}
                >
                  <span className={styles.cardIndex}>2</span>
                  <span className={styles.cardName}>Autonomous</span>
                  <span className={styles.cardDescription}>
                    Skip the ask-user cycle and keep the workflow moving
                    automatically.
                  </span>
                </button>
              </div>
              <div className={styles.autonomousFooter}>
                <button
                  type="button"
                  className={styles.continueButton}
                  onClick={onConfirmSetup}
                  disabled={configuring}
                >
                  {configuring ? 'Configuring...' : 'Continue'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {error && <div className={styles.errorText}>{error}</div>}
    </div>
  );
}
