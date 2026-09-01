import { Module } from '@nestjs/common';
import { InboxService } from './inbox.service';
import { InboxController } from './inbox.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [WhatsappModule, EmailModule, SmsModule],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
