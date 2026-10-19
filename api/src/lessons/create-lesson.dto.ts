import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { LESSON_CONTENT_MAX, LESSON_CONTENT_MIN } from './lesson-content.js';

export class CreateLessonDto {
  @ApiProperty({ maxLength: 200, example: 'Recursion' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  // Length limits are checked by assertLessonContentLength: over the maximum
  // is a 413, which class-validator cannot produce.
  @ApiProperty({
    description: `The lesson text, ${LESSON_CONTENT_MIN} to ${LESSON_CONTENT_MAX} characters after trimming (400 if shorter, 413 if longer). Treated as data, never as instructions to the model.`,
    minLength: LESSON_CONTENT_MIN,
    maxLength: LESSON_CONTENT_MAX,
    example:
      'A recursive function is a function that calls itself to solve a smaller version of the same problem. Every recursive function needs a base case, which is a condition where the function returns a result without calling itself. Without a base case, the function would call itself forever.',
  })
  @IsString()
  content!: string;
}
