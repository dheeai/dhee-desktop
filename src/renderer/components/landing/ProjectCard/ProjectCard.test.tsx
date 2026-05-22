import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import ProjectCard, { type LandingProjectCard } from './ProjectCard';

describe('ProjectCard', () => {
  const project: LandingProjectCard = {
    path: '/projects/demo',
    name: 'Demo',
    lastOpened: Date.now(),
    description: 'Test project',
    sceneCount: 3,
    shotCount: 12,
  };

  it('opens the project from the main card surface', () => {
    const onOpen = jest.fn();
    render(
      <ProjectCard
        project={project}
        onOpen={onOpen}
        onRename={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Demo' }));
    expect(onOpen).toHaveBeenCalledWith('/projects/demo');
  });

  it('does not open the project when rename or delete is clicked', () => {
    const onOpen = jest.fn();
    const onRename = jest.fn();
    const onDelete = jest.fn();

    render(
      <ProjectCard
        project={project}
        onOpen={onOpen}
        onRename={onRename}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename Demo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Demo' }));

    expect(onOpen).not.toHaveBeenCalled();
    expect(onRename).toHaveBeenCalledWith(project);
    expect(onDelete).toHaveBeenCalledWith(project);
  });
});
