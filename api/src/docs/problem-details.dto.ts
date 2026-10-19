import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Example ids used across the API docs. Fixed values keep the generated Postman collection stable. */
export const EXAMPLE_IDS = {
  lesson: '6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c',
  quiz: '0b6c3c8e-1f4a-4f0e-9a3e-5d2f8c7b9a10',
  question: 'c2a1e0d9-8b7c-4d6e-9f50-a1b2c3d4e5f6',
} as const;

/**
 * Documentation-only classes for RFC 9457 problem details. The real errors
 * come from ProblemDetailsFilter; these exist so Swagger can describe them.
 */
export class ProblemDetailsDto {
  @ApiProperty({
    description:
      'A URI identifying the problem type. "about:blank" means the HTTP status says it all.',
    example: 'urn:quizforge:problem:quiz-published',
  })
  type!: string;

  @ApiProperty({
    description: 'Short summary of the problem type.',
    example: 'Quiz is published',
  })
  title!: string;

  @ApiProperty({ description: 'The HTTP status code.', example: 409 })
  status!: number;

  @ApiProperty({
    description:
      'What went wrong this time. Never contains prompts, lesson text or model output.',
    example: 'A published quiz and its questions can no longer be changed.',
  })
  detail!: string;

  @ApiProperty({
    description: 'The request path that produced the problem.',
    example: '/api/questions/0b6c3c8e-1f4a-4f0e-9a3e-5d2f8c7b9a10',
  })
  instance!: string;
}

export class ProblemFieldErrorDto {
  @ApiPropertyOptional({
    description:
      'JSON Pointer to the offending field. Absent when the rule is about the whole document.',
    example: '#/options',
  })
  pointer?: string;

  @ApiProperty({
    description: 'What is wrong with it.',
    example: 'question 2: options 1 and 2 are identical',
  })
  detail!: string;
}

export class ValidationProblemDetailsDto extends ProblemDetailsDto {
  @ApiProperty({
    description: 'One entry per broken constraint or rule.',
    type: [ProblemFieldErrorDto],
  })
  errors!: ProblemFieldErrorDto[];
}

export class QuizGenerationProblemDetailsDto extends ProblemDetailsDto {
  @ApiProperty({
    description:
      'The quiz that failed. It is stored with status "failed" and a failureReason, so it can be looked up.',
    format: 'uuid',
    example: EXAMPLE_IDS.quiz,
  })
  quizId!: string;

  @ApiPropertyOptional({
    description: 'Present when the model output failed validation (502).',
    type: [ProblemFieldErrorDto],
  })
  errors?: ProblemFieldErrorDto[];
}

export class LlmProblemDetailsDto extends ProblemDetailsDto {
  @ApiPropertyOptional({
    description: 'Present when the model output failed validation (502).',
    type: [ProblemFieldErrorDto],
  })
  errors?: ProblemFieldErrorDto[];
}
