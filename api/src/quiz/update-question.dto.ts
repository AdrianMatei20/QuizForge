import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { QUESTION_STATUSES, type QuestionStatus } from './quiz.types.js';

export const QUESTION_STEM_MAX = 1_000;
export const QUESTION_OPTION_MAX = 500;
export const QUESTION_EXPLANATION_MAX = 2_000;

// Absent fields are left unchanged. Unlike @IsOptional, this still rejects
// an explicit null, which would otherwise be silently ignored.
const ifPresent = ValidateIf((_object, value) => value !== undefined);

/**
 * A teacher's review action on one question. Only field types and sizes are
 * checked here; the question schema (4 options, True/False, nothing blank)
 * and the quiz rules run on the merged question in ReviewService.
 */
export class UpdateQuestionDto {
  @ApiPropertyOptional({
    maxLength: QUESTION_STEM_MAX,
    example: 'What makes a recursive function stop?',
  })
  @ifPresent
  @IsString()
  @MaxLength(QUESTION_STEM_MAX)
  stem?: string;

  @ApiPropertyOptional({
    description:
      'Multiple choice: exactly 4 distinct options, no "all/none of the above". True/false: must stay ["True", "False"].',
    type: [String],
    maxItems: 4,
    example: [
      'It reaches the base case',
      'It runs out of memory',
      'It is called with n = 1',
      'It returns twice',
    ],
  })
  @ifPresent
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(QUESTION_OPTION_MAX, { each: true })
  options?: string[];

  @ApiPropertyOptional({
    description: 'Zero-based index into options.',
    minimum: 0,
    example: 0,
  })
  @ifPresent
  @IsInt()
  @Min(0)
  correctIndex?: number;

  @ApiPropertyOptional({
    maxLength: QUESTION_EXPLANATION_MAX,
    example: 'The function stops calling itself once it reaches the base case.',
  })
  @ifPresent
  @IsString()
  @MaxLength(QUESTION_EXPLANATION_MAX)
  explanation?: string;

  @ApiPropertyOptional({
    enum: QUESTION_STATUSES,
    description:
      'draft -> approved or rejected; approved or rejected -> draft. Anything else is a 409; the current status is a no-op.',
    example: 'approved',
  })
  @ifPresent
  @IsIn(QUESTION_STATUSES)
  status?: QuestionStatus;
}
