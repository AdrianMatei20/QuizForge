import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const LESSON_LIST_DEFAULT_LIMIT = 20;
export const LESSON_LIST_MAX_LIMIT = 100;

export class ListLessonsQueryDto {
  @ApiPropertyOptional({
    description: 'How many lessons to return, newest first.',
    minimum: 1,
    maximum: LESSON_LIST_MAX_LIMIT,
    default: LESSON_LIST_DEFAULT_LIMIT,
    example: LESSON_LIST_DEFAULT_LIMIT,
  })
  // Query strings are always strings; @Type converts before validation.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LESSON_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description: 'How many of the newest lessons to skip.',
    minimum: 0,
    default: 0,
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
