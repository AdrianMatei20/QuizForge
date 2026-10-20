import { parseEvalArgs, providerRefusal } from './eval-args.js';

describe('parseEvalArgs', () => {
  it('reads every option', () => {
    expect(
      parseEvalArgs([
        '--prompt',
        'v2',
        '--model',
        'claude-haiku-5-5',
        '--judge-model',
        'claude-sonnet-5-5',
        '--effort',
        'low',
        '--limit',
        '2',
      ]),
    ).toEqual({
      promptVersion: 2,
      model: 'claude-haiku-5-5',
      judgeModel: 'claude-sonnet-5-5',
      effort: 'low',
      limit: 2,
      dryRun: false,
    });
  });

  it('accepts a bare version number and --dry-run', () => {
    expect(parseEvalArgs(['--prompt', '1', '--dry-run'])).toEqual({
      promptVersion: 1,
      dryRun: true,
    });
  });

  it.each([
    [[], '--prompt is required'],
    [['--prompt', 'latest'], '--prompt is required'],
    [
      ['--prompt', 'v1', '--effort', 'max'],
      '--effort must be one of low, medium, high',
    ],
    [['--prompt', 'v1', '--limit', '0'], '--limit must be'],
    [
      ['--prompt', 'v1', '--dry-run', '--model', 'x'],
      '--dry-run always uses the fake models',
    ],
    [['--prompt', 'v1', 'extra'], 'Unexpected argument'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseEvalArgs(argv)).toThrow(message);
  });

  it('rejects an unknown option', () => {
    expect(() => parseEvalArgs(['--prompt', 'v1', '--modle', 'x'])).toThrow();
  });
});

describe('providerRefusal', () => {
  it('refuses the fake provider unless it is a dry run', () => {
    expect(providerRefusal('fake', false)).toContain('pass --dry-run');
    expect(providerRefusal('fake', true)).toBeUndefined();
    expect(providerRefusal('anthropic', false)).toBeUndefined();
  });
});
