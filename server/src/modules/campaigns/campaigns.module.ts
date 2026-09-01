import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { EmailModule } from '../email/email.module';
import { SmsModule } from '../sms/sms.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [EmailModule, SmsModule, WhatsappModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
