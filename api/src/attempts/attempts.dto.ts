import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { EXAMPLE_IDS } from '../docs/problem-details.dto.js';
import { QUESTION_TYPES, type QuestionType } from '../quiz/quiz.types.js';

/**
 * Request DTOs and response classes for taking a quiz. The public quiz has
 * its own classes on purpose, not the teacher's with fields removed: a field
 * added to the teacher's response later cannot leak the answers here.
 */

export class SubmittedAnswerDto {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.question })
  @IsUUID()
  questionId!: string;

  @ApiProperty({
    description: 'Zero-based index into the question options.',
    minimum: 0,
    example: 1,
  })
  @IsInt()
  @Min(0)
  selectedIndex!: number;
}

export class SubmitAttemptDto {
  @ApiProperty({
    type: [SubmittedAnswerDto],
    description:
      'Exactly one answer for every question of the quiz, in any order.',
  })
  @IsArray()
  // A quiz has at most 10 questions; a long array is rejected before scoring.
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SubmittedAnswerDto)
  answers!: SubmittedAnswerDto[];
}

export class PublicQuestionResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.question }) id!: string;
  @ApiProperty({ description: '1-based, in quiz order.', example: 1 })
  position!: number;
  @ApiProperty({ enum: QUESTION_TYPES, example: 'multiple_choice' })
  type!: QuestionType;
  @ApiProperty({ example: 'What makes a recursive function stop?' })
  stem!: string;

  @ApiProperty({
    type: [String],
    example: ['A loop', 'The base case', 'The call stack', 'A timeout'],
  })
  options!: string[];
}

export class PublicQuizResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.quiz }) id!: string;
  @ApiProperty({ example: 'Recursion' }) lessonTitle!: string;

  @ApiProperty({
    type: [PublicQuestionResponse],
    description:
      'The published questions, without correct answers or explanations.',
  })
  questions!: PublicQuestionResponse[];
}

export class AnswerResultResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.question })
  questionId!: string;
  @ApiProperty({ example: 2 }) selectedIndex!: number;
  @ApiProperty({ example: false }) correct!: boolean;
  @ApiProperty({ example: 1 }) correctIndex!: number;
  @ApiProperty({
    example: 'Every recursive function needs a base case to stop.',
  })
  explanation!: string;
}

export class AttemptResultResponse {
  @ApiProperty({ format: 'uuid' }) attemptId!: string;
  @ApiProperty({ description: 'Questions answered correctly.', example: 4 })
  score!: number;
  @ApiProperty({ example: 5 }) total!: number;

  @ApiProperty({
    type: [AnswerResultResponse],
    description: 'In question order.',
  })
  results!: AnswerResultResponse[];
}

export class QuestionAttemptStatsResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.question })
  questionId!: string;
  @ApiProperty({ example: 1 }) position!: number;
  @ApiProperty({ description: 'Attempts that answered it.', example: 18 })
  attempts!: number;
  @ApiProperty({ example: 13 }) correct!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '0 to 1; null with no attempts.',
    example: 0.72,
  })
  percentCorrect!: number | null;

  @ApiProperty({
    enum: ['too_easy', 'possibly_wrong'],
    nullable: true,
    description:
      'too_easy above the upper threshold, possibly_wrong below the lower one, null otherwise or with fewer than the minimum attempts.',
    example: null,
  })
  flag!: 'too_easy' | 'possibly_wrong' | null;
}

export class AttemptThresholdsResponse {
  @ApiProperty({ example: 0.9 }) tooEasyAbove!: number;
  @ApiProperty({ example: 0.2 }) possiblyWrongBelow!: number;
  @ApiProperty({ example: 5 }) minAttempts!: number;
}

export class AttemptStatsResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.quiz }) quizId!: string;
  @ApiProperty({ example: 18 }) attempts!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Mean of score / total over all attempts, 0 to 1; null with no attempts.',
    example: 0.68,
  })
  averageScore!: number | null;

  @ApiProperty({
    type: [QuestionAttemptStatsResponse],
    description: 'In question order.',
  })
  questions!: QuestionAttemptStatsResponse[];

  @ApiProperty({ type: AttemptThresholdsResponse })
  thresholds!: AttemptThresholdsResponse;
}
