import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  addReferenceImageInputsToProject,
  importReferenceImageAttachments,
} from './characterReferenceImport';
import type { Attachment } from '../shared/attachmentTypes';

describe('characterReferenceImport', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dhee-char-ref-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('copies multiple reference images into role-specific upload folders with collision handling', async () => {
    const sourceDir = path.join(root, 'sources');
    const projectDir = path.join(root, 'project.dhee');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, 'assets/uploads/characters'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'assets/uploads/characters/Hero.png'), 'old');
    const heroSource = path.join(sourceDir, 'Hero.png');
    const settingSource = path.join(sourceDir, 'Field.jpg');
    await fs.writeFile(heroSource, 'hero');
    await fs.writeFile(settingSource, 'setting');

    const attachments: Attachment[] = [
      {
        id: 'att-1',
        kind: 'reference_image',
        path: heroSource,
        name: 'Hero.png',
        meta: { referenceRole: 'character', purpose: 'character_ref' },
      },
      {
        id: 'att-2',
        kind: 'reference_image',
        path: settingSource,
        name: 'Field.jpg',
        meta: { referenceRole: 'setting', purpose: 'setting_ref' },
      },
    ];

    const imported = await importReferenceImageAttachments({ projectDir, attachments });

    expect(imported).toHaveLength(2);
    expect(imported[0].path).toBe(path.join(projectDir, 'assets/uploads/characters/Hero-2.png'));
    expect(imported[0].meta).toMatchObject({
      purpose: 'character_ref',
      referenceRole: 'character',
      projectRelativePath: 'assets/uploads/characters/Hero-2.png',
    });
    expect(imported[1].path).toBe(path.join(projectDir, 'assets/uploads/settings/Field.jpg'));
    expect(imported[1].meta).toMatchObject({
      purpose: 'setting_ref',
      referenceRole: 'setting',
      projectRelativePath: 'assets/uploads/settings/Field.jpg',
    });
    await expect(fs.readFile(imported[0].path, 'utf8')).resolves.toBe('hero');
    await expect(fs.readFile(imported[1].path, 'utf8')).resolves.toBe('setting');
  });

  it('adds project inputs only when project.json exists and skips duplicate paths', async () => {
    const projectDir = path.join(root, 'project.dhee');
    await fs.mkdir(projectDir, { recursive: true });
    const attachment: Attachment = {
      id: 'att-1',
      kind: 'reference_image',
      path: path.join(projectDir, 'assets/uploads/characters/Hero.png'),
      name: 'Hero.png',
      mimeType: 'image/png',
      size: 4,
      meta: {
        purpose: 'character_ref',
        referenceRole: 'character',
        projectRelativePath: 'assets/uploads/characters/Hero.png',
      },
    };

    await expect(addReferenceImageInputsToProject({ projectDir, attachments: [attachment] })).resolves.toEqual([]);

    await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify({ name: 'Project' }));
    const added = await addReferenceImageInputsToProject({
      projectDir,
      attachments: [attachment],
      now: 123,
    });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      source: { value: 'assets/uploads/characters/Hero.png' },
      mediaType: 'image',
      purpose: 'character_ref',
      metadata: {
        originalFilename: 'Hero.png',
        mimeType: 'image/png',
        fileSize: 4,
        referenceRole: 'character',
      },
    });

    await expect(
      addReferenceImageInputsToProject({ projectDir, attachments: [attachment], now: 456 }),
    ).resolves.toEqual([]);
    const project = JSON.parse(await fs.readFile(path.join(projectDir, 'project.json'), 'utf8'));
    expect(project.inputs).toHaveLength(1);
  });
});
