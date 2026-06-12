import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  consumeProjectAutoStart,
  markProjectForAutoStart,
} from './projectAutoStart';

describe('projectAutoStart', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('marks and consumes a project path once', () => {
    markProjectForAutoStart('/tmp/My Project.dhee/');

    expect(consumeProjectAutoStart('/tmp/My Project.dhee')).toBe(true);
    expect(consumeProjectAutoStart('/tmp/My Project.dhee')).toBe(false);
  });

  it('does not consume the marker for a different project', () => {
    markProjectForAutoStart('/tmp/ProjectA.dhee');

    expect(consumeProjectAutoStart('/tmp/ProjectB.dhee')).toBe(false);
    expect(consumeProjectAutoStart('/tmp/ProjectA.dhee')).toBe(true);
  });
});
