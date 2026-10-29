import {
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { toProfileDto } from '../lib/profiles.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from '../common/guards/auth.guard.js';
import { AuthRateLimitGuard } from '../common/guards/auth-rate-limit.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @UseGuards(AuthRateLimitGuard)
  async signup(@Req() request: Request, @Res() response: Response) {
    return this.authService.signup(request.body, response);
  }

  @Post('refresh')
  async refresh(@Req() request: Request, @Res() response: Response) {
    return this.authService.refresh(request, response);
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res() response: Response) {
    return this.authService.logout(request, response);
  }

  @Get('verify')
  async verifyEmail(@Req() request: Request, @Res() response: Response) {
    return this.authService.verifyEmail(request, response);
  }

  @Post('password-reset/request')
  @UseGuards(AuthRateLimitGuard)
  async requestPasswordReset(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.authService.requestPasswordReset(request.body, response);
  }

  @Post('verification/resend')
  @UseGuards(AuthRateLimitGuard)
  async resendVerification(@Req() request: Request, @Res() response: Response) {
    return this.authService.resendVerification(request.body, response);
  }

  @Post('password-reset/confirm')
  @UseGuards(AuthRateLimitGuard)
  async confirmPasswordReset(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.authService.confirmPasswordReset(request.body, response);
  }

  @Post('login')
  @UseGuards(AuthRateLimitGuard)
  async login(@Req() request: Request, @Res() response: Response) {
    return this.authService.login(request.body, request, response);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async getCurrentProfile(@Req() request: Request, @Res() response: Response) {
    const profile = await this.authService.getAuthenticatedProfile(request);

    if (!profile) {
      return response
        .status(401)
        .json({ message: 'Authentication is required.' });
    }

    return response.status(200).json(toProfileDto(profile));
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  async updateProfile(@Req() request: Request, @Res() response: Response) {
    return this.authService.updateProfile(request, request.body, response);
  }

  @Get('google')
  async google(@Req() request: Request, @Res() response: Response) {
    return this.authService.redirectToGoogle(request, response);
  }

  @Get('google/callback')
  async googleCallback(@Req() request: Request, @Res() response: Response) {
    return this.authService.googleCallback(request, response);
  }
}
