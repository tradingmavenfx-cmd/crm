import { Module } from '@nestjs/common';
import { RoutingService } from './routing.service';

/**
 * Auto-assignment lives in its own module so every channel can route inbound
 * conversations without depending on the inbox (which depends on them).
 */
@Module({
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
