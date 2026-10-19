import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { QuestionResponse, QuestionStatus } from '../core/api/api.types';
import { QuestionCard } from './question-card';
import type { QuestionEdit } from './quiz-review.store';

const QUESTION: QuestionResponse = {
  id: 'q1',
  position: 1,
  type: 'multiple_choice',
  stem: 'What do plants release?',
  options: ['Oxygen', 'Nitrogen', 'Helium', 'Argon'],
  correctIndex: 0,
  explanation: 'Photosynthesis releases oxygen.',
  sourceQuote: 'The process releases oxygen as a by-product.',
  status: 'draft',
  editedAt: null,
  isEdited: false,
};

describe('QuestionCard', () => {
  let fixture: ComponentFixture<QuestionCard>;
  let element: HTMLElement;
  let statusChanges: QuestionStatus[];
  let saves: QuestionEdit[];
  let regenerates: number;

  beforeEach(async () => {
    fixture = TestBed.createComponent(QuestionCard);
    fixture.componentRef.setInput('question', QUESTION);
    statusChanges = [];
    saves = [];
    regenerates = 0;
    fixture.componentInstance.statusChange.subscribe((status) => statusChanges.push(status));
    fixture.componentInstance.save.subscribe((edit) => saves.push(edit));
    fixture.componentInstance.regenerate.subscribe(() => regenerates++);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  const button = (name: string): HTMLButtonElement => {
    const found = [...element.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    if (!found) {
      throw new Error(`no button "${name}"`);
    }
    return found;
  };

  const set = async (props: Partial<Record<string, unknown>>) => {
    for (const [name, value] of Object.entries(props)) {
      fixture.componentRef.setInput(name, value);
    }
    await fixture.whenStable();
  };

  it('shows the question as text, with the correct option labelled', () => {
    expect(element.textContent).toContain('What do plants release?');
    const correct = element.querySelector('li.correct');
    expect(correct?.textContent).toContain('Oxygen');
    expect(correct?.textContent).toContain('Correct answer');
    expect(element.querySelector('details summary')?.textContent).toContain('From the lesson');
  });

  describe('approve and reject', () => {
    it('emits approved and rejected from a draft', () => {
      button('Approve').click();
      button('Reject').click();

      expect(statusChanges).toEqual(['approved', 'rejected']);
    });

    it('shows the approved state as pressed, moves back to draft when pressed again, and blocks Reject', async () => {
      await set({ question: { ...QUESTION, status: 'approved' } });

      const approve = button('Approved');
      expect(approve.getAttribute('aria-pressed')).toBe('true');
      expect(button('Reject').disabled).toBe(true);

      approve.click();
      expect(statusChanges).toEqual(['draft']);
    });

    it('shows the Edited badge only for questions changed from the AI version', async () => {
      expect(element.querySelector('.badge-edited')).toBeNull();

      await set({ question: { ...QUESTION, isEdited: true } });

      expect(element.querySelector('.badge-edited')?.textContent).toContain('Edited');
    });
  });

  describe('edit form validation', () => {
    beforeEach(async () => {
      await set({ editing: true });
    });

    const input = (id: string) =>
      element.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#edit-q1-${id}`) ??
      (() => {
        throw new Error(`no field ${id}`);
      })();

    const type = async (id: string, value: string) => {
      const field = input(id);
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('blur'));
      await fixture.whenStable();
    };

    const errorsOf = (id: string) =>
      element.querySelector(`#edit-q1-${id}-errors`)?.textContent?.replace(/\s+/g, ' ').trim() ??
      '';

    it('blocks saving a blank question and shows why next to the field', async () => {
      await type('stem', '   ');
      button('Save').click();
      await fixture.whenStable();

      expect(saves).toEqual([]);
      expect(errorsOf('stem')).toContain('Enter the question.');
      expect(input('stem').getAttribute('aria-invalid')).toBe('true');
      expect(input('stem').getAttribute('aria-describedby')).toBe('edit-q1-stem-errors');
    });

    it('flags a repeated option on the repeat, and a catch-all option', async () => {
      await type('option-1', '  oxygen ');
      await type('option-3', 'None of the above');
      button('Save').click();
      await fixture.whenStable();

      expect(saves).toEqual([]);
      expect(errorsOf('option-1')).toContain('This is the same as option A.');
      expect(errorsOf('option-0')).toBe('');
      expect(errorsOf('option-3')).toContain(
        '"All of the above" and "None of the above" are not allowed.',
      );
    });

    it('rejects a stem that repeats another question of the quiz', async () => {
      await set({ otherStems: [{ position: 2, stem: 'Which gas do plants release?' }] });

      await type('stem', 'which gas do PLANTS release');

      expect(errorsOf('stem')).toContain('This is the same as question 2.');
    });

    it('emits the edited question when it is valid', async () => {
      await type('stem', 'Which gas do plants release?');
      element.querySelector<HTMLInputElement>('#edit-q1-correct-2')?.click();
      await fixture.whenStable();
      button('Save').click();
      await fixture.whenStable();

      expect(saves).toEqual([
        {
          stem: 'Which gas do plants release?',
          options: ['Oxygen', 'Nitrogen', 'Helium', 'Argon'],
          correctIndex: 2,
          explanation: 'Photosynthesis releases oxygen.',
        },
      ]);
    });

    it('shows API rule violations next to the field their pointer names, until the field changes', async () => {
      await set({
        fieldErrors: [
          { pointer: '#/options/2', detail: 'question 1: options 1 and 3 are identical' },
          { detail: 'Something about the whole question.' },
        ],
      });

      expect(errorsOf('option-2')).toContain('question 1: options 1 and 3 are identical');
      expect(element.querySelector('.general-errors')?.textContent).toContain(
        'Something about the whole question.',
      );

      await type('option-2', 'Neon');

      expect(errorsOf('option-2')).toBe('');
    });
  });

  describe('regenerate', () => {
    it('emits regenerate', () => {
      button('Regenerate').click();

      expect(regenerates).toBe(1);
    });

    it('shows a loading state on the card and disables its actions while regenerating', async () => {
      await set({ busy: 'regenerating' });

      expect(element.querySelector('article')?.getAttribute('aria-busy')).toBe('true');
      expect(element.querySelector('[role="status"]')?.textContent).toContain(
        'Writing a new question',
      );
      for (const name of ['Approve', 'Reject', 'Edit', 'Regenerating…']) {
        expect(button(name).disabled).toBe(true);
      }

      button('Regenerating…').click();
      expect(regenerates).toBe(0);
    });
  });
});
