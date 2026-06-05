/**
 * ui/ primitive library — behavior tests (render + interaction), not
 * style-string assertions. Verifies the shared primitives every surface
 * will depend on.
 */
import '@testing-library/jest-dom';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button, Field, Input, SegmentedControl, StatusBadge, StatusDot, Chip, RecDot } from './index';

describe('Button', () => {
  it('renders children and fires onClick', () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Continue</Button>);
    const btn = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', () => {
    const onClick = jest.fn();
    render(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('defaults to type=button (never submits a form by accident)', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button');
  });

  it('applies distinct classes per variant', () => {
    const { rerender } = render(<Button variant="primary">A</Button>);
    const a = screen.getByRole('button', { name: 'A' }).className;
    rerender(<Button variant="recording">A</Button>);
    const b = screen.getByRole('button', { name: 'A' }).className;
    expect(a).not.toEqual(b);
  });
});

describe('Field + Input', () => {
  it('renders the label, the control, and a hint', () => {
    render(
      <Field label="API key" hint="kept in the system keychain" htmlFor="k">
        <Input id="k" placeholder="sk-or-…" />
      </Field>,
    );
    expect(screen.getByText('API key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-or-…')).toBeInTheDocument();
    expect(screen.getByText(/system keychain/)).toBeInTheDocument();
  });

  it('shows an error in place of the hint when provided', () => {
    render(
      <Field label="URL" hint="default :8188" error="unreachable">
        <Input />
      </Field>,
    );
    expect(screen.getByText('unreachable')).toBeInTheDocument();
    expect(screen.queryByText('default :8188')).toBeNull();
  });
});

describe('SegmentedControl', () => {
  function Harness() {
    const [v, setV] = useState('openrouter');
    return (
      <SegmentedControl
        value={v}
        onChange={setV}
        options={[
          { value: 'openrouter', label: 'OpenRouter', tag: 'key' },
          { value: 'lmstudio', label: 'LM Studio', tag: 'local' },
        ]}
      />
    );
  }
  it('marks the selected option and switches on click', () => {
    render(<Harness />);
    const or = screen.getByRole('tab', { name: /OpenRouter/ });
    const lm = screen.getByRole('tab', { name: /LM Studio/ });
    expect(or).toHaveAttribute('aria-selected', 'true');
    expect(lm).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(lm);
    expect(lm).toHaveAttribute('aria-selected', 'true');
    expect(or).toHaveAttribute('aria-selected', 'false');
  });
});

describe('Status primitives', () => {
  it('renders a badge with its label and a dot per status without throwing', () => {
    render(
      <div>
        <StatusBadge status="completed">done</StatusBadge>
        <StatusDot status="running" />
        <Chip>
          <RecDot /> Running
        </Chip>
      </div>,
    );
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });
});
