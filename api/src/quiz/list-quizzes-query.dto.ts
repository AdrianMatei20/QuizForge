import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const QUIZ_LIST_DEFAULT_LIMIT = 20;
export const QUIZ_LIST_MAX_LIMIT = 100;

export class ListQuizzesQueryDto {
  @ApiPropertyOptional({
    description: 'How many quizzes to return, newest first.',
    minimum: 1,
    maximum: QUIZ_LIST_MAX_LIMIT,
    default: QUIZ_LIST_DEFAULT_LIMIT,
    example: QUIZ_LIST_DEFAULT_LIMIT,
  })
  // Query strings are always strings; @Type converts before validation.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(QUIZ_LIST_MAX_LIMIT)
  limit?: number;
}
