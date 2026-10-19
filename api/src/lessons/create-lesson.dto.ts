import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateLessonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  // Length limits are checked by assertLessonContentLength: over the maximum
  // is a 413, which class-validator cannot produce.
  @IsString()
  content!: string;
}
