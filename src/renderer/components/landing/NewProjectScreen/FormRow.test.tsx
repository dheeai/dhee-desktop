import { describe, it, expect, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormRow } from './NewProjectScreen';

const styleDecl = {
  id: 'style',
  kind: 'project' as const,
  field: 'style',
  control: 'select' as const,
  allowCustom: true,
  label: 'Style',
  options: [
    { value: 'cinematic_realism', label: 'Cinematic Realism' },
    { value: 'anime', label: 'Anime' },
  ],
};

const resolutionDecl = {
  id: 'resolution',
  kind: 'project' as const,
  field: 'resolution',
  control: 'pills' as const,
  allowCustom: true,
  label: 'Resolution',
  options: [
    { value: 480, label: '480p' },
    { value: 720, label: '720p' },
    { value: 1080, label: '1080p' },
  ],
};

describe('FormRow — allowCustom "Other…" affordance', () => {
  it('style select: choosing Other… reveals a free-text box that flows a custom value', () => {
    const onChange = jest.fn();
    render(<FormRow decl={styleDecl} value="cinematic_realism" onChange={onChange} />);

    // The "Other…" option exists alongside the presets.
    expect(screen.getByRole('option', { name: 'Other…' })).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__custom__' } });
    // Picking Other clears the preset value and reveals the text box.
    expect(onChange).toHaveBeenCalledWith('');

    const input = screen.getByPlaceholderText(/your own style/i);
    fireEvent.change(input, { target: { value: 'luminous storybook anime, Studio Colorido' } });
    expect(onChange).toHaveBeenLastCalledWith('luminous storybook anime, Studio Colorido');
  });

  it('resolution pills: 480p is present and Other… reveals a numeric box (e.g. 4K)', () => {
    const onChange = jest.fn();
    render(<FormRow decl={resolutionDecl} value={1080} onChange={onChange} />);

    // 480 is now a preset.
    expect(screen.getByRole('button', { name: '480p' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    const input = screen.getByPlaceholderText('custom');
    fireEvent.change(input, { target: { value: '2160' } });
    // Numeric presets → custom value parsed to a number, not a string.
    expect(onChange).toHaveBeenLastCalledWith(2160);
  });

  it('a loaded custom value (not a preset) shows the custom input pre-filled', () => {
    render(<FormRow decl={styleDecl} value="my bespoke painterly look" onChange={jest.fn()} />);
    const input = screen.getByPlaceholderText(/your own style/i) as HTMLInputElement;
    expect(input.value).toBe('my bespoke painterly look');
  });

  it('without allowCustom, no Other… option is rendered', () => {
    const onChange = jest.fn();
    render(
      <FormRow
        decl={{ ...styleDecl, allowCustom: false }}
        value="anime"
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole('option', { name: 'Other…' })).toBeNull();
  });
});
