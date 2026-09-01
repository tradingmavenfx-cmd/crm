export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  whatsapp: {
    // When false (no credentials), the mock provider is used and messages are logged.
    enabled: boolean;
    apiVersion: string;
    phoneNumberId: string;
    accessToken: string;
    verifyToken: string;
    appSecret: string;
  };
  email: {
    // When false (no SMTP host), the mock provider is used and emails are logged.
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
  };
  sms: {
    // When false (no credentials), the mock provider is used and texts are logged.
    enabled: boolean;
    accountSid: string;
    authToken: string;
    from: string;
    // Messaging service / DLT entity id required by Indian (TRAI) senders
    dltEntityId: string;
  };
  voice: {
    // When false (no credentials), the mock provider is used and calls are logged.
    enabled: boolean;
    accountSid: string;
    authToken: string;
    from: string;
    // Public base URL the telephony platform posts IVR callbacks to
    publicUrl: string;
    statusCallbackUrl: string;
    // Contact score at or above which a caller skips the menu (VIP routing)
    vipScoreThreshold: number;
    voicemailMaxSec: number;
    // Auto-reply text sent after a missed inbound call ('' disables it)
    missedCallSms: string;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '4000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  whatsapp: {
    enabled: Boolean(
      process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
    ),
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? 'dev-verify-token',
    appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
  },
  email: {
    enabled: Boolean(process.env.SMTP_HOST),
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? 'CRM Pro <no-reply@crm.local>',
  },
  sms: {
    enabled: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.SMS_FROM_NUMBER,
    ),
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    from: process.env.SMS_FROM_NUMBER ?? '',
    dltEntityId: process.env.SMS_DLT_ENTITY_ID ?? '',
  },
  voice: {
    enabled: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.VOICE_FROM_NUMBER,
    ),
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    from: process.env.VOICE_FROM_NUMBER ?? '',
    publicUrl:
      process.env.VOICE_PUBLIC_URL ??
      `http://localhost:${process.env.PORT ?? '4000'}/api`,
    statusCallbackUrl: process.env.VOICE_STATUS_CALLBACK_URL ?? '',
    vipScoreThreshold: parseInt(process.env.VOICE_VIP_SCORE ?? '70', 10),
    voicemailMaxSec: parseInt(process.env.VOICE_VOICEMAIL_MAX_SEC ?? '120', 10),
    missedCallSms:
      process.env.VOICE_MISSED_CALL_SMS ??
      'Sorry we missed your call. Our team will call you back shortly.',
  },
});
