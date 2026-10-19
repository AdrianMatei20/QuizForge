import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const QUIZ_LIST_DEFAULT_LIMIT = 20;
export const QUIZ_LIST_MAX_LIMIT = 100;

export class ListQuizzesQueryDto {
  // Query strings are always strings; @Type converts before validation.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(QUIZ_LIST_MAX_LIMIT)
  limit?: number;
}
