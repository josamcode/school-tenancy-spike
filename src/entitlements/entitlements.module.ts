import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { RouteDeclarations } from './route-declarations.js';

@Module({
  imports: [DiscoveryModule],
  providers: [RouteDeclarations],
})
export class EntitlementsModule {}
