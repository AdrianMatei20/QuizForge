import { Logger } from '@nestjs/common';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmPricing, loadPricingFile } from './pricing.js';

describe('LlmPricing', () => {
  const pricing = new LlmPricing({
    'priced-model': {
      inputPerMillionTokens: '4.00',
      outputPerMillionTokens: '20.00',
    },
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prices input and output tokens separately', () => {
    // 2,000 * $4/M + 1,000 * $20/M = $0.008 + $0.020
    expect(
      pricing.costUsd('priced-model', {
        inputTokens: 2_000,
        outputTokens: 1_000,
      }),
    ).toBe('0.028000');
  });

  it('costs 0 for an unknown model and warns only once per model', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const usage = { inputTokens: 1_000, outputTokens: 1_000 };

    expect(pricing.costUsd('mystery-a', usage)).toBe('0.000000');
    expect(pricing.costUsd('mystery-a', usage)).toBe('0.000000');
    expect(pricing.costUsd('mystery-b', usage)).toBe('0.000000');

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"mystery-a"'));
  });
});

describe('LlmPricing.warnIfUnpriced', () => {
  const prices = {
    'priced-model': {
      inputPerMillionTokens: '1.00',
      outputPerMillionTokens: '2.00',
    },
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns about each configured model without a price', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    new LlmPricing(prices).warnIfUnpriced(['missing-main', 'missing-judge']);

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"missing-main"'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"missing-judge"'),
    );
  });

  it('stays silent when every model is priced', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    new LlmPricing(prices).warnIfUnpriced(['priced-model', 'priced-model']);

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not repeat the warning when the model is later used', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const pricing = new LlmPricing(prices);

    pricing.warnIfUnpriced(['missing-main']);
    pricing.costUsd('missing-main', { inputTokens: 1, outputTokens: 1 });

    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('loadPricingFile', () => {
  let dir: string;
  const write = (content: unknown) => {
    const path = join(dir, 'pricing.json');
    writeFileSync(
      path,
      typeof content === 'string' ? content : JSON.stringify(content),
    );
    return path;
  };
  const valid = {
    source: 'https://example.com',
    checkedOn: '2026-10-06',
    currency: 'USD',
    models: {
      m: { inputPerMillionTokens: '1.50', outputPerMillionTokens: '7' },
    },
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pricing-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads the committed pricing file', () => {
    const prices = loadPricingFile('config/llm-pricing.json');

    expect(prices['fake-model']).toEqual({
      inputPerMillionTokens: '0',
      outputPerMillionTokens: '0',
    });
  });

  it('returns the model prices of a valid file', () => {
    expect(loadPricingFile(write(valid))).toEqual(valid.models);
  });

  it('rejects a price written as a number, naming the field', () => {
    const path = write({
      ...valid,
      models: {
        m: { inputPerMillionTokens: 1.5, outputPerMillionTokens: '7' },
      },
    });

    expect(() => loadPricingFile(path)).toThrow(
      'models.m.inputPerMillionTokens',
    );
  });

  it('rejects unknown price fields', () => {
    const path = write({
      ...valid,
      models: { m: { ...valid.models.m, cachedPerMillionTokens: '1' } },
    });

    expect(() => loadPricingFile(path)).toThrow('Invalid LLM pricing file');
  });

  it('rejects a missing or malformed file', () => {
    expect(() => loadPricingFile(join(dir, 'missing.json'))).toThrow(
      'Cannot read',
    );
    expect(() => loadPricingFile(write('{ nope'))).toThrow('Cannot read');
  });
});
