import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { UsageController } from './usage.controller.js';

@Module({
  imports: [LlmModule],
  controllers: [UsageController],
})
export class UsageModule {}
