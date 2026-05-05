import type { SetupPanelMode } from '../ProjectSetupPanel';

interface ShouldAutoOpenWizardArgs {
  projectDirectory: string | null;
  isProjectSetupConfigured: boolean;
  setupPanelMode: SetupPanelMode;
  templateCatalogLoaded: boolean;
  isConfiguringProjectSetup: boolean;
}

export function shouldAutoOpenWizard(args: ShouldAutoOpenWizardArgs): boolean {
  if (!args.projectDirectory) return false;
  if (args.isProjectSetupConfigured) return false;
  if (args.isConfiguringProjectSetup) return false;
  if (!args.templateCatalogLoaded) return false;
  if (args.setupPanelMode !== 'hidden') return false;
  return true;
}
