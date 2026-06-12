import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import type { Attachment } from '../../../../shared/attachmentTypes';
import AttachmentChip from './AttachmentChip';

describe('AttachmentChip', () => {
  it('renders reference image thumbnails with encoded file URLs', () => {
    const attachment: Attachment = {
      id: 'att-1',
      kind: 'reference_image',
      path: '/Users/me/Desktop/My Image #1?.png',
      name: 'My Image #1?.png',
      meta: {
        referenceRole: 'character',
        purpose: 'character_ref',
      },
    };

    const { container } = render(
      <AttachmentChip attachment={attachment} onRemove={jest.fn()} />,
    );

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe(
      'file:///Users/me/Desktop/My%20Image%20%231%3F.png',
    );
  });
});
