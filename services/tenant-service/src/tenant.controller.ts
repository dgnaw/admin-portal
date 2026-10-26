import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { SysadminGuard, TenantScopedGuard, actorOf } from './auth';
import { TenantService } from './tenant.service';

@Controller('products')
@UseGuards(SysadminGuard)
export class ProductController {
  constructor(@Inject(TenantService) private readonly tenants: TenantService) {}

  @Get()
  list() {
    return this.tenants.listProducts();
  }

  @Post()
  create(@Body() body: { code: string; name: string; realm: string }, @Req() req: any) {
    return this.tenants.ensureProduct(body.code, body.name, body.realm ?? body.code, actorOf(req));
  }
}

@Controller('tenants')
export class TenantController {
  constructor(@Inject(TenantService) private readonly tenants: TenantService) {}

  @Get()
  @UseGuards(SysadminGuard)
  list(@Query('productCode') productCode?: string) {
    return this.tenants.list(productCode);
  }

  @Post()
  @UseGuards(SysadminGuard)
  create(@Body() body: any, @Req() req: any) {
    return this.tenants.create(body, actorOf(req));
  }

  @Get(':tenantId')
  @UseGuards(TenantScopedGuard)
  get(@Param('tenantId') tenantId: string) {
    return this.tenants.get(tenantId);
  }

  @Put(':tenantId/cname')
  @UseGuards(SysadminGuard)
  setCname(@Param('tenantId') tenantId: string, @Body() body: { hostname: string }, @Req() req: any) {
    return this.tenants.setCname(tenantId, body.hostname, actorOf(req));
  }

  @Put(':tenantId/oidc')
  @UseGuards(SysadminGuard)
  setOidc(@Param('tenantId') tenantId: string, @Body() body: any, @Req() req: any) {
    return this.tenants.setOidc(tenantId, body, actorOf(req));
  }

  @Put(':tenantId/whitelabel/:appCode')
  @UseGuards(TenantScopedGuard)
  setWhitelabel(
    @Param('tenantId') tenantId: string,
    @Param('appCode') appCode: string,
    @Body() body: Record<string, unknown>,
    @Req() req: any,
  ) {
    return this.tenants.setWhitelabel(tenantId, appCode, body, actorOf(req));
  }
}

@Controller('resolve')
export class ResolveController {
  constructor(@Inject(TenantService) private readonly tenants: TenantService) {}

  @Get()
  resolve(@Query('host') host: string) {
    return this.tenants.resolveByHost(host);
  }
}
