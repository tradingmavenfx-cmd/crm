import { Body, Controller, Get, HttpCode, Ip, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  me(@CurrentUser('userId') userId: string) {
    return this.authService.me(userId);
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string, @Req() req: Request) {
    // Where from and on what: the sign-in history and the session it opens are
    // only useful if they say.
    return this.authService.login(dto, {
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Ip() ip: string, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, {
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @HttpCode(200)
  @Post('logout')
  async logout(
    @CurrentUser('userId') userId: string,
    @Body() dto: { refreshToken?: string },
  ) {
    // The token names the device being signed out. Without it, only the
    // legacy single-token state is cleared.
    await this.authService.logout(userId, dto?.refreshToken);
    return { success: true };
  }
}
