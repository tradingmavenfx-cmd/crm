import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  EmailProvider,
  SendEmailInput,
  SendEmailResult,
} from './email-provider.interface';

/** Real SMTP email provider (nodemailer). Used when SMTP_HOST is configured. */
@Injectable()
export class SmtpEmailProvider implements EmailProvider, OnModuleInit {
  private readonly logger = new Logger('EmailSmtp');
  private transporter!: Transporter;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('email.host'),
      port: this.config.get<number>('email.port'),
      secure: this.config.get<boolean>('email.secure'),
      auth: {
        user: this.config.get<string>('email.user'),
        pass: this.config.get<string>('email.password'),
      },
    });
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const info = await this.transporter.sendMail({
      from: this.config.get<string>('email.from'),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    this.logger.log(`Sent email to ${input.to} (${info.messageId})`);
    return { externalId: info.messageId };
  }
}
