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
  @IsInt()
  @Min(QUIZ_COUNT_MIN)
  @Max(QUIZ_COUNT_MAX)
  count!: number;

  @IsIn(DIFFICULTIES)
  difficulty!: Difficulty;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(QUESTION_TYPES, { each: true })
  types!: QuestionType[];
}
