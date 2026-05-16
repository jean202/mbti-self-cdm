import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const rawKey =
      this.configService.get<string>('ENCRYPTION_KEY') ??
      'dev-fallback-secret-key-32bytes!';

    // AES-256은 정확히 32바이트(256비트) 키가 필요합니다.
    this.key = Buffer.alloc(32);
    Buffer.from(rawKey).copy(this.key);
  }

  encrypt(plainText: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

      let encrypted = cipher.update(plainText, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag().toString('hex');

      return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (e) {
      this.logger.error('Failed to encrypt data', e);
      throw new Error('ENCRYPTION_FAILED');
    }
  }

  decrypt(encryptedText: string): string {
    try {
      // 기존에 암호화되지 않고 평문으로 저장된 토큰과의 호환성을 위한 처리
      if (!encryptedText.includes(':')) return encryptedText;

      const [ivHex, authTagHex, contentHex] = encryptedText.split(':');
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

      return decipher.update(contentHex, 'hex', 'utf8') + decipher.final('utf8');
    } catch (e) {
      this.logger.error('Failed to decrypt data', e);
      throw new Error('DECRYPTION_FAILED');
    }
  }
}