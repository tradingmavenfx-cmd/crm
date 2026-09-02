import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { InboxModule } from '../inbox/inbox.module';

@Module({
  // A public reply on a ticket goes out through the channel the thread is on.
  imports: [InboxModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
