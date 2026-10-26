import { BadRequestException } from '@nestjs/common';

export const TENANT_CODE_PATTERN = /^[A-Za-z0-9]+$/;
const MAX_LENGTH = 16;

export function normalizeTenantCode(raw: string): string {
  const cleaned = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '');
  return cleaned.slice(0, MAX_LENGTH);
}

export function assertTenantCode(code: string): void {
  if (!TENANT_CODE_PATTERN.test(code)) {
    throw new BadRequestException(
      `Ma Tenant "${code}" khong hop le: chi chap nhan chu va so, khong dau gach duoi ` +
        '(neu khong composite_tenant_id se khong parse nguoc duoc).',
    );
  }
  if (code.length > MAX_LENGTH) {
    throw new BadRequestException(`Ma Tenant dai qua ${MAX_LENGTH} ky tu`);
  }
}

export function suggestTenantCode(name: string, attempt = 0): string {
  const base = normalizeTenantCode(name) || 'TENANT';
  if (attempt === 0) return base;
  const suffix = String(attempt + 1);
  return base.slice(0, MAX_LENGTH - suffix.length) + suffix;
}

export function compositeTenantId(productCode: string, tenantCode: string, separator = '_'): string {
  return `${productCode}${separator}${tenantCode}`;
}
