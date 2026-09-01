import { Module } from '@nestjs/common';
import { InboxService } from './inbox.service';
import { RoutingModule } from '../routing/routing.module';
import { InboxController } from './inbox.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [WhatsappModule, EmailModule, SmsModule, RoutingModule],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
