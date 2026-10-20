import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { ApiProblems } from '../docs/api-problems.js';
import { DemoMode } from './demo-mode.js';

export class AppInfoResponse {
  @ApiProperty({
    description:
      'True when the API runs on the fake LLM provider: quizzes can then be generated from the sample lessons only.',
    example: true,
  })
  demoMode!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Titles of the sample lessons that work in demo mode.',
    example: ['Binary search', 'HTTP caching', 'Recursion'],
  })
  sampleLessons!: string[];
}

/** What the web app needs to know about how the API runs (no secrets, no config values). */
@ApiTags('health')
@Controller('info')
export class InfoController {
  constructor(private readonly demo: DemoMode) {}

  @Get()
  @ApiOperation({
    summary: 'How the API runs',
    description:
      'Whether it is in demo mode (fake LLM provider), and which sample lessons work then. The web app shows a banner in demo mode.',
  })
  @ApiOkResponse({ type: AppInfoResponse })
  @ApiProblems()
  info(): AppInfoResponse {
    return {
      demoMode: this.demo.enabled,
      sampleLessons: this.demo.sampleLessons.map((lesson) => lesson.title),
    };
  }
}
