import { Module } from '@nestjs/common';
import { DemoMode } from './demo-mode.js';
import { InfoController } from './info.controller.js';

/** Demo mode (the fake provider with sample lessons only) and GET /api/info. */
@Module({
  controllers: [InfoController],
  providers: [DemoMode],
  exports: [DemoMode],
})
export class DemoModule {}
