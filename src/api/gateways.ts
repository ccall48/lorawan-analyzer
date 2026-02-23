import type { FastifyInstance } from 'fastify';
import {
  getGateways,
  getGatewayById,
  getGatewayOperators,
  getGatewayDevices,
  getGatewayOperatorsWithDeviceCounts,
  getDevicesForGatewayOperator,
  getCsDevices,
  getCsGatewayStats,
} from '../db/queries.js';

export async function gatewayRoutes(fastify: FastifyInstance): Promise<void> {
  // List all gateways
  fastify.get('/api/gateways', async () => {
    const gateways = await getGateways();
    return { gateways };
  });

  // Get gateway details
  fastify.get<{ Params: { id: string } }>('/api/gateways/:id', async (request, reply) => {
    const gateway = await getGatewayById(request.params.id);
    if (!gateway) {
      reply.code(404);
      return { error: 'Gateway not found' };
    }
    return { gateway };
  });

  // Get operators seen on gateway
  fastify.get<{
    Params: { id: string };
    Querystring: { hours?: string };
  }>('/api/gateways/:id/operators', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const operators = await getGatewayOperators(request.params.id, hours);
    return { operators };
  });

  // Get devices seen on gateway
  fastify.get<{
    Params: { id: string };
    Querystring: { hours?: string; limit?: string; rssi_min?: string; rssi_max?: string; group_name?: string };
  }>('/api/gateways/:id/devices', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const limit = parseInt(request.query.limit ?? '100', 10);
    const rssiMin = request.query.rssi_min ? parseInt(request.query.rssi_min, 10) : undefined;
    const rssiMax = request.query.rssi_max ? parseInt(request.query.rssi_max, 10) : undefined;
    const groupName = request.query.group_name || null;
    const devices = await getGatewayDevices(request.params.id, hours, limit, rssiMin, rssiMax, groupName);
    return { devices };
  });

  // Get gateway tree (operators with device counts for lazy-load navigation)
  fastify.get<{
    Params: { id: string };
    Querystring: { hours?: string; group_name?: string };
  }>('/api/gateways/:id/tree', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const groupName = request.query.group_name || null;
    const operators = await getGatewayOperatorsWithDeviceCounts(request.params.id, hours, groupName);
    return { operators };
  });

  // Get devices for specific operator on gateway
  fastify.get<{
    Params: { id: string; operator: string };
    Querystring: { hours?: string; limit?: string };
  }>('/api/gateways/:id/operators/:operator/devices', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const limit = parseInt(request.query.limit ?? '50', 10);
    const devices = await getDevicesForGatewayOperator(
      request.params.id,
      decodeURIComponent(request.params.operator),
      hours,
      limit
    );
    return { devices };
  });

  // Get ChirpStack devices (active in time window)
  fastify.get<{
    Querystring: { hours?: string; gateway_id?: string };
  }>('/api/cs-devices', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const gatewayId = request.query.gateway_id || null;
    const devices = await getCsDevices(hours, gatewayId);
    return { devices };
  });

  // Returns gateways active for CS devices with CS-specific packet counts
  fastify.get<{
    Querystring: { hours?: string };
  }>('/api/cs-gateway-ids', async (request) => {
    const hours = parseInt(request.query.hours ?? '24', 10);
    const stats = await getCsGatewayStats(hours);
    return { gateways: stats };
  });
}
