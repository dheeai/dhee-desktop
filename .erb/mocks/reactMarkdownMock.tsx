/**
 * Jest mock for `react-markdown`. The real package ships ESM only and
 * jest's default `transformIgnorePatterns` skips node_modules, so any
 * test that transitively imports it explodes with `Unexpected token
 * 'export'`. The chat-panel tests assert visible text / state, not
 * the rendered Markdown HTML, so a passthrough renderer is enough.
 */
import React from 'react';

interface MockProps {
  children?: React.ReactNode;
}

const ReactMarkdownMock: React.FC<MockProps> = ({ children }) => (
  <span>{children}</span>
);

export default ReactMarkdownMock;
