import { PROJECT_PATHS } from '../../../types/dhee';

export interface AudioImportProjectBridge {
  selectAudioFile: () => Promise<string | null>;
  createFolder: (
    basePath: string,
    relativePath: string,
  ) => Promise<string | null>;
  copy: (sourcePath: string, destDir: string) => Promise<string>;
}

export interface ImportedAudioResult {
  sourcePath: string;
  destinationPath: string;
  relativePath: string;
  fileName: string;
}

export async function importAudioFromFileToProject({
  projectDirectory,
  projectBridge,
}: {
  projectDirectory: string | null;
  projectBridge: AudioImportProjectBridge;
}): Promise<ImportedAudioResult | null> {
  if (!projectDirectory) return null;

  try {
    const audioPath = await projectBridge.selectAudioFile();
    if (!audioPath) return null;

    const audioFolder = await PROJECT_PATHS.AGENT_AUDIO.split('/')
      .filter(Boolean)
      .reduce<Promise<string>>(
        (basePathPromise, part) =>
          basePathPromise.then(async (basePath) => {
            await projectBridge.createFolder(basePath, part);
            return `${basePath}/${part}`;
          }),
        Promise.resolve(projectDirectory),
      );

    const destinationPath = await projectBridge.copy(audioPath, audioFolder);
    const normalizedDestinationPath = destinationPath.replace(/\\/g, '/');
    const fileName =
      normalizedDestinationPath.split('/').pop() ?? 'Audio Track';
    // The canonical project-relative path lives at
    // PROJECT_PATHS.AGENT_AUDIO regardless of where the copy bridge
    // actually wrote on disk (some bridges resolve to absolute paths
    // outside the project root). The manifest stores this canonical
    // form so renderers can resolve back via projectDirectory + path.
    const relativePath = `${PROJECT_PATHS.AGENT_AUDIO}/${fileName}`;

    return {
      sourcePath: audioPath,
      destinationPath: normalizedDestinationPath,
      relativePath,
      fileName,
    };
  } catch {
    return null;
  }
}
