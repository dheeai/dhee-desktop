import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Attachment } from '../../../../shared/attachmentTypes';
import AttachmentChip from './AttachmentChip';

describe('AttachmentChip', () => {
  const characterAttachment: Attachment = {
    id: 'att_emna',
    kind: 'reference_image',
    path: '/tmp/new-emna.png',
    name: 'new-emna.png',
    meta: {
      purpose: 'character_ref',
      referenceRole: 'character',
    },
  };

  it('lets a character reference image choose an existing character replacement target', () => {
    const onReplacementCharacterChange = jest.fn();

    render(
      <AttachmentChip
        attachment={characterAttachment}
        onRemove={jest.fn()}
        onReferenceRoleChange={jest.fn()}
        replacementCharacters={[
          { id: 'ren_takahashi', name: 'Ren Takahashi' },
          { id: 'emna_aoyama', name: 'Emna Aoyama' },
        ]}
        onReplacementCharacterChange={onReplacementCharacterChange}
      />,
    );

    fireEvent.change(
      screen.getByLabelText('Replacement target for new-emna.png'),
      { target: { value: 'emna_aoyama' } },
    );

    expect(onReplacementCharacterChange).toHaveBeenCalledWith(
      'att_emna',
      { id: 'emna_aoyama', name: 'Emna Aoyama' },
    );
  });

  it('hides replacement targets for non-character reference roles', () => {
    render(
      <AttachmentChip
        attachment={{
          ...characterAttachment,
          meta: {
            purpose: 'reference_general',
            referenceRole: 'auto',
          },
        }}
        onRemove={jest.fn()}
        onReferenceRoleChange={jest.fn()}
        replacementCharacters={[{ id: 'emna_aoyama', name: 'Emna Aoyama' }]}
        onReplacementCharacterChange={jest.fn()}
      />,
    );

    expect(
      screen.queryByLabelText('Replacement target for new-emna.png'),
    ).toBeNull();
  });
});
