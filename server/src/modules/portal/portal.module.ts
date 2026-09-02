import { Module } from '@nestjs/common';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { PortalGuard } from './portal.guard';
import { EmailModule } from '../email/email.module';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  // EmailModule for the sign-in link's provider; TicketsModule so a ticket
  // raised from the portal goes through the same routing and SLA rules as one
  // raised by an agent.
  imports: [EmailModule, TicketsModule],
  controllers: [PortalController],
  providers: [PortalService, PortalGuard],
})
export class PortalModule {}
