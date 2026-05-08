import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatInput from './ChatInput';

describe('ChatInput', () => {
  it('treats early composer engagement as question interaction', () => {
    const onQuestionInteraction = jest.fn();

    render(
      <ChatInput
        questionMode
        onQuestionInteraction={onQuestionInteraction}
        onSend={jest.fn()}
      />,
    );

    const textarea = screen.getByLabelText('Chat input');

    fireEvent.focus(textarea);
    fireEvent.click(textarea);
    fireEvent.keyDown(textarea, { key: 'a' });
    fireEvent.change(textarea, { target: { value: 'hello' } });

    expect(onQuestionInteraction).toHaveBeenCalledTimes(4);
  });

  it('does not report question interaction outside question mode', () => {
    const onQuestionInteraction = jest.fn();

    render(
      <ChatInput
        onQuestionInteraction={onQuestionInteraction}
        onSend={jest.fn()}
      />,
    );

    const textarea = screen.getByLabelText('Chat input');

    fireEvent.focus(textarea);
    fireEvent.click(textarea);
    fireEvent.keyDown(textarea, { key: 'a' });
    fireEvent.change(textarea, { target: { value: 'hello' } });

    expect(onQuestionInteraction).not.toHaveBeenCalled();
  });

  describe('attachments', () => {
    let originalElectron: typeof window.electron | undefined;

    beforeEach(() => {
      originalElectron = (window as Window & { electron?: typeof window.electron }).electron;
    });

    afterEach(() => {
      if (originalElectron === undefined) {
        Object.defineProperty(window, 'electron', { configurable: true, value: undefined });
      } else {
        (window as Window & { electron?: typeof window.electron }).electron = originalElectron;
      }
    });

    it('passes the picked attachment to onSend', async () => {
      const onSend = jest.fn();
      const selectAttachment = jest.fn(async () => ({
        ok: true,
        attachment: {
          id: 'att_1',
          kind: 'comfy_workflow' as const,
          path: '/tmp/wf.json',
          name: 'wf.json',
        },
      }));

      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: { project: { selectAttachment } },
      });

      render(<ChatInput onSend={onSend} />);

      // Click the paperclip — picker resolves with the canned attachment.
      await act(async () => {
        fireEvent.click(screen.getByLabelText('Attach file'));
      });
      // Chip appears with the filename.
      await waitFor(() => expect(screen.getByText('wf.json')).toBeInTheDocument());

      // Type something + send.
      const textarea = screen.getByLabelText('Chat input');
      fireEvent.change(textarea, { target: { value: 'install this' } });
      fireEvent.submit(textarea.closest('form')!);

      expect(onSend).toHaveBeenCalledTimes(1);
      const [text, attachments] = onSend.mock.calls[0];
      expect(text).toBe('install this');
      expect(attachments).toHaveLength(1);
      expect((attachments as Array<{ id: string }>)[0].id).toBe('att_1');
    });

    it('sends the message even with no text when at least one attachment is present', async () => {
      const onSend = jest.fn();
      const selectAttachment = jest.fn(async () => ({
        ok: true,
        attachment: {
          id: 'att_2',
          kind: 'comfy_workflow' as const,
          path: '/tmp/wf2.json',
          name: 'wf2.json',
        },
      }));
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: { project: { selectAttachment } },
      });

      render(<ChatInput onSend={onSend} />);

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Attach file'));
      });
      await waitFor(() => expect(screen.getByText('wf2.json')).toBeInTheDocument());

      const textarea = screen.getByLabelText('Chat input');
      fireEvent.submit(textarea.closest('form')!);

      expect(onSend).toHaveBeenCalledTimes(1);
      const [text, attachments] = onSend.mock.calls[0];
      expect(text).toBe('');
      expect(attachments).toHaveLength(1);
    });

    it('removes an attachment when the chip x is clicked', async () => {
      const onSend = jest.fn();
      const selectAttachment = jest.fn(async () => ({
        ok: true,
        attachment: {
          id: 'att_3',
          kind: 'comfy_workflow' as const,
          path: '/tmp/wf3.json',
          name: 'wf3.json',
        },
      }));
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: { project: { selectAttachment } },
      });

      render(<ChatInput onSend={onSend} />);

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Attach file'));
      });
      await waitFor(() => expect(screen.getByText('wf3.json')).toBeInTheDocument());

      fireEvent.click(screen.getByLabelText('Remove attachment wf3.json'));
      expect(screen.queryByText('wf3.json')).not.toBeInTheDocument();
    });

    it('shows an error when the picker reports an error and does not block typing', async () => {
      const onSend = jest.fn();
      const selectAttachment = jest.fn(async () => ({
        ok: false,
        error: 'permission denied',
      }));
      Object.defineProperty(window, 'electron', {
        configurable: true,
        value: { project: { selectAttachment } },
      });

      render(<ChatInput onSend={onSend} />);

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Attach file'));
      });
      await waitFor(() => expect(screen.getByText('permission denied')).toBeInTheDocument());

      // User can still type and send a plain message.
      const textarea = screen.getByLabelText('Chat input');
      fireEvent.change(textarea, { target: { value: 'never mind' } });
      fireEvent.submit(textarea.closest('form')!);
      expect(onSend).toHaveBeenCalledWith('never mind', []);
    });
  });
});
