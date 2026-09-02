import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { ArticleStatus, ArticleVisibility } from '@prisma/client';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;
}

export class CreateArticleDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  /** Derived from the title when omitted */
  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase words separated by hyphens',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsOptional()
  @IsEnum(ArticleVisibility)
  visibility?: ArticleVisibility;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** BCP-47 language tag; defaults to "en" */
  @IsOptional()
  @IsString()
  locale?: string;

  /** Set when this article is a translation of another */
  @IsOptional()
  @IsString()
  translationOfId?: string;
}

export class UpdateArticleDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsEnum(ArticleVisibility)
  visibility?: ArticleVisibility;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** A short note about what changed, kept with the version snapshot */
  @IsOptional()
  @IsString()
  note?: string;
}

export class QueryArticlesDto {
  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @IsOptional()
  @IsEnum(ArticleVisibility)
  visibility?: ArticleVisibility;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class PublicSearchDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;
}

export class ArticleFeedbackDto {
  @IsBoolean()
  helpful!: boolean;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class RestoreVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
