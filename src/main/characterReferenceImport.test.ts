import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  addCharacterReferenceInputsToProject,
  addReferenceImageInputsToProject,
  importCharacterReferenceAttachments,
  importReferenceImageAttachments,
} from './characterReferenceImport';
import type { Attachment } from '../shared/attachmentTypes';

let tempDir: string;
let projectDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'dhee-desktop-charrefs-'));
  projectDir = join(tempDir, 'demo.dhee');
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function sourceAttachment(filename: string): Attachment {
  const sourcePath = join(tempDir, filename);
  writeFileSync(sourcePath, 'image');
  return {
    id: `att_${filename}`,
    kind: 'character_ref',
    path: sourcePath,
    name: filename,
    mimeType: 'image/png',
  };
}

function referenceAttachment(
  filename: string,
  referenceRole: 'auto' | 'character' | 'setting' = 'auto',
): Attachment {
  const sourcePath = join(tempDir, filename);
  writeFileSync(sourcePath, 'image');
  return {
    id: `att_${filename}_${referenceRole}`,
    kind: 'reference_image',
    path: sourcePath,
    name: filename,
    mimeType: 'image/png',
    meta: {
      referenceRole,
      purpose:
        referenceRole === 'setting'
          ? 'setting_ref'
          : referenceRole === 'character'
            ? 'character_ref'
            : 'reference_general',
    },
  };
}

describe('characterReferenceImport', () => {
  it('copies character refs into project uploads with safe collision names', async () => {
    mkdirSync(join(projectDir, 'assets/uploads/characters'), { recursive: true });
    writeFileSync(join(projectDir, 'assets/uploads/characters/hero.png'), 'existing');

    const [imported] = await importCharacterReferenceAttachments({
      projectDir,
      attachments: [sourceAttachment('hero.png')],
    });

    expect(imported.name).toBe('hero-2.png');
    expect(imported.path).toBe(join(projectDir, 'assets/uploads/characters/hero-2.png'));
    expect(imported.meta).toEqual(expect.objectContaining({
      purpose: 'character_ref',
      projectRelativePath: 'assets/uploads/characters/hero-2.png',
      originalFilename: 'hero.png',
    }));
    expect(existsSync(join(projectDir, 'assets/uploads/characters/hero-2.png'))).toBe(true);
  });

  it('rejects non-image character refs', async () => {
    const sourcePath = join(tempDir, 'notes.txt');
    writeFileSync(sourcePath, 'not an image');

    await expect(
      importCharacterReferenceAttachments({
        projectDir,
        attachments: [{
          id: 'att_txt',
          kind: 'character_ref',
          path: sourcePath,
          name: 'notes.txt',
        }],
      }),
    ).rejects.toThrow(/Unsupported reference image type/);
  });

  it('copies reference images by role into settings and generic upload folders', async () => {
    const imported = await importReferenceImageAttachments({
      projectDir,
      attachments: [
        referenceAttachment('field.png', 'setting'),
        referenceAttachment('mood.png', 'auto'),
      ],
    });

    expect(imported).toEqual([
      expect.objectContaining({
        kind: 'reference_image',
        path: join(projectDir, 'assets/uploads/settings/field.png'),
        meta: expect.objectContaining({
          purpose: 'setting_ref',
          referenceRole: 'setting',
          projectRelativePath: 'assets/uploads/settings/field.png',
        }),
      }),
      expect.objectContaining({
        kind: 'reference_image',
        path: join(projectDir, 'assets/uploads/references/mood.png'),
        meta: expect.objectContaining({
          purpose: 'reference_general',
          referenceRole: 'auto',
          projectRelativePath: 'assets/uploads/references/mood.png',
        }),
      }),
    ]);
    expect(existsSync(join(projectDir, 'assets/uploads/settings/field.png'))).toBe(true);
    expect(existsSync(join(projectDir, 'assets/uploads/references/mood.png'))).toBe(true);
  });

  it('adds imported refs to project.inputs without duplicates', async () => {
    writeFileSync(join(projectDir, 'project.json'), JSON.stringify({ title: 'demo' }, null, 2));
    const imported = await importCharacterReferenceAttachments({
      projectDir,
      attachments: [sourceAttachment('hero.png')],
    });

    const first = await addCharacterReferenceInputsToProject({
      projectDir,
      attachments: imported,
      now: 123,
    });
    const second = await addCharacterReferenceInputsToProject({
      projectDir,
      attachments: imported,
      now: 456,
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf-8'));
    expect(project.inputs).toEqual([
      expect.objectContaining({
        id: 'character-ref-123-1',
        purpose: 'character_ref',
        mediaType: 'image',
        source: expect.objectContaining({
          value: 'assets/uploads/characters/hero.png',
        }),
      }),
    ]);
  });

  it('adds imported setting and generic refs to project.inputs without duplicates', async () => {
    writeFileSync(join(projectDir, 'project.json'), JSON.stringify({ title: 'demo' }, null, 2));
    const imported = await importReferenceImageAttachments({
      projectDir,
      attachments: [
        referenceAttachment('field.png', 'setting'),
        referenceAttachment('mood.png', 'auto'),
      ],
    });

    const first = await addReferenceImageInputsToProject({
      projectDir,
      attachments: imported,
      now: 123,
    });
    const second = await addReferenceImageInputsToProject({
      projectDir,
      attachments: imported,
      now: 456,
    });

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0);
    const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf-8'));
    expect(project.inputs).toEqual([
      expect.objectContaining({
        id: 'setting-ref-123-1',
        purpose: 'setting_ref',
        mediaType: 'image',
        source: expect.objectContaining({
          value: 'assets/uploads/settings/field.png',
        }),
        metadata: expect.objectContaining({
          referenceRole: 'setting',
        }),
      }),
      expect.objectContaining({
        id: 'reference-image-123-2',
        purpose: 'reference_general',
        mediaType: 'image',
        source: expect.objectContaining({
          value: 'assets/uploads/references/mood.png',
        }),
        metadata: expect.objectContaining({
          referenceRole: 'auto',
        }),
      }),
    ]);
  });
});
