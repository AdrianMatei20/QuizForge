import { z } from 'zod';

/**
 * LLM_API_KEY and LLM_MODEL for live tests. Real environment variables win,
 * then .env.live.local, then .env (process.loadEnvFile never overrides a
 * variable that is already set).
 */
export function readLiveEnv() {
  for (const file of ['.env.live.local', '.env']) {
    try {
      process.loadEnvFile(file);
    } catch {
      // No such file: try the next one.
    }
  }
  const result = z
    .object({
      LLM_API_KEY: z.string().min(1, 'is required'),
      LLM_MODEL: z
        .string()
        .min(1, 'is required')
        .refine((model) => !model.startsWith('fake-'), {
          message: 'must be a real model ID, not a fake one',
        }),
    })
    .safeParse(process.env);
  if (!result.success) {
    // Names only, never values: one of them is a secret.
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')} ${issue.message}`,
    );
    throw new Error(
      `Live tests need a real LLM config: ${problems.join('; ')} ` +
        '(set it in the environment, .env.live.local or .env)',
    );
  }
  return result.data;
}
