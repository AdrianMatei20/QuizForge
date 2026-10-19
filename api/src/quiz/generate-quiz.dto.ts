import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import {
  DIFFICULTIES,
  type Difficulty,
  QUESTION_TYPES,
  type QuestionType,
  QUIZ_COUNT_MAX,
  QUIZ_COUNT_MIN,
} from './quiz.types.js';

export class GenerateQuizDto {
  @ApiProperty({
    description: 'How many questions to generate.',
    minimum: QUIZ_COUNT_MIN,
    maximum: QUIZ_COUNT_MAX,
    example: 5,
  })
  @IsInt()
  @Min(QUIZ_COUNT_MIN)
  @Max(QUIZ_COUNT_MAX)
  count!: number;

  @ApiProperty({
    enum: DIFFICULTIES,
    description:
      'easy: recall of stated facts; medium: understanding or applying an idea; hard: combining several parts of the lesson.',
    example: 'medium',
  })
  @IsIn(DIFFICULTIES)
  difficulty!: Difficulty;

  @ApiProperty({
    enum: QUESTION_TYPES,
    isArray: true,
    uniqueItems: true,
    minItems: 1,
    description: 'Question types the quiz may use.',
    example: ['multiple_choice', 'true_false'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(QUESTION_TYPES, { each: true })
  types!: QuestionType[];
}
