import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateTenantSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  productName?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  /** #rrggbb; the shades either side are derived from it */
  @IsOptional()
  @Matches(/^#?[0-9a-fA-F]{6}$/, {
    message: 'primaryColor must be a six-digit hex colour, like #4f46e5',
  })
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  loginHeadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  loginSubtext?: string;

  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @IsOptional()
  @Matches(/^[a-z0-9.-]+\.[a-z]{2,}$/i, {
    message: 'customDomain must be a hostname, like crm.yourcompany.com',
  })
  customDomain?: string;

  @IsOptional()
  @IsBoolean()
  showPoweredBy?: boolean;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsIn(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'])
  currency?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  /** 15 characters: 2 state digits, 10 PAN, 1 entity, Z, 1 checksum */
  @IsOptional()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, {
    message: 'gstin does not look like a GSTIN',
  })
  gstin?: string;

  /** name@bank, the address money is sent to */
  @IsOptional()
  @Matches(/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/, {
    message: 'upiVpa must look like name@bank',
  })
  upiVpa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  upiName?: string;
}
